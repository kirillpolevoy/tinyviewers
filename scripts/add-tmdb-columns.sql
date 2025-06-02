-- Add TMDB columns to the movies table
-- Run this in the Supabase SQL Editor

ALTER TABLE movies 
ADD COLUMN IF NOT EXISTS tmdb_poster_url TEXT,
ADD COLUMN IF NOT EXISTS tmdb_rating TEXT,
ADD COLUMN IF NOT EXISTS tmdb_description TEXT,
ADD COLUMN IF NOT EXISTS tmdb_updated_at TIMESTAMP WITH TIME ZONE; 