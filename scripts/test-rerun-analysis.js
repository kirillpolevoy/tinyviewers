#!/usr/bin/env node

/**
 * Test script to verify the rerun analysis functionality works
 * Usage: node scripts/test-rerun-analysis.js "Movie Title"
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

async function testRerunAnalysis(movieTitle) {
  console.log(`🧪 Testing rerun analysis for: ${movieTitle}\n`);
  
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
    
    const movie = movies[0];
    console.log(`📽️  Movie: ${movie.title}`);
    console.log(`🆔 ID: ${movie.id}`);
    console.log(`📊 Current Overall Scores: ${JSON.stringify(movie.age_scores)}\n`);
    
    // Test the API endpoint
    console.log('🌐 Testing analyze-scenes API endpoint...');
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
      console.log('✅ API test successful!');
      console.log(`📊 New Overall Scores: ${JSON.stringify(result.overallScores)}`);
      console.log(`🎬 New Scenes: ${result.scenesCount} scenes`);
      
      // Verify the data was actually updated in the database
      const { data: updatedMovie, error: updateError } = await supabase
        .from('movies')
        .select('age_scores')
        .eq('id', movie.id)
        .single();
      
      if (updateError) {
        console.log('⚠️  Could not verify database update:', updateError.message);
      } else {
        console.log(`📊 Database Updated Scores: ${JSON.stringify(updatedMovie.age_scores)}`);
        
        // Check if scores changed
        const scoresChanged = JSON.stringify(movie.age_scores) !== JSON.stringify(updatedMovie.age_scores);
        console.log(`🔄 Scores Changed: ${scoresChanged ? '✅' : '❌'}`);
      }
      
    } else {
      console.log('❌ API test failed:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Get movie title from command line arguments
const movieTitle = process.argv[2];

if (!movieTitle) {
  console.log('Usage: node scripts/test-rerun-analysis.js "Movie Title"');
  console.log('Examples:');
  console.log('  node scripts/test-rerun-analysis.js "Frozen"');
  console.log('  node scripts/test-rerun-analysis.js "Toy Story"');
  process.exit(1);
}

testRerunAnalysis(movieTitle);
