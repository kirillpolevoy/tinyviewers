import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

console.log('🔑 CLAUDE API KEY TEST');
console.log('==========================================');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const apiKey = process.env.CLAUDE_API_KEY;

console.log('🔍 API Key Status:');
console.log('- Found in environment:', !!apiKey);
console.log('- Length:', apiKey?.length || 0);
console.log('- Starts with:', apiKey?.substring(0, 15) + '...' || 'N/A');

if (!apiKey) {
  console.log('\n❌ NO API KEY FOUND');
  console.log('📋 To fix this:');
  console.log('1. Get a Claude API key from: https://console.anthropic.com/');
  console.log('2. Add it to .env.local file as: CLAUDE_API_KEY=your_key_here');
  process.exit(1);
}

console.log('\n🧪 Testing API key with simple request...');

try {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 50,
      messages: [
        {
          role: 'user',
          content: 'Say "API test successful" if you can read this message.'
        }
      ]
    })
  });

  console.log('📡 Response status:', response.status);

  if (response.status === 200) {
    const data = await response.json();
    console.log('✅ API KEY IS WORKING!');
    console.log('🤖 Claude response:', data.content[0].text);
    console.log('\n🎉 Ready to analyze Frozen movies!');
  } else if (response.status === 401) {
    const errorData = await response.json();
    console.log('❌ API KEY IS INVALID');
    console.log('🔍 Error:', errorData.error?.message || 'Authentication failed');
    console.log('\n📋 To fix this:');
    console.log('1. Check if your API key is correct');
    console.log('2. Get a new API key from: https://console.anthropic.com/');
    console.log('3. Make sure you have credits/quota available');
  } else if (response.status === 429) {
    console.log('⚠️ RATE LIMITED');
    console.log('🔍 You are hitting rate limits - wait and try again');
  } else {
    const errorText = await response.text();
    console.log('❌ UNEXPECTED ERROR');
    console.log('🔍 Status:', response.status);
    console.log('🔍 Response:', errorText);
  }

} catch (error) {
  console.log('❌ CONNECTION ERROR');
  console.log('🔍 Error:', error.message);
  console.log('📋 Check your internet connection and try again');
} 