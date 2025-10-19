import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function runMigration() {
  console.log('🚀 Running analysis_history table migration...');
  
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
    // Create the analysis_history table using direct SQL
    console.log('📄 Creating analysis_history table...');
    
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS public.analysis_history (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        movie_id UUID NOT NULL REFERENCES public.movies(id) ON DELETE CASCADE,
        age_scores JSONB NOT NULL,
        overall_scary_score INTEGER,
        scenes_count INTEGER NOT NULL DEFAULT 0,
        model_used TEXT NOT NULL DEFAULT 'Claude 3.5 Haiku',
        analysis_duration_ms INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
      );
    `;
    
    // Use the SQL editor approach - we'll need to run this manually in Supabase
    console.log('📋 Please run this SQL in your Supabase SQL Editor:');
    console.log('='.repeat(80));
    console.log(createTableSQL);
    console.log('='.repeat(80));
    
    // Test if table already exists
    console.log('🧪 Testing if table exists...');
    const { data, error: testError } = await supabase
      .from('analysis_history')
      .select('count')
      .limit(1);
    
    if (testError) {
      console.log('❌ Table does not exist yet - please run the SQL above in Supabase');
      console.log('Error:', testError.message);
    } else {
      console.log('✅ Table already exists and is accessible');
    }
    
  } catch (error) {
    console.error('❌ Migration error:', error);
  }
}

// Run the migration
runMigration();