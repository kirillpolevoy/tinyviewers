require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debug() {
  console.log('🔍 Debugging force re-analysis selection...\n');
  
  const { data: movies } = await supabase
    .from('movies')
    .select(`
      id, 
      title,
      subtitles(subtitle_text),
      scenes(id)
    `)
    .not('subtitles', 'is', null)
    .order('title')
    .limit(15);
  
  console.log('Movies with subtitles (ordered by title):');
  movies.forEach((movie, i) => {
    const hasSubtitles = movie.subtitles && movie.subtitles.length > 0;
    const hasScenes = movie.scenes && movie.scenes.length > 0;
    const sceneCount = movie.scenes?.length || 0;
    
    // This is the filter logic for force re-analysis
    const wouldBeSelected = hasSubtitles && hasScenes;
    
    console.log(`${i+1}. ${movie.title}`);
    console.log(`   Subtitles: ${hasSubtitles ? '✅' : '❌'}`);
    console.log(`   Scenes: ${sceneCount} ${hasScenes ? '✅' : '❌'}`);
    console.log(`   Selected for force re-analysis: ${wouldBeSelected ? '✅' : '❌'}`);
    console.log('');
  });
}

debug().catch(console.error); 