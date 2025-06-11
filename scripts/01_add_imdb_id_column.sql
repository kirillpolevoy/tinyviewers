-- Add IMDB ID column to movies table for subtitle scraping
ALTER TABLE public.movies 
ADD COLUMN imdb_id TEXT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_movies_imdb_id ON public.movies(imdb_id);

-- Add comment to document the column
COMMENT ON COLUMN public.movies.imdb_id IS 'IMDB ID for subtitle scraping, format: tt1234567'; 