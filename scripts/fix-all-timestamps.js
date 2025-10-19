#!/usr/bin/env node

/**
 * Fix timestamp issues for all movies without re-analyzing
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function cleanTimestamp(timestamp) {
  if (!timestamp) return timestamp;
  
  // Extract HH:MM:SS format from various subtitle formats
  const match = timestamp.match(/(\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : timestamp;
}

function hasTimestampIssues(timestamp) {
  if (!timestamp) return false;
  
  // Check for common timestamp issues:
  const hasMilliseconds = timestamp.includes(',');
  const hasSubtitleFormat = timestamp.includes('-->');
  const hasExtraText = timestamp.includes(' - ') || timestamp.includes(' --> ');
  const notCleanFormat = !/^\d{2}:\d{2}:\d{2}$/.test(timestamp);
  
  return hasMilliseconds || hasSubtitleFormat || hasExtraText || notCleanFormat;
}

async function fixAllTimestampIssues() {
  console.log('🔧 Fixing timestamp issues for all movies...\n');
  
  try {
    // Get all movies
    const { data: movies, error: moviesError } = await supabase
      .from('movies')
      .select('id, title');
    
    if (moviesError) {
      throw new Error(`Failed to get movies: ${moviesError.message}`);
    }
    
    console.log(`📽️  Found ${movies.length} movies to check\n`);
    
    let totalMoviesFixed = 0;
    let totalScenesFixed = 0;
    const moviesFixed = [];
    
    for (const movie of movies) {
      // Get scenes for this movie
      const { data: scenes, error: scenesError } = await supabase
        .from('scenes')
        .select('id, timestamp_start, timestamp_end, description, intensity')
        .eq('movie_id', movie.id)
        .order('timestamp_start');
      
      if (scenesError) {
        console.log(`⚠️  Could not get scenes for ${movie.title}: ${scenesError.message}`);
        continue;
      }
      
      if (!scenes || scenes.length === 0) {
        continue; // Skip movies with no scenes
      }
      
      // Check each scene for timestamp issues
      const scenesWithIssues = scenes.filter(scene => 
        hasTimestampIssues(scene.timestamp_start) || hasTimestampIssues(scene.timestamp_end)
      );
      
      if (scenesWithIssues.length > 0) {
        console.log(`🔧 Fixing ${movie.title} (${scenesWithIssues.length}/${scenes.length} scenes)...`);
        
        let movieScenesFixed = 0;
        
        for (const scene of scenesWithIssues) {
          const cleanStart = cleanTimestamp(scene.timestamp_start);
          const cleanEnd = cleanTimestamp(scene.timestamp_end);
          
          // Only update if timestamps actually changed
          if (cleanStart !== scene.timestamp_start || cleanEnd !== scene.timestamp_end) {
            const { error: updateError } = await supabase
              .from('scenes')
              .update({
                timestamp_start: cleanStart,
                timestamp_end: cleanEnd
              })
              .eq('id', scene.id);
            
            if (updateError) {
              console.log(`⚠️  Failed to update scene ${scene.id}: ${updateError.message}`);
            } else {
              movieScenesFixed++;
              totalScenesFixed++;
            }
          }
        }
        
        if (movieScenesFixed > 0) {
          totalMoviesFixed++;
          moviesFixed.push({
            title: movie.title,
            scenesFixed: movieScenesFixed,
            totalScenes: scenes.length
          });
          
          console.log(`✅ Fixed ${movieScenesFixed} scenes`);
        }
      }
    }
    
    // Summary
    console.log('\n📊 SUMMARY:');
    console.log(`Total movies checked: ${movies.length}`);
    console.log(`Movies with timestamp issues fixed: ${totalMoviesFixed}`);
    console.log(`Total scenes fixed: ${totalScenesFixed}`);
    
    if (moviesFixed.length > 0) {
      console.log('\n🎯 MOVIES FIXED:');
      moviesFixed.forEach((movie, index) => {
        console.log(`${index + 1}. ${movie.title} (${movie.scenesFixed}/${movie.totalScenes} scenes)`);
      });
      
      console.log('\n🎉 All timestamp issues have been fixed!');
      console.log('💡 Note: Age flags were not changed - only timestamps were cleaned.');
    } else {
      console.log('\n🎉 No timestamp issues found - all movies are already clean!');
    }
    
  } catch (error) {
    console.error('❌ Fix failed:', error.message);
  }
}

fixAllTimestampIssues();
