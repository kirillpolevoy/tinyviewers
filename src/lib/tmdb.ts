import { MovieDb } from 'moviedb-promise';

// Check for API key more safely
const API_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY;

if (!API_KEY) {
  console.error('TMDB API key is not set in environment variables');
}

export const tmdb = API_KEY ? new MovieDb(API_KEY) : null;

// Simple in-memory cache to avoid duplicate API calls
const movieDetailsCache = new Map<string, TMDBMovieDetails>();

// Known Disney animated movies with their release years
const KNOWN_MOVIES: Record<string, number> = {
  'moana': 2016,
  'frozen': 2013,
  'tangled': 2010,
  'encanto': 2021,
  'coco': 2017,
} as const;

export interface TMDBMovieDetails {
  poster?: string | null;
  description?: string | null;
  rating?: string | null;
}

export const getMovieDetails = async (title: string): Promise<TMDBMovieDetails> => {
  // Check cache first to avoid duplicate API calls
  const cacheKey = title.toLowerCase().trim();
  if (movieDetailsCache.has(cacheKey)) {
    console.log(`📦 Using cached data for "${title}"`);
    return movieDetailsCache.get(cacheKey)!;
  }

  // Return empty result if no TMDB client
  if (!tmdb) {
    console.warn('TMDB client not available, returning empty movie details');
    const emptyResult = {
      poster: null,
      description: null,
      rating: null
    };
    movieDetailsCache.set(cacheKey, emptyResult);
    return emptyResult;
  }

  try {
    console.log(`🎬 Searching for movie details: "${title}"`);
    
    const searchResults = await tmdb.searchMovie({ 
      query: title,
      include_adult: false,
    });
    
    if (searchResults.results && searchResults.results.length > 0) {
      console.log(`Found ${searchResults.results.length} results for "${title}":`);
      searchResults.results.slice(0, 3).forEach((result, index) => {
        console.log(`[${index}] Title: "${result.title}", Original Title: "${result.original_title}", Release: ${result.release_date}, Popularity: ${result.popularity}`);
      });

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
      
      // Fetch rating/certification from TMDB with better error handling
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
          console.log(`Could not fetch rating for "${movie.title}":`, error instanceof Error ? error.message : error);
          // Don't throw error, just continue without rating
        }
      }
      
      console.log(`Using poster URL: ${poster}`);
      console.log(`Using description: ${description}`);
      console.log(`Using rating: ${rating}`);
      
      const result = {
        poster,
        description,
        rating
      };

      // Cache the result to avoid future API calls
      movieDetailsCache.set(cacheKey, result);
      return result;
    } else {
      console.log(`No results found for "${title}"`);
    }
    
    const emptyResult = {
      poster: null,
      description: null,
      rating: null
    };
    movieDetailsCache.set(cacheKey, emptyResult);
    return emptyResult;
  } catch (error) {
    console.error('Error fetching movie details:', error instanceof Error ? error.message : error);
    const errorResult = {
      poster: null,
      description: null,
      rating: null
    };
    movieDetailsCache.set(cacheKey, errorResult);
    return errorResult;
  }
};

export const getMoviePoster = async (title: string): Promise<string | null> => {
  // Return null if no TMDB client
  if (!tmdb) {
    console.warn('TMDB client not available, returning null poster');
    return null;
  }

  try {
    console.log(`🎬 Searching for movie: "${title}"`);
    
    const searchResults = await tmdb.searchMovie({ 
      query: title,
      include_adult: false,
    });
    
    if (searchResults.results && searchResults.results.length > 0) {
      console.log(`Found ${searchResults.results.length} results for "${title}":`);
      searchResults.results.slice(0, 3).forEach((result, index) => {
        console.log(`[${index}] Title: "${result.title}", Original Title: "${result.original_title}", Release: ${result.release_date}, Popularity: ${result.popularity}`);
      });

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

      if (movie.poster_path) {
        const posterUrl = `https://image.tmdb.org/t/p/w500${movie.poster_path}`;
        console.log(`Using poster URL: ${posterUrl}`);
        return posterUrl;
      }
    } else {
      console.log(`No results found for "${title}"`);
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching movie poster:', error instanceof Error ? error.message : error);
    return null;
  }
}; 