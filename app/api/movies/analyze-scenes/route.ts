import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';


// Claude API configuration
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-3-5-haiku-20241022';
const MAX_TOKENS = 4000;

const claudePrompt = `
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

async function callClaudeAPI(subtitleText: string, retryCount = 0): Promise<string> {
  const maxRetries = 3;
  const messages = [
    {
      role: 'user',
      content: `${claudePrompt}\n\nSUBTITLE TEXT:\n${subtitleText}`
    }
  ];

  const requestBody = {
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    messages: messages
  };

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY!,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    if (response.status === 429 && retryCount < maxRetries) {
      const waitTime = (retryCount + 1) * 30000; // 30, 60, 90 seconds
      console.log(`Rate limited. Waiting ${waitTime/1000} seconds before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return callClaudeAPI(subtitleText, retryCount + 1);
    }
    
    throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

async function parseClaudeResponse(claudeResponse: string) {
  try {
    // Try to extract JSON from Claude's response
    const jsonMatch = claudeResponse.match(/```json\n([\s\S]*?)\n```/) || 
                     claudeResponse.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);
      
      // Validate the expected structure
      if (!parsed.overall_scary_score || !parsed.scenes) {
        throw new Error('Invalid response format: missing overall_scary_score or scenes');
      }
      
      // Normalize age flags in scenes
      const normalizedScenes = parsed.scenes.map((scene: any) => ({
        ...scene,
        age_flags: scene.age_flags || {
          '24m': '⚠️',
          '36m': '⚠️', 
          '48m': '⚠️',
          '60m': '⚠️'
        }
      }));
      
      return {
        overall_scary_score: parsed.overall_scary_score,
        scenes: normalizedScenes
      };
    }
    
    throw new Error('No valid JSON found in Claude response');
  } catch (error) {
    console.error('Failed to parse Claude response:', error);
    console.error('Response was:', claudeResponse);
    throw error;
  }
}

async function saveScenesToDatabase(supabase: any, movieId: string, scenes: any[]) {
  const scenesToInsert = scenes.map(scene => ({
    movie_id: movieId,
    timestamp_start: scene.timestamp_start,
    timestamp_end: scene.timestamp_end,
    description: scene.description,
    tags: scene.tags || [],
    intensity: scene.intensity,
    age_flags: scene.age_flags || {
      '24m': '⚠️',
      '36m': '⚠️', 
      '48m': '⚠️',
      '60m': '⚠️'
    }
  }));

  const { error } = await supabase
    .from('scenes')
    .insert(scenesToInsert);

  if (error) {
    throw error;
  }

  return true;
}

async function updateMovieWithAnalysis(supabase: any, movieId: string, overallScaryScore: any) {
  const updates = {
    age_scores: overallScaryScore
  };
  
  const { error } = await supabase
    .from('movies')
    .update(updates)
    .eq('id', movieId);

  if (error) {
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Initialize Supabase client inside the handler
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { movieId } = await request.json();

    if (!movieId) {
      return NextResponse.json({ error: 'Movie ID is required' }, { status: 400 });
    }

    if (!process.env.CLAUDE_API_KEY) {
      return NextResponse.json({ error: 'Claude API key not configured' }, { status: 500 });
    }

    // Get movie with subtitles
    const { data: movie, error: movieError } = await supabase
      .from('movies')
      .select(`
        id, 
        title,
        subtitles(subtitle_text),
        scenes(id)
      `)
      .eq('id', movieId)
      .single();

    if (movieError || !movie) {
      return NextResponse.json({ error: 'Movie not found' }, { status: 404 });
    }

    if (!movie.subtitles || movie.subtitles.length === 0) {
      return NextResponse.json({ error: 'No subtitles found for this movie' }, { status: 400 });
    }

    const subtitleText = movie.subtitles[0].subtitle_text;

    if (!subtitleText || subtitleText.length < 100) {
      return NextResponse.json({ error: 'Subtitle text too short or empty' }, { status: 400 });
    }

    console.log(`🎬 Analyzing: "${movie.title}"`);
    console.log(`📄 Subtitle length: ${subtitleText.length} characters`);

    // Delete existing scenes if any (for re-analysis)
    if (movie.scenes && movie.scenes.length > 0) {
      console.log(`🗑️  Deleting ${movie.scenes.length} existing scenes for re-analysis...`);
      const { error: deleteError } = await supabase
        .from('scenes')
        .delete()
        .eq('movie_id', movieId);
      
      if (deleteError) {
        throw new Error(`Failed to delete existing scenes: ${deleteError.message}`);
      }
    }

    // Call Claude API
    console.log('🤖 Calling Claude API...');
    const claudeResponse = await callClaudeAPI(subtitleText);
    
    console.log(`📝 Received Claude response (${claudeResponse.length} characters)`);
    
    // Parse the response
    const analysis = await parseClaudeResponse(claudeResponse);
    
    // Validate the analysis structure
    if (!analysis.scenes || !Array.isArray(analysis.scenes)) {
      throw new Error('Invalid analysis format: missing scenes array');
    }
    
    console.log(`🎭 Found ${analysis.scenes.length} scenes`);
    
    // Save scenes to database
    await saveScenesToDatabase(supabase, movieId, analysis.scenes);
    console.log('💾 Saved scenes to database');
    
    // Update movie with overall scary score
    if (analysis.overall_scary_score) {
      await updateMovieWithAnalysis(supabase, movieId, analysis.overall_scary_score);
      console.log('📊 Updated movie with overall scary scores');
    }
    
    return NextResponse.json({
      success: true,
      scenesCount: analysis.scenes.length,
      overallScores: analysis.overall_scary_score
    });
    
  } catch (error) {
    console.error('Error analyzing movie:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Scene analysis failed' 
    }, { status: 500 });
  }
} 