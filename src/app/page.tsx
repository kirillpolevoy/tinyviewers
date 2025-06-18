'use client';

// Tiny Viewers Homepage – Ultra‑Slick Redesign

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Search, ArrowRight, PlayCircle, Send } from "lucide-react";
import { supabase } from '../lib/supabase';
import { Movie } from '../types';
import Image from 'next/image';
import Link from 'next/link';
import FeedbackModal from './components/FeedbackModal';

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

export default function HomePage() {
  const [featuredMovies, setFeaturedMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);

  const cards = [
    {
      icon: "👶",
      title: "Age‑Based Ratings",
      text: "Scores for 2y, 3y, 4y, 5y help you skip what's too intense."
    },
    {
      icon: "🎬",
      title: "Scene‑Level Alerts",
      text: "Know exactly when loud noises, peril, or sad moments happen."
    },
    {
      icon: "📚",
      title: "Curated Library",
      text: "Browse 100+ titles hand‑picked & reviewed by parents & educators."
    }
  ];

  // Fetch featured movies from database
  useEffect(() => {
    const fetchFeaturedMovies = async () => {
      try {
        setLoading(true);
        // Get movies with good ratings for toddlers AND that have scenes data
        const { data, error } = await supabase
          .from('movies')
          .select(`
            *,
            scenes!inner(id)
          `)
          .or('is_active.is.null,is_active.eq.true') // Filter out inactive movies
          .order('tmdb_rating', { ascending: false, nullsFirst: false })
          .limit(12);

        if (error) {
          console.error('Error fetching featured movies:', error);
          return;
        }

        // Filter for movies that are good for younger children (lower age scores are better)
        // and ensure they have scenes data
        const toddlerFriendlyWithScenes = data?.filter(movie => {
          // Handle both old (12m/24m/36m) and new (24m/36m/48m/60m) age structures
          const scores = movie.age_scores;
          let avgScore;
          
          if ((scores as any)['48m'] !== undefined && (scores as any)['60m'] !== undefined) {
            // New structure: 24m/36m/48m/60m
            avgScore = ((scores as any)['24m'] + (scores as any)['36m'] + (scores as any)['48m'] + (scores as any)['60m']) / 4;
          } else {
            // Old structure: 12m/24m/36m - use these until database is migrated
            avgScore = ((scores as any)['12m'] + (scores as any)['24m'] + (scores as any)['36m']) / 3;
          }
          
          return avgScore <= 3; // Only movies with low intensity scores
        }).slice(0, 3) || [];

        setFeaturedMovies(toddlerFriendlyWithScenes);
      } catch (error) {
        console.error('Exception fetching movies:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchFeaturedMovies();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      window.location.href = `/movies?search=${encodeURIComponent(searchQuery.trim())}`;
    }
  };

  const getAgeFlag = (movie: Movie) => {
    // Simple logic to determine age recommendation
    const scores = movie.age_scores;
    
    // Handle both old and new age structures
    if ((scores as any)['48m'] !== undefined && (scores as any)['60m'] !== undefined) {
      // New structure: 24m/36m/48m/60m
      if ((scores as any)['24m'] <= 2) return "✅ 2y+";
      if ((scores as any)['36m'] <= 2) return "⚠️ 2y | ✅ 3y+";
      if ((scores as any)['48m'] <= 2) return "⚠️ 3y | ✅ 4y+";
      if ((scores as any)['60m'] <= 2) return "⚠️ 4y | ✅ 5y+";
    } else {
      // Old structure: 12m/24m/36m - map to new labels
      if ((scores as any)['12m'] <= 2) return "✅ 1y+";
      if ((scores as any)['24m'] <= 2) return "⚠️ 1y | ✅ 2y+";
      if ((scores as any)['36m'] <= 2) return "⚠️ 2y | ✅ 3y+";
    }
    
    return "⚠️ Check age ratings";
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-sky-50 via-purple-50 to-orange-50 text-gray-900 scroll-smooth">
      {/* NAV */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/60 shadow-sm">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            🧸 <span>Tiny Viewers</span>
          </h1>
          <nav className="flex items-center gap-6 text-sm font-medium">
            <button 
              onClick={() => setIsFeedbackModalOpen(true)}
              className="hover:text-blue-600 transition-colors duration-300 px-3 py-2 rounded-full hover:bg-blue-50"
            >
              Feedback
            </button>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section className="relative flex flex-col items-center text-center pt-16 pb-12 px-6 overflow-hidden">
        {/* Gentle Background Elements */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-16 left-1/4 w-96 h-96 bg-gradient-to-r from-pink-200/50 to-purple-200/50 rounded-full blur-3xl"></div>
          <div className="absolute bottom-8 right-1/4 w-80 h-80 bg-gradient-to-r from-yellow-200/40 to-orange-200/40 rounded-full blur-3xl"></div>
          
          {/* A few floating shapes */}
          <div className="absolute top-1/4 left-8 w-4 h-4 bg-pink-400 rounded-full animate-bounce delay-300"></div>
          <div className="absolute bottom-1/3 right-16 w-3 h-3 bg-purple-400 rounded-full animate-bounce delay-700"></div>
          <div className="absolute top-2/3 left-20 w-5 h-5 bg-yellow-400 rounded-full animate-bounce delay-500"></div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="mb-4"
        >
          <span className="text-3xl">🎬</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 30, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 1, ease: [0.25, 0.1, 0.25, 1] }}
          className="text-4xl sm:text-5xl lg:text-6xl font-light text-slate-800 mb-6 relative leading-[0.9] cursor-default tracking-tight"
          style={{
            fontFamily: 'system-ui, -apple-system, serif',
            textShadow: '0 2px 8px rgba(168, 85, 247, 0.15)',
            letterSpacing: '-0.02em',
          }}
        >
          <span className="relative inline-block transition-all duration-500 ease-out hover:text-pink-600 font-extralight">
Kid‑Safe (2-5y)
          </span>
          <br />
          <span className="relative inline-block transition-all duration-500 ease-out hover:text-emerald-600 font-normal">
            Movie Guide
          </span>
        </motion.h1>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
          className="text-center mb-6"
        >
          <p className="text-lg sm:text-xl font-medium text-transparent bg-gradient-to-r from-pink-600 via-purple-500 to-emerald-500 bg-clip-text">
            Skip the scares. Keep the joy. ✨
          </p>
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
          className="text-base max-w-lg text-slate-600 mb-8 text-center leading-relaxed"
        >
          Scene‑by‑scene scary scores & age‑specific warnings for parents of 2–5 year olds. 👶
        </motion.p>

        {/* Mobile-Optimized Dual-Action Search Experience */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
          className="w-full max-w-2xl space-y-4 sm:space-y-6 px-4 sm:px-0"
        >
          {/* Primary Search Action - Mobile Optimized */}
          <form onSubmit={handleSearch} className="relative">
            <div className="relative flex bg-white rounded-xl sm:rounded-2xl shadow-xl border-2 border-pink-300/70 hover:border-purple-400/70 hover:shadow-2xl transition-all duration-300 backdrop-blur-sm ring-2 sm:ring-4 ring-pink-100/50 hover:ring-purple-200/50">
              <Search className="absolute left-3 sm:left-5 top-1/2 -translate-y-1/2 text-purple-500 hover:text-pink-600 transition-colors duration-300" size={18} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search movies..."
                className="w-full pl-12 sm:pl-16 pr-16 sm:pr-24 py-3.5 sm:py-5 bg-transparent rounded-xl sm:rounded-2xl text-base sm:text-lg placeholder:text-slate-400 focus:ring-0 focus:outline-none font-medium"
              />
              <button 
                type="submit"
                className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 text-white px-4 sm:px-6 py-2 sm:py-2.5 rounded-lg sm:rounded-xl hover:from-pink-600 hover:via-purple-600 hover:to-indigo-600 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 font-bold text-xs sm:text-sm"
              >
                Search
              </button>
            </div>
          </form>

          {/* Mobile-Optimized Divider with "OR" */}
          <div className="relative flex items-center justify-center py-2">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200"></div>
            </div>
            <div className="relative bg-gradient-to-r from-pink-50 to-purple-50 px-3 py-1.5 rounded-full">
              <span className="text-xs sm:text-sm font-medium text-slate-500">OR</span>
            </div>
          </div>

          {/* Mobile-Optimized Browse Action */}
          <Link href="/movies">
            <motion.div
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              className="group bg-white border-2 border-slate-200 hover:border-slate-300 rounded-xl shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer"
            >
              <div className="px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="bg-slate-100 p-1.5 sm:p-2 rounded-lg group-hover:bg-slate-200 transition-colors duration-300 flex-shrink-0">
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <div className="font-semibold text-slate-800 text-sm sm:text-base truncate">Browse Full Library</div>
                    <div className="text-slate-500 text-xs sm:text-sm truncate">Explore 100+ curated films</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-slate-400 group-hover:text-slate-600 transition-colors duration-300 flex-shrink-0">
                  <span className="text-xs sm:text-sm hidden sm:inline">View All</span>
                  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 transform group-hover:translate-x-0.5 transition-transform duration-300" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
            </motion.div>
          </Link>
        </motion.div>

        {/* Mobile-Optimized Trust Indicators */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.8 }}
          className="mt-6 sm:mt-8 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 text-xs text-slate-500 font-medium px-4 sm:px-0"
        >
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="text-sm">🛡️</span>
            <span className="text-center">Parent-reviewed content</span>
          </div>
          <div className="hidden sm:block w-1 h-1 bg-slate-300 rounded-full"></div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="text-sm">🎯</span>
            <span className="text-center">Age-specific warnings</span>
          </div>
          <div className="hidden sm:block w-1 h-1 bg-slate-300 rounded-full"></div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="text-sm">✨</span>
            <span className="text-center">Scene-by-scene analysis</span>
          </div>
        </motion.div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="py-20 px-6 bg-gradient-to-b from-white to-pink-50/30">
        <div className="max-w-6xl mx-auto">
          <motion.h3
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            viewport={{ once: true }}
            className="text-3xl sm:text-4xl font-light text-slate-800 text-center mb-16 tracking-tight"
            style={{
              fontFamily: 'system-ui, -apple-system, serif',
              textShadow: '0 2px 8px rgba(168, 85, 247, 0.1)',
            }}
          >
            How It Works
          </motion.h3>
          
          <div className="grid gap-8 md:grid-cols-3">
            {cards.map((c, i) => (
              <motion.div
                key={c.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.15, ease: "easeOut" }}
                viewport={{ once: true }}
                className="group bg-white/80 backdrop-blur-sm p-8 rounded-2xl shadow-lg border border-pink-100 hover:shadow-xl hover:border-purple-200 transition-all duration-300 hover:-translate-y-1"
              >
                <div className="text-4xl mb-6 group-hover:scale-110 transition-transform duration-300">{c.icon}</div>
                <h4 className="text-xl font-semibold mb-4 text-slate-800 group-hover:text-purple-700 transition-colors duration-300">{c.title}</h4>
                <p className="text-slate-600 leading-relaxed">{c.text}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* TODDLER FAVORITES */}
      <section id="safe" className="py-20 px-6 bg-gradient-to-b from-pink-50/30 via-purple-50/20 to-white">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h4 className="text-3xl sm:text-4xl font-light text-slate-800 mb-4 tracking-tight" style={{
              fontFamily: 'system-ui, -apple-system, serif',
              textShadow: '0 2px 8px rgba(168, 85, 247, 0.1)',
            }}>
              <span className="text-transparent bg-gradient-to-r from-pink-600 via-purple-500 to-emerald-500 bg-clip-text">
Kid Favorites (Ages 2-5)
              </span>
            </h4>
            <p className="text-slate-600 text-lg">Hand-picked movies perfect for little ones</p>
          </motion.div>
          
          {loading ? (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-center items-center min-h-[300px]"
            >
              <div className="text-center">
                <div className="text-4xl mb-4 animate-bounce">🎬</div>
                <p className="text-xl text-slate-500">Loading featured movies...</p>
              </div>
            </motion.div>
          ) : (
            <div className="flex flex-wrap justify-center gap-8 max-w-7xl mx-auto">
              {featuredMovies.map((movie, i) => {
                const posterUrl = movie.tmdb_poster_url || movie.poster_url;
                const displayRating = movie.tmdb_rating || movie.rating;
                
                // Format title with year
                const { displayTitle, displayYear } = formatTitleWithYear(movie.title, movie.release_year);

                return (
                                    <motion.div
                    key={movie.id}
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    whileInView={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: i * 0.1, ease: "easeOut" }}
                    viewport={{ once: true }}
                    className="group relative rounded-3xl overflow-hidden shadow-lg border border-slate-200/60 hover:shadow-2xl hover:border-purple-300/40 transition-all duration-500 hover:-translate-y-3 bg-white w-full sm:w-[300px] flex-shrink-0"
                  >
                    <Link href={`/movies/${movie.id}`} className="block h-full">
                      {/* Poster Section with Enhanced Visual Hierarchy */}
                      <div className="relative aspect-[3/4] overflow-hidden">
                        {posterUrl && !posterUrl.includes('example.com') ? (
                          <Image
                            src={posterUrl}
                            alt={movie.title}
                            fill
                            className="object-cover group-hover:scale-110 transition-transform duration-700 ease-out"
                            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-pink-100 via-purple-100 to-blue-100 flex items-center justify-center">
                            <div className="text-center p-4">
                              <div className="text-4xl mb-3 animate-bounce">🎬</div>
                              <p className="text-sm text-slate-700 font-semibold">{displayTitle}</p>
                              {displayYear && <p className="text-xs text-slate-500 mt-2">{displayYear}</p>}
                            </div>
                          </div>
                        )}
                        
                        {/* Subtle gradient overlay for better text readability */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                        
                        {/* Enhanced TMDB Rating Badge */}
                        <div className="absolute top-3 left-3 z-10">
                          <div className="bg-white/95 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-lg border border-white/20 group-hover:scale-105 transition-transform duration-300">
                            <div className="flex items-center gap-1.5">
                              {/* Prioritize IMDB > TMDB > Fallback */}
                              {(movie as any).imdb_rating ? (
                                <>
                                  <span className="text-xs">📽️</span>
                                  <span className="text-xs font-bold text-slate-700">{parseFloat((movie as any).imdb_rating).toFixed(1)}</span>
                                  <span className="text-xs text-slate-500">/10</span>
                                </>
                              ) : movie.tmdb_rating ? (
                                <>
                                  <span className="text-xs">🎬</span>
                                  <span className="text-xs font-bold text-slate-700">{parseFloat(movie.tmdb_rating).toFixed(1)}</span>
                                  <span className="text-xs text-slate-500">/10</span>
                                </>
                              ) : (
                                <>
                                  <div className="w-2 h-2 bg-gradient-to-r from-yellow-400 to-orange-400 rounded-full animate-pulse"></div>
                                  <span className="text-xs font-bold text-slate-700">{displayRating}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        {/* Age recommendation with enhanced visibility */}
                        <div className="absolute top-3 right-3 z-10">
                          <div className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white px-3 py-1.5 rounded-full shadow-lg group-hover:scale-105 transition-transform duration-300">
                            <span className="text-xs font-bold drop-shadow-sm">{getAgeFlag(movie)}</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Enhanced Content Section */}
                      <div className="p-5 space-y-4 flex flex-col justify-between min-h-[140px]">
                        <div className="space-y-3">
                          {/* Title with better typography */}
                          <h5 className="font-bold text-lg text-slate-900 group-hover:text-purple-700 transition-colors duration-300 line-clamp-2 leading-tight tracking-tight" title={movie.title}>
                            {displayTitle}
                          </h5>
                          
                          {/* Metadata with improved visual hierarchy */}
                          <div className="flex items-center gap-2">
                            {displayYear && (
                              <div className="flex items-center gap-1.5">
                                <div className="w-1 h-1 bg-slate-400 rounded-full"></div>
                                <span className="text-sm text-slate-600 font-medium">{displayYear}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-1.5">
                              <div className="w-1 h-1 bg-slate-400 rounded-full"></div>
                              <span className="text-sm text-slate-600">Family Film</span>
                            </div>
                          </div>
                        </div>
                        
                        {/* Premium CTA with enhanced interaction design */}
                        <div className="pt-2">
                          <div className="relative overflow-hidden bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 text-white px-4 py-3 rounded-xl text-sm font-semibold text-center group-hover:from-pink-600 group-hover:via-purple-600 group-hover:to-indigo-600 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-[0.98]">
                            <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 -skew-x-12 translate-x-[-100%] group-hover:translate-x-[200%] transition-transform duration-1000 ease-out"></div>
                            <div className="relative flex items-center justify-center gap-2">
                              <span>View Analysis</span>
                              <svg className="w-4 h-4 transform group-hover:translate-x-1 transition-transform duration-300" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                              </svg>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          )}
          
          {!loading && featuredMovies.length === 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              viewport={{ once: true }}
              className="text-center py-16 bg-white/60 backdrop-blur-sm rounded-2xl border border-pink-100"
            >
              <div className="text-5xl mb-6">🎭</div>
              <p className="text-xl text-slate-600 mb-6">No featured movies available yet.</p>
              <Link 
                href="/movies"
                className="inline-flex items-center gap-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white px-6 py-3 rounded-full hover:from-pink-600 hover:to-purple-600 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
              >
                Browse all movies →
              </Link>
            </motion.div>
          )}
        </div>
      </section>

      {/* FOOTER CTA */}
      <footer className="py-16 text-center bg-gradient-to-b from-white to-pink-50/50">
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          viewport={{ once: true }}
          className="max-w-md mx-auto"
        >
          <div className="text-4xl mb-6">🎪</div>
          <h5 className="text-2xl font-light text-slate-800 mb-6 tracking-tight" style={{
            fontFamily: 'system-ui, -apple-system, serif',
            textShadow: '0 2px 8px rgba(168, 85, 247, 0.1)',
          }}>
            Ready to explore?
          </h5>
          <Link href="/movies">
            <button className="inline-flex items-center gap-3 bg-gradient-to-r from-pink-500 via-purple-500 to-emerald-500 text-white px-8 py-4 rounded-full shadow-lg hover:shadow-2xl transition-all duration-500 hover:scale-110 hover:-translate-y-1 text-lg font-medium">
              <PlayCircle size={24} className="animate-pulse" /> 
              <span>Browse Full Library</span>
            </button>
          </Link>
          <p className="text-sm text-slate-500 mt-6">
            Discover safe, joyful movies for your little one ✨
          </p>
        </motion.div>
      </footer>

      {/* Feedback Modal */}
      <FeedbackModal 
        isOpen={isFeedbackModalOpen} 
        onClose={() => setIsFeedbackModalOpen(false)} 
      />
    </div>
  );
}

