-- Migration script to update existing movies from old age structure (12m/24m/36m) to new structure (24m/36m/48m/60m)
-- Run this in your Supabase SQL editor

-- Update movies table age_scores
UPDATE movies 
SET age_scores = jsonb_build_object(
  '24m', COALESCE((age_scores->>'24m')::int, 0),
  '36m', COALESCE((age_scores->>'36m')::int, 0), 
  '48m', COALESCE((age_scores->>'36m')::int, 0), -- Map 36m to 48m for now
  '60m', COALESCE((age_scores->>'36m')::int, 0)  -- Map 36m to 60m for now
)
WHERE age_scores ? '12m' OR age_scores ? '24m' OR age_scores ? '36m';

-- Update scenes table age_flags  
UPDATE scenes
SET age_flags = jsonb_build_object(
  '24m', COALESCE(age_flags->>'24m', '🚫'),
  '36m', COALESCE(age_flags->>'36m', '⚠️'),
  '48m', COALESCE(age_flags->>'36m', '✅'), -- Map 36m to 48m
  '60m', COALESCE(age_flags->>'36m', '✅')  -- Map 36m to 60m
)
WHERE age_flags ? '12m' OR age_flags ? '24m' OR age_flags ? '36m';

-- Verify the migration
SELECT 
  COUNT(*) as total_movies,
  COUNT(CASE WHEN age_scores ? '24m' THEN 1 END) as has_24m,
  COUNT(CASE WHEN age_scores ? '36m' THEN 1 END) as has_36m,
  COUNT(CASE WHEN age_scores ? '48m' THEN 1 END) as has_48m,
  COUNT(CASE WHEN age_scores ? '60m' THEN 1 END) as has_60m
FROM movies;

SELECT 
  COUNT(*) as total_scenes,
  COUNT(CASE WHEN age_flags ? '24m' THEN 1 END) as has_24m,
  COUNT(CASE WHEN age_flags ? '36m' THEN 1 END) as has_36m,
  COUNT(CASE WHEN age_flags ? '48m' THEN 1 END) as has_48m,
  COUNT(CASE WHEN age_flags ? '60m' THEN 1 END) as has_60m
FROM scenes;
