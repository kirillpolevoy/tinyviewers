'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '../../lib/supabase';
import AuthButtonSimple from '../components/AuthButtonSimple';
import SaveButton from '../components/SaveButton';
import { motion } from 'framer-motion';
import { useToast } from '../components/Toast';
import { Plus, Grid, List, Folder, Heart } from 'lucide-react';

interface MovieRow {
  id: string;
  title: string;
  poster_url: string | null;
  tmdb_poster_url?: string | null;
  tmdb_rating?: string | null;
  rating: string;
  release_year?: number | null;
}

interface SuggestedMovie extends MovieRow {
  age_scores: any;
}

interface SavedMovieWithMovie {
  id: string;
  movie_id: string;
  created_at: string;
  movies: MovieRow;
}

interface Collection {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  movie_count?: number;
}

const CollectionCard = ({ collection, onSelect, isSelected }: {
  collection: Collection;
  onSelect: (collectionId: string) => void;
  isSelected: boolean;
}) => (
  <motion.div
    whileHover={{ scale: 1.02 }}
    whileTap={{ scale: 0.98 }}
    onClick={() => onSelect(collection.id)}
    className={`
      p-4 rounded-xl border cursor-pointer transition-all duration-200
      ${isSelected 
        ? `bg-${collection.color}-50 border-${collection.color}-300 ring-2 ring-${collection.color}-200`
        : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-md'
      }
    `}
  >
    <div className="flex items-center gap-3">
      <div className={`
        w-12 h-12 rounded-lg flex items-center justify-center text-xl
        ${isSelected ? `bg-${collection.color}-100` : 'bg-slate-100'}
      `}>
        {collection.icon}
      </div>
      <div className="flex-1">
        <h3 className="font-semibold text-slate-800">{collection.name}</h3>
        <p className="text-sm text-slate-600">
          {collection.movie_count || 0} movies
        </p>
      </div>
    </div>
    {collection.description && (
      <p className="text-sm text-slate-500 mt-2">{collection.description}</p>
    )}
  </motion.div>
);

export default function LibraryPage() {
  const [loading, setLoading] = useState(true);
  const [movies, setMovies] = useState<MovieRow[]>([]);
  const [isAuthed, setIsAuthed] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<'recent' | 'title'>('recent');
  const [suggestedMovies, setSuggestedMovies] = useState<SuggestedMovie[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const { showToast } = useToast();

  useEffect(() => {
    let isMounted = true;
    
    const loadUserData = async (user: { id: string }) => {
      if (!user || !isMounted) return;
      
      setIsAuthed(true);
      setLoading(true);

      try {
        // Load saved movies
        const { data: savedMovies, error } = await supabase
          .from('saved_movies')
          .select(`
            id,
            movie_id,
            created_at,
            movies (
              id,
              title,
              poster_url,
              tmdb_poster_url,
              rating,
              tmdb_rating,
              release_year
            )
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (error) {
          console.warn('Error fetching saved movies:', error);
          // Fallback to showing suggested movies if saved_movies table doesn't exist
          const { data: suggested } = await supabase
            .from('movies')
            .select('*')
            .or('is_active.is.null,is_active.eq.true')
            .order('created_at', { ascending: false })
            .limit(6);
          
          if (suggested) {
            setSuggestedMovies(suggested as SuggestedMovie[]);
          }
          setMovies([]);
        } else {
          // Map saved movies to the expected format
          const mappedMovies = savedMovies?.map((sm: SavedMovieWithMovie) => ({
            id: sm.movies.id,
            title: sm.movies.title,
            poster_url: sm.movies.poster_url,
            tmdb_poster_url: sm.movies.tmdb_poster_url,
            rating: sm.movies.rating,
            tmdb_rating: sm.movies.tmdb_rating,
            release_year: sm.movies.release_year,
          })) || [];
          
          setMovies(mappedMovies);

          // Also load suggested movies for empty state
          const { data: suggested } = await supabase
            .from('movies')
            .select('*')
            .or('is_active.is.null,is_active.eq.true')
            .order('created_at', { ascending: false })
            .limit(6);
          
          if (suggested) {
            setSuggestedMovies(suggested as SuggestedMovie[]);
          }
        }
      } catch (error) {
        console.warn('Error fetching movies:', error);
        if (isMounted) setMovies([]);
      }
      
      if (isMounted) setLoading(false);
    };

    // Get initial user state
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!isMounted) return;
      
      if (user) {
        loadUserData(user);
      } else {
        setIsAuthed(false);
        setLoading(false);
      }
    }).catch((error) => {
      console.error('Library: Auth check failed:', error);
      if (isMounted) {
        setIsAuthed(false);
        setLoading(false);
      }
    });

    // Listen for auth state changes
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;
      
      const currentUser = session?.user ?? null;
      
      if (currentUser && event === 'SIGNED_IN') {
        loadUserData(currentUser);
      } else if (!currentUser) {
        setIsAuthed(false);
        setMovies([]);
        setSuggestedMovies([]);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-purple-50/30">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-white/95 shadow-sm border-b border-slate-200/60">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-4 sm:px-6 py-4">
          <Link href="/" className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2 hover:scale-105 transition-transform duration-300">
            🧸 <span className="text-slate-800">Tiny Viewers</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm font-medium">
            <AuthButtonSimple />
          </nav>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-24">
        <div className="mb-8">
          <Link 
            href="/movies"
            className="inline-flex items-center gap-2 text-slate-600 hover:text-purple-600 transition-all duration-300 text-sm font-medium mb-6 hover:gap-3 group"
          >
            <span className="transition-transform duration-300 group-hover:-translate-x-1">←</span>
            <span>Back to Movies</span>
          </Link>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-light text-slate-900 mb-3 tracking-tight leading-none">
            <span className="text-transparent bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text">My Library</span>
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl">Saved movies for quick access across devices.</p>
        </div>

        {!isAuthed && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
            <p className="mb-4 text-slate-700">Sign in to view your saved movies.</p>
            <AuthButtonSimple />
          </div>
        )}

        {isAuthed && loading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] rounded-xl bg-slate-200 animate-pulse" />
            ))}
          </div>
        )}

        {isAuthed && !loading && movies.length === 0 && (
          <div className="space-y-8">
            {/* Empty State Header */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-xl border border-slate-200 p-8 text-center"
            >
              <div className="text-6xl mb-4">🎬</div>
              <h2 className="text-2xl font-light text-slate-800 mb-3">Start Your Movie Library</h2>
              <p className="text-slate-600 mb-6 max-w-md mx-auto">
                Save movies you love and discover new favorites. Your personal collection of kid-safe films awaits!
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link 
                  href="/movies" 
                  className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white px-6 py-3 rounded-xl font-semibold hover:from-purple-600 hover:to-pink-600 transition-all duration-200 shadow-md hover:shadow-lg"
                >
                  <span>🔍</span>
                  Browse All Movies
                </Link>
              </div>
            </motion.div>

            {/* Suggested Movies */}
            {suggestedMovies.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-white rounded-xl border border-slate-200 p-6"
              >
                <div className="flex items-center gap-3 mb-6">
                  <span className="text-2xl">✨</span>
                  <h3 className="text-xl font-semibold text-slate-800">Popular with Parents</h3>
                  <span className="text-sm text-slate-500">Get started with these favorites</span>
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                  {suggestedMovies.map((movie, index) => {
                    const posterUrl = movie.tmdb_poster_url || movie.poster_url;
                    return (
                      <motion.div
                        key={movie.id}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.3 + index * 0.1 }}
                        className="group relative"
                      >
                        <Link href={`/movies/${movie.id}`} className="block">
                          <div className="relative aspect-[2/3] overflow-hidden rounded-lg shadow-sm border border-slate-200 bg-white hover:shadow-md transition-all duration-200">
                            {posterUrl ? (
                              <Image 
                                src={posterUrl} 
                                alt={movie.title} 
                                fill 
                                className="object-cover group-hover:scale-105 transition-transform duration-300" 
                                sizes="(max-width: 640px) 150px, (max-width: 1024px) 120px, 140px"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-pink-100 to-purple-100">
                                <div className="text-center p-2">
                                  <div className="text-2xl mb-1">🎬</div>
                                  <p className="text-xs text-slate-600 font-medium leading-tight">{movie.title}</p>
                                </div>
                              </div>
                            )}
                            
                            {/* Save Button Overlay */}
                            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                              <SaveButton movieId={movie.id} size="sm" />
                            </div>
                          </div>
                        </Link>
                        <div className="mt-2 text-xs text-slate-700 line-clamp-2 leading-tight">{movie.title}</div>
                      </motion.div>
                    );
                  })}
                </div>
                
                <div className="mt-6 text-center">
                  <Link 
                    href="/movies" 
                    className="text-purple-600 hover:text-purple-700 text-sm font-medium hover:underline"
                  >
                    View all movies →
                  </Link>
                </div>
              </motion.div>
            )}
          </div>
        )}

        {isAuthed && !loading && movies.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm px-4 py-2 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-2xl">🎬</span>
                <div>
                  <div className="text-xl font-bold text-slate-900">{movies.length}</div>
                  <div className="text-xs text-slate-600 -mt-0.5">saved</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-sm text-slate-600">Sort</div>
                <div className="bg-slate-100 rounded-xl p-1">
                  <button
                    onClick={() => setSortBy('recent')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${sortBy === 'recent' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    Recent
                  </button>
                  <button
                    onClick={() => setSortBy('title')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${sortBy === 'title' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    Title A-Z
                  </button>
                </div>
              </div>
            </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6">
              {movies.map((m) => {
                const posterUrl = m.tmdb_poster_url || m.poster_url;
                return (
                  <div key={m.id} className="group relative">
                    <Link href={`/movies/${m.id}`} className="block">
                      <div className="relative aspect-[2/3] overflow-hidden rounded-xl shadow-sm border border-slate-200 bg-white hover:shadow-md transition-all duration-200">
                        {posterUrl ? (
                          <Image src={posterUrl} alt={m.title} fill className="object-cover transition-all duration-300 group-hover:scale-105" sizes="(max-width: 1024px) 200px, 240px" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-slate-100">
                            <div className="text-sm text-slate-700 p-3 text-center">{m.title}</div>
                          </div>
                        )}
                      </div>
                    </Link>
                    
                    {/* Remove Button */}
                    <div className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      <button
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          
                          try {
                            const { data: { user } } = await supabase.auth.getUser();
                            if (!user) return;

                            const { error } = await supabase
                              .from('saved_movies')
                              .delete()
                              .eq('user_id', user.id)
                              .eq('movie_id', m.id);
                            
                            if (error) {
                              console.error('Error removing movie:', error);
                              showToast('Failed to remove movie', 'error');
                              return;
                            }

                            // Update local state
                            setMovies(prev => prev.filter(movie => movie.id !== m.id));
                            showToast('Removed from library', 'success');
                            
                            // Trigger refresh of saved count in auth button
                            if (typeof window !== 'undefined') {
                              window.dispatchEvent(new Event('refreshSavedCount'));
                            }
                          } catch (error) {
                            console.error('Error removing movie:', error);
                            showToast('Failed to remove movie', 'error');
                          }
                        }}
                        className="w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-md hover:shadow-lg transition-all duration-200 hover:scale-110"
                        title="Remove from library"
                      >
                        ×
                      </button>
                    </div>
                    
                    <div className="mt-2 text-sm text-slate-800 line-clamp-2">{m.title}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


