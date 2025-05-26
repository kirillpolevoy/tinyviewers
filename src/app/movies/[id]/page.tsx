'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import { getMoviePoster } from '@/lib/tmdb';
import { Movie, Scene } from '@/types';

const RATING_MEANINGS = {
  1: 'Very gentle – no intense content (Bluey, Puffin Rock)',
  2: 'Slight tension or mild surprise (Totoro, Daniel Tiger)',
  3: 'Noticeable suspense or emotion (Frozen - parents separate)',
  4: 'Strong tension, loud action, big emotion (Moana - lava monster)',
  5: 'Likely too intense for toddlers (Finding Nemo - barracuda)'
} as const;

const INTENSITY_SCALE = {
  1: 'Very Mild',
  2: 'Mild',
  3: 'Moderate',
  4: 'Strong',
  5: 'Very Strong',
  6: 'Intense',
  7: 'Very Intense',
  8: 'Extremely Intense',
  9: 'Overwhelming',
  10: 'Maximum Intensity'
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

type MovieWithPoster = Movie & { tmdbPoster?: string | null };

const MovieDetailsPage = () => {
  const params = useParams();
  const searchParams = useSearchParams();
  const [movie, setMovie] = useState<MovieWithPoster | null>(null);
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

        const tmdbPoster = await getMoviePoster(movieData.title);
        setMovie({ ...movieData, tmdbPoster });

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

  if (!mounted) return null;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] px-8 md:px-16 py-16">
        <div className="max-w-[90rem] mx-auto">
          <h1 className="text-4xl font-light text-[#6B6B63]">Loading...</h1>
        </div>
      </div>
    );
  }

  if (error || !movie) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] px-8 md:px-16 py-16">
        <div className="max-w-[90rem] mx-auto">
          <Link 
            href={backUrl}
            className="text-[#6B6B63] hover:text-[#2C2C27] transition-colors duration-300 text-base tracking-wide font-light"
          >
            ← Back
          </Link>
          <h1 className="text-4xl font-light mb-6 text-red-600 mt-12">Unable to Load Movie</h1>
          <p className="text-xl text-red-500 font-light mb-8">{error || 'Movie not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F5F5F0] via-white to-[#F5F5F0]">
      <div className="max-w-6xl mx-auto px-6 md:px-12 py-12">
        <Link 
          href={backUrl}
          className="inline-flex items-center gap-2 text-[#6B6B63] hover:text-[#2C2C27] transition-all duration-300 text-base tracking-wide font-light hover:gap-3 group relative px-4 py-2 rounded-full hover:bg-white/40"
        >
          <span className="transition-transform duration-300 group-hover:-translate-x-1">←</span>
          <span>Back to Movies</span>
        </Link>
        
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-12 mt-10 mb-16">
          <div className="relative w-full max-w-[320px] mx-auto lg:mx-0">
            <div className="relative aspect-[2/3] overflow-hidden rounded-2xl shadow-[0_2px_20px_rgba(0,0,0,0.06)] lg:sticky lg:top-12 transition-all duration-500 hover:scale-[1.02] hover:shadow-[0_8px_40px_rgba(0,0,0,0.08)] before:absolute before:inset-0 before:z-10 before:bg-gradient-to-t before:from-black/20 before:to-transparent/0">
              <Image
                src={movie.tmdbPoster || movie.poster_url}
                alt={movie.title}
                fill
                className="object-cover transition-all duration-700 hover:scale-110"
                sizes="(max-width: 1024px) 320px, 320px"
                priority
              />
            </div>
          </div>
          
          <div className="space-y-8">
            <div>
              <h1 className="text-5xl md:text-6xl font-light tracking-tight mb-6 bg-gradient-to-br from-[#2C2C27] via-[#4A4A42] to-[#6B6B63] bg-clip-text text-transparent">
                {movie.title}
              </h1>
              <p className="text-lg text-[#6B6B63] font-light tracking-wide leading-relaxed border-l-2 border-[#2C2C27]/10 pl-6">
                {movie.summary}
              </p>
            </div>
            
            <div className="space-y-4">
              <h2 className="text-2xl font-light text-[#2C2C27] flex items-center gap-3">
                Age Based Scary Score
                <div className="h-px flex-1 bg-gradient-to-r from-[#2C2C27]/10 to-transparent" />
              </h2>
              <div className="grid grid-cols-3 gap-6">
                {(['12m', '24m', '36m'] as const).map((age) => {
                  const score = movie.age_scores[age];
                  const ratingType = getAgeRatingType(score);
                  const ratingInfo = AGE_RATING_INFO[ratingType];
                  return (
                    <div key={age} className="group p-5 rounded-xl bg-white/50 backdrop-blur-sm border border-black/[0.02] shadow-sm transition-all duration-300 hover:shadow-md hover:scale-[1.02] hover:bg-white/60">
                      <div className="flex flex-col">
                        <div className="flex items-baseline gap-1.5 mb-1">
                          <span className="text-[#2C2C27] font-medium text-lg tracking-wide">
                            {age.replace('m', '')}
                          </span>
                          <span className="text-[#6B6B63] text-sm tracking-wide">
                            months old
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex items-baseline gap-1">
                            <p className="text-3xl font-light text-[#2C2C27] transition-all duration-300 group-hover:text-[#2C2C27] ">
                              {score}</p>
                            <span className="text-lg text-[#6B6B63]">/5</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{ratingInfo.icon}</span>
                          </div>
                        </div>
                        <div className="h-1 w-full bg-gray-100 rounded-full mt-2 overflow-hidden">
                          <div 
                            className={`h-full ${getRatingColor(score)} transition-all duration-300`}
                            style={{ width: `${(score / 5) * 100}%` }} 
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-sm text-[#6B6B63] mt-2">
                Age-based scary scores and scene analysis information
              </p>
            </div>
            
            <div className="flex items-center gap-4 p-5 rounded-xl bg-white/50 backdrop-blur-sm border border-black/[0.02] shadow-sm transition-all duration-300 hover:shadow-md hover:bg-white/60 group">
              <div className="w-2 h-2 rounded-full bg-[#2C2C27]/30 transition-transform duration-300 group-hover:scale-110" />
              <p className="text-lg text-[#6B6B63] font-light">
                Rating: <span className="text-[#2C2C27]">{movie.rating}</span>
              </p>
            </div>

            <div className="pt-8">
              <h2 className="text-3xl font-light text-[#2C2C27] mb-8 flex items-center gap-3">
                Scene Analysis
                <span className="px-3 py-1 text-sm text-[#6B6B63] font-light bg-[#2C2C27]/5 rounded-full tracking-wider">
                  {scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'}
                </span>
              </h2>
              {!scenes || scenes.length === 0 ? (
                <p className="text-lg text-[#6B6B63] font-light">No scenes analyzed yet.</p>
              ) : (
                <div className="space-y-6">
                  {scenes.map((scene, index) => (
                    <div 
                      key={scene.id}
                      className="group bg-white/50 backdrop-blur-sm p-7 rounded-xl shadow-[0_2px_20px_rgba(0,0,0,0.03)] transition-all duration-500 ease-out hover:shadow-[0_8px_40px_rgba(0,0,0,0.06)] hover:translate-y-[-2px] border border-black/[0.02]"
                    >
                      {/* Scene Header */}
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-6">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[#2C2C27]/5 text-[#2C2C27] font-medium">
                            {index + 1}
                          </div>
                          <div className="space-y-1">
                            <h3 className="text-base font-medium text-[#2C2C27] tracking-wide">
                              {scene.timestamp_start} - {scene.timestamp_end}
                            </h3>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-[#6B6B63] font-light">
                                Intensity Level:
                              </span>
                              <div className="">
                                <div className="flex items-center gap-1">
                                  <div 
                                    className="w-2.5 h-2.5 rounded-full"
                                    style={{
                                      backgroundColor: scene.intensity <= 3 ? '#22c55e' : 
                                                     scene.intensity <= 6 ? '#eab308' : 
                                                     '#ef4444'
                                    }} 
                                  />
                                  <span 
                                    className="text-sm font-medium"
                                    style={{
                                      color: scene.intensity <= 3 ? '#22c55e' : 
                                             scene.intensity <= 6 ? '#eab308' : 
                                             '#ef4444'
                                    }}
                                  >
                                    {scene.intensity}/10
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="sm:w-48 space-y-2">
                          <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                            <div 
                              className="h-full transition-all duration-300"
                              style={{
                                width: `${(scene.intensity / 10) * 100}%`,
                                backgroundColor: scene.intensity <= 3 ? '#22c55e' : 
                                               scene.intensity <= 6 ? '#eab308' : 
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
                                        ${scene.intensity <= 3 ? '#22c55e' : 
                                          scene.intensity <= 6 ? '#eab308' : 
                                          '#ef4444'} 10%,
                                        ${scene.intensity <= 3 ? '#22c55e' : 
                                          scene.intensity <= 6 ? '#eab308' : 
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
                        <div className="grid grid-cols-3 gap-3">
                          {(['12m', '24m', '36m'] as const).map((age) => {
                            const ageFlag = scene.age_flags[age];
                            // The age_flags in the database store emoji strings directly
                            // like {"12m": "🚫", "24m": "⚠️", "36m": "✅"}
                            return (
                              <div 
                                key={age}
                                className="flex flex-col items-center p-4 rounded-xl bg-gradient-to-b from-[#2C2C27]/[0.02] to-[#2C2C27]/[0.04] transition-all duration-300 hover:from-[#2C2C27]/[0.04] hover:to-[#2C2C27]/[0.06]"
                              >
                                <span className="text-[#6B6B63] text-sm mb-2">
                                  {age.replace('m', '')} months
                                </span>
                                <div className="flex items-center justify-center">
                                  <span className="text-2xl">{ageFlag}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-sm text-[#6B6B63] mt-4">
                Hover over intensity indicators and age flags for more information
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MovieDetailsPage; 