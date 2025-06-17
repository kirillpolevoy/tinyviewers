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

async function fixFrozenIMDB() {
  console.log('🔧 Fixing Frozen IMDB ID...\n');

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

    console.log('🎬 Current movie details:');
    console.log('  Title:', movie.title);
    console.log('  Current IMDB ID:', movie.imdb_id);
    console.log('  Release Year:', movie.release_year);

    // The correct IMDB ID for Disney's Frozen (2013)
    const correctIMDB = 'tt2294629';
    
    if (movie.imdb_id === correctIMDB) {
      console.log('✅ IMDB ID is already correct');
      return;
    }

    console.log('\n🔄 Updating IMDB ID...');
    console.log('   From:', movie.imdb_id);
    console.log('   To:', correctIMDB);

    // Update the IMDB ID
    const { error: updateError } = await supabase
      .from('movies')
      .update({ 
        imdb_id: correctIMDB,
        release_year: 2013 // Also fix the release year
      })
      .eq('id', movie.id);

    if (updateError) {
      console.error('❌ Error updating IMDB ID:', updateError);
      return;
    }

    console.log('✅ Successfully updated IMDB ID and release year');
    console.log('\n📝 Next steps:');
    console.log('   1. Re-scrape subtitles for Frozen (will now get correct Disney movie)');
    console.log('   2. Re-run Claude analysis with correct subtitles');
    console.log('   3. Verify the analysis contains Frozen characters (Elsa, Anna, Olaf, etc.)');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

fixFrozenIMDB(); 