#!/usr/bin/env node

/**
 * Test script to verify production database connection
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

console.log('🔍 Testing Production Database Connection:');
console.log(`URL: ${supabaseUrl}`);
console.log(`Key: ${supabaseServiceKey ? 'Present' : 'Missing'}`);
console.log('');

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testConnection() {
  try {
    // Test basic connection
    console.log('📡 Testing basic connection...');
    const { data, error } = await supabase
      .from('movies')
      .select('count')
      .limit(1);
    
    if (error) {
      console.error('❌ Connection failed:', error.message);
      return;
    }
    
    console.log('✅ Connection successful');
    
    // Test Finding Nemo specifically
    console.log('\n🎯 Testing Finding Nemo query...');
    const { data: nemo, error: nemoError } = await supabase
      .from('movies')
      .select('id, title, age_scores')
      .eq('id', '43ef52c6-3e09-4e5c-a104-f9a796e66e4d')
      .single();
    
    if (nemoError) {
      console.error('❌ Nemo query failed:', nemoError.message);
      return;
    }
    
    console.log('✅ Nemo query successful');
    console.log(`Title: ${nemo.title}`);
    console.log(`Age Scores: ${JSON.stringify(nemo.age_scores)}`);
    
    // Now let's try to update it and see if it sticks
    console.log('\n🔧 Testing update...');
    const { error: updateError } = await supabase
      .from('movies')
      .update({ 
        age_scores: {
          '24m': 3,
          '36m': 2,
          '48m': 1,
          '60m': 1
        }
      })
      .eq('id', '43ef52c6-3e09-4e5c-a104-f9a796e66e4d');
    
    if (updateError) {
      console.error('❌ Update failed:', updateError.message);
      return;
    }
    
    console.log('✅ Update successful');
    
    // Verify the update
    console.log('\n🔍 Verifying update...');
    const { data: updatedNemo, error: verifyError } = await supabase
      .from('movies')
      .select('id, title, age_scores')
      .eq('id', '43ef52c6-3e09-4e5c-a104-f9a796e66e4d')
      .single();
    
    if (verifyError) {
      console.error('❌ Verification failed:', verifyError.message);
      return;
    }
    
    console.log('✅ Verification successful');
    console.log(`Updated Age Scores: ${JSON.stringify(updatedNemo.age_scores)}`);
    
    // Now test the API
    console.log('\n🌐 Testing production API...');
    const response = await fetch('https://tinyviewers.vercel.app/api/movies/movie?id=43ef52c6-3e09-4e5c-a104-f9a796e66e4d');
    const apiData = await response.json();
    
    console.log(`API Response Age Scores: ${JSON.stringify(apiData.movie.age_scores)}`);
    
    if (JSON.stringify(updatedNemo.age_scores) === JSON.stringify(apiData.movie.age_scores)) {
      console.log('✅ API matches database');
    } else {
      console.log('❌ API does not match database');
      console.log('Database:', JSON.stringify(updatedNemo.age_scores));
      console.log('API:', JSON.stringify(apiData.movie.age_scores));
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testConnection();
