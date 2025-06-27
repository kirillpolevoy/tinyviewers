import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';


export async function POST(request: NextRequest) {
  try {
    // Check environment variables first
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl) {
      console.error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
      return NextResponse.json({ 
        error: 'Configuration error: Missing Supabase URL' 
      }, { status: 500 });
    }

    if (!supabaseKey) {
      console.error('Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable');
      return NextResponse.json({ 
        error: 'Configuration error: Missing Supabase key' 
      }, { status: 500 });
    }

    // Initialize Supabase client inside the handler
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { imdbId } = await request.json();

    if (!imdbId) {
      return NextResponse.json({ error: 'IMDB ID is required' }, { status: 400 });
    }

    console.log(`Checking existence for IMDB ID: ${imdbId}`);

    // Check if movie with this IMDB ID already exists
    const { data: existingMovie, error } = await supabase
      .from('movies')
      .select('id, title')
      .eq('imdb_id', imdbId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is "not found" error
      console.error('Database error:', error);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    if (existingMovie) {
      console.log(`Movie exists: ${existingMovie.title} (ID: ${existingMovie.id})`);
      return NextResponse.json({ 
        exists: true, 
        title: existingMovie.title,
        movieId: existingMovie.id
      });
    }

    console.log('Movie does not exist in database');
    return NextResponse.json({ exists: false });

  } catch (error) {
    console.error('Error checking movie existence:', error);
    // Provide more detailed error information
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('Error stack:', errorStack);
    
    return NextResponse.json({ 
      error: 'Internal server error',
      details: errorMessage
    }, { status: 500 });
  }
} 