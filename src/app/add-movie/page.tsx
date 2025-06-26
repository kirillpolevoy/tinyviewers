'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';

interface ProcessingStep {
  id: string;
  label: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  message?: string;
}

interface SubtitleUpload {
  type: 'file' | 'text';
  content: string;
}

export default function AddMoviePage() {
  const [imdbUrl, setImdbUrl] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processCompleted, setProcessCompleted] = useState(false);
  const [movieId, setMovieId] = useState<string | null>(null);
  const [movieTitle, setMovieTitle] = useState<string | null>(null);
  const [needsSubtitles, setNeedsSubtitles] = useState(false);
  const [subtitleUpload, setSubtitleUpload] = useState<SubtitleUpload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existingMovie, setExistingMovie] = useState<{id: string, title: string} | null>(null);
  
  const [steps, setSteps] = useState<ProcessingStep[]>([
    { id: 'validate', label: 'Validating IMDB URL', status: 'pending' },
    { id: 'check-exists', label: 'Checking if movie already exists', status: 'pending' },
    { id: 'fetch-metadata', label: 'Fetching movie metadata', status: 'pending' },
    { id: 'create-movie', label: 'Creating movie record', status: 'pending' },
    { id: 'scrape-subtitles', label: 'Scraping subtitles', status: 'pending' },
    { id: 'validate-data', label: 'Validating movie data', status: 'pending' },
    { id: 'analyze-scenes', label: 'Analyzing scenes with AI', status: 'pending' },
    { id: 'validate-scenes', label: 'Validating scene analysis', status: 'pending' },
  ]);

  const updateStep = (stepId: string, status: ProcessingStep['status'], message?: string) => {
    setSteps(prev => prev.map(step => 
      step.id === stepId ? { ...step, status, message } : step
    ));
  };

  const extractImdbId = (url: string): string | null => {
    const patterns = [
      /imdb\.com\/title\/(tt\d+)/,
      /imdb\.com\/title\/(tt\d+)\//,
      /^(tt\d+)$/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  };

  const validateImdbUrl = (url: string): boolean => {
    return extractImdbId(url) !== null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imdbUrl.trim()) return;

    setError(null);
    setIsProcessing(true);
    setProcessCompleted(false);
    setNeedsSubtitles(false);
    setSubtitleUpload(null);

    try {
      // Step 1: Validate IMDB URL
      updateStep('validate', 'processing');
      const imdbId = extractImdbId(imdbUrl.trim());
      if (!imdbId) {
        updateStep('validate', 'error', 'Invalid IMDB URL format');
        setError('Please enter a valid IMDB URL (e.g., https://www.imdb.com/title/tt0398286/)');
        return;
      }
      updateStep('validate', 'completed', `Extracted IMDB ID: ${imdbId}`);

      // Step 2: Check if movie already exists
      updateStep('check-exists', 'processing');
      const existsResponse = await fetch('/api/movies/check-exists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imdbId })
      });
      
      const existsData = await existsResponse.json();
      if (existsData.exists) {
        updateStep('check-exists', 'error', `Movie already exists: ${existsData.title}`);
        setError(`This movie "${existsData.title}" already exists in our database.`);
        setExistingMovie({ id: existsData.movieId, title: existsData.title });
        return;
      }
      updateStep('check-exists', 'completed', 'Movie not found in database - proceeding');

      // Step 3: Fetch movie metadata from TMDB
      updateStep('fetch-metadata', 'processing');
      const metadataResponse = await fetch('/api/movies/fetch-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imdbId })
      });
      
      if (!metadataResponse.ok) {
        throw new Error('Failed to fetch movie metadata');
      }
      
      const metadataData = await metadataResponse.json();
      updateStep('fetch-metadata', 'completed', `Found: ${metadataData.title}`);
      setMovieTitle(metadataData.title);

      // Step 4: Create movie record
      updateStep('create-movie', 'processing');
      const createResponse = await fetch('/api/movies/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          imdbId,
          metadata: metadataData
        })
      });
      
      if (!createResponse.ok) {
        throw new Error('Failed to create movie record');
      }
      
      const createData = await createResponse.json();
      updateStep('create-movie', 'completed', 'Movie record created');
      setMovieId(createData.movieId);

      // Step 5: Scrape subtitles
      updateStep('scrape-subtitles', 'processing');
      const subtitlesResponse = await fetch('/api/movies/scrape-subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          movieId: createData.movieId,
          imdbId,
          title: metadataData.title
        })
      });
      
      const subtitlesData = await subtitlesResponse.json();
      if (subtitlesData.success) {
        updateStep('scrape-subtitles', 'completed', 'Subtitles found and saved');
      } else {
        updateStep('scrape-subtitles', 'error', 'No subtitles found - manual upload required');
        setNeedsSubtitles(true);
        return; // Stop here until user provides subtitles
      }

      await completeProcessing(createData.movieId);

    } catch (error) {
      console.error('Error processing movie:', error);
      setError(error instanceof Error ? error.message : 'An unexpected error occurred');
    } finally {
      setIsProcessing(false);
    }
  };

  const completeProcessing = async (movieId: string) => {
    try {
      // Step 6: Validate movie data
      updateStep('validate-data', 'processing');
      const validateResponse = await fetch('/api/movies/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movieId })
      });
      
      const validateData = await validateResponse.json();
      if (!validateData.valid) {
        updateStep('validate-data', 'error', validateData.reason);
        setError(`Data validation failed: ${validateData.reason}`);
        return;
      }
      updateStep('validate-data', 'completed', 'Movie and subtitle data is valid');

      // Step 7: Run Claude analysis
      updateStep('analyze-scenes', 'processing');
      const analysisResponse = await fetch('/api/movies/analyze-scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movieId })
      });
      
      if (!analysisResponse.ok) {
        throw new Error('Scene analysis failed');
      }
      
      const analysisData = await analysisResponse.json();
      updateStep('analyze-scenes', 'completed', `Generated ${analysisData.scenesCount} scenes`);

      // Step 8: Validate scene analysis
      updateStep('validate-scenes', 'processing');
      if (analysisData.scenesCount < 5) {
        updateStep('validate-scenes', 'error', `Only ${analysisData.scenesCount} scenes generated (minimum 5 required)`);
        setError(`Scene analysis incomplete - only ${analysisData.scenesCount} scenes generated. Minimum 5 required.`);
        return;
      }
      updateStep('validate-scenes', 'completed', `${analysisData.scenesCount} scenes validated`);

      setProcessCompleted(true);
    } catch (error) {
      console.error('Error completing processing:', error);
      setError(error instanceof Error ? error.message : 'Failed to complete processing');
    }
  };

  const handleSubtitleUpload = async (upload: SubtitleUpload) => {
    if (!movieId) return;

    try {
      setIsProcessing(true);
      
      // Upload subtitles
      const uploadResponse = await fetch('/api/movies/upload-subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          movieId,
          subtitleText: upload.content,
          source: upload.type === 'file' ? 'manual_file' : 'manual_text'
        })
      });
      
      if (!uploadResponse.ok) {
        throw new Error('Failed to upload subtitles');
      }
      
      updateStep('scrape-subtitles', 'completed', 'Manual subtitles uploaded');
      setNeedsSubtitles(false);
      
      // Continue with processing
      await completeProcessing(movieId);
      
    } catch (error) {
      console.error('Error uploading subtitles:', error);
      setError(error instanceof Error ? error.message : 'Failed to upload subtitles');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.srt')) {
      setError('Please upload a .srt subtitle file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        setSubtitleUpload({ type: 'file', content });
      }
    };
    reader.readAsText(file);
  };

  const getStepIcon = (status: ProcessingStep['status']) => {
    switch (status) {
      case 'completed': return '✅';
      case 'processing': return '⏳';
      case 'error': return '❌';
      default: return '⭕';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-purple-50/30">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-white/95 shadow-sm border-b border-slate-200/60">
        <div className="mx-auto max-w-4xl flex items-center justify-between px-4 sm:px-6 py-4">
          <Link href="/" className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2 hover:scale-105 transition-transform duration-300">
            🧸 <span className="text-slate-800">Tiny Viewers</span>
          </Link>
          <Link 
            href="/movies"
            className="text-slate-600 hover:text-purple-600 transition-colors duration-300 px-3 py-2 rounded-full hover:bg-purple-50"
          >
            Back to Movies
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 pb-20 sm:pb-24">
        {/* Hero Section */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="mb-8 sm:mb-12 text-center"
        >
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-light text-slate-900 mb-3 sm:mb-4 tracking-tight px-4">
            <span className="text-transparent bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text">
              Add New Movie
            </span>
          </h1>
          <p className="text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed px-4">
            Add a new toddler-friendly movie to our collection by providing its IMDB link
          </p>
        </motion.div>

        {!processCompleted ? (
          <div className="bg-white/80 backdrop-blur-sm rounded-3xl border border-slate-200 shadow-lg p-4 sm:p-6 lg:p-8">
            {/* IMDB URL Input */}
            {!isProcessing && !needsSubtitles && (
              <form onSubmit={handleSubmit} className="mb-8">
                <label htmlFor="imdb-url" className="block text-sm font-medium text-slate-700 mb-3">
                  IMDB Movie URL <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        id="imdb-url"
                        value={imdbUrl}
                        onChange={(e) => setImdbUrl(e.target.value)}
                        placeholder="https://www.imdb.com/title/tt0398286/ or just tt0398286"
                        className="w-full px-4 py-4 sm:py-3 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-300 transition-all duration-300 pr-12 text-base min-h-[48px]"
                        required
                      />
                      {/* URL validation indicator */}
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        {imdbUrl && (
                          validateImdbUrl(imdbUrl) ? (
                            <span className="text-green-500 text-lg">✓</span>
                          ) : (
                            <span className="text-red-400 text-lg">⚠</span>
                          )
                        )}
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={!imdbUrl.trim() || !validateImdbUrl(imdbUrl)}
                      className="w-full sm:w-auto px-6 py-4 sm:py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl hover:shadow-lg transition-all duration-300 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98] min-h-[48px] sm:min-w-[140px]"
                    >
                      <span className="flex items-center justify-center gap-2">
                        <span>Add Movie</span>
                        <span className="text-lg">🎬</span>
                      </span>
                    </button>
                  </div>
                  
                  {/* Enhanced help text with examples */}
                  <div className="mt-4 space-y-3">
                    <p className="text-sm text-slate-500 text-center sm:text-left">
                      💡 <strong>Tip:</strong> Just paste any IMDB URL or movie ID
                    </p>
                    <div className="flex flex-wrap justify-center sm:justify-start gap-2">
                      <button
                        type="button"
                        onClick={() => setImdbUrl('https://www.imdb.com/title/tt0398286/')}
                        className="text-sm px-3 py-2 bg-purple-50 text-purple-600 rounded-full hover:bg-purple-100 transition-colors min-h-[36px] flex-shrink-0"
                      >
                        Try: Tangled
                      </button>
                      <button
                        type="button"
                        onClick={() => setImdbUrl('tt3521164')}
                        className="text-sm px-3 py-2 bg-purple-50 text-purple-600 rounded-full hover:bg-purple-100 transition-colors min-h-[36px] flex-shrink-0"
                      >
                        Try: Moana
                      </button>
                      <button
                        type="button"
                        onClick={() => setImdbUrl('tt2948356')}
                        className="text-sm px-3 py-2 bg-purple-50 text-purple-600 rounded-full hover:bg-purple-100 transition-colors min-h-[36px] flex-shrink-0"
                      >
                        Try: Zootopia
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            )}

            {/* Subtitle Upload Section */}
            <AnimatePresence>
              {needsSubtitles && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-8 p-6 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl"
                >
                  <div className="text-center mb-6">
                    <div className="text-4xl mb-3">📝</div>
                    <h3 className="text-lg sm:text-xl font-semibold text-amber-800 mb-2">
                      Subtitles Required
                    </h3>
                    <p className="text-sm sm:text-base text-amber-700 px-2">
                      We couldn't find subtitles for <strong>"{movieTitle}"</strong>. 
                      <br />No worries! You can easily provide them manually:
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* File Upload */}
                    <div className="space-y-3">
                      <label className="block text-sm font-semibold text-amber-800 mb-3">
                        📁 Upload .srt file
                      </label>
                      <div className="relative">
                        <input
                          type="file"
                          accept=".srt"
                          onChange={handleFileUpload}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <div className="border-2 border-dashed border-amber-300 rounded-xl p-6 sm:p-8 text-center hover:border-amber-400 hover:bg-amber-25 transition-all duration-300 bg-white/50 min-h-[120px] flex flex-col justify-center">
                          <div className="text-2xl sm:text-3xl mb-2">📎</div>
                          <div className="text-amber-700 font-medium mb-1 text-sm sm:text-base">Drop your .srt file here</div>
                          <div className="text-xs sm:text-sm text-amber-600">or click to browse</div>
                        </div>
                      </div>
                      {subtitleUpload?.type === 'file' && (
                        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                          <div className="text-sm text-green-800">
                            ✓ File loaded ({subtitleUpload.content.length} characters)
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Divider - Only show on mobile */}
                    <div className="relative lg:hidden">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-amber-200"></div>
                      </div>
                      <div className="relative flex justify-center text-sm">
                        <span className="px-2 bg-gradient-to-r from-amber-50 to-orange-50 text-amber-600">OR</span>
                      </div>
                    </div>

                    {/* Text Input */}
                    <div className="space-y-3">
                      <label className="block text-sm font-semibold text-amber-800 mb-3">
                        ✏️ Paste subtitle text
                      </label>
                      <textarea
                        rows={6}
                        value={subtitleUpload?.type === 'text' ? subtitleUpload.content : ''}
                        onChange={(e) => setSubtitleUpload({ type: 'text', content: e.target.value })}
                        placeholder="1&#10;00:00:01,000 --> 00:00:04,000&#10;Your subtitle text here...&#10;&#10;2&#10;00:00:05,000 --> 00:00:08,000&#10;More subtitle text..."
                        className="w-full px-4 py-3 bg-white/80 border border-amber-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-400 transition-all duration-300 font-mono text-sm resize-none"
                      />
                      <div className="text-xs text-amber-600 text-center sm:text-left">
                        💡 Paste SRT format with timestamps
                      </div>
                    </div>
                  </div>

                  {subtitleUpload && subtitleUpload.content.trim() && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-6 text-center"
                    >
                      <button
                        onClick={() => handleSubtitleUpload(subtitleUpload)}
                        disabled={isProcessing}
                        className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl hover:shadow-lg transition-all duration-300 font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98] min-h-[48px] sm:min-w-[220px]"
                      >
                        <span className="flex items-center justify-center gap-2">
                          {isProcessing ? (
                            <>
                              <motion.div
                                className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                                animate={{ rotate: 360 }}
                                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                              />
                              <span>Processing...</span>
                            </>
                          ) : (
                            <>
                              <span>🚀 Continue with Subtitles</span>
                            </>
                          )}
                        </span>
                      </button>
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Processing Steps */}
            {(isProcessing || steps.some(step => step.status !== 'pending')) && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <h3 className="text-lg font-medium text-slate-800">Processing Movie</h3>
                  <div className="text-sm text-slate-500">
                    {steps.filter(s => s.status === 'completed').length} of {steps.length} steps completed ({Math.round((steps.filter(s => s.status === 'completed').length / steps.length) * 100)}%)
                  </div>
                </div>
                
                {/* Overall Progress Bar */}
                <div className="w-full bg-slate-200 rounded-full h-3 mb-6">
                  <motion.div
                    className="bg-gradient-to-r from-purple-500 to-pink-500 h-3 rounded-full transition-all duration-500"
                    initial={{ width: 0 }}
                    animate={{ 
                      width: `${(steps.filter(s => s.status === 'completed').length / steps.length) * 100}%` 
                    }}
                  />
                </div>

                <div className="space-y-3">
                  {steps.map((step, index) => (
                    <motion.div
                      key={step.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className={`relative flex items-start gap-3 sm:gap-4 p-4 sm:p-5 rounded-xl border transition-all duration-300 ${
                        step.status === 'completed' ? 'bg-green-50 border-green-200' :
                        step.status === 'processing' ? 'bg-blue-50 border-blue-200 ring-2 ring-blue-100' :
                        step.status === 'error' ? 'bg-red-50 border-red-200' :
                        'bg-slate-50 border-slate-200'
                      }`}
                    >
                      {/* Step Icon with Animation */}
                      <div className={`relative flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-sm font-medium ${
                        step.status === 'completed' ? 'bg-green-500 text-white' :
                        step.status === 'processing' ? 'bg-blue-500 text-white' :
                        step.status === 'error' ? 'bg-red-500 text-white' :
                        'bg-slate-300 text-slate-600'
                      }`}>
                        {step.status === 'processing' && (
                          <motion.div
                            className="absolute inset-0 rounded-full border-2 border-blue-300 border-t-transparent"
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                          />
                        )}
                        <span className="relative z-10 text-xs sm:text-sm">
                          {step.status === 'completed' ? '✓' : 
                           step.status === 'processing' ? '⋯' :
                           step.status === 'error' ? '✕' : index + 1}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 mb-1">
                          <div className="font-medium text-slate-800 text-sm sm:text-base">{step.label}</div>
                          {step.status === 'processing' && (
                            <div className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full self-start sm:self-auto">
                              Processing...
                            </div>
                          )}
                        </div>
                        {step.message && (
                          <div className={`text-sm ${
                            step.status === 'error' ? 'text-red-600' : 'text-slate-600'
                          }`}>
                            {step.message}
                          </div>
                        )}
                        
                        {/* Time estimates for processing steps */}
                        {step.status === 'processing' && (
                          <div className="text-xs text-slate-500 mt-1">
                            {step.id === 'analyze-scenes' ? 'This may take 2-3 minutes...' :
                             step.id === 'scrape-subtitles' ? 'This may take 30-60 seconds...' :
                             'Please wait...'}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 p-4 sm:p-6 bg-red-50 border border-red-200 rounded-xl"
              >
                <div className="flex items-start gap-3 sm:gap-4">
                  <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                    <span className="text-red-600 text-xl">⚠️</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-red-800 mb-2">Oops! Something went wrong</div>
                    <div className="text-red-700 text-sm mb-4">{error}</div>
                    
                    {/* Recovery Actions */}
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        onClick={() => {
                          setError(null);
                          if (!processCompleted) {
                            setSteps(prev => prev.map(step => ({ ...step, status: 'pending' as const, message: undefined })));
                            setIsProcessing(false);
                            setNeedsSubtitles(false);
                          }
                        }}
                        className="flex-1 px-4 py-3 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors text-sm font-medium min-h-[44px] flex items-center justify-center"
                      >
                        Try Again
                      </button>
                      <button
                        onClick={() => {
                          setError(null);
                          setImdbUrl('');
                          setProcessCompleted(false);
                          setSteps(prev => prev.map(step => ({ ...step, status: 'pending' as const, message: undefined })));
                          setIsProcessing(false);
                          setNeedsSubtitles(false);
                          setMovieId(null);
                          setMovieTitle(null);
                        }}
                        className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors text-sm font-medium min-h-[44px] flex items-center justify-center"
                      >
                        Start Over
                      </button>
                    </div>
                    
                    {/* Troubleshooting Tips */}
                    <details className="mt-4">
                      <summary className="text-sm text-red-600 cursor-pointer hover:text-red-800 py-2">
                        💡 Troubleshooting Tips
                      </summary>
                      <div className="mt-2 text-sm text-red-600 space-y-1 pl-4">
                        <p>• Make sure the IMDB URL is correct and the movie exists</p>
                        <p>• Check your internet connection</p>
                        <p>• Try using just the movie ID (e.g., tt0398286) instead of the full URL</p>
                        <p>• Some very new or obscure movies might not have subtitle data available</p>
                      </div>
                    </details>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        ) : (
          /* Success State */
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-6"
          >
            {/* Success Header */}
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-3xl p-6 sm:p-8 text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.3, type: "spring", stiffness: 200 }}
                className="text-5xl sm:text-6xl mb-4"
              >
                🎉
              </motion.div>
              <h2 className="text-2xl sm:text-3xl font-light text-green-800 mb-4">
                Movie Added Successfully!
              </h2>
              <p className="text-green-700 mb-6 text-base sm:text-lg">
                "{movieTitle}" has been processed and is now available in your library
              </p>
              
              {/* Key Stats */}
              <div className="flex flex-col sm:flex-row justify-center gap-4 sm:gap-6 mb-8">
                <div className="text-center">
                  <div className="text-sm text-green-600 font-medium">Analysis Complete</div>
                  <div className="text-lg font-bold text-green-800">✓ AI Scenes</div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-green-600 font-medium">Age Ratings</div>
                  <div className="text-lg font-bold text-green-800">✓ Generated</div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-green-600 font-medium">Subtitles</div>
                  <div className="text-lg font-bold text-green-800">✓ Processed</div>
                </div>
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href={`/movies/${movieId}`}
                className="flex-1 px-8 py-4 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-xl hover:shadow-lg transition-all duration-300 font-medium text-center hover:scale-[1.02] active:scale-[0.98] min-h-[48px] flex items-center justify-center"
              >
                <span className="flex items-center justify-center gap-2">
                  <span>🔍 View Movie Details</span>
                </span>
              </Link>
              <Link
                href="/movies"
                className="flex-1 px-8 py-4 bg-white text-slate-700 border border-slate-300 rounded-xl hover:bg-slate-50 transition-all duration-300 font-medium text-center hover:scale-[1.02] active:scale-[0.98] min-h-[48px] flex items-center justify-center"
              >
                <span className="flex items-center justify-center gap-2">
                  <span>📚 Browse All Movies</span>
                </span>
              </Link>
              <button
                onClick={() => {
                  setProcessCompleted(false);
                  setImdbUrl('');
                  setSteps(prev => prev.map(step => ({ ...step, status: 'pending' as const, message: undefined })));
                  setError(null);
                  setMovieId(null);
                  setMovieTitle(null);
                }}
                className="flex-1 px-8 py-4 bg-purple-50 text-purple-700 border border-purple-200 rounded-xl hover:bg-purple-100 transition-all duration-300 font-medium text-center hover:scale-[1.02] active:scale-[0.98] min-h-[48px] flex items-center justify-center"
              >
                <span className="flex items-center justify-center gap-2">
                  <span>➕ Add Another Movie</span>
                </span>
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
} 