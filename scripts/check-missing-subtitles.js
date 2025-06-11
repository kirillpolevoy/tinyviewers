import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkMissingSubtitles() {
  const { data: movies } = await supabase
    .from('movies')
    .select(`
      id, 
      title, 
      imdb_id,
      subtitles(id)
    `)
    .not('imdb_id', 'is', null);

  const moviesWithoutSubtitles = movies.filter(movie => 
    !movie.subtitles || movie.subtitles.length === 0
  );

  console.log('Movies without subtitles (first 15):');
  moviesWithoutSubtitles.slice(0, 15).forEach((movie, i) => {
    console.log(`${i+1}. ${movie.title}`);
  });
  
  console.log(`\nTotal missing: ${moviesWithoutSubtitles.length} out of ${movies.length}`);
  console.log(`Missing percentage: ${((moviesWithoutSubtitles.length / movies.length) * 100).toFixed(1)}%`);
}

checkMissingSubtitles(); 