import { NextRequest, NextResponse } from 'next/server';

// TMDB API configuration
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

async function searchTMDBByImdbId(imdbId: string) {
  try {
    const url = `${TMDB_BASE_URL}/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`TMDB API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.movie_results && data.movie_results.length > 0) {
      return data.movie_results[0];
    }
    
    return null;
  } catch (error) {
    console.error(`Error searching TMDB for IMDB ID "${imdbId}":`, error);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { imdbId } = await request.json();

    if (!imdbId) {
      return NextResponse.json({ error: 'IMDB ID is required' }, { status: 400 });
    }

    if (!TMDB_API_KEY) {
      return NextResponse.json({ error: 'TMDB API key not configured' }, { status: 500 });
    }

    // Search TMDB by IMDB ID
    const tmdbMovie = await searchTMDBByImdbId(imdbId);
    
    if (!tmdbMovie) {
      return NextResponse.json({ error: 'Movie not found in TMDB' }, { status: 404 });
    }

    // Extract and format movie data
    const movieData = {
      title: tmdbMovie.title,
      summary: tmdbMovie.overview || 'No summary available',
      poster_url: tmdbMovie.poster_path 
        ? `https://image.tmdb.org/t/p/w500${tmdbMovie.poster_path}` 
        : null,
      rating: tmdbMovie.vote_average ? tmdbMovie.vote_average.toString() : '0',
      release_year: tmdbMovie.release_date 
        ? new Date(tmdbMovie.release_date).getFullYear() 
        : null,
      tmdb_poster_url: tmdbMovie.poster_path 
        ? `https://image.tmdb.org/t/p/w500${tmdbMovie.poster_path}` 
        : null,
      tmdb_rating: tmdbMovie.vote_average ? tmdbMovie.vote_average.toString() : null,
      tmdb_description: tmdbMovie.overview || null,
      tmdb_updated_at: new Date().toISOString(),
      imdb_id: imdbId,
      // Set IMDB rating same as TMDB rating since TMDB aggregates from multiple sources including IMDB
      imdb_rating: tmdbMovie.vote_average ? tmdbMovie.vote_average.toString() : null,
      is_active: true
    };

    return NextResponse.json(movieData);

  } catch (error) {
    console.error('Error fetching movie metadata:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch movie metadata from TMDB' 
    }, { status: 500 });
  }
} 