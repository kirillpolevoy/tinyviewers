#!/usr/bin/env node

/**
 * Debug script to understand the production database issue
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

console.log('🔍 Debug Information:');
console.log(`Supabase URL: ${supabaseUrl}`);
console.log(`Service Key: ${supabaseServiceKey ? 'Present' : 'Missing'}`);
console.log('');

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function debugProduction() {
  try {
    // Query Finding Nemo directly
    console.log('📊 Querying Finding Nemo directly from database:');
    const { data: nemo, error: nemoError } = await supabase
      .from('movies')
      .select('id, title, age_scores, created_at')
      .ilike('title', '%nemo%')
      .single();
    
    if (nemoError) {
      console.error('❌ Error querying Nemo:', nemoError.message);
      return;
    }
    
    console.log(`ID: ${nemo.id}`);
    console.log(`Title: ${nemo.title}`);
    console.log(`Age Scores: ${JSON.stringify(nemo.age_scores)}`);
    console.log(`Created: ${nemo.created_at}`);
    console.log('');
    
    // Also check if there are multiple Nemo records
    console.log('🔍 Checking for multiple Nemo records:');
    const { data: allNemos, error: allNemosError } = await supabase
      .from('movies')
      .select('id, title, age_scores')
      .ilike('title', '%nemo%');
    
    if (allNemosError) {
      console.error('❌ Error querying all Nemos:', allNemosError.message);
    } else {
      console.log(`Found ${allNemos.length} Nemo records:`);
      allNemos.forEach((movie, index) => {
        console.log(`${index + 1}. ID: ${movie.id}, Title: ${movie.title}`);
        console.log(`   Age Scores: ${JSON.stringify(movie.age_scores)}`);
      });
    }
    
    // Check the specific ID that the API is using
    console.log('');
    console.log('🎯 Checking specific ID from API:');
    const apiId = '43ef52c6-3e09-4e5c-a104-f9a796e66e4d';
    const { data: apiMovie, error: apiError } = await supabase
      .from('movies')
      .select('id, title, age_scores')
      .eq('id', apiId)
      .single();
    
    if (apiError) {
      console.error('❌ Error querying API ID:', apiError.message);
    } else {
      console.log(`API ID: ${apiMovie.id}`);
      console.log(`Title: ${apiMovie.title}`);
      console.log(`Age Scores: ${JSON.stringify(apiMovie.age_scores)}`);
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  }
}

debugProduction();
