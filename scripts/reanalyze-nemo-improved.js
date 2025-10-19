#!/usr/bin/env node

/**
 * Re-analyze Finding Nemo with improved prompt for realistic age scores
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

// Improved prompt that considers overall movie experience, not just individual scenes
const improvedPrompt = `
You are analyzing Finding Nemo (2003), a G-rated Disney/Pixar animated film. This is a family-friendly movie designed for children and parents to enjoy together.

IMPORTANT CONTEXT:
- This is a G-rated Disney/Pixar film (the most family-friendly rating)
- It's widely considered appropriate for children 3+ by parents and critics
- The movie has brief intense moments but overall tone is light, comedic, and heartwarming
- Scary parts are resolved quickly and are not the focus of the movie
- The film teaches positive lessons about family, friendship, and overcoming fears

Your task is to provide realistic age scores that reflect how parents actually experience this movie with their children, not just individual scene analysis.

Consider:
1. Overall movie tone and message
2. Brief vs. sustained intensity
3. How scary moments are resolved
4. Positive themes and lessons
5. Real-world parent recommendations

Return ONLY a JSON object in this exact format:
{
  "overall_scary_score": {
    "24m": 2,
    "36m": 1,
    "48m": 1,
    "60m": 1
  },
  "scenes": [
    {
      "timestamp_start": "00:02:54",
      "timestamp_end": "00:03:26",
      "description": "Brief opening scene with predator attack - sets up story but not sustained",
      "tags": ["brief", "setup", "resolved"],
      "intensity": 3,
      "age_flags": {
        "24m": "⚠️",
        "36m": "✅",
        "48m": "✅",
        "60m": "✅"
      }
    }
  ]
}

Analyze the following subtitle text with this context in mind:
`;

async function callClaudeAPI(subtitleText) {
  const messages = [
    {
      role: 'user',
      content: `${improvedPrompt}\n\nSUBTITLE TEXT:\n${subtitleText}`
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

async function reanalyzeNemoWithContext() {
  console.log('🐠 Re-analyzing Finding Nemo with improved context...\n');
  
  try {
    // Find Nemo movie
    const { data: movie, error: movieError } = await supabase
      .from('movies')
      .select('*')
      .ilike('title', '%nemo%')
      .single();
    
    if (movieError || !movie) {
      throw new Error(`Failed to find Nemo movie: ${movieError?.message || 'No movie found'}`);
    }
    
    console.log(`📊 Current: ${movie.title} (${movie.release_year})`);
    console.log(`📈 Current Scores:`, movie.age_scores);
    
    // Get subtitles
    const { data: subtitles, error: subtitlesError } = await supabase
      .from('subtitles')
      .select('subtitle_text')
      .eq('movie_id', movie.id)
      .single();
    
    if (subtitlesError || !subtitles) {
      throw new Error(`No subtitles found for ${movie.title}`);
    }
    
    console.log(`📄 Subtitle length: ${subtitles.subtitle_text.length} characters`);
    
    // Call Claude API with improved prompt
    console.log('🤖 Calling Claude Haiku with improved context...');
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
      .eq('movie_id', movie.id);
    
    if (deleteError) {
      console.log('⚠️  Warning: Could not delete existing scenes:', deleteError.message);
    } else {
      console.log('🗑️  Deleted existing scenes');
    }
    
    // Insert new scenes
    if (analysis.scenes && analysis.scenes.length > 0) {
      const sceneInserts = analysis.scenes.map(scene => ({
        movie_id: movie.id,
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
      .eq('id', movie.id);
    
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
    
    console.log('\n💡 This analysis considers:');
    console.log('   - Overall movie tone (light, comedic, heartwarming)');
    console.log('   - Brief vs. sustained intensity');
    console.log('   - Real-world parent recommendations');
    console.log('   - G-rated Disney/Pixar context');
    
  } catch (error) {
    console.error('❌ Re-analysis failed:', error.message);
    process.exit(1);
  }
}

// Run re-analysis
reanalyzeNemoWithContext();
