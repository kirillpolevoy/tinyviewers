import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkFrozenMovies() {
  try {
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

    console.log('🎬 SUBTITLE COVERAGE STATISTICS');
    console.log('=====================================');
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

    // Show some recent additions
    console.log('');
    console.log('🎯 RECENT SUBTITLE ADDITIONS:');
    console.log('=============================');
    const recentAdditions = moviesWithSubtitlesData
      .filter(movie => movie.subtitles && movie.subtitles.length > 0)
      .map(movie => ({
        title: movie.title,
        source: movie.subtitles[0].source,
        added: new Date(movie.subtitles[0].created_at).toLocaleDateString()
      }))
      .sort((a, b) => new Date(b.added) - new Date(a.added))
      .slice(0, 10);

    recentAdditions.forEach(movie => {
      console.log(`• ${movie.title} (${movie.source})`);
    });

  } catch (error) {
    console.error('Error:', error);
  }
}

checkFrozenMovies(); 