import { createClient } from '@supabase/supabase-js';
import https from 'https';
import http from 'http';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Configuration
const DELAY_MS = 1500; // 1.5 seconds between requests
const REQUEST_TIMEOUT = 20000; // 20 second timeout
const MAX_RETRIES = 2;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Enhanced HTTP client
function fetchData(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const urlObj = new URL(url);
    
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        ...options.headers
      },
      timeout: REQUEST_TIMEOUT
    };

    const req = client.request(requestOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Handle redirects
          fetchData(res.headers.location, options).then(resolve).catch(reject);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

// Method 1: Try YIFY Subtitles (reliable and free)
async function searchYifySubtitles(imdbId) {
  try {
    const imdbNumber = imdbId.replace('tt', '');
    const searchUrl = `https://yifysubtitles.ch/movie-imdb/tt${imdbNumber}`;
    
    console.log(`    🔍 Searching YIFY for ${imdbId}...`);
    const html = await fetchData(searchUrl);
    
    // Parse HTML to find English subtitle links
    const englishSubtitleRegex = /href="([^"]*\/subtitle\/[^"]*english[^"]*\.zip)"/gi;
    const matches = [...html.matchAll(englishSubtitleRegex)];
    
    if (matches.length > 0) {
      const subtitleUrl = `https://yifysubtitles.ch${matches[0][1]}`;
      console.log(`    📄 Found YIFY subtitle: ${subtitleUrl}`);
      return { url: subtitleUrl, source: 'yify' };
    }
    
    return null;
  } catch (error) {
    console.log(`    ⚠️  YIFY search failed: ${error.message}`);
    return null;
  }
}

// Method 2: Try Subscene (backup)
async function searchSubscene(movieTitle, imdbId) {
  try {
    console.log(`    🔍 Searching Subscene for "${movieTitle}"...`);
    
    // Clean movie title for search
    const cleanTitle = movieTitle.replace(/[^\w\s]/g, '').replace(/\s+/g, '-').toLowerCase();
    const searchUrl = `https://subscene.com/subtitles/${cleanTitle}`;
    
    const html = await fetchData(searchUrl);
    
    // Look for English subtitle links
    const englishSubRegex = /href="(\/subtitles\/[^"]*\/english\/[^"]*)"[^>]*>.*?English/gi;
    const matches = [...html.matchAll(englishSubRegex)];
    
    if (matches.length > 0) {
      const subtitleUrl = `https://subscene.com${matches[0][1]}`;
      console.log(`    📄 Found Subscene subtitle: ${subtitleUrl}`);
      return { url: subtitleUrl, source: 'subscene' };
    }
    
    return null;
  } catch (error) {
    console.log(`    ⚠️  Subscene search failed: ${error.message}`);
    return null;
  }
}

// Method 3: Try OpenSubtitles.org (different from API)
async function searchOpenSubtitlesWeb(imdbId) {
  try {
    console.log(`    🔍 Searching OpenSubtitles.org for ${imdbId}...`);
    
    const searchUrl = `https://www.opensubtitles.org/en/search/imdbid-${imdbId.replace('tt', '')}/sublanguageid-eng`;
    const html = await fetchData(searchUrl);
    
    // Look for direct download links
    const downloadRegex = /href="([^"]*\/en\/download\/[^"]*)"[^>]*>.*?download/gi;
    const matches = [...html.matchAll(downloadRegex)];
    
    if (matches.length > 0) {
      const subtitleUrl = `https://www.opensubtitles.org${matches[0][1]}`;
      console.log(`    📄 Found OpenSubtitles.org subtitle: ${subtitleUrl}`);
      return { url: subtitleUrl, source: 'opensubtitles-web' };
    }
    
    return null;
  } catch (error) {
    console.log(`    ⚠️  OpenSubtitles.org search failed: ${error.message}`);
    return null;
  }
}

// Download and extract subtitle content
async function downloadSubtitle(subtitleInfo) {
  try {
    console.log(`    📥 Downloading from ${subtitleInfo.source}...`);
    
    let content = await fetchData(subtitleInfo.url);
    
    // If it's a zip file or compressed, we might need to handle differently
    // For now, assume it's plain text or extract basic content
    if (content.includes('WEBVTT') || content.includes('-->')) {
      // It's a subtitle file
      return content;
    } else if (content.includes('<html')) {
      // It's an HTML page, might need another redirect or extraction
      console.log(`    🔄 Got HTML, trying to extract download link...`);
      
      // Try to find direct download links in the HTML
      const directLinkRegex = /href="([^"]*\.srt[^"]*)"[^>]*>.*?download/gi;
      const match = directLinkRegex.exec(content);
      
      if (match) {
        const directUrl = match[1].startsWith('http') ? match[1] : `https://${new URL(subtitleInfo.url).hostname}${match[1]}`;
        console.log(`    🎯 Found direct link: ${directUrl}`);
        content = await fetchData(directUrl);
        return content;
      }
    }
    
    // Try to extract subtitle-like content
    if (content.length > 100 && (content.includes('-->') || content.includes('WEBVTT'))) {
      return content;
    }
    
    console.log(`    ⚠️  Downloaded content doesn't look like subtitles (${content.length} chars)`);
    return null;
    
  } catch (error) {
    console.log(`    ❌ Download failed: ${error.message}`);
    return null;
  }
}

// Main subtitle search with multiple fallbacks
async function findSubtitles(movie) {
  const methods = [
    () => searchYifySubtitles(movie.imdb_id),
    () => searchSubscene(movie.title, movie.imdb_id),
    () => searchOpenSubtitlesWeb(movie.imdb_id)
  ];
  
  for (const method of methods) {
    try {
      const result = await method();
      if (result) {
        const content = await downloadSubtitle(result);
        if (content && content.length > 500) { // Must be substantial content
          return { content, source: result.source };
        }
      }
      await delay(1000); // Small delay between methods
    } catch (error) {
      console.log(`    ⚠️  Method failed: ${error.message}`);
    }
  }
  
  return null;
}

async function saveSubtitleToSupabase(movieId, subtitleContent, source) {
  try {
    const { error } = await supabase
      .from('subtitles')
      .insert({
        movie_id: movieId,
        subtitle_text: subtitleContent,
        language: 'en',
        source: source,
        file_format: 'srt',
        download_url: null // No specific URL for these methods
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

async function scrapeSubtitlesAlternative() {
  console.log('🎬 Starting alternative subtitle scraping...\n');
  console.log('📋 Using multiple sources: YIFY, Subscene, OpenSubtitles.org\n');
  
  try {
    // Get movies without subtitles
    const { data: movies, error } = await supabase
      .from('movies')
      .select(`
        id, 
        title, 
        imdb_id,
        subtitles(id)
      `)
      .not('imdb_id', 'is', null);
    
    if (error) throw error;
    
    const moviesWithoutSubtitles = movies.filter(movie => 
      !movie.subtitles || movie.subtitles.length === 0
    );
    
    console.log(`📊 Found ${moviesWithoutSubtitles.length} movies needing subtitles\n`);
    
    let processed = 0;
    let successful = 0;
    let failed = 0;
    let skipped = 0;
    
    for (const movie of moviesWithoutSubtitles) {
      processed++;
      console.log(`[${processed}/${moviesWithoutSubtitles.length}] Processing: "${movie.title}" (${movie.imdb_id})`);
      
      try {
        const result = await findSubtitles(movie);
        
        if (!result) {
          console.log(`  ⚠️  No subtitles found from any source`);
          skipped++;
          continue;
        }
        
        console.log(`  💾 Downloaded ${result.content.length} characters from ${result.source}`);
        
        const saveSuccess = await saveSubtitleToSupabase(movie.id, result.content, result.source);
        
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
      
      // Progress update and delay
      if (processed % 3 === 0) {
        console.log(`\n📈 Progress: ${processed}/${moviesWithoutSubtitles.length} (${successful} success, ${failed} failed, ${skipped} skipped)\n`);
      }
      
      await delay(DELAY_MS);
    }
    
    console.log('\n🎉 Alternative subtitle scraping complete!');
    console.log(`📊 Total processed: ${processed}`);
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`📈 Success rate: ${processed > 0 ? ((successful / processed) * 100).toFixed(1) : 0}%`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the script
scrapeSubtitlesAlternative(); 