import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';


export async function POST(request: NextRequest) {
  try {
    // Initialize Supabase client inside the handler
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { imdbId, metadata } = await request.json();

    if (!imdbId || !metadata) {
      return NextResponse.json({ error: 'IMDB ID and metadata are required' }, { status: 400 });
    }

    // Generate UUID for the movie
    const movieId = uuidv4();

    // Default age scores (will be updated after Claude analysis)
    const defaultAgeScores = {
      '24m': null,
      '36m': null,
      '48m': null,
      '60m': null
    };

    // Create movie record
    const movieData = {
      id: movieId,
      title: metadata.title,
      summary: metadata.summary,
      poster_url: metadata.poster_url,
      rating: metadata.rating,
      release_year: metadata.release_year,
      tmdb_poster_url: metadata.tmdb_poster_url,
      tmdb_rating: metadata.tmdb_rating,
      tmdb_description: metadata.tmdb_description,
      tmdb_updated_at: metadata.tmdb_updated_at,
      imdb_id: imdbId,
      imdb_rating: metadata.imdb_rating, // Include IMDB rating from metadata
      is_active: true,
      age_scores: defaultAgeScores
    };

    const { data: movie, error } = await supabase
      .from('movies')
      .insert([movieData])
      .select()
      .single();

    if (error) {
      console.error('Database error creating movie:', error);
      return NextResponse.json({ error: 'Failed to create movie record' }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      movieId: movie.id,
      title: movie.title
    });

  } catch (error) {
    console.error('Error creating movie:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 