-- Migration script to update from 1-3 years (12m/24m/36m) to 2-5 years (24m/36m/48m/60m)
-- This will need to be run against your database

-- 1. First, add the new age columns to movies table
ALTER TABLE movies 
ADD COLUMN IF NOT EXISTS age_scores_48m INTEGER DEFAULT 3,
ADD COLUMN IF NOT EXISTS age_scores_60m INTEGER DEFAULT 3;

-- 2. Update the existing age_scores JSON to include new ages
-- This is a complex operation - you may want to handle this in your application code instead
UPDATE movies 
SET age_scores = jsonb_set(
    jsonb_set(age_scores, '{48m}', '3'),
    '{60m}', '3'
)
WHERE age_scores IS NOT NULL;

-- 3. For scenes table, add new age flag columns
-- Note: This assumes you're storing age_flags as separate columns
-- If stored as JSON, you'll need to update the JSON structure similarly

-- 4. Sample data update for testing
-- You'll want to populate the 48m and 60m scores with appropriate values
-- based on your content analysis

-- Example: Set reasonable defaults based on existing scores
UPDATE movies 
SET age_scores = jsonb_set(
    jsonb_set(age_scores, '{48m}', 
        CASE 
            WHEN (age_scores->>'36m')::int <= 2 THEN '2'
            WHEN (age_scores->>'36m')::int = 3 THEN '2'
            ELSE '3'
        END::text::jsonb
    ),
    '{60m}', 
        CASE 
            WHEN (age_scores->>'36m')::int <= 2 THEN '1'
            WHEN (age_scores->>'36m')::int = 3 THEN '2'
            ELSE '2'
        END::text::jsonb
)
WHERE age_scores IS NOT NULL;

-- Note: You mentioned you'll be addressing the dataset shortly
-- This migration is provided as a reference for the database structure changes needed 