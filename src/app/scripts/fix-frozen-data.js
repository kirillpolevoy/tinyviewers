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

async function fixFrozenData() {
  console.log('🔧 Fixing Frozen movie data...\n');

  try {
    // Get Frozen movie
    const { data: movie, error } = await supabase
      .from('movies')
      .select('id, title')
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

    console.log('🎬 Found movie:', movie.title, '(ID:', movie.id, ')');

    // Delete incorrect scenes
    console.log('🗑️  Deleting incorrect scenes...');
    const { error: deleteScenesError } = await supabase
      .from('scenes')
      .delete()
      .eq('movie_id', movie.id);

    if (deleteScenesError) {
      console.error('❌ Error deleting scenes:', deleteScenesError);
      return;
    }
    console.log('✅ Deleted incorrect scenes');

    // Delete incorrect subtitles
    console.log('🗑️  Deleting incorrect subtitles...');
    const { error: deleteSubtitlesError } = await supabase
      .from('subtitles')
      .delete()
      .eq('movie_id', movie.id);

    if (deleteSubtitlesError) {
      console.error('❌ Error deleting subtitles:', deleteSubtitlesError);
      return;
    }
    console.log('✅ Deleted incorrect subtitles');

    // Reset age scores to empty object
    console.log('🔄 Resetting age scores...');
    const { error: updateError } = await supabase
      .from('movies')
      .update({ age_scores: {} })
      .eq('id', movie.id);

    if (updateError) {
      console.error('❌ Error resetting age scores:', updateError);
      return;
    }
    console.log('✅ Reset age scores');

    console.log('\n🎉 Frozen data fixed!');
    console.log('📝 Next steps:');
    console.log('   1. Re-scrape correct subtitles for Frozen');
    console.log('   2. Re-run Claude analysis with correct data');
    console.log('   3. Verify the analysis contains Frozen characters (Elsa, Anna, etc.)');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

fixFrozenData(); 