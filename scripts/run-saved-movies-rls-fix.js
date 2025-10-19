import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function fixSavedMoviesRLS() {
  console.log('🔧 Fixing saved_movies RLS policies...');

  // Check environment variables
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing required environment variables');
    console.error('NEXT_PUBLIC_SUPABASE_URL:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
    console.error('SUPABASE_SERVICE_ROLE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
    return;
  }

  // Initialize Supabase client
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // Read the SQL file
    const sqlContent = fs.readFileSync('scripts/fix-saved-movies-rls.sql', 'utf8');
    
    console.log('📄 Running RLS policy fixes...');
    console.log('SQL Content:');
    console.log('='.repeat(80));
    console.log(sqlContent);
    console.log('='.repeat(80));

    // Test if we can access the saved_movies table
    console.log('🧪 Testing saved_movies table access...');
    const { data, error: testError } = await supabase
      .from('saved_movies')
      .select('count')
      .limit(1);

    if (testError) {
      console.log('❌ Table access test failed:', testError.message);
      console.log('📋 Please run the SQL above in your Supabase SQL Editor to fix the RLS policies');
    } else {
      console.log('✅ Table is accessible');
    }

    // Try to run the SQL using the service role
    console.log('🚀 Attempting to run SQL via service role...');
    try {
      const { data: result, error: sqlError } = await supabase.rpc('exec', { 
        sql: sqlContent 
      });
      
      if (sqlError) {
        console.log('❌ SQL execution failed:', sqlError.message);
        console.log('📋 Please run the SQL manually in Supabase SQL Editor');
      } else {
        console.log('✅ SQL executed successfully:', result);
      }
    } catch (rpcError) {
      console.log('❌ RPC execution failed:', rpcError);
      console.log('📋 Please run the SQL manually in Supabase SQL Editor');
    }

  } catch (error) {
    console.error('❌ Migration error:', error);
  }
}

// Run the migration
fixSavedMoviesRLS();
