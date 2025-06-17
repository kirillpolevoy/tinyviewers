import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

console.log('🚀 SUBTITLE DATA TEST SCRIPT');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

console.log('✅ Environment loaded successfully');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testSubtitleData() {
  try {
    const movieId = 'e7f8a9b0-c1d2-4345-e7f8-a9b0c1d23460';
    
    console.log(`🎬 Testing movie: ${movieId}`);
    
    // Get movie info
    const { data: movie, error: movieError } = await supabase
      .from('movies')
      .select('title')
      .eq('id', movieId)
      .single();
    
    if (movieError) {
      console.log('❌ Movie error:', movieError);
      return false;
    }
    
    console.log(`📽️  Movie: ${movie.title}`);
    
    // Get subtitles
    const { data: subtitle, error: subtitleError } = await supabase
      .from('subtitles')
      .select('subtitle_text')
      .eq('movie_id', movieId)
      .single();
    
    if (subtitleError) {
      console.log('❌ Subtitle error:', subtitleError);
      return false;
    }
    
    console.log(`📝 Subtitle data found (${subtitle.subtitle_text.length} chars)`);
    console.log(`📝 First 200 chars: ${subtitle.subtitle_text.substring(0, 200)}...`);
    
    // Check if it's corrupted HTML
    if (subtitle.subtitle_text.includes('<!DOCTYPE html>')) {
      console.log('❌ Corrupted HTML subtitle data detected');
      console.log('🔍 This is the YTS-Subs.com corruption issue we found earlier');
      return false;
    } else {
      console.log('✅ Subtitle appears to be valid');
      return true;
    }
    
  } catch (error) {
    console.log('💥 Error:', error.message);
    return false;
  }
}

// Run the test
console.log('🎯 Starting subtitle data test...');
const success = await testSubtitleData();

if (success) {
  console.log('🎉 Subtitle data is valid! Ready for Claude analysis.');
} else {
  console.log('❌ Subtitle data is corrupted or missing. Need to fix subtitle data first.');
} 