'use client';

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import MoviesList from './MoviesList';
import { motion, AnimatePresence } from 'framer-motion';
import FeedbackModal from '../components/FeedbackModal';

interface SearchParams {
  search?: string;
  category?: string;
  age?: string;
  sort?: string;
  view?: string;
}

const SORT_OPTIONS = [
  { value: 'title', label: 'Title A-Z', icon: '🔤' },
  { value: 'rating', label: 'Highest Rated', icon: '⭐' },
  { value: 'year', label: 'Newest First', icon: '📅' },
  { value: 'age', label: 'Youngest First', icon: '👶' },
];

const AGE_FILTERS = [
  { value: 'all', label: 'All Ages' },
  { value: '2', label: '2+ years' },
  { value: '3', label: '3+ years' },
  { value: '4', label: '4+ years' },
  { value: '5', label: '5+ years' },
];

const VIEW_MODES = [
  { value: 'grid', label: 'Grid', icon: '⊞' },
  { value: 'list', label: 'List', icon: '☰' },
];

export default function MoviesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const search = searchParams?.search ?? null;
  const category = searchParams?.category ?? null;
  const age = searchParams?.age ?? null;
  const sort = searchParams?.sort ?? 'title';
  const view = searchParams?.view ?? 'grid';
  
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [totalMovies, setTotalMovies] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilters, setActiveFilters] = useState({
    search: search || '',
    age: age || 'all',
    sort: sort,
    view: view,
  });

  const handleFilterChange = useCallback((key: string, value: string) => {
    setActiveFilters(prev => ({ ...prev, [key]: value }));
    
    // Update URL with new filters
    const params = new URLSearchParams();
    const newFilters = { ...activeFilters, [key]: value };
    
    if (newFilters.search) params.set('search', newFilters.search);
    if (newFilters.age !== 'all') params.set('age', newFilters.age);
    if (newFilters.sort !== 'title') params.set('sort', newFilters.sort);
    if (newFilters.view !== 'grid') params.set('view', newFilters.view);
    
    const newUrl = `/movies${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.pushState({}, '', newUrl);
  }, [activeFilters]);

  const clearAllFilters = () => {
    setActiveFilters({ search: '', age: 'all', sort: 'title', view: 'grid' });
    window.history.pushState({}, '', '/movies');
  };

  const hasActiveFilters = activeFilters.search || activeFilters.age !== 'all' || activeFilters.sort !== 'title';
  const activeFilterCount = [
    activeFilters.search,
    activeFilters.age !== 'all',
    activeFilters.sort !== 'title'
  ].filter(Boolean).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-purple-50/30">
      {/* Clean Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-white/95 shadow-sm border-b border-slate-200/60">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-4 sm:px-6 py-4">
          <Link href="/" className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2 hover:scale-105 transition-transform duration-300">
            🧸 <span className="text-slate-800">Tiny Viewers</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm font-medium">
            <button 
              onClick={() => setIsFeedbackModalOpen(true)}
              className="text-slate-600 hover:text-purple-600 transition-colors duration-300 px-3 py-2 rounded-full hover:bg-purple-50"
            >
              Feedback
            </button>
          </nav>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-24">
        {/* Hero Section */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="mb-12"
        >
          <Link 
            href="/"
            className="inline-flex items-center gap-2 text-slate-600 hover:text-purple-600 transition-all duration-300 
                     text-sm font-medium mb-6 hover:gap-3 group"
            prefetch={false}
          >
            <span className="transition-transform duration-300 group-hover:-translate-x-1">←</span>
            <span>Back to Home</span>
          </Link>
          
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-8">
            <div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-light text-slate-900 mb-4 tracking-tight leading-none">
                <span className="text-transparent bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text">
                  Movie Library
                </span>
              </h1>
              <p className="text-lg text-slate-600 max-w-2xl leading-relaxed">
                {search 
                  ? `Showing curated, kid-safe movies`
                  : 'Our complete collection of curated, kid-friendly films for ages 2-5'
                }
              </p>
            </div>
            
            {totalMovies !== null && (
              <div className="flex items-center gap-3 bg-white/80 backdrop-blur-sm px-6 py-3 rounded-2xl border border-slate-200 shadow-sm">
                <span className="text-2xl">🎬</span>
                <div>
                  <div className="text-2xl font-bold text-slate-900">{totalMovies}</div>
                  <div className="text-sm text-slate-600 -mt-1">movies</div>
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* Search & Filter Bar */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mb-8"
        >
          {/* Primary Search */}
          <div className="relative mb-6">
            <div className={`absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none z-10 transition-colors duration-300 ${
              activeFilters.search ? 'text-purple-500' : 'text-slate-400'
            }`}>
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search movies..."
              value={activeFilters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              className={`w-full pl-12 pr-12 py-4 text-lg bg-white rounded-2xl transition-all duration-300 shadow-sm hover:shadow-md focus:shadow-lg ${
                activeFilters.search 
                  ? 'border-2 border-purple-300 ring-4 ring-purple-100 focus:border-purple-400 focus:ring-purple-200' 
                  : 'border border-slate-200 focus:border-purple-300 focus:ring-4 focus:ring-purple-100'
              }`}
            />
            {activeFilters.search && (
              <button
                onClick={() => handleFilterChange('search', '')}
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-slate-600 transition-colors z-10"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Filter Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            {/* Left: Filter Toggle & Active Filters */}
            <div className="flex items-center gap-4">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl 
                         hover:border-purple-300 hover:bg-purple-50 transition-all duration-300 shadow-sm hover:shadow-md"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 2v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                <span className="font-medium">Filters</span>
                {activeFilterCount > 0 && (
                  <span className="bg-purple-100 text-purple-700 text-xs font-bold px-2 py-1 rounded-full min-w-[20px] text-center">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              {hasActiveFilters && (
                <button
                  onClick={clearAllFilters}
                  className="text-sm text-slate-500 hover:text-slate-700 underline underline-offset-4 hover:no-underline transition-all duration-200"
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Right: View Toggle */}
            <div className="flex items-center gap-2 bg-slate-100 rounded-xl p-1">
              <button
                onClick={() => handleFilterChange('view', 'grid')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  activeFilters.view === 'grid'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
                <span className="hidden sm:inline">Grid</span>
              </button>
              <button
                onClick={() => handleFilterChange('view', 'list')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  activeFilters.view === 'list'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                <span className="hidden sm:inline">List</span>
              </button>
            </div>
          </div>

          {/* Expandable Filter Panel */}
          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 24 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Age Filter */}
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900 mb-4">Age Group</h3>
                      <div className="space-y-2">
                        {AGE_FILTERS.map(option => (
                          <button
                            key={option.value}
                            onClick={() => handleFilterChange('age', option.value)}
                            className={`w-full text-left px-4 py-3 rounded-xl transition-all duration-200 ${
                              activeFilters.age === option.value
                                ? 'bg-purple-100 text-purple-900 border-2 border-purple-300'
                                : 'bg-slate-50 text-slate-700 border-2 border-transparent hover:bg-slate-100'
                            }`}
                          >
                            <span className="font-medium">{option.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Sort Options */}
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900 mb-4">Sort By</h3>
                      <div className="space-y-2">
                        {SORT_OPTIONS.map(option => (
                          <button
                            key={option.value}
                            onClick={() => handleFilterChange('sort', option.value)}
                            className={`w-full text-left px-4 py-3 rounded-xl transition-all duration-200 ${
                              activeFilters.sort === option.value
                                ? 'bg-purple-100 text-purple-900 border-2 border-purple-300'
                                : 'bg-slate-50 text-slate-700 border-2 border-transparent hover:bg-slate-100'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-lg">{option.icon}</span>
                              <span className="font-medium">{option.label}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Movies Grid */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
        >
          <MoviesList 
            searchQuery={activeFilters.search || null} 
            categoryFilter={category} 
            ageFilter={activeFilters.age !== 'all' ? activeFilters.age : null}
            sortBy={activeFilters.sort}
            viewMode={activeFilters.view}
            onMoviesLoaded={setTotalMovies}
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