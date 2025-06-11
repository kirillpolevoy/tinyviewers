import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function extractYear(title) {
  const match = title.match(/\((\d{4})\)/);
  return match ? parseInt(match[1]) : null;
}

async function addReleaseYears() {
  console.log('🎬 Adding release years to movies...\n');
  
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing required Supabase credentials');
    process.exit(1);
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  try {
    // Get all movies
    const { data: movies, error } = await supabase
      .from('movies')
      .select('id, title');
    
    if (error) {
      console.error('❌ Error fetching movies:', error.message);
      return;
    }
    
    console.log(`📊 Found ${movies.length} movies`);
    
    let updated = 0;
    let skipped = 0;
    
    for (const movie of movies) {
      const year = extractYear(movie.title);
      if (year) {
        const { error: updateError } = await supabase
          .from('movies')
          .update({ release_year: year })
          .eq('id', movie.id);
        
        if (updateError) {
          console.log(`❌ Failed: ${movie.title} - ${updateError.message}`);
        } else {
          console.log(`✅ ${movie.title} -> ${year}`);
          updated++;
        }
      } else {
        console.log(`⚠️  No year: ${movie.title}`);
        skipped++;
      }
    }
    
    console.log(`\n🎉 Complete!`);
    console.log(`✅ Updated ${updated} movies with release years`);
    console.log(`⚠️  Skipped ${skipped} movies (no year in title)`);
    console.log('🎯 Refresh your browser to see years as blue tags next to ratings.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run the script
addReleaseYears(); 