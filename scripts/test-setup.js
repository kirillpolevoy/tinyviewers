import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function testSetup() {
  console.log('🧪 Testing Subtitle System Setup...\n');
  
  // Test environment variables
  console.log('📋 Environment Variables:');
  console.log('- NEXT_PUBLIC_SUPABASE_URL:', !!supabaseUrl ? '✅' : '❌');
  console.log('- SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey ? '✅' : '❌');
  console.log('- TMDB_API_KEY:', !!process.env.TMDB_API_KEY ? '✅' : '❌');
  console.log('- OPENSUBTITLES_API_KEY:', !!process.env.OPENSUBTITLES_API_KEY ? '✅' : '❌');
  console.log('');
  
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing required Supabase credentials');
    process.exit(1);
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  try {
    // Test database connection
    console.log('🔌 Testing Database Connection...');
    const { data: movies, error: moviesError } = await supabase
      .from('movies')
      .select('id, title, imdb_id')
      .limit(1);
    
    if (moviesError) {
      console.error('❌ Movies table access failed:', moviesError.message);
      return;
    }
    
    console.log('✅ Movies table accessible');
    
    // Test if imdb_id column exists
    if (movies.length > 0) {
      const hasImdbId = 'imdb_id' in movies[0];
      console.log('✅ IMDB ID column:', hasImdbId ? 'Present' : '❌ Missing');
    }
    
    // Test subtitles table
    const { data: subtitles, error: subtitlesError } = await supabase
      .from('subtitles')
      .select('id')
      .limit(1);
    
    if (subtitlesError) {
      console.log('⚠️  Subtitles table:', subtitlesError.message);
    } else {
      console.log('✅ Subtitles table accessible');
    }
    
    // Get statistics
    console.log('\n📊 Current Statistics:');
    
    const { count: totalMovies } = await supabase
      .from('movies')
      .select('*', { count: 'exact', head: true });
    
    const { count: moviesWithImdb } = await supabase
      .from('movies')
      .select('*', { count: 'exact', head: true })
      .not('imdb_id', 'is', null);
    
    const { count: totalSubtitles } = await supabase
      .from('subtitles')
      .select('*', { count: 'exact', head: true });
    
    console.log(`- Total movies: ${totalMovies}`);
    console.log(`- Movies with IMDB IDs: ${moviesWithImdb || 0}`);
    console.log(`- Movies with subtitles: ${totalSubtitles || 0}`);
    
    const imdbPercentage = totalMovies ? ((moviesWithImdb || 0) / totalMovies * 100).toFixed(1) : 0;
    const subtitlePercentage = totalMovies ? ((totalSubtitles || 0) / totalMovies * 100).toFixed(1) : 0;
    
    console.log(`- IMDB ID coverage: ${imdbPercentage}%`);
    console.log(`- Subtitle coverage: ${subtitlePercentage}%`);
    
    console.log('\n🎉 Setup test complete!');
    
    if (!process.env.TMDB_API_KEY || !process.env.OPENSUBTITLES_API_KEY) {
      console.log('\n⚠️  Missing API keys. Please add to .env.local:');
      if (!process.env.TMDB_API_KEY) console.log('- TMDB_API_KEY');
      if (!process.env.OPENSUBTITLES_API_KEY) console.log('- OPENSUBTITLES_API_KEY');
      console.log('\nSee SUBTITLE_SYSTEM.md for setup instructions.');
    }
    
  } catch (error) {
    console.error('❌ Setup test failed:', error.message);
  }
}

// Run the test
testSetup(); 