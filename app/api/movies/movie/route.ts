import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Get movie ID from search params
    const { searchParams } = new URL(request.url);
    const movieId = searchParams.get('id');

    if (!movieId) {
      return NextResponse.json({ 
        success: false,
        error: 'Movie ID is required' 
      }, { status: 400 });
    }

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
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });

  } catch (error) {
    console.error('Error fetching movie details:', error);
    return NextResponse.json({ 
      success: false,
      error: 'Internal server error' 
    }, { status: 500 });
  }
}
