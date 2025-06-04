-- RLS Policies for Toddler Movies App
-- This script creates policies to allow public read access to movies and scenes

-- Policy for movies table - allow public read access
CREATE POLICY "Allow public read access on movies"
ON public.movies
FOR SELECT
TO public
USING (true);

-- Policy for scenes table - allow public read access  
CREATE POLICY "Allow public read access on scenes"
ON public.scenes
FOR SELECT
TO public
USING (true);

-- Optional: If you need to insert/update data programmatically, 
-- you can also add policies for INSERT/UPDATE operations
-- For now, we're only enabling SELECT (read) access

-- Verify RLS is enabled (should already be enabled)
-- ALTER TABLE public.movies ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.scenes ENABLE ROW LEVEL SECURITY; 