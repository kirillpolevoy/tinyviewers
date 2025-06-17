import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

console.log('🚀 NEW FROZEN ANALYSIS SCRIPT - VERSION 1.0');
console.log('🎯 This script will ONLY analyze Frozen movies');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log('🔍 Environment check:');
console.log('- SUPABASE_URL:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log('- SUPABASE_SERVICE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log('- CLAUDE_API_KEY:', !!process.env.CLAUDE_API_KEY);

// Get Frozen movies
const { data: movies, error } = await supabase
  .from('movies')
  .select(`
    id, 
    title,
    subtitles(subtitle_text),
    scenes(id)
  `)
  .ilike('title', '%frozen%')
  .not('subtitles', 'is', null)
  .or('is_active.is.null,is_active.eq.true');

if (error) {
  console.error('❌ Database error:', error);
  process.exit(1);
}

console.log(`🎬 Found ${movies?.length || 0} Frozen movies`);
console.log('📝 Movies:', movies?.map(m => ({ 
  title: m.title, 
  hasSubtitles: !!m.subtitles?.length,
  hasScenes: !!m.scenes?.length,
  subtitleLength: m.subtitles?.[0]?.subtitle_text?.length || 0
})));

// For now, just test the filtering - don't actually call Claude
console.log('✅ Frozen analysis script test complete!');
console.log('🔧 Ready to add Claude API integration once filtering is confirmed working'); 