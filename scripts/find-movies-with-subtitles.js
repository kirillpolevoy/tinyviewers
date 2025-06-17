import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { data } = await supabase
  .from('movies')
  .select('id, title')
  .not('subtitles', 'is', null)
  .limit(10);

console.log('Movies with subtitles:');
data?.forEach(m => console.log(`${m.id} - ${m.title}`)); 