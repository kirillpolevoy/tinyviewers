import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

console.log('🚀 NEW CLAUDE TEST SCRIPT - VERSION 2.0');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

console.log('✅ Environment loaded successfully');
console.log('🔍 Claude API key available:', !!process.env.CLAUDE_API_KEY);

// Test Claude API with a simple request
async function testClaudeAPI() {
  const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
  
  console.log('🤖 Testing Claude API with current model...');
  console.log('📋 Using model: claude-3-5-sonnet-20241022');
  
  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: 'Hello! Please respond with just "API test successful" if you can read this.'
          }
        ]
      })
    });

    console.log('📡 Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Error response:', errorText);
      return false;
    }

    const data = await response.json();
    console.log('✅ Claude response:', data.content[0].text);
    return true;
    
  } catch (error) {
    console.error('❌ API test failed:', error.message);
    return false;
  }
}

// Run the test
const success = await testClaudeAPI();

if (success) {
  console.log('🎉 Claude API is working! Ready to analyze Frozen movies.');
} else {
  console.log('❌ Claude API test failed. Check your API key and model name.');
} 