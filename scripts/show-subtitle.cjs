require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function showSubtitle() {
  const { data: movies } = await supabase
    .from('movies')
    .select('title, subtitles(subtitle_text)')
    .ilike('title', '%Frozen II%')
    .limit(1);
    
  if (movies && movies[0] && movies[0].subtitles[0]) {
    const subtitle = movies[0].subtitles[0].subtitle_text;
    console.log('📄 Frozen II Subtitle Sample (first 3000 characters):');
    console.log('='.repeat(60));
    console.log(subtitle.substring(0, 3000));
    console.log('\n' + '='.repeat(60));
    console.log('📊 Total length:', subtitle.length.toLocaleString(), 'characters');
    console.log('📊 Previous truncation at:', (50000).toLocaleString(), 'characters (', Math.round(50000/subtitle.length*100), '% coverage)');
    console.log('📊 New limit at:', (150000).toLocaleString(), 'characters (', Math.round(Math.min(150000, subtitle.length)/subtitle.length*100), '% coverage)');
    
    // Count subtitle segments
    const segments = subtitle.split('\n\n').filter(s => s.trim());
    console.log('📊 Total subtitle segments:', segments.length);
    
    console.log('\n📄 Last 1000 characters (what we were missing):');
    console.log('='.repeat(60));
    console.log(subtitle.substring(subtitle.length - 1000));
  }
}

showSubtitle().catch(console.error); 