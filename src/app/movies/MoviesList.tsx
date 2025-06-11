'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { Movie } from '@/types';

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

export default function MoviesList({
  searchQuery,
  categoryFilter,
  ageFilter,
}: {
  searchQuery: string | null;
  categoryFilter: string | null;
  ageFilter: string | null;
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
        console.log('MoviesList - Received search params:', { searchQuery, categoryFilter, ageFilter });
        console.log('Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
        console.log('Supabase Key set:', !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
        
        let query = supabase.from('movies').select('*');

        if (searchQuery) {
          console.log('Applying search filter for:', searchQuery);
          query = query.ilike('title', `%${searchQuery}%`);
        }

        if (categoryFilter) {
          query = query.eq('category', categoryFilter);
        }

        if (ageFilter) {
          const ageNumber = parseInt(ageFilter);
          if (!isNaN(ageNumber)) {
            query = query.lte(`age_scores->${ageFilter}`, 3);
          }
        }

        const { data, error: dbError } = await query;
        
        if (dbError) {
          console.error('Supabase error:', dbError);
          setError(`Database error: ${dbError.message}`);
          return;
        }

        console.log('Movies fetched from Supabase:', data);

        // Sort alphabetically when no search query (for "View All")
        if (!searchQuery) {
          data?.sort((a, b) => a.title.localeCompare(b.title));
        }
        
        console.log('Final movies:', data);
        setMovies(data || []);
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
  }, [searchQuery, categoryFilter, ageFilter, mounted]);

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
          <p className="text-xl text-slate-600 font-medium">Loading movies...</p>
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
        <h2 className="text-3xl font-light text-slate-800 mb-6 tracking-tight" style={{
          fontFamily: 'system-ui, -apple-system, serif',
        }}>No Movies Found</h2>
        <div className="text-lg text-slate-600 space-y-1 mb-8">
          <p>We couldn't find any movies matching your search.</p>
          {searchQuery && <p className="font-semibold">Query: "{searchQuery}"</p>}
        </div>
        <Link 
          href="/"
          className="inline-flex items-center gap-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white px-6 py-3 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 font-medium"
        >
          Try a different search →
        </Link>
      </motion.div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 md:gap-6">
      {movies.map((movie, index) => {
        const movieUrl = `/movies/${movie.id}${searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : ''}${categoryFilter ? `&category=${encodeURIComponent(categoryFilter)}` : ''}${ageFilter ? `&age=${encodeURIComponent(ageFilter)}` : ''}`;
        
        // Use TMDB poster if available, fallback to original poster
        const posterUrl = movie.tmdb_poster_url || movie.poster_url;
        // Use TMDB rating if available, fallback to original rating
        const displayRating = movie.tmdb_rating || movie.rating;
        
        // Format title with year
        const { displayTitle, displayYear } = formatTitleWithYear(movie.title, movie.release_year);
        
        const getAgeFlag = (movie: Movie) => {
          const scores = movie.age_scores;
          
          // Handle both old and new age structures
          if ((scores as any)['48m'] !== undefined && (scores as any)['60m'] !== undefined) {
            // New structure: 24m/36m/48m/60m
            if (scores['24m'] <= 2) return "✅ 2y+";
            if (scores['36m'] <= 2) return "⚠️ 2y | ✅ 3y+";
            if ((scores as any)['48m'] <= 2) return "⚠️ 3y | ✅ 4y+";
            if ((scores as any)['60m'] <= 2) return "⚠️ 4y | ✅ 5y+";
          } else {
            // Old structure: 12m/24m/36m - map to new labels
            if ((scores as any)['12m'] <= 2) return "✅ 1y+";
            if (scores['24m'] <= 2) return "⚠️ 1y | ✅ 2y+";
            if (scores['36m'] <= 2) return "⚠️ 2y | ✅ 3y+";
          }
          
          return "⚠️ Check age ratings";
        };
        
        return (
          <motion.div
            key={movie.id}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.5, delay: index * 0.05, ease: "easeOut" }}
          >
            <Link 
              href={movieUrl}
              className="group block"
            >
              <div className="bg-white/90 backdrop-blur-sm rounded-2xl overflow-hidden shadow-lg border border-pink-100 hover:shadow-2xl hover:border-purple-200 transition-all duration-500 hover:scale-[1.02] hover:-translate-y-1 w-full max-w-sm mx-auto sm:max-w-none">
                <div className="relative aspect-[3/4] overflow-hidden flex items-center justify-center">
                  {posterUrl && !posterUrl.includes('example.com') ? (
                    <Image
                      src={posterUrl}
                      alt={movie.title}
                      fill
                      className="object-cover object-center group-hover:scale-105 transition-transform duration-500"
                      sizes="(max-width: 640px) 90vw, (max-width: 768px) 45vw, (max-width: 1024px) 30vw, (max-width: 1280px) 22vw, 18vw"
                      priority
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-pink-100 via-purple-100 to-blue-100 flex items-center justify-center">
                      <div className="text-center p-3 sm:p-4">
                        <div className="text-3xl sm:text-4xl mb-2">🎬</div>
                        <p className="text-xs sm:text-sm text-slate-600 font-medium leading-tight px-2">{displayTitle}</p>
                        {displayYear && <p className="text-xs text-slate-500 mt-1">{displayYear}</p>}
                      </div>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                </div>
                <div className="p-4 sm:p-6">
                  <h2 className="text-sm sm:text-base font-semibold text-slate-800 mb-2 group-hover:text-purple-700 transition-colors duration-300 line-clamp-2 leading-tight min-h-[2rem] sm:min-h-[2.5rem]" title={movie.title}>
                    {displayTitle}
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-600 mb-3 bg-gradient-to-r from-emerald-100 to-blue-100 px-3 py-1 rounded-full inline-block">{getAgeFlag(movie)}</p>
                  <div className="space-y-3">
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-slate-700 bg-purple-100 px-3 py-1.5 rounded-full border border-purple-200">
                        Rating: {displayRating}
                      </span>
                      {displayYear && (
                        <span className="text-xs font-medium text-blue-800 bg-blue-100 px-3 py-1.5 rounded-full border border-blue-200">
                          {displayYear}
                        </span>
                      )}
                    </div>
                    {(movie.age_scores as any)['48m'] !== undefined && (movie.age_scores as any)['60m'] !== undefined ? (
                      // New structure: 4 columns
                      <div className="grid grid-cols-4 gap-2 text-xs">
                        <div className="bg-pink-50 border border-pink-200 px-2 py-2 rounded-lg text-center hover:bg-pink-100 transition-colors duration-300">
                          <div className="font-medium text-pink-800 text-xs">2y</div>
                          <div className="text-pink-600 font-bold text-sm">{movie.age_scores['24m']}</div>
                        </div>
                        <div className="bg-purple-50 border border-purple-200 px-2 py-2 rounded-lg text-center hover:bg-purple-100 transition-colors duration-300">
                          <div className="font-medium text-purple-800 text-xs">3y</div>
                          <div className="text-purple-600 font-bold text-sm">{movie.age_scores['36m']}</div>
                        </div>
                        <div className="bg-blue-50 border border-blue-200 px-2 py-2 rounded-lg text-center hover:bg-blue-100 transition-colors duration-300">
                          <div className="font-medium text-blue-800 text-xs">4y</div>
                          <div className="text-blue-600 font-bold text-sm">{(movie.age_scores as any)['48m']}</div>
                        </div>
                        <div className="bg-green-50 border border-green-200 px-2 py-2 rounded-lg text-center hover:bg-green-100 transition-colors duration-300">
                          <div className="font-medium text-green-800 text-xs">5y</div>
                          <div className="text-green-600 font-bold text-sm">{(movie.age_scores as any)['60m']}</div>
                        </div>
                      </div>
                    ) : (
                      // Old structure: 3 columns
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="bg-pink-50 border border-pink-200 px-2 py-2 rounded-lg text-center hover:bg-pink-100 transition-colors duration-300">
                          <div className="font-medium text-pink-800 text-xs">12m</div>
                          <div className="text-pink-600 font-bold text-sm">{(movie.age_scores as any)['12m']}</div>
                        </div>
                        <div className="bg-purple-50 border border-purple-200 px-2 py-2 rounded-lg text-center hover:bg-purple-100 transition-colors duration-300">
                          <div className="font-medium text-purple-800 text-xs">24m</div>
                          <div className="text-purple-600 font-bold text-sm">{movie.age_scores['24m']}</div>
                        </div>
                        <div className="bg-blue-50 border border-blue-200 px-2 py-2 rounded-lg text-center hover:bg-blue-100 transition-colors duration-300">
                          <div className="font-medium text-blue-800 text-xs">36m</div>
                          <div className="text-blue-600 font-bold text-sm">{movie.age_scores['36m']}</div>
                        </div>
                      </div>
                    )}
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