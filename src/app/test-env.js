import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from root .env.local
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

// Environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const claudeApiKey = process.env.CLAUDE_API_KEY;

console.log('Environment test:');
console.log('- SUPABASE_URL:', !!supabaseUrl);
console.log('- SUPABASE_SERVICE_KEY:', !!supabaseServiceKey);
console.log('- CLAUDE_API_KEY:', !!claudeApiKey);

if (supabaseUrl && supabaseServiceKey && claudeApiKey) {
  console.log('✅ All environment variables loaded successfully!');
} else {
  console.log('❌ Some environment variables are missing');
} 