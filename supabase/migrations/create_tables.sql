-- Create the movies table
CREATE TABLE movies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    poster_url TEXT NOT NULL,
    rating TEXT NOT NULL,
    age_scores JSONB NOT NULL DEFAULT '{
        "24m": 0,
        "36m": 0,
        "48m": 0,
        "60m": 0
    }'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create the scenes table
CREATE TABLE scenes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    timestamp_start TEXT NOT NULL,
    timestamp_end TEXT NOT NULL,
    description TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    intensity INTEGER NOT NULL CHECK (intensity >= 0 AND intensity <= 10),
    age_flags JSONB NOT NULL DEFAULT '{
        "24m": "🚫",
        "36m": "⚠️",
        "48m": "✅",
        "60m": "✅"
    }'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create indexes
CREATE INDEX idx_scenes_movie_id ON scenes(movie_id);

-- Add some sample data
INSERT INTO movies (title, summary, poster_url, rating, age_scores) VALUES
(
    'Sample Movie 1',
    'A heartwarming story about friendship',
    'https://example.com/poster1.jpg',
    'G',
    '{"24m": 1, "36m": 1, "48m": 1, "60m": 1}'
),
(
    'Sample Movie 2',
    'An adventure in the magical forest',
    'https://example.com/poster2.jpg',
    'G',
    '{"24m": 2, "36m": 1, "48m": 1, "60m": 1}'
); 