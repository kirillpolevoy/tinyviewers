import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';

// Load environment variables from .env.local
config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

// Movie IDs to process
const movieIds = [
  'e7f8a9b0-c1d2-4345-e7f8-a9b0c1d23460',
  'f8e9b0c1-d2e3-4567-f8e9-b0c1d2e34567',
  'a1b2c3d4-e5f6-4789-a1b2-c3d4e5f67890',
  '12345678-9abc-4def-1234-56789abcdef0',
  'abcdef01-2345-4678-abcd-ef0123456789'
];

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
      return;
    }
    
    // Check if subtitle is corrupted
    if (isCorruptedSubtitle(subtitle.subtitle_text)) {
      console.log(`❌ Corrupted subtitle data for ${movie.title} (HTML/YTS-Subs content)`);
      return;
    }
    
    console.log(`✅ Valid subtitle found (${subtitle.subtitle_text.length} chars)`);
    
    // Check if scenes already exist
    const { data: existingScenes } = await supabase
      .from('scenes')
      .select('id')
      .eq('movie_id', movieId)
      .limit(1);
    
    if (existingScenes && existingScenes.length > 0) {
      console.log(`⏭️  Scenes already exist for ${movie.title}, skipping`);
      return;
    }
    
    console.log(`🤖 Sending to Claude for analysis...`);
    
    // Send to Claude
    const message = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4000,
      messages: [{
        role: "user",
        content: `Analyze these movie subtitles for a toddler app (ages 2-5). Create age-appropriate scene descriptions for 24m, 36m, 48m, and 60m milestones.

Movie: ${movie.title}

Subtitles:
${subtitle.subtitle_text}

Return JSON format:
{
  "scenes": [
    {
      "start_time": "00:01:30",
      "end_time": "00:03:45", 
      "description_24m": "Simple description for 24-month-olds",
      "description_36m": "More detailed for 36-month-olds",
      "description_48m": "Even more detailed for 48-month-olds", 
      "description_60m": "Most detailed for 60-month-olds"
    }
  ]
}`
      }]
    });
    
    const responseText = message.content[0].text;
    console.log(`📝 Claude response received (${responseText.length} chars)`);
    
    // Parse JSON response
    let scenes;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      const parsed = JSON.parse(jsonMatch[0]);
      scenes = parsed.scenes || [];
    } catch (parseError) {
      console.log(`❌ Failed to parse Claude response: ${parseError.message}`);
      return;
    }
    
    if (!scenes || scenes.length === 0) {
      console.log(`❌ No scenes found in Claude response`);
      return;
    }
    
    console.log(`💾 Saving ${scenes.length} scenes to database...`);
    
    // Save scenes to database
    const scenesToInsert = scenes.map(scene => ({
      movie_id: movieId,
      start_time: scene.start_time,
      end_time: scene.end_time,
      description_24m: scene.description_24m,
      description_36m: scene.description_36m,
      description_48m: scene.description_48m,
      description_60m: scene.description_60m
    }));
    
    const { error: insertError } = await supabase
      .from('scenes')
      .insert(scenesToInsert);
    
    if (insertError) {
      console.log(`❌ Failed to save scenes: ${insertError.message}`);
      return;
    }
    
    console.log(`✅ Successfully processed ${movie.title} - ${scenes.length} scenes saved`);
    
  } catch (error) {
    console.log(`❌ Error processing movie ${movieId}: ${error.message}`);
  }
}

async function main() {
  console.log('🎬 Starting Simple Claude Analysis...');
  console.log(`📊 Processing ${movieIds.length} movies`);
  
  // Check environment variables
  const requiredEnvVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY', 
    'CLAUDE_API_KEY'
  ];
  
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.log('❌ Missing required environment variables:');
    missingVars.forEach(varName => {
      console.log(`- ${varName}: ${!!process.env[varName]}`);
    });
    process.exit(1);
  }
  
  let processed = 0;
  
  for (const movieId of movieIds) {
    await processMovie(movieId);
    processed++;
    
    // Wait 90 seconds between requests to respect rate limits
    if (processed < movieIds.length) {
      console.log(`\n⏳ Waiting 90 seconds before next request... (${processed}/${movieIds.length})`);
      await new Promise(resolve => setTimeout(resolve, 90000));
    }
  }
  
  console.log(`\n🎉 Batch processing complete!`);
  console.log(`📊 Processed: ${processed}/${movieIds.length} movies`);
}

main().catch(console.error); 