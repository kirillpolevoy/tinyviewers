import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

// Test with just one known good movie
const TEST_MOVIE_ID = 'd291ffc8-1bd1-48d2-9fda-addd36e7519c'; // Coco

async function testClaudeAnalysis() {
  console.log('🧪 Testing Claude Analysis with one movie...\n');
  
  // Get the test movie
  const { data: movies, error } = await supabase
    .from('movies')
    .select(`
      id, 
      title, 
      release_year,
      subtitles!inner(subtitle_text, source),
      scenes(id)
    `)
    .eq('id', TEST_MOVIE_ID)
    .limit(1);

  if (error) {
    console.log('❌ Database error:', error.message);
    return;
  }

  if (!movies || movies.length === 0) {
    console.log('❌ Test movie not found');
    return;
  }

  const movie = movies[0];
  console.log(`🎬 Test movie: "${movie.title}" (${movie.release_year})`);
  console.log(`📝 Subtitle: ${movie.subtitles[0]?.subtitle_text?.length || 0} chars`);
  console.log(`🎭 Existing scenes: ${movie.scenes?.length || 0}`);
  
  if (movie.scenes && movie.scenes.length > 0) {
    console.log('✅ Movie already has scenes - test successful!');
    return;
  }
  
  console.log('🤖 This movie needs Claude analysis');
}

testClaudeAnalysis().catch(console.error); 