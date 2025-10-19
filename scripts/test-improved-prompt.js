#!/usr/bin/env node

/**
 * Test the improved LLM prompt with Frozen
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Improved prompt
const improvedPrompt = `
You are an expert in child development and media literacy, helping parents assess animated movies for toddlers aged 2–5 years. Your task is to analyze a children's animated movie scene-by-scene based on its subtitle file and return two structured outputs:

⸻

1. Overall Scary Score

A JSON object that estimates how emotionally intense or scary this movie is for toddlers:

{
  "24m": 3,
  "36m": 2,
  "48m": 1,
  "60m": 1
}

	•	Use a scale of 1 (gentle, calm) to 5 (intense, potentially frightening).
	•	Consider suspense, danger, emotional distress, loud noises, or sad themes.
	•	Score each age separately — younger children are more sensitive to certain content.

2. Scene-by-Scene Analysis

IMPORTANT: You MUST provide a MINIMUM of 5 scenes. Focus on scenes that are emotionally intense, concerning, or important for parents to know about.

For each scene, provide:

{
  "timestamp_start": "00:23:45",
  "timestamp_end": "00:25:30",
  "description": "A chase through dark tunnels with loud noises and scary music.",
  "tags": ["chase", "darkness", "loud sound", "threatening music"],
  "intensity": 4,
  "age_flags": {
    "24m": "🚫",
    "36m": "⚠️",
    "48m": "✅",
    "60m": "✅"
  }
}

	•	Use subtitle timestamps as anchors.
	•	Write brief, clear descriptions in parent-friendly language.
	•	Include emotional or sensory tags like "separation," "darkness," "yelling," "creepy sound," etc.
	•	Use an intensity scale of 1 to 5:
	•	1 = Calm, gentle
	•	2 = Mild emotional content, slight tension
	•	3 = Noticeable tension, sadness, or mild peril
	•	4 = Intense peril, distress, or scary moments
	•	5 = Very intense, scary, or emotionally overwhelming

AGE FLAG GUIDELINES (be realistic and age-appropriate):
	•	✅ = Appropriate for this age
	•	⚠️ = Use caution, may need parental guidance
	•	🚫 = Not recommended, too intense/scary

AGE-SPECIFIC CONSIDERATIONS:
- **24m (2 years)**: Very sensitive to loud noises, separation, scary visuals, intense emotions
- **36m (3 years)**: Still sensitive but can handle mild tension with guidance
- **48m (4 years)**: Can handle moderate intensity, understands fantasy vs reality better
- **60m (5 years)**: Can handle most content in age-appropriate movies

REALISTIC SCORING EXAMPLES:
- Intensity 1-2 scenes: Usually ✅ for 4y+, ⚠️ for 3y+, 🚫 for 2y+
- Intensity 3 scenes: Usually ✅ for 5y+, ⚠️ for 4y+, 🚫 for 2-3y+
- Intensity 4 scenes: Usually ⚠️ for 5y+, 🚫 for 2-4y+
- Intensity 5 scenes: Usually 🚫 for all ages

CRITICAL REQUIREMENTS:
- You MUST return AT LEAST 5 scenes
- Include ALL emotionally intense or concerning scenes
- Cover the entire movie timeline from beginning to end
- **IMPORTANT:** Use the following keys for all age-based scores and flags: "24m" (2 years), "36m" (3 years), "48m" (4 years), "60m" (5 years). Do NOT use year-based keys.
- **Age flags MUST be differentiated by age - don't mark all ages the same unless truly appropriate**
- **Be realistic: G/PG-rated Disney movies should have some ✅ flags for older kids**
- **Only use 🚫 for ALL ages for truly inappropriate content (violence, death, extreme fear)**

You will be given the subtitle file as input. Use its dialogue and timing to infer what's happening, including tone, emotion, and pacing. Consider the movie's rating and target audience when making age recommendations.

Please return ONLY a valid JSON object in this exact format:
{
  "overall_scary_score": {
    "24m": 3,
    "36m": 2,
    "48m": 1,
    "60m": 1
  },
  "scenes": [
    {
      "timestamp_start": "00:23:45",
      "timestamp_end": "00:25:30",
      "description": "Scene description",
      "tags": ["tag1", "tag2"],
      "intensity": 4,
      "age_flags": {
        "24m": "🚫",
        "36m": "⚠️",
        "48m": "✅",
        "60m": "✅"
      }
    }
  ]
}

Please analyze the following subtitle text:
`;

async function testImprovedPrompt() {
  console.log('🧪 Testing Improved LLM Prompt with Frozen...\n');
  
  try {
    // Get Frozen movie data
    const { data: frozenMovies, error: frozenError } = await supabase
      .from('movies')
      .select('*')
      .ilike('title', '%frozen%');
    
    if (frozenError) {
      throw new Error(`Failed to get Frozen: ${frozenError.message}`);
    }
    
    if (!frozenMovies || frozenMovies.length === 0) {
      throw new Error('No Frozen movies found');
    }
    
    const frozen = frozenMovies[0]; // Get the first Frozen movie
    
    console.log(`📽️  Movie: ${frozen.title}`);
    console.log(`📊 Current Overall Scores: ${JSON.stringify(frozen.age_scores)}`);
    console.log(`🎬 Current Scenes: ${frozen.scenes?.length || 0} scenes\n`);
    
    // Get subtitle data (we'll use a sample for testing)
    const sampleSubtitles = `00:05:13,00:05:22
Anna: Elsa, do you want to build a snowman?

00:05:23,00:05:30
Elsa: Go away, Anna!

00:05:31,00:05:45
Anna: Okay, bye!

00:27:23,00:27:35
Elsa: I can't! I can't control it!

00:27:36,00:27:45
Anna: Elsa, please! I know we can figure this out together!

00:42:20,00:42:30
Elsa: Let it go! Let it go!

00:42:31,00:42:45
Elsa: Can't hold it back anymore!

01:15:15,01:15:25
Elsa: I'm such a fool! I can't be free!

01:15:26,01:15:35
Anna: Elsa, wait!

01:26:11,01:26:20
Elsa: Anna! No!

01:26:21,01:26:30
Anna: Elsa, I love you!`;

    console.log('🤖 Calling Claude API with improved prompt...');
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: `${improvedPrompt}\n\nSUBTITLE TEXT:\n${sampleSubtitles}`
          }
        ]
      })
    });
    
    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    const claudeResponse = data.content[0].text;
    
    console.log('📝 Claude Response:');
    console.log(claudeResponse);
    
    // Try to parse the response
    try {
      const jsonMatch = claudeResponse.match(/```json\n([\s\S]*?)\n```/) || 
                       claudeResponse.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const parsed = JSON.parse(jsonStr);
        
        console.log('\n✅ Parsed Response:');
        console.log('Overall Scores:', JSON.stringify(parsed.overall_scary_score));
        console.log(`Scenes: ${parsed.scenes.length} scenes`);
        
        parsed.scenes.forEach((scene, index) => {
          console.log(`\nScene ${index + 1}:`);
          console.log(`  Time: ${scene.timestamp_start} - ${scene.timestamp_end}`);
          console.log(`  Intensity: ${scene.intensity}/5`);
          console.log(`  Age Flags: ${JSON.stringify(scene.age_flags)}`);
          console.log(`  Description: ${scene.description}`);
        });
        
        // Check if the new response is more realistic
        const hasVariedFlags = parsed.scenes.some(scene => {
          const flags = Object.values(scene.age_flags);
          return new Set(flags).size > 1; // More than one unique flag
        });
        
        console.log(`\n🎯 Analysis:`);
        console.log(`- Has varied age flags: ${hasVariedFlags ? '✅' : '❌'}`);
        console.log(`- More realistic than current data: ${hasVariedFlags ? '✅' : '❌'}`);
        
      } else {
        console.log('❌ Could not parse JSON from response');
      }
      
    } catch (parseError) {
      console.log('❌ Failed to parse response:', parseError.message);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testImprovedPrompt();
