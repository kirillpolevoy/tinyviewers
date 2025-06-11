import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Test specific movies that should have subtitles
console.log("🔍 Searching for Frozen movies...\n");

const { data: frozenMovies, error } = await supabase
  .from("movies")
  .select("id, title")
  .ilike("title", "%frozen%");

console.log("Movies with Frozen in title:", frozenMovies);

const testMovies = [
  "The Incredibles 2",
  "The Polar Express", 
  "The Secret Life of Pets"
];

async function testSpecificMovies() {
  console.log('🎬 Testing specific popular movies...\n');
  
  try {
    // Get these specific movies from database
    const { data: movies, error } = await supabase
      .from('movies')
      .select(`
        id, 
        title, 
        imdb_id,
        subtitles(id)
      `)
      .in('title', testMovies)
      .not('imdb_id', 'is', null);
    
    if (error) throw error;
    
    const moviesWithoutSubtitles = movies.filter(movie => 
      !movie.subtitles || movie.subtitles.length === 0
    );
    
    console.log(`Found ${moviesWithoutSubtitles.length} test movies needing subtitles:\n`);
    
    moviesWithoutSubtitles.forEach((movie, i) => {
      console.log(`${i+1}. "${movie.title}" (IMDB: ${movie.imdb_id})`);
    });
    
    if (moviesWithoutSubtitles.length === 0) {
      console.log('✅ All test movies already have subtitles!');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testSpecificMovies(); 