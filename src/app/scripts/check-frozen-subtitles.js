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

async function checkFrozenSubtitles() {
  console.log('🔍 Checking Frozen subtitle data...\n');

  try {
    // Get Frozen movie with subtitles
    const { data: movie, error } = await supabase
      .from('movies')
      .select(`
        id,
        title,
        subtitles(subtitle_text, source, language)
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
    console.log('  Subtitles Count:', movie.subtitles?.length || 0);

    if (movie.subtitles && movie.subtitles.length > 0) {
      const subtitle = movie.subtitles[0];
      console.log('\n📄 Subtitle Details:');
      console.log('  Source:', subtitle.source);
      console.log('  Language:', subtitle.language);
      console.log('  Length:', subtitle.subtitle_text?.length || 0, 'characters');
      
      console.log('\n📝 Subtitle Preview (first 1000 chars):');
      console.log(subtitle.subtitle_text?.substring(0, 1000));
      
      console.log('\n🔍 Looking for Frozen-specific content...');
      const text = subtitle.subtitle_text?.toLowerCase() || '';
      
      const frozenKeywords = ['elsa', 'anna', 'olaf', 'kristoff', 'sven', 'arendelle', 'frozen', 'snow', 'ice'];
      const foundKeywords = frozenKeywords.filter(keyword => text.includes(keyword));
      
      console.log('  Frozen keywords found:', foundKeywords);
      
      if (foundKeywords.length === 0) {
        console.log('  ⚠️  No Frozen-specific keywords found! This might be the wrong movie.');
      }
      
      // Check for the "Dan" character that appeared in the analysis
      if (text.includes('dan')) {
        console.log('  ❌ Found "Dan" character - this is definitely NOT Frozen!');
      }
      
      // Check for chairlift/wolf content
      if (text.includes('chairlift') || text.includes('wolf')) {
        console.log('  ❌ Found chairlift/wolf content - this is NOT Frozen!');
      }
      
    } else {
      console.log('\n❌ No subtitles found');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkFrozenSubtitles(); 