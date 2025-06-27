'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import MoviesList from './MoviesList';
import { motion } from 'framer-motion';
import FeedbackModal from '../components/FeedbackModal';

interface SearchParams {
  search?: string;
  category?: string;
  age?: string;
}

export default function MoviesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const search = searchParams?.search ?? null;
  const category = searchParams?.category ?? null;
  const age = searchParams?.age ?? null;
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50/50 via-purple-50/30 to-white">
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/60 shadow-sm">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
          <Link href="/" className="text-2xl font-bold tracking-tight flex items-center gap-2 hover:scale-105 transition-transform duration-300">
            🧸 <span>Tiny Viewers</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm font-medium">
            <button 
              onClick={() => setIsFeedbackModalOpen(true)}
              className="hover:text-purple-600 transition-colors duration-300 px-3 py-2 rounded-full hover:bg-purple-50"
            >
              Feedback
            </button>
          </nav>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 md:px-8 pt-12 pb-24">
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="max-w-4xl mb-16"
        >
          <Link 
            href="/"
            className="inline-flex items-center gap-2 text-slate-600 hover:text-purple-600 transition-all duration-300 
                     text-base font-medium mb-8 hover:gap-3 group bg-white/50 px-4 py-2 rounded-full backdrop-blur-sm border border-pink-100"
            prefetch={false}
          >
            <span className="transition-transform duration-300 group-hover:-translate-x-1">←</span>
            <span>Back to Home</span>
          </Link>
          
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-light text-slate-800 mb-6 tracking-tight leading-tight" style={{
            fontFamily: 'system-ui, -apple-system, serif',
            textShadow: '0 2px 8px rgba(168, 85, 247, 0.15)',
          }}>
            {search ? (
              <>
                <span className="text-transparent bg-gradient-to-r from-pink-600 via-purple-500 to-emerald-500 bg-clip-text">
                  Results for
                </span>
                <br />
                <span className="font-normal">"{search}"</span>
              </>
            ) : (
              <span className="text-transparent bg-gradient-to-r from-pink-600 via-purple-500 to-emerald-500 bg-clip-text">
                All Movies
              </span>
            )}
          </h1>
          <p className="text-lg text-slate-600 mb-8 leading-relaxed">
            {search 
              ? `Showing toddler-safe movies matching your search ✨`
              : 'Our complete collection of curated, toddler-friendly films 🎬'
            }
          </p>
          
          {search && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="inline-flex items-center gap-3 bg-white/80 backdrop-blur-sm px-6 py-3 rounded-full border border-purple-200 shadow-lg"
            >
              <span className="text-sm text-slate-600">Search:</span>
              <span className="text-sm font-semibold text-purple-700">{search}</span>
              <span className="text-lg">🔍</span>
            </motion.div>
          )}
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-pink-100 p-8"
        >
          <MoviesList 
            searchQuery={search} 
            categoryFilter={category} 
            ageFilter={age}
          />
        </motion.div>
      </div>

      {/* Feedback Modal */}
      <FeedbackModal 
        isOpen={isFeedbackModalOpen} 
        onClose={() => setIsFeedbackModalOpen(false)} 
      />
    </div>
  );
} 