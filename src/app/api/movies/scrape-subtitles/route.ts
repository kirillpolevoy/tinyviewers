import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// OpenSubtitles API configuration
const OPENSUBTITLES_API_KEY = process.env.OPENSUBTITLES_API_KEY;
const OPENSUBTITLES_BASE_URL = 'https://api.opensubtitles.com/api/v1';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Try to scrape subtitles from OpenSubtitles
async function searchOpenSubtitles(imdbId: string) {
  try {
    const cleanImdbId = imdbId.replace('tt', '');
    
    const searchResponse = await fetch(`${OPENSUBTITLES_BASE_URL}/subtitles?imdb_id=${cleanImdbId}&languages=en&moviehash_match=include`, {
      headers: {
        'Api-Key': OPENSUBTITLES_API_KEY!,
        'User-Agent': 'TinyViewers v1.0',
        'Accept': 'application/json'
      }
    });

    if (!searchResponse.ok) {
      console.log(`OpenSubtitles search failed: ${searchResponse.status}`);
      return null;
    }

    const searchData = await searchResponse.json();
    
    if (!searchData.data || searchData.data.length === 0) {
      console.log('No subtitles found in OpenSubtitles');
      return null;
    }

    // Get the first subtitle that looks good
    const subtitle = searchData.data.find((sub: any) => 
      sub.attributes.language === 'en' && 
      sub.attributes.download_count > 0
    ) || searchData.data[0];

    return subtitle;
    
  } catch (error) {
    console.error('Error searching OpenSubtitles:', error);
    return null;
  }
}

async function downloadSubtitleContent(subtitle: any) {
  try {
    const downloadResponse = await fetch(`${OPENSUBTITLES_BASE_URL}/download`, {
      method: 'POST',
      headers: {
        'Api-Key': OPENSUBTITLES_API_KEY!,
        'User-Agent': 'TinyViewers v1.0',
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        file_id: subtitle.attributes.files[0].file_id,
        sub_format: 'srt'
      })
    });

    if (!downloadResponse.ok) {
      console.log(`Download failed: ${downloadResponse.status}`);
      return null;
    }

    const downloadData = await downloadResponse.json();
    
    if (!downloadData.link) {
      console.log('No download link received');
      return null;
    }

    // Download the actual subtitle file
    const fileResponse = await fetch(downloadData.link);
    
    if (!fileResponse.ok) {
      console.log(`File download failed: ${fileResponse.status}`);
      return null;
    }

    const subtitleContent = await fileResponse.text();
    
    // Basic validation
    if (!subtitleContent || subtitleContent.length < 100) {
      console.log('Downloaded subtitle content is too short');
      return null;
    }

    return subtitleContent;
    
  } catch (error) {
    console.error('Error downloading subtitle:', error);
    return null;
  }
}

async function saveSubtitleToDatabase(movieId: string, subtitleContent: string, source: string) {
  try {
    const { error } = await supabase
      .from('subtitles')
      .insert({
        movie_id: movieId,
        subtitle_text: subtitleContent,
        language: 'en',
        source: source,
        file_format: 'srt'
      });

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    console.error(`Error saving subtitle for movie ${movieId}:`, error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { movieId, imdbId, title } = await request.json();

    if (!movieId || !imdbId) {
      return NextResponse.json({ error: 'Movie ID and IMDB ID are required' }, { status: 400 });
    }

    if (!OPENSUBTITLES_API_KEY) {
      return NextResponse.json({ 
        success: false, 
        error: 'OpenSubtitles API key not configured' 
      });
    }

    console.log(`🎬 Scraping subtitles for: "${title}" (${imdbId})`);

    // Try OpenSubtitles first
    const subtitle = await searchOpenSubtitles(imdbId);
    await delay(1000); // Rate limiting

    if (!subtitle) {
      console.log('No subtitles found from OpenSubtitles');
      return NextResponse.json({ 
        success: false, 
        error: 'No subtitles found' 
      });
    }

    console.log(`📄 Found subtitle: ${subtitle.attributes.release}`);

    // Download subtitle content
    const subtitleContent = await downloadSubtitleContent(subtitle);
    await delay(1000); // Rate limiting

    if (!subtitleContent) {
      console.log('Failed to download subtitle content');
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to download subtitle content' 
      });
    }

    console.log(`💾 Downloaded ${subtitleContent.length} characters`);

    // Save to database
    const saveSuccess = await saveSubtitleToDatabase(movieId, subtitleContent, 'opensubtitles');

    if (saveSuccess) {
      console.log('✅ Saved to database');
      return NextResponse.json({ 
        success: true,
        subtitleLength: subtitleContent.length,
        source: 'opensubtitles'
      });
    } else {
      console.log('❌ Failed to save to database');
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to save subtitle to database' 
      });
    }

  } catch (error) {
    console.error('Error scraping subtitles:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 });
  }
} 