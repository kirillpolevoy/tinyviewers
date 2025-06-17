import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkSchema() {
  console.log('🔍 Checking actual database schema...\n');
  
  // Check scenes table
  const { data: scenes, error: scenesError } = await supabase
    .from('scenes')
    .select('*')
    .limit(1);
    
  if (scenesError) {
    console.log('❌ Scenes error:', scenesError.message);
  } else if (scenes && scenes.length > 0) {
    console.log('✅ Scenes table columns:', Object.keys(scenes[0]));
    console.log('📋 Sample scene:', scenes[0]);
  } else {
    console.log('📊 No scenes found in database');
  }
  
  // Check movies table
  const { data: movies, error: moviesError } = await supabase
    .from('movies')
    .select('*')
    .limit(1);
    
  if (moviesError) {
    console.log('❌ Movies error:', moviesError.message);
  } else if (movies && movies.length > 0) {
    console.log('\n✅ Movies table columns:', Object.keys(movies[0]));
  }
}

checkSchema().catch(console.error); 