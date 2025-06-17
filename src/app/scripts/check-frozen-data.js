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

async function checkFrozenData() {
  console.log('🔍 Checking Frozen movie data...\n');

  try {
    // Get Frozen movie data
    const { data: movie, error } = await supabase
      .from('movies')
      .select(`
        id,
        title,
        age_scores,
        scenes(id, timestamp_start, timestamp_end, description, intensity, age_flags, tags)
      `)
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
    console.log('  Age Scores:', JSON.stringify(movie.age_scores, null, 2));
    console.log('  Scenes Count:', movie.scenes?.length || 0);

    if (movie.scenes && movie.scenes.length > 0) {
      console.log('\n🎭 Scenes:');
      movie.scenes.forEach((scene, index) => {
        console.log(`\n  Scene ${index + 1}:`);
        console.log(`    Time: ${scene.timestamp_start} - ${scene.timestamp_end}`);
        console.log(`    Intensity: ${scene.intensity}`);
        console.log(`    Age Flags:`, JSON.stringify(scene.age_flags, null, 4));
        console.log(`    Tags:`, scene.tags);
        console.log(`    Description: ${scene.description}`);
      });
    } else {
      console.log('\n❌ No scenes found');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkFrozenData(); 