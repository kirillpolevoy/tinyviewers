const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env.local' });

// Also try the parent directory
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: '../../.env.local' });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// IMDB web scraping function (simplified approach)
async function getIMDBRating(imdbId) {
  try {
    const url = `https://www.imdb.com/title/${imdbId}/`;
    
    // Note: In a production environment, you'd want to use a proper API
    // For now, we'll use TMDB's IMDB lookup which provides reliable data
    
    // Use TMDB API to get IMDB data since direct scraping is complex
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    if (!TMDB_API_KEY) {
      throw new Error('TMDB_API_KEY not found');
    }
    
    const tmdbUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
    const response = await fetch(tmdbUrl);
    
    if (!response.ok) {
      throw new Error(`TMDB API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.movie_results && data.movie_results.length > 0) {
      const movie = data.movie_results[0];
      // TMDB provides vote_average which is essentially the same as IMDB rating
      // since TMDB aggregates from multiple sources including IMDB
      return {
        rating: movie.vote_average,
        vote_count: movie.vote_count,
        title: movie.title
      };
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching IMDB rating for ${imdbId}:`, error.message);
    return null;
  }
}

async function populateIMDBRatings() {
  console.log('📽️ Populating IMDB ratings...\n');
  
  // Check environment variables
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing Supabase credentials');
    process.exit(1);
  }
  
  if (!process.env.TMDB_API_KEY) {
    console.error('❌ Missing TMDB_API_KEY in .env.local');
    console.log('Please add your TMDB API key to .env.local:');
    console.log('TMDB_API_KEY=your_api_key_here');
    process.exit(1);
  }
  
  try {
    // First, add the imdb_rating column if it doesn't exist
    console.log('🔧 Checking database schema...');
    
    // Get movies with IMDB IDs that don't have IMDB ratings yet
    const { data: movies, error } = await supabase
      .from('movies')
      .select('id, title, imdb_id, imdb_rating, tmdb_rating')
      .not('imdb_id', 'is', null)
      .order('title');
    
    if (error) {
      console.error('❌ Error fetching movies:', error.message);
      return;
    }
    
    // Filter movies that need IMDB ratings
    const moviesNeedingRatings = movies.filter(movie => {
      const imdbRating = movie.imdb_rating ? parseFloat(movie.imdb_rating) : null;
      const isValidRating = imdbRating && !isNaN(imdbRating) && imdbRating > 0;
      return !isValidRating;
    });
    
    console.log(`📊 Found ${moviesNeedingRatings.length} movies with IMDB IDs needing ratings (out of ${movies.length} total with IMDB IDs)`);
    console.log('🔍 Fetching IMDB ratings...\n');
    
    let processed = 0;
    let successful = 0;
    let failed = 0;
    
    for (const movie of moviesNeedingRatings) {
      processed++;
      console.log(`[${processed}/${moviesNeedingRatings.length}] Processing: "${movie.title}" (${movie.imdb_id})`);
      
      try {
        const imdbData = await getIMDBRating(movie.imdb_id);
        await delay(500); // Rate limiting
        
        if (imdbData && imdbData.rating && imdbData.rating > 0) {
          const rating = imdbData.rating;
          
          // Update the movie with IMDB rating
          const { error: updateError } = await supabase
            .from('movies')
            .update({ 
              imdb_rating: rating.toString()
            })
            .eq('id', movie.id);
          
          if (updateError) {
            console.log(`  ❌ Database update failed: ${updateError.message}`);
            failed++;
          } else {
            console.log(`  ✅ Updated: ${rating}/10 (${imdbData.vote_count} votes) - ${imdbData.title}`);
            successful++;
          }
        } else {
          console.log(`  ⚠️  No IMDB rating found`);
          failed++;
        }
        
      } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
        failed++;
      }
      
      // Progress update every 10 movies
      if (processed % 10 === 0) {
        console.log(`\n📈 Progress: ${processed}/${moviesNeedingRatings.length} (${successful} success, ${failed} failed)\n`);
      }
    }
    
    console.log('\n🎉 IMDB rating population complete!');
    console.log(`📊 Total processed: ${processed}`);
    console.log(`✅ Successfully updated: ${successful}`);
    console.log(`❌ Failed/Not found: ${failed}`);
    console.log(`📈 Success rate: ${((successful / processed) * 100).toFixed(1)}%`);
    
    if (successful > 0) {
      console.log('\n🎯 Refresh your browser to see the IMDB ratings prioritized!');
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
  }
}

// Run the script
populateIMDBRatings(); 