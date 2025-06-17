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
const DELAY_MS = 3000; // 3 seconds between requests
const REQUEST_TIMEOUT = 30000; // 30 second timeout

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Movie IDs to re-scrape
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
  'f4a5b6c7-d8e9-4012-f4a5-b6c7d8e90127',
  'c7d8e9f0-a1b2-4345-c7d8-e9f0a1b23460',
  'd8e9f0a1-b2c3-4456-d8e9-f0a1b2c34571',
  'e9f0a1b2-c3d4-4567-e9f0-a1b2c3d45682',
  'e5f6a7b8-c9d0-4123-e5f6-a7b8c9d01239',
  'f6a7b8c9-d0e1-4234-f6a7-b8c9d0e12350',
  'a7b8c9d0-e1f2-4345-a7b8-c9d0e1f23461',
  'c9d0e1f2-a3b4-4567-c9d0-e1f2a3b45683',
  'd0e1f2a3-b4c5-4678-d0e1-f2a3b4c56794',
  'f2a3b4c5-d6e7-4890-f2a3-b4c5d6e78906',
  'a3b4c5d6-e7f8-4901-a3b4-c5d6e7f89017',
  'b4c5d6e7-f8a9-4012-b4c5-d6e7f8a90128',
  'd6e7f8a9-b0c1-4234-d6e7-f8a9b0c12350',
  'b29f58ea-ca98-47ce-ac62-2b41f96f9346',
  '662bc2c9-388c-47a0-96ce-10520c3be41e',
  '03be72b4-55ed-4f7b-8666-9cfddd8f3e40',
  '13a29b97-3691-43db-8835-3c8b98a869c5',
  '603b4376-2666-4a37-aa96-76a36692325a',
  '29ec4703-c1e9-4817-b409-f84808222cc2',
  'fc338879-0281-4975-ab5d-dd27264cad16',
  'd4e5f6a7-b8c9-4012-d4e5-f6a7b8c90123',
  'a7b8c9d0-e1f2-4345-a7b8-c9d0e1f23456',
  'b8c9d0e1-f2a3-4456-b8c9-d0e1f2a34567',
  'd0e1f2a3-b4c5-4678-d0e1-f2a3b4c56789',
  'e1f2a3b4-c5d6-4789-e1f2-a3b4c5d67890',
  'f2a3b4c5-d6e7-4890-f2a3-b4c5d6e78901',
  'a3b4c5d6-e7f8-4901-a3b4-c5d6e7f89012',
  'b8c9d0e1-f2a3-4456-b8c9-d0e1f2a34568',
  'e7f8a9b0-c1d2-4345-e7f8-a9b0c1d23456',
  'f8a9b0c1-d2e3-4456-f8a9-b0c1d2e34567',
  'c1d2e3f4-a5b6-4789-c1d2-e3f4a5b67890',
  'e3f4a5b6-c7d8-4901-e3f4-a5b6c7d89012',
  'a5b6c7d8-e9f0-4123-a5b6-c7d8e9f01234',
  'c7d8e9f0-a1b2-4345-c7d8-e9f0a1b23456',
  'd8e9f0a1-b2c3-4456-d8e9-f0a1b2c34567',
  'e9f0a1b2-c3d4-4567-e9f0-a1b2c3d45678',
  'f0a1b2c3-d4e5-4678-f0a1-b2c3d4e56789',
  'b2c3d4e5-f6a7-4890-b2c3-d4e5f6a78902',
  'd4e5f6a7-b8c9-4012-d4e5-f6a7b8c90124',
  'a7b8c9d0-e1f2-4345-a7b8-c9d0e1f23457',
  'e1f2a3b4-c5d6-4789-e1f2-a3b4c5d67891',
  'f2a3b4c5-d6e7-4890-f2a3-b4c5d6e78902',
  'd6e7f8a9-b0c1-4234-d6e7-f8a9b0c12346',
  'e7f8a9b0-c1d2-4345-e7f8-a9b0c1d23457',
  'a5b6c7d8-e9f0-4123-a5b6-c7d8e9f01235',
  'e9f0a1b2-c3d4-4567-e9f0-a1b2c3d45679',
  'a1b2c3d4-e5f6-4789-a1b2-c3d4e5f67892',
  'd4e5f6a7-b8c9-4012-d4e5-f6a7b8c90125',
  'b8c9d0e1-f2a3-4456-b8c9-d0e1f2a34569',
  'a3b4c5d6-e7f8-4901-a3b4-c5d6e7f89014',
  'd6e7f8a9-b0c1-4234-d6e7-f8a9b0c12347',
  'b0c1d2e3-f4a5-4678-b0c1-d2e3f4a56791',
  'b0c1d2e3-f4a5-4678-b0c1-d2e3f4a56794',
  'd8e9f0a1-b2c3-4456-d8e9-f0a1b2c34573',
  'f0a1b2c3-d4e5-4678-f0a1-b2c3d4e56795',
  'd4e5f6a7-b8c9-4012-d4e5-f6a7b8c90129',
  '4c707725-5c40-454d-ae1c-b73bba42a38f',
  '2136da2e-4c01-40a4-a9b4-0882430cc543',
  '5f814f9f-8b46-424f-9afe-1b913bdae3cb',
  'a22e84bb-b046-45c8-83c6-c5d35b68834b',
  'c3d4e5f6-a7b8-4901-c3d4-e5f6a7b89013',
  'a9b0c1d2-e3f4-4567-a9b0-c1d2e3f45680',
  'e3f4a5b6-c7d8-4901-e3f4-a5b6c7d89017',
  'f0a1b2c3-d4e5-4678-f0a1-b2c3d4e56791',
  'e3f4a5b6-c7d8-4901-e3f4-a5b6c7d89015',
  'd8e9f0a1-b2c3-4456-d8e9-f0a1b2c34570',
  'a3b4c5d6-e7f8-4901-a3b4-c5d6e7f89016',
  'b6c7d8e9-f0a1-4234-b6c7-d8e9f0a12349',
  'b2c3d4e5-f6a7-4890-b2c3-d4e5f6a78906',
  'c3d4e5f6-a7b8-4901-c3d4-e5f6a7b89017',
  '05cab0bf-ede4-4dcd-b375-90bb8bf50760',
  '5f40319f-95f7-4ec0-a821-d677ddc7376d'
];

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
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'identity',
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

// Method 1: YTS-Subs.com (working well)
async function searchYTSSubs(title, year = null) {
  try {
    const cleanTitle = cleanMovieTitle(title);
    const searchQuery = cleanTitle.replace(/\s+/g, '%20');
    const searchUrl = `https://yts-subs.com/search?q=${encodeURIComponent(cleanTitle)}`;
    
    console.log(`    🔍 Searching YTS-Subs.com for "${cleanTitle}"...`);
    
    const html = await fetchData(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://yts-subs.com/'
      }
    });
    
    // Look for movie links first
    const movieLinkRegex = /<a[^>]*href="(\/movie-imdb\/[^"]*)"[^>]*>/gi;
    const movieMatches = [...html.matchAll(movieLinkRegex)];
    
    if (movieMatches.length > 0) {
      // Go to the movie page to find English subtitles
      const movieUrl = `https://yts-subs.com${movieMatches[0][1]}`;
      console.log(`    🎬 Found movie page: ${movieUrl}`);
      
      const movieHtml = await fetchData(movieUrl);
      
      // Look for English subtitle download links in the table
      const englishSubRegex = /<tr[^>]*>.*?<td[^>]*>.*?English.*?<\/td>.*?<a[^>]*href="([^"]*download[^"]*)"[^>]*>.*?download.*?<\/a>/gis;
      const englishMatches = [...movieHtml.matchAll(englishSubRegex)];
      
      if (englishMatches.length > 0) {
        const subtitlePath = englishMatches[0][1];
        const subtitleUrl = subtitlePath.startsWith('http') 
          ? subtitlePath 
          : `https://yts-subs.com${subtitlePath}`;
        console.log(`    📄 Found YTS-Subs.com English subtitle`);
        return { url: subtitleUrl, source: 'yts-subs' };
      }
      
      // Fallback: Look for any English subtitle links
      const fallbackRegex = /<a[^>]*href="(\/subtitles\/[^"]*english[^"]*)"[^>]*>/gi;
      const fallbackMatches = [...movieHtml.matchAll(fallbackRegex)];
      
      if (fallbackMatches.length > 0) {
        const subtitlePageUrl = `https://yts-subs.com${fallbackMatches[0][1]}`;
        console.log(`    📄 Found YTS-Subs.com English subtitle page`);
        return { url: subtitlePageUrl, source: 'yts-subs' };
      }
    }
    
    // Direct search for subtitle links in search results
    const directSubRegex = /<a[^>]*href="(\/subtitles\/[^"]*english[^"]*)"[^>]*>/gi;
    const directMatches = [...html.matchAll(directSubRegex)];
    
    if (directMatches.length > 0) {
      const subtitleUrl = `https://yts-subs.com${directMatches[0][1]}`;
      console.log(`    📄 Found YTS-Subs.com subtitle from search`);
      return { url: subtitleUrl, source: 'yts-subs' };
    }
    
    return null;
  } catch (error) {
    console.log(`    ⚠️  YTS-Subs.com search failed: ${error.message}`);
    return null;
  }
}

// Method 2: OpenSubtitles.com (web scraping)
async function searchOpenSubtitlesCom(title, year = null) {
  try {
    const cleanTitle = cleanMovieTitle(title);
    const searchQuery = cleanTitle.replace(/\s+/g, '+');
    const searchUrl = `https://www.opensubtitles.com/en/search-all/q-${searchQuery}/hearing_impaired-include`;
    
    console.log(`    🔍 Searching OpenSubtitles.com for "${cleanTitle}"...`);
    
    const html = await fetchData(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Referer': 'https://www.opensubtitles.com/',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    
    // Look for English subtitle download links
    const downloadRegex = /<a[^>]*href="([^"]*\/en\/subtitleserve\/[^"]*)"[^>]*>.*?Download/gi;
    const matches = [...html.matchAll(downloadRegex)];
    
    if (matches.length > 0) {
      const subtitleUrl = matches[0][1].startsWith('http') 
        ? matches[0][1] 
        : `https://www.opensubtitles.com${matches[0][1]}`;
      console.log(`    📄 Found OpenSubtitles.com subtitle`);
      return { url: subtitleUrl, source: 'opensubtitles-com' };
    }
    
    // Fallback: Look for subtitle page links
    const pageRegex = /<a[^>]*href="([^"]*\/subtitles\/[^"]*)"[^>]*>.*?English/gi;
    const pageMatches = [...html.matchAll(pageRegex)];
    
    if (pageMatches.length > 0) {
      const pageUrl = pageMatches[0][1].startsWith('http') 
        ? pageMatches[0][1] 
        : `https://www.opensubtitles.com${pageMatches[0][1]}`;
      
      // Get the subtitle page and look for download link
      await delay(1000); // Small delay to avoid rate limiting
      const pageHtml = await fetchData(pageUrl);
      const downloadMatches = [...pageHtml.matchAll(downloadRegex)];
      
      if (downloadMatches.length > 0) {
        const subtitleUrl = downloadMatches[0][1].startsWith('http') 
          ? downloadMatches[0][1] 
          : `https://www.opensubtitles.com${downloadMatches[0][1]}`;
        console.log(`    📄 Found OpenSubtitles.com subtitle from page`);
        return { url: subtitleUrl, source: 'opensubtitles-com' };
      }
    }
    
    return null;
  } catch (error) {
    console.log(`    ⚠️  OpenSubtitles.com search failed: ${error.message}`);
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
      
      // YTS-Subs specific patterns
      if (subtitleInfo.source === 'yts-subs') {
        console.log(`    🔍 Analyzing YTS-Subs page...`);
        
        // Look for download button that leads to actual .srt file
        const downloadButtonRegex = /<a[^>]*href="([^"]*)"[^>]*>\s*download\s*<\/a>/gi;
        const downloadMatch = downloadButtonRegex.exec(content);
        
        if (downloadMatch) {
          const downloadUrl = downloadMatch[1].startsWith('http') 
            ? downloadMatch[1] 
            : `https://yts-subs.com${downloadMatch[1]}`;
          console.log(`    🎯 Found YTS download button: ${downloadUrl}`);
          
          try {
            await delay(1000); // Small delay before download
            content = await fetchData(downloadUrl);
            
            // Check if this is actual subtitle content
            if (content.includes('-->') || content.includes('WEBVTT')) {
              console.log(`    ✅ Successfully downloaded subtitle file`);
              return content;
            } else if (content.includes('<html')) {
              console.log(`    🔄 Got another HTML page, looking for direct link...`);
              
              // Sometimes YTS has another redirect, look for iframe or direct link
              const iframeRegex = /<iframe[^>]*src="([^"]*)"[^>]*>/gi;
              const iframeMatch = iframeRegex.exec(content);
              
              if (iframeMatch) {
                const iframeUrl = iframeMatch[1].startsWith('http') 
                  ? iframeMatch[1] 
                  : `https://yts-subs.com${iframeMatch[1]}`;
                console.log(`    🎯 Found iframe link: ${iframeUrl}`);
                
                try {
                  await delay(1000);
                  content = await fetchData(iframeUrl);
                  if (content.includes('-->') || content.includes('WEBVTT')) {
                    return content;
                  }
                } catch (e) {
                  console.log(`    ⚠️  Iframe download failed: ${e.message}`);
                }
              }
              
              // Look for any .srt file references in the HTML
              const srtFileRegex = /"(https?:\/\/[^"]*\.srt[^"]*)"/gi;
              const srtMatch = srtFileRegex.exec(content);
              
              if (srtMatch) {
                console.log(`    🎯 Found .srt file URL: ${srtMatch[1]}`);
                try {
                  await delay(1000);
                  content = await fetchData(srtMatch[1]);
                  if (content.includes('-->') || content.includes('WEBVTT')) {
                    return content;
                  }
                } catch (e) {
                  console.log(`    ⚠️  .srt file download failed: ${e.message}`);
                }
              }
            }
          } catch (e) {
            console.log(`    ⚠️  YTS download failed: ${e.message}`);
          }
        }
        
        // Alternative: Look for any .srt links in the page
        const allSrtLinks = content.match(/href="([^"]*\.srt[^"]*)"/gi);
        if (allSrtLinks && allSrtLinks.length > 0) {
          for (const link of allSrtLinks) {
            const urlMatch = link.match(/href="([^"]*\.srt[^"]*)"/);
            if (urlMatch) {
              const srtUrl = urlMatch[1].startsWith('http') 
                ? urlMatch[1] 
                : `https://yts-subs.com${urlMatch[1]}`;
              console.log(`    🎯 Trying .srt link: ${srtUrl}`);
              
              try {
                await delay(1000);
                content = await fetchData(srtUrl);
                if (content.includes('-->') || content.includes('WEBVTT')) {
                  return content;
                }
              } catch (e) {
                console.log(`    ⚠️  .srt link failed: ${e.message}`);
              }
            }
          }
        }
      }
      
      // Generic patterns for other sites
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
    
    // Final validation: Check if content looks like subtitles
    if (content.length > 200 && (content.includes('-->') || /\d+:\d+/.test(content))) {
      // Make sure it's not HTML
      if (content.includes('<html') || content.includes('<!DOCTYPE') || content.includes('<body')) {
        console.log(`    ❌ Content is HTML, not subtitle file`);
        return null;
      }
      return content;
    }
    
    console.log(`    ⚠️  Downloaded content doesn't look like subtitles (${content.length} chars)`);
    // Log a sample of the content to debug
    const sample = content.substring(0, 200).replace(/\n/g, ' ');
    console.log(`    🔍 Content sample: ${sample}...`);
    return null;
    
  } catch (error) {
    console.log(`    ❌ Download failed: ${error.message}`);
    return null;
  }
}

// Find subtitles for a movie using multiple sources
async function findSubtitles(movie) {
  console.log(`\n🎬 Finding subtitles for: "${movie.title}"`);
  
  const year = extractYear(movie.title) || movie.release_year;
  
  const methods = [
    () => searchYTSSubs(movie.title, year), // Try YTS-Subs first (reliable)
    () => searchOpenSubtitlesCom(movie.title, year) // Fallback to OpenSubtitles.com
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
  
  console.log(`    ❌ No subtitles found for "${movie.title}"`);
  return null;
}

// Save subtitle to Supabase
async function saveSubtitleToSupabase(movieId, subtitleContent, source) {
  try {
    // Validate content before saving
    if (!subtitleContent || subtitleContent.length < 100) {
      console.log(`    ❌ Subtitle content too short: ${subtitleContent?.length || 0} characters`);
      return false;
    }
    
    // Check if it's HTML content
    if (subtitleContent.includes('<html') || subtitleContent.includes('<!DOCTYPE') || subtitleContent.includes('<body')) {
      console.log(`    ❌ Content appears to be HTML, not saving`);
      return false;
    }
    
    // Check if it has subtitle markers
    if (!subtitleContent.includes('-->') && !/\d{2}:\d{2}:\d{2}/.test(subtitleContent)) {
      console.log(`    ❌ Content doesn't contain subtitle timestamps`);
      return false;
    }
    
    // First, delete existing subtitle
    const { error: deleteError } = await supabase
      .from('subtitles')
      .delete()
      .eq('movie_id', movieId);
    
    if (deleteError) {
      console.log(`    ⚠️  Warning: Could not delete existing subtitle: ${deleteError.message}`);
    }
    
    // Insert new subtitle
    const { error: insertError } = await supabase
      .from('subtitles')
      .insert({
        movie_id: movieId,
        subtitle_text: subtitleContent,
        source: source || 'opensubtitles'
      });
    
    if (insertError) {
      throw insertError;
    }
    
    console.log(`    ✅ Subtitle saved to database (${subtitleContent.length.toLocaleString()} characters)`);
    return true;
  } catch (error) {
    console.log(`    ❌ Failed to save subtitle: ${error.message}`);
    return false;
  }
}

// Main function
async function rescrapeSpecificMovies() {
  console.log('🎬 Re-scraping Subtitles for Specific Movies\n');
  console.log(`📊 Processing ${MOVIE_IDS.length} movie IDs with corrupted subtitle data\n`);
  
  // Check required environment variables
  if (!supabaseUrl || !supabaseServiceKey) {
    console.log('❌ Missing Supabase credentials');
    console.log('   Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    return;
  }
  
  console.log('ℹ️  Using web scraping approach (no API keys required)');
  
  console.log('✅ Environment variables configured\n');
  
  let processed = 0;
  let successful = 0;
  let failed = 0;
  const failures = [];
  
  for (const movieId of MOVIE_IDS) {
    try {
      processed++;
      console.log(`\n📊 Progress: ${processed}/${MOVIE_IDS.length}`);
      
      // Get movie info from database
      const { data: movie, error } = await supabase
        .from('movies')
        .select('id, title, release_year')
        .eq('id', movieId)
        .single();
      
      if (error || !movie) {
        console.log(`❌ Movie not found for ID: ${movieId}`);
        failed++;
        failures.push({ id: movieId, error: 'Movie not found' });
        continue;
      }
      
      // Find and download subtitles
      const subtitleResult = await findSubtitles(movie);
      
      if (subtitleResult) {
        const saved = await saveSubtitleToSupabase(movie.id, subtitleResult.content, subtitleResult.source);
        if (saved) {
          successful++;
          console.log(`✅ Successfully updated subtitles for "${movie.title}"`);
        } else {
          failed++;
          failures.push({ id: movieId, title: movie.title, error: 'Failed to save to database' });
        }
      } else {
        failed++;
        failures.push({ id: movieId, title: movie.title, error: 'No subtitles found' });
        console.log(`❌ No subtitles found for "${movie.title}"`);
      }
      
      // Rate limiting delay
      if (processed < MOVIE_IDS.length) {
        console.log(`⏱️  Waiting ${DELAY_MS/1000}s before next movie...`);
        await delay(DELAY_MS);
      }
      
    } catch (error) {
      failed++;
      failures.push({ id: movieId, error: error.message });
      console.log(`❌ Unexpected error for ${movieId}: ${error.message}`);
    }
  }
  
  // Final summary
  console.log('\n🎉 Re-scraping Complete!\n');
  console.log('📊 Final Results:');
  console.log(`   Total processed: ${processed}`);
  console.log(`   Successful: ${successful}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Success rate: ${processed > 0 ? ((successful / processed) * 100).toFixed(1) : 0}%`);
  
  if (failures.length > 0) {
    console.log('\n❌ Failed movies:');
    failures.forEach(failure => {
      console.log(`   - ${failure.title || failure.id}: ${failure.error}`);
    });
  }
}

// Run the re-scraper
rescrapeSpecificMovies().catch(console.error); 