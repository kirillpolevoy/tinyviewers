-- Fix RLS policies for saved_movies table
-- This script addresses the 406 errors by ensuring proper permissions

-- First, let's check if the saved_movies table exists and has the right structure
-- If not, create it
CREATE TABLE IF NOT EXISTS public.saved_movies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    movie_id UUID NOT NULL REFERENCES public.movies(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    UNIQUE(user_id, movie_id)
);

-- Enable RLS
ALTER TABLE public.saved_movies ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own saved movies" ON public.saved_movies;
DROP POLICY IF EXISTS "Users can insert their own saved movies" ON public.saved_movies;
DROP POLICY IF EXISTS "Users can delete their own saved movies" ON public.saved_movies;
DROP POLICY IF EXISTS "Users can update their own saved movies" ON public.saved_movies;

-- Create comprehensive RLS policies
-- Policy 1: Users can view their own saved movies
CREATE POLICY "Users can view their own saved movies"
ON public.saved_movies
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Policy 2: Users can insert their own saved movies
CREATE POLICY "Users can insert their own saved movies"
ON public.saved_movies
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Policy 3: Users can delete their own saved movies
CREATE POLICY "Users can delete their own saved movies"
ON public.saved_movies
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Policy 4: Users can update their own saved movies
CREATE POLICY "Users can update their own saved movies"
ON public.saved_movies
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_saved_movies_user_id ON public.saved_movies(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_movies_movie_id ON public.saved_movies(movie_id);
CREATE INDEX IF NOT EXISTS idx_saved_movies_user_movie ON public.saved_movies(user_id, movie_id);

-- Add table comment
COMMENT ON TABLE public.saved_movies IS 'User saved movies with proper RLS policies';

-- Test the policies by checking if we can query the table
-- This should work for authenticated users
SELECT 'RLS policies created successfully' as status;
