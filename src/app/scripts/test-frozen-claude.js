import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

console.log('🎬 FROZEN CLAUDE ANALYSIS TEST');
console.log('===============================');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Get Frozen movies
const { data: movies, error } = await supabase
  .from('movies')
  .select(`
    id, 
    title,
    subtitles(subtitle_text)
  `)
  .ilike('title', '%Frozen%')
  .not('subtitles', 'is', null);

if (error) {
  console.error('❌ Database error:', error);
  process.exit(1);
}

console.log(`🔍 Found ${movies.length} Frozen movies with subtitles`);
movies.forEach(movie => {
  console.log(`- ${movie.title} (${movie.subtitles[0]?.subtitle_text?.length || 0} chars)`);
});

if (movies.length === 0) {
  console.log('❌ No Frozen movies found');
  process.exit(1);
}

// Test with the first Frozen movie
const movie = movies[0];
console.log(`\n🎯 Testing Claude analysis on: "${movie.title}"`);

const subtitleText = movie.subtitles[0].subtitle_text;
const shortSubtitle = subtitleText.substring(0, 2000); // Use just first 2000 chars for testing

console.log(`📄 Using ${shortSubtitle.length} characters of subtitle text`);

// Simple Claude API test
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.CLAUDE_API_KEY,
    'anthropic-version': '2023-06-01'
  },
  body: JSON.stringify({
    model: 'claude-3-haiku-20240307',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `Analyze this movie subtitle excerpt and identify any potentially scary or intense scenes for toddlers aged 2-5. Return a simple JSON with just one scene example:

SUBTITLE TEXT:
${shortSubtitle}

Return format:
{
  "movie_analysis": "brief summary",
  "sample_scene": {
    "description": "what happens",
    "intensity": 1-5,
    "age_appropriate": "2y, 3y, 4y, 5y"
  }
}`
    }]
  })
});

console.log('📡 Claude API Status:', response.status);

if (response.ok) {
  const data = await response.json();
  console.log('✅ Claude Response:');
  console.log(data.content[0].text);
  console.log('\n🎉 SUCCESS! Claude API is working for Frozen analysis!');
} else {
  const errorText = await response.text();
  console.log('❌ Claude API Error:', errorText);
} 