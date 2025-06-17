import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const movieId = process.argv[2] || 'e1f2a3b4-c5d6-4789-e1f2-a3b4c5d67893';

console.log('🔍 Looking up movie:', movieId);

const { data: movie, error } = await supabase
  .from('movies')
  .select(`
    id,
    title,
    release_year,
    imdb_id,
    subtitles(subtitle_text, source),
    scenes(id, description, created_at)
  `)
  .eq('id', movieId)
  .single();

if (error) {
  console.error('❌ Error:', error);
} else if (movie) {
  console.log('\n🎬 Movie Details:');
  console.log('  Title:', movie.title);
  console.log('  Year:', movie.release_year);
  console.log('  IMDB ID:', movie.imdb_id);
  console.log('  Subtitles:', movie.subtitles?.length || 0, 'found');
  
  if (movie.subtitles?.[0]) {
    console.log('    Source:', movie.subtitles[0].source);
    console.log('    Length:', movie.subtitles[0].subtitle_text?.length?.toLocaleString() || 0, 'chars');
    console.log('    Preview:', movie.subtitles[0].subtitle_text?.substring(0, 200) + '...');
  }
  
  console.log('  Scenes:', movie.scenes?.length || 0, 'found');
  if (movie.scenes?.[0]) {
    console.log('    Latest:', movie.scenes[0].created_at);
    console.log('    Sample:', movie.scenes[0].description?.substring(0, 100) + '...');
  }
} else {
  console.log('❌ Movie not found');
} 