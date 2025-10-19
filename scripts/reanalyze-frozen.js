#!/usr/bin/env node

/**
 * Re-analyze Frozen with the improved LLM prompt
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

async function reanalyzeFrozen() {
  console.log('🔄 Re-analyzing Frozen with improved prompt...\n');
  
  try {
    // Get Frozen movie
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
    
    const frozen = frozenMovies[0];
    console.log(`📽️  Movie: ${frozen.title}`);
    console.log(`🆔 ID: ${frozen.id}\n`);
    
    // Call the analyze-scenes API
    console.log('🤖 Calling analyze-scenes API...');
    const response = await fetch('http://localhost:3000/api/movies/analyze-scenes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        movieId: frozen.id,
        subtitleText: `00:05:13,00:05:22
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
Anna: Elsa, I love you!`
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
        .eq('movie_id', frozen.id)
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
        
        console.log(`🎯 Result Analysis:`);
        console.log(`- Has varied age flags: ${hasVariedFlags ? '✅' : '❌'}`);
        console.log(`- More realistic than before: ${hasVariedFlags ? '✅' : '❌'}`);
      }
      
    } else {
      console.log('❌ Analysis failed:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Re-analysis failed:', error.message);
  }
}

reanalyzeFrozen();
