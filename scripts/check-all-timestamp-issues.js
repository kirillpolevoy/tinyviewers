#!/usr/bin/env node

/**
 * Check ALL movies for timestamp issues
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

function hasTimestampIssues(timestamp) {
  if (!timestamp) return false;
  
  // Check for common timestamp issues:
  // 1. Contains milliseconds (e.g., "00:01:15,617")
  // 2. Contains subtitle format (e.g., "00:01:15 --> 00:01:38")
  // 3. Contains extra text (e.g., "00:01:15 - 00:01:38")
  // 4. Not in HH:MM:SS format
  
  const hasMilliseconds = timestamp.includes(',');
  const hasSubtitleFormat = timestamp.includes('-->');
  const hasExtraText = timestamp.includes(' - ') || timestamp.includes(' --> ');
  const notCleanFormat = !/^\d{2}:\d{2}:\d{2}$/.test(timestamp);
  
  return hasMilliseconds || hasSubtitleFormat || hasExtraText || notCleanFormat;
}

async function checkAllMoviesForTimestampIssues() {
  console.log('🔍 Checking ALL movies for timestamp issues...\n');
  
  try {
    // Get all movies
    const { data: movies, error: moviesError } = await supabase
      .from('movies')
      .select('id, title');
    
    if (moviesError) {
      throw new Error(`Failed to get movies: ${moviesError.message}`);
    }
    
    console.log(`📽️  Found ${movies.length} movies to check\n`);
    
    let totalMoviesWithIssues = 0;
    let totalScenesWithIssues = 0;
    const moviesWithIssues = [];
    
    for (const movie of movies) {
      // Get scenes for this movie
      const { data: scenes, error: scenesError } = await supabase
        .from('scenes')
        .select('timestamp_start, timestamp_end, description, intensity, age_flags')
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
        totalMoviesWithIssues++;
        totalScenesWithIssues += scenesWithIssues.length;
        
        moviesWithIssues.push({
          title: movie.title,
          id: movie.id,
          totalScenes: scenes.length,
          scenesWithIssues: scenesWithIssues.length,
          issues: scenesWithIssues.map(scene => ({
            timestamp_start: scene.timestamp_start,
            timestamp_end: scene.timestamp_end,
            intensity: scene.intensity,
            age_flags: scene.age_flags
          }))
        });
        
        console.log(`❌ ${movie.title}:`);
        console.log(`   Total scenes: ${scenes.length}`);
        console.log(`   Scenes with timestamp issues: ${scenesWithIssues.length}`);
        
        // Show first few problematic scenes
        scenesWithIssues.slice(0, 3).forEach((scene, index) => {
          console.log(`   Scene ${index + 1}: ${scene.timestamp_start} - ${scene.timestamp_end}`);
        });
        
        if (scenesWithIssues.length > 3) {
          console.log(`   ... and ${scenesWithIssues.length - 3} more`);
        }
        console.log('');
      } else {
        console.log(`✅ ${movie.title}: All timestamps clean`);
      }
    }
    
    // Summary
    console.log('📊 SUMMARY:');
    console.log(`Total movies checked: ${movies.length}`);
    console.log(`Movies with timestamp issues: ${totalMoviesWithIssues}`);
    console.log(`Total scenes with timestamp issues: ${totalScenesWithIssues}`);
    console.log(`Movies with clean timestamps: ${movies.length - totalMoviesWithIssues}`);
    
    if (moviesWithIssues.length > 0) {
      console.log('\n🎯 MOVIES THAT NEED FIXING:');
      moviesWithIssues.forEach((movie, index) => {
        console.log(`${index + 1}. ${movie.title} (${movie.scenesWithIssues}/${movie.totalScenes} scenes)`);
      });
      
      console.log('\n💡 RECOMMENDATION:');
      console.log('Run the improved LLM analysis on these movies to fix both timestamp and age flag issues.');
    } else {
      console.log('\n🎉 All movies have clean timestamps!');
    }
    
  } catch (error) {
    console.error('❌ Check failed:', error.message);
  }
}

checkAllMoviesForTimestampIssues();
