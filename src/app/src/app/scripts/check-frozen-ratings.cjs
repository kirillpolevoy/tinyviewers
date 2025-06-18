const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

const envPath = path.join(__dirname, '..', '..', '..', '.env.local');
dotenv.config({ path: envPath });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkFrozenRatings() {
  console.log('🔍 Checking Frozen movies IMDB ratings...\n');

  try {
    // Get both Frozen movies
    const { data: movies, error } = await supabase
      .from('movies')
      .select('id, title, imdb_id, imdb_rating, tmdb_rating, rating, release_year')
      .ilike('title', '%Frozen%')
      .order('title');

    if (error) {
      console.error('❌ Error fetching movies:', error);
      return;
    }

    if (!movies || movies.length === 0) {
      console.log('❌ No Frozen movies found');
      return;
    }

    console.log(`🎬 Found ${movies.length} Frozen movies:\n`);

    movies.forEach((movie, index) => {
      console.log(`${index + 1}. ${movie.title}`);
      console.log(`   ID: ${movie.id}`);
      console.log(`   IMDB ID: ${movie.imdb_id}`);
      console.log(`   IMDB Rating: ${movie.imdb_rating || 'NOT SET'}`);
      console.log(`   TMDB Rating: ${movie.tmdb_rating || 'NOT SET'}`);
      console.log(`   Fallback Rating: ${movie.rating || 'NOT SET'}`);
      console.log(`   Release Year: ${movie.release_year || 'NOT SET'}`);
      console.log('');
    });

    // Check expected vs actual
    console.log('🎯 Expected IMDB Ratings:');
    console.log('   Frozen (2013): 7.4');
    console.log('   Frozen II (2019): 6.8');
    console.log('');

    // Analyze the issues
    const frozen1 = movies.find(m => m.title.includes('Frozen') && !m.title.includes('II'));
    const frozen2 = movies.find(m => m.title.includes('Frozen') && m.title.includes('II'));

    if (frozen1) {
      const currentRating = parseFloat(frozen1.imdb_rating || '0');
      const expectedRating = 7.4;
      if (Math.abs(currentRating - expectedRating) > 0.1) {
        console.log(`❌ Frozen (2013) rating is incorrect:`);
        console.log(`   Current: ${frozen1.imdb_rating || 'NOT SET'}`);
        console.log(`   Expected: ${expectedRating}`);
        console.log(`   IMDB ID: ${frozen1.imdb_id}`);
      } else {
        console.log(`✅ Frozen (2013) rating is correct: ${currentRating}`);
      }
    }

    if (frozen2) {
      const currentRating = parseFloat(frozen2.imdb_rating || '0');
      const expectedRating = 6.8;
      if (Math.abs(currentRating - expectedRating) > 0.1) {
        console.log(`❌ Frozen II (2019) rating is incorrect:`);
        console.log(`   Current: ${frozen2.imdb_rating || 'NOT SET'}`);
        console.log(`   Expected: ${expectedRating}`);
        console.log(`   IMDB ID: ${frozen2.imdb_id}`);
      } else {
        console.log(`✅ Frozen II (2019) rating is correct: ${currentRating}`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkFrozenRatings(); 