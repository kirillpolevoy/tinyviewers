import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const ageFilter = searchParams.get('age');
    const sortBy = searchParams.get('sort') || 'title';

    let query = supabase.from('movies').select('*');

    // Apply filters
    if (search) {
      query = query.ilike('title', `%${search}%`);
    }

    if (ageFilter && ageFilter !== 'all') {
      const ageNumber = parseInt(ageFilter);
      if (!isNaN(ageNumber)) {
        const ageKey = `${ageNumber * 12}m`;
        query = query.lte(`age_scores->${ageKey}`, 2);
      }
    }

    // Execute query
    const { data: movies, error } = await query;

    if (error) {
      return NextResponse.json({ 
        success: false,
        error: error.message 
      }, { status: 500 });
    }

    // Sort movies
    if (movies) {
      movies.sort((a, b) => {
        switch (sortBy) {
          case 'rating':
            const ratingA = parseFloat(a.rating) || 0;
            const ratingB = parseFloat(b.rating) || 0;
            return ratingB - ratingA;
          case 'year':
            const yearA = a.release_year || 0;
            const yearB = b.release_year || 0;
            return yearB - yearA;
          case 'title':
          default:
            return a.title.localeCompare(b.title);
        }
      });
    }

    return NextResponse.json({ 
      success: true,
      movies: movies || []
    });

  } catch (error) {
    console.error('Error fetching movies:', error);
    return NextResponse.json({ 
      success: false,
      error: 'Internal server error' 
    }, { status: 500 });
  }
}


