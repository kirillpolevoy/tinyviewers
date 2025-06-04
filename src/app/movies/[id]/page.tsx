'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { supabase } from '../../../lib/supabase';
import { Movie, Scene } from '../../../types';
import FeedbackModal from '../../components/FeedbackModal';

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
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);

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
      1: 'bg-emerald-500',
      2: 'bg-green-500',
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
      <div className="min-h-screen bg-gradient-to-br from-pink-50/50 via-purple-50/30 to-white">
        {/* Header */}
        <header className="sticky top-0 z-30 backdrop-blur-md bg-white/60 shadow-sm">
          <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
            <Link href="/" className="text-2xl font-bold tracking-tight flex items-center gap-2 hover:scale-105 transition-transform duration-300">
              🧸 <span>Tiny Viewers</span>
            </Link>
            <nav className="flex items-center gap-6 text-sm font-medium">
              <button 
                onClick={() => setIsFeedbackModalOpen(true)}
                className="hover:text-purple-600 transition-colors duration-300 px-3 py-2 rounded-full hover:bg-purple-50"
              >
                Feedback
              </button>
            </nav>
          </div>
        </header>
        
        <div className="max-w-7xl mx-auto px-6 py-24">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-center items-center min-h-[400px]"
          >
            <div className="text-center">
              <div className="text-5xl mb-6 animate-bounce">🎬</div>
              <div className="inline-block animate-spin rounded-full h-16 w-16 border-4 border-purple-200 border-t-purple-600 mb-6"></div>
              <h1 className="text-2xl font-light text-slate-800 tracking-tight" style={{
                fontFamily: 'system-ui, -apple-system, serif',
              }}>Loading movie details...</h1>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  if (error || !movie) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-50/50 via-purple-50/30 to-white">
        {/* Header */}
        <header className="sticky top-0 z-30 backdrop-blur-md bg-white/60 shadow-sm">
          <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
            <Link href="/" className="text-2xl font-bold tracking-tight flex items-center gap-2 hover:scale-105 transition-transform duration-300">
              🧸 <span>Tiny Viewers</span>
            </Link>
            <nav className="flex items-center gap-6 text-sm font-medium">
              <button 
                onClick={() => setIsFeedbackModalOpen(true)}
                className="hover:text-purple-600 transition-colors duration-300 px-3 py-2 rounded-full hover:bg-purple-50"
              >
                Feedback
              </button>
            </nav>
          </div>
        </header>
        
        <div className="max-w-7xl mx-auto px-6 py-16">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <Link 
              href={backUrl}
              className="inline-flex items-center gap-2 text-slate-600 hover:text-purple-600 transition-all duration-300 text-base font-medium mb-8 hover:gap-3 group bg-white/50 px-4 py-2 rounded-full backdrop-blur-sm border border-pink-100"
            >
              <span className="transition-transform duration-300 group-hover:-translate-x-1">←</span>
              <span>Back to Movies</span>
            </Link>
          </motion.div>
          
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="text-center py-16 bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-pink-100"
          >
            <div className="text-6xl mb-6">😞</div>
            <h1 className="text-3xl font-light text-red-600 mb-6 tracking-tight" style={{
              fontFamily: 'system-ui, -apple-system, serif',
            }}>Unable to Load Movie</h1>
            <p className="text-xl text-red-500 mb-8">{error || 'Movie not found'}</p>
          </motion.div>
        </div>
      </div>
    );
  }

  // Use TMDB data if available, fallback to original data
  const posterUrl = movie.tmdb_poster_url || movie.poster_url;
  const displayRating = movie.tmdb_rating || movie.rating;
  const description = movie.tmdb_description || movie.summary;

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50/50 via-purple-50/30 to-white">
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/60 shadow-sm">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
          <Link href="/" className="text-2xl font-bold tracking-tight flex items-center gap-2 hover:scale-105 transition-transform duration-300">
            🧸 <span>Tiny Viewers</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm font-medium">
            <button 
              onClick={() => setIsFeedbackModalOpen(true)}
              className="hover:text-purple-600 transition-colors duration-300 px-3 py-2 rounded-full hover:bg-purple-50"
            >
              Feedback
            </button>
          </nav>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <Link 
            href={backUrl}
            className="inline-flex items-center gap-2 text-slate-600 hover:text-purple-600 transition-all duration-300 text-base font-medium mb-12 hover:gap-3 group bg-white/50 px-4 py-2 rounded-full backdrop-blur-sm border border-pink-100"
          >
            <span className="transition-transform duration-300 group-hover:-translate-x-1">←</span>
            <span>Back to Movies</span>
          </Link>
        </motion.div>
        
        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-12 mb-16">
          {/* Movie Poster */}
          <motion.div 
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative w-full max-w-[400px] mx-auto lg:mx-0"
          >
            <div className="relative aspect-[2/3] overflow-hidden rounded-2xl shadow-2xl lg:sticky lg:top-24 transition-all duration-500 hover:scale-[1.02] bg-white/90 backdrop-blur-sm border border-pink-100">
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
                <div className="w-full h-full bg-gradient-to-br from-pink-100 via-purple-100 to-blue-100 flex items-center justify-center">
                  <div className="text-center p-8">
                    <div className="text-8xl mb-6">🎬</div>
                    <p className="text-xl text-slate-700 font-semibold">{movie.title}</p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
          
          {/* Movie Details */}
          <div className="space-y-8">
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-pink-100 p-8"
            >
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-light text-slate-800 mb-6 tracking-tight leading-tight" style={{
                fontFamily: 'system-ui, -apple-system, serif',
                textShadow: '0 2px 8px rgba(168, 85, 247, 0.15)',
              }}>
                <span className="text-transparent bg-gradient-to-r from-pink-600 via-purple-500 to-emerald-500 bg-clip-text">
                  {movie.title}
                </span>
              </h1>
              <p className="text-lg text-slate-600 leading-relaxed mb-6">
                {description}
              </p>
              <div className="flex items-center gap-4 text-slate-600">
                <span className="bg-purple-100 px-4 py-2 rounded-full text-sm font-medium border border-purple-200">
                  Rating: {displayRating}
                </span>
              </div>
            </motion.div>
            
            {/* Age Ratings */}
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-pink-100 p-8"
            >
              <h2 className="text-2xl font-light text-slate-800 mb-6 tracking-tight" style={{
                fontFamily: 'system-ui, -apple-system, serif',
              }}>
                <span className="text-transparent bg-gradient-to-r from-pink-600 via-purple-500 to-emerald-500 bg-clip-text">
                  Age-Based Safety Scores
                </span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {(['12m', '24m', '36m'] as const).map((age, index) => {
                  const score = movie.age_scores[age];
                  const ratingType = getAgeRatingType(score);
                  const ratingInfo = AGE_RATING_INFO[ratingType];
                  return (
                    <motion.div 
                      key={age}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.6, delay: 0.5 + index * 0.1 }}
                      className="group p-6 rounded-2xl bg-white/80 backdrop-blur-sm border border-pink-100 shadow-md transition-all duration-300 hover:shadow-xl hover:scale-[1.02] hover:border-purple-200"
                    >
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-slate-800 font-semibold text-xl">
                            {age.replace('m', '')} months
                          </span>
                          <span className="text-2xl">{ratingInfo.icon}</span>
                        </div>
                        <div className="flex items-baseline gap-2 mb-3">
                          <span className="text-3xl font-bold text-slate-800">{score}</span>
                          <span className="text-lg text-slate-600">/5</span>
                        </div>
                        <p className="text-sm text-slate-600 mb-4 leading-relaxed">
                          {getScoreDescription(score)}
                        </p>
                        <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className={`h-full transition-all duration-500 ${getRatingColor(score)}`}
                            style={{ width: `${(score / 5) * 100}%` }} 
                          />
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>

            {/* Scene Analysis */}
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-pink-100 p-8"
            >
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-3 mb-6">
                <h2 className="text-2xl font-light text-slate-800 tracking-tight" style={{
                  fontFamily: 'system-ui, -apple-system, serif',
                }}>
                  <span className="text-transparent bg-gradient-to-r from-pink-600 via-purple-500 to-emerald-500 bg-clip-text">
                    Scene Analysis
                  </span>
                </h2>
                <div className="flex items-center justify-between sm:justify-start sm:flex-1">
                  <span className="px-4 py-2 text-sm text-slate-600 bg-purple-100 rounded-full font-medium border border-purple-200">
                    {scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'}
                  </span>
                </div>
              </div>
              {!scenes || scenes.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-4xl mb-4">🎭</div>
                  <p className="text-lg text-slate-600">No scenes analyzed yet.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {scenes.map((scene, index) => (
                    <motion.div 
                      key={scene.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.7 + index * 0.1 }}
                      className="group bg-white/80 backdrop-blur-sm p-6 rounded-2xl shadow-md transition-all duration-300 hover:shadow-xl border border-pink-100 hover:border-purple-200"
                    >
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-6">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold">
                            {index + 1}
                          </div>
                          <div>
                            <h3 className="text-lg font-semibold text-slate-800">
                              {scene.timestamp_start} - {scene.timestamp_end}
                            </h3>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-sm text-slate-600">Intensity:</span>
                              <div className="flex items-center gap-2">
                                <div 
                                  className="w-3 h-3 rounded-full"
                                  style={{
                                    backgroundColor: scene.intensity <= 2 ? '#10b981' : 
                                                   scene.intensity <= 4 ? '#f59e0b' : 
                                                   '#ef4444'
                                  }} 
                                />
                                <span 
                                  className="text-sm font-semibold"
                                  style={{
                                    color: scene.intensity <= 2 ? '#10b981' : 
                                           scene.intensity <= 4 ? '#f59e0b' : 
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
                              className="h-full transition-all duration-500 rounded-full"
                              style={{
                                width: `${(scene.intensity / 5) * 100}%`,
                                backgroundColor: scene.intensity <= 2 ? '#10b981' : 
                                               scene.intensity <= 4 ? '#f59e0b' : 
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
                                        ${scene.intensity <= 2 ? '#10b981' : 
                                          scene.intensity <= 4 ? '#f59e0b' : 
                                          '#ef4444'} 10%,
                                        ${scene.intensity <= 2 ? '#10b981' : 
                                          scene.intensity <= 4 ? '#f59e0b' : 
                                          '#ef4444'} 90%,
                                        transparent)`
                          }}
                        />
                        <div className="pl-6">
                          <p className="text-slate-700 leading-relaxed mb-4">
                            {scene.description}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </div>

      {/* Feedback Modal */}
      <FeedbackModal 
        isOpen={isFeedbackModalOpen} 
        onClose={() => setIsFeedbackModalOpen(false)} 
      />
    </div>
  );
};

export default MovieDetailsPage; 