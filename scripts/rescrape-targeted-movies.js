import { createClient } from '@supabase/supabase-js';
import https from 'https';
import http from 'http';
import dotenv from 'dotenv';

// Load environment variables from root directory
const envPath = process.cwd().endsWith('src/app') ? '../../.env.local' : '.env.local';
dotenv.config({ path: envPath });

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Configuration
const DELAY_MS = 2000; // 2 seconds between requests
const REQUEST_TIMEOUT = 30000; // 30 second timeout

// Movie IDs to re-scrape (first 10 for testing)
const MOVIE_IDS = [
  'a9b0c1d2-e3f4-4567-a9b0-c1d2e3f45678',
  'c1d2e3f4-a5b6-4789-c1d2-e3f4a5b67892',
  'a7b8c9d0-e1f2-4345-a7b8-c9d0e1f23460',
  'c5d6e7f8-a9b0-4123-c5d6-e7f8a9b01238',
  'e7f8a9b0-c1d2-4345-e7f8-a9b0c1d23460',
  'f8a9b0c1-d2e3-4456-f8a9-b0c1d2e34571',
  'b0c1d2e3-f4a5-4678-b0c1-d2e3f4a56793',
  'd2e3f4a5-b6c7-4890-d2e3-f4a5b6c78905',
  'e3f4a5b6-c7d8-4901-e3f4-a5b6c7d89016',
  'f4a5b6c7-d8e9-4012-f4a5-b6c7d8e90127'
];

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Enhanced HTTP client (copy from working scraper)
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
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'identity',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
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
          const redirectUrl = res.headers.location.startsWith('http') 
            ? res.headers.location 
            : `${urlObj.protocol}//${urlObj.hostname}${res.headers.location}`;
          fetchData(redirectUrl, options).then(resolve).catch(reject);
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

// Clean movie title for searching
function cleanMovieTitle(title) {
  return title
    .replace(/\([^)]*\)/g, '')
    .replace(/^The\s+/i, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Extract year from title if present
function extractYear(title) {
  const yearMatch = title.match(/\((\d{4})\)/);
  return yearMatch ? yearMatch[1] : null;
}

// Method 1: Try YTS-Subs.com with enhanced patterns
async function searchYTSSubs(title, year = null) {
  try {
    const cleanTitle = cleanMovieTitle(title);
    const searchQueries = [
      cleanTitle.replace(/\s+/g, '+'),
      cleanTitle.replace(/\s+/g, '-'),
      cleanTitle.replace(/\s+/g, '%20')
    ];
    
    console.log(`    🔍 Searching YTS-Subs.com for "${cleanTitle}"...`);
    
    for (const query of searchQueries) {
      try {
        const searchUrl = `https://yts-subs.com/search?q=${query}`;
        const html = await fetchData(searchUrl);
        
        // Look for movie links
        const movieLinkRegex = /<a[^>]*href="([^"]*\/movie-imdb\/[^"]*)"[^>]*>/gi;
        const movieMatches = [...html.matchAll(movieLinkRegex)];
        
        if (movieMatches.length > 0) {
          const movieUrl = `https://yts-subs.com${movieMatches[0][1]}`;
          const movieHtml = await fetchData(movieUrl);
          
          // Look for download links
          const downloadRegex = /<a[^>]*href="([^"]*)"[^>]*>\s*download\s*<\/a>/gi;
          const downloadMatches = [...movieHtml.matchAll(downloadRegex)];
          
          if (downloadMatches.length > 0) {
            const downloadUrl = downloadMatches[0][1].startsWith('http') 
              ? downloadMatches[0][1] 
              : `https://yts-subs.com${downloadMatches[0][1]}`;
            console.log(`    📄 Found YTS-Subs.com subtitle`);
            return { url: downloadUrl, source: 'yts-subs' };
          }
        }
        
        await delay(500); // Small delay between search variations
      } catch (e) {
        console.log(`    ⚠️  Search variation failed: ${e.message}`);
      }
    }
    
    return null;
  } catch (error) {
    console.log(`    ⚠️  YTS-Subs.com search failed: ${error.message}`);
    return null;
  }
}

// Download subtitle content with better validation
async function downloadSubtitle(subtitleInfo) {
  try {
    console.log(`    📥 Downloading from ${subtitleInfo.source}...`);
    
    let content = await fetchData(subtitleInfo.url);
    
    // Check if it's actual subtitle content
    if (content.includes('-->') || content.includes('WEBVTT') || /^\d+\s*\n/.test(content)) {
      return content;
    }
    
    console.log(`    ⚠️  Downloaded content doesn't look like subtitles (${content.length} chars)`);
    return null;
    
  } catch (error) {
    console.log(`    ❌ Download failed: ${error.message}`);
    return null;
  }
}

async function saveSubtitleToSupabase(movieId, subtitleContent, source) {
  try {
    // Validate content
    if (!subtitleContent || subtitleContent.length < 100) {
      console.log(`    ❌ Subtitle content too short`);
      return false;
    }
    
    if (subtitleContent.includes('<html') || !subtitleContent.includes('-->')) {
      console.log(`    ❌ Content doesn't appear to be valid subtitles`);
      return false;
    }
    
    // Delete existing subtitle
    await supabase.from('subtitles').delete().eq('movie_id', movieId);
    
    // Insert new subtitle
    const { error } = await supabase
      .from('subtitles')
      .insert({
        movie_id: movieId,
        subtitle_text: subtitleContent,
        source: source || 'yts-subs'
      });
    
    if (error) throw error;
    
    console.log(`    ✅ Subtitle saved (${subtitleContent.length.toLocaleString()} characters)`);
    return true;
  } catch (error) {
    console.log(`    ❌ Failed to save: ${error.message}`);
    return false;
  }
}

async function rescrapeTargetedMovies() {
  console.log('🎬 Re-scraping Targeted Movies\n');
  console.log(`📊 Testing with ${MOVIE_IDS.length} movie IDs\n`);
  
  let processed = 0;
  let successful = 0;
  let failed = 0;
  
  for (const movieId of MOVIE_IDS) {
    try {
      processed++;
      console.log(`\n📊 Progress: ${processed}/${MOVIE_IDS.length}`);
      
      // Get movie info
      const { data: movie, error } = await supabase
        .from('movies')
        .select('id, title, release_year')
        .eq('id', movieId)
        .single();
      
      if (error || !movie) {
        console.log(`❌ Movie not found: ${movieId}`);
        failed++;
        continue;
      }
      
      console.log(`🎬 Processing: "${movie.title}"`);
      
      // Try to find subtitles
      const result = await searchYTSSubs(movie.title, movie.release_year);
      
      if (result) {
        const content = await downloadSubtitle(result);
        if (content) {
          const saved = await saveSubtitleToSupabase(movie.id, content, result.source);
          if (saved) {
            successful++;
            console.log(`✅ Successfully updated "${movie.title}"`);
          } else {
            failed++;
          }
        } else {
          failed++;
        }
      } else {
        failed++;
        console.log(`❌ No subtitles found for "${movie.title}"`);
      }
      
      await delay(DELAY_MS);
      
    } catch (error) {
      failed++;
      console.log(`❌ Error processing ${movieId}: ${error.message}`);
    }
  }
  
  console.log('\n🎉 Targeted Re-scraping Complete!');
  console.log(`📊 Results: ${successful} successful, ${failed} failed out of ${processed} processed`);
}

// Run the targeted re-scraper
rescrapeTargetedMovies().catch(console.error); 