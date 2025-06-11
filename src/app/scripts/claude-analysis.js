import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from root .env.local
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

// Environment variables (read after dotenv config)
let supabaseUrl, supabaseServiceKey, claudeApiKey;

// Initialize Supabase (after environment variables are loaded)
let supabase;

// Claude API configuration
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-3-sonnet-20240229';
const MAX_TOKENS = 4000;

// Delay between API calls to respect rate limits
const DELAY_MS = 2000;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function callClaudeAPI(prompt, subtitleText) {
  const messages = [
    {
      role: 'user',
      content: `${prompt}\n\nSUBTITLE TEXT:\n${subtitleText}`
    }
  ];

  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        messages: messages
      })
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.content[0].text;
  } catch (error) {
    console.error('Claude API call failed:', error);
    throw error;
  }
}

async function parseClaudeResponse(claudeResponse) {
  try {
    // Try to extract JSON from Claude's response
    const jsonMatch = claudeResponse.match(/```json\n([\s\S]*?)\n```/) || 
                     claudeResponse.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);
      
      // Validate the expected structure
      if (!parsed.overall_scary_score || !parsed.scenes) {
        throw new Error('Invalid response format: missing overall_scary_score or scenes');
      }
      
      // Convert age keys from numbers to strings with 'y' suffix for consistency
      const normalizedOverallScore = {};
      for (const [age, score] of Object.entries(parsed.overall_scary_score)) {
        normalizedOverallScore[`${age}y`] = score;
      }
      
      // Normalize age flags in scenes
      const normalizedScenes = parsed.scenes.map(scene => ({
        ...scene,
        age_flags: scene.age_flags ? Object.fromEntries(
          Object.entries(scene.age_flags).map(([age, flag]) => [`${age === '2' ? '24m' : age === '3' ? '36m' : age === '4' ? '48m' : '60m'}`, flag])
        ) : {
          '24m': '⚠️',
          '36m': '⚠️', 
          '48m': '⚠️',
          '60m': '⚠️'
        }
      }));
      
      return {
        overall_scary_score: normalizedOverallScore,
        scenes: normalizedScenes
      };
    }
    
    throw new Error('No valid JSON found in Claude response');
  } catch (error) {
    console.error('Failed to parse Claude response:', error);
    console.error('Response was:', claudeResponse);
    throw error;
  }
}

async function saveScenesToDatabase(movieId, scenes) {
  const scenesToInsert = scenes.map(scene => ({
    movie_id: movieId,
    timestamp_start: scene.timestamp_start,
    timestamp_end: scene.timestamp_end,
    description: scene.description,
    tags: scene.tags || [],
    intensity: scene.intensity,
    age_flags: scene.age_flags || {
      '24m': '⚠️',
      '36m': '⚠️', 
      '48m': '⚠️',
      '60m': '⚠️'
    }
  }));

  const { error } = await supabase
    .from('scenes')
    .insert(scenesToInsert);

  if (error) {
    throw error;
  }

  return true;
}

async function updateMovieWithAnalysis(movieId, overallScaryScore) {
  const updates = {
    age_scores: overallScaryScore
  };
  
  const { error } = await supabase
    .from('movies')
    .update(updates)
    .eq('id', movieId);

  if (error) {
    throw error;
  }
}

async function analyzeMovieWithClaude(movie, claudePrompt) {
  console.log(`🎬 Analyzing: "${movie.title}"`);
  
  try {
    // If movie already has scenes, delete them first (for re-analysis)
    if (movie.scenes && movie.scenes.length > 0) {
      console.log(`  🗑️  Deleting ${movie.scenes.length} existing scenes for re-analysis...`);
      const { error: deleteError } = await supabase
        .from('scenes')
        .delete()
        .eq('movie_id', movie.id);
      
      if (deleteError) {
        throw new Error(`Failed to delete existing scenes: ${deleteError.message}`);
      }
    }
    
    // Get subtitle text
    const subtitleText = movie.subtitles[0].subtitle_text;
    
    if (!subtitleText || subtitleText.length < 100) {
      throw new Error('Subtitle text too short or empty');
    }

    console.log(`  📄 Subtitle length: ${subtitleText.length} characters`);
    
    // Call Claude API with your prompt
    console.log(`  🤖 Calling Claude API...`);
    const claudeResponse = await callClaudeAPI(claudePrompt, subtitleText);
    
    console.log(`  📝 Received Claude response (${claudeResponse.length} characters)`);
    
    // Parse the response
    const analysis = await parseClaudeResponse(claudeResponse);
    
    // Validate the analysis structure
    if (!analysis.scenes || !Array.isArray(analysis.scenes)) {
      throw new Error('Invalid analysis format: missing scenes array');
    }
    
    console.log(`  🎭 Found ${analysis.scenes.length} scenes`);
    
    // Save scenes to database
    await saveScenesToDatabase(movie.id, analysis.scenes);
    console.log(`  💾 Saved scenes to database`);
    
    // Update movie with overall scary score
    if (analysis.overall_scary_score) {
      await updateMovieWithAnalysis(movie.id, analysis.overall_scary_score);
      console.log(`  📊 Updated movie with overall scary scores`);
    }
    
    return {
      success: true,
      scenesCount: analysis.scenes.length
    };
    
  } catch (error) {
    console.error(`  ❌ Error analyzing movie: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

async function runClaudeAnalysis(claudePrompt, specificMovieTitle = null) {
  console.log('🎬 Starting Claude Analysis of Movie Subtitles...\n');
  console.log('🤖 Using Claude-3-Sonnet for intelligent scene analysis\n');
  
  if (specificMovieTitle) {
    console.log(`🎯 Analyzing specific movie: "${specificMovieTitle}"\n`);
  } else {
    console.log(`🎯 Analyzing all movies without scenes\n`);
  }
  
  // Read environment variables
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  claudeApiKey = process.env.CLAUDE_API_KEY;
  
  // Debug environment variables
  console.log('Environment check:');
  console.log('- SUPABASE_URL:', !!supabaseUrl);
  console.log('- SUPABASE_SERVICE_KEY:', !!supabaseServiceKey);
  console.log('- CLAUDE_API_KEY:', !!claudeApiKey);
  
  // Check environment variables
  if (!supabaseUrl || !supabaseServiceKey || !claudeApiKey) {
    console.error('❌ Missing required environment variables:');
    console.error('- NEXT_PUBLIC_SUPABASE_URL:', !!supabaseUrl);
    console.error('- SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey);
    console.error('- CLAUDE_API_KEY:', !!claudeApiKey);
    process.exit(1);
  }
  
  // Initialize Supabase client
  supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  try {
    // Get movies with subtitles that don't have scenes yet
    let query = supabase
      .from('movies')
      .select(`
        id, 
        title,
        subtitles(subtitle_text),
        scenes(id)
      `)
      .not('subtitles', 'is', null);
    
    // Add specific movie filter if provided
    if (specificMovieTitle) {
      query = query.ilike('title', `%${specificMovieTitle}%`);
    }
    
    const { data: movies, error } = await query;
    
    if (error) {
      throw error;
    }
    
    console.log(`🔍 Found ${movies?.length || 0} movies from database query`);
    if (specificMovieTitle) {
      console.log(`🔍 Movies matching "${specificMovieTitle}":`, movies?.map(m => m.title));
    }
    
    // Filter for movies that have subtitles
    // If specific movie is requested, allow re-analysis even if scenes exist
    const moviesForAnalysis = movies.filter(movie => {
      const hasSubtitles = movie.subtitles && movie.subtitles.length > 0;
      const hasScenes = movie.scenes && movie.scenes.length > 0;
      
      if (specificMovieTitle) {
        // For specific movie requests, only require subtitles
        return hasSubtitles;
      } else {
        // For bulk analysis, only process movies without scenes
        return hasSubtitles && !hasScenes;
      }
    });
    
    console.log(`📊 Found ${moviesForAnalysis.length} movies with subtitles ready for analysis\n`);
    
    if (moviesForAnalysis.length === 0) {
      if (specificMovieTitle) {
        console.log(`❌ Movie "${specificMovieTitle}" not found or already analyzed!`);
      } else {
        console.log('✅ All movies with subtitles have already been analyzed!');
      }
      return;
    }
    
    let processed = 0;
    let successful = 0;
    let failed = 0;
    
    for (const movie of moviesForAnalysis) {
      processed++;
      console.log(`[${processed}/${moviesForAnalysis.length}] Processing: "${movie.title}"`);
      
      const result = await analyzeMovieWithClaude(movie, claudePrompt);
      
      if (result.success) {
        console.log(`  ✅ Success! Generated ${result.scenesCount} scenes`);
        successful++;
      } else {
        console.log(`  ❌ Failed: ${result.error}`);
        failed++;
      }
      
      // Progress update every 5 movies
      if (processed % 5 === 0) {
        console.log(`\n📈 Progress: ${processed}/${moviesForAnalysis.length} (${successful} success, ${failed} failed)\n`);
      }
      
      // Rate limiting delay
      await delay(DELAY_MS);
    }
    
    console.log('\n🎉 Claude analysis complete!');
    console.log(`📊 Total processed: ${processed}`);
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Success rate: ${processed > 0 ? ((successful / processed) * 100).toFixed(1) : 0}%`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Claude prompt for toddler movie analysis
const claudePrompt = `
You are an expert in child development and media literacy, helping parents assess animated movies for toddlers aged 2–5 years. Your task is to analyze a children's animated movie scene-by-scene based on its subtitle file and return two structured outputs:

⸻

1. Overall Scary Score

A JSON object that estimates how emotionally intense or scary this movie is for toddlers:

{
  "2": 3,
  "3": 2,
  "4": 1,
  "5": 1
}

	•	Use a scale of 1 (gentle, calm) to 5 (intense, potentially frightening).
	•	Consider suspense, danger, emotional distress, loud noises, or sad themes.
	•	Score each age separately — younger children are more sensitive to certain content.

2. Scene-by-Scene Analysis

For each emotionally intense or potentially distressing scene (not just the top 5 — include all that are relevant), provide:

{
  "timestamp_start": "00:23:45",
  "timestamp_end": "00:25:30",
  "description": "A chase through dark tunnels with loud noises and scary music.",
  "tags": ["chase", "darkness", "loud sound", "threatening music"],
  "intensity": 4,
  "age_flags": {
    "2": "🚫",
    "3": "⚠️",
    "4": "✅",
    "5": "✅"
  }
}

	•	Use subtitle timestamps as anchors.
	•	Write brief, clear descriptions in parent-friendly language.
	•	Include emotional or sensory tags like "separation," "darkness," "yelling," "creepy sound," etc.
	•	Use an intensity scale of 1 to 5:
	•	1 = Calm
	•	2 = Mild emotional content
	•	3 = Noticeable tension or sadness
	•	4 = Intense peril or distress
	•	5 = Very intense, scary, or emotionally overwhelming
	•	Age flags reflect content sensitivity:
	•	✅ = Appropriate
	•	⚠️ = Use caution
	•	🚫 = Not recommended

You will be given the subtitle file as input. Use its dialogue and timing to infer what's happening, including tone, emotion, and pacing. When in doubt, err on the side of protecting very young children (age 2–3).

Please return ONLY a valid JSON object in this exact format:
{
  "overall_scary_score": {
    "2": 3,
    "3": 2,
    "4": 1,
    "5": 1
  },
  "scenes": [
    {
      "timestamp_start": "00:23:45",
      "timestamp_end": "00:25:30",
      "description": "Scene description",
      "tags": ["tag1", "tag2"],
      "intensity": 4,
      "age_flags": {
        "2": "🚫",
        "3": "⚠️",
        "4": "✅",
        "5": "✅"
      }
    }
  ]
}

Please analyze the following subtitle text:
`;

// Get specific movie title from command line argument
const specificMovieTitle = process.argv[2];

runClaudeAnalysis(claudePrompt, specificMovieTitle); 