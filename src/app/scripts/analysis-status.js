import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from root .env.local
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

// Environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkAnalysisStatus() {
  console.log('🎬 Claude Analysis Status Checker\n');
  
  try {
    // Get all movies with subtitles and scenes data
    const { data: movies, error } = await supabase
      .from('movies')
      .select(`
        id, 
        title,
        subtitles(subtitle_text),
        scenes(id)
      `);
    
    if (error) {
      throw error;
    }
    
    console.log(`📊 Total movies in database: ${movies.length}`);
    
    // Categorize movies
    const moviesWithSubtitles = movies.filter(movie => 
      movie.subtitles && movie.subtitles.length > 0
    );
    
    const moviesWithScenes = movies.filter(movie => 
      movie.scenes && movie.scenes.length > 0
    );
    
    const moviesWithBoth = movies.filter(movie => 
      movie.subtitles && movie.subtitles.length > 0 &&
      movie.scenes && movie.scenes.length > 0
    );
    
    const moviesReadyForAnalysis = movies.filter(movie => 
      movie.subtitles && movie.subtitles.length > 0 &&
      (!movie.scenes || movie.scenes.length === 0)
    );
    
    const moviesWithoutSubtitles = movies.filter(movie => 
      !movie.subtitles || movie.subtitles.length === 0
    );
    
    console.log('\n📈 Analysis Status:');
    console.log(`   🎞️  Movies with subtitles: ${moviesWithSubtitles.length}`);
    console.log(`   🎭 Movies with scene analysis: ${moviesWithScenes.length}`);
    console.log(`   ✅ Movies fully analyzed: ${moviesWithBoth.length}`);
    console.log(`   🚀 Movies ready for analysis: ${moviesReadyForAnalysis.length}`);
    console.log(`   ❌ Movies without subtitles: ${moviesWithoutSubtitles.length}`);
    
    // Calculate percentages
    const subtitleCoverage = ((moviesWithSubtitles.length / movies.length) * 100).toFixed(1);
    const analysisCoverage = ((moviesWithBoth.length / movies.length) * 100).toFixed(1);
    const readyPercentage = ((moviesReadyForAnalysis.length / movies.length) * 100).toFixed(1);
    
    console.log('\n📊 Coverage:');
    console.log(`   📄 Subtitle coverage: ${subtitleCoverage}%`);
    console.log(`   🎭 Analysis coverage: ${analysisCoverage}%`);
    console.log(`   🚀 Ready for analysis: ${readyPercentage}%`);
    
    if (moviesReadyForAnalysis.length > 0) {
      console.log('\n🎬 Movies ready for Claude analysis:');
      moviesReadyForAnalysis.slice(0, 10).forEach((movie, i) => {
        const subtitleLength = movie.subtitles[0]?.subtitle_text?.length || 0;
        console.log(`   ${i + 1}. ${movie.title} (${subtitleLength.toLocaleString()} chars)`);
      });
      
      if (moviesReadyForAnalysis.length > 10) {
        console.log(`   ... and ${moviesReadyForAnalysis.length - 10} more movies`);
      }
      
      console.log('\n💡 To start analysis, run:');
      console.log('   node scripts/claude-bulk-analysis.js');
      console.log('   node scripts/claude-bulk-analysis.js --limit=5   # Process 5 movies');
    }
    
    if (moviesWithoutSubtitles.length > 0) {
      console.log('\n❌ Movies without subtitles (need scraping first):');
      moviesWithoutSubtitles.slice(0, 5).forEach((movie, i) => {
        console.log(`   ${i + 1}. ${movie.title}`);
      });
      
      if (moviesWithoutSubtitles.length > 5) {
        console.log(`   ... and ${moviesWithoutSubtitles.length - 5} more movies`);
      }
      
      console.log('\n💡 To scrape subtitles, run:');
      console.log('   node scripts/scrape-subtitles.js');
    }
    
    // Show sample analyzed movie
    if (moviesWithBoth.length > 0) {
      const sampleMovie = moviesWithBoth[0];
      console.log(`\n🔍 Sample analyzed movie: "${sampleMovie.title}"`);
      console.log(`   📄 Subtitle length: ${sampleMovie.subtitles[0]?.subtitle_text?.length?.toLocaleString() || 'N/A'} characters`);
      console.log(`   🎭 Scenes analyzed: ${sampleMovie.scenes.length}`);
      
      // Get more details about this movie
      const { data: detailedMovie, error: detailError } = await supabase
        .from('movies')
        .select(`
          title,
          age_scores,
          scenes(id, intensity, description)
        `)
        .eq('id', sampleMovie.id)
        .single();
      
      if (!detailError && detailedMovie) {
        console.log(`   📊 Age scores:`, detailedMovie.age_scores);
        
        if (detailedMovie.scenes.length > 0) {
          console.log(`   🎬 Sample scenes:`);
          detailedMovie.scenes.slice(0, 3).forEach((scene, i) => {
            console.log(`      ${i + 1}. Intensity ${scene.intensity}: ${scene.description?.substring(0, 60)}...`);
          });
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error checking status:', error.message);
    process.exit(1);
  }
}

checkAnalysisStatus(); 