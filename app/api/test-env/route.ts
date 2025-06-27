import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const envVars = {
      NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      TMDB_API_KEY: !!process.env.TMDB_API_KEY,
      NODE_ENV: process.env.NODE_ENV,
      // Don't expose actual values, just check if they exist
      supabaseUrlLength: process.env.NEXT_PUBLIC_SUPABASE_URL?.length || 0,
      serviceKeyLength: process.env.SUPABASE_SERVICE_ROLE_KEY?.length || 0,
      tmdbKeyLength: process.env.TMDB_API_KEY?.length || 0
    };

    console.log('Environment variables check:', envVars);

    return NextResponse.json({
      status: 'Environment variables checked',
      variables: envVars,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error checking environment variables:', error);
    return NextResponse.json({ 
      error: 'Failed to check environment variables',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 