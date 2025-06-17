import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Our supposed good movie IDs
const GOOD_SUBTITLE_MOVIE_IDS = [
  'd291ffc8-1bd1-48d2-9fda-addd36e7519c', // Coco
  '2e7d2849-12d1-4905-ac26-05528caf4e54', // Encanto  
  'edc7c965-5141-4582-ab40-156e4ebd0acb', // Maya the Bee Movie
  'cf0c389c-6d66-4319-ab85-fcf161c8e005', // Onward
  '0b90620e-2811-4ce9-b201-932953a7e707', // Paddington
  '89542279-70ca-4873-861a-3d6a9f878248', // Paw Patrol: The Movie
  'd6706193-7db8-4b31-aec1-40fd72288731', // Raya and the Last Dragon
  '3738b1fd-9afc-496f-940f-0d55165fd22e', // The Good Dinosaur
  'fc856d32-7ddd-49d0-8dc4-72daf5cfd56a', // Wish
  'd36094b3-f4ee-4fbe-b5c7-47b69d5ea995', // Zootopia
];

async function checkMoviesNeedingAnalysis() {
  console.log('🔍 Checking which movies actually need Claude analysis...\n');
  
  // Get movies that need processing (have good subtitles but no scenes)
  const { data: movies, error } = await supabase
    .from('movies')
    .select(`
      id, 
      title, 
      release_year,
      subtitles!inner(subtitle_text, source),
      scenes(id)
    `)
    .in('id', GOOD_SUBTITLE_MOVIE_IDS)
    .is('scenes.id', null); // Only movies without existing scenes

  if (error) {
    console.log('❌ Database error:', error.message);
    return;
  }

  console.log(`📊 Found ${movies.length} movies that need Claude analysis:\n`);
  
  movies.forEach((movie, index) => {
    const subtitle = movie.subtitles[0];
    console.log(`${index + 1}. "${movie.title}" (${movie.release_year})`);
    console.log(`   📝 Subtitle: ${subtitle?.subtitle_text?.length || 0} chars from ${subtitle?.source || 'unknown'}`);
    console.log(`   🎭 Scenes: ${movie.scenes?.length || 0}`);
    console.log('');
  });
  
  if (movies.length === 0) {
    console.log('✅ All movies in the good list already have scenes!');
    console.log('🎯 The Claude analysis is already complete for these movies.');
  }
}

checkMoviesNeedingAnalysis().catch(console.error); 