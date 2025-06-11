import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function showCurrentStats() {
  try {
    console.log('🎬 CURRENT SUBTITLE COVERAGE STATISTICS');
    console.log('========================================');
    
    // Get total movies
    const { data: allMovies, error: moviesError } = await supabase
      .from('movies')
      .select('id, title')
      .not('imdb_id', 'is', null);
      
    if (moviesError) {
      console.error('Error fetching movies:', moviesError);
      return;
    }

    // Get movies with subtitles
    const { data: moviesWithSubtitles, error: subtitlesError } = await supabase
      .from('movies')
      .select(`
        id, 
        title, 
        subtitles(id, source, created_at)
      `)
      .not('imdb_id', 'is', null);
      
    if (subtitlesError) {
      console.error('Error fetching subtitles:', subtitlesError);
      return;
    }

    const totalMovies = allMovies.length;
    const moviesWithSubtitlesData = moviesWithSubtitles.filter(m => m.subtitles && m.subtitles.length > 0);
    const moviesWithSubtitlesCount = moviesWithSubtitlesData.length;
    const coveragePercentage = ((moviesWithSubtitlesCount / totalMovies) * 100).toFixed(1);

    console.log(`📊 Total Movies: ${totalMovies}`);
    console.log(`✅ Movies with Subtitles: ${moviesWithSubtitlesCount}`);
    console.log(`❌ Movies without Subtitles: ${totalMovies - moviesWithSubtitlesCount}`);
    console.log(`📈 Coverage Percentage: ${coveragePercentage}%`);
    console.log('');

    // Show source breakdown
    const sourceBreakdown = {};
    moviesWithSubtitlesData.forEach(movie => {
      if (movie.subtitles && movie.subtitles.length > 0) {
        movie.subtitles.forEach(subtitle => {
          sourceBreakdown[subtitle.source] = (sourceBreakdown[subtitle.source] || 0) + 1;
        });
      }
    });

    console.log('📋 SUBTITLES BY SOURCE:');
    console.log('=======================');
    Object.entries(sourceBreakdown)
      .sort(([,a], [,b]) => b - a)
      .forEach(([source, count]) => {
        console.log(`${source}: ${count} movies`);
      });

    console.log('');
    console.log('🏆 PROGRESS SUMMARY:');
    console.log('===================');
    console.log('Started: 102/236 movies (43.2% coverage)');
    console.log(`Current: ${moviesWithSubtitlesCount}/${totalMovies} movies (${coveragePercentage}% coverage)`);
    console.log(`Improvement: +${moviesWithSubtitlesCount - 102} movies (+${(parseFloat(coveragePercentage) - 43.2).toFixed(1)}%)`);

    // Show remaining movies
    const moviesWithoutSubtitles = moviesWithSubtitles.filter(m => !m.subtitles || m.subtitles.length === 0);
    console.log('');
    console.log('🎯 REMAINING MOVIES WITHOUT SUBTITLES:');
    console.log('======================================');
    moviesWithoutSubtitles.slice(0, 15).forEach((movie, index) => {
      console.log(`${index + 1}. ${movie.title}`);
    });
    
    if (moviesWithoutSubtitles.length > 15) {
      console.log(`... and ${moviesWithoutSubtitles.length - 15} more`);
    }

  } catch (error) {
    console.error('Error getting stats:', error);
  }
}

showCurrentStats(); 