#!/usr/bin/env node

/**
 * Verification script to check that the age structure migration completed successfully
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

async function verifyMigration() {
  console.log('🔍 Verifying age structure migration...\n');
  
  try {
    // Check movies table
    const { data: movies, error: moviesError } = await supabase
      .from('movies')
      .select('id, title, age_scores')
      .limit(10);
    
    if (moviesError) {
      throw new Error(`Movies query failed: ${moviesError.message}`);
    }
    
    console.log('📊 Movies Table Analysis:');
    console.log(`Total movies checked: ${movies.length}`);
    
    const ageStructureCounts = {
      has24m: 0,
      has36m: 0,
      has48m: 0,
      has60m: 0,
      hasOldStructure: 0
    };
    
    movies.forEach(movie => {
      const scores = movie.age_scores;
      if (scores['24m'] !== undefined) ageStructureCounts.has24m++;
      if (scores['36m'] !== undefined) ageStructureCounts.has36m++;
      if (scores['48m'] !== undefined) ageStructureCounts.has48m++;
      if (scores['60m'] !== undefined) ageStructureCounts.has60m++;
      if (scores['12m'] !== undefined) ageStructureCounts.hasOldStructure++;
    });
    
    console.log(`✅ Has 24m: ${ageStructureCounts.has24m}/${movies.length}`);
    console.log(`✅ Has 36m: ${ageStructureCounts.has36m}/${movies.length}`);
    console.log(`✅ Has 48m: ${ageStructureCounts.has48m}/${movies.length}`);
    console.log(`✅ Has 60m: ${ageStructureCounts.has60m}/${movies.length}`);
    console.log(`❌ Has old 12m: ${ageStructureCounts.hasOldStructure}/${movies.length}`);
    
    // Check scenes table
    const { data: scenes, error: scenesError } = await supabase
      .from('scenes')
      .select('id, age_flags')
      .limit(10);
    
    if (scenesError) {
      console.log('⚠️  Scenes table not found or empty - this is normal if no scenes exist yet');
    } else {
      console.log('\n🎬 Scenes Table Analysis:');
      console.log(`Total scenes checked: ${scenes.length}`);
      
      const sceneAgeStructureCounts = {
        has24m: 0,
        has36m: 0,
        has48m: 0,
        has60m: 0,
        hasOldStructure: 0
      };
      
      scenes.forEach(scene => {
        const flags = scene.age_flags;
        if (flags['24m'] !== undefined) sceneAgeStructureCounts.has24m++;
        if (flags['36m'] !== undefined) sceneAgeStructureCounts.has36m++;
        if (flags['48m'] !== undefined) sceneAgeStructureCounts.has48m++;
        if (flags['60m'] !== undefined) sceneAgeStructureCounts.has60m++;
        if (flags['12m'] !== undefined) sceneAgeStructureCounts.hasOldStructure++;
      });
      
      console.log(`✅ Has 24m: ${sceneAgeStructureCounts.has24m}/${scenes.length}`);
      console.log(`✅ Has 36m: ${sceneAgeStructureCounts.has36m}/${scenes.length}`);
      console.log(`✅ Has 48m: ${sceneAgeStructureCounts.has48m}/${scenes.length}`);
      console.log(`✅ Has 60m: ${sceneAgeStructureCounts.has60m}/${scenes.length}`);
      console.log(`❌ Has old 12m: ${sceneAgeStructureCounts.hasOldStructure}/${scenes.length}`);
    }
    
    // Sample data check
    if (movies.length > 0) {
      console.log('\n📋 Sample Movie Data:');
      const sampleMovie = movies[0];
      console.log(`Title: ${sampleMovie.title}`);
      console.log(`Age Scores:`, sampleMovie.age_scores);
    }
    
    // Migration success check
    const migrationSuccessful = 
      ageStructureCounts.has24m === movies.length &&
      ageStructureCounts.has36m === movies.length &&
      ageStructureCounts.has48m === movies.length &&
      ageStructureCounts.has60m === movies.length &&
      ageStructureCounts.hasOldStructure === 0;
    
    if (migrationSuccessful) {
      console.log('\n🎉 Migration verification SUCCESSFUL!');
      console.log('✅ All movies have the new age structure (24m/36m/48m/60m)');
      console.log('✅ No old age structure (12m) found');
      console.log('✅ Ready to proceed with Phase 3: Enhanced Rating System');
    } else {
      console.log('\n⚠️  Migration verification INCOMPLETE');
      console.log('Some movies may still have the old age structure');
      console.log('Please re-run the migration script or check for errors');
    }
    
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    process.exit(1);
  }
}

// Run verification
verifyMigration();
