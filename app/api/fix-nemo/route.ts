import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const nemoId = '43ef52c6-3e09-4e5c-a104-f9a796e66e4d';

    // Read current data
    const { data: before, error: beforeError } = await supabase
      .from('movies')
      .select('title, age_scores')
      .eq('id', nemoId)
      .single();

    if (beforeError) {
      return NextResponse.json({ 
        error: 'Failed to read before',
        details: beforeError.message
      }, { status: 500 });
    }

    // Update the data
    const { error: updateError } = await supabase
      .from('movies')
      .update({ 
        age_scores: {
          '24m': 3,
          '36m': 2,
          '48m': 1,
          '60m': 1
        }
      })
      .eq('id', nemoId);

    if (updateError) {
      return NextResponse.json({ 
        error: 'Failed to update',
        details: updateError.message
      }, { status: 500 });
    }

    // Read updated data
    const { data: after, error: afterError } = await supabase
      .from('movies')
      .select('title, age_scores')
      .eq('id', nemoId)
      .single();

    if (afterError) {
      return NextResponse.json({ 
        error: 'Failed to read after',
        details: afterError.message
      }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true,
      before: before.age_scores,
      after: after.age_scores,
      database: process.env.NEXT_PUBLIC_SUPABASE_URL
    });

  } catch (error) {
    console.error('Error fixing Nemo:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

