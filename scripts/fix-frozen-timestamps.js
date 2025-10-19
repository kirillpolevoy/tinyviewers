#!/usr/bin/env node

/**
 * Fix Frozen scene timestamps
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

function cleanTimestamp(timestamp) {
  if (!timestamp) return timestamp;
  // Extract HH:MM:SS format from various subtitle formats
  const match = timestamp.match(/(\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : timestamp;
}

async function fixFrozenTimestamps() {
  console.log('🔧 Fixing Frozen scene timestamps...\n');
  
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
    
    // Get current scenes
    const { data: scenes, error: scenesError } = await supabase
      .from('scenes')
      .select('*')
      .eq('movie_id', frozen.id)
      .order('timestamp_start');
    
    if (scenesError) {
      throw new Error(`Failed to get scenes: ${scenesError.message}`);
    }
    
    console.log(`🎬 Found ${scenes.length} scenes to fix:\n`);
    
    scenes.forEach((scene, index) => {
      console.log(`Scene ${index + 1}:`);
      console.log(`  Before: ${scene.timestamp_start} - ${scene.timestamp_end}`);
      
      const cleanStart = cleanTimestamp(scene.timestamp_start);
      const cleanEnd = cleanTimestamp(scene.timestamp_end);
      
      console.log(`  After:  ${cleanStart} - ${cleanEnd}`);
      console.log(`  Description: ${scene.description}`);
      console.log('');
    });
    
    // Update scenes with cleaned timestamps
    console.log('🔄 Updating scenes...');
    
    for (const scene of scenes) {
      const cleanStart = cleanTimestamp(scene.timestamp_start);
      const cleanEnd = cleanTimestamp(scene.timestamp_end);
      
      const { error: updateError } = await supabase
        .from('scenes')
        .update({
          timestamp_start: cleanStart,
          timestamp_end: cleanEnd
        })
        .eq('id', scene.id);
      
      if (updateError) {
        console.log(`⚠️  Failed to update scene ${scene.id}: ${updateError.message}`);
      } else {
        console.log(`✅ Updated scene: ${cleanStart} - ${cleanEnd}`);
      }
    }
    
    console.log('\n🎉 Frozen timestamp fix complete!');
    
  } catch (error) {
    console.error('❌ Fix failed:', error.message);
  }
}

fixFrozenTimestamps();
