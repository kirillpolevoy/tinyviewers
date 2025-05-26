export interface Movie {
  id: string;
  title: string;
  summary: string;
  poster_url: string;
  rating: string;
  age_scores: {
    '12m': number;
    '24m': number;
    '36m': number;
  };
}

export interface Scene {
  id: string;
  movie_id: string;
  timestamp_start: string;
  timestamp_end: string;
  description: string;
  intensity: number;
  tags: string[];
  age_flags: {
    '12m': string;
    '24m': string;
    '36m': string;
  };
} 