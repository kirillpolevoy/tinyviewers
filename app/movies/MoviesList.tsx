'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { Movie } from '../../types';
import MyListButton from '../components/MyListButton';

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

// Enhanced age recommendation function
function getSmartAgeRecommendation(movie: Movie): { label: string; colorClasses: { bg: string; text: string; border: string }; emoji: string } {
  const scores = movie.age_scores;
  
  if (scores['24m'] <= 2) return { 
    label: "Perfect for 2+", 
    colorClasses: { bg: "bg-emerald-100/90", text: "text-emerald-800", border: "border-emerald-200/50" }, 
    emoji: "✨" 
  };
  if (scores['36m'] <= 2) return { 
    label: "Great for 3+", 
    colorClasses: { bg: "bg-blue-100/90", text: "text-blue-800", border: "border-blue-200/50" }, 
    emoji: "👍" 
  };
  if (scores['48m'] <= 2) return { 
    label: "Good for 4+", 
    colorClasses: { bg: "bg-purple-100/90", text: "text-purple-800", border: "border-purple-200/50" }, 
    emoji: "👌" 
  };
  if (scores['60m'] <= 2) return { 
    label: "Best for 5+", 
    colorClasses: { bg: "bg-pink-100/90", text: "text-pink-800", border: "border-pink-200/50" }, 
    emoji: "🎯" 
  };
  
  return { 
    label: "Check ratings", 
    colorClasses: { bg: "bg-slate-100/90", text: "text-slate-800 dark:text-slate-100", border: "border-slate-200/50" }, 
    emoji: "⚠️" 
  };
}

export default function MoviesList({
  searchQuery,
  categoryFilter,
  ageFilter,
  sortBy = 'title',
  viewMode = 'grid',
  onMoviesLoaded,
}: {
  searchQuery: string | null;
  categoryFilter: string | null;
  ageFilter: string | null;
  sortBy?: string;
  viewMode?: string;
  onMoviesLoaded?: (count: number) => void;
}) {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const fetchMovies = async () => {
      try {
        setLoading(true);
        // Use API route instead of direct Supabase client
        const params = new URLSearchParams();
        if (searchQuery) params.set('search', searchQuery);
        if (ageFilter && ageFilter !== 'all') params.set('age', ageFilter);
        if (sortBy) params.set('sort', sortBy);
        
        const response = await fetch(`/api/movies?${params.toString()}`);
        const result = await response.json();
        
        if (!result.success) {
          throw new Error(result.error || 'API request failed');
        }
        
        const data = result.movies || [];

        console.log('Movies fetched from Supabase:', data);
        console.log('Sample movie ratings:', data?.slice(0, 3).map((m: any) => ({ 
          title: m.title, 
          rating: m.rating, 
          tmdb_rating: m.tmdb_rating,
          rating_type: typeof m.rating,
          tmdb_rating_type: typeof m.tmdb_rating
        })));

        // Apply sorting
        if (data) {
          data.sort((a: any, b: any) => {
            switch (sortBy) {
              case 'rating':
                const getImdbRating = (movie: any) => movie.imdb_rating ? parseFloat(movie.imdb_rating) : null;
                const getTmdbRating = (movie: any) => movie.tmdb_rating ? parseFloat(movie.tmdb_rating) : null;
                const getFallbackRating = (movie: any) => movie.rating ? parseFloat(movie.rating) : null;
                const getValidRating = (movie: any) => {
                  const imdb = getImdbRating(movie);
                  const tmdb = getTmdbRating(movie);
                  const fallback = getFallbackRating(movie);
                  const validImdb = imdb && !isNaN(imdb) && imdb > 0;
                  const validTmdb = tmdb && !isNaN(tmdb) && tmdb > 0;
                  const validFallback = fallback && !isNaN(fallback) && fallback > 0;
                  // Priority: IMDB > TMDB > Fallback
                  return validImdb ? imdb : (validTmdb ? tmdb : (validFallback ? fallback : 0));
                };
                const ratingA = getValidRating(a);
                const ratingB = getValidRating(b);
                return ratingB - ratingA; // Highest first
              case 'year':
                const yearA = a.release_year || extractYearFromTitle(a.title) || 0;
                const yearB = b.release_year || extractYearFromTitle(b.title) || 0;
                return yearB - yearA; // Newest first
              case 'age':
                // Sort by youngest recommended age first
                const getMinAge = (movie: Movie) => {
                  const scores = movie.age_scores;
                  if (scores['24m'] <= 2) return 2;
                  if (scores['36m'] <= 2) return 3;
                  if (scores['48m'] <= 2) return 4;
                  if (scores['60m'] <= 2) return 5;
                  return 6; // Fallback for movies with no good age match
                };
                return getMinAge(a) - getMinAge(b);
              case 'title':
              default:
                return a.title.localeCompare(b.title);
            }
          });
        }
        
        console.log('Final movies:', data);
        setMovies(data || []);
        
        // Notify parent of the total count
        if (onMoviesLoaded) {
          onMoviesLoaded(data?.length || 0);
        }
      } catch (e) {
        console.error('Exception:', e);
        setError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    if (mounted) {
      fetchMovies();
    }
  }, [searchQuery, categoryFilter, ageFilter, sortBy, mounted]);

  // Don't render anything until client-side hydration is complete
  if (!mounted) {
    return null;
  }

  if (error) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="text-center py-16"
      >
        <div className="text-5xl mb-6">😞</div>
        <h2 className="text-3xl font-light text-red-600 mb-6 tracking-tight" style={{
          fontFamily: 'system-ui, -apple-system, serif',
        }}>Unable to Load Movies</h2>
        <p className="text-red-500 text-lg mb-8">{error}</p>
        <div className="max-w-md mx-auto p-6 bg-red-50/80 backdrop-blur-sm rounded-2xl border border-red-200">
          <h3 className="text-lg font-semibold mb-4 text-red-800">Debug Information</h3>
          <div className="space-y-2 text-sm text-red-700">
            <p>Search Query: {searchQuery || 'none'}</p>
            <p>Category: {categoryFilter || 'none'}</p>
            <p>Age: {ageFilter || 'none'}</p>
            <p>Sort: {sortBy || 'none'}</p>
          </div>
        </div>
      </motion.div>
    );
  }

  if (loading) {
    return (
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex justify-center items-center min-h-[400px]"
      >
        <div className="text-center">
          <div className="text-4xl mb-6 animate-bounce">🎬</div>
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-purple-200 border-t-purple-600 mb-4"></div>
          <p className="text-xl text-slate-600 dark:text-slate-300 font-medium">Loading movies...</p>
        </div>
      </motion.div>
    );
  }

  if (movies.length === 0) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="text-center py-16"
      >
        <div className="text-6xl mb-6">🎭</div>
        <h2 className="text-3xl font-light text-slate-800 dark:text-slate-100 mb-6 tracking-tight" style={{
          fontFamily: 'system-ui, -apple-system, serif',
        }}>No Movies Found</h2>
        <div className="text-lg text-slate-600 dark:text-slate-300 space-y-1 mb-8">
          <p>We couldn't find any movies matching your criteria.</p>
          {searchQuery && <p className="font-semibold">Search: "{searchQuery}"</p>}
          {ageFilter && <p className="font-semibold">Age: {ageFilter}+ years</p>}
        </div>
        <Link 
          href="/movies"
          className="inline-flex items-center gap-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white px-6 py-3 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 font-medium"
        >
          Clear filters & browse all →
        </Link>
      </motion.div>
    );
  }

  // Render different layouts based on view mode
  if (viewMode === 'list') {
    return (
      <div className="space-y-4">
        {movies.map((movie, index) => {
          const movieUrl = `/movies/${movie.id}${searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : ''}`;
          const posterUrl = movie.tmdb_poster_url || movie.poster_url;
          
          // Enhanced rating display with source information - IMDB prioritized
          const imdbRating = (movie as any).imdb_rating ? parseFloat((movie as any).imdb_rating) : null;
          const tmdbRating = movie.tmdb_rating ? parseFloat(movie.tmdb_rating) : null;
          const fallbackRating = movie.rating ? parseFloat(movie.rating) : null;
          const hasValidImdbRating = imdbRating && !isNaN(imdbRating) && imdbRating > 0;
          const hasValidTmdbRating = tmdbRating && !isNaN(tmdbRating) && tmdbRating > 0;
          const hasValidFallbackRating = fallbackRating && !isNaN(fallbackRating) && fallbackRating > 0;
          // Priority: IMDB > TMDB > Fallback
          const displayRating = hasValidImdbRating ? imdbRating : (hasValidTmdbRating ? tmdbRating : (hasValidFallbackRating ? fallbackRating : null));
          const ratingSource = hasValidImdbRating ? 'IMDB' : (hasValidTmdbRating ? 'TMDB' : 'Rating');
          const ratingColor = hasValidImdbRating ? 'text-orange-600' : (hasValidTmdbRating ? 'text-yellow-600' : 'text-amber-600');
          const ratingBg = hasValidImdbRating ? 'bg-orange-50 border-orange-200' : (hasValidTmdbRating ? 'bg-yellow-50 border-yellow-200' : 'bg-amber-50 border-amber-200');
          
          const { displayTitle, displayYear } = formatTitleWithYear(movie.title, movie.release_year);
          const ageRec = getSmartAgeRecommendation(movie);
          
          return (
            <motion.div
              key={movie.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: index * 0.02 }}
            >
              <Link href={movieUrl} className="group block">
                <div className="bg-white/90 backdrop-blur-sm rounded-2xl overflow-hidden shadow-md border border-pink-100 hover:shadow-xl hover:border-purple-200 transition-all duration-300 hover:scale-[1.01]">
                  <div className="flex gap-4 p-4 sm:p-6">
                    {/* Poster */}
                    <div className="relative w-20 h-28 sm:w-24 sm:h-32 flex-shrink-0 rounded-xl overflow-hidden">
                      {posterUrl && !posterUrl.includes('example.com') ? (
                        <Image
                          src={posterUrl}
                          alt={movie.title}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                          sizes="(max-width: 640px) 80px, 96px"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-pink-100 to-purple-100 flex items-center justify-center">
                          <span className="text-2xl">🎬</span>
                        </div>
                      )}
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
                        <div className="flex-1 min-w-0">
                          <h2 className="text-lg sm:text-xl font-semibold text-slate-800 dark:text-slate-100 group-hover:text-purple-700 transition-colors duration-300 truncate">
                            {displayTitle}
                          </h2>
                          {displayYear && (
                            <p className="text-sm text-slate-500 dark:text-slate-400 dark:text-slate-500">{displayYear}</p>
                          )}
                        </div>
                        
                                                 <div className="flex items-center gap-2 flex-shrink-0">
                           <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${ageRec.colorClasses.bg} ${ageRec.colorClasses.text} border ${ageRec.colorClasses.border}`}>
                             <span>{ageRec.emoji}</span>
                             <span>{ageRec.label}</span>
                           </span>
                          {displayRating && displayRating > 0 ? (
                            <span className={`px-3 py-1 rounded-full text-sm font-medium ${ratingBg} ${ratingColor} border`}>
                              {hasValidImdbRating ? '📽️' : (hasValidTmdbRating ? '🎬' : '⭐')} {displayRating.toFixed(1)}
                              <span className="text-xs ml-1 opacity-75">{ratingSource}</span>
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400 dark:text-slate-500 px-3 py-1">No Rating</span>
                          )}
                        </div>
                      </div>
                      
                      <div className="text-sm text-slate-600 dark:text-slate-300">
                        <p>Click to view detailed age analysis and content breakdown</p>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>
    );
  }

  // Default grid view with enhanced cards
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 sm:gap-6">
      {movies.map((movie, index) => {
        const movieUrl = `/movies/${movie.id}${searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : ''}${categoryFilter ? `&category=${encodeURIComponent(categoryFilter)}` : ''}${ageFilter ? `&age=${encodeURIComponent(ageFilter)}` : ''}`;
        
        // Use TMDB poster if available, fallback to original poster
        const posterUrl = movie.tmdb_poster_url || movie.poster_url;
        
        // Enhanced rating display with source information - IMDB prioritized
        const imdbRating = (movie as any).imdb_rating ? parseFloat((movie as any).imdb_rating) : null;
        const tmdbRating = movie.tmdb_rating ? parseFloat(movie.tmdb_rating) : null;
        const fallbackRating = movie.rating ? parseFloat(movie.rating) : null;
        const hasValidImdbRating = imdbRating && !isNaN(imdbRating) && imdbRating > 0;
        const hasValidTmdbRating = tmdbRating && !isNaN(tmdbRating) && tmdbRating > 0;
        const hasValidFallbackRating = fallbackRating && !isNaN(fallbackRating) && fallbackRating > 0;
        // Priority: IMDB > TMDB > Fallback
        const displayRating = hasValidImdbRating ? imdbRating : (hasValidTmdbRating ? tmdbRating : (hasValidFallbackRating ? fallbackRating : null));
        const ratingSource = hasValidImdbRating ? 'IMDB' : (hasValidTmdbRating ? 'TMDB' : 'Rating');
        const ratingColor = hasValidImdbRating ? 'text-orange-600' : (hasValidTmdbRating ? 'text-yellow-600' : 'text-amber-600');
        const ratingBg = hasValidImdbRating ? 'bg-orange-50 border-orange-200' : (hasValidTmdbRating ? 'bg-yellow-50 border-yellow-200' : 'bg-amber-50 border-amber-200');
        
        // Format title with year
        const { displayTitle, displayYear } = formatTitleWithYear(movie.title, movie.release_year);
        
        // Get smart age recommendation
        const ageRec = getSmartAgeRecommendation(movie);
        
        return (
          <motion.div
            key={movie.id}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.5, delay: index * 0.03, ease: "easeOut" }}
          >
            <Link 
              href={movieUrl}
              className="group block h-full"
            >
              <div className="bg-white/90 backdrop-blur-sm rounded-2xl overflow-hidden shadow-lg border border-pink-100 hover:shadow-2xl hover:border-purple-200 transition-all duration-500 hover:scale-[1.02] hover:-translate-y-2 h-full flex flex-col">
                {/* Poster Section */}
                <div className="relative aspect-[3/4] overflow-hidden">
                  {posterUrl && !posterUrl.includes('example.com') ? (
                    <Image
                      src={posterUrl}
                      alt={movie.title}
                      fill
                      className="object-cover object-center group-hover:scale-110 transition-transform duration-700"
                      sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, (max-width: 1280px) 30vw, (max-width: 1536px) 22vw, 18vw"
                      priority={index < 8}
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-pink-100 via-purple-100 to-blue-100 flex items-center justify-center">
                      <div className="text-center p-4">
                        <div className="text-4xl mb-3">🎬</div>
                        <p className="text-sm text-slate-600 dark:text-slate-300 font-medium leading-tight px-2">{displayTitle}</p>
                        {displayYear && <p className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500 mt-1">{displayYear}</p>}
                      </div>
                    </div>
                  )}
                  
                  {/* Gradient Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                                     {/* Age Recommendation Badge */}
                   <div className="absolute top-3 right-3">
                     <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold backdrop-blur-sm ${ageRec.colorClasses.bg} ${ageRec.colorClasses.text} border ${ageRec.colorClasses.border} shadow-sm`}>
                       <span>{ageRec.emoji}</span>
                       <span className="text-xs">{ageRec.label}</span>
                     </span>
                   </div>
                </div>
                
                {/* Content Section */}
                <div className="p-4 sm:p-5 flex-1 flex flex-col">
                  <div className="flex-1 flex flex-col">
                    <div className="flex items-start gap-2 mb-2 min-h-[3rem]">
                      <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100 group-hover:text-purple-700 transition-colors duration-300 line-clamp-2 leading-tight flex-1" title={movie.title}>
                        {displayTitle}
                      </h2>
                      <div className="flex-shrink-0 mt-1 opacity-70 hover:opacity-100 transition-opacity duration-200">
                        <MyListButton 
                          movieId={movie.id} 
                          movieTitle={displayTitle} 
                          variant="minimal" 
                          size="sm" 
                          showText={false}
                        />
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between mb-4 mt-auto">
                      {displayYear && (
                        <span className="text-sm text-slate-500 dark:text-slate-400 dark:text-slate-500 font-medium">{displayYear}</span>
                      )}
                      {displayRating && displayRating > 0 ? (
                        <span className={`flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-semibold ${ratingBg} ${ratingColor} border`}>
                          <span>{hasValidImdbRating ? '📽️' : (hasValidTmdbRating ? '🎬' : '⭐')}</span>
                          <span>{displayRating.toFixed(1)}</span>
                          <span className="text-xs opacity-75">{ratingSource}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-slate-500 px-2 py-1">No Rating</span>
                      )}
                    </div>
                  </div>
                  
                  {/* CTA Button */}
                  <button className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 px-4 rounded-xl font-semibold text-sm shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-300 group-hover:from-purple-600 group-hover:to-pink-600">
                    View Analysis
                  </button>
                </div>
              </div>
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
} 