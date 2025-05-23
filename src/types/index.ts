export type AgeFlag = '🚫' | '⚠️' | '✅';

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
  tags: string[];
  intensity: number;
  age_flags: {
    '12m': AgeFlag;
    '24m': AgeFlag;
    '36m': AgeFlag;
  };
} 