import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
// Also try the parent directory
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: '../../.env.local' });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// TMDB API configuration
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function cleanTitle(title) {
  // Remove year from title if present
  return title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
}

function extractYearFromTitle(title) {
  const match = title.match(/\((\d{4})\)/);
  return match ? parseInt(match[1]) : null;
}

async function searchTMDBImproved(title, imdbId = null, releaseYear = null) {
  try {
    let results = [];
    
    // Method 1: Search by IMDB ID if available (most accurate)
    if (imdbId) {
      const url = `${TMDB_BASE_URL}/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
      const response = await fetch(url);
      
      if (response.ok) {
        const data = await response.json();
        if (data.movie_results && data.movie_results.length > 0) {
          console.log(`  🎯 Found via IMDB ID: ${data.movie_results[0].title}`);
          return data.movie_results[0];
        }
      }
    }
    
    // Method 2: Search by cleaned title
    const cleanedTitle = cleanTitle(title);
    const searchUrl = `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanedTitle)}`;
    const searchResponse = await fetch(searchUrl);
    
    if (!searchResponse.ok) {
      throw new Error(`TMDB API error: ${searchResponse.status}`);
    }
    
    const searchData = await searchResponse.json();
    results = searchData.results || [];
    
    if (results.length === 0) {
      return null;
    }
    
    // Method 3: Smart filtering by year if available
    const titleYear = releaseYear || extractYearFromTitle(title);
    if (titleYear) {
      // Filter results by year (within 1 year tolerance)
      const yearMatches = results.filter(movie => {
        if (!movie.release_date) return false;
        const movieYear = parseInt(movie.release_date.split('-')[0]);
        return Math.abs(movieYear - titleYear) <= 1;
      });
      
      if (yearMatches.length > 0) {
        console.log(`  📅 Found via year match (${titleYear}): ${yearMatches[0].title}`);
        return yearMatches[0];
      }
    }
    
    // Method 4: Exact title match (case insensitive)
    const exactMatch = results.find(movie => 
      movie.title.toLowerCase() === cleanedTitle.toLowerCase() ||
      movie.original_title?.toLowerCase() === cleanedTitle.toLowerCase()
    );
    
    if (exactMatch) {
      console.log(`  📝 Found via exact title match: ${exactMatch.title}`);
      return exactMatch;
    }
    
    // Method 5: Best match by popularity (first result)
    if (results.length > 0) {
      console.log(`  🎲 Using best match by popularity: ${results[0].title} (${results[0].release_date})`);
      return results[0];
    }
    
    return null;
  } catch (error) {
    console.error(`Error searching TMDB for "${title}":`, error.message);
    return null;
  }
}

async function populateRatingsImproved() {
  console.log('🎬 Populating ratings from TMDB API (improved version)...\n');
  
  // Check environment variables
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing Supabase credentials');
    process.exit(1);
  }
  
  if (!TMDB_API_KEY) {
    console.error('❌ Missing TMDB_API_KEY in .env.local');
    console.log('Please add your TMDB API key to .env.local:');
    console.log('TMDB_API_KEY=your_api_key_here');
    process.exit(1);
  }
  
  try {
    // Get ALL movies that don't have numerical TMDB ratings yet
    const { data: movies, error } = await supabase
      .from('movies')
      .select('id, title, imdb_id, tmdb_rating, rating, release_year')
      .order('title'); // Get all remaining movies
    
    if (error) {
      console.error('❌ Error fetching movies:', error.message);
      return;
    }
    
    // Filter movies that need ratings
    const moviesNeedingRatings = movies.filter(movie => {
      const tmdbRating = movie.tmdb_rating ? parseFloat(movie.tmdb_rating) : null;
      const isValidRating = tmdbRating && !isNaN(tmdbRating) && tmdbRating > 0;
      return !isValidRating;
    });
    
    console.log(`📊 Found ${moviesNeedingRatings.length} movies needing ratings (out of ${movies.length} total)`);
    console.log('🔍 Searching TMDB for ratings...\n');
    
    let processed = 0;
    let successful = 0;
    let failed = 0;
    
    for (const movie of moviesNeedingRatings) {
      processed++;
      console.log(`[${processed}/${moviesNeedingRatings.length}] Processing: "${movie.title}"`);
      
      try {
        // Use improved search
        const tmdbMovie = await searchTMDBImproved(movie.title, movie.imdb_id, movie.release_year);
        await delay(300); // Rate limiting for TMDB API
        
        if (tmdbMovie && tmdbMovie.vote_average && tmdbMovie.vote_average > 0) {
          const rating = tmdbMovie.vote_average;
          
          // Update the movie with TMDB rating
          const { error: updateError } = await supabase
            .from('movies')
            .update({ 
              tmdb_rating: rating.toString(),
              // Also update the general rating field if it's empty or not numerical
              rating: (movie.rating && !isNaN(parseFloat(movie.rating))) ? movie.rating : rating.toString()
            })
            .eq('id', movie.id);
          
          if (updateError) {
            console.log(`  ❌ Database update failed: ${updateError.message}`);
            failed++;
          } else {
            console.log(`  ✅ Updated: ${rating}/10 (${tmdbMovie.title}) - ${tmdbMovie.vote_count} votes`);
            successful++;
          }
        } else {
          console.log(`  ⚠️  No rating found or rating is 0`);
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
    
    console.log('\n🎉 TMDB rating population complete!');
    console.log(`📊 Total processed: ${processed}`);
    console.log(`✅ Successfully updated: ${successful}`);
    console.log(`❌ Failed/Not found: ${failed}`);
    console.log(`📈 Success rate: ${((successful / processed) * 100).toFixed(1)}%`);
    
    if (successful > 0) {
      console.log('\n🎯 Refresh your browser to see the ratings!');
      console.log('💡 Try sorting by "Highest Rated" to see the new ratings in action.');
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
  }
}

// Run the script
populateRatingsImproved(); 