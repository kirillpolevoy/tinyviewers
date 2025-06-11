import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

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
const CLAUDE_MODEL = 'claude-3-5-sonnet-20241022';
const MAX_TOKENS = 4000;

// Delay between API calls to respect rate limits
const DELAY_MS = 3000; // Increased delay for bulk processing

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Progress tracking
let totalMovies = 0;
let processedMovies = 0;
let successfulMovies = 0;
let failedMovies = 0;
const failedMoviesList = [];

// Simple file-based tracking of processed movies
const PROCESSED_MOVIES_FILE = 'processed-movies.json';

function loadProcessedMovies() {
  try {
    if (fs.existsSync(PROCESSED_MOVIES_FILE)) {
      return JSON.parse(fs.readFileSync(PROCESSED_MOVIES_FILE, 'utf8'));
    }
  } catch (error) {
    console.log('Creating new processed movies tracking file...');
  }
  return [];
}

function saveProcessedMovie(movieId) {
  const processed = loadProcessedMovies();
  if (!processed.includes(movieId)) {
    processed.push(movieId);
    fs.writeFileSync(PROCESSED_MOVIES_FILE, JSON.stringify(processed, null, 2));
  }
}

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
      const errorData = await response.text();
      throw new Error(`Claude API error: ${response.status} ${response.statusText} - ${errorData}`);
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
      
      // Convert age keys to new structure (24m/36m/48m/60m)
      const normalizedOverallScore = {};
      for (const [age, score] of Object.entries(parsed.overall_scary_score)) {
        if (age === '2') normalizedOverallScore['24m'] = score;
        else if (age === '3') normalizedOverallScore['36m'] = score;
        else if (age === '4') normalizedOverallScore['48m'] = score;
        else if (age === '5') normalizedOverallScore['60m'] = score;
      }
      
      // Normalize age flags in scenes to new structure
      const normalizedScenes = parsed.scenes.map(scene => ({
        ...scene,
        age_flags: scene.age_flags ? {
          '24m': scene.age_flags['2'] || '⚠️',
          '36m': scene.age_flags['3'] || '⚠️',
          '48m': scene.age_flags['4'] || '⚠️',
          '60m': scene.age_flags['5'] || '⚠️'
        } : {
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
    console.error('Response was:', claudeResponse.substring(0, 500) + '...');
    throw error;
  }
}

async function saveScenesToDatabase(movieId, scenes) {
  const scenesToInsert = scenes.map(scene => {
    // Create the scene object with an explicit UUID for the id field
    const sceneData = {
      id: uuidv4(), // Generate a UUID for each scene
      movie_id: movieId,
      timestamp_start: scene.timestamp_start,
      timestamp_end: scene.timestamp_end,
      description: scene.description,
      tags: scene.tags || [],
      intensity: typeof scene.intensity === 'string' ? parseInt(scene.intensity) || 1 : scene.intensity || 1,
      age_flags: scene.age_flags || {
        '24m': '⚠️',
        '36m': '⚠️', 
        '48m': '⚠️',
        '60m': '⚠️'
      }
    };
    
    return sceneData;
  });

  const { data, error } = await supabase
    .from('scenes')
    .insert(scenesToInsert);

  if (error) {
    throw error;
  }

  return scenesToInsert.length;
}

async function updateMovieWithAnalysis(movieId, updates) {
  const { error } = await supabase
    .from('movies')
    .update(updates)
    .eq('id', movieId);

  if (error) {
    throw error;
  }
}

async function analyzeMovieWithClaude(movie, claudePrompt, forceReanalysis = false) {
  const movieTitle = movie.title.substring(0, 50) + (movie.title.length > 50 ? '...' : '');
  console.log(`🎬 [${processedMovies + 1}/${totalMovies}] Analyzing: "${movieTitle}"`);
  
  try {
    // If movie already has scenes and we're not forcing re-analysis, skip
    if (movie.scenes && movie.scenes.length > 0 && !forceReanalysis) {
      console.log(`  ⏭️  Already has ${movie.scenes.length} scenes - skipping`);
      return { success: true, skipped: true };
    }

    // If movie already has scenes, delete them first (for re-analysis)
    if (movie.scenes && movie.scenes.length > 0 && forceReanalysis) {
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

    console.log(`  📄 Subtitle length: ${subtitleText.length.toLocaleString()} characters`);
    
    // Truncate very long subtitles to avoid token limits
    const maxSubtitleLength = 150000; // Increased for full movie analysis
    const processedSubtitle = subtitleText.length > maxSubtitleLength 
      ? subtitleText.substring(0, maxSubtitleLength) + '\n\n[Note: Subtitle truncated due to length]'
      : subtitleText;
    
    if (processedSubtitle !== subtitleText) {
      console.log(`  ✂️  Truncated subtitle to ${processedSubtitle.length.toLocaleString()} characters`);
    }
    
    // Call Claude API with your prompt
    console.log(`  🤖 Calling Claude API...`);
    const claudeResponse = await callClaudeAPI(claudePrompt, processedSubtitle);
    
    console.log(`  📝 Received Claude response (${claudeResponse.length.toLocaleString()} characters)`);
    
    // Parse the response
    const analysis = await parseClaudeResponse(claudeResponse);
    
    // Validate the analysis structure
    if (!analysis.scenes || !Array.isArray(analysis.scenes)) {
      throw new Error('Invalid analysis format: missing scenes array');
    }
    
    console.log(`  🎭 Found ${analysis.scenes.length} scenes`);
    
    // Save scenes to database  
    const savedScenesCount = await saveScenesToDatabase(movie.id, analysis.scenes);
    console.log(`  💾 Saved ${savedScenesCount} scenes to database`);
    
    // Update movie with overall scary score and mark as processed
    if (analysis.overall_scary_score) {
      await updateMovieWithAnalysis(movie.id, { age_scores: analysis.overall_scary_score });
      console.log(`  📊 Updated movie with overall scary scores`);
    }
    
    // Mark movie as processed in tracking file
    console.log(`  🔄 Marking movie ${movie.id} as processed...`);
    try {
      saveProcessedMovie(movie.id);
      console.log(`  ✅ Marked movie as processed`);
    } catch (err) {
      console.log(`  ❌ Error marking movie as processed:`, err.message);
    }
    
    return {
      success: true,
      scenesCount: analysis.scenes.length
    };
    
  } catch (error) {
    console.error(`  ❌ Error analyzing "${movieTitle}": ${error.message}`);
    console.error(`  🔍 Full error details:`, error);
    if (error.stack) {
      console.error(`  📍 Stack trace:`, error.stack);
    }
    failedMoviesList.push({ title: movie.title, error: error.message });
    return {
      success: false,
      error: error.message
    };
  }
}

function displayProgress() {
  const percentage = totalMovies > 0 ? ((processedMovies / totalMovies) * 100).toFixed(1) : '0.0';
  const successRate = processedMovies > 0 ? ((successfulMovies / processedMovies) * 100).toFixed(1) : '0.0';
  
  console.log(`\n📈 Progress Update:`);
  console.log(`   📊 Overall: ${processedMovies}/${totalMovies} (${percentage}%)`);
  console.log(`   ✅ Successful: ${successfulMovies} (${successRate}%)`);
  console.log(`   ❌ Failed: ${failedMovies}`);
  console.log(`   ⏭️  Remaining: ${totalMovies - processedMovies}`);
  
  if (failedMovies > 0) {
    console.log(`\n❌ Recent failures:`);
    failedMoviesList.slice(-3).forEach(failed => {
      console.log(`   - "${failed.title}": ${failed.error}`);
    });
  }
  console.log('');
}

async function runBulkClaudeAnalysis(options = {}) {
  const {
    specificMovieTitle = null,
    forceReanalysis = false,
    limit = null
  } = options;

  console.log('🎬 Starting Bulk Claude Analysis of Movie Subtitles...\n');
  console.log('🤖 Using Claude-3.5-Sonnet with enhanced detailed analysis');
  console.log('🎯 Target age range: 2-5 years (24m/36m/48m/60m)\n');
  
  if (specificMovieTitle) {
    console.log(`🎯 Analyzing specific movie: "${specificMovieTitle}"`);
  } else if (forceReanalysis) {
    console.log(`🔄 Force re-analysis enabled - will replace existing data`);
  } else {
    console.log(`🎯 Analyzing movies without existing scene data`);
  }
  
  if (limit) {
    console.log(`📏 Processing limit: ${limit} movies`);
  }
  console.log('');
  
  // Read environment variables
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  claudeApiKey = process.env.CLAUDE_API_KEY;
  
  // Check environment variables
  if (!supabaseUrl || !supabaseServiceKey || !claudeApiKey) {
    console.error('❌ Missing required environment variables:');
    console.error('- NEXT_PUBLIC_SUPABASE_URL:', !!supabaseUrl);
    console.error('- SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey);
    console.error('- CLAUDE_API_KEY:', !!claudeApiKey);
    process.exit(1);
  }
  
  console.log('✅ Environment variables verified\n');
  
  // Initialize Supabase client
  supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  try {
    // Get movies with subtitles
    let query = supabase
      .from('movies')
      .select(`
        id, 
        title,
        subtitles(subtitle_text),
        scenes(id)
      `)
      .not('subtitles', 'is', null)
      .order('title'); // Add consistent ordering
    
    // Add specific movie filter if provided
    if (specificMovieTitle) {
      query = query.ilike('title', `%${specificMovieTitle}%`);
    }
    
    const { data: movies, error } = await query;
    
    if (error) {
      throw error;
    }
    
    console.log(`🔍 Found ${movies?.length || 0} movies with subtitles in database`);
    
    // Filter for movies that meet our criteria
    const moviesForAnalysis = movies.filter(movie => {
      const hasSubtitles = movie.subtitles && movie.subtitles.length > 0;
      const hasScenes = movie.scenes && movie.scenes.length > 0;
      
      if (specificMovieTitle) {
        // For specific movie requests, only require subtitles
        return hasSubtitles;
      } else if (forceReanalysis) {
        // For force re-analysis, process movies that haven't been enhanced yet
        if (!hasSubtitles || !hasScenes) return false;
        
        // DEBUG: Log movie title being checked
        console.log(`🔍 Checking movie: "${movie.title}"`);
        
        // Skip movies we've already processed today (hardcoded list)
        const alreadyProcessed = [
          'Puss in Boots',
          'Ratatouille', 
          'Rugrats Go Wild',
          'Frozen II',
          'Moana',
          'Toy Story 3',
          'The Rescuers',
          'The Road to El Dorado',
          'Turbo',
          'The Smurfs', 
          'The Wild',
          'The Wind Rises',
          'Tinker Bell',
          'Tinker Bell and the Secret of the Wings'
        ];
        
        const shouldSkip = alreadyProcessed.includes(movie.title);
        console.log(`🔍 Should skip "${movie.title}": ${shouldSkip}`);
        
        return !shouldSkip;
      } else {
        // For normal analysis, only process movies without scenes
        return hasSubtitles && !hasScenes;
      }
    });
    
    // Apply limit if specified
    const finalMoviesForAnalysis = limit 
      ? moviesForAnalysis.slice(0, limit)
      : moviesForAnalysis;
    
    totalMovies = finalMoviesForAnalysis.length;
    
    console.log(`📊 ${totalMovies} movies ready for analysis\n`);
    
    if (totalMovies === 0) {
      if (specificMovieTitle) {
        console.log(`❌ Movie "${specificMovieTitle}" not found with subtitles!`);
      } else if (!forceReanalysis) {
        console.log('✅ All movies with subtitles have already been analyzed!');
        console.log('💡 Use --force flag to re-analyze existing movies.');
      } else {
        console.log('❌ No movies with subtitles found for analysis!');
      }
      return;
    }
    
    // Display what we're about to process
    console.log('🎬 Movies to be analyzed:');
    finalMoviesForAnalysis.slice(0, 10).forEach((movie, i) => {
      const hasExistingScenes = movie.scenes && movie.scenes.length > 0;
      const status = hasExistingScenes ? `(${movie.scenes.length} scenes - will replace)` : '(new)';
      console.log(`   ${i + 1}. ${movie.title} ${status}`);
    });
    
    if (finalMoviesForAnalysis.length > 10) {
      console.log(`   ... and ${finalMoviesForAnalysis.length - 10} more movies`);
    }
    console.log('');
    
    // Start processing
    console.log('🚀 Starting analysis...\n');
    
    for (const movie of finalMoviesForAnalysis) {
      const result = await analyzeMovieWithClaude(movie, claudePrompt, forceReanalysis);
      
      processedMovies++;
      
      if (result.success && !result.skipped) {
        console.log(`  ✅ Success! Generated ${result.scenesCount || 0} scenes`);
        successfulMovies++;
      } else if (result.skipped) {
        console.log(`  ⏭️  Skipped (already analyzed)`);
        successfulMovies++; // Count skipped as successful
      } else {
        console.log(`  ❌ Failed: ${result.error}`);
        failedMovies++;
      }
      
      // Progress update every 5 movies
      if (processedMovies % 5 === 0 || processedMovies === totalMovies) {
        displayProgress();
      }
      
      // Rate limiting delay (but not for the last movie)
      if (processedMovies < totalMovies) {
        console.log(`⏱️  Waiting ${DELAY_MS}ms before next movie...\n`);
        await delay(DELAY_MS);
      }
    }
    
    // Final summary
    console.log('\n🎉 Bulk Claude analysis complete!\n');
    console.log('📊 Final Results:');
    console.log(`   Total processed: ${processedMovies}`);
    console.log(`   Successful: ${successfulMovies}`);
    console.log(`   Failed: ${failedMovies}`);
    console.log(`   Success rate: ${processedMovies > 0 ? ((successfulMovies / processedMovies) * 100).toFixed(1) : 0}%`);
    
    if (failedMovies > 0) {
      console.log('\n❌ Failed movies:');
      failedMoviesList.forEach(failed => {
        console.log(`   - "${failed.title}": ${failed.error}`);
      });
      console.log('\n💡 You can retry failed movies individually using:');
      console.log('   node scripts/claude-bulk-analysis.js "Movie Title"');
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Enhanced Claude prompt for detailed 2-5 year age range analysis
const claudePrompt = `
You are an expert child psychologist specializing in media for ages 2-5. Analyze this movie for parents.

CRITICAL INSTRUCTIONS:
- Write DETAILED scene descriptions (minimum 150 words each)
- Be VERY specific about what happens, who is involved, and why it might concern children
- Include dialogue, character emotions, visual elements, sounds, and duration

Analyze the provided subtitle text and return two structured outputs:

### 1. Overall Scary Score

Provide age-specific intensity ratings (1-5 scale) based on the movie's overall emotional content:

{
  "2": 4,  // 2-year-olds (most sensitive)
  "3": 3,  // 3-year-olds  
  "4": 2,  // 4-year-olds
  "5": 1   // 5-year-olds (least sensitive)
}

**Intensity Scale:**
- 1 = Gentle, peaceful content appropriate for all ages
- 2 = Minor tension or mild emotional moments 
- 3 = Moderate intensity with some scary or sad elements
- 4 = High intensity with frequent scary/intense scenes
- 5 = Very intense, overwhelming content with significant scary elements

### 2. Detailed Scene-by-Scene Analysis

For each concerning scene, provide comprehensive analysis in this format:

{
  "timestamp_start": "00:23:45",
  "timestamp_end": "00:25:30",
  "description": "MINIMUM 150 WORDS: Start with what happens, include specific dialogue quotes from subtitles, describe character emotions and reactions, explain the setting and visual atmosphere, detail sounds and music, identify specific concerns for ages 2-5, explain duration and intensity, and conclude with why parents should know about this scene. Write like you are telling a parent everything they need to know.",
  "tags": ["chase", "darkness", "loud-sound", "threatening-music", "monster", "separation"],
  "intensity": 4,
  "age_flags": {
    "2": "🚫",
    "3": "⚠️",
    "4": "✅", 
    "5": "✅"
  }
}

## Enhanced Description Requirements

**Write detailed, parent-helpful descriptions that include:**

✅ **What exactly happens** - specific actions, dialogue, visual elements
✅ **Emotional context** - character feelings, relationships, conflicts  
✅ **Sensory elements** - sounds, music, lighting, visual intensity
✅ **Why it might concern children** - separation anxiety, fear triggers, emotional overwhelm
✅ **Duration and intensity** - how long the concerning content lasts
✅ **Character safety** - whether characters are in real danger or just perceived danger

**Example of enhanced description:**
Instead of: "Battle scene with fighting and chaos"
Write: "Extended battle sequence where magical forest spirits attack humans with wind, fire, and earth magic. Characters are thrown around, separated from family members, and cry out in fear. Loud crashing sounds, dark storm clouds, and glowing angry spirit eyes create a threatening atmosphere. The scene shows parents and children being physically separated during the chaos, which may trigger separation anxiety in younger viewers. Multiple characters appear to be in genuine physical danger with rocks falling and fire spreading."

**ABSOLUTELY CRITICAL: Each description must be 150+ words minimum. Include specific dialogue from the subtitles. Do NOT write short summaries.**

## Content Focus Areas

Identify and analyze scenes containing:

🔍 **Fear/Scary Content:** Monsters, darkness, threatening characters, scary faces/sounds
🔍 **Separation/Loss:** Parent-child separation, character death/disappearance, abandonment
🔍 **Emotional Distress:** Crying, sadness, grief, characters in emotional pain  
🔍 **Physical Peril:** Chases, falls, fights, characters in danger, natural disasters
🔍 **Loud/Startling:** Sudden noises, explosions, shouting, jarring music
🔍 **Conflict:** Arguments, bullying, betrayal, character vs character tension

## Age Flag Guidelines

- **🚫 (Not recommended)** - Likely to cause nightmares, excessive fear, or emotional distress
- **⚠️ (Use caution)** - May be intense but manageable with parent support/explanation  
- **✅ (Appropriate)** - Age-appropriate content that won't cause undue distress

**Consider developmental factors:**
- 2-year-olds: Very literal thinking, strong separation anxiety, limited emotional regulation
- 3-year-olds: Beginning to understand pretend vs real, still high emotional sensitivity  
- 4-year-olds: Better emotional regulation, can handle mild tension with support
- 5-year-olds: More sophisticated understanding, can process moderate scary content

Return ONLY a valid JSON object in this exact format:

{
  "overall_scary_score": {
    "2": 4,
    "3": 3,
    "4": 2, 
    "5": 1
  },
  "scenes": [
    {
      "timestamp_start": "00:23:45",
      "timestamp_end": "00:25:30",
      "description": "Comprehensive detailed description here...",
      "tags": ["relevant", "tags", "here"],
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

REMEMBER: Each scene description MUST be at least 150 words. Include actual dialogue quotes from the subtitle text.

Please analyze the following subtitle text:
`;

// Parse command line arguments
const args = process.argv.slice(2);
const specificMovieTitle = args.find(arg => !arg.startsWith('--'));
const forceReanalysis = args.includes('--force') || args.includes('-f');
const limitArg = args.find(arg => arg.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : null;

// Display usage if help requested
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
🎬 Bulk Claude Analysis Tool

Usage:
  node scripts/claude-bulk-analysis.js [options] [movie-title]

Options:
  --force, -f           Force re-analysis of movies that already have scenes
  --limit=N             Limit processing to N movies
  --help, -h            Show this help message

Examples:
  node scripts/claude-bulk-analysis.js                    # Analyze all movies without scenes
  node scripts/claude-bulk-analysis.js --force            # Re-analyze all movies 
  node scripts/claude-bulk-analysis.js --limit=10         # Analyze only 10 movies
  node scripts/claude-bulk-analysis.js "Frozen"           # Analyze specific movie
  node scripts/claude-bulk-analysis.js "Frozen" --force   # Re-analyze specific movie
`);
  process.exit(0);
}

// Run the analysis
runBulkClaudeAnalysis({
  specificMovieTitle,
  forceReanalysis,
  limit
}); 