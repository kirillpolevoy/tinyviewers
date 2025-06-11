require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkFullDescription() {
  const { data: movie } = await supabase
    .from('movies')
    .select('id')
    .ilike('title', '%Frozen II%')
    .single();
    
  const { data: scenes } = await supabase
    .from('scenes')
    .select('description, timestamp_start')
    .eq('movie_id', movie.data.id)
    .order('timestamp_start')
    .limit(2);
    
  if (scenes && scenes.length > 0) {
    scenes.forEach((scene, i) => {
      console.log(`Scene ${i+1} (${scene.timestamp_start}):`);
      console.log(`Description length: ${scene.description.length} characters`);
      console.log(`Full description:`);
      console.log(scene.description);
      console.log('-'.repeat(80));
    });
  }
}

checkFullDescription().catch(console.error); 