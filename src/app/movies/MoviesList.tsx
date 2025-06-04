'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Movie } from '@/types';

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
      <div className="text-center py-16">
        <h2 className="text-3xl font-bold mb-6 text-red-600">Unable to Load Movies</h2>
        <p className="text-red-500 text-lg mb-8">{error}</p>
        <div className="max-w-md mx-auto p-6 bg-red-50 backdrop-blur-sm rounded-2xl border border-red-200">
          <h3 className="text-lg font-semibold mb-4 text-red-800">Debug Information</h3>
          <div className="space-y-2 text-sm text-red-700">
            <p>Search Query: {searchQuery || 'none'}</p>
            <p>Category: {categoryFilter || 'none'}</p>
            <p>Age: {ageFilter || 'none'}</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-xl text-gray-600">Loading movies...</p>
        </div>
      </div>
    );
  }

  if (movies.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-6xl mb-6">🎬</div>
        <h2 className="text-3xl font-bold mb-6 text-gray-800">No Movies Found</h2>
        <div className="text-lg text-gray-600 space-y-1 mb-8">
          <p>We couldn't find any movies matching your search.</p>
          {searchQuery && <p className="font-semibold">Query: "{searchQuery}"</p>}
        </div>
        <Link 
          href="/"
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-full shadow hover:bg-blue-700 transition-colors font-semibold"
        >
          Try a different search →
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
      {movies.map((movie) => {
        const movieUrl = `/movies/${movie.id}${searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : ''}${categoryFilter ? `&category=${encodeURIComponent(categoryFilter)}` : ''}${ageFilter ? `&age=${encodeURIComponent(ageFilter)}` : ''}`;
        
        // Use TMDB poster if available, fallback to original poster
        const posterUrl = movie.tmdb_poster_url || movie.poster_url;
        // Use TMDB rating if available, fallback to original rating
        const displayRating = movie.tmdb_rating || movie.rating;
        
        const getAgeFlag = (movie: Movie) => {
          const scores = movie.age_scores;
          if (scores['12m'] <= 2) return "✅ 12 m+";
          if (scores['24m'] <= 2) return "⚠️ 12 m | ✅ 24 m+";
          if (scores['36m'] <= 2) return "⚠️ 24 m | ✅ 36 m+";
          return "⚠️ Check age ratings";
        };
        
        return (
          <Link 
            key={movie.id}
            href={movieUrl}
            className="group block"
          >
            <div className="bg-white/90 backdrop-blur-sm rounded-3xl overflow-hidden shadow-xl border border-white/60 hover:shadow-2xl transition-all duration-500 hover:scale-[1.02] w-full">
              <div className="relative aspect-[3/4] overflow-hidden flex items-center justify-center">
                {posterUrl && !posterUrl.includes('example.com') ? (
                  <Image
                    src={posterUrl}
                    alt={movie.title}
                    fill
                    className="object-cover object-center group-hover:scale-105 transition-transform duration-500"
                    sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
                    priority
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-blue-100 to-purple-100 flex items-center justify-center">
                    <div className="text-center p-3">
                      <div className="text-3xl mb-1">🎬</div>
                      <p className="text-xs text-gray-600 font-medium leading-tight">{movie.title}</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="p-4">
                <h2 className="text-sm font-semibold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors duration-300 line-clamp-2 leading-tight" title={movie.title}>
                  {movie.title}
                </h2>
                <p className="text-xs text-gray-600 mb-3 line-clamp-1">{getAgeFlag(movie)}</p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-center">
                    <span className="text-xs font-medium text-gray-700">Rating: {displayRating}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-xs text-gray-600">
                    <span className="bg-gray-100 px-1 py-1 rounded text-center text-xs">12m: {movie.age_scores['12m']}</span>
                    <span className="bg-gray-100 px-1 py-1 rounded text-center text-xs">24m: {movie.age_scores['24m']}</span>
                    <span className="bg-gray-100 px-1 py-1 rounded text-center text-xs">36m: {movie.age_scores['36m']}</span>
                  </div>
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
} 