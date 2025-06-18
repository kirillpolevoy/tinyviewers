import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from root .env.local
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

// Environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkMovieStats() {
  console.log('🔍 Movie Database Analysis\n');
  
  try {
    // Get all movies
    const { data: allMovies, error: allError } = await supabase
      .from('movies')
      .select(`
        id, 
        title,
        is_active,
        subtitles(id, subtitle_text),
        scenes(id)
      `);
    
    if (allError) throw allError;
    
    console.log(`📊 TOTAL MOVIES: ${allMovies.length}\n`);
    
    // Break down by is_active status
    const activeTrue = allMovies.filter(m => m.is_active === true);
    const activeNull = allMovies.filter(m => m.is_active === null);
    const activeFalse = allMovies.filter(m => m.is_active === false);
    
    console.log('🎯 BY ACTIVE STATUS:');
    console.log(`  - is_active = true: ${activeTrue.length}`);
    console.log(`  - is_active = null: ${activeNull.length}`);
    console.log(`  - is_active = false: ${activeFalse.length}`);
    console.log(`  - ACTIVE TOTAL (true + null): ${activeTrue.length + activeNull.length}\n`);
    
    // Break down by subtitles
    const withSubtitles = allMovies.filter(m => m.subtitles && m.subtitles.length > 0);
    const withoutSubtitles = allMovies.filter(m => !m.subtitles || m.subtitles.length === 0);
    
    console.log('📄 BY SUBTITLES:');
    console.log(`  - With subtitles: ${withSubtitles.length}`);
    console.log(`  - Without subtitles: ${withoutSubtitles.length}\n`);
    
    // Break down by scenes
    const withScenes = allMovies.filter(m => m.scenes && m.scenes.length > 0);
    const withoutScenes = allMovies.filter(m => !m.scenes || m.scenes.length === 0);
    
    console.log('🎬 BY SCENES:');
    console.log(`  - With scenes: ${withScenes.length}`);
    console.log(`  - Without scenes: ${withoutScenes.length}\n`);
    
    // Active movies with subtitles (the query we're using)
    const activeWithSubtitles = allMovies.filter(m => 
      (m.is_active === true || m.is_active === null) && 
      m.subtitles && m.subtitles.length > 0
    );
    
    console.log('🎯 ACTIVE MOVIES WITH SUBTITLES:');
    console.log(`  - Count: ${activeWithSubtitles.length}`);
    console.log(`  - With existing scenes: ${activeWithSubtitles.filter(m => m.scenes && m.scenes.length > 0).length}`);
    console.log(`  - Without scenes: ${activeWithSubtitles.filter(m => !m.scenes || m.scenes.length === 0).length}\n`);
    
    // Test the exact query from claude-analysis.js
    const { data: queryResult, error: queryError } = await supabase
      .from('movies')
      .select(`
        id, 
        title,
        subtitles(subtitle_text),
        scenes(id)
      `)
      .or('is_active.is.null,is_active.eq.true')
      .not('subtitles', 'is', null);
    
    if (queryError) {
      console.log('❌ Query error:', queryError);
    } else {
      console.log('🔍 EXACT CLAUDE-ANALYSIS QUERY RESULT:');
      console.log(`  - Count: ${queryResult.length}`);
      
      // Filter for movies with actual subtitle content
      const moviesWithSubtitleContent = queryResult.filter(movie => {
        const hasSubtitles = movie.subtitles && movie.subtitles.length > 0;
        return hasSubtitles;
      });
      
      console.log(`  - With subtitle content: ${moviesWithSubtitleContent.length}`);
      console.log(`  - Sample titles:`, moviesWithSubtitleContent.slice(0, 5).map(m => m.title));
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkMovieStats(); 