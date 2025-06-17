const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

console.log('🚀 Script starting...');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('🔗 Client initialized');

async function testMovie() {
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
      return;
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
      return;
    }
    
    console.log(`📝 Subtitle data found (${subtitle.subtitle_text.length} chars)`);
    console.log(`📝 First 200 chars: ${subtitle.subtitle_text.substring(0, 200)}...`);
    
    // Check if it's corrupted HTML
    if (subtitle.subtitle_text.includes('<!DOCTYPE html>')) {
      console.log('❌ Corrupted HTML subtitle data detected');
    } else {
      console.log('✅ Subtitle appears to be valid');
    }
    
  } catch (error) {
    console.log('💥 Error:', error.message);
  }
}

console.log('🎯 About to test...');
testMovie().then(() => {
  console.log('🎉 Test complete!');
}).catch(error => {
  console.error('💥 Test failed:', error);
}); 