import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function validateMovieData(movie: any): { valid: boolean; reason?: string } {
  if (!movie.title || movie.title.trim().length === 0) {
    return { valid: false, reason: 'Movie title is missing' };
  }

  if (!movie.imdb_id) {
    return { valid: false, reason: 'IMDB ID is missing' };
  }

  if (!movie.summary || movie.summary.trim().length === 0) {
    return { valid: false, reason: 'Movie summary is missing' };
  }

  return { valid: true };
}

function validateSubtitleData(subtitle: any): { valid: boolean; reason?: string } {
  if (!subtitle || !subtitle.subtitle_text) {
    return { valid: false, reason: 'Subtitle text is missing' };
  }

  const content = subtitle.subtitle_text;

  if (content.length < 100) {
    return { valid: false, reason: 'Subtitle content is too short (minimum 100 characters)' };
  }

  // Check if it's corrupted HTML
  if (content.includes('<!DOCTYPE html>') || content.includes('<html')) {
    return { valid: false, reason: 'Subtitle content appears to be HTML, not subtitle text' };
  }

  // Check if it's corrupted YTS-Subs data
  if (content.includes('yts-subs.com') || content.includes('YIFY subtitles')) {
    return { valid: false, reason: 'Subtitle content appears to be corrupted YTS-Subs data' };
  }

  // Check for basic SRT format patterns
  const hasTimestamps = /\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/.test(content);
  const hasSequenceNumbers = /^\d+$/m.test(content);
  
  if (!hasTimestamps && !hasSequenceNumbers) {
    return { valid: false, reason: 'Subtitle content does not appear to be in valid SRT format' };
  }

  return { valid: true };
}

export async function POST(request: NextRequest) {
  try {
    const { movieId } = await request.json();

    if (!movieId) {
      return NextResponse.json({ error: 'Movie ID is required' }, { status: 400 });
    }

    // Get movie data
    const { data: movie, error: movieError } = await supabase
      .from('movies')
      .select('*')
      .eq('id', movieId)
      .single();

    if (movieError || !movie) {
      return NextResponse.json({ 
        valid: false, 
        reason: 'Movie not found' 
      }, { status: 404 });
    }

    // Validate movie data
    const movieValidation = validateMovieData(movie);
    if (!movieValidation.valid) {
      return NextResponse.json({ 
        valid: false, 
        reason: `Movie data invalid: ${movieValidation.reason}` 
      });
    }

    // Get subtitle data
    const { data: subtitle, error: subtitleError } = await supabase
      .from('subtitles')
      .select('*')
      .eq('movie_id', movieId)
      .single();

    if (subtitleError || !subtitle) {
      return NextResponse.json({ 
        valid: false, 
        reason: 'Subtitle data not found' 
      });
    }

    // Validate subtitle data
    const subtitleValidation = validateSubtitleData(subtitle);
    if (!subtitleValidation.valid) {
      return NextResponse.json({ 
        valid: false, 
        reason: `Subtitle data invalid: ${subtitleValidation.reason}` 
      });
    }

    // Additional checks
    const checks = {
      hasTitle: !!movie.title,
      hasImdbId: !!movie.imdb_id,
      hasSummary: !!movie.summary,
      hasPosterUrl: !!movie.poster_url,
      hasSubtitles: !!subtitle.subtitle_text,
      subtitleLength: subtitle.subtitle_text.length,
      subtitleFormat: subtitle.file_format,
      subtitleSource: subtitle.source
    };

    return NextResponse.json({ 
      valid: true,
      checks,
      message: 'Movie and subtitle data validation passed'
    });

  } catch (error) {
    console.error('Error validating movie data:', error);
    return NextResponse.json({ 
      valid: false,
      reason: 'Internal server error during validation'
    }, { status: 500 });
  }
} 