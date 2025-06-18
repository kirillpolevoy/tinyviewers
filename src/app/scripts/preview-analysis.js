import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env.local');
dotenv.config({ path: envPath });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function countMovies() {
  console.log('🔍 Checking how many movies will be processed...\n');
  
  // Get all active movies (same query as the updated script)
  const { data: movies, error } = await supabase
    .from('movies')
    .select('id, title, subtitles(subtitle_text), scenes(id)')
    .eq('is_active', true);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log('📊 ANALYSIS PREVIEW:');
  console.log('Total active movies:', movies?.length || 0);
  
  // Filter for movies with subtitles (same logic as script)
  const moviesWithSubtitles = movies.filter(movie => {
    const hasSubtitles = movie.subtitles && movie.subtitles.length > 0;
    return hasSubtitles;
  });
  
  const moviesWithoutSubtitles = movies.filter(movie => {
    const hasSubtitles = movie.subtitles && movie.subtitles.length > 0;
    return !hasSubtitles;
  });
  
  const moviesWithExistingScenes = moviesWithSubtitles.filter(movie => {
    const hasScenes = movie.scenes && movie.scenes.length > 0;
    return hasScenes;
  });
  
  const moviesWithoutScenes = moviesWithSubtitles.filter(movie => {
    const hasScenes = movie.scenes && movie.scenes.length > 0;
    return !hasScenes;
  });

  console.log('');
  console.log('✅ Movies WITH subtitles (will be processed):', moviesWithSubtitles.length);
  console.log('❌ Movies WITHOUT subtitles (will be skipped):', moviesWithoutSubtitles.length);
  console.log('');
  console.log('📊 Of the movies with subtitles:');
  console.log('  - Already have scenes (will be RE-ANALYZED):', moviesWithExistingScenes.length);
  console.log('  - No scenes yet (new analysis):', moviesWithoutScenes.length);
  console.log('');
  console.log('🎯 TOTAL MOVIES TO PROCESS:', moviesWithSubtitles.length);
  
  if (moviesWithoutSubtitles.length > 0) {
    console.log('');
    console.log('⚠️  Movies without subtitles that will be skipped:');
    moviesWithoutSubtitles.slice(0, 10).forEach(movie => {
      console.log('  -', movie.title);
    });
    if (moviesWithoutSubtitles.length > 10) {
      console.log(`  ... and ${moviesWithoutSubtitles.length - 10} more`);
    }
  }
  
  console.log('');
  console.log('⏱️  Estimated time (at 2 seconds per movie):', Math.ceil(moviesWithSubtitles.length * 2 / 60), 'minutes');
}

countMovies().catch(console.error); 