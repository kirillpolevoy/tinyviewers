import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

console.log('Environment Variables Check:');
console.log('CLAUDE_API_KEY length:', process.env.CLAUDE_API_KEY?.length);
console.log('CLAUDE_API_KEY starts with:', process.env.CLAUDE_API_KEY?.substring(0, 20));
console.log('CLAUDE_API_KEY ends with:', process.env.CLAUDE_API_KEY?.substring(-10));

// Also check the other env vars
console.log('SUPABASE_URL:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log('SUPABASE_SERVICE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY); 