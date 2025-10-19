#!/usr/bin/env node

/**
 * Test script to verify what's happening with the production API
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

console.log('🔍 Testing Production API vs Database:');
console.log(`URL: ${supabaseUrl}`);
console.log(`Key: ${supabaseServiceKey ? 'Present' : 'Missing'}`);
console.log('');

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testProduction() {
  try {
    // Test the API first
    console.log('🌐 Testing Production API...');
    const response = await fetch('https://tinyviewers.vercel.app/api/movies/movie?id=43ef52c6-3e09-4e5c-a104-f9a796e66e4d');
    const apiData = await response.json();
    
    console.log(`API Response Age Scores: ${JSON.stringify(apiData.movie.age_scores)}`);
    
    // Test the database directly
    console.log('\n📊 Testing Database Directly...');
    const { data: dbData, error: dbError } = await supabase
      .from('movies')
      .select('id, title, age_scores')
      .eq('id', '43ef52c6-3e09-4e5c-a104-f9a796e66e4d')
      .single();
    
    if (dbError) {
      console.error('❌ Database query failed:', dbError.message);
      return;
    }
    
    console.log(`Database Age Scores: ${JSON.stringify(dbData.age_scores)}`);
    
    // Compare
    console.log('\n🔍 Comparison:');
    if (JSON.stringify(dbData.age_scores) === JSON.stringify(apiData.movie.age_scores)) {
      console.log('✅ API matches database');
    } else {
      console.log('❌ API does not match database');
      console.log('Database:', JSON.stringify(dbData.age_scores));
      console.log('API:', JSON.stringify(apiData.movie.age_scores));
    }
    
    // Let's also check if there are multiple records
    console.log('\n🔍 Checking for multiple records...');
    const { data: allRecords, error: allError } = await supabase
      .from('movies')
      .select('id, title, age_scores')
      .ilike('title', '%nemo%');
    
    if (allError) {
      console.error('❌ Multiple records query failed:', allError.message);
    } else {
      console.log(`Found ${allRecords.length} Nemo records:`);
      allRecords.forEach((record, index) => {
        console.log(`${index + 1}. ID: ${record.id}, Title: ${record.title}`);
        console.log(`   Age Scores: ${JSON.stringify(record.age_scores)}`);
      });
    }
    
    // Let's try to update the record and see if it affects the API
    console.log('\n🔧 Testing update and API response...');
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
    
    // Wait a moment and test API again
    console.log('\n⏳ Waiting 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('🌐 Testing API again...');
    const response2 = await fetch('https://tinyviewers.vercel.app/api/movies/movie?id=43ef52c6-3e09-4e5c-a104-f9a796e66e4d');
    const apiData2 = await response2.json();
    
    console.log(`API Response Age Scores (after update): ${JSON.stringify(apiData2.movie.age_scores)}`);
    
    if (JSON.stringify(apiData2.movie.age_scores) === JSON.stringify(apiData.movie.age_scores)) {
      console.log('❌ API still returns old data - there might be caching or a different database');
    } else {
      console.log('✅ API now returns updated data');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testProduction();
