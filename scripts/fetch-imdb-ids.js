import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use service role key for write operations
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// TMDB Configuration
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Rate limiting
const DELAY_MS = 250; // 4 requests per second to stay under TMDB limits

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function searchTMDBForMovie(title) {
  try {
    const searchUrl = `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}`;
    const response = await fetch(searchUrl);
    
    if (!response.ok) {
      throw new Error(`TMDB API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.results && data.results.length > 0) {
      // Get the first (most relevant) result
      const movie = data.results[0];
      return movie.id;
    }
    
    return null;
  } catch (error) {
    console.error(`Error searching TMDB for "${title}":`, error.message);
    return null;
  }
}

async function getTMDBMovieDetails(tmdbId) {
  try {
    const detailsUrl = `${TMDB_BASE_URL}/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const response = await fetch(detailsUrl);
    
    if (!response.ok) {
      throw new Error(`TMDB API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.imdb_id; // This will be in format "tt1234567"
  } catch (error) {
    console.error(`Error getting TMDB details for ID ${tmdbId}:`, error.message);
    return null;
  }
}

async function updateMovieImdbId(movieId, imdbId) {
  try {
    const { error } = await supabase
      .from('movies')
      .update({ imdb_id: imdbId })
      .eq('id', movieId);
    
    if (error) {
      throw error;
    }
    
    return true;
  } catch (error) {
    console.error(`Error updating movie ${movieId}:`, error.message);
    return false;
  }
}

async function fetchImdbIds() {
  console.log('🎬 Starting IMDB ID fetch process...\n');
  
  // Check environment variables
  if (!supabaseUrl || !supabaseServiceKey || !TMDB_API_KEY) {
    console.error('❌ Missing required environment variables:');
    console.error('- NEXT_PUBLIC_SUPABASE_URL:', !!supabaseUrl);
    console.error('- SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey);
    console.error('- TMDB_API_KEY:', !!TMDB_API_KEY);
    process.exit(1);
  }
  
  try {
    // Get all movies without IMDB IDs
    const { data: movies, error } = await supabase
      .from('movies')
      .select('id, title, imdb_id')
      .is('imdb_id', null);
    
    if (error) {
      throw error;
    }
    
    console.log(`📊 Found ${movies.length} movies without IMDB IDs\n`);
    
    let processed = 0;
    let successful = 0;
    let failed = 0;
    
    for (const movie of movies) {
      processed++;
      console.log(`[${processed}/${movies.length}] Processing: "${movie.title}"`);
      
      try {
        // Search TMDB for the movie
        const tmdbId = await searchTMDBForMovie(movie.title);
        await delay(DELAY_MS);
        
        if (!tmdbId) {
          console.log(`  ⚠️  No TMDB match found`);
          failed++;
          continue;
        }
        
        // Get IMDB ID from TMDB details
        const imdbId = await getTMDBMovieDetails(tmdbId);
        await delay(DELAY_MS);
        
        if (!imdbId) {
          console.log(`  ⚠️  No IMDB ID found in TMDB`);
          failed++;
          continue;
        }
        
        // Update the movie in Supabase
        const updateSuccess = await updateMovieImdbId(movie.id, imdbId);
        
        if (updateSuccess) {
          console.log(`  ✅ Updated with IMDB ID: ${imdbId}`);
          successful++;
        } else {
          console.log(`  ❌ Failed to update database`);
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
    
    console.log('\n🎉 IMDB ID fetch complete!');
    console.log(`📊 Total processed: ${processed}`);
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Success rate: ${((successful / processed) * 100).toFixed(1)}%`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the script
fetchImdbIds(); 