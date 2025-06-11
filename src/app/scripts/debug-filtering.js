import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const specificMovieTitle = process.argv[2];
console.log('Specific movie title:', specificMovieTitle);

let query = supabase
  .from('movies')
  .select(`
    id, 
    title,
    subtitles(subtitle_text),
    scenes(id)
  `)
  .not('subtitles', 'is', null);

if (specificMovieTitle) {
  query = query.ilike('title', `%${specificMovieTitle}%`);
}

const { data: movies, error } = await query;

console.log('Found movies:', movies?.length);
console.log('Movie titles:', movies?.map(m => m.title));

const moviesForAnalysis = movies.filter(movie => {
  const hasSubtitles = movie.subtitles && movie.subtitles.length > 0;
  const hasScenes = movie.scenes && movie.scenes.length > 0;
  
  if (specificMovieTitle) {
    return hasSubtitles;
  } else {
    return hasSubtitles && !hasScenes;
  }
});

console.log('Movies for analysis:', moviesForAnalysis?.length);
console.log('Analysis titles:', moviesForAnalysis?.map(m => m.title)); 