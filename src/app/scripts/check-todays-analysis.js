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

async function checkTodaysAnalysis() {
  console.log('🔍 Checking for movies analyzed today...\n');
  
  // Check for scenes created today
  const today = new Date().toISOString().split('T')[0];
  console.log(`📅 Today's date: ${today}`);
  
  const { data: recentScenes, error } = await supabase
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
    return;
  }

  console.log(`📊 Found ${recentScenes?.length || 0} scenes created today\n`);
  
  if (recentScenes?.length > 0) {
    // Group by movie
    const movieScenes = {};
    recentScenes.forEach(scene => {
      const movieTitle = scene.movies?.title;
      if (movieTitle) {
        if (!movieScenes[movieTitle]) {
          movieScenes[movieTitle] = [];
        }
        movieScenes[movieTitle].push(scene);
      }
    });
    
    const uniqueMovies = Object.keys(movieScenes);
    console.log(`🎬 ${uniqueMovies.length} unique movies analyzed today:`);
    
    uniqueMovies.forEach((title, i) => {
      const sceneCount = movieScenes[title].length;
      const latestTime = movieScenes[title][0].created_at.split('T')[1].split('.')[0];
      console.log(`   ${i+1}. "${title}" - ${sceneCount} scenes (latest: ${latestTime})`);
    });
    
    console.log('\n📋 Movie IDs analyzed today:');
    const movieIds = [...new Set(recentScenes.map(s => s.movie_id))];
    console.log('[');
    movieIds.forEach((id, i) => {
      console.log(`  '${id}'${i < movieIds.length - 1 ? ',' : ''}`);
    });
    console.log(']');
    
  } else {
    console.log('✅ No movies have been analyzed today yet.');
  }
}

checkTodaysAnalysis().catch(console.error); 