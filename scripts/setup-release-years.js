import { createClient } from '@supabase/supabase-js';
import { MovieDb } from 'moviedb-promise';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const tmdb = new MovieDb(process.env.NEXT_PUBLIC_TMDB_API_KEY);

// Known Disney animated movies with their release years
const KNOWN_MOVIES = {
  'moana': 2016,
  'frozen': 2013,
  'tangled': 2010,
  'encanto': 2021,
  'coco': 2017,
};

async function getMovieDetails(title) {
  try {
    console.log(`🎬 Fetching TMDB data for: "${title}"`);
    
    const searchResults = await tmdb.searchMovie({ 
      query: title,
      include_adult: false,
    });
    
    if (searchResults.results && searchResults.results.length > 0) {
      console.log(`Found ${searchResults.results.length} results for "${title}"`);

      // Try to find the exact movie we want
      let movie = searchResults.results[0]; // Default to first result
      const lowercaseTitle = title.toLowerCase();
      
      // If it's a known movie, try to find the exact match by year
      if (lowercaseTitle in KNOWN_MOVIES) {
        const expectedYear = KNOWN_MOVIES[lowercaseTitle];
        const exactMatch = searchResults.results.find(result => 
          result.release_date?.startsWith(expectedYear.toString()) &&
          (result.title?.toLowerCase() === lowercaseTitle || 
           result.original_title?.toLowerCase() === lowercaseTitle)
        );
        if (exactMatch) {
          movie = exactMatch;
        }
      } else {
        // For unknown movies, try to find the most popular exact title match
        const exactMatches = searchResults.results.filter(result =>
          (result.title?.toLowerCase() === lowercaseTitle || 
           result.original_title?.toLowerCase() === lowercaseTitle)
        );
        if (exactMatches.length > 0) {
          // Sort by popularity and take the most popular one
          movie = exactMatches.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0];
        }
      }

      console.log(`Selected movie: "${movie.title}" (${movie.release_date})`);

      const poster = movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null;
      const description = movie.overview || null;
      
      // Fetch rating/certification from TMDB
      let rating = null;
      if (movie.id) {
        try {
          const releaseDates = await tmdb.movieReleaseDates(movie.id);
          // Look for US certification
          const usRelease = releaseDates.results?.find(release => release.iso_3166_1 === 'US');
          if (usRelease && usRelease.release_dates && usRelease.release_dates.length > 0) {
            // Find the release with certification (usually theatrical release)
            const certifiedRelease = usRelease.release_dates.find(rd => rd.certification && rd.certification.trim() !== '');
            if (certifiedRelease && certifiedRelease.certification) {
              rating = certifiedRelease.certification;
            }
          }
        } catch (error) {
          console.log(`Could not fetch rating for "${movie.title}":`, error.message);
        }
      }
      
      console.log(`✅ TMDB data for "${title}":`, {
        poster,
        description: description ? 'Has description' : 'No description',
        rating
      });
      
      return {
        poster,
        description,
        rating
      };
    } else {
      console.log(`❌ No results found for "${title}"`);
      return {
        poster: null,
        description: null,
        rating: null
      };
    }
  } catch (error) {
    console.error(`❌ Error fetching TMDB data for "${title}":`, error.message);
    return {
      poster: null,
      description: null,
      rating: null
    };
  }
}

async function populateMovieData() {
  try {
    console.log('🚀 Starting TMDB data population...');
    console.log('⚠️  NOTE: Make sure you have run the SQL script in scripts/add-tmdb-columns.sql first!');
    
    // Test if columns exist by trying to select them
    const { data: testData, error: testError } = await supabase
      .from('movies')
      .select('id, title, tmdb_poster_url')
      .limit(1);
    
    if (testError) {
      if (testError.message.includes('tmdb_poster_url does not exist')) {
        console.error('\n❌ TMDB columns do not exist!');
        console.error('Please run the SQL script first:');
        console.error('1. Go to your Supabase dashboard');
        console.error('2. Open the SQL Editor');
        console.error('3. Run the script in scripts/add-tmdb-columns.sql');
        console.error('4. Then run this script again\n');
        return;
      } else {
        console.error('Database test error:', testError);
        return;
      }
    }
    
    console.log('✅ TMDB columns exist, proceeding with data population...\n');
    
    // Fetch all movies from the database that don't have TMDB data yet
    const { data: movies, error } = await supabase
      .from('movies')
      .select('id, title, tmdb_poster_url')
      .or('tmdb_poster_url.is.null,tmdb_poster_url.eq.');
    
    if (error) {
      console.error('Error fetching movies:', error);
      return;
    }

    console.log(`📊 Found ${movies.length} movies to update`);
    
    if (movies.length === 0) {
      console.log('🎉 All movies already have TMDB data!');
      return;
    }
    
    // Process movies in batches to avoid rate limiting
    const batchSize = 3;
    for (let i = 0; i < movies.length; i += batchSize) {
      const batch = movies.slice(i, i + batchSize);
      console.log(`\n📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(movies.length/batchSize)}`);
      
      const updates = await Promise.all(
        batch.map(async (movie) => {
          const tmdbData = await getMovieDetails(movie.title);
          
          // Add delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 250));
          
          return {
            id: movie.id,
            tmdb_poster_url: tmdbData.poster,
            tmdb_rating: tmdbData.rating,
            tmdb_description: tmdbData.description,
            tmdb_updated_at: new Date().toISOString()
          };
        })
      );
      
      // Update database in batch
      for (const update of updates) {
        const { error: updateError } = await supabase
          .from('movies')
          .update({
            tmdb_poster_url: update.tmdb_poster_url,
            tmdb_rating: update.tmdb_rating,
            tmdb_description: update.tmdb_description,
            tmdb_updated_at: update.tmdb_updated_at
          })
          .eq('id', update.id);
        
        if (updateError) {
          console.error(`❌ Error updating movie ${update.id}:`, updateError);
        } else {
          console.log(`✅ Updated movie: ${update.id}`);
        }
      }
      
      console.log(`✅ Completed batch ${Math.floor(i/batchSize) + 1}`);
      
      // Add delay between batches
      if (i + batchSize < movies.length) {
        console.log('⏳ Waiting before next batch...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log('\n🎉 TMDB data population completed!');
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
  }
}

// Run the migration
populateMovieData().then(() => {
  console.log('✅ Script finished');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});

export { populateMovieData, getMovieDetails }; 