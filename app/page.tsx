'use client';

// Tiny Viewers Homepage – Optimized for Mobile Safari

import React, { useState, useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Search, ArrowRight, PlayCircle, Send } from "lucide-react";
import { supabase } from '../lib/supabase';
import { Movie } from '../types';
import Image from 'next/image';
import Link from 'next/link';
import FeedbackModal from './components/FeedbackModal';
import PasscodeModal from './components/PasscodeModal';

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
  const [isPasscodeModalOpen, setIsPasscodeModalOpen] = useState(false);
  const shouldReduceMotion = useReducedMotion();

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

  // Optimized animation variants
  const fadeInUp = shouldReduceMotion ? {} : {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, ease: "easeOut" }
  };

  const staggerContainer = shouldReduceMotion ? {} : {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { staggerChildren: 0.1 }
  };

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
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-sky-50 via-purple-50 to-orange-50 text-gray-900" style={{ scrollBehavior: 'smooth' }}>
      {/* NAV - Simplified for better performance */}
      <header className="sticky top-0 z-30 bg-white/90 shadow-sm border-b border-purple-100/50" style={{ willChange: 'transform' }}>
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            🧸 <span>Tiny Viewers</span>
          </h1>
          <nav className="flex items-center gap-6 text-sm font-medium">
            <button
              onClick={() => setIsPasscodeModalOpen(true)}
              className="hover:text-blue-600 transition-colors duration-200 px-3 py-2 rounded-full hover:bg-blue-50"
            >
              Add Movie
            </button>
            <button 
              onClick={() => setIsFeedbackModalOpen(true)}
              className="hover:text-blue-600 transition-colors duration-200 px-3 py-2 rounded-full hover:bg-blue-50"
            >
              Feedback
            </button>
          </nav>
        </div>
      </header>

      {/* HERO - Optimized animations and simplified backgrounds */}
      <section className="relative flex flex-col items-center text-center pt-16 pb-12 px-6 overflow-hidden">
        {/* Simplified Background Elements */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-16 left-1/4 w-96 h-96 bg-pink-200/30 rounded-full" style={{ filter: 'blur(60px)' }}></div>
          <div className="absolute bottom-8 right-1/4 w-80 h-80 bg-yellow-200/20 rounded-full" style={{ filter: 'blur(60px)' }}></div>
        </div>

        <motion.div {...fadeInUp} className="mb-4">
          <span className="text-3xl">🎬</span>
        </motion.div>

        <motion.h1
          {...(shouldReduceMotion ? {} : {
            initial: { opacity: 0, y: 30 },
            animate: { opacity: 1, y: 0 },
            transition: { duration: 0.8, ease: "easeOut" }
          })}
          className="text-4xl sm:text-5xl lg:text-6xl font-light text-slate-800 mb-6 relative leading-[0.9] cursor-default tracking-tight"
          style={{
            fontFamily: 'system-ui, -apple-system, serif',
            letterSpacing: '-0.02em',
          }}
        >
          <span className="relative inline-block font-extralight">
            Kid‑Safe (2-5y)
          </span>
          <br />
          <span className="relative inline-block font-normal">
            Movie Guide
          </span>
        </motion.h1>

        <motion.div {...fadeInUp} className="text-center mb-6">
          <p className="text-lg sm:text-xl font-medium text-transparent bg-gradient-to-r from-pink-600 via-purple-500 to-emerald-500 bg-clip-text">
            Skip the scares. Keep the joy. ✨
          </p>
        </motion.div>

        <motion.p {...fadeInUp} className="text-base max-w-lg text-slate-600 mb-8 text-center leading-relaxed">
          Scene‑by‑scene scary scores & age‑specific warnings for parents of 2–5 year olds. 👶
        </motion.p>

        {/* Simplified Search Experience */}
        <motion.div {...fadeInUp} className="w-full max-w-2xl space-y-4 sm:space-y-6 px-4 sm:px-0">
          {/* Primary Search Action */}
          <form onSubmit={handleSearch} className="relative">
            <div className="relative flex bg-white rounded-xl sm:rounded-2xl shadow-lg border-2 border-pink-300/70 hover:border-purple-400/70 transition-all duration-200">
              <Search className="absolute left-3 sm:left-5 top-1/2 -translate-y-1/2 text-purple-500" size={18} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search movies..."
                className="w-full pl-12 sm:pl-16 pr-16 sm:pr-24 py-3.5 sm:py-5 bg-transparent rounded-xl sm:rounded-2xl text-base sm:text-lg placeholder:text-slate-400 focus:ring-0 focus:outline-none font-medium"
              />
              <button 
                type="submit"
                className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 text-white px-4 sm:px-6 py-2 sm:py-2.5 rounded-lg sm:rounded-xl hover:from-pink-600 hover:via-purple-600 hover:to-indigo-600 transition-all duration-200 shadow-lg font-bold text-xs sm:text-sm"
              >
                Search
              </button>
            </div>
          </form>

          {/* Simplified Divider */}
          <div className="relative flex items-center justify-center py-2">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200"></div>
            </div>
            <div className="relative bg-white px-3 py-1.5 rounded-full">
              <span className="text-xs sm:text-sm font-medium text-slate-500">OR</span>
            </div>
          </div>

          {/* Browse Action */}
          <Link href="/movies">
            <div className="group bg-white border-2 border-slate-200 hover:border-slate-300 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer">
              <div className="px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="bg-slate-100 p-1.5 sm:p-2 rounded-lg group-hover:bg-slate-200 transition-colors duration-200 flex-shrink-0">
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <div className="font-semibold text-slate-800 text-sm sm:text-base truncate">Browse Full Library</div>
                    <div className="text-slate-500 text-xs sm:text-sm truncate">Explore 100+ curated films</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-slate-400 group-hover:text-slate-600 transition-colors duration-200 flex-shrink-0">
                  <span className="text-xs sm:text-sm hidden sm:inline">View All</span>
                  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 transform group-hover:translate-x-0.5 transition-transform duration-200" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
            </div>
          </Link>
        </motion.div>

        {/* Trust Indicators */}
        <motion.div {...fadeInUp} className="mt-6 sm:mt-8 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 text-xs text-slate-500 font-medium px-4 sm:px-0">
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

      {/* HOW IT WORKS - Simplified animations */}
      <section id="how" className="py-20 px-6 bg-gradient-to-b from-white to-pink-50/30">
        <div className="max-w-6xl mx-auto">
          <motion.h3 {...fadeInUp} className="text-3xl sm:text-4xl font-light text-slate-800 text-center mb-16 tracking-tight" style={{ fontFamily: 'system-ui, -apple-system, serif' }}>
            How It Works
          </motion.h3>
          
          <motion.div {...staggerContainer} className="grid gap-8 md:grid-cols-3">
            {cards.map((c, i) => (
              <motion.div
                key={c.title}
                {...(shouldReduceMotion ? {} : {
                  initial: { opacity: 0, y: 20 },
                  animate: { opacity: 1, y: 0 },
                  transition: { duration: 0.5, delay: i * 0.1 }
                })}
                className="group bg-white/80 p-8 rounded-2xl shadow-lg border border-pink-100 hover:shadow-xl hover:border-purple-200 transition-all duration-200"
                style={{ willChange: 'transform' }}
              >
                <div className="text-4xl mb-6">{c.icon}</div>
                <h4 className="text-xl font-semibold mb-4 text-slate-800">{c.title}</h4>
                <p className="text-slate-600 leading-relaxed">{c.text}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* TODDLER FAVORITES - Optimized for mobile performance */}
      <section id="safe" className="py-20 px-6 bg-gradient-to-b from-pink-50/30 via-purple-50/20 to-white">
        <div className="max-w-6xl mx-auto">
          <motion.div {...fadeInUp} className="text-center mb-16">
            <h4 className="text-3xl sm:text-4xl font-light text-slate-800 mb-4 tracking-tight" style={{ fontFamily: 'system-ui, -apple-system, serif' }}>
              <span className="text-transparent bg-gradient-to-r from-pink-600 via-purple-500 to-emerald-500 bg-clip-text">
                Kid Favorites (Ages 2-5)
              </span>
            </h4>
            <p className="text-slate-600 text-lg">Hand-picked movies perfect for little ones</p>
          </motion.div>
          
          {loading ? (
            <div className="flex justify-center items-center min-h-[300px]">
              <div className="text-center">
                <div className="text-4xl mb-4">🎬</div>
                <p className="text-xl text-slate-500">Loading featured movies...</p>
              </div>
            </div>
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
                    {...(shouldReduceMotion ? {} : {
                      initial: { opacity: 0, y: 20 },
                      animate: { opacity: 1, y: 0 },
                      transition: { duration: 0.5, delay: i * 0.1 }
                    })}
                    className="group relative rounded-3xl overflow-hidden shadow-lg border border-slate-200/60 hover:shadow-xl transition-all duration-200 bg-white w-full sm:w-[300px] flex-shrink-0"
                    style={{ willChange: 'transform' }}
                  >
                    <Link href={`/movies/${movie.id}`} className="block h-full">
                      {/* Poster Section */}
                      <div className="relative aspect-[3/4] overflow-hidden">
                        {posterUrl && !posterUrl.includes('example.com') ? (
                          <Image
                            src={posterUrl}
                            alt={movie.title}
                            fill
                            className="object-cover transition-transform duration-300 ease-out"
                            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                            priority={i < 3}
                            loading={i < 3 ? "eager" : "lazy"}
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-pink-100 via-purple-100 to-blue-100 flex items-center justify-center">
                            <div className="text-center p-4">
                              <div className="text-4xl mb-3">🎬</div>
                              <p className="text-sm text-slate-700 font-semibold">{displayTitle}</p>
                              {displayYear && <p className="text-xs text-slate-500 mt-2">{displayYear}</p>}
                            </div>
                          </div>
                        )}
                        
                        {/* Rating Badge */}
                        <div className="absolute top-3 left-3 z-10">
                          <div className="bg-white/95 px-3 py-1.5 rounded-full shadow-lg">
                            <div className="flex items-center gap-1.5">
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
                                  <div className="w-2 h-2 bg-gradient-to-r from-yellow-400 to-orange-400 rounded-full"></div>
                                  <span className="text-xs font-bold text-slate-700">{displayRating}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        {/* Age recommendation */}
                        <div className="absolute top-3 right-3 z-10">
                          <div className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white px-3 py-1.5 rounded-full shadow-lg">
                            <span className="text-xs font-bold">{getAgeFlag(movie)}</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Content Section */}
                      <div className="p-5 space-y-4 flex flex-col justify-between min-h-[140px]">
                        <div className="space-y-3">
                          <h5 className="font-bold text-lg text-slate-900 line-clamp-2 leading-tight tracking-tight" title={movie.title}>
                            {displayTitle}
                          </h5>
                          
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
                        
                        {/* CTA Button */}
                        <div className="pt-2">
                          <div className="bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 text-white px-4 py-3 rounded-xl text-sm font-semibold text-center transition-all duration-200 shadow-lg">
                            <div className="flex items-center justify-center gap-2">
                              <span>View Analysis</span>
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
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
            <div className="text-center py-16 bg-white/60 rounded-2xl border border-pink-100">
              <div className="text-5xl mb-6">🎭</div>
              <p className="text-xl text-slate-600 mb-6">No featured movies available yet.</p>
              <Link 
                href="/movies"
                className="inline-flex items-center gap-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white px-6 py-3 rounded-full transition-all duration-200 shadow-lg"
              >
                Browse all movies →
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* FOOTER CTA */}
      <footer className="py-16 text-center bg-gradient-to-b from-white to-pink-50/50">
        <motion.div {...fadeInUp} className="max-w-md mx-auto">
          <div className="text-4xl mb-6">🎪</div>
          <h5 className="text-2xl font-light text-slate-800 mb-6 tracking-tight" style={{ fontFamily: 'system-ui, -apple-system, serif' }}>
            Ready to explore?
          </h5>
          <Link href="/movies">
            <button className="inline-flex items-center gap-3 bg-gradient-to-r from-pink-500 via-purple-500 to-emerald-500 text-white px-8 py-4 rounded-full shadow-lg transition-all duration-200 text-lg font-medium">
              <PlayCircle size={24} /> 
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

      {/* Passcode Modal */}
      <PasscodeModal 
        isOpen={isPasscodeModalOpen} 
        onClose={() => setIsPasscodeModalOpen(false)}
        onSuccess={() => window.location.href = '/add-movie'}
      />
    </div>
  );
}

