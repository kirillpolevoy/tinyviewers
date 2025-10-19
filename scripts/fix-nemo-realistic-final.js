#!/usr/bin/env node

/**
 * Fix Finding Nemo with more realistic scores for 2-year-olds
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

async function fixNemoRealistic() {
  console.log('🐠 Fixing Finding Nemo with more realistic scores...\n');
  
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
    
    console.log(`📊 Current Nemo Scores:`, movie.age_scores);
    
    // More realistic scores considering 2-year-old development
    const realisticScores = {
      '24m': 3,  // Too intense for 2-year-olds - death, separation, scary creatures
      '36m': 2,  // Manageable for 3-year-olds with guidance
      '48m': 1,  // Appropriate for 4-year-olds
      '60m': 1   // Perfectly fine for 5-year-olds
    };
    
    console.log('\n🔧 Applying more realistic scores...');
    console.log(`📈 New Scores:`, realisticScores);
    console.log('📝 Rationale:');
    console.log('   - 2-year-olds: Too intense (death, separation anxiety, scary creatures)');
    console.log('   - 3-year-olds: Manageable with guidance (can understand it\'s pretend)');
    console.log('   - 4-year-olds: Appropriate (can handle themes)');
    console.log('   - 5-year-olds: Perfectly fine');
    
    // Update the movie
    const { error: updateError } = await supabase
      .from('movies')
      .update({ age_scores: realisticScores })
      .eq('id', movie.id);
    
    if (updateError) {
      throw new Error(`Failed to update Nemo: ${updateError.message}`);
    }
    
    console.log('✅ Successfully updated Finding Nemo');
    
    // Calculate new recommendation
    let recommendation = 'Unknown';
    if (realisticScores['24m'] <= 2) recommendation = 'Perfect for 2+';
    else if (realisticScores['36m'] <= 2) recommendation = 'Great for 3+';
    else if (realisticScores['48m'] <= 2) recommendation = 'Good for 4+';
    else if (realisticScores['60m'] <= 2) recommendation = 'Best for 5+';
    else recommendation = 'Check ratings';
    
    console.log(`🎯 New Recommendation: ${recommendation}`);
    
    // Verify the change
    console.log('\n📊 Verification:');
    const { data: updatedMovie, error: verifyError } = await supabase
      .from('movies')
      .select('title, age_scores')
      .eq('id', movie.id)
      .single();
    
    if (verifyError) {
      console.log('⚠️  Could not verify update');
    } else {
      console.log(`✅ Updated: ${updatedMovie.title}`);
      console.log(`📈 Final Scores:`, updatedMovie.age_scores);
    }
    
    console.log('\n🎉 Finding Nemo Fixed with Realistic Scores!');
    console.log('💡 This better reflects child development needs:');
    console.log('   - 2-year-olds need very gentle content');
    console.log('   - 3-year-olds can handle more with guidance');
    console.log('   - 4+ year-olds can understand themes and context');
    
  } catch (error) {
    console.error('❌ Fix failed:', error.message);
    process.exit(1);
  }
}

// Run the fix
fixNemoRealistic();
