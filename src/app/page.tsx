'use client';

// Tiny Viewers Homepage – Ultra‑Slick Redesign

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Search, ArrowRight, PlayCircle, Send } from "lucide-react";
import { supabase } from '../../lib/supabase';
import { Movie } from '../../types';
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
      text: "Browse 200+ titles hand‑picked & reviewed by parents & educators."
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
          
          if (scores['48m'] !== undefined && scores['60m'] !== undefined) {
            // New structure: 24m/36m/48m/60m
            avgScore = (scores['24m'] + scores['36m'] + scores['48m'] + scores['60m']) / 4;
          } else {
            // Old structure: 12m/24m/36m - use these until database is migrated
            avgScore = (scores['12m'] + scores['24m'] + scores['36m']) / 3;
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
    if (scores['48m'] !== undefined && scores['60m'] !== undefined) {
      // New structure: 24m/36m/48m/60m
      if (scores['24m'] <= 2) return "✅ 2y+";
      if (scores['36m'] <= 2) return "⚠️ 2y | ✅ 3y+";
      if (scores['48m'] <= 2) return "⚠️ 3y | ✅ 4y+";
      if (scores['60m'] <= 2) return "⚠️ 4y | ✅ 5y+";
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

        {/* Balanced Search */}
        <motion.form
          onSubmit={handleSearch}
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
          className="relative w-full max-w-md"
        >
          <div className="relative flex bg-white rounded-full shadow-lg border-2 border-pink-200 hover:border-purple-300 hover:shadow-xl transition-all duration-300">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-400 hover:text-pink-500 transition-colors duration-300" size={18} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search movies... 🔍"
              className="w-full pl-12 pr-16 py-3 bg-transparent rounded-full text-sm placeholder:text-purple-400 focus:ring-0 focus:outline-none"
            />
            <button 
              type="submit"
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-gradient-to-r from-pink-500 to-purple-500 text-white p-2 rounded-full hover:from-pink-600 hover:to-purple-600 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-110"
            >
              <Send size={14} />
            </button>
          </div>
        </motion.form>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.8 }}
          className="mt-6 text-xs text-slate-500 font-medium flex items-center gap-2"
        >
          <span>🌟</span>
          <span>Safe movie magic for little ones</span>
          <span>🌟</span>
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
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
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
                    className="group relative rounded-2xl overflow-hidden shadow-lg border border-pink-100 hover:shadow-2xl hover:border-purple-200 transition-all duration-500 hover:-translate-y-2 bg-white/90 backdrop-blur-sm"
                  >
                    <Link href={`/movies/${movie.id}`}>
                      <div className="relative aspect-[4/5] overflow-hidden max-h-[200px]">
                        {posterUrl && !posterUrl.includes('example.com') ? (
                          <Image
                            src={posterUrl}
                            alt={movie.title}
                            fill
                            className="object-cover group-hover:scale-105 transition-transform duration-500"
                            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-pink-100 via-purple-100 to-blue-100 flex items-center justify-center">
                            <div className="text-center p-4">
                              <div className="text-3xl mb-2">🎬</div>
                              <p className="text-xs text-slate-600 font-medium">{displayTitle}</p>
                              {displayYear && <p className="text-xs text-slate-500 mt-1">{displayYear}</p>}
                            </div>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                      </div>
                      <div className="p-6">
                        <h5 className="font-semibold text-slate-800 group-hover:text-purple-700 transition-colors duration-300 line-clamp-2 leading-tight mb-2" title={movie.title}>
                          {displayTitle}
                        </h5>
                        <p className="text-sm text-slate-600 mb-3 bg-gradient-to-r from-emerald-100 to-blue-100 px-3 py-1 rounded-full inline-block">
                          {getAgeFlag(movie)}
                        </p>
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <div className="flex gap-2 flex-wrap">
                            <span className="bg-purple-100 px-2 py-1 rounded-full">Rating: {displayRating}</span>
                            {displayYear && (
                              <span className="bg-blue-100 px-2 py-1 rounded-full text-blue-800">{displayYear}</span>
                            )}
                          </div>
                          <div className="flex gap-1">
                            {movie.age_scores['48m'] !== undefined && movie.age_scores['60m'] !== undefined ? (
                              // New structure
                              <>
                                <span className="bg-pink-100 px-2 py-1 rounded-full">2y: {movie.age_scores['24m']}</span>
                                <span className="bg-purple-100 px-2 py-1 rounded-full">3y: {movie.age_scores['36m']}</span>
                                <span className="bg-blue-100 px-2 py-1 rounded-full">4y: {movie.age_scores['48m']}</span>
                                <span className="bg-green-100 px-2 py-1 rounded-full">5y: {movie.age_scores['60m']}</span>
                              </>
                            ) : (
                              // Old structure - keep original labels for now
                              <>
                                <span className="bg-pink-100 px-2 py-1 rounded-full">12m: {(movie.age_scores as any)['12m']}</span>
                                <span className="bg-purple-100 px-2 py-1 rounded-full">24m: {movie.age_scores['24m']}</span>
                                <span className="bg-blue-100 px-2 py-1 rounded-full">36m: {movie.age_scores['36m']}</span>
                              </>
                            )}
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
