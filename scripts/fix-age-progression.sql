-- Quick fix script to restore proper age score progression
-- This fixes the migration issue by making 48m and 60m progressively better than 36m

UPDATE movies 
SET age_scores = jsonb_build_object(
  '24m', age_scores->>'24m',  -- Keep original 24m score
  '36m', age_scores->>'36m',  -- Keep original 36m score
  '48m', GREATEST(1, (age_scores->>'36m')::int - 1),  -- One level better than 36m
  '60m', GREATEST(1, (age_scores->>'36m')::int - 2)   -- Two levels better than 36m
)
WHERE age_scores ? '24m' AND age_scores ? '36m';

-- Verify the fix
SELECT 
  title,
  age_scores->>'24m' as age_24m,
  age_scores->>'36m' as age_36m, 
  age_scores->>'48m' as age_48m,
  age_scores->>'60m' as age_60m
FROM movies 
WHERE title ILIKE '%nemo%'
LIMIT 5;
