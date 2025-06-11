-- Create subtitles table for storing scraped subtitle content
CREATE TABLE public.subtitles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    movie_id UUID NOT NULL REFERENCES public.movies(id) ON DELETE CASCADE,
    subtitle_text TEXT NOT NULL,
    language VARCHAR(10) NOT NULL DEFAULT 'en',
    source VARCHAR(50) NOT NULL DEFAULT 'opensubtitles',
    file_format VARCHAR(10) NOT NULL DEFAULT 'srt',
    download_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_subtitles_movie_id ON public.subtitles(movie_id);
CREATE INDEX IF NOT EXISTS idx_subtitles_language ON public.subtitles(language);
CREATE INDEX IF NOT EXISTS idx_subtitles_source ON public.subtitles(source);

-- Enable RLS
ALTER TABLE public.subtitles ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access
CREATE POLICY "Allow public read access on subtitles"
ON public.subtitles
FOR SELECT
TO public
USING (true);

-- Add table comment
COMMENT ON TABLE public.subtitles IS 'Stores scraped subtitle content for movies to enable Claude analysis'; 