import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Try to get one movie to see the actual schema
    const { data: movies, error } = await supabase
      .from('movies')
      .select('*')
      .limit(1);

    if (error) {
      return NextResponse.json({ 
        error: 'Database error',
        details: error.message,
        code: error.code
      }, { status: 500 });
    }

    const schema = movies && movies.length > 0 ? {
      columns: Object.keys(movies[0]),
      sampleData: movies[0],
      totalMovies: movies.length
    } : {
      columns: [],
      sampleData: null,
      totalMovies: 0
    };

    return NextResponse.json({ 
      success: true,
      schema: schema,
      environment: {
        hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        usingServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY
      }
    });

  } catch (error) {
    console.error('Error checking schema:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 