import { createClient } from '@supabase/supabase-js';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// OpenSubtitles Configuration
const OPENSUBTITLES_API_KEY = process.env.OPENSUBTITLES_API_KEY;
const OPENSUBTITLES_BASE_URL = 'https://api.opensubtitles.com/api/v1';

// Rate limiting and timeout settings
const DELAY_MS = 2000; // 2 seconds between requests (more conservative)
const REQUEST_TIMEOUT = 30000; // 30 second timeout for requests
const MAX_RETRIES = 3; // Retry failed requests up to 3 times

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Enhanced HTTP client with timeout and retry logic
function downloadFile(url, retries = 0) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    
    const request = client.get(url, { timeout: REQUEST_TIMEOUT }, (response) => {
      if (response.statusCode === 200) {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => data += chunk);
        response.on('end', () => resolve(data));
      } else if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirects
        downloadFile(response.headers.location, retries).then(resolve).catch(reject);
      } else if (response.statusCode === 429 && retries < MAX_RETRIES) {
        // Rate limited - wait longer and retry
        console.log(`    🔄 Rate limited, retrying in 5 seconds...`);
        setTimeout(() => {
          downloadFile(url, retries + 1).then(resolve).catch(reject);
        }, 5000);
      } else {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
      }
    });
    
    request.on('timeout', () => {
      request.destroy();
      if (retries < MAX_RETRIES) {
        console.log(`    ⏰ Timeout, retrying... (${retries + 1}/${MAX_RETRIES})`);
        setTimeout(() => {
          downloadFile(url, retries + 1).then(resolve).catch(reject);
        }, 2000);
      } else {
        reject(new Error('Request timeout after retries'));
      }
    });
    
    request.on('error', (error) => {
      if (retries < MAX_RETRIES) {
        console.log(`    🔄 Network error, retrying... (${retries + 1}/${MAX_RETRIES})`);
        setTimeout(() => {
          downloadFile(url, retries + 1).then(resolve).catch(reject);
        }, 2000);
      } else {
        reject(error);
      }
    });
    
    request.setTimeout(REQUEST_TIMEOUT);
  });
}

async function searchOpenSubtitles(imdbId, retries = 0) {
  try {
    const searchUrl = `${OPENSUBTITLES_BASE_URL}/subtitles?imdb_id=${imdbId}&languages=en&format=srt`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    
    const response = await fetch(searchUrl, {
      headers: {
        'Api-Key': OPENSUBTITLES_API_KEY,
        'User-Agent': 'TinyViewers v1.0'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.status === 429) {
      if (retries < MAX_RETRIES) {
        console.log(`    🔄 Rate limited, waiting 10 seconds...`);
        await delay(10000);
        return await searchOpenSubtitles(imdbId, retries + 1);
      }
      throw new Error('Rate limited after retries');
    }
    
    if (!response.ok) {
      throw new Error(`OpenSubtitles API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.data && data.data.length > 0) {
      // Get the highest rated English subtitle
      const bestSubtitle = data.data
        .filter(sub => sub.attributes.language === 'en')
        .sort((a, b) => (b.attributes.ratings || 0) - (a.attributes.ratings || 0))[0];
      
      return bestSubtitle;
    }
    
    return null;
  } catch (error) {
    if (error.name === 'AbortError') {
      if (retries < MAX_RETRIES) {
        console.log(`    ⏰ Request timeout, retrying... (${retries + 1}/${MAX_RETRIES})`);
        await delay(2000);
        return await searchOpenSubtitles(imdbId, retries + 1);
      }
    }
    console.error(`Error searching OpenSubtitles for IMDB ${imdbId}:`, error.message);
    return null;
  }
}

async function downloadSubtitleContent(subtitle, retries = 0) {
  try {
    // Get download link from OpenSubtitles
    const downloadUrl = `${OPENSUBTITLES_BASE_URL}/download`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    
    const response = await fetch(downloadUrl, {
      method: 'POST',
      headers: {
        'Api-Key': OPENSUBTITLES_API_KEY,
        'Content-Type': 'application/json',
        'User-Agent': 'TinyViewers v1.0'
      },
      body: JSON.stringify({
        file_id: subtitle.attributes.files[0].file_id
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.status === 429) {
      if (retries < MAX_RETRIES) {
        console.log(`    🔄 Download rate limited, waiting 10 seconds...`);
        await delay(10000);
        return await downloadSubtitleContent(subtitle, retries + 1);
      }
      throw new Error('Download rate limited after retries');
    }
    
    if (!response.ok) {
      throw new Error(`Download request failed: ${response.status}`);
    }
    
    const downloadData = await response.json();
    
    if (downloadData.link) {
      // Download the actual subtitle file
      const subtitleContent = await downloadFile(downloadData.link);
      return subtitleContent;
    }
    
    return null;
  } catch (error) {
    if (error.name === 'AbortError') {
      if (retries < MAX_RETRIES) {
        console.log(`    ⏰ Download timeout, retrying... (${retries + 1}/${MAX_RETRIES})`);
        await delay(2000);
        return await downloadSubtitleContent(subtitle, retries + 1);
      }
    }
    console.error('Error downloading subtitle content:', error.message);
    return null;
  }
}

async function saveSubtitleToSupabase(movieId, subtitleContent, subtitle) {
  try {
    const { error } = await supabase
      .from('subtitles')
      .insert({
        movie_id: movieId,
        subtitle_text: subtitleContent,
        language: 'en',
        source: 'opensubtitles',
        file_format: 'srt',
        download_url: subtitle.attributes.url
      });
    
    if (error) {
      throw error;
    }
    
    return true;
  } catch (error) {
    console.error(`Error saving subtitle for movie ${movieId}:`, error.message);
    return false;
  }
}

async function scrapeSubtitles() {
  console.log('🎬 Starting subtitle scraping process...\n');
  
  // Check environment variables
  if (!supabaseUrl || !supabaseServiceKey || !OPENSUBTITLES_API_KEY) {
    console.error('❌ Missing required environment variables:');
    console.error('- NEXT_PUBLIC_SUPABASE_URL:', !!supabaseUrl);
    console.error('- SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey);
    console.error('- OPENSUBTITLES_API_KEY:', !!OPENSUBTITLES_API_KEY);
    process.exit(1);
  }
  
  try {
    // Get all movies with IMDB IDs that don't have subtitles yet
    const { data: movies, error } = await supabase
      .from('movies')
      .select(`
        id, 
        title, 
        imdb_id,
        subtitles(id)
      `)
      .not('imdb_id', 'is', null);
    
    if (error) {
      throw error;
    }
    
    // Filter out movies that already have subtitles
    const moviesWithoutSubtitles = movies.filter(movie => 
      !movie.subtitles || movie.subtitles.length === 0
    );
    
    console.log(`📊 Found ${moviesWithoutSubtitles.length} movies with IMDB IDs but no subtitles\n`);
    
    let processed = 0;
    let successful = 0;
    let failed = 0;
    let skipped = 0;
    
    for (const movie of moviesWithoutSubtitles) {
      processed++;
      console.log(`[${processed}/${moviesWithoutSubtitles.length}] Processing: "${movie.title}" (${movie.imdb_id})`);
      
      try {
        // Search for subtitles on OpenSubtitles
        const subtitle = await searchOpenSubtitles(movie.imdb_id);
        await delay(DELAY_MS);
        
        if (!subtitle) {
          console.log(`  ⚠️  No subtitles found`);
          skipped++;
          continue;
        }
        
        console.log(`  📄 Found subtitle: ${subtitle.attributes.release}`);
        
        // Download subtitle content
        const subtitleContent = await downloadSubtitleContent(subtitle);
        await delay(DELAY_MS);
        
        if (!subtitleContent) {
          console.log(`  ❌ Failed to download subtitle content`);
          failed++;
          continue;
        }
        
        console.log(`  💾 Downloaded ${subtitleContent.length} characters`);
        
        // Save to Supabase
        const saveSuccess = await saveSubtitleToSupabase(movie.id, subtitleContent, subtitle);
        
        if (saveSuccess) {
          console.log(`  ✅ Saved to database`);
          successful++;
        } else {
          console.log(`  ❌ Failed to save to database`);
          failed++;
        }
        
      } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
        failed++;
      }
      
      // Progress update every 5 movies
      if (processed % 5 === 0) {
        console.log(`\n📈 Progress: ${processed}/${moviesWithoutSubtitles.length} (${successful} success, ${failed} failed, ${skipped} skipped)\n`);
      }
    }
    
    console.log('\n🎉 Subtitle scraping complete!');
    console.log(`📊 Total processed: ${processed}`);
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⏭️  Skipped (no subtitles): ${skipped}`);
    console.log(`📈 Success rate: ${((successful / (processed - skipped)) * 100).toFixed(1)}%`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the script
scrapeSubtitles(); 