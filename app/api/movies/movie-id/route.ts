import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  console.log('Static API Route called');
  console.log('Request URL:', request.url);
  
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Hard-code the movie ID for testing
    const movieId = 'b2c3d4e5-f6a7-4890-b2c3-d4e5f6a78901';
    console.log('Movie ID:', movieId);

    // Fetch movie details
    const { data: movie, error: movieError } = await supabase
      .from('movies')
      .select('*')
      .eq('id', movieId)
      .single();

    if (movieError) {
      return NextResponse.json({ 
        success: false,
        error: `Movie not found: ${movieError.message}` 
      }, { status: 404 });
    }

    // Fetch scenes for this movie
    const { data: scenes, error: scenesError } = await supabase
      .from('scenes')
      .select('*')
      .eq('movie_id', movieId)
      .order('timestamp_start');

    if (scenesError) {
      console.error('Error fetching scenes:', scenesError);
      // Don't fail the entire request if scenes fail, just return empty array
    }

    return NextResponse.json({ 
      success: true,
      movie,
      scenes: scenes || []
    });

  } catch (error) {
    console.error('Error fetching movie details:', error);
    return NextResponse.json({ 
      success: false,
      error: 'Internal server error' 
    }, { status: 500 });
  }
}


