import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function testSavedMoviesAccess() {
  console.log('🧪 Testing saved_movies table access and RLS policies...');

  // Check environment variables
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing required environment variables');
    return;
  }

  // Initialize Supabase client
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // Test 1: Check if table exists and is accessible
    console.log('📋 Test 1: Checking table existence...');
    const { data: tableData, error: tableError } = await supabase
      .from('saved_movies')
      .select('count')
      .limit(1);

    if (tableError) {
      console.log('❌ Table access failed:', tableError.message);
      return;
    } else {
      console.log('✅ Table is accessible');
    }

    // Test 2: Check current RLS policies
    console.log('📋 Test 2: Checking RLS policies...');
    const { data: policiesData, error: policiesError } = await supabase
      .rpc('get_table_policies', { table_name: 'saved_movies' });

    if (policiesError) {
      console.log('⚠️  Could not fetch policies (this is normal):', policiesError.message);
    } else {
      console.log('📋 Current policies:', policiesData);
    }

    // Test 3: Try to insert a test record (this should fail with 406 if RLS is misconfigured)
    console.log('📋 Test 3: Testing insert operation...');
    const testUserId = '00000000-0000-0000-0000-000000000000'; // Dummy UUID
    const testMovieId = '00000000-0000-0000-0000-000000000001'; // Dummy UUID
    
    const { data: insertData, error: insertError } = await supabase
      .from('saved_movies')
      .insert({
        user_id: testUserId,
        movie_id: testMovieId
      });

    if (insertError) {
      console.log('❌ Insert test failed:', insertError.message);
      if (insertError.code === '42501') {
        console.log('🔍 This is a permission error - RLS policies need to be fixed');
      }
    } else {
      console.log('✅ Insert test succeeded');
      // Clean up the test record
      await supabase
        .from('saved_movies')
        .delete()
        .eq('user_id', testUserId)
        .eq('movie_id', testMovieId);
    }

    console.log('\n📋 Summary:');
    console.log('- Table exists and is accessible');
    console.log('- RLS policies may need manual configuration in Supabase SQL Editor');
    console.log('- Please run the SQL from scripts/fix-saved-movies-rls.sql in Supabase');

  } catch (error) {
    console.error('❌ Test error:', error);
  }
}

// Run the test
testSavedMoviesAccess();
