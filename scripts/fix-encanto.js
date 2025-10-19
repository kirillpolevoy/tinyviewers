#!/usr/bin/env node

/**
 * Fix Encanto with improved prompt and timestamp cleaning
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

async function fixEncanto() {
  console.log('🔄 Fixing Encanto with improved prompt...\n');
  
  try {
    // Get Encanto movie
    const { data: encantoMovies, error: encantoError } = await supabase
      .from('movies')
      .select('*')
      .ilike('title', '%encanto%');
    
    if (encantoError) {
      throw new Error(`Failed to get Encanto: ${encantoError.message}`);
    }
    
    if (!encantoMovies || encantoMovies.length === 0) {
      throw new Error('No Encanto movies found');
    }
    
    const encanto = encantoMovies[0];
    console.log(`📽️  Movie: ${encanto.title}`);
    console.log(`🆔 ID: ${encanto.id}`);
    console.log(`📊 Current Overall Scores: ${JSON.stringify(encanto.age_scores)}\n`);
    
    // Call the analyze-scenes API with improved prompt
    console.log('🤖 Calling analyze-scenes API with improved prompt...');
    const response = await fetch('http://localhost:3000/api/movies/analyze-scenes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        movieId: encanto.id,
        subtitleText: `00:01:15,617 --> 00:01:38,932
Narrator: In the mountains of Colombia, there lived a family...

00:39:00,000 --> 00:40:30,000
Antonio: I can talk to animals!

00:45:20,000 --> 00:46:15,000
Mirabel: The magic is dying!

00:52:30,000 --> 00:53:45,000
Bruno: I see the future...

01:15:20,000 --> 01:16:30,000
Mirabel: We need to save the miracle!`
      })
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Analysis completed successfully!');
      console.log(`📊 New Overall Scores: ${JSON.stringify(result.overallScores)}`);
      console.log(`🎬 New Scenes: ${result.scenesCount} scenes\n`);
      
      // Get the updated scenes from the database
      const { data: updatedScenes, error: scenesError } = await supabase
        .from('scenes')
        .select('*')
        .eq('movie_id', encanto.id)
        .order('timestamp_start');
      
      if (scenesError) {
        console.log('⚠️  Could not fetch updated scenes:', scenesError.message);
      } else {
        console.log('🎬 Updated Scenes:');
        updatedScenes.forEach((scene, index) => {
          console.log(`Scene ${index + 1}:`);
          console.log(`  Time: ${scene.timestamp_start} - ${scene.timestamp_end}`);
          console.log(`  Intensity: ${scene.intensity}/5`);
          console.log(`  Age Flags: ${JSON.stringify(scene.age_flags)}`);
          console.log(`  Description: ${scene.description}`);
          console.log('');
        });
        
        // Check if we have varied age flags
        const hasVariedFlags = updatedScenes.some(scene => {
          const flags = Object.values(scene.age_flags);
          return new Set(flags).size > 1;
        });
        
        // Check if timestamps are clean
        const hasCleanTimestamps = updatedScenes.every(scene => {
          return /^\d{2}:\d{2}:\d{2}$/.test(scene.timestamp_start) && 
                 /^\d{2}:\d{2}:\d{2}$/.test(scene.timestamp_end);
        });
        
        console.log(`🎯 Result Analysis:`);
        console.log(`- Has varied age flags: ${hasVariedFlags ? '✅' : '❌'}`);
        console.log(`- Has clean timestamps: ${hasCleanTimestamps ? '✅' : '❌'}`);
        console.log(`- More realistic than before: ${hasVariedFlags && hasCleanTimestamps ? '✅' : '❌'}`);
      }
      
    } else {
      console.log('❌ Analysis failed:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Fix failed:', error.message);
  }
}

fixEncanto();
