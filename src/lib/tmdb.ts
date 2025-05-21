import { MovieDb } from 'moviedb-promise';

if (!process.env.NEXT_PUBLIC_TMDB_API_KEY) {
  throw new Error('TMDB API key is not set in environment variables');
}

export const tmdb = new MovieDb(process.env.NEXT_PUBLIC_TMDB_API_KEY);

// Known Disney animated movies with their release years
const KNOWN_MOVIES: Record<string, number> = {
  'moana': 2016,
  'frozen': 2013,
  'tangled': 2010,
  'encanto': 2021,
  'coco': 2017,
} as const;

export const getMoviePoster = async (title: string): Promise<string | null> => {
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
    console.error('Error fetching movie poster:', error);
    return null;
  }
}; 