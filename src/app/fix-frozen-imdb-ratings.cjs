const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixFrozenIMDBRatings() {
  console.log('🔧 Fixing Frozen movies IMDB ratings...\n');

  try {
    // Get both Frozen movies
    const { data: movies, error } = await supabase
      .from('movies')
      .select('id, title, imdb_id, imdb_rating')
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

    console.log(`🎬 Found ${movies.length} Frozen movies to fix:\n`);

    // Define correct ratings
    const correctRatings = {
      'tt2294629': { rating: '7.4', title: 'Frozen (2013)' },     // Frozen
      'tt4520988': { rating: '6.8', title: 'Frozen II (2019)' }   // Frozen II
    };

    let fixed = 0;
    let errors = 0;

    for (const movie of movies) {
      const correctData = correctRatings[movie.imdb_id];
      
      if (!correctData) {
        console.log(`⚠️  No correction data for ${movie.title} (IMDB: ${movie.imdb_id})`);
        continue;
      }

      console.log(`🔄 Fixing ${movie.title}:`);
      console.log(`   Current IMDB Rating: ${movie.imdb_rating}`);
      console.log(`   Correct IMDB Rating: ${correctData.rating}`);

      // Update the movie with correct IMDB rating
      const { error: updateError } = await supabase
        .from('movies')
        .update({ 
          imdb_rating: correctData.rating
        })
        .eq('id', movie.id);

      if (updateError) {
        console.log(`   ❌ Failed to update: ${updateError.message}`);
        errors++;
      } else {
        console.log(`   ✅ Successfully updated to ${correctData.rating}`);
        fixed++;
      }
      console.log('');
    }

    console.log('🎉 Frozen IMDB ratings fix complete!');
    console.log(`✅ Fixed: ${fixed} movies`);
    console.log(`❌ Errors: ${errors} movies`);
    
    if (fixed > 0) {
      console.log('\n🔄 The UI will now show the correct IMDB ratings:');
      console.log('   • Frozen (2013): 7.4/10 ⭐');
      console.log('   • Frozen II (2019): 6.8/10 ⭐');
      console.log('\n🎯 Refresh your browser to see the corrected ratings!');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

fixFrozenIMDBRatings(); 