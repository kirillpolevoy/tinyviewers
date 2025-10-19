import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const movieId = searchParams.get('movieId');

    if (!movieId) {
      return NextResponse.json({ error: 'Movie ID is required' }, { status: 400 });
    }

    // Initialize Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Fetch analysis history for the specific movie
    const { data: history, error } = await supabase
      .from('analysis_history')
      .select('*')
      .eq('movie_id', movieId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching analysis history:', error);
      return NextResponse.json({ error: 'Failed to fetch analysis history' }, { status: 500 });
    }

    return NextResponse.json({ history: history || [] });

  } catch (error) {
    console.error('Error in analysis history API:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch analysis history' 
    }, { status: 500 });
  }
}
