# Rerun Analysis Feature

## Overview
The "Rerun Analysis" button allows you to manually trigger a fresh analysis of any movie using the improved LLM prompt and timestamp cleaning logic.

## How to Use

### 1. Via the UI (Recommended)
1. Navigate to any movie page (e.g., `/movies/[id]`)
2. Look for the "🔄 Rerun Analysis" button next to the "Add to My List" button
3. Click the button to start the analysis
4. The button will show a loading spinner while analyzing
5. Once complete, the page will automatically refresh with updated data

### 2. Via Scripts (For Testing)
```bash
# Test the rerun analysis functionality
node scripts/test-rerun-analysis.js "Frozen"

# Rerun analysis for a single movie (local)
node scripts/rerun-analysis.js "Toy Story"

# Rerun analysis for a single movie (production)
node scripts/api-rerun-analysis.js "Encanto"
```

## What Happens During Rerun Analysis

✅ **Uses Improved LLM Prompt**
- More realistic age flags (not overly conservative)
- Better differentiation between age groups
- More nuanced scene analysis

✅ **Cleans Timestamps**
- Removes milliseconds from timestamps
- Converts to clean HH:MM:SS format
- Fixes malformed timestamp strings

✅ **Updates Database**
- Refreshes overall age scores
- Updates all scene analysis data
- Preserves movie metadata

✅ **Cost Optimized**
- Uses Claude Haiku (98% cost reduction vs Sonnet)
- Efficient API calls
- Rate limiting protection

## Button States

- **Default**: 🔄 Rerun Analysis
- **Loading**: Spinner + "Analyzing..."
- **Success**: ✅ Analysis Complete!
- **Error**: ❌ Retry Analysis

## Technical Details

- **API Endpoint**: `/api/movies/analyze-scenes`
- **Method**: POST
- **Payload**: `{ movieId: string, subtitleText: string }`
- **Response**: `{ success: boolean, overallScores: object, scenesCount: number }`

## Error Handling

The button includes comprehensive error handling:
- Network errors
- API failures
- Invalid movie IDs
- Rate limiting
- Database connection issues

## Performance

- Analysis typically takes 30-60 seconds
- Uses efficient Claude Haiku model
- Includes rate limiting to prevent API abuse
- Automatic page refresh after completion
