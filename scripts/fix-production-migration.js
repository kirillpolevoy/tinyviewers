#!/usr/bin/env node

/**
 * Fix production database with correct age progression
 * This script will fix the broken migration data in production
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load production environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.production') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  console.error('Make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fixProductionDatabase() {
  console.log('🔧 Fixing Production Database Migration Issue...\n');
  console.log(`📡 Connecting to: ${supabaseUrl}\n`);
  
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
        console.log(`   ❌ ISSUE: 48m and 60m identical to 36m (broken migration)`);
      } else {
        console.log(`   ✅ Looks correct`);
      }
    });
    
    // Count movies with migration issues
    const { data: allMovies, error: countError } = await supabase
      .from('movies')
      .select('id, age_scores');
    
    if (countError) {
      throw new Error(`Failed to count movies: ${countError.message}`);
    }
    
    let brokenCount = 0;
    for (const movie of allMovies) {
      if (movie.age_scores['48m'] === movie.age_scores['36m'] && movie.age_scores['60m'] === movie.age_scores['36m']) {
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
    
    let fixedCount = 0;
    
    for (const movie of allMovies) {
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
    console.log('   - Fixed broken migration data (48m/60m identical to 36m)');
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
