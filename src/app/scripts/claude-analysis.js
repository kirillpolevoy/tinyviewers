import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from root .env.local
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '..', '..', '.env.local');
console.log('🔍 Loading environment from:', envPath);
dotenv.config({ path: envPath });

// Environment variables (read after dotenv config)
let supabaseUrl, supabaseServiceKey, claudeApiKey;

// Initialize Supabase (after environment variables are loaded)
let supabase;

// Claude API configuration
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-3-5-sonnet-20241022';
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

  const requestBody = {
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    messages: messages
  };

  console.log(`  🔍 API Request Details:`);
  console.log(`     URL: ${CLAUDE_API_URL}`);
  console.log(`     Model: ${CLAUDE_MODEL}`);
  console.log(`     Max Tokens: ${MAX_TOKENS}`);
  console.log(`     API Key: ${claudeApiKey ? 'Present' : 'Missing'}`);
  console.log(`     Content Length: ${subtitleText.length} characters`);

  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    });

    console.log(`  📡 Response Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`  ❌ Error Response Body: ${errorText}`);
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
  // Helper to normalize age_flags keys
  function normalizeAgeFlags(flags) {
    if (!flags || typeof flags !== 'object') return {
      '24m': '⚠️', '36m': '⚠️', '48m': '⚠️', '60m': '⚠️'
    };
    const mapping = {
      '2': '24m', '2y': '24m', '24m': '24m', '24my': '24m',
      '3': '36m', '3y': '36m', '36m': '36m', '36my': '36m',
      '4': '48m', '4y': '48m', '48m': '48m', '48my': '48m',
      '5': '60m', '5y': '60m', '60m': '60m', '60my': '60m',
    };
    const normalized = { '24m': '⚠️', '36m': '⚠️', '48m': '⚠️', '60m': '⚠️' };
    for (const [k, v] of Object.entries(flags)) {
      const mapped = mapping[k.trim().toLowerCase()];
      if (mapped) normalized[mapped] = v;
    }
    return normalized;
  }

  const scenesToInsert = scenes.map(scene => ({
    movie_id: movieId,
    timestamp_start: scene.timestamp_start,
    timestamp_end: scene.timestamp_end,
    description: scene.description,
    tags: scene.tags || [],
    intensity: scene.intensity,
    age_flags: normalizeAgeFlags(scene.age_flags)
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
  
  // Helper to normalize age_scores keys
  function normalizeAgeScores(scores) {
    if (!scores || typeof scores !== 'object') return {};
    const mapping = {
      '2': '24m', '2y': '24m', '24m': '24m', '24my': '24m',
      '3': '36m', '3y': '36m', '36m': '36m', '36my': '36m',
      '4': '48m', '4y': '48m', '48m': '48m', '48my': '48m',
      '5': '60m', '5y': '60m', '60m': '60m', '60my': '60m',
    };
    const normalized = { '24m': null, '36m': null, '48m': null, '60m': null };
    for (const [k, v] of Object.entries(scores)) {
      const mapped = mapping[k.trim().toLowerCase()];
      if (mapped) normalized[mapped] = v;
    }
    return normalized;
  }

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
    
    // --- Post-processing: enforce at least one 🚫 for 24m/36m on intense scenes ---
    const intenseTags = [
      'death', 'injury', 'unconscious', 'peril', 'sacrifice', 'danger', 'trauma', 'attack', 'violence', 'scary', 'distress', 'panic', 'monster', 'freeze', 'betrayal', 'abandonment', 'loss', 'fear', 'crying', 'grief', 'chase', 'wolves', 'darkness', 'apparent death', 'emotional intensity', 'major peril'
    ];
    let foundIntense = false;
    if (Array.isArray(analysis.scenes)) {
      analysis.scenes.forEach(scene => {
        const isIntense = (scene.intensity >= 4) ||
          (scene.tags && scene.tags.some(tag => intenseTags.some(intense => tag.toLowerCase().includes(intense))));
        if (isIntense) {
          if (scene.age_flags) {
            if (scene.age_flags['24m'] !== '🚫') scene.age_flags['24m'] = '🚫';
            if (scene.age_flags['36m'] !== '🚫') scene.age_flags['36m'] = '🚫';
            foundIntense = true;
          }
        }
      });
    }
    // If no intense scene found, leave as is (Claude may have been correct)
    // --- End post-processing ---
    
    // Validate the analysis structure
    if (!analysis.scenes || !Array.isArray(analysis.scenes)) {
      throw new Error('Invalid analysis format: missing scenes array');
    }
    
    console.log(`  🎭 Found ${analysis.scenes.length} scenes`);
    
    // Save scenes to database
    await saveScenesToDatabase(movie.id, analysis.scenes);
    console.log(`  💾 Saved scenes to database`);
    
    // Update movie with overall scary score (normalize keys)
    if (analysis.overall_scary_score) {
      const normalizedScores = normalizeAgeScores(analysis.overall_scary_score);
      await updateMovieWithAnalysis(movie.id, normalizedScores);
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
  console.log('🤖 Using Claude-3-5-Sonnet for intelligent scene analysis\n');
  
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
      .not('subtitles', 'is', null)
      .or('is_active.is.null,is_active.eq.true'); // Filter out inactive movies
    
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
  "24m": 3,
  "36m": 2,
  "48m": 1,
  "60m": 1
}

	•	Use a scale of 1 (gentle, calm) to 5 (intense, potentially frightening).
	•	Consider suspense, danger, emotional distress, loud noises, or sad themes.
	•	Score each age separately — younger children are more sensitive to certain content.

2. Scene-by-Scene Analysis

IMPORTANT: You MUST provide a MINIMUM of 5 scenes. If the movie has fewer than 5 concerning scenes, include additional scenes that show character development, emotional moments, or any content that parents should be aware of.

For each scene (both concerning and important developmental moments), provide:

{
  "timestamp_start": "00:23:45",
  "timestamp_end": "00:25:30",
  "description": "A chase through dark tunnels with loud noises and scary music.",
  "tags": ["chase", "darkness", "loud sound", "threatening music"],
  "intensity": 4,
  "age_flags": {
    "24m": "🚫",
    "36m": "⚠️",
    "48m": "✅",
    "60m": "✅"
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

CRITICAL REQUIREMENTS:
- You MUST return AT LEAST 5 scenes
- Include ALL emotionally intense or concerning scenes
- If there are fewer than 5 concerning scenes, add scenes showing character development, emotional moments, or important plot points
- Cover the entire movie timeline from beginning to end
- Be thorough and comprehensive in your analysis
- **IMPORTANT:** Use the following keys for all age-based scores and flags: "24m" (2 years), "36m" (3 years), "48m" (4 years), "60m" (5 years). Do NOT use year-based keys.
- **You MUST use 🚫 for the most intense or emotionally overwhelming scenes (e.g., injury, death, unconsciousness, major peril) for ages 24m and 36m.**
- **Not all scenes should be ⚠️ for all ages. Use 🚫, ⚠️, and ✅ appropriately and differentiate by age.**
- **Checklist before returning your answer:**
  - [ ] At least one scene is marked 🚫 for 24m and 36m if the movie contains any intense peril, injury, death, or unconsciousness.
  - [ ] Age flags are differentiated by age and not all the same.
  - [ ] All four age keys ("24m", "36m", "48m", "60m") are present in every scene's age_flags.

You will be given the subtitle file as input. Use its dialogue and timing to infer what's happening, including tone, emotion, and pacing. When in doubt, err on the side of protecting very young children (age 2–3).

Please return ONLY a valid JSON object in this exact format:
{
  "overall_scary_score": {
    "24m": 3,
    "36m": 2,
    "48m": 1,
    "60m": 1
  },
  "scenes": [
    {
      "timestamp_start": "00:23:45",
      "timestamp_end": "00:25:30",
      "description": "Scene description",
      "tags": ["tag1", "tag2"],
      "intensity": 4,
      "age_flags": {
        "24m": "🚫",
        "36m": "⚠️",
        "48m": "✅",
        "60m": "✅"
      }
    }
  ]
}

Please analyze the following subtitle text:
`;

// Get specific movie title from command line argument
const specificMovieTitle = process.argv[2];

runClaudeAnalysis(claudePrompt, specificMovieTitle); 