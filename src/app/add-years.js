import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function extractYear(title) {
  const match = title.match(/\((\d{4})\)/);
  return match ? parseInt(match[1]) : null;
}

async function main() {
  console.log('🎬 Adding release years to movies...');
  
  const { data: movies, error } = await supabase
    .from('movies')
    .select('id, title');
  
  if (error) {
    console.error('Error:', error.message);
    return;
  }
  
  console.log(`📊 Found ${movies.length} movies`);
  
  let updated = 0;
  for (const movie of movies) {
    const year = extractYear(movie.title);
    if (year) {
      const { error: updateError } = await supabase
        .from('movies')
        .update({ release_year: year })
        .eq('id', movie.id);
      
      if (updateError) {
        console.log(`❌ Failed to update ${movie.title}: ${updateError.message}`);
      } else {
        console.log(`✅ ${movie.title} -> ${year}`);
        updated++;
      }
    } else {
      console.log(`⚠️  No year found in "${movie.title}"`);
    }
  }
  
  console.log(`\n🎉 Updated ${updated} movies with release years!`);
  console.log('🎯 Refresh your browser to see years as blue tags next to ratings.');
}

main().catch(console.error); 