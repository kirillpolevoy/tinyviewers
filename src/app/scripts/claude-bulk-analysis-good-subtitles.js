import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

// Load environment variables from root directory
const envPath = process.cwd().endsWith('src/app') ? '../../.env.local' : '.env.local';
dotenv.config({ path: envPath });

// Initialize clients
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const claudeApiKey = process.env.CLAUDE_API_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const anthropic = new Anthropic({ apiKey: claudeApiKey });

// Movies with good subtitle data (all 109 from find-good-subtitles.js output)
const GOOD_SUBTITLE_MOVIE_IDS = [
  'b6c7d8e9-f0a1-4234-b6c7-d8e9f0a12347', // Puss in Boots
  'e1f2a3b4-c5d6-4789-e1f2-a3b4c5d67893', // Shrek Forever After
  'd8e9f0a1-b2c3-4456-d8e9-f0a1b2c34569', // Ratatouille
  'a9b0c1d2-e3f4-4567-a9b0-c1d2e3f45681', // Spirit: Stallion of the Cimarron
  'a3b4c5d6-e7f8-4901-a3b4-c5d6e7f89015', // Sing
  'd6e7f8a9-b0c1-4234-d6e7-f8a9b0c12348', // Smallfoot
  'd4e5f6a7-b8c9-4012-d4e5-f6a7b8c90126', // Rugrats Go Wild
  'c1d2e3f4-a5b6-4789-c1d2-e3f4a5b67893', // SpongeBob Movie: Sponge on the Run
  '38743ffc-6eef-4678-ad52-63c0258e9d64', // Turning Red
  'c7d8e9f0-a1b2-4345-c7d8-e9f0a1b23459', // The Angry Birds Movie 2
  'f6a7b8c9-d0e1-4234-f6a7-b8c9d0e12348', // Scooby-Doo! Camp Scare
  'a9b0c1d2-e3f4-4567-a9b0-c1d2e3f45682', // The Rescuers
  'c1d2e3f4-a5b6-4789-c1d2-e3f4a5b67894', // The Road to El Dorado
  'c5d6e7f8-a9b0-4123-c5d6-e7f8a9b01239', // Turbo
  'f0a1b2c3-d4e5-4678-f0a1-b2c3d4e56793', // The Wild
  'a1b2c3d4-e5f6-4789-a1b2-c3d4e5f67895', // The Wind Rises
  'd4e5f6a7-b8c9-4012-d4e5-f6a7b8c90128', // Tinker Bell
  'b8c9d0e1-f2a3-4456-b8c9-d0e1f2a34572', // Tinker Bell and the Secret of the Wings
  'e1f2a3b4-c5d6-4789-e1f2-a3b4c5d67895', // Toy Story 3
  'f4a5b6c7-d8e9-4012-f4a5-b6c7d8e90126', // Stuart Little 2
  'd6e7f8a9-b0c1-4234-d6e7-f8a9b0c12349', // The Lorax
  'a1b2c3d4-e5f6-4789-a1b2-c3d4e5f67894', // The Boss Baby
  'b8c9d0e1-f2a3-4456-b8c9-d0e1f2a34571', // The Iron Giant
  'd291ffc8-1bd1-48d2-9fda-addd36e7519c', // Coco
  '2e7d2849-12d1-4905-ac26-05528caf4e54', // Encanto
  'edc7c965-5141-4582-ab40-156e4ebd0acb', // Maya the Bee Movie
  'cf0c389c-6d66-4319-ab85-fcf161c8e005', // Onward
  '0b90620e-2811-4ce9-b201-932953a7e707', // Paddington
  '89542279-70ca-4873-861a-3d6a9f878248', // Paw Patrol: The Movie
  'd6706193-7db8-4b31-aec1-40fd72288731', // Raya and the Last Dragon
  '3738b1fd-9afc-496f-940f-0d55165fd22e', // The Good Dinosaur
  'fc856d32-7ddd-49d0-8dc4-72daf5cfd56a', // Wish
  'd36094b3-f4ee-4fbe-b5c7-47b69d5ea995', // Zootopia
  'e5f6a7b8-c9d0-4123-e5f6-a7b8c9d01234', // A Goofy Movie
  'f6a7b8c9-d0e1-4234-f6a7-b8c9d0e12345', // A Shaun the Sheep Movie
  'c9d0e1f2-a3b4-4567-c9d0-e1f2a3b45678', // Alvin and the Chipmunks
  'b4c5d6e7-f8a9-4012-b4c5-d6e7f8a90123', // Bambi
  'b0c1d2e3-f4a5-4678-b0c1-d2e3f4a56789', // Cars 2
  'b6c7d8e9-f0a1-4234-b6c7-d8e9f0a12345', // Despicable Me
  'b2c3d4e5-f6a7-4890-b2c3-d4e5f6a78903', // Lady and the Tramp
  'f2a3b4c5-d6e7-4890-f2a3-b4c5d6e78903', // Minions
  'e5f6a7b8-c9d0-4123-e5f6-a7b8c9d01235', // Frankenweenie
  'c9d0e1f2-a3b4-4567-c9d0-e1f2a3b45679', // Hercules
  'a3b4c5d6-e7f8-4901-a3b4-c5d6e7f89013', // Hotel Transylvania 2
  'a9b0c1d2-e3f4-4567-a9b0-c1d2e3f45679', // Ice Age
  'e3f4a5b6-c7d8-4901-e3f4-a5b6c7d89013', // Ice Age: The Meltdown
  'c7d8e9f0-a1b2-4345-c7d8-e9f0a1b23457', // Joseph: King of Dreams
  'f0a1b2c3-d4e5-4678-f0a1-b2c3d4e56790', // Kung Fu Panda 2
  'e5f6a7b8-c9d0-4123-e5f6-a7b8c9d01236', // Madagascar 3: Europe's Most Wanted
  'c5d6e7f8-a9b0-4123-c5d6-e7f8a9b01236', // Mr. Peabody & Sherman
  'a5b6c7d8-e9f0-4123-a5b6-c7d8e9f01236', // Pocahontas
  '33c61a81-bd4b-4614-a37c-a48ad846a943', // A Shaun the Sheep Movie: Farmageddon
  '3be70b05-6a87-4477-821c-b6931c9c8d87', // Elmo in Grouchland
  'c7d8e9f0-a1b2-4345-c7d8-e9f0a1b23458', // Rango
  'e9f0a1b2-c3d4-4567-e9f0-a1b2c3d45680', // Rio
  'c7d8e9f0-a1b2-4345-c7d8-e9f0a1b23462', // Zookeeper's Wife
  'd3fdcfce-fcf9-48c4-b5ae-534ebd2a5478', // Frozen
  'e6914476-eed9-4f5b-91d8-9e30dfc41cb6', // Moana
  'a1b2c3d4-e5f6-4789-a1b2-c3d4e5f67896', // Zootopia+
  'd6e7f8a9-b0c1-4234-d6e7-f8a9b0c12345', // Beauty and the Beast (1991)
  'e5f6a7b8-c9d0-4123-e5f6-a7b8c9d01237', // Rugrats in Paris: The Movie
  'a7b8c9d0-e1f2-4345-a7b8-c9d0e1f23459', // Scooby-Doo! Pirates Ahoy!
  'b8c9d0e1-f2a3-4456-b8c9-d0e1f2a34570', // Scooby-Doo! and the Goblin King
  'c9d0e1f2-a3b4-4567-c9d0-e1f2a3b45681', // Shrek
  'd0e1f2a3-b4c5-4678-d0e1-f2a3b4c56792', // Shrek 2
  'f2a3b4c5-d6e7-4890-f2a3-b4c5d6e78904', // Shrek the Third
  'c5d6e7f8-a9b0-4123-c5d6-e7f8a9b01237', // Sleeping Beauty
  'e7f8a9b0-c1d2-4345-e7f8-a9b0c1d23459', // Snow White and the Seven Dwarfs
  'f8a9b0c1-d2e3-4456-f8a9-b0c1d2e34570', // Space Jam
  'b0c1d2e3-f4a5-4678-b0c1-d2e3f4a56792', // SpongeBob Movie: Sponge Out of Water
  'd2e3f4a5-b6c7-4890-d2e3-f4a5b6c78904', // SpongeBob SquarePants Movie
  'f970cb51-a0e1-431f-9e95-cbbfdad2f423', // Barney's Great Adventure
  'adac7718-076e-49a0-81d5-d4db76e18eed', // Chicken Little
  'f0a1b2c3-d4e5-4678-f0a1-b2c3d4e56792', // The Book of Life
  'b2c3d4e5-f6a7-4890-b2c3-d4e5f6a78905', // The Croods
  'e5f6a7b8-c9d0-4123-e5f6-a7b8c9d01238', // The Great Mouse Detective
  'f6a7b8c9-d0e1-4234-f6a7-b8c9d0e12349', // The Incredibles
  '09b499c8-cbd6-4c36-a758-9db19f181887', // Frozen II
  'b6c7d8e9-f0a1-4234-b6c7-d8e9f0a12351', // Zookeeper
  'b4c5d6e7-f8a9-4012-b4c5-d6e7f8a90127', // The Little Mermaid
  'bc786e12-ddab-43f5-a630-158223c3feca', // Winnie the Pooh
  'c1d107ec-8f25-4d8b-8f73-04cdc51cc629', // Octonauts and the Ring of Fire
  'c5d6e7f8-a9b0-4123-c5d6-e7f8a9b01234', // Barbie as Rapunzel
  '35fe61cd-1633-4bcd-961a-ea3c5c1d88ec', // Lyle, Lyle, Crocodile
  '922d262c-594a-44b2-8522-205583753652', // Wreck-It Ralph
  'b2c3d4e5-f6a7-4890-b2c3-d4e5f6a78901', // A Bug's Life
  'f6a7b8c9-d0e1-4234-f6a7-b8c9d0e12346', // Gnomeo & Juliet
  'b4c5d6e7-f8a9-4012-b4c5-d6e7f8a90124', // Hotel Transylvania 3: Summer Vacation
  'f8a9b0c1-d2e3-4456-f8a9-b0c1d2e34568', // How to Train Your Dragon: The Hidden World
  'b0c1d2e3-f4a5-4678-b0c1-d2e3f4a56790', // Ice Age: Collision Course
  'c1d2e3f4-a5b6-4789-c1d2-e3f4a5b67891', // Ice Age: Continental Drift
  'd2e3f4a5-b6c7-4890-d2e3-f4a5b6c78902', // Ice Age: Dawn of the Dinosaurs
  'b6c7d8e9-f0a1-4234-b6c7-d8e9f0a12346', // Jimmy Neutron: Boy Genius
  'd8e9f0a1-b2c3-4456-d8e9-f0a1b2c34568', // Kiki's Delivery Service
  'd0e1f2a3-b4c5-4678-d0e1-f2a3b4c56791', // Mickey's Once Upon a Christmas
  'e1f2a3b4-c5d6-4789-e1f2-a3b4c5d67892', // Mickey's Twice Upon a Christmas
  'b4c5d6e7-f8a9-4012-b4c5-d6e7f8a90125', // Monsters, Inc.
  'e7f8a9b0-c1d2-4345-e7f8-a9b0c1d23458', // My Little Pony: The Movie
  'f4a5b6c7-d8e9-4012-f4a5-b6c7d8e90125', // Planes: Fire & Rescue
  'f8a9b0c1-d2e3-4456-f8a9-b0c1d2e34572', // Wallace & Gromit: The Curse of the Were-Rabbit
  'c1d2e3f4-a5b6-4789-c1d2-e3f4a5b67895', // Zathura: A Space Adventure
  'a5b6c7d8-e9f0-4123-a5b6-c7d8e9f01240', // Zombillenium
  'e9f0a1b2-c3d4-4567-e9f0-a1b2c3d45684', // Zoom: Academy for Superheroes
  'd0e1f2a3-b4c5-4678-d0e1-f2a3b4c56790', // Home
  'c5d6e7f8-a9b0-4123-c5d6-e7f8a9b01235', // How the Grinch Stole Christmas
  'eb1c72c7-fa72-4e59-886c-d8726ab0088c', // Clifford's Really Big Movie
  'c3d4e5f6-a7b8-4901-c3d4-e5f6a7b89015', // Rudolph the Red-Nosed Reindeer
  'f6a7b8c9-d0e1-4234-f6a7-b8c9d0e12347', // Madagascar: Escape 2 Africa
  'd2e3f4a5-b6c7-4890-d2e3-f4a5b6c78903'  // Piglet's Big Movie
];

// Rate limiting and cost control
const DELAY_BETWEEN_REQUESTS = 90000; // 90 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidSubtitleContent(content) {
  if (!content || content.length < 100) return false;
  
  // Check for HTML content (corrupted)
  const htmlPatterns = [
    /<html/i, /<!DOCTYPE/i, /<body/i, /<script/i,
    /function\s*\(/, /var\s+\w+\s*=/, /document\./, /window\./
  ];
  
  for (const pattern of htmlPatterns) {
    if (pattern.test(content)) return false;
  }
  
  // Check for subtitle markers
  const hasTimestamps = /\d{2}:\d{2}:\d{2}[,\.]\d{3}/.test(content) || content.includes('-->');
  const hasWebVTT = content.includes('WEBVTT');
  
  return hasTimestamps || hasWebVTT;
}

async function analyzeMovieWithClaude(movie, subtitleText) {
  const prompt = `You are an expert child psychologist specializing in media for ages 2-5. Analyze this movie for parents.

CRITICAL INSTRUCTIONS:
- Write DETAILED scene descriptions (minimum 150 words each)
- Be VERY specific about what happens, who is involved, and why it might concern children
- Include dialogue, character emotions, visual elements, sounds, and duration

Analyze the provided subtitle text and return two structured outputs:

### 1. Overall Scary Score

Provide age-specific intensity ratings (1-5 scale) based on the movie's overall emotional content:

{
  "2": 4,  // 2-year-olds (most sensitive)
  "3": 3,  // 3-year-olds  
  "4": 2,  // 4-year-olds
  "5": 1   // 5-year-olds (least sensitive)
}

**Intensity Scale:**
- 1 = Gentle, peaceful content appropriate for all ages
- 2 = Minor tension or mild emotional moments 
- 3 = Moderate intensity with some scary or sad elements
- 4 = High intensity with frequent scary/intense scenes
- 5 = Very intense, overwhelming content with significant scary elements

### 2. Detailed Scene-by-Scene Analysis

For each concerning scene, provide comprehensive analysis in this format:

{
  "timestamp_start": "00:23:45",
  "timestamp_end": "00:25:30",
  "description": "MINIMUM 150 WORDS: Start with what happens, include specific dialogue quotes from subtitles, describe character emotions and reactions, explain the setting and visual atmosphere, detail sounds and music, identify specific concerns for ages 2-5, explain duration and intensity, and conclude with why parents should know about this scene. Write like you are telling a parent everything they need to know.",
  "tags": ["chase", "darkness", "loud-sound", "threatening-music", "monster", "separation"],
  "intensity": 4,
  "age_flags": {
    "2": "🚫",
    "3": "⚠️",
    "4": "✅", 
    "5": "✅"
  }
}

Return ONLY a valid JSON object in this exact format:

{
  "overall_scary_score": {
    "2": 4,
    "3": 3,
    "4": 2, 
    "5": 1
  },
  "scenes": [
    {
      "timestamp_start": "00:23:45",
      "timestamp_end": "00:25:30",
      "description": "Comprehensive detailed description here...",
      "tags": ["relevant", "tags", "here"],
      "intensity": 4,
      "age_flags": {
        "2": "🚫",
        "3": "⚠️",
        "4": "✅",
        "5": "✅"
      }
    }
  ]
}

Movie: "${movie.title}" (${movie.release_year})

Subtitles:
${subtitleText.substring(0, 15000)}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4000,
      temperature: 0.3,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const content = response.content[0].text;
    
    // Try to parse JSON response
    try {
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || 
                       content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const parsed = JSON.parse(jsonStr);
        
        // Validate the expected structure
        if (!parsed.overall_scary_score || !parsed.scenes) {
          throw new Error('Invalid response format: missing overall_scary_score or scenes');
        }
        
        // Convert age keys to new structure (24m/36m/48m/60m)
        const normalizedOverallScore = {};
        for (const [age, score] of Object.entries(parsed.overall_scary_score)) {
          if (age === '2') normalizedOverallScore['24m'] = score;
          else if (age === '3') normalizedOverallScore['36m'] = score;
          else if (age === '4') normalizedOverallScore['48m'] = score;
          else if (age === '5') normalizedOverallScore['60m'] = score;
        }
        
        // Normalize age flags in scenes to new structure
        const normalizedScenes = parsed.scenes.map(scene => ({
          ...scene,
          age_flags: scene.age_flags ? {
            '24m': scene.age_flags['2'] || '⚠️',
            '36m': scene.age_flags['3'] || '⚠️',
            '48m': scene.age_flags['4'] || '⚠️',
            '60m': scene.age_flags['5'] || '⚠️'
          } : {
            '24m': '⚠️',
            '36m': '⚠️', 
            '48m': '⚠️',
            '60m': '⚠️'
          }
        }));
        
        return {
          overall_scary_score: normalizedOverallScore,
          scenes: normalizedScenes
        };
      }
      
      throw new Error('No valid JSON found in Claude response');
    } catch (parseError) {
      console.log(`⚠️  JSON parse error for "${movie.title}": ${parseError.message}`);
      throw parseError;
    }
    
  } catch (error) {
    if (error.status === 429) {
      console.log(`⏳ Rate limited for "${movie.title}", waiting longer...`);
      throw error; // Will be retried
    }
    throw error;
  }
}

async function saveScenesToDatabase(movieId, scenes) {
  const scenesToInsert = scenes.map(scene => {
    // Create the scene object with an explicit UUID for the id field
    const sceneData = {
      id: uuidv4(), // Generate a UUID for each scene
      movie_id: movieId,
      timestamp_start: scene.timestamp_start,
      timestamp_end: scene.timestamp_end,
      description: scene.description,
      tags: scene.tags || [],
      intensity: typeof scene.intensity === 'string' ? parseInt(scene.intensity) || 1 : scene.intensity || 1,
      age_flags: scene.age_flags || {
        '24m': '⚠️',
        '36m': '⚠️', 
        '48m': '⚠️',
        '60m': '⚠️'
      }
    };
    
    return sceneData;
  });

  const { data, error } = await supabase
    .from('scenes')
    .insert(scenesToInsert);

  if (error) {
    throw error;
  }

  return scenesToInsert.length;
}

async function processMoviesWithGoodSubtitles() {
  console.log('🎬 Starting Claude Analysis of Movies with Good Subtitles...');
  console.log('🤖 Using Claude-3.5-Sonnet with enhanced detailed analysis');
  console.log('🎯 Target age range: 2-5 years (24m/36m/48m/60m)');
  console.log(`📊 Processing ${GOOD_SUBTITLE_MOVIE_IDS.length} movies with verified good subtitles\n`);
  
  // Check for movies analyzed today
  const today = new Date().toISOString().split('T')[0];
  console.log(`📅 Checking for movies already analyzed today (${today})...`);
  
  const { data: todaysScenes, error: todayError } = await supabase
    .from('scenes')
    .select('movie_id')
    .gte('created_at', today + 'T00:00:00');
  
  const analyzedTodayIds = new Set(todaysScenes?.map(s => s.movie_id) || []);
  console.log(`⏭️  ${analyzedTodayIds.size} movies already analyzed today\n`);

  // Check environment variables
  if (!supabaseUrl || !supabaseServiceKey || !claudeApiKey) {
    console.log('❌ Missing required environment variables:');
    console.log(`- NEXT_PUBLIC_SUPABASE_URL: ${!!supabaseUrl}`);
    console.log(`- SUPABASE_SERVICE_ROLE_KEY: ${!!supabaseServiceKey}`);
    console.log(`- CLAUDE_API_KEY: ${!!claudeApiKey}`);
    return;
  }

  // Get movies that need processing (have good subtitles)
  const { data: movies, error } = await supabase
    .from('movies')
    .select(`
      id, 
      title, 
      release_year,
      subtitles!inner(subtitle_text, source),
      scenes(id)
    `)
    .in('id', GOOD_SUBTITLE_MOVIE_IDS) // Get all movies, we'll handle scene deletion
    .or('is_active.is.null,is_active.eq.true'); // Filter out inactive movies

  if (error) {
    console.log('❌ Database error:', error.message);
    return;
  }

  console.log(`📋 Found ${movies.length} movies ready for Claude analysis (FORCE RE-ANALYSIS - will replace ALL existing scenes)\n`);

  let processed = 0;
  let successful = 0;
  let failed = 0;

  for (const movie of movies) {
    processed++;
    console.log(`\n🎬 Processing ${processed}/${movies.length}: "${movie.title}" (${movie.release_year})`);
    
    // Force re-analysis of all movies (comment out the skip logic)
    // if (analyzedTodayIds.has(movie.id)) {
    //   console.log(`⏭️  Already analyzed today - skipping`);
    //   successful++; // Count as successful since it's already done
    //   continue;
    // }
    
    const subtitle = movie.subtitles[0];
    if (!subtitle || !subtitle.subtitle_text) {
      console.log(`❌ No subtitle data found`);
      failed++;
      continue;
    }

    // Double-check subtitle quality
    if (!isValidSubtitleContent(subtitle.subtitle_text)) {
      console.log(`❌ Invalid subtitle content detected (${subtitle.subtitle_text.length} chars)`);
      failed++;
      continue;
    }

    console.log(`📝 Subtitle: ${subtitle.subtitle_text.length.toLocaleString()} chars from ${subtitle.source}`);

    let retryCount = 0;
    let success = false;

    while (retryCount < MAX_RETRIES && !success) {
      try {
        if (retryCount > 0) {
          console.log(`🔄 Retry ${retryCount}/${MAX_RETRIES} for "${movie.title}"`);
          await delay(RETRY_DELAY * retryCount); // Exponential backoff
        }

        // Delete existing scenes if any (for re-analysis)
        if (movie.scenes && movie.scenes.length > 0) {
          console.log(`🗑️  Deleting ${movie.scenes.length} existing scenes for re-analysis...`);
          const { error: deleteError } = await supabase
            .from('scenes')
            .delete()
            .eq('movie_id', movie.id);
          
          if (deleteError) {
            throw new Error(`Failed to delete existing scenes: ${deleteError.message}`);
          }
        }

        console.log(`🤖 Analyzing with Claude...`);
        const analysis = await analyzeMovieWithClaude(movie, subtitle.subtitle_text);
        
        // Validate the analysis structure
        if (!analysis.scenes || !Array.isArray(analysis.scenes)) {
          throw new Error('Invalid analysis format: missing scenes array');
        }
        
        console.log(`🎭 Found ${analysis.scenes.length} scenes`);
        
        console.log(`💾 Saving scenes to database...`);
        const savedCount = await saveScenesToDatabase(movie.id, analysis.scenes);
        
        // Update movie with overall scary score
        if (analysis.overall_scary_score) {
          const { error: movieError } = await supabase
            .from('movies')
            .update({
              age_scores: analysis.overall_scary_score
            })
            .eq('id', movie.id);
          
          if (movieError) {
            console.log(`⚠️  Could not save age scores to movie: ${movieError.message}`);
          }
        }
        
        console.log(`✅ Successfully processed "${movie.title}"`);
        console.log(`   🎭 Scenes: ${savedCount} scenes saved`);
        if (analysis.overall_scary_score) {
          console.log(`   📊 Age scores: 24m=${analysis.overall_scary_score['24m']} 36m=${analysis.overall_scary_score['36m']} 48m=${analysis.overall_scary_score['48m']} 60m=${analysis.overall_scary_score['60m']}`);
        }
        
        successful++;
        success = true;

      } catch (error) {
        retryCount++;
        console.log(`❌ Error processing "${movie.title}" (attempt ${retryCount}): ${error.message}`);
        
        if (error.status === 429) {
          const waitTime = DELAY_BETWEEN_REQUESTS * retryCount;
          console.log(`⏳ Rate limited, waiting ${waitTime/1000}s before retry...`);
          await delay(waitTime);
        } else if (retryCount >= MAX_RETRIES) {
          console.log(`💥 Failed after ${MAX_RETRIES} attempts`);
          failed++;
        }
      }
    }

    // Rate limiting delay between movies
    if (processed < movies.length && success) {
      console.log(`⏳ Waiting ${DELAY_BETWEEN_REQUESTS/1000}s before next movie...`);
      await delay(DELAY_BETWEEN_REQUESTS);
    }
  }

  console.log('\n🎯 Final Results:');
  console.log(`   ✅ Successfully processed: ${successful}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📊 Total attempted: ${processed}`);
  console.log(`   🎬 Movies with good subtitles: ${GOOD_SUBTITLE_MOVIE_IDS.length}`);
  
  if (successful > 0) {
    console.log('\n🎉 Claude analysis completed successfully!');
    console.log('🔍 Check your database for the new scene descriptions.');
  }
}

processMoviesWithGoodSubtitles().catch(console.error); 