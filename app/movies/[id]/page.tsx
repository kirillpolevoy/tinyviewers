'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { supabase } from '../../../lib/supabase';
import { Movie, Scene, AgeFlag } from '../../../types';

import AuthButtonSimple from '../../components/AuthButtonSimple';
import MyListButton from '../../components/MyListButton';
import UnifiedAnalysisManager from '../../components/UnifiedAnalysisManager';
import KeyboardShortcuts from '../../components/KeyboardShortcuts';

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



  const backUrl = searchParams?.get('search') 
    ? `/movies?search=${searchParams.get('search')}${searchParams.get('category') ? `&category=${searchParams.get('category')}` : ''}${searchParams.get('age') ? `&age=${searchParams.get('age')}` : ''}`
    : '/movies';

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const fetchMovieAndScenes = async () => {
      try {
        const response = await fetch(`/api/movies/movie?id=${params.id}`);
        const result = await response.json();

        if (!result.success) {
          setError(result.error || 'Failed to fetch movie');
          return;
        }

        setMovie(result.movie);
        setScenes(result.scenes || []);
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
        <header className="sticky top-0 z-50 backdrop-blur-xl bg-white/95 shadow-sm border-b border-slate-200/60">
          <div className="mx-auto max-w-7xl flex items-center justify-between px-4 sm:px-6 py-4">
            <Link href="/" className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-3 hover:scale-105 transition-transform duration-300">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <span className="text-white text-lg">🧸</span>
              </div>
              <span className="text-slate-800">Tiny Viewers</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm font-medium">
              <AuthButtonSimple />
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
        <header className="sticky top-0 z-50 backdrop-blur-xl bg-white/95 shadow-sm border-b border-slate-200/60">
          <div className="mx-auto max-w-7xl flex items-center justify-between px-4 sm:px-6 py-4">
            <Link href="/" className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-3 hover:scale-105 transition-transform duration-300">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <span className="text-white text-lg">🧸</span>
              </div>
              <span className="text-slate-800">Tiny Viewers</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm font-medium">
              <AuthButtonSimple />
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 relative">
      {/* Whimsical Floating Elements */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.div
          animate={{ 
            y: [0, -20, 0],
            rotate: [0, 5, 0]
          }}
          transition={{ 
            duration: 6,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          className="absolute top-20 left-10 text-2xl opacity-20"
        >
          ✨
        </motion.div>
        <motion.div
          animate={{ 
            y: [0, 15, 0],
            rotate: [0, -3, 0]
          }}
          transition={{ 
            duration: 8,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 1
          }}
          className="absolute top-40 right-16 text-xl opacity-15"
        >
          🎬
        </motion.div>
        <motion.div
          animate={{ 
            y: [0, -10, 0],
            x: [0, 5, 0]
          }}
          transition={{ 
            duration: 7,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 2
          }}
          className="absolute top-60 left-1/4 text-lg opacity-10"
        >
          🎭
        </motion.div>
        <motion.div
          animate={{ 
            y: [0, 12, 0],
            rotate: [0, 4, 0]
          }}
          transition={{ 
            duration: 9,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 3
          }}
          className="absolute top-80 right-1/3 text-xl opacity-12"
        >
          🎪
        </motion.div>
      </div>

      {/* Keyboard Shortcuts */}
      <KeyboardShortcuts 
        onRerunAnalysis={() => {
          const rerunButton = document.querySelector('[data-rerun-analysis]') as HTMLButtonElement;
          if (rerunButton) rerunButton.click();
        }}
        onToggleHistory={() => {
          const historyButton = document.querySelector('[data-analysis-history]') as HTMLButtonElement;
          if (historyButton) historyButton.click();
        }}
        onToggleSuggestions={() => {}}
      />
      
      {/* Whimsical Apple-style Navigation */}
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-xl border-b border-gray-200/60 shadow-sm">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-4 sm:px-6 py-4">
          <Link href="/" className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-3 hover:scale-105 transition-transform duration-300">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <span className="text-white text-lg">🧸</span>
            </div>
            <span className="text-slate-800">Tiny Viewers</span>
          </Link>
          <div className="flex items-center gap-4">
            <AuthButtonSimple />
          </div>
        </div>
      </nav>

      {/* Apple-style Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        {/* Mobile-optimized Back Navigation */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-4 sm:mb-8"
        >
          <Link 
            href={backUrl}
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-all duration-300 text-sm font-medium group"
          >
            <motion.span 
              className="text-lg group-hover:-translate-x-1 transition-transform duration-200"
              whileHover={{ scale: 1.2 }}
            >
              ←
            </motion.span>
            <motion.span
              whileHover={{ scale: 1.05 }}
            >
              Back to Movies
            </motion.span>
            <motion.span
              className="opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
            >
              🎬
            </motion.span>
          </Link>
        </motion.div>
        
        {/* Apple-style Layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 sm:gap-8">
          {/* Whimsical Floating Movie Poster */}
          <motion.div 
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="lg:sticky lg:top-32 lg:self-start"
          >
            <div className="relative aspect-[2/3] overflow-hidden rounded-xl sm:rounded-2xl shadow-lg sm:shadow-xl bg-white border border-gray-200/60 hover:shadow-xl sm:hover:shadow-2xl transition-all duration-500 group max-w-[200px] sm:max-w-none mx-auto lg:mx-0">
              {/* Magical Border Glow */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-blue-400/20 via-purple-400/20 to-pink-400/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              
              {/* Floating Sparkles */}
              <div className="absolute inset-0 pointer-events-none">
                <motion.div
                  animate={{ 
                    y: [0, -10, 0],
                    opacity: [0, 1, 0]
                  }}
                  transition={{ 
                    duration: 3,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: 0
                  }}
                  className="absolute top-4 right-4 text-lg"
                >
                  ✨
                </motion.div>
                <motion.div
                  animate={{ 
                    y: [0, -8, 0],
                    opacity: [0, 1, 0]
                  }}
                  transition={{ 
                    duration: 4,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: 1
                  }}
                  className="absolute bottom-6 left-4 text-sm"
                >
                  🌟
                </motion.div>
              </div>
              {(posterUrl && !posterUrl.includes('example.com')) ? (
                <Image
                  src={posterUrl}
                  alt={movie.title}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-500"
                  sizes="(max-width: 1024px) 350px, 350px"
                  priority
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                  <div className="text-center p-6">
                    <div className="text-6xl mb-4">🎬</div>
                    <p className="text-lg text-slate-600 font-medium">{movie.title}</p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
          
          {/* Apple-style Movie Details */}
          <div className="space-y-8">
            {/* Mobile-optimized Movie Header */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.2 }}
              className="bg-white/95 backdrop-blur-sm rounded-xl sm:rounded-2xl shadow-lg border border-gray-200/60 p-4 sm:p-8 relative overflow-hidden"
            >
              {/* Playful Background Pattern */}
              <div className="absolute inset-0 opacity-5">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                  className="absolute top-4 right-4 text-4xl"
                >
                  🎭
                </motion.div>
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute bottom-4 left-4 text-2xl"
                >
                  🎪
                </motion.div>
              </div>
              
              <div className="text-center mb-8 relative z-10">
                <motion.h1 
                  className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 mb-2 sm:mb-3 tracking-tight"
                  whileHover={{ scale: 1.02 }}
                >
                  {displayTitle}
                </motion.h1>
                <motion.div 
                  className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-100 to-purple-100 px-4 py-2 rounded-full border border-blue-200/60"
                  whileHover={{ scale: 1.05 }}
                >
                  <motion.span 
                    className="text-gray-600"
                    animate={{ rotate: [0, 10, -10, 0] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  >
                    📅
                  </motion.span>
                  <span className="text-sm text-gray-700 font-medium">{movie.release_year}</span>
                </motion.div>
              </div>

              {/* Mobile-optimized Analysis Management */}
              <div className="flex justify-center mb-4 sm:mb-8 relative z-10">
                <MyListButton 
                  movieId={movie.id} 
                  movieTitle={displayTitle} 
                  variant="minimal" 
                  size="sm" 
                  showText={true}
                />
              </div>
              
              {/* Floating Analysis Manager */}
              <UnifiedAnalysisManager
                movieId={movie.id}
                movieTitle={displayTitle}
                currentScores={movie.age_scores}
                onAnalysisComplete={() => {
                  window.location.reload();
                }}
              />
              <div className="text-center">
                <motion.div 
                  className="bg-gradient-to-r from-blue-50 via-purple-50 to-pink-50 p-4 sm:p-6 rounded-xl mb-4 sm:mb-6 border border-gray-200/60 relative overflow-hidden"
                  whileHover={{ scale: 1.01 }}
                >
                  {/* Subtle floating elements */}
                  <div className="absolute inset-0 pointer-events-none">
                    <motion.div
                      animate={{ 
                        y: [0, -5, 0],
                        opacity: [0.3, 0.6, 0.3]
                      }}
                      transition={{ 
                        duration: 5,
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                      className="absolute top-2 right-2 text-sm"
                    >
                      📖
                    </motion.div>
                  </div>
                  <p className="text-gray-700 leading-relaxed text-base relative z-10">
                    {description}
                  </p>
                </motion.div>
                
                <div className="flex items-center justify-center gap-4 flex-wrap">
                  {(movie as any).imdb_rating ? (
                    <motion.div 
                      className="inline-flex items-center gap-2 sm:gap-3 bg-gradient-to-r from-amber-50 to-orange-50 px-3 sm:px-5 py-3 sm:py-4 rounded-lg sm:rounded-xl border border-amber-200/60 shadow-sm hover:shadow-lg transition-all duration-300 h-12 sm:h-16"
                      whileHover={{ scale: 1.05, rotate: 1 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <motion.span 
                        className="text-xl"
                        animate={{ rotate: [0, 5, -5, 0] }}
                        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                      >
                        📽️
                      </motion.span>
                      <div>
                        <div className="font-bold text-gray-900 text-lg">{parseFloat((movie as any).imdb_rating).toFixed(1)}</div>
                        <div className="text-amber-700 text-xs font-medium">IMDB</div>
                      </div>
                    </motion.div>
                  ) : movie.tmdb_rating ? (
                    <motion.div 
                      className="inline-flex items-center gap-2 sm:gap-3 bg-gradient-to-r from-blue-50 to-indigo-50 px-3 sm:px-5 py-3 sm:py-4 rounded-lg sm:rounded-xl border border-blue-200/60 shadow-sm hover:shadow-lg transition-all duration-300 h-12 sm:h-16"
                      whileHover={{ scale: 1.05, rotate: 1 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <motion.span 
                        className="text-xl"
                        animate={{ rotate: [0, -5, 5, 0] }}
                        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                      >
                        🎬
                      </motion.span>
                      <div>
                        <div className="font-bold text-gray-900 text-lg">{parseFloat(movie.tmdb_rating).toFixed(1)}</div>
                        <div className="text-blue-700 text-xs font-medium">TMDB</div>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div 
                      className="inline-flex items-center gap-2 sm:gap-3 bg-gradient-to-r from-purple-50 to-pink-50 px-3 sm:px-5 py-3 sm:py-4 rounded-lg sm:rounded-xl border border-purple-200/60 shadow-sm hover:shadow-lg transition-all duration-300 h-12 sm:h-16"
                      whileHover={{ scale: 1.05, rotate: 1 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <motion.span 
                        className="text-xl"
                        animate={{ scale: [1, 1.1, 1] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      >
                        ⭐
                      </motion.span>
                      <div>
                        <div className="font-bold text-gray-900 text-lg">{displayRating}</div>
                        <div className="text-purple-700 text-xs font-medium">Rating</div>
                      </div>
                    </motion.div>
                  )}
                  
                  <motion.div 
                    className="inline-flex items-center gap-2 sm:gap-3 bg-gradient-to-r from-gray-50 to-slate-50 px-3 sm:px-5 py-3 sm:py-4 rounded-lg sm:rounded-xl border border-gray-200/60 shadow-sm hover:shadow-lg transition-all duration-300 h-12 sm:h-16"
                    whileHover={{ scale: 1.05, rotate: 1 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <motion.span 
                      className="text-xl"
                      animate={{ rotate: [0, 10, -10, 0] }}
                      transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                    >
                      📅
                    </motion.span>
                    <div>
                      <div className="font-bold text-gray-900 text-lg">{movie.release_year}</div>
                      <div className="text-gray-600 text-xs font-medium">Year</div>
                    </div>
                  </motion.div>
                  
                  {movie.imdb_id && (
                    <motion.a 
                      href={`https://www.imdb.com/title/${movie.imdb_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 sm:gap-3 bg-gradient-to-r from-orange-500 to-red-500 text-white px-3 sm:px-5 py-3 sm:py-4 rounded-lg sm:rounded-xl hover:from-orange-600 hover:to-red-600 transition-all duration-300 font-medium shadow-sm hover:shadow-lg h-12 sm:h-16"
                      whileHover={{ scale: 1.05, rotate: 1 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <motion.span 
                        className="text-xl"
                        animate={{ rotate: [0, 15, -15, 0] }}
                        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                      >
                        🎬
                      </motion.span>
                      <span className="text-sm">View on IMDB</span>
                      <motion.span 
                        className="text-sm"
                        animate={{ x: [0, 3, 0] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      >
                        ↗
                      </motion.span>
                    </motion.a>
                  )}
                </div>
              </div>
            </motion.div>
            
            {/* Mobile-optimized Age Safety Guide */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.3 }}
              className="bg-white/95 backdrop-blur-sm rounded-xl sm:rounded-2xl shadow-lg border border-gray-200/60 p-4 sm:p-8 relative overflow-hidden"
            >
              {/* Magical Background Elements */}
              <div className="absolute inset-0 opacity-5">
                <motion.div
                  animate={{ 
                    y: [0, -15, 0],
                    rotate: [0, 180, 360]
                  }}
                  transition={{ 
                    duration: 8,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                  className="absolute top-6 right-6 text-3xl"
                >
                  🛡️
                </motion.div>
                <motion.div
                  animate={{ 
                    scale: [1, 1.3, 1],
                    opacity: [0.3, 0.7, 0.3]
                  }}
                  transition={{ 
                    duration: 6,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                  className="absolute bottom-6 left-6 text-2xl"
                >
                  👶
                </motion.div>
              </div>
              
              <div className="text-center mb-8 relative z-10">
                <motion.h2 
                  className="text-2xl font-bold text-gray-900 mb-3"
                  whileHover={{ scale: 1.02 }}
                >
                  🛡️ Age Safety Guide
                </motion.h2>
                <motion.p 
                  className="text-gray-600 text-base"
                  whileHover={{ scale: 1.01 }}
                >
                  How appropriate is this movie for different ages?
                </motion.p>
              </div>
              
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
                {(['24m', '36m', '48m', '60m'] as const).map((age, index) => {
                  const score = (movie.age_scores as any)[age] as number;
                  const ratingType = getAgeRatingType(score);
                  const ratingInfo = AGE_RATING_INFO[ratingType];
                  const ageLabel = age === '24m' ? '2 years' : age === '36m' ? '3 years' : age === '48m' ? '4 years' : '5 years';
                  
                  return (
                    <motion.div 
                      key={age}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: 0.4 + index * 0.1 }}
                      className="flex flex-col text-center p-3 sm:p-6 rounded-lg sm:rounded-xl bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200/60 hover:shadow-xl transition-all duration-500 group relative overflow-hidden"
                      whileHover={{ scale: 1.05, rotate: 1 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      {/* Floating sparkles */}
                      <div className="absolute inset-0 pointer-events-none">
                        <motion.div
                          animate={{ 
                            y: [0, -8, 0],
                            opacity: [0, 1, 0]
                          }}
                          transition={{ 
                            duration: 3,
                            repeat: Infinity,
                            ease: "easeInOut",
                            delay: index * 0.5
                          }}
                          className="absolute top-2 right-2 text-sm"
                        >
                          ✨
                        </motion.div>
                      </div>
                      
                      {/* Top section with icon and age */}
                      <div className="mb-4">
                        <motion.div 
                          className="text-3xl mb-2 group-hover:scale-110 transition-transform duration-300"
                          animate={{ 
                            rotate: [0, 5, -5, 0],
                            scale: [1, 1.05, 1]
                          }}
                          transition={{ 
                            duration: 4 + index,
                            repeat: Infinity,
                            ease: "easeInOut"
                          }}
                        >
                          {ratingInfo.icon}
                        </motion.div>
                        <div className="text-base font-semibold text-gray-900">{ageLabel}</div>
                      </div>
                      
                      {/* Middle section with score */}
                      <div className="mb-3">
                        <div className="text-2xl font-bold text-gray-900">{score}/5</div>
                        <div className="text-sm text-gray-600 mt-1">{getScoreDescription(score)}</div>
                      </div>
                      
                      {/* Bottom section with progress bar - aligned */}
                      <div className="mt-auto">
                        <div className="h-3 w-full bg-gray-200 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${(score / 5) * 100}%` }}
                            transition={{ duration: 0.8, delay: 0.9 + index * 0.1 }}
                            className={`h-full bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 rounded-full`}
                          />
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>

            {/* Whimsical Scene Analysis */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.4 }}
              className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/60 p-8 relative overflow-hidden"
            >
              {/* Playful Background Elements */}
              <div className="absolute inset-0 opacity-5">
                <motion.div
                  animate={{ 
                    y: [0, -12, 0],
                    rotate: [0, 90, 180, 270, 360]
                  }}
                  transition={{ 
                    duration: 10,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                  className="absolute top-4 right-4 text-2xl"
                >
                  🎭
                </motion.div>
                <motion.div
                  animate={{ 
                    scale: [1, 1.2, 1],
                    opacity: [0.2, 0.6, 0.2]
                  }}
                  transition={{ 
                    duration: 5,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                  className="absolute bottom-4 left-4 text-xl"
                >
                  🎬
                </motion.div>
              </div>
              
              <div className="flex flex-col gap-3 mb-6 relative z-10">
                <motion.h2 
                  className="text-2xl font-bold text-gray-900"
                  whileHover={{ scale: 1.02 }}
                >
                  Scene Analysis
                </motion.h2>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <motion.span 
                    className="inline-flex items-center justify-center px-3 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg font-medium w-fit"
                    whileHover={{ scale: 1.05 }}
                  >
                    {scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'}
                  </motion.span>
                  <motion.span 
                    className="inline-flex items-center justify-center px-3 py-2 text-sm text-emerald-700 bg-emerald-100 rounded-lg font-medium w-fit"
                    whileHover={{ scale: 1.05 }}
                  >
                    ✨ Age Recommendations Included
                  </motion.span>
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
                      transition={{ duration: 0.4, delay: 0.5 + index * 0.1 }}
                      className="group bg-gradient-to-r from-gray-50 to-blue-50 p-5 rounded-xl shadow-sm transition-all duration-500 hover:shadow-lg border border-gray-200/60 relative overflow-hidden"
                      whileHover={{ scale: 1.02, rotate: 0.5 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      {/* Subtle floating elements */}
                      <div className="absolute inset-0 pointer-events-none">
                        <motion.div
                          animate={{ 
                            y: [0, -6, 0],
                            opacity: [0, 0.3, 0]
                          }}
                          transition={{ 
                            duration: 4,
                            repeat: Infinity,
                            ease: "easeInOut",
                            delay: index * 0.3
                          }}
                          className="absolute top-2 right-2 text-sm"
                        >
                          🎬
                        </motion.div>
                      </div>
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
                                    <span className="font-medium leading-none whitespace-nowrap">{age === '24m' ? '2y' : age === '36m' ? '3y' : age === '48m' ? '4y' : '5y'}+</span>
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


    </div>
  );
};

export default MovieDetailsPage; 