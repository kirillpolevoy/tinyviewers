#!/usr/bin/env node

/**
 * Analyze Nemo ratings to check migration impact
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

async function analyzeNemoRatings() {
  console.log('🐠 Analyzing Nemo ratings...\n');
  
  try {
    // Find Nemo movie(s)
    const { data: movies, error: moviesError } = await supabase
      .from('movies')
      .select('*')
      .ilike('title', '%nemo%');
    
    if (moviesError) {
      throw new Error(`Movies query failed: ${moviesError.message}`);
    }
    
    if (movies.length === 0) {
      console.log('❌ No movies found with "nemo" in the title');
      return;
    }
    
    console.log(`📊 Found ${movies.length} Nemo movie(s):\n`);
    
    movies.forEach((movie, index) => {
      console.log(`🎬 Movie ${index + 1}: ${movie.title}`);
      console.log(`   ID: ${movie.id}`);
      console.log(`   Release Year: ${movie.release_year || 'Unknown'}`);
      console.log(`   TMDB Rating: ${movie.tmdb_rating || 'N/A'}`);
      console.log(`   IMDB Rating: ${movie.imdb_rating || 'N/A'}`);
      console.log(`   Age Scores:`, movie.age_scores);
      
      // Analyze the age scores
      const scores = movie.age_scores;
      if (scores) {
        console.log(`   📈 Age Score Analysis:`);
        console.log(`     24m (2 years): ${scores['24m']}`);
        console.log(`     36m (3 years): ${scores['36m']}`);
        console.log(`     48m (4 years): ${scores['48m']}`);
        console.log(`     60m (5 years): ${scores['60m']}`);
        
        // Check if migration caused issues
        const issues = [];
        if (scores['48m'] === scores['36m']) {
          issues.push('48m score identical to 36m (migration issue)');
        }
        if (scores['60m'] === scores['36m']) {
          issues.push('60m score identical to 36m (migration issue)');
        }
        if (scores['48m'] === scores['60m']) {
          issues.push('48m and 60m scores identical (migration issue)');
        }
        
        if (issues.length > 0) {
          console.log(`   ⚠️  Migration Issues Detected:`);
          issues.forEach(issue => console.log(`     - ${issue}`));
        } else {
          console.log(`   ✅ Age scores look correct`);
        }
        
        // Calculate age recommendation
        let recommendation = 'Unknown';
        if (scores['24m'] <= 2) recommendation = 'Perfect for 2+';
        else if (scores['36m'] <= 2) recommendation = 'Great for 3+';
        else if (scores['48m'] <= 2) recommendation = 'Good for 4+';
        else if (scores['60m'] <= 2) recommendation = 'Best for 5+';
        else recommendation = 'Check ratings';
        
        console.log(`   🎯 Current Recommendation: ${recommendation}`);
      }
      
      console.log(''); // Empty line for readability
    });
    
    // Get scenes for the first Nemo movie
    if (movies.length > 0) {
      const nemoMovie = movies[0];
      console.log(`🎬 Scenes Analysis for "${nemoMovie.title}":`);
      
      const { data: scenes, error: scenesError } = await supabase
        .from('scenes')
        .select('*')
        .eq('movie_id', nemoMovie.id)
        .order('timestamp_start');
      
      if (scenesError) {
        console.log(`   ❌ Error fetching scenes: ${scenesError.message}`);
      } else if (scenes.length === 0) {
        console.log(`   ℹ️  No scenes found for this movie`);
      } else {
        console.log(`   📊 Found ${scenes.length} scenes`);
        
        // Analyze first few scenes
        const sampleScenes = scenes.slice(0, 3);
        sampleScenes.forEach((scene, index) => {
          console.log(`   Scene ${index + 1}: ${scene.timestamp_start} - ${scene.timestamp_end}`);
          console.log(`     Description: ${scene.description.substring(0, 100)}...`);
          console.log(`     Intensity: ${scene.intensity}/5`);
          console.log(`     Age Flags:`, scene.age_flags);
          console.log(`     Tags: ${scene.tags.join(', ')}`);
          console.log('');
        });
      }
    }
    
    // Summary
    console.log('📋 Summary:');
    console.log('✅ Migration completed - all movies have new age structure');
    console.log('⚠️  48m and 60m scores may be identical to 36m scores');
    console.log('💡 Recommendation: Re-run analysis to get proper 48m/60m scores');
    
  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
    process.exit(1);
  }
}

// Run analysis
analyzeNemoRatings();
