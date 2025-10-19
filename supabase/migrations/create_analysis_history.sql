-- Create analysis_history table to track movie analysis runs
CREATE TABLE IF NOT EXISTS public.analysis_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    movie_id UUID NOT NULL REFERENCES public.movies(id) ON DELETE CASCADE,
    age_scores JSONB NOT NULL,
    overall_scary_score INTEGER,
    scenes_count INTEGER NOT NULL DEFAULT 0,
    model_used TEXT NOT NULL DEFAULT 'Claude 3.5 Haiku',
    analysis_duration_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_analysis_history_movie_id ON public.analysis_history(movie_id);
CREATE INDEX IF NOT EXISTS idx_analysis_history_created_at ON public.analysis_history(created_at DESC);

-- Enable RLS
ALTER TABLE public.analysis_history ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access
CREATE POLICY "Allow public read access on analysis_history"
ON public.analysis_history
FOR SELECT
TO public
USING (true);

-- Create policy for service role to insert/update
CREATE POLICY "Allow service role to manage analysis_history"
ON public.analysis_history
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Add table comment
COMMENT ON TABLE public.analysis_history IS 'Tracks the history of movie analysis runs for each movie';
