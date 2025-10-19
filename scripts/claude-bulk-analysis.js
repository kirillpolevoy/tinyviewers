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
const CLAUDE_MODEL = 'claude-3-5-haiku-20241022';
const MAX_TOKENS = 4000;

// Delay between API calls to respect rate limits
const DELAY_MS = 10000; // Increased delay for bulk processing

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Progress tracking
let totalMovies = 0;
let processedMovies = 0;
let successfulMovies = 0;
let failedMovies = 0;
const failedMoviesList = [];

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

  return scenesToInsert.length;
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
    const maxSubtitleLength = 150000; // Adjust based on Claude's context window
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
    console.error(`  ❌ Error analyzing "${movieTitle}": ${error.message}`);
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
  console.log('🤖 Using Claude-3-Sonnet for intelligent scene analysis');
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
      .not('subtitles', 'is', null);
    
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
        // For force re-analysis, process all movies with subtitles
        return hasSubtitles;
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

// Updated Claude prompt for 2-5 year age range
const claudePrompt = `
You are an expert in child development and media literacy, helping parents assess animated movies for children aged 2–5 years. Your task is to analyze a children's animated movie scene-by-scene based on its subtitle file and return two structured outputs:

⸻

1. Overall Scary Score

A JSON object that estimates how emotionally intense or scary this movie is for children:

{
  "2": 3,
  "3": 2,
  "4": 1,
  "5": 1
}

	•	Use a scale of 1 (gentle, calm) to 5 (intense, potentially frightening).
	•	Consider suspense, danger, emotional distress, loud noises, sad themes, or separation anxiety.
	•	Score each age separately — 2-year-olds are more sensitive than 5-year-olds.

2. Scene-by-Scene Analysis

For each emotionally intense or potentially distressing scene (not just the top scenes — include all that are relevant), provide:

{
  "timestamp_start": "00:23:45",
  "timestamp_end": "00:25:30",
  "description": "A chase through dark tunnels with loud noises and scary music.",
  "tags": ["chase", "darkness", "loud-sound", "threatening-music"],
  "intensity": 4,
  "age_flags": {
    "2": "🚫",
    "3": "⚠️",
    "4": "✅",
    "5": "✅"
  }
}

	•	Use subtitle timestamps as anchors to identify when scenes occur.
	•	Write brief, clear descriptions in parent-friendly language.
	•	Include relevant tags like "separation", "darkness", "yelling", "loud-noises", "scary-faces", "peril", "sadness", "conflict", etc.
	•	Use an intensity scale of 1 to 5:
	•	1 = Very calm, no concerns
	•	2 = Mild emotional content or minor tension
	•	3 = Noticeable tension, suspense, or sadness
	•	4 = Strong tension, intense action, or emotional distress  
	•	5 = Very intense, scary, or emotionally overwhelming
	•	Age flags reflect content sensitivity:
	•	✅ = Appropriate for this age
	•	⚠️ = Use caution, may be intense
	•	🚫 = Not recommended, likely too intense

Focus on identifying scenes that parents should be aware of, including:
- Scary or threatening characters/scenes
- Loud noises, sudden sounds, or startling moments  
- Sad or emotional moments (character death, separation, crying)
- Intense action sequences or perilous situations
- Dark or visually frightening scenes
- Conflict between characters or bullying

When in doubt, err on the side of caution to protect younger children (ages 2-3).

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
      "description": "Scene description here",
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