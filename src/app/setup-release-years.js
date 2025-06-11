import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// TMDB API configuration
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Function to extract year from title (fallback method)
function extractYearFromTitle(title) {
  const yearMatch = title.match(/\((\d{4})\)/);
  return yearMatch ? parseInt(yearMatch[1]) : null;
}

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

async function setupReleaseYears() {
  console.log('🎬 Setting up release years for movies...\n');
  
  // Check environment variables
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing required environment variables:');
    console.error('- NEXT_PUBLIC_SUPABASE_URL:', !!supabaseUrl);
    console.error('- SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey);
    process.exit(1);
  }
  
  if (!TMDB_API_KEY) {
    console.log('⚠️  TMDB_API_KEY not found, will only extract years from titles');
  }
  
  try {
    // Step 1: Get all movies
    const { data: movies, error } = await supabase
      .from('movies')
      .select('id, title, imdb_id');
    
    if (error) {
      throw error;
    }
    
    console.log(`📊 Found ${movies.length} movies to process\n`);
    
    let processed = 0;
    let successful = 0;
    let failed = 0;
    
    for (const movie of movies) {
      processed++;
      console.log(`[${processed}/${movies.length}] Processing: "${movie.title}"`);
      
      let releaseYear = null;
      
      try {
        // Method 1: Extract from title
        releaseYear = extractYearFromTitle(movie.title);
        if (releaseYear) {
          console.log(`  📅 Year from title: ${releaseYear}`);
        }
        
        // Method 2: Use TMDB API if available and no year from title
        if (!releaseYear && TMDB_API_KEY) {
          const tmdbMovie = await searchTMDBByTitle(movie.title, movie.imdb_id);
          await delay(250); // Rate limiting
          
          if (tmdbMovie) {
            releaseYear = extractYearFromDate(tmdbMovie.release_date);
            if (releaseYear) {
              console.log(`  📅 Year from TMDB: ${releaseYear}`);
            }
          }
        }
        
        if (releaseYear) {
          // Update the movie with release year
          const { error: updateError } = await supabase
            .from('movies')
            .update({ release_year: releaseYear })
            .eq('id', movie.id);
          
          if (updateError) {
            console.log(`  ❌ Failed to update database: ${updateError.message}`);
            failed++;
            continue;
          }
          
          console.log(`  ✅ Updated with year: ${releaseYear}`);
          successful++;
        } else {
          console.log(`  ⚠️  No year found`);
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
    
    console.log('\n🎉 Release year setup complete!');
    console.log(`📊 Total processed: ${processed}`);
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Success rate: ${((successful / processed) * 100).toFixed(1)}%`);
    
    console.log('\n🎯 Your movies now have years! Refresh your browser to see them as tags next to ratings.');
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the script
setupReleaseYears(); 