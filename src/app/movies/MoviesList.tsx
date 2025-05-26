'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { getMoviePoster } from '@/lib/tmdb';
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
  const [movies, setMovies] = useState<(Movie & { tmdbPoster?: string | null })[]>([]);
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

        const moviesWithPosters = await Promise.all(
          (data || []).map(async (movie) => {
            const tmdbPoster = await getMoviePoster(movie.title);
            return { ...movie, tmdbPoster };
          })
        );
        
        console.log('Final movies with posters:', moviesWithPosters);
        setMovies(moviesWithPosters);
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
      <div className="max-w-3xl">
        <h2 className="text-4xl font-light mb-8 text-red-600">Unable to Load Movies</h2>
        <p className="text-red-500 font-light text-xl mb-8">{error}</p>
        <div className="p-8 bg-white/80 backdrop-blur-sm rounded-2xl">
          <h3 className="text-xl font-light mb-6 text-[#2C2C27]">Debug Information</h3>
          <div className="space-y-3 text-[#6B6B63] font-light">
            <p>Search Query: {searchQuery || 'none'}</p>
            <p>Category: {categoryFilter || 'none'}</p>
            <p>Age: {ageFilter || 'none'}</p>
            <p>Supabase URL set: {process.env.NEXT_PUBLIC_SUPABASE_URL ? 'Yes' : 'No'}</p>
            <p>Supabase Key set: {process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'Yes' : 'No'}</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <p className="text-2xl text-[#6B6B63] font-light">Loading movies...</p>
      </div>
    );
  }

  if (movies.length === 0) {
    return (
      <div className="max-w-3xl">
        <h2 className="text-4xl font-light mb-8 text-[#2C2C27]">No Movies Found</h2>
        <div className="text-xl text-[#6B6B63] font-light space-y-2 mb-12">
          <p>Search parameters:</p>
          <p>Query: {searchQuery || 'none'}</p>
          <p>Category: {categoryFilter || 'none'}</p>
          <p>Age: {ageFilter || 'none'}</p>
        </div>
        <Link 
          href="/"
          className="text-2xl text-[#2C2C27] hover:text-[#6B6B63] transition-colors duration-300 font-light"
        >
          Try a different search →
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-12">
      {movies.map((movie) => {
        const movieUrl = `/movies/${movie.id}${searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : ''}${categoryFilter ? `&category=${encodeURIComponent(categoryFilter)}` : ''}${ageFilter ? `&age=${encodeURIComponent(ageFilter)}` : ''}`;
        
        return (
          <Link 
            key={movie.id}
            href={movieUrl}
            className="group block"
          >
            <div className="relative aspect-[3/4] mb-4 overflow-hidden rounded-xl 
                          shadow-[0_2px_20px_rgba(0,0,0,0.04)]
                          hover:shadow-[0_2px_30px_rgba(0,0,0,0.08)]
                          transition-all duration-500 max-h-[300px]">
              <Image
                src={movie.tmdbPoster || movie.poster_url}
                alt={movie.title}
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-105"
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                priority
              />
            </div>
            <h2 className="text-xl font-light text-[#2C2C27] mb-2 group-hover:text-[#6B6B63] transition-colors duration-300">
              {movie.title}
            </h2>
            <div className="flex items-center space-x-4">
              <p className="text-sm text-[#6B6B63] font-light">Rating: {movie.rating}</p>
              <div className="flex items-center space-x-3">
                {(['12m', '24m', '36m'] as const).map((age) => (
                  <div key={age} className="flex items-center space-x-1">
                    <span className="text-xs text-[#6B6B63]/60 font-light">{age}</span>
                    <span className="text-sm font-light text-[#2C2C27]">{movie.age_scores[age]}</span>
                  </div>
                ))}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
} 