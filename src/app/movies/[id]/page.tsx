'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import { Movie, Scene } from '@/types';

const RATING_MEANINGS = {
  1: 'Very gentle – no intense content',
  2: 'Slight tension or mild surprise',
  3: 'Noticeable suspense or emotion',
  4: 'Strong tension, loud action, big emotion',
  5: 'Likely too intense for toddlers'
} as const;

const INTENSITY_SCALE = {
  1: 'Very Mild',
  2: 'Mild',
  3: 'Moderate',
  4: 'Strong',
  5: 'Very Strong'
} as const;

const AGE_RATING_INFO = {
  safe: {
    icon: '✅',
    text: 'Safe — should be fine for most children'
  },
  caution: {
    icon: '⚠️',
    text: 'Caution — could be scary or emotional'
  },
  notRecommended: {
    icon: '🚫',
    text: 'Not recommended — likely distressing'
  }
} as const;

const MovieDetailsPage = () => {
  const params = useParams();
  const searchParams = useSearchParams();
  const [movie, setMovie] = useState<Movie | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  const backUrl = searchParams?.get('search') 
    ? `/movies?search=${searchParams.get('search')}${searchParams.get('category') ? `&category=${searchParams.get('category')}` : ''}${searchParams.get('age') ? `&age=${searchParams.get('age')}` : ''}`
    : '/movies';

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const fetchMovieAndScenes = async () => {
      try {
        const { data: movieData, error: movieError } = await supabase
          .from('movies')
          .select('*')
          .eq('id', params.id)
          .single();

        if (movieError) {
          setError(`Error fetching movie: ${movieError.message}`);
          return;
        }

        if (!movieData) {
          setError('Movie not found');
          return;
        }

        setMovie(movieData);

        const { data: scenesData, error: scenesError } = await supabase
          .from('scenes')
          .select('*')
          .eq('movie_id', params.id)
          .order('timestamp_start');

        if (scenesError) {
          setError(`Error fetching scenes: ${scenesError.message}`);
          return;
        }

        setScenes(scenesData || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    if (mounted && params.id) {
      fetchMovieAndScenes();
    }
  }, [params.id, mounted]);

  const getAgeRatingType = (score: number): keyof typeof AGE_RATING_INFO => {
    if (score <= 2) return 'safe';
    if (score <= 4) return 'caution';
    return 'notRecommended';
  };

  const getRatingColor = (score: number): string => {
    const colors = {
      1: 'bg-green-500',
      2: 'bg-lime-500',
      3: 'bg-yellow-500',
      4: 'bg-orange-500',
      5: 'bg-red-500'
    };
    return colors[score as keyof typeof colors] || 'bg-gray-500';
  };

  const getScoreDescription = (score: number): string => {
    return RATING_MEANINGS[score as keyof typeof RATING_MEANINGS] || '';
  };

  const getFlagDescription = (flag: string): string => {
    switch (flag) {
      case '✅':
        return 'Safe — should be fine for most children';
      case '⚠️':
        return 'Caution — could be scary or emotional';
      case '🚫':
        return 'Not recommended — likely distressing';
      default:
        return '';
    }
  };

  if (!mounted) return null;

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sky-50 via-purple-50 to-orange-50">
        {/* Header */}
        <header className="sticky top-0 z-30 backdrop-blur-md bg-white/60 shadow-sm">
          <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
            <Link href="/" className="text-2xl font-bold tracking-tight flex items-center gap-2">
              🧸 <span>Tiny Viewers</span>
            </Link>
          </div>
        </header>
        
        <div className="max-w-7xl mx-auto px-6 py-24">
          <div className="flex justify-center items-center min-h-[400px]">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mb-6"></div>
              <h1 className="text-2xl font-semibold text-gray-800">Loading movie details...</h1>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !movie) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sky-50 via-purple-50 to-orange-50">
        {/* Header */}
        <header className="sticky top-0 z-30 backdrop-blur-md bg-white/60 shadow-sm">
          <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
            <Link href="/" className="text-2xl font-bold tracking-tight flex items-center gap-2">
              🧸 <span>Tiny Viewers</span>
            </Link>
          </div>
        </header>
        
        <div className="max-w-7xl mx-auto px-6 py-16">
          <Link 
            href={backUrl}
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-800 transition-colors duration-300 text-base font-medium mb-8 hover:gap-3 group"
          >
            <span className="transition-transform duration-300 group-hover:-translate-x-1">←</span>
            <span>Back to Movies</span>
          </Link>
          
          <div className="text-center py-16 bg-white/60 backdrop-blur-sm rounded-3xl shadow-lg border border-white/60">
            <div className="text-6xl mb-6">❌</div>
            <h1 className="text-3xl font-bold mb-6 text-red-600">Unable to Load Movie</h1>
            <p className="text-xl text-red-500 mb-8">{error || 'Movie not found'}</p>
          </div>
        </div>
      </div>
    );
  }

  // Use TMDB data if available, fallback to original data
  const posterUrl = movie.tmdb_poster_url || movie.poster_url;
  const displayRating = movie.tmdb_rating || movie.rating;
  const description = movie.tmdb_description || movie.summary;

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-purple-50 to-orange-50">
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/60 shadow-sm">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
          <Link href="/" className="text-2xl font-bold tracking-tight flex items-center gap-2">
            🧸 <span>Tiny Viewers</span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium">
            <a href="#feedback" className="hover:text-primary transition-colors">Feedback</a>
          </nav>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-12">
        <Link 
          href={backUrl}
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-800 transition-colors duration-300 text-base font-medium mb-12 hover:gap-3 group"
        >
          <span className="transition-transform duration-300 group-hover:-translate-x-1">←</span>
          <span>Back to Movies</span>
        </Link>
        
        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-12 mb-16">
          {/* Movie Poster */}
          <div className="relative w-full max-w-[400px] mx-auto lg:mx-0">
            <div className="relative aspect-[2/3] overflow-hidden rounded-3xl shadow-2xl lg:sticky lg:top-24 transition-all duration-500 hover:scale-[1.02] bg-white/90 backdrop-blur-sm border border-white/60">
              {(posterUrl && !posterUrl.includes('example.com')) ? (
                <Image
                  src={posterUrl}
                  alt={movie.title}
                  fill
                  className="object-cover transition-all duration-700 hover:scale-105"
                  sizes="(max-width: 1024px) 400px, 400px"
                  priority
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-blue-100 to-purple-100 flex items-center justify-center">
                  <div className="text-center p-8">
                    <div className="text-8xl mb-6">🎬</div>
                    <p className="text-xl text-gray-700 font-semibold">{movie.title}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Movie Details */}
          <div className="space-y-12">
            <div className="bg-white/60 backdrop-blur-sm rounded-3xl shadow-lg border border-white/60 p-8">
              <h1 className="text-4xl md:text-5xl font-extrabold bg-gradient-to-r from-blue-600 to-emerald-500 text-transparent bg-clip-text mb-6 drop-shadow-lg">
                {movie.title}
              </h1>
              <p className="text-lg text-gray-700 leading-relaxed mb-6">
                {description}
              </p>
              <div className="flex items-center gap-4 text-gray-600">
                <span className="bg-blue-100 px-3 py-1 rounded-full text-sm font-medium">
                  Rating: {displayRating}
                </span>
              </div>
            </div>
            
            {/* Age Ratings */}
            <div className="bg-white/60 backdrop-blur-sm rounded-3xl shadow-lg border border-white/60 p-8">
              <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-3">
                <span>Age-Based Safety Scores</span>
                <div className="h-px flex-1 bg-gradient-to-r from-gray-300 to-transparent" />
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {(['12m', '24m', '36m'] as const).map((age) => {
                  const score = movie.age_scores[age];
                  const ratingType = getAgeRatingType(score);
                  const ratingInfo = AGE_RATING_INFO[ratingType];
                  return (
                    <div key={age} className="group p-6 rounded-2xl bg-white/80 backdrop-blur-sm border border-white/60 shadow-md transition-all duration-300 hover:shadow-xl hover:scale-[1.02]">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-gray-800 font-bold text-xl">
                            {age.replace('m', '')} months
                          </span>
                          <span className="text-2xl">{ratingInfo.icon}</span>
                        </div>
                        <div className="flex items-baseline gap-2 mb-3">
                          <span className="text-3xl font-bold text-gray-800">{score}</span>
                          <span className="text-lg text-gray-600">/5</span>
                        </div>
                        <p className="text-sm text-gray-600 mb-4 leading-relaxed">
                          {getScoreDescription(score)}
                        </p>
                        <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className={`h-full transition-all duration-500 ${getRatingColor(score)}`}
                            style={{ width: `${(score / 5) * 100}%` }} 
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Scene Analysis */}
            <div className="bg-white/60 backdrop-blur-sm rounded-3xl shadow-lg border border-white/60 p-8">
              <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-3">
                <span>Scene Analysis</span>
                <span className="px-3 py-1 text-sm text-gray-600 bg-gray-100 rounded-full">
                  {scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'}
                </span>
              </h2>
              {!scenes || scenes.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-4xl mb-4">🎬</div>
                  <p className="text-lg text-gray-600">No scenes analyzed yet.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {scenes.map((scene, index) => (
                    <div 
                      key={scene.id}
                      className="group bg-white/80 backdrop-blur-sm p-6 rounded-2xl shadow-md transition-all duration-300 hover:shadow-xl border border-white/60"
                    >
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-6">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-800 font-bold">
                            {index + 1}
                          </div>
                          <div>
                            <h3 className="text-lg font-semibold text-gray-800">
                              {scene.timestamp_start} - {scene.timestamp_end}
                            </h3>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-sm text-gray-600">Intensity:</span>
                              <div className="flex items-center gap-2">
                                <div 
                                  className="w-3 h-3 rounded-full"
                                  style={{
                                    backgroundColor: scene.intensity <= 2 ? '#22c55e' : 
                                                   scene.intensity <= 4 ? '#eab308' : 
                                                   '#ef4444'
                                  }} 
                                />
                                <span 
                                  className="text-sm font-semibold"
                                  style={{
                                    color: scene.intensity <= 2 ? '#22c55e' : 
                                           scene.intensity <= 4 ? '#eab308' : 
                                           '#ef4444'
                                  }}
                                >
                                  {scene.intensity}/5
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="sm:w-48">
                          <div className="h-3 w-full bg-gray-200 rounded-full overflow-hidden">
                            <div 
                              className="h-full transition-all duration-500"
                              style={{
                                width: `${(scene.intensity / 5) * 100}%`,
                                backgroundColor: scene.intensity <= 2 ? '#22c55e' : 
                                               scene.intensity <= 4 ? '#eab308' : 
                                               '#ef4444'
                              }} 
                            />
                          </div>
                        </div>
                      </div>
                      
                      {/* Scene Description */}
                      <div className="relative mb-6">
                        <div 
                          className="absolute left-0 top-0 w-[3px] h-full rounded-full"
                          style={{
                            background: `linear-gradient(to bottom, 
                                        transparent,
                                        ${scene.intensity <= 2 ? '#22c55e' : 
                                          scene.intensity <= 4 ? '#eab308' : 
                                          '#ef4444'} 10%,
                                        ${scene.intensity <= 2 ? '#22c55e' : 
                                          scene.intensity <= 4 ? '#eab308' : 
                                          '#ef4444'} 90%,
                                        transparent)`
                          }} 
                        />
                        <p className="text-base text-[#2C2C27] font-light leading-relaxed pl-6">
                          {scene.description}
                        </p>
                      </div>

                      {/* Tags */}
                      {scene.tags && scene.tags.length > 0 && (
                        <div className="mb-6">
                          <h4 className="text-sm font-medium text-[#2C2C27] mb-3">Scene Tags</h4>
                          <div className="flex flex-wrap gap-2">
                            {scene.tags.map((tag, index) => (
                              <span 
                                key={index}
                                className="bg-[#2C2C27]/[0.03] text-[#2C2C27] text-sm px-4 py-2 rounded-full font-light transition-all duration-300 hover:bg-[#2C2C27]/[0.06]"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Scene Age Recommendations */}
                      <div>
                        <h4 className="text-sm font-medium text-[#2C2C27] mb-3">Age Recommendations</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          {(['12m', '24m', '36m'] as const).map((age) => {
                            const ageFlag = scene.age_flags[age];
                            // The age_flags in the database store emoji strings directly
                            // like {"12m": "🚫", "24m": "⚠️", "36m": "✅"}
                            return (
                              <div 
                                key={age}
                                className="flex flex-col items-start p-3 sm:p-4 rounded-xl bg-gradient-to-b from-[#2C2C27]/[0.02] to-[#2C2C27]/[0.04] transition-all duration-300 hover:from-[#2C2C27]/[0.04] hover:to-[#2C2C27]/[0.06]"
                              >
                                <span className="text-[#6B6B63] text-xs sm:text-sm mb-2">
                                  {age.replace('m', '')} months
                                </span>
                                <div className="flex items-center mb-2">
                                  <span className="text-xl sm:text-2xl">{ageFlag}</span>
                                </div>
                                <p className="text-xs text-[#6B6B63] italic leading-relaxed">
                                  {getFlagDescription(ageFlag)}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MovieDetailsPage; 