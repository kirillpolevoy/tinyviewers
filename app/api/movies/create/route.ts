import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';


export async function POST(request: NextRequest) {
  try {
    // Log environment variables for debugging
    console.log('Environment check:', {
      hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      supabaseUrlLength: process.env.NEXT_PUBLIC_SUPABASE_URL?.length || 0,
      serviceKeyLength: process.env.SUPABASE_SERVICE_ROLE_KEY?.length || 0,
      anonKeyLength: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.length || 0,
      usingServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY
    });

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

    // Use the original age scores structure from the database schema
    const defaultAgeScores = {
      '12m': 0,
      '24m': 0,
      '36m': 0
    };

    // Create movie record with only the columns that exist in the database
    const movieData = {
      id: movieId,
      title: metadata.title,
      summary: metadata.summary,
      poster_url: metadata.poster_url,
      rating: metadata.rating,
      age_scores: defaultAgeScores,
      // Add TMDB columns if they exist
      ...(metadata.release_year && { release_year: metadata.release_year }),
      ...(metadata.tmdb_poster_url && { tmdb_poster_url: metadata.tmdb_poster_url }),
      ...(metadata.tmdb_rating && { tmdb_rating: metadata.tmdb_rating }),
      ...(metadata.tmdb_description && { tmdb_description: metadata.tmdb_description }),
      ...(metadata.tmdb_updated_at && { tmdb_updated_at: metadata.tmdb_updated_at }),
      // Add IMDB ID if the column exists
      ...(imdbId && { imdb_id: imdbId })
    };

    console.log('Attempting to create movie:', {
      movieId,
      title: metadata.title,
      imdbId,
      dataKeys: Object.keys(movieData)
    });

    const { data: movie, error } = await supabase
      .from('movies')
      .insert([movieData])
      .select()
      .single();

    if (error) {
      console.error('Database error creating movie:', {
        error: error,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      return NextResponse.json({ 
        error: 'Failed to create movie record',
        details: error.message,
        code: error.code
      }, { status: 500 });
    }

    console.log('Successfully created movie:', movie.id);

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