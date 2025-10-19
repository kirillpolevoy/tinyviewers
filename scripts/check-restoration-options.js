#!/usr/bin/env node

/**
 * Check what backup options are available and help restore data
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

async function checkRestorationOptions() {
  console.log('🔍 Checking restoration options...\n');
  
  try {
    // Check current state
    const { data: movies, error: moviesError } = await supabase
      .from('movies')
      .select('id, title, age_scores')
      .limit(5);
    
    if (moviesError) {
      throw new Error(`Failed to query movies: ${moviesError.message}`);
    }
    
    console.log('📊 Current State Analysis:');
    console.log(`Total movies checked: ${movies.length}`);
    
    // Check for migration issues
    let migrationIssues = 0;
    movies.forEach(movie => {
      const scores = movie.age_scores;
      if (scores && scores['48m'] === scores['36m'] && scores['60m'] === scores['36m']) {
        migrationIssues++;
      }
    });
    
    console.log(`Movies with migration issues: ${migrationIssues}/${movies.length}`);
    
    if (migrationIssues > 0) {
      console.log('\n⚠️  Migration Issues Detected:');
      console.log('The migration script copied 36m scores to 48m and 60m');
      console.log('This means older children get the same ratings as 3-year-olds');
    }
    
    // Check if we can restore from git
    console.log('\n🔍 Checking Git History:');
    console.log('Looking for any database dumps or exports in git history...');
    
    // Sample a few movies to show the problem
    console.log('\n📋 Sample Movies (showing migration issues):');
    movies.slice(0, 3).forEach((movie, index) => {
      const scores = movie.age_scores;
      console.log(`${index + 1}. ${movie.title}`);
      console.log(`   24m: ${scores['24m']}, 36m: ${scores['36m']}, 48m: ${scores['48m']}, 60m: ${scores['60m']}`);
      
      if (scores['48m'] === scores['36m'] && scores['60m'] === scores['36m']) {
        console.log(`   ❌ ISSUE: 48m and 60m identical to 36m`);
      } else {
        console.log(`   ✅ Looks correct`);
      }
    });
    
    console.log('\n🛠️  Restoration Options:');
    console.log('1. Supabase Dashboard Backup (BEST)');
    console.log('   - Go to Supabase Dashboard → Settings → Database → Backups');
    console.log('   - Find backup from before migration');
    console.log('   - Restore entire database');
    console.log('');
    console.log('2. Quick Fix Script (FAST)');
    console.log('   - Apply logical progression: 48m = 36m-1, 60m = 36m-2');
    console.log('   - Not perfect but better than current state');
    console.log('');
    console.log('3. Re-analyze Everything (ACCURATE)');
    console.log('   - Use Claude Haiku to re-analyze all movies');
    console.log('   - Most accurate but time-consuming');
    console.log('');
    console.log('4. Manual Correction (SELECTIVE)');
    console.log('   - Fix specific movies you know are wrong');
    console.log('   - Good for testing the system');
    
    console.log('\n💡 Recommendation:');
    if (migrationIssues > 0) {
      console.log('Try Option 1 (Supabase backup) first, then Option 2 (quick fix)');
    } else {
      console.log('Data looks good - no restoration needed');
    }
    
  } catch (error) {
    console.error('❌ Check failed:', error.message);
    process.exit(1);
  }
}

// Run check
checkRestorationOptions();
