import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log('🎯 FROZEN MOVIES CLAUDE ANALYSIS RESULTS');
console.log('========================================');

// Check Frozen movies specifically
const { data: frozenMovies, error } = await supabase
  .from('movies')
  .select(`
    id, title,
    scenes(
      id, 
      intensity_2y, 
      intensity_3y, 
      intensity_4y, 
      intensity_5y,
      content_warnings
    )
  `)
  .ilike('title', '%frozen%');

if (error) {
  console.error('Error:', error);
  process.exit(1);
}

for (const movie of frozenMovies || []) {
  console.log(`\n🎬 ${movie.title}:`);
  console.log(`   📊 Total scenes analyzed: ${movie.scenes ? movie.scenes.length : 0}`);
  
  if (movie.scenes && movie.scenes.length > 0) {
    console.log('   🔍 Sample scene intensity ratings:');
    movie.scenes.slice(0, 3).forEach((scene, i) => {
      console.log(`   Scene ${i+1}: 2y=${scene.intensity_2y} 3y=${scene.intensity_3y} 4y=${scene.intensity_4y} 5y=${scene.intensity_5y}`);
      if (scene.content_warnings) {
        console.log(`      ⚠️  Content warnings: ${scene.content_warnings}`);
      }
    });
    
    if (movie.scenes.length > 3) {
      console.log(`   ... and ${movie.scenes.length - 3} more scenes`);
    }
  }
}

console.log('\n✅ Frozen movies Claude analysis check complete!'); 