import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from root .env.local
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function analyzeMovieNeedsProcessing() {
  console.log('🔍 Analyzing movies to find those needing Claude analysis...\n');
  
  // Get all movies with subtitles (whether they have scenes or not)
  const { data: allMovies, error: allMoviesError } = await supabase
    .from('movies')
    .select(`
      id, 
      title,
      subtitles(subtitle_text),
      scenes(
        id,
        description,
        tags,
        intensity,
        age_flags,
        timestamp_start,
        timestamp_end
      )
    `)
    .not('subtitles', 'is', null);

  if (allMoviesError) {
    throw allMoviesError;
  }

  // Filter to only movies with subtitles
  const moviesWithSubtitles = allMovies.filter(movie => 
    movie.subtitles && movie.subtitles.length > 0
  );

  console.log(`📊 Found ${moviesWithSubtitles.length} movies with subtitles\n`);

  // Categorize movies
  const moviesWithScenes = [];
  const moviesWithoutScenes = [];

  moviesWithSubtitles.forEach(movie => {
    if (movie.scenes && movie.scenes.length > 0) {
      moviesWithScenes.push(movie);
    } else {
      moviesWithoutScenes.push(movie);
    }
  });

  console.log(`🎭 ${moviesWithScenes.length} movies have scenes`);
  console.log(`❌ ${moviesWithoutScenes.length} movies have NO scenes\n`);

  // Analyze movies that have scenes
  const sceneAnalysis = moviesWithScenes.map(movie => {
    const scenes = movie.scenes;
    const characteristics = analyzeMovieScenes(scenes);
    
    return {
      title: movie.title,
      sceneCount: scenes.length,
      category: 'HAS_SCENES',
      ...characteristics
    };
  });

  // Add movies without scenes (these definitely need processing)
  const noSceneMovies = moviesWithoutScenes.map(movie => ({
    title: movie.title,
    sceneCount: 0,
    category: 'NO_SCENES',
    claudeScore: 0,
    avgDescLength: 0,
    hasTimestamps: false,
    hasComplexTags: false,
    hasAgeFlags: false
  }));

  // Combine all movies
  const allAnalysis = [...sceneAnalysis, ...noSceneMovies];

  // Sort by priority: no scenes first, then low Claude scores
  allAnalysis.sort((a, b) => {
    if (a.category === 'NO_SCENES' && b.category !== 'NO_SCENES') return -1;
    if (b.category === 'NO_SCENES' && a.category !== 'NO_SCENES') return 1;
    return a.claudeScore - b.claudeScore; // Low scores first
  });

  console.log('🎬 Movies Needing Claude Analysis:\n');
  console.log('Format: Movie (scenes) | Category | Desc Length | Claude Score | Status');
  console.log('='.repeat(100));
  
  const needsProcessing = [];
  
  allAnalysis.forEach(movie => {
    const needsAnalysis = movie.category === 'NO_SCENES' || movie.claudeScore < 3;
    const score = movie.claudeScore.toFixed(1);
    const status = movie.category === 'NO_SCENES' ? '🆘 MISSING' : 
                   movie.claudeScore < 1.5 ? '❌ MANUAL' :
                   movie.claudeScore < 3 ? '⚠️  MIXED' : '✅ CLAUDE';
    
    if (needsAnalysis) {
      needsProcessing.push(movie);
      console.log(`${movie.title.padEnd(40)} (${movie.sceneCount}) | ${movie.category.padEnd(10)} | ${String(movie.avgDescLength).padEnd(10)} | ${score.padEnd(5)} | ${status}`);
    }
  });

  // Summary
  const noScenes = needsProcessing.filter(m => m.category === 'NO_SCENES');
  const manualScenes = needsProcessing.filter(m => m.category === 'HAS_SCENES' && m.claudeScore < 1.5);
  const mixedScenes = needsProcessing.filter(m => m.category === 'HAS_SCENES' && m.claudeScore >= 1.5 && m.claudeScore < 3);
  const claudeEnhanced = allAnalysis.filter(m => m.claudeScore >= 3);

  console.log('\n📈 Summary:');
  console.log(`   🆘 Missing scenes: ${noScenes.length} movies`);
  console.log(`   ❌ Manual scenes: ${manualScenes.length} movies`);
  console.log(`   ⚠️  Mixed/unclear: ${mixedScenes.length} movies`);
  console.log(`   ✅ Claude-enhanced: ${claudeEnhanced.length} movies`);
  console.log(`   📊 TOTAL NEEDING PROCESSING: ${needsProcessing.length} movies`);

  if (needsProcessing.length > 0) {
    console.log('\n🎯 Recommended action:');
    console.log(`   Run Claude analysis on ${needsProcessing.length} movies`);
    console.log('   Priority order: Missing scenes → Manual scenes → Mixed scenes');
    
    console.log('\n📝 Movies to process:');
    needsProcessing.slice(0, 20).forEach((movie, i) => {
      const priority = movie.category === 'NO_SCENES' ? '🆘' : 
                      movie.claudeScore < 1.5 ? '❌' : '⚠️';
      console.log(`   ${i + 1}. ${priority} ${movie.title} (${movie.sceneCount} scenes)`);
    });
    
    if (needsProcessing.length > 20) {
      console.log(`   ... and ${needsProcessing.length - 20} more movies`);
    }
  } else {
    console.log('\n🎉 All movies are Claude-enhanced! No processing needed.');
  }

  return { needsProcessing, summary: { noScenes: noScenes.length, manual: manualScenes.length, mixed: mixedScenes.length, claude: claudeEnhanced.length } };
}

function analyzeMovieScenes(scenes) {
  let claudeScore = 0;
  let totalDescLength = 0;
  let hasTimestamps = false;
  let hasComplexTags = false;
  let hasAgeFlags = false;

  scenes.forEach(scene => {
    // Check description length (Claude tends to be more detailed)
    const descLength = scene.description ? scene.description.length : 0;
    totalDescLength += descLength;
    
    // Long descriptions indicate Claude analysis
    if (descLength > 100) claudeScore += 1;
    if (descLength > 200) claudeScore += 0.5;

    // Check for timestamp format (Claude uses specific format)
    if (scene.timestamp_start && scene.timestamp_start.includes(':')) {
      hasTimestamps = true;
      claudeScore += 0.5;
    }

    // Check for complex tags (Claude uses specific tag vocabulary)
    if (scene.tags && Array.isArray(scene.tags) && scene.tags.length > 0) {
      const claudeTagWords = ['peril', 'suspense', 'separation', 'intensity', 'emotional', 'scary-faces', 'loud-sound'];
      const hasClaudeTags = scene.tags.some(tag => 
        claudeTagWords.some(word => tag.toLowerCase().includes(word))
      );
      if (hasClaudeTags) {
        hasComplexTags = true;
        claudeScore += 1;
      }
    }

    // Check for age flags structure (Claude uses specific format)
    if (scene.age_flags && typeof scene.age_flags === 'object') {
      const hasNewAgeStructure = scene.age_flags['24m'] || scene.age_flags['36m'] || scene.age_flags['48m'] || scene.age_flags['60m'];
      if (hasNewAgeStructure) {
        hasAgeFlags = true;
        claudeScore += 1;
      }
    }

    // Check intensity scoring (Claude uses 1-5 scale consistently)
    if (scene.intensity && scene.intensity >= 1 && scene.intensity <= 5) {
      claudeScore += 0.3;
    }
  });

  const avgDescLength = scenes.length > 0 ? Math.round(totalDescLength / scenes.length) : 0;

  return {
    claudeScore,
    avgDescLength,
    hasTimestamps,
    hasComplexTags,
    hasAgeFlags
  };
}

// Run the analysis
analyzeMovieNeedsProcessing().catch(console.error); 