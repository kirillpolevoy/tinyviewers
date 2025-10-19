#!/usr/bin/env node

/**
 * Re-analyze Finding Nemo with Claude Haiku to get proper age scores
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
const claudeApiKey = process.env.CLAUDE_API_KEY;

if (!supabaseUrl || !supabaseServiceKey || !claudeApiKey) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Enhanced Claude prompt for better age analysis
const claudePrompt = `
You are an expert in child development and media literacy, helping parents assess animated movies for children aged 2–5 years. Your task is to analyze a children's animated movie scene-by-scene based on its subtitle file and return two structured outputs:

⸻

1. Overall Scary Score

A JSON object that estimates how emotionally intense or scary this movie is for children:

{
  "24m": 3,
  "36m": 2,
  "48m": 1,
  "60m": 1
}

• Use a scale of 1 (gentle, calm) to 5 (intense, potentially frightening).
• Consider suspense, danger, emotional distress, loud noises, sad themes, or separation anxiety.
• Score each age separately — 2-year-olds are more sensitive than 5-year-olds.

2. Scene-by-Scene Analysis

IMPORTANT: You MUST provide a MINIMUM of 5 scenes. If the movie has fewer than 5 concerning scenes, include additional scenes that show character development, emotional moments, or any content that parents should be aware of.

For each scene (both concerning and important developmental moments), provide:

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

• Use subtitle timestamps as anchors.
• Write brief, clear descriptions in parent-friendly language.
• Include emotional or sensory tags like "separation," "darkness," "yelling," "creepy sound," etc.
• Use an intensity scale of 1 to 5:
• 1 = Calm
• 2 = Mild emotional content
• 3 = Noticeable tension or sadness
• 4 = Intense peril or distress
• 5 = Very intense, scary, or emotionally overwhelming
• Age flags reflect content sensitivity:
• ✅ = Appropriate
• ⚠️ = Use caution
• 🚫 = Not recommended

CRITICAL REQUIREMENTS:
- You MUST return AT LEAST 5 scenes
- Include ALL emotionally intense or concerning scenes
- If there are fewer than 5 concerning scenes, add scenes showing character development, emotional moments, or important plot points
- Cover the entire movie timeline from beginning to end
- Be thorough and comprehensive in your analysis
- **IMPORTANT:** Use the following keys for all age-based scores and flags: "24m" (2 years), "36m" (3 years), "48m" (4 years), "60m" (5 years). Do NOT use year-based keys.
- **You MUST use 🚫 for the most intense or emotionally overwhelming scenes (e.g., injury, death, unconsciousness, major peril) for ages 24m and 36m.**
- **Not all scenes should be ⚠️ for all ages. Use 🚫, ⚠️, and ✅ appropriately and differentiate by age.**
- **Checklist before returning your answer:**
  - [ ] At least one scene is marked 🚫 for 24m and 36m if the movie contains any intense peril, injury, death, or unconsciousness.
  - [ ] Age flags are differentiated by age and not all the same.
  - [ ] All four age keys ("24m", "36m", "48m", "60m") are present in every scene's age_flags.

You will be given the subtitle file as input. Use its dialogue and timing to infer what's happening, including tone, emotion, and pacing. When in doubt, err on the side of protecting very young children (age 2–3).

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

async function callClaudeAPI(subtitleText) {
  const messages = [
    {
      role: 'user',
      content: `${claudePrompt}\n\nSUBTITLE TEXT:\n${subtitleText}`
    }
  ];

  const requestBody = {
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 4000,
    messages: messages
  };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.content[0].text;
  } catch (error) {
    throw new Error(`Failed to call Claude API: ${error.message}`);
  }
}

async function reanalyzeNemo() {
  console.log('🐠 Re-analyzing Finding Nemo with Claude Haiku...\n');
  
  try {
    // Find Nemo movie
    const { data: movies, error: moviesError } = await supabase
      .from('movies')
      .select('*')
      .ilike('title', '%nemo%')
      .single();
    
    if (moviesError || !movies) {
      throw new Error(`Failed to find Nemo movie: ${moviesError?.message || 'No movie found'}`);
    }
    
    console.log(`📊 Found: ${movies.title} (${movies.release_year})`);
    console.log(`🆔 ID: ${movies.id}`);
    
    // Get subtitles
    const { data: subtitles, error: subtitlesError } = await supabase
      .from('subtitles')
      .select('subtitle_text')
      .eq('movie_id', movies.id)
      .single();
    
    if (subtitlesError || !subtitles) {
      throw new Error(`No subtitles found for ${movies.title}. Please scrape subtitles first.`);
    }
    
    console.log(`📄 Subtitle length: ${subtitles.subtitle_text.length} characters`);
    
    // Call Claude API
    console.log('🤖 Calling Claude Haiku API...');
    const claudeResponse = await callClaudeAPI(subtitles.subtitle_text);
    
    console.log('📝 Claude response received');
    console.log(`📊 Response length: ${claudeResponse.length} characters`);
    
    // Parse response
    let analysis;
    try {
      analysis = JSON.parse(claudeResponse);
    } catch (parseError) {
      console.log('⚠️  JSON parsing failed, trying to extract JSON...');
      const jsonMatch = claudeResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse Claude response as JSON');
      }
    }
    
    console.log('✅ Successfully parsed Claude response');
    console.log('📈 New Age Scores:', analysis.overall_scary_score);
    console.log('🎬 Number of scenes:', analysis.scenes?.length || 0);
    
    // Update movie with new analysis
    console.log('\n💾 Updating movie record...');
    
    // Delete existing scenes
    const { error: deleteError } = await supabase
      .from('scenes')
      .delete()
      .eq('movie_id', movies.id);
    
    if (deleteError) {
      console.log('⚠️  Warning: Could not delete existing scenes:', deleteError.message);
    } else {
      console.log('🗑️  Deleted existing scenes');
    }
    
    // Insert new scenes
    if (analysis.scenes && analysis.scenes.length > 0) {
      const sceneInserts = analysis.scenes.map(scene => ({
        movie_id: movies.id,
        timestamp_start: scene.timestamp_start,
        timestamp_end: scene.timestamp_end,
        description: scene.description,
        tags: scene.tags,
        intensity: scene.intensity,
        age_flags: scene.age_flags
      }));
      
      const { error: insertError } = await supabase
        .from('scenes')
        .insert(sceneInserts);
      
      if (insertError) {
        throw new Error(`Failed to insert scenes: ${insertError.message}`);
      }
      
      console.log(`✅ Inserted ${sceneInserts.length} new scenes`);
    }
    
    // Update movie age scores
    const { error: updateError } = await supabase
      .from('movies')
      .update({ age_scores: analysis.overall_scary_score })
      .eq('id', movies.id);
    
    if (updateError) {
      throw new Error(`Failed to update movie: ${updateError.message}`);
    }
    
    console.log('✅ Updated movie age scores');
    
    // Show final results
    console.log('\n🎉 Re-analysis Complete!');
    console.log('📊 Final Age Scores:');
    console.log(`   24m (2 years): ${analysis.overall_scary_score['24m']}/5`);
    console.log(`   36m (3 years): ${analysis.overall_scary_score['36m']}/5`);
    console.log(`   48m (4 years): ${analysis.overall_scary_score['48m']}/5`);
    console.log(`   60m (5 years): ${analysis.overall_scary_score['60m']}/5`);
    
    // Calculate recommendation
    let recommendation = 'Unknown';
    if (analysis.overall_scary_score['24m'] <= 2) recommendation = 'Perfect for 2+';
    else if (analysis.overall_scary_score['36m'] <= 2) recommendation = 'Great for 3+';
    else if (analysis.overall_scary_score['48m'] <= 2) recommendation = 'Good for 4+';
    else if (analysis.overall_scary_score['60m'] <= 2) recommendation = 'Best for 5+';
    else recommendation = 'Check ratings';
    
    console.log(`🎯 Recommendation: ${recommendation}`);
    
  } catch (error) {
    console.error('❌ Re-analysis failed:', error.message);
    process.exit(1);
  }
}

// Run re-analysis
reanalyzeNemo();
