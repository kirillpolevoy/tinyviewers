#!/usr/bin/env node

/**
 * Apply quick fix to restore logical age progression
 * This won't restore original data, but will make the ratings more sensible
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

async function applyQuickFix() {
  console.log('🔧 Applying quick fix to restore logical age progression...\n');
  
  try {
    // First, let's see what we're working with
    console.log('📊 Before Fix - Sample Movies:');
    const { data: beforeMovies, error: beforeError } = await supabase
      .from('movies')
      .select('title, age_scores')
      .limit(5);
    
    if (beforeError) {
      throw new Error(`Failed to query movies: ${beforeError.message}`);
    }
    
    beforeMovies.forEach((movie, index) => {
      const scores = movie.age_scores;
      console.log(`${index + 1}. ${movie.title}`);
      console.log(`   24m: ${scores['24m']}, 36m: ${scores['36m']}, 48m: ${scores['48m']}, 60m: ${scores['60m']}`);
      
      if (scores['48m'] === scores['36m'] && scores['60m'] === scores['36m']) {
        console.log(`   ❌ ISSUE: 48m and 60m identical to 36m`);
      } else {
        console.log(`   ✅ Already fixed`);
      }
    });
    
    // Apply the fix using raw SQL
    console.log('\n🔧 Applying fix...');
    
    const { error: updateError } = await supabase.rpc('fix_age_progression');
    
    if (updateError) {
      // If the RPC doesn't exist, we'll do it manually
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
            console.log(`⚠️  Failed to update ${movie.id}: ${updateMovieError.message}`);
          } else {
            fixedCount++;
          }
        }
      }
      
      console.log(`✅ Fixed ${fixedCount} movies`);
    } else {
      console.log('✅ Fix applied successfully');
    }
    
    // Show results
    console.log('\n📊 After Fix - Sample Movies:');
    const { data: afterMovies, error: afterError } = await supabase
      .from('movies')
      .select('title, age_scores')
      .limit(5);
    
    if (afterError) {
      throw new Error(`Failed to query movies after fix: ${afterError.message}`);
    }
    
    afterMovies.forEach((movie, index) => {
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
    
    console.log('\n🎉 Quick Fix Complete!');
    console.log('📈 Age scores now have logical progression:');
    console.log('   - 48m scores are 1 level better than 36m');
    console.log('   - 60m scores are 2 levels better than 36m');
    console.log('');
    console.log('💡 This is not perfect, but much better than identical scores');
    console.log('🔄 You can always re-analyze specific movies later for more accuracy');
    
  } catch (error) {
    console.error('❌ Quick fix failed:', error.message);
    process.exit(1);
  }
}

// Run the fix
applyQuickFix();
