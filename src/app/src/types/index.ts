export type AgeFlag = '🚫' | '⚠️' | '✅';

export interface Movie {
  id: string;
  title: string;
  summary: string;
  poster_url: string;
  rating: string;
  age_scores: {
    '24m': number;
    '36m': number;
    '48m': number;
    '60m': number;
  };
  // TMDB fields
  tmdb_poster_url?: string | null;
  tmdb_rating?: string | null;
  tmdb_description?: string | null;
  tmdb_updated_at?: string | null;
  // IMDB ID for subtitle scraping
  imdb_id?: string | null;
  // Release year
  release_year?: number | null;
  // Active status flag
  is_active?: boolean | null;
}

export interface Scene {
  id: string;
  movie_id: string;
  timestamp_start: string;
  timestamp_end: string;
  description: string;
  tags: string[];
  intensity: number;
  age_flags: {
    '24m': AgeFlag;
    '36m': AgeFlag;
    '48m': AgeFlag;
    '60m': AgeFlag;
  };
}

export interface Subtitle {
  id: string;
  movie_id: string;
  subtitle_text: string;
  language: string;
  source: string;
  file_format: string;
  download_url?: string | null;
  created_at: string;
} 