'use client';

// Tiny Viewers Homepage – Ultra‑Slick Redesign

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Search, ArrowRight, PlayCircle, Send } from "lucide-react";
import { supabase } from '../lib/supabase';
import { Movie } from '../types';
import Image from 'next/image';
import Link from 'next/link';

export default function HomePage() {
  const [featuredMovies, setFeaturedMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const cards = [
    {
      icon: "👶",
      title: "Age‑Based Ratings",
      text: "Scores for 12 m, 24 m, 36 m help you skip what's too intense."
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
          .order('tmdb_rating', { ascending: false, nullsFirst: false })
          .limit(12);

        if (error) {
          console.error('Error fetching featured movies:', error);
          return;
        }

        // Filter for movies that are good for younger children (lower age scores are better)
        // and ensure they have scenes data
        const toddlerFriendlyWithScenes = data?.filter(movie => {
          const avgScore = (movie.age_scores['12m'] + movie.age_scores['24m'] + movie.age_scores['36m']) / 3;
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
    if (scores['12m'] <= 2) return "✅ 12 m+";
    if (scores['24m'] <= 2) return "⚠️ 12 m | ✅ 24 m+";
    if (scores['36m'] <= 2) return "⚠️ 24 m | ✅ 36 m+";
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
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium">
            <a href="#feedback" className="hover:text-primary transition-colors">Feedback</a>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section className="flex flex-col items-center text-center pt-24 pb-20 px-6">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-5xl sm:text-6xl font-extrabold bg-gradient-to-r from-blue-600 to-emerald-500 text-transparent bg-clip-text mb-6 drop-shadow-lg"
        >
          Toddler‑Safe Movie Guide
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="text-xl max-w-2xl text-gray-700 mb-10 text-center"
        >
          Scene‑by‑scene scary scores & age‑specific warnings.
          <br />
          Built for parents of 1–3 year olds.
        </motion.p>

        {/* Search */}
        <motion.form
          onSubmit={handleSearch}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="relative w-full max-w-xl flex"
        >
          <div className="relative w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search: 'Moana', 'Curious George', 'Paddington'…"
              className="w-full pl-12 pr-14 py-4 rounded-full border border-gray-300 shadow placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
            <button 
              type="submit"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-600 hover:text-blue-800"
            >
              <Send size={18} />
            </button>
          </div>
        </motion.form>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="py-24 px-6 bg-white">
        <div className="max-w-6xl mx-auto grid gap-8 md:grid-cols-3">
          {cards.map((c, i) => (
            <motion.div
              key={c.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: i * 0.15 }}
              viewport={{ once: true }}
              className="bg-gradient-to-br from-white to-slate-50 p-6 rounded-3xl shadow-lg border border-slate-100 hover:shadow-2xl transition-shadow"
            >
              <div className="text-4xl mb-4">{c.icon}</div>
              <h3 className="text-xl font-semibold mb-2">{c.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{c.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* TODDLER FAVORITES */}
      <section id="safe" className="py-24 px-6 bg-gradient-to-t from-white via-amber-50/60 to-white/30">
        <div className="max-w-6xl mx-auto">
          <h4 className="text-3xl font-bold mb-10 flex items-center gap-3">
            <span>Toddler Favorites</span>
            <ArrowRight size={22} className="text-blue-600" />
          </h4>
          
          {loading ? (
            <div className="flex justify-center items-center min-h-[300px]">
              <p className="text-xl text-gray-500">Loading featured movies...</p>
            </div>
          ) : (
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {featuredMovies.map((movie, i) => {
                const posterUrl = movie.tmdb_poster_url || movie.poster_url;
                const displayRating = movie.tmdb_rating || movie.rating;
                
                return (
                  <motion.div
                    key={movie.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5, delay: i * 0.1 }}
                    viewport={{ once: true }}
                    className="group relative rounded-3xl overflow-hidden shadow-xl border border-white/60 hover:shadow-2xl transition-shadow"
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
                          <div className="w-full h-full bg-gradient-to-br from-blue-100 to-purple-100 flex items-center justify-center">
                            <div className="text-center p-4">
                              <div className="text-3xl mb-2">🎬</div>
                              <p className="text-xs text-gray-600 font-medium">{movie.title}</p>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="p-5 bg-white/90 backdrop-blur-sm">
                        <h5 className="font-semibold truncate mb-1" title={movie.title}>
                          {movie.title}
                        </h5>
                        <p className="text-sm text-gray-600 mb-2">{getAgeFlag(movie)}</p>
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span>Rating: {displayRating}</span>
                          <div className="flex gap-2">
                            <span>12m: {movie.age_scores['12m']}</span>
                            <span>24m: {movie.age_scores['24m']}</span>
                            <span>36m: {movie.age_scores['36m']}</span>
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
            <div className="text-center py-12">
              <p className="text-xl text-gray-600 mb-4">No featured movies available yet.</p>
              <Link 
                href="/movies"
                className="text-blue-600 hover:text-blue-800 font-medium"
              >
                Browse all movies →
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* FOOTER CTA */}
      <footer className="py-12 text-center bg-white">
        <Link href="/movies">
          <button className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-full shadow hover:bg-blue-700 transition-colors">
            <PlayCircle size={20} /> Browse Full Library
          </button>
        </Link>
      </footer>
    </div>
  );
}
