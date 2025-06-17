import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('🔍 Testing today\'s analysis detection...');

const today = new Date().toISOString().split('T')[0];
console.log(`📅 Today: ${today}`);

const { data: todaysScenes, error } = await supabase
  .from('scenes')
  .select(`
    movie_id, 
    created_at,
    movies(title)
  `)
  .gte('created_at', today + 'T00:00:00')
  .order('created_at', { ascending: false });

if (error) {
  console.error('❌ Error:', error);
} else {
  console.log(`📊 Found ${todaysScenes?.length || 0} scenes created today`);
  
  if (todaysScenes?.length > 0) {
    const uniqueMovies = [...new Set(todaysScenes.map(s => s.movies?.title))].filter(Boolean);
    console.log(`🎬 ${uniqueMovies.length} unique movies analyzed today:`);
    
    uniqueMovies.slice(0, 5).forEach((title, i) => {
      console.log(`   ${i+1}. "${title}"`);
    });
    
    if (uniqueMovies.length > 5) {
      console.log(`   ... and ${uniqueMovies.length - 5} more`);
    }
    
    console.log('\n✅ Today\'s analysis detection is working!');
    console.log('💡 The bulk analysis script will skip these movies.');
  } else {
    console.log('✅ No movies analyzed today - all movies will be eligible for analysis.');
  }
} 