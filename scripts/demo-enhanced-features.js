#!/usr/bin/env node

/**
 * Demo script to showcase the enhanced rerun analysis features
 * Usage: node scripts/demo-enhanced-features.js
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

async function demoEnhancedFeatures() {
  console.log('🎨 Enhanced Rerun Analysis Feature Demo\n');
  
  try {
    // Get a sample movie
    const { data: movies, error: moviesError } = await supabase
      .from('movies')
      .select('*')
      .limit(1);
    
    if (moviesError) {
      throw new Error(`Failed to fetch movies: ${moviesError.message}`);
    }
    
    if (!movies || movies.length === 0) {
      throw new Error('No movies found');
    }
    
    const movie = movies[0];
    console.log(`📽️  Demo Movie: ${movie.title}`);
    console.log(`🆔 ID: ${movie.id}`);
    console.log(`📊 Current Scores: ${JSON.stringify(movie.age_scores)}\n`);
    
    // Demo 1: Smart Suggestions Analysis
    console.log('💡 Smart Suggestions Analysis:');
    console.log('================================');
    
    const suggestions = analyzeMovieForSuggestions(movie);
    suggestions.forEach((suggestion, index) => {
      console.log(`${index + 1}. ${suggestion.icon} ${suggestion.title}`);
      console.log(`   Priority: ${suggestion.priority.toUpperCase()}`);
      console.log(`   Reason: ${suggestion.reason}`);
      console.log(`   Description: ${suggestion.description}\n`);
    });
    
    // Demo 2: Analysis History Simulation
    console.log('📊 Analysis History Simulation:');
    console.log('================================');
    
    const history = generateMockHistory(movie);
    history.forEach((record, index) => {
      console.log(`${index + 1}. ${record.date} - ${record.scenes_count} scenes`);
      console.log(`   Scores: ${JSON.stringify(record.age_scores)}`);
      if (index > 0) {
        const changes = calculateScoreChanges(record.age_scores, history[index - 1].age_scores);
        console.log(`   Changes: ${changes}\n`);
      } else {
        console.log(`   Status: Current Analysis\n`);
      }
    });
    
    // Demo 3: Keyboard Shortcuts
    console.log('⌨️  Keyboard Shortcuts:');
    console.log('======================');
    console.log('Ctrl + R  - Rerun Analysis');
    console.log('Ctrl + H  - Toggle History');
    console.log('Ctrl + S  - Toggle Suggestions');
    console.log('Ctrl + ?  - Show Help\n');
    
    // Demo 4: Progress Simulation
    console.log('🔄 Progress Simulation:');
    console.log('=======================');
    
    const progressSteps = [
      { step: 'Initializing analysis...', progress: 20 },
      { step: 'Connecting to AI...', progress: 40 },
      { step: 'Analyzing scenes...', progress: 60 },
      { step: 'Processing age ratings...', progress: 80 },
      { step: 'Cleaning timestamps...', progress: 100 }
    ];
    
    for (const step of progressSteps) {
      console.log(`${step.progress}% - ${step.step}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('\n✅ Demo completed successfully!');
    console.log('\n🎯 Key Features Demonstrated:');
    console.log('- Smart suggestions based on data analysis');
    console.log('- Analysis history with score comparisons');
    console.log('- Keyboard shortcuts for power users');
    console.log('- Progress tracking with step-by-step updates');
    console.log('- Enhanced visual feedback and animations');
    
  } catch (error) {
    console.error('❌ Demo failed:', error.message);
  }
}

function analyzeMovieForSuggestions(movie) {
  const suggestions = [];
  
  // Check for high scores that might need review
  if (movie.age_scores['24m'] >= 4) {
    suggestions.push({
      icon: '👶',
      title: 'Review 2-Year-Old Rating',
      description: 'This movie has a high intensity score for 2-year-olds',
      reason: 'Score of 4+ for 24m age group',
      priority: 'high'
    });
  }
  
  // Check for inconsistent age progression
  if (movie.age_scores['24m'] < movie.age_scores['36m']) {
    suggestions.push({
      icon: '📈',
      title: 'Fix Age Progression',
      description: 'Scores should decrease with age, not increase',
      reason: 'Inconsistent age progression detected',
      priority: 'high'
    });
  }
  
  // Check for very low scores across all ages
  const avgScore = Object.values(movie.age_scores).reduce((a, b) => a + b, 0) / Object.values(movie.age_scores).length;
  if (avgScore <= 1.5) {
    suggestions.push({
      icon: '🔍',
      title: 'Verify Low Scores',
      description: 'All age groups have very low scores - double-check analysis',
      reason: 'Average score below 1.5',
      priority: 'medium'
    });
  }
  
  // Check for identical scores
  const uniqueScores = new Set(Object.values(movie.age_scores));
  if (uniqueScores.size === 1) {
    suggestions.push({
      icon: '⚖️',
      title: 'Differentiate Age Ratings',
      description: 'All age groups have the same score - add age differentiation',
      reason: 'All age scores are identical',
      priority: 'medium'
    });
  }
  
  return suggestions;
}

function generateMockHistory(movie) {
  const now = new Date();
  return [
    {
      date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      age_scores: movie.age_scores,
      scenes_count: 12
    },
    {
      date: new Date(now.getTime() - 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      age_scores: { '24m': 4, '36m': 3, '48m': 2, '60m': 1 },
      scenes_count: 10
    },
    {
      date: new Date(now.getTime() - 172800000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      age_scores: { '24m': 5, '36m': 4, '48m': 3, '60m': 2 },
      scenes_count: 8
    }
  ];
}

function calculateScoreChanges(current, previous) {
  const changes = [];
  for (const age in current) {
    const diff = current[age] - previous[age];
    if (diff > 0) changes.push(`${age}: +${diff}`);
    else if (diff < 0) changes.push(`${age}: ${diff}`);
    else changes.push(`${age}: 0`);
  }
  return changes.join(', ');
}

demoEnhancedFeatures();
