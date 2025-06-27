'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { Movie, Scene, AgeFlag } from '@/types';
import FeedbackModal from '../../components/FeedbackModal';

const RATING_MEANINGS = {
  1: 'Very gentle – no intense content',
  2: 'Slight tension or mild surprise',
  3: 'Noticeable suspense or emotion',
  4: 'Strong tension, loud action, big emotion',
  5: 'Likely too intense for young children'
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

// Function to extract year from title (e.g., "Beauty and the Beast (1991)" -> 1991)
function extractYearFromTitle(title: string): number | null {
  const yearMatch = title.match(/\((\d{4})\)/);
  return yearMatch ? parseInt(yearMatch[1]) : null;
}

// Function to display title with year (removes year from title if it's already there)
function formatTitleWithYear(title: string, year?: number | null): { displayTitle: string; displayYear: string | null } {
  const extractedYear = extractYearFromTitle(title);
  
  if (extractedYear) {
    // Year is already in the title, remove it and use it
    const cleanTitle = title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
    return {
      displayTitle: cleanTitle,
      displayYear: `(${extractedYear})`
    };
  } else if (year) {
    // Use provided year
    return {
      displayTitle: title,
      displayYear: `(${year})`
    };
  } else {
    // No year available
    return {
      displayTitle: title,
      displayYear: null
    };
  }
}

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
          .or('is_active.is.null,is_active.eq.true')
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

  // Generate age flags from intensity if not available in data
  const generateAgeFlags = (intensity: number): { '24m': AgeFlag; '36m': AgeFlag; '48m': AgeFlag; '60m': AgeFlag } => {
    // Younger children are more sensitive to intensity
    const flags = intensity <= 1 ? { '24m': '✅' as AgeFlag, '36m': '✅' as AgeFlag, '48m': '✅' as AgeFlag, '60m': '✅' as AgeFlag } :
                  intensity === 2 ? { '24m': '⚠️' as AgeFlag, '36m': '✅' as AgeFlag, '48m': '✅' as AgeFlag, '60m': '✅' as AgeFlag } :
                  intensity === 3 ? { '24m': '🚫' as AgeFlag, '36m': '⚠️' as AgeFlag, '48m': '✅' as AgeFlag, '60m': '✅' as AgeFlag } :
                  intensity === 4 ? { '24m': '🚫' as AgeFlag, '36m': '🚫' as AgeFlag, '48m': '⚠️' as AgeFlag, '60m': '✅' as AgeFlag } :
                  { '24m': '🚫' as AgeFlag, '36m': '🚫' as AgeFlag, '48m': '🚫' as AgeFlag, '60m': '⚠️' as AgeFlag };
    
    return flags;
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
  
  // Format title with year
  const { displayTitle, displayYear } = formatTitleWithYear(movie.title, movie.release_year);

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

      <div className="max-w-7xl mx-auto px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <Link 
            href={backUrl}
            className="inline-flex items-center gap-2 text-slate-600 hover:text-purple-600 transition-all duration-300 text-sm font-medium mb-8 hover:gap-3 group bg-white/50 px-3 py-1.5 rounded-full backdrop-blur-sm border border-pink-100"
          >
            <span className="transition-transform duration-300 group-hover:-translate-x-1">←</span>
            <span>Back to Movies</span>
          </Link>
        </motion.div>
        
        <div className="grid grid-cols-1 lg:grid-cols-[350px_1fr] gap-8 mb-12">
          {/* Movie Poster */}
          <motion.div 
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative w-full max-w-[350px] mx-auto lg:mx-0"
          >
            <div className="relative aspect-[2/3] overflow-hidden rounded-xl shadow-xl lg:sticky lg:top-20 transition-all duration-500 hover:scale-[1.02] bg-white/90 backdrop-blur-sm border border-pink-100">
              {(posterUrl && !posterUrl.includes('example.com')) ? (
                <Image
                  src={posterUrl}
                  alt={movie.title}
                  fill
                  className="object-cover transition-all duration-700 hover:scale-105"
                  sizes="(max-width: 1024px) 350px, 350px"
                  priority
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-pink-100 via-purple-100 to-blue-100 flex items-center justify-center">
                  <div className="text-center p-6">
                    <div className="text-6xl mb-4">🎬</div>
                    <p className="text-lg text-slate-700 font-semibold">{movie.title}</p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
          
          {/* Movie Details */}
          <div className="space-y-6">
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-pink-100 p-6"
            >
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-light text-slate-800 mb-4 tracking-tight leading-tight" style={{
                fontFamily: 'system-ui, -apple-system, serif',
                textShadow: '0 2px 8px rgba(168, 85, 247, 0.15)',
              }}>
                <span className="text-transparent bg-gradient-to-r from-pink-600 via-purple-500 to-emerald-500 bg-clip-text">
                  {displayTitle}
                </span>
              </h1>
              <p className="text-base text-slate-600 leading-relaxed mb-4">
                {description}
              </p>
              <div className="flex items-center gap-3 text-slate-600 flex-wrap">
                {/* Redesigned Rating Display - More Compact & Elegant */}
                {(movie as any).imdb_rating ? (
                  <div className="inline-flex items-center gap-2 bg-gradient-to-r from-amber-50 to-orange-50 px-3 py-1.5 rounded-lg border border-amber-200/60 shadow-sm">
                    <span className="text-amber-600 text-sm">📽️</span>
                    <span className="font-bold text-slate-800">{parseFloat((movie as any).imdb_rating).toFixed(1)}</span>
                    <span className="text-slate-500 text-sm">/10</span>
                    <span className="text-xs text-amber-700 font-medium ml-1">IMDB</span>
                  </div>
                ) : movie.tmdb_rating ? (
                  <div className="inline-flex items-center gap-2 bg-gradient-to-r from-yellow-50 to-amber-50 px-3 py-1.5 rounded-lg border border-yellow-200/60 shadow-sm">
                    <span className="text-yellow-600 text-sm">🎬</span>
                    <span className="font-bold text-slate-800">{parseFloat(movie.tmdb_rating).toFixed(1)}</span>
                    <span className="text-slate-500 text-sm">/10</span>
                    <span className="text-xs text-yellow-700 font-medium ml-1">TMDB</span>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-50 to-pink-50 px-3 py-1.5 rounded-lg border border-purple-200/60 shadow-sm">
                    <span className="text-purple-600 text-sm">⭐</span>
                    <span className="font-bold text-slate-800">{displayRating}</span>
                    <span className="text-xs text-purple-700 font-medium ml-1">Rating</span>
                  </div>
                )}
                
                {displayYear && (
                  <div className="inline-flex items-center bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200/60 shadow-sm">
                    <span className="text-slate-700 font-medium">{displayYear}</span>
                  </div>
                )}
                
                {/* Enhanced Interactive IMDB Link */}
                {movie.imdb_id && (
                  <a 
                    href={`https://www.imdb.com/title/${movie.imdb_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:from-amber-600 hover:to-orange-600 transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 cursor-pointer border-2 border-transparent hover:border-amber-300/50 active:scale-95"
                  >
                    <span className="text-xs group-hover:animate-pulse">🎬</span>
                    <span className="group-hover:underline">View on IMDB</span>
                    <svg 
                      className="w-3 h-3 ml-0.5 group-hover:translate-x-0.5 transition-transform duration-200" 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                )}
              </div>
            </motion.div>
            
            {/* Age Ratings */}
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-pink-100 p-6"
            >
              <h2 className="text-xl font-light text-slate-800 mb-4 tracking-tight" style={{
                fontFamily: 'system-ui, -apple-system, serif',
              }}>
                <span className="text-transparent bg-gradient-to-r from-pink-600 via-purple-500 to-emerald-500 bg-clip-text">
                  Age-Based Safety Scores
                </span>
              </h2>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {(['24m', '36m', '48m', '60m'] as const).map((age, index) => {
                  const score = (movie.age_scores as any)[age] as number;
                  const ratingType = getAgeRatingType(score);
                  const ratingInfo = AGE_RATING_INFO[ratingType];
                  return (
                    <motion.div 
                      key={age}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.6, delay: 0.5 + index * 0.1 }}
                      className="group p-4 rounded-xl bg-white/80 backdrop-blur-sm border border-pink-100 shadow-md transition-all duration-300 hover:shadow-xl hover:scale-[1.02] hover:border-purple-200"
                    >
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-slate-800 font-semibold text-lg">
                            {age === '24m' ? '2 years' : age === '36m' ? '3 years' : age === '48m' ? '4 years' : '5 years'}
                          </span>
                          <span className="text-xl">{ratingInfo.icon}</span>
                        </div>
                        <div className="flex items-baseline gap-2 mb-2">
                          <span className="text-2xl font-bold text-slate-800">{score}</span>
                          <span className="text-base text-slate-600">/5</span>
                        </div>
                        <p className="text-xs text-slate-600 mb-3 leading-relaxed">
                          {getScoreDescription(score)}
                        </p>
                        <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
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

            {/* Scene Analysis - Mobile Optimized */}
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-pink-100 p-4 sm:p-6"
            >
              <div className="flex flex-col gap-3 mb-4">
                <h2 className="text-lg sm:text-xl font-light text-slate-800 tracking-tight" style={{
                  fontFamily: 'system-ui, -apple-system, serif',
                }}>
                  <span className="text-transparent bg-gradient-to-r from-pink-600 via-purple-500 to-emerald-500 bg-clip-text">
                    Scene Analysis
                  </span>
                </h2>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="inline-flex items-center justify-center px-3 py-1.5 text-xs text-slate-600 bg-purple-100 rounded-lg font-medium border border-purple-200 w-fit">
                    {scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'}
                  </span>
                  <span className="inline-flex items-center justify-center px-3 py-1.5 text-xs text-emerald-700 bg-emerald-100 rounded-lg font-medium border border-emerald-200 w-fit">
                    ✨ Age Recommendations Included
                  </span>
                </div>
              </div>
              {!scenes || scenes.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-3xl mb-3">🎭</div>
                  <p className="text-base text-slate-600">No scenes analyzed yet.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {scenes.map((scene, index) => (
                    <motion.div 
                      key={scene.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.7 + index * 0.1 }}
                      className="group bg-white/80 backdrop-blur-sm p-3 sm:p-4 rounded-xl shadow-md transition-all duration-300 hover:shadow-xl border border-pink-100 hover:border-purple-200"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4 mb-4">
                        <div className="flex items-center gap-3 flex-1">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold text-sm flex-shrink-0">
                            {index + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-base font-semibold text-slate-800">
                              {scene.timestamp_start} - {scene.timestamp_end}
                            </h3>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-slate-600">Intensity:</span>
                              <div className="flex items-center gap-2">
                                <div 
                                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                  style={{
                                    backgroundColor: scene.intensity <= 2 ? '#10b981' : 
                                                   scene.intensity <= 4 ? '#f59e0b' : 
                                                   '#ef4444'
                                  }} 
                                />
                                <span 
                                  className="text-xs font-semibold"
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

                        <div className="w-full sm:w-40">
                          <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
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
                      <div className="relative mb-4">
                        <div 
                          className="absolute left-0 top-0 w-[2px] h-full rounded-full"
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
                        <div className="pl-4">
                          <p className="text-sm text-slate-700 leading-relaxed mb-3">
                            {scene.description}
                          </p>
                          
                          {/* Scene Tags */}
                          {scene.tags && scene.tags.length > 0 && (
                            <div className="mb-3">
                              <div className="flex flex-wrap gap-1.5">
                                {scene.tags.map((tag, tagIndex) => (
                                  <span 
                                    key={tagIndex}
                                    className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full border border-blue-200 font-medium"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {/* Age-specific Recommendations - Mobile Optimized */}
                          {(scene.age_flags || scene.intensity) && (
                            <div className="mt-3">
                              <h4 className="text-xs font-medium text-slate-600 mb-2">Age Recommendations:</h4>
                              <div className="flex flex-wrap gap-2">
                                {Object.entries(scene.age_flags || generateAgeFlags(scene.intensity)).map(([age, flag]) => (
                                  <div 
                                    key={age}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all duration-200 hover:shadow-sm"
                                    style={{
                                      backgroundColor: flag === '✅' ? '#dcfce7' : 
                                                     flag === '⚠️' ? '#fef3c7' : 
                                                     '#fee2e2',
                                      borderColor: flag === '✅' ? '#86efac' : 
                                                  flag === '⚠️' ? '#fbbf24' : 
                                                  '#fca5a5',
                                      color: flag === '✅' ? '#166534' : 
                                            flag === '⚠️' ? '#92400e' : 
                                            '#b91c1c'
                                    }}
                                  >
                                    <span className="text-sm leading-none flex items-center flex-shrink-0">{flag}</span>
                                    <span className="font-medium leading-none whitespace-nowrap">{age === '12m' ? '12m' : age === '24m' ? '2y' : age === '36m' ? '3y' : age === '48m' ? '4y' : '5y'}+</span>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                                <h5 className="text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">Legend:</h5>
                                <div className="flex flex-wrap gap-4 text-xs">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-sm flex-shrink-0">✅</span>
                                    <span className="text-slate-700 font-medium">Safe</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-sm flex-shrink-0">⚠️</span>
                                    <span className="text-slate-700 font-medium">Caution</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-sm flex-shrink-0">🚫</span>
                                    <span className="text-slate-700 font-medium">Skip</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
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