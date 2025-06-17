import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';

console.log('🚀 Script starting...');

// Load environment variables from .env.local
config({ path: '.env.local' });

console.log('📁 Environment variables loaded');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

console.log('🔗 Clients initialized');

// Test with the real movie ID that has corrupted subtitle data
const movieIds = ['e7f8a9b0-c1d2-4345-e7f8-a9b0c1d23460'];

function isCorruptedSubtitle(subtitleText) {
  if (!subtitleText || subtitleText.trim().length === 0) {
    return true;
  }
  
  // Check if it's HTML content (corrupted YTS-Subs data)
  if (subtitleText.includes('<!DOCTYPE html>') || 
      subtitleText.includes('<html') || 
      subtitleText.includes('yts-subs.com') ||
      subtitleText.includes('YIFY subtitles')) {
    return true;
  }
  
  return false;
}

async function processMovie(movieId) {
  try {
    console.log(`\n🎬 Processing movie: ${movieId}`);
    
    // Get movie info
    const { data: movie, error: movieError } = await supabase
      .from('movies')
      .select('title')
      .eq('id', movieId)
      .single();
    
    if (movieError || !movie) {
      console.log(`❌ Movie not found: ${movieId}`);
      console.log('Movie error:', movieError);
      return;
    }
    
    console.log(`📽️  Movie: ${movie.title}`);
    
    // Get subtitles
    const { data: subtitle, error: subtitleError } = await supabase
      .from('subtitles')
      .select('subtitle_text')
      .eq('movie_id', movieId)
      .single();
    
    if (subtitleError || !subtitle) {
      console.log(`❌ No subtitles for movie ${movieId}`);
      console.log('Subtitle error:', subtitleError);
      return;
    }
    
    console.log(`📝 Subtitle data found (${subtitle.subtitle_text.length} chars)`);
    console.log(`📝 First 200 chars: ${subtitle.subtitle_text.substring(0, 200)}...`);
    
    // Check if subtitle is corrupted
    if (isCorruptedSubtitle(subtitle.subtitle_text)) {
      console.log(`❌ Corrupted subtitle data for ${movie.title} (HTML/YTS-Subs content)`);
      return;
    }
    
    console.log(`✅ Valid subtitle found - would proceed with Claude analysis`);
    
  } catch (error) {
    console.log(`❌ Error processing movie ${movieId}: ${error.message}`);
    console.log('Full error:', error);
  }
}

async function main() {
  console.log('🎬 Testing Corrected Claude Analysis Script...');
  
  // Check environment variables
  const requiredEnvVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY', 
    'CLAUDE_API_KEY'
  ];
  
  console.log('🔍 Checking environment variables...');
  
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.log('❌ Missing required environment variables:');
    missingVars.forEach(varName => {
      console.log(`- ${varName}: ${!!process.env[varName]}`);
    });
    process.exit(1);
  }
  
  console.log('✅ All environment variables present');
  
  for (const movieId of movieIds) {
    await processMovie(movieId);
  }
  
  console.log(`\n🎉 Test complete!`);
}

console.log('🎯 About to call main()...');
main().catch(error => {
  console.error('💥 Main function error:', error);
}); 