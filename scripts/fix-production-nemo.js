#!/usr/bin/env node

/**
 * Fix Finding Nemo in production database
 * This script will connect to the production Supabase and fix Nemo's scores
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

async function fixProductionNemo() {
  console.log('🔧 Fixing Finding Nemo in production database...\n');
  console.log(`📡 Connecting to: ${supabaseUrl}\n`);
  
  try {
    // First, let's see what we're working with
    console.log('📊 Current Production State:');
    const { data: nemo, error: nemoError } = await supabase
      .from('movies')
      .select('title, age_scores')
      .ilike('title', '%nemo%')
      .single();
    
    if (nemoError) {
      throw new Error(`Failed to query Nemo: ${nemoError.message}`);
    }
    
    console.log(`Movie: ${nemo.title}`);
    console.log(`Current scores: 24m: ${nemo.age_scores['24m']}, 36m: ${nemo.age_scores['36m']}, 48m: ${nemo.age_scores['48m']}, 60m: ${nemo.age_scores['60m']}`);
    
    // Check if it needs fixing
    if (nemo.age_scores['48m'] === nemo.age_scores['36m'] && nemo.age_scores['60m'] === nemo.age_scores['36m']) {
      console.log('❌ ISSUE: 48m and 60m identical to 36m - needs fixing');
    } else {
      console.log('✅ Progression looks correct');
    }
    
    // Apply the fix
    console.log('\n🔧 Applying fix...');
    const { error: updateError } = await supabase
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
    
    if (updateError) {
      throw new Error(`Failed to update Nemo: ${updateError.message}`);
    }
    
    console.log('✅ Fixed Finding Nemo with realistic scores');
    
    // Verify the fix
    console.log('\n📊 Final Production State:');
    const { data: finalNemo, error: finalError } = await supabase
      .from('movies')
      .select('title, age_scores')
      .ilike('title', '%nemo%')
      .single();
    
    if (finalError) {
      console.log('⚠️  Could not verify final state');
    } else {
      console.log(`Movie: ${finalNemo.title}`);
      console.log(`Final scores: 24m: ${finalNemo.age_scores['24m']}, 36m: ${finalNemo.age_scores['36m']}, 48m: ${finalNemo.age_scores['48m']}, 60m: ${finalNemo.age_scores['60m']}`);
      
      // Check if progression makes sense
      const progression = [finalNemo.age_scores['24m'], finalNemo.age_scores['36m'], finalNemo.age_scores['48m'], finalNemo.age_scores['60m']];
      const isProgressive = progression.every((score, i) => i === 0 || score <= progression[i-1]);
      
      if (isProgressive) {
        console.log('✅ Perfect progression: 3→2→1→1');
      } else {
        console.log('⚠️  Progression could be better');
      }
    }
    
    console.log('\n🎉 Production Fix Complete!');
    console.log('🔄 Next: Refresh your production app to see the changes');
    
  } catch (error) {
    console.error('❌ Production fix failed:', error.message);
    process.exit(1);
  }
}

// Run the fix
fixProductionNemo();
