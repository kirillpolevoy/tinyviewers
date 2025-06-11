import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

console.log('🚀 FROZEN CLAUDE ANALYSIS SCRIPT - VERSION 1.0');
console.log('🎯 This script will analyze Frozen movies with Claude AI');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log('🔍 Environment check:');
console.log('- SUPABASE_URL:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log('- SUPABASE_SERVICE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log('- CLAUDE_API_KEY:', !!process.env.CLAUDE_API_KEY);

// Claude API configuration
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-3-haiku-20240307';
const MAX_TOKENS = 4000;

async function callClaudeAPI(prompt, subtitleText) {
  const messages = [
    {
      role: 'user',
      content: `${prompt}\n\nSUBTITLE TEXT:\n${subtitleText}`
    }
  ];

  console.log('🤖 Making Claude API request...');
  console.log('📝 Request details:');
  console.log('- Model:', CLAUDE_MODEL);
  console.log('- Max tokens:', MAX_TOKENS);
  console.log('- Subtitle length:', subtitleText.length);

  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        messages: messages
      })
    });

    console.log('📡 Claude API response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Claude API error response:', errorText);
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ Claude API response received successfully');
    return data.content[0].text;
  } catch (error) {
    console.error('❌ Claude API call failed:', error);
    throw error;
  }
}

// Simple Claude prompt for testing
const claudePrompt = `
Please analyze this movie subtitle file and return a simple JSON response with:
1. A brief summary of the movie
2. An overall intensity score from 1-5 for toddlers
3. Any concerning scenes

Return ONLY valid JSON in this format:
{
  "summary": "Brief movie summary",
  "intensity_score": 3,
  "concerning_scenes": ["scene 1", "scene 2"]
}
`;

// Get Frozen movies
console.log('🔍 Searching for Frozen movies...');
const { data: movies, error } = await supabase
  .from('movies')
  .select(`
    id, 
    title,
    subtitles(subtitle_text),
    scenes(id)
  `)
  .ilike('title', '%frozen%')
  .not('subtitles', 'is', null);

if (error) {
  console.error('❌ Database error:', error);
  process.exit(1);
}

console.log(`🎬 Found ${movies?.length || 0} Frozen movies`);
movies?.forEach(movie => {
  console.log(`- ${movie.title} (${movie.subtitles?.[0]?.subtitle_text?.length || 0} chars, ${movie.scenes?.length || 0} scenes)`);
});

if (!movies || movies.length === 0) {
  console.log('❌ No Frozen movies found with subtitles');
  process.exit(1);
}

// Test with the first Frozen movie
const movie = movies[0];
console.log(`\n🎭 Testing Claude analysis with: "${movie.title}"`);

try {
  const subtitleText = movie.subtitles[0].subtitle_text;
  
  // Truncate subtitle for testing (Claude has token limits)
  const truncatedSubtitle = subtitleText.substring(0, 10000);
  console.log(`📄 Using first ${truncatedSubtitle.length} characters of subtitles`);
  
  const claudeResponse = await callClaudeAPI(claudePrompt, truncatedSubtitle);
  
  console.log('\n🎉 Claude Analysis Result:');
  console.log('📝 Raw response:', claudeResponse);
  
  // Try to parse JSON
  try {
    const parsed = JSON.parse(claudeResponse);
    console.log('\n✅ Parsed JSON result:');
    console.log('📖 Summary:', parsed.summary);
    console.log('⚡ Intensity Score:', parsed.intensity_score);
    console.log('⚠️ Concerning Scenes:', parsed.concerning_scenes);
  } catch (parseError) {
    console.log('⚠️ Could not parse as JSON, raw response above');
  }
  
} catch (error) {
  console.error('❌ Analysis failed:', error.message);
}

console.log('\n✅ Frozen Claude analysis test complete!'); 