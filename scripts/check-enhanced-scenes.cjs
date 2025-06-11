require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkEnhancedScenes() {
  // Get Frozen II movie ID
  const { data: movie } = await supabase
    .from('movies')
    .select('id, title')
    .ilike('title', '%Frozen II%')
    .single();
    
  if (!movie) {
    console.log('❌ Frozen II not found');
    return;
  }
  
  // Get scenes
  const { data: scenes } = await supabase
    .from('scenes')
    .select('timestamp_start, timestamp_end, description, intensity, tags')
    .eq('movie_id', movie.id)
    .order('timestamp_start');
    
  console.log('🎬 Enhanced Frozen II Scene Analysis Results:');
  console.log('=' + '='.repeat(79));
  console.log(`Movie: ${movie.title}`);
  console.log(`Scenes found: ${scenes?.length || 0}\n`);
  
  if (scenes) {
    scenes.forEach((scene, i) => {
      console.log(`${i+1}. ${scene.timestamp_start} - ${scene.timestamp_end} (Intensity: ${scene.intensity})`);
      console.log(`Tags: ${scene.tags?.join(', ') || 'None'}`);
      console.log(`Description: ${scene.description}`);
      console.log('-'.repeat(80));
    });
  }
}

checkEnhancedScenes().catch(console.error); 