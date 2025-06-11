import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// TMDB API configuration
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function searchTMDBByTitle(title, imdbId = null) {
  try {
    let url;
    
    if (imdbId) {
      // Search by IMDB ID first (more accurate)
      url = `${TMDB_BASE_URL}/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
    } else {
      // Search by title
      url = `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}`;
    }
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`TMDB API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (imdbId && data.movie_results && data.movie_results.length > 0) {
      return data.movie_results[0];
    } else if (!imdbId && data.results && data.results.length > 0) {
      // Return the first result when searching by title
      return data.results[0];
    }
    
    return null;
  } catch (error) {
    console.error(`Error searching TMDB for "${title}":`, error.message);
    return null;
  }
}

function extractYearFromDate(dateString) {
  if (!dateString) return null;
  const year = dateString.split('-')[0];
  return year && year.length === 4 ? parseInt(year) : null;
}

async function populateYearsFromTMDB() {
  console.log('🎬 Populating release years from TMDB API...\n');
  
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
    // Get movies that don't have release_year populated yet
    const { data: movies, error } = await supabase
      .from('movies')
      .select('id, title, imdb_id, release_year')
      .is('release_year', null);
    
    if (error) {
      console.error('❌ Error fetching movies:', error.message);
      return;
    }
    
    console.log(`📊 Found ${movies.length} movies without release years`);
    console.log('🔍 Searching TMDB for release years...\n');
    
    let processed = 0;
    let successful = 0;
    let failed = 0;
    
    for (const movie of movies) {
      processed++;
      console.log(`[${processed}/${movies.length}] Processing: "${movie.title}"`);
      
      try {
        // Search TMDB by IMDB ID first (more accurate), then by title
        const tmdbMovie = await searchTMDBByTitle(movie.title, movie.imdb_id);
        await delay(250); // Rate limiting for TMDB API
        
        if (tmdbMovie && tmdbMovie.release_date) {
          const releaseYear = extractYearFromDate(tmdbMovie.release_date);
          
          if (releaseYear) {
            // Update the movie with release year
            const { error: updateError } = await supabase
              .from('movies')
              .update({ release_year: releaseYear })
              .eq('id', movie.id);
            
            if (updateError) {
              console.log(`  ❌ Database update failed: ${updateError.message}`);
              failed++;
            } else {
              console.log(`  ✅ Found and updated: ${releaseYear} (${tmdbMovie.title})`);
              successful++;
            }
          } else {
            console.log(`  ⚠️  Invalid date format: ${tmdbMovie.release_date}`);
            failed++;
          }
        } else {
          console.log(`  ⚠️  Not found in TMDB`);
          failed++;
        }
        
      } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
        failed++;
      }
      
      // Progress update every 10 movies
      if (processed % 10 === 0) {
        console.log(`\n📈 Progress: ${processed}/${movies.length} (${successful} success, ${failed} failed)\n`);
      }
    }
    
    console.log('\n🎉 TMDB population complete!');
    console.log(`📊 Total processed: ${processed}`);
    console.log(`✅ Successfully updated: ${successful}`);
    console.log(`❌ Failed/Not found: ${failed}`);
    console.log(`📈 Success rate: ${((successful / processed) * 100).toFixed(1)}%`);
    
    if (successful > 0) {
      console.log('\n🎯 Refresh your browser to see the new year tags!');
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
  }
}

// Run the script
populateYearsFromTMDB(); 