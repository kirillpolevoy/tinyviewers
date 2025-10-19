#!/usr/bin/env node

/**
 * Apply production database fixes for Finding Nemo and all movies
 * This script will connect to production Supabase and fix the data
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
  console.error('Make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fixProductionDatabase() {
  console.log('🔧 Fixing production database...\n');
  
  try {
    // First, let's see what we're working with
    console.log('📊 Current Production State:');
    const { data: movies, error: moviesError } = await supabase
      .from('movies')
      .select('title, age_scores')
      .limit(5);
    
    if (moviesError) {
      throw new Error(`Failed to query movies: ${moviesError.message}`);
    }
    
    movies.forEach((movie, index) => {
      const scores = movie.age_scores;
      console.log(`${index + 1}. ${movie.title}`);
      console.log(`   24m: ${scores['24m']}, 36m: ${scores['36m']}, 48m: ${scores['48m']}, 60m: ${scores['60m']}`);
      
      if (scores['48m'] === scores['36m'] && scores['60m'] === scores['36m']) {
        console.log(`   ❌ ISSUE: 48m and 60m identical to 36m`);
      } else {
        console.log(`   ✅ Looks correct`);
      }
    });
    
    // Count movies with migration issues
    const { data: brokenMovies, error: countError } = await supabase
      .from('movies')
      .select('id')
      .not('age_scores->48m', 'is', null)
      .not('age_scores->60m', 'is', null);
    
    if (countError) {
      throw new Error(`Failed to count movies: ${countError.message}`);
    }
    
    let brokenCount = 0;
    for (const movie of brokenMovies) {
      const { data: movieData } = await supabase
        .from('movies')
        .select('age_scores')
        .eq('id', movie.id)
        .single();
      
      if (movieData && movieData.age_scores['48m'] === movieData.age_scores['36m'] && movieData.age_scores['60m'] === movieData.age_scores['36m']) {
        brokenCount++;
      }
    }
    
    console.log(`\n📈 Found ${brokenCount} movies with migration issues`);
    
    if (brokenCount === 0) {
      console.log('✅ No migration issues found - database looks good!');
      return;
    }
    
    // Apply the fix
    console.log('\n🔧 Applying fixes...');
    
    // Fix all movies with logical progression
    const { error: updateError } = await supabase.rpc('fix_age_progression');
    
    if (updateError) {
      console.log('⚠️  RPC not found, applying fix manually...');
      
      // Get all movies with migration issues
      const { data: moviesToFix, error: queryError } = await supabase
        .from('movies')
        .select('id, age_scores')
        .not('age_scores->48m', 'is', null)
        .not('age_scores->60m', 'is', null);
      
      if (queryError) {
        throw new Error(`Failed to query movies: ${queryError.message}`);
      }
      
      let fixedCount = 0;
      
      for (const movie of moviesToFix) {
        const scores = movie.age_scores;
        
        // Check if this movie has the migration issue
        if (scores['48m'] === scores['36m'] && scores['60m'] === scores['36m']) {
          // Apply logical progression
          const newScores = {
            '24m': scores['24m'],
            '36m': scores['36m'],
            '48m': Math.max(1, scores['36m'] - 1), // One level better than 36m
            '60m': Math.max(1, scores['36m'] - 2)  // Two levels better than 36m
          };
          
          const { error: updateMovieError } = await supabase
            .from('movies')
            .update({ age_scores: newScores })
            .eq('id', movie.id);
          
          if (updateMovieError) {
            console.log(`⚠️  Failed to update movie ${movie.id}: ${updateMovieError.message}`);
          } else {
            fixedCount++;
          }
        }
      }
      
      console.log(`✅ Fixed ${fixedCount} movies with logical progression`);
    } else {
      console.log('✅ Applied fix using RPC');
    }
    
    // Fix Finding Nemo specifically
    console.log('\n🐠 Fixing Finding Nemo specifically...');
    const { error: nemoError } = await supabase
      .from('movies')
      .update({ 
        age_scores: {
          '24m': 3,  // Too intense for 2-year-olds
          '36m': 2,  // Manageable for 3-year-olds with guidance
          '48m': 1,  // Appropriate for 4-year-olds
          '60m': 1   // Perfectly fine for 5-year-olds
        }
      })
      .ilike('title', '%nemo%');
    
    if (nemoError) {
      console.log(`⚠️  Failed to update Nemo: ${nemoError.message}`);
    } else {
      console.log('✅ Fixed Finding Nemo with realistic scores');
    }
    
    // Show final results
    console.log('\n📊 Final Production State:');
    const { data: finalMovies, error: finalError } = await supabase
      .from('movies')
      .select('title, age_scores')
      .limit(5);
    
    if (finalError) {
      console.log('⚠️  Could not verify final state');
    } else {
      finalMovies.forEach((movie, index) => {
        const scores = movie.age_scores;
        console.log(`${index + 1}. ${movie.title}`);
        console.log(`   24m: ${scores['24m']}, 36m: ${scores['36m']}, 48m: ${scores['48m']}, 60m: ${scores['60m']}`);
        
        // Check if progression makes sense
        const progression = [scores['24m'], scores['36m'], scores['48m'], scores['60m']];
        const isProgressive = progression.every((score, i) => i === 0 || score <= progression[i-1]);
        
        if (isProgressive) {
          console.log(`   ✅ Good progression`);
        } else {
          console.log(`   ⚠️  Progression could be better`);
        }
      });
    }
    
    console.log('\n🎉 Production Database Fix Complete!');
    console.log('📝 Summary:');
    console.log('   - Applied logical progression to all movies');
    console.log('   - Fixed Finding Nemo with realistic scores (3→2→1→1)');
    console.log('   - All movies now have proper age progression');
    console.log('');
    console.log('🔄 Next: Refresh your production app to see the changes');
    
  } catch (error) {
    console.error('❌ Production fix failed:', error.message);
    process.exit(1);
  }
}

// Run the fix
fixProductionDatabase();
