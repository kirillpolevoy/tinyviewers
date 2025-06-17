import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '..', '..', '.env.local');
dotenv.config({ path: envPath });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkFrozenIMDB() {
  console.log('🔍 Checking Frozen IMDB ID...\n');

  try {
    // Get Frozen movie
    const { data: movie, error } = await supabase
      .from('movies')
      .select('id, title, imdb_id, release_year')
      .ilike('title', '%Frozen%')
      .not('title', 'ilike', '%II%') // Exclude Frozen II
      .single();

    if (error) {
      console.error('❌ Error fetching movie:', error);
      return;
    }

    if (!movie) {
      console.log('❌ Frozen movie not found');
      return;
    }

    console.log('🎬 Movie Details:');
    console.log('  Title:', movie.title);
    console.log('  ID:', movie.id);
    console.log('  IMDB ID:', movie.imdb_id);
    console.log('  Release Year:', movie.release_year);

    // The correct IMDB ID for Disney's Frozen (2013) should be tt2294629
    const correctIMDB = 'tt2294629';
    
    if (movie.imdb_id === correctIMDB) {
      console.log('✅ IMDB ID is correct for Disney Frozen (2013)');
    } else {
      console.log('❌ IMDB ID is wrong!');
      console.log('   Current:', movie.imdb_id);
      console.log('   Should be:', correctIMDB);
      console.log('   This explains why wrong subtitles are being downloaded');
    }

    // Check what movie the current IMDB ID actually refers to
    if (movie.imdb_id && movie.imdb_id !== correctIMDB) {
      console.log('\n🔍 Current IMDB ID refers to a different movie');
      console.log('   This is likely why we got wrong subtitles');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkFrozenIMDB(); 