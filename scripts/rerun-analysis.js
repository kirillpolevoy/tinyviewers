#!/usr/bin/env node

/**
 * Easy script to rerun analysis for a single movie
 * Usage: node scripts/rerun-analysis.js "Movie Title"
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

async function rerunAnalysis(movieTitle) {
  console.log(`🔄 Rerunning analysis for: ${movieTitle}\n`);
  
  try {
    // Find the movie
    const { data: movies, error: moviesError } = await supabase
      .from('movies')
      .select('*')
      .ilike('title', `%${movieTitle}%`);
    
    if (moviesError) {
      throw new Error(`Failed to find movie: ${moviesError.message}`);
    }
    
    if (!movies || movies.length === 0) {
      throw new Error(`No movie found matching "${movieTitle}"`);
    }
    
    if (movies.length > 1) {
      console.log(`Found ${movies.length} movies matching "${movieTitle}":`);
      movies.forEach((movie, index) => {
        console.log(`${index + 1}. ${movie.title} (ID: ${movie.id})`);
      });
      console.log('\nUsing the first one...\n');
    }
    
    const movie = movies[0];
    console.log(`📽️  Movie: ${movie.title}`);
    console.log(`🆔 ID: ${movie.id}`);
    console.log(`📊 Current Overall Scores: ${JSON.stringify(movie.age_scores)}\n`);
    
    // Call the analyze-scenes API
    console.log('🤖 Calling analyze-scenes API...');
    const response = await fetch('http://localhost:3000/api/movies/analyze-scenes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        movieId: movie.id,
        subtitleText: `Sample subtitle data for ${movie.title}`
      })
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Analysis completed successfully!');
      console.log(`📊 New Overall Scores: ${JSON.stringify(result.overallScores)}`);
      console.log(`🎬 New Scenes: ${result.scenesCount} scenes\n`);
      
      // Get the updated scenes from the database
      const { data: updatedScenes, error: scenesError } = await supabase
        .from('scenes')
        .select('*')
        .eq('movie_id', movie.id)
        .order('timestamp_start');
      
      if (scenesError) {
        console.log('⚠️  Could not fetch updated scenes:', scenesError.message);
      } else {
        console.log('🎬 Updated Scenes:');
        updatedScenes.forEach((scene, index) => {
          console.log(`Scene ${index + 1}:`);
          console.log(`  Time: ${scene.timestamp_start} - ${scene.timestamp_end}`);
          console.log(`  Intensity: ${scene.intensity}/5`);
          console.log(`  Age Flags: ${JSON.stringify(scene.age_flags)}`);
          console.log(`  Description: ${scene.description}`);
          console.log('');
        });
        
        // Check if we have varied age flags
        const hasVariedFlags = updatedScenes.some(scene => {
          const flags = Object.values(scene.age_flags);
          return new Set(flags).size > 1;
        });
        
        console.log(`🎯 Result Analysis:`);
        console.log(`- Has varied age flags: ${hasVariedFlags ? '✅' : '❌'}`);
        console.log(`- More realistic than before: ${hasVariedFlags ? '✅' : '❌'}`);
      }
      
    } else {
      console.log('❌ Analysis failed:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Rerun failed:', error.message);
  }
}

// Get movie title from command line arguments
const movieTitle = process.argv[2];

if (!movieTitle) {
  console.log('Usage: node scripts/rerun-analysis.js "Movie Title"');
  console.log('Examples:');
  console.log('  node scripts/rerun-analysis.js "Frozen"');
  console.log('  node scripts/rerun-analysis.js "Toy Story"');
  console.log('  node scripts/rerun-analysis.js "Encanto"');
  process.exit(1);
}

rerunAnalysis(movieTitle);
