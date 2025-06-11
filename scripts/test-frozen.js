import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

console.log('🎯 TESTING FROZEN FILTERING - SCRIPT VERSION 1.0');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const specificMovieTitle = process.argv[2];
console.log('🔍 Movie to analyze:', specificMovieTitle);

if (!specificMovieTitle) {
  console.log('❌ Please provide a movie title as argument');
  process.exit(1);
}

console.log('🎬 Environment variables check:');
console.log('- SUPABASE_URL:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log('- SUPABASE_SERVICE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log('- CLAUDE_API_KEY:', !!process.env.CLAUDE_API_KEY);

// Get movies with subtitles
let query = supabase
  .from('movies')
  .select(`
    id, 
    title,
    subtitles(subtitle_text),
    scenes(id)
  `)
  .not('subtitles', 'is', null);

// Add specific movie filter if provided
query = query.ilike('title', `%${specificMovieTitle}%`);

const { data: movies, error } = await query;

if (error) {
  console.error('❌ Database error:', error);
  process.exit(1);
}

console.log(`🎭 Found ${movies?.length || 0} movies matching "${specificMovieTitle}"`);
console.log('🎬 Movie titles:', movies?.map(m => m.title));

// Filter for movies that have subtitles and allow re-analysis
const moviesForAnalysis = movies.filter(movie => {
  const hasSubtitles = movie.subtitles && movie.subtitles.length > 0;
  return hasSubtitles;
});

console.log(`📊 Movies ready for analysis: ${moviesForAnalysis.length}`);
console.log('📝 Analysis list:', moviesForAnalysis.map(m => ({ 
  title: m.title, 
  hasSubtitles: !!m.subtitles?.length,
  hasScenes: !!m.scenes?.length,
  subtitleLength: m.subtitles?.[0]?.subtitle_text?.length || 0
})));

console.log('✅ Frozen filtering test complete!'); 