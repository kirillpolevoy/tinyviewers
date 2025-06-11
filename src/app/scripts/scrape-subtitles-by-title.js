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
const DELAY_MS = 2000; // 2 seconds between requests
const REQUEST_TIMEOUT = 15000; // 15 second timeout

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
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'identity', // Avoid compression issues
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
          // Handle redirects
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
    .replace(/\([^)]*\)/g, '') // Remove anything in parentheses like (1995)
    .replace(/[^\w\s]/g, ' ')   // Replace special chars with spaces
    .replace(/\s+/g, ' ')       // Normalize spaces
    .trim()
    .toLowerCase();
}

// Extract year from title if present
function extractYear(title) {
  const yearMatch = title.match(/\((\d{4})\)/);
  return yearMatch ? yearMatch[1] : null;
}

// Enhanced OpenSubtitles.com search with sophisticated anti-detection
async function searchOpenSubtitlesCom(title, year = null) {
  try {
    const cleanTitle = cleanMovieTitle(title);
    const searchQuery = cleanTitle.replace(/\s+/g, '+');
    const searchUrl = `https://www.opensubtitles.com/en/en/search-all/q-${searchQuery}/hearing_impaired-include/machine_translated-/trusted_sources-`;
    
    console.log(`    🔍 Searching OpenSubtitles.com for "${cleanTitle}"...`);
    
    // Step 1: Visit main page first to establish session and get cookies
    try {
      await delay(1000); // Wait 1 second before starting
      console.log(`    🌐 Establishing session with OpenSubtitles.com...`);
      
      await fetchData('https://www.opensubtitles.com/', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'DNT': '1',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      await delay(2000); // Wait 2 seconds between main page and search
    } catch (e) {
      console.log(`    ⚠️  Session establishment failed, continuing with search...`);
    }
    
    // Step 2: Perform the search with enhanced headers
    const html = await fetchData(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.opensubtitles.com/',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        'DNT': '1',
        'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-ch-ua-platform-version': '"13.6.0"'
      }
    });
    
    // Look for subtitle results with download counts (prioritize by popularity)
    const downloadRegex = /<tr[^>]*>.*?<td[^>]*>.*?(\d+(?:,\d+)*).*?download.*?<\/td>.*?<a[^>]*href="([^"]*\/subtitles\/[^"]*)"[^>]*>/gis;
    const downloadMatches = [...html.matchAll(downloadRegex)];
    
    if (downloadMatches.length > 0) {
      // Sort by download count (descending)
      const sortedMatches = downloadMatches
        .map(match => ({
          downloads: parseInt(match[1].replace(/,/g, '')) || 0,
          url: match[2]
        }))
        .sort((a, b) => b.downloads - a.downloads);
      
      if (sortedMatches.length > 0) {
        const bestMatch = sortedMatches[0];
        const subtitleUrl = bestMatch.url.startsWith('http') 
          ? bestMatch.url 
          : `https://www.opensubtitles.com${bestMatch.url}`;
        console.log(`    📄 Found OpenSubtitles.com subtitle (${bestMatch.downloads} downloads)`);
        return { url: subtitleUrl, source: 'opensubtitles-com' };
      }
    }
    
    // Fallback: Look for any English subtitle links
    const englishRegex = /<a[^>]*href="([^"]*\/subtitles\/[^"]*)"[^>]*>.*?English/gi;
    const englishMatches = [...html.matchAll(englishRegex)];
    
    if (englishMatches.length > 0) {
      const subtitleUrl = englishMatches[0][1].startsWith('http') 
        ? englishMatches[0][1] 
        : `https://www.opensubtitles.com${englishMatches[0][1]}`;
      console.log(`    📄 Found OpenSubtitles.com English subtitle`);
      return { url: subtitleUrl, source: 'opensubtitles-com' };
    }
    
    return null;
  } catch (error) {
    console.log(`    ⚠️  OpenSubtitles.com search failed: ${error.message}`);
    return null;
  }
}

// Method 2: Try SubtitlesBase
async function searchSubtitlesBase(title, year = null) {
  try {
    const cleanTitle = cleanMovieTitle(title);
    const searchQuery = cleanTitle.replace(/\s+/g, '+');
    const searchUrl = `https://www.subtitlesbase.com/search.php?query=${encodeURIComponent(searchQuery)}`;
    
    console.log(`    🔍 Searching SubtitlesBase for "${cleanTitle}"...`);
    const html = await fetchData(searchUrl);
    
    // Look for English subtitle links
    const englishRegex = /href="([^"]*download[^"]*)"[^>]*>.*?english/gi;
    const matches = [...html.matchAll(englishRegex)];
    
    if (matches.length > 0) {
      const subtitleUrl = matches[0][1].startsWith('http') 
        ? matches[0][1] 
        : `https://www.subtitlesbase.com/${matches[0][1]}`;
      console.log(`    📄 Found SubtitlesBase subtitle`);
      return { url: subtitleUrl, source: 'subtitlesbase' };
    }
    
    return null;
  } catch (error) {
    console.log(`    ⚠️  SubtitlesBase search failed: ${error.message}`);
    return null;
  }
}

// Method 3: Try English-Subtitles.org
async function searchEnglishSubtitles(title, year = null) {
  try {
    const cleanTitle = cleanMovieTitle(title);
    const searchQuery = cleanTitle.replace(/\s+/g, '-');
    const searchUrl = `https://english-subtitles.org/search?q=${encodeURIComponent(cleanTitle)}`;
    
    console.log(`    🔍 Searching English-Subtitles.org for "${cleanTitle}"...`);
    const html = await fetchData(searchUrl);
    
    // Look for download links
    const downloadRegex = /href="([^"]*download[^"]*\.(?:srt|vtt)[^"]*)"[^>]*>/gi;
    const matches = [...html.matchAll(downloadRegex)];
    
    if (matches.length > 0) {
      const subtitleUrl = matches[0][1].startsWith('http') 
        ? matches[0][1] 
        : `https://english-subtitles.org${matches[0][1]}`;
      console.log(`    📄 Found English-Subtitles.org subtitle`);
      return { url: subtitleUrl, source: 'english-subtitles' };
    }
    
    return null;
  } catch (error) {
    console.log(`    ⚠️  English-Subtitles.org search failed: ${error.message}`);
    return null;
  }
}

// Method 4: Try SubtitleSeeker
async function searchSubtitleSeeker(title, year = null) {
  try {
    const cleanTitle = cleanMovieTitle(title);
    const searchQuery = encodeURIComponent(cleanTitle);
    const searchUrl = `https://www.subtitleseeker.com/search/${searchQuery}/English/`;
    
    console.log(`    🔍 Searching SubtitleSeeker for "${cleanTitle}"...`);
    const html = await fetchData(searchUrl);
    
    // Look for direct subtitle file links
    const srtRegex = /href="([^"]*\.srt)"[^>]*>/gi;
    const matches = [...html.matchAll(srtRegex)];
    
    if (matches.length > 0) {
      const subtitleUrl = matches[0][1].startsWith('http') 
        ? matches[0][1] 
        : `https://www.subtitleseeker.com${matches[0][1]}`;
      console.log(`    📄 Found SubtitleSeeker subtitle`);
      return { url: subtitleUrl, source: 'subtitleseeker' };
    }
    
    return null;
  } catch (error) {
    console.log(`    ⚠️  SubtitleSeeker search failed: ${error.message}`);
    return null;
  }
}

// Download subtitle content
async function downloadSubtitle(subtitleInfo) {
  try {
    console.log(`    📥 Downloading from ${subtitleInfo.source}...`);
    
    let content = await fetchData(subtitleInfo.url);
    
    // Check if it's actual subtitle content
    if (content.includes('-->') || content.includes('WEBVTT') || /^\d+\s*\n/.test(content)) {
      // It's a subtitle file
      return content;
    } else if (content.includes('<html')) {
      // It's an HTML page, try to extract download link
      console.log(`    🔄 Got HTML, extracting download link...`);
      
      // Try to find direct download links
      const directLinkPatterns = [
        /href="([^"]*\.srt[^"]*)"[^>]*>.*?(?:download|here|click)/gi,
        /href="([^"]*download[^"]*\.(?:srt|vtt)[^"]*)"[^>]*>/gi,
        /"(https?:\/\/[^"]*\.srt[^"]*)"/gi
      ];
      
      for (const pattern of directLinkPatterns) {
        const match = pattern.exec(content);
        if (match) {
          const directUrl = match[1].startsWith('http') 
            ? match[1] 
            : `https://${new URL(subtitleInfo.url).hostname}${match[1]}`;
          console.log(`    🎯 Found direct link: ${directUrl}`);
          
          try {
            content = await fetchData(directUrl);
            if (content.includes('-->') || content.includes('WEBVTT')) {
              return content;
            }
          } catch (e) {
            console.log(`    ⚠️  Direct link failed: ${e.message}`);
          }
        }
      }
    }
    
    // Check if content looks like subtitles (even without perfect formatting)
    if (content.length > 200 && (content.includes('-->') || /\d+:\d+/.test(content))) {
      return content;
    }
    
    console.log(`    ⚠️  Downloaded content doesn't look like subtitles (${content.length} chars)`);
    return null;
    
  } catch (error) {
    console.log(`    ❌ Download failed: ${error.message}`);
    return null;
  }
}

// Main subtitle search with multiple methods
async function findSubtitles(movie) {
  const year = extractYear(movie.title);
  
  const methods = [
    () => searchYTSSubs(movie.title, year), // Put YTS-Subs first since it's working well
    () => searchOpenSubtitlesCom(movie.title, year), // Enhanced with anti-detection measures
    // () => searchAddic7ed(movie.title, year), // Temporarily disabled due to timeouts
  ];
  
  for (const method of methods) {
    try {
      const result = await method();
      if (result) {
        const content = await downloadSubtitle(result);
        if (content && content.length > 300) { // Must be substantial content
          return { content, source: result.source };
        }
      }
      await delay(800); // Small delay between methods
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
        download_url: null
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

async function scrapeSubtitlesByTitle() {
  console.log('🎬 Starting title-based subtitle scraping...\n');
  console.log('📋 Using YTS-Subs.com and enhanced OpenSubtitles.com with anti-detection measures\n');
  
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
      console.log(`[${processed}/${moviesWithoutSubtitles.length}] Processing: "${movie.title}"`);
      
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
      if (processed % 5 === 0) {
        console.log(`\n📈 Progress: ${processed}/${moviesWithoutSubtitles.length} (${successful} success, ${failed} failed, ${skipped} skipped)\n`);
      }
      
      await delay(DELAY_MS);
    }
    
    console.log('\n🎉 Title-based subtitle scraping complete!');
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

async function showCurrentStats() {
  try {
    console.log('\n🎬 CURRENT SUBTITLE COVERAGE STATISTICS');
    console.log('========================================');
    
    // Get total movies
    const { data: allMovies, error: moviesError } = await supabase
      .from('movies')
      .select('id, title')
      .not('imdb_id', 'is', null);
      
    if (moviesError) {
      console.error('Error fetching movies:', moviesError);
      return;
    }

    // Get movies with subtitles
    const { data: moviesWithSubtitles, error: subtitlesError } = await supabase
      .from('movies')
      .select(`
        id, 
        title, 
        subtitles(id, source, created_at)
      `)
      .not('imdb_id', 'is', null);
      
    if (subtitlesError) {
      console.error('Error fetching subtitles:', subtitlesError);
      return;
    }

    const totalMovies = allMovies.length;
    const moviesWithSubtitlesData = moviesWithSubtitles.filter(m => m.subtitles && m.subtitles.length > 0);
    const moviesWithSubtitlesCount = moviesWithSubtitlesData.length;
    const coveragePercentage = ((moviesWithSubtitlesCount / totalMovies) * 100).toFixed(1);

    console.log(`📊 Total Movies: ${totalMovies}`);
    console.log(`✅ Movies with Subtitles: ${moviesWithSubtitlesCount}`);
    console.log(`❌ Movies without Subtitles: ${totalMovies - moviesWithSubtitlesCount}`);
    console.log(`📈 Coverage Percentage: ${coveragePercentage}%`);
    console.log('');

    // Show source breakdown
    const sourceBreakdown = {};
    moviesWithSubtitlesData.forEach(movie => {
      if (movie.subtitles && movie.subtitles.length > 0) {
        movie.subtitles.forEach(subtitle => {
          sourceBreakdown[subtitle.source] = (sourceBreakdown[subtitle.source] || 0) + 1;
        });
      }
    });

    console.log('📋 SUBTITLES BY SOURCE:');
    console.log('=======================');
    Object.entries(sourceBreakdown)
      .sort(([,a], [,b]) => b - a)
      .forEach(([source, count]) => {
        console.log(`${source}: ${count} movies`);
      });

    console.log('');
    console.log('🏆 PROGRESS SUMMARY:');
    console.log('===================');
    console.log('Started: 102/236 movies (43.2% coverage)');
    console.log(`Current: ${moviesWithSubtitlesCount}/${totalMovies} movies (${coveragePercentage}% coverage)`);
    console.log(`Improvement: +${moviesWithSubtitlesCount - 102} movies (+${(parseFloat(coveragePercentage) - 43.2).toFixed(1)}%)`);

  } catch (error) {
    console.error('Error getting stats:', error);
  }
}

// Check if this script is called with 'stats' argument
if (process.argv.includes('stats')) {
  console.log('🎬 FETCHING CURRENT SUBTITLE COVERAGE STATISTICS...\n');
  showCurrentStats();
} else {
  // Run the normal scraping
  scrapeSubtitlesByTitle();
} 