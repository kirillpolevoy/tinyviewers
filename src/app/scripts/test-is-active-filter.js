import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

console.log('🔍 Testing is_active filtering...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testIsActiveFilter() {
  try {
    console.log('\n📊 Testing movie queries with is_active filtering...\n');

    // Test 1: Get all movies (without filter)
    console.log('1️⃣ Testing: All movies (no filter)');
    const { data: allMovies, error: allError } = await supabase
      .from('movies')
      .select('id, title, is_active')
      .limit(10);
    
    if (allError) {
      console.error('❌ Error fetching all movies:', allError);
      return;
    }
    
    console.log(`   Found ${allMovies.length} movies`);
    console.log('   Sample movies:');
    allMovies.slice(0, 5).forEach(movie => {
      console.log(`     - ${movie.title} (is_active: ${movie.is_active})`);
    });

    // Test 2: Get only active movies (with filter)
    console.log('\n2️⃣ Testing: Only active movies (with filter)');
    const { data: activeMovies, error: activeError } = await supabase
      .from('movies')
      .select('id, title, is_active')
      .or('is_active.is.null,is_active.eq.true')
      .limit(10);
    
    if (activeError) {
      console.error('❌ Error fetching active movies:', activeError);
      return;
    }
    
    console.log(`   Found ${activeMovies.length} active movies`);
    console.log('   Sample active movies:');
    activeMovies.slice(0, 5).forEach(movie => {
      console.log(`     - ${movie.title} (is_active: ${movie.is_active})`);
    });

    // Test 3: Get only inactive movies
    console.log('\n3️⃣ Testing: Only inactive movies');
    const { data: inactiveMovies, error: inactiveError } = await supabase
      .from('movies')
      .select('id, title, is_active')
      .eq('is_active', false)
      .limit(10);
    
    if (inactiveError) {
      console.error('❌ Error fetching inactive movies:', inactiveError);
      return;
    }
    
    console.log(`   Found ${inactiveMovies.length} inactive movies`);
    if (inactiveMovies.length > 0) {
      console.log('   Sample inactive movies:');
      inactiveMovies.slice(0, 5).forEach(movie => {
        console.log(`     - ${movie.title} (is_active: ${movie.is_active})`);
      });
    } else {
      console.log('   No inactive movies found');
    }

    // Test 4: Count movies by is_active status
    console.log('\n4️⃣ Testing: Count by is_active status');
    const { data: nullMovies, error: nullError } = await supabase
      .from('movies')
      .select('id')
      .is('is_active', null);
    
    const { data: trueMovies, error: trueError } = await supabase
      .from('movies')
      .select('id')
      .eq('is_active', true);
    
    const { data: falseMovies, error: falseError } = await supabase
      .from('movies')
      .select('id')
      .eq('is_active', false);
    
    if (nullError || trueError || falseError) {
      console.error('❌ Error counting movies by status');
      return;
    }
    
    console.log(`   Movies with is_active = null: ${nullMovies.length}`);
    console.log(`   Movies with is_active = true: ${trueMovies.length}`);
    console.log(`   Movies with is_active = false: ${falseMovies.length}`);
    console.log(`   Total movies: ${nullMovies.length + trueMovies.length + falseMovies.length}`);

    // Test 5: Verify filter logic
    console.log('\n5️⃣ Testing: Filter logic verification');
    const expectedActiveCount = nullMovies.length + trueMovies.length;
    const actualActiveCount = activeMovies.length;
    
    console.log(`   Expected active movies: ${expectedActiveCount}`);
    console.log(`   Actual active movies: ${actualActiveCount}`);
    console.log(`   Filter working correctly: ${expectedActiveCount === actualActiveCount ? '✅' : '❌'}`);

    console.log('\n🎉 is_active filtering test complete!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testIsActiveFilter(); 