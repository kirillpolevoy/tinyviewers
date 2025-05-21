-- First, get the ID of Sample Movie 1
WITH movie_1 AS (
  SELECT id FROM movies WHERE title = 'Sample Movie 1' LIMIT 1
)
INSERT INTO scenes (movie_id, timestamp_start, timestamp_end, description, tags, intensity, age_flags)
SELECT 
  movie_1.id,
  '00:05:30',
  '00:06:45',
  'A friendly character suddenly appears with loud music',
  ARRAY['surprise', 'loud noise', 'character introduction'],
  3,
  '{"12m": "⚠️", "24m": "✅", "36m": "✅"}'::jsonb
FROM movie_1
UNION ALL
SELECT 
  movie_1.id,
  '00:15:20',
  '00:16:10',
  'Dark scene with thunder and lightning',
  ARRAY['weather', 'darkness', 'loud noise'],
  6,
  '{"12m": "🚫", "24m": "⚠️", "36m": "✅"}'::jsonb
FROM movie_1;

-- Then, get the ID of Sample Movie 2
WITH movie_2 AS (
  SELECT id FROM movies WHERE title = 'Sample Movie 2' LIMIT 1
)
INSERT INTO scenes (movie_id, timestamp_start, timestamp_end, description, tags, intensity, age_flags)
SELECT 
  movie_2.id,
  '00:08:15',
  '00:09:30',
  'Animals playing in the forest with gentle music',
  ARRAY['animals', 'nature', 'music'],
  1,
  '{"12m": "✅", "24m": "✅", "36m": "✅"}'::jsonb
FROM movie_2; 