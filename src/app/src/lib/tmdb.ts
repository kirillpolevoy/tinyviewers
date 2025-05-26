const TMDB_API_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY || '';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';

export async function getMoviePoster(title: string): Promise<string | null> {
  if (!TMDB_API_KEY) {
    return null;
  }

  try {
    const response = await fetch(
      `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}`
    );
    
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    
    if (data.results && data.results.length > 0 && data.results[0].poster_path) {
      return `${TMDB_IMAGE_BASE_URL}${data.results[0].poster_path}`;
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching movie poster:', error);
    return null;
  }
} 