'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Zap, 
  History, 
  Sparkles, 
  ChevronDown, 
  RefreshCw, 
  CheckCircle, 
  AlertCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus
} from 'lucide-react';

interface UnifiedAnalysisManagerProps {
  movieId: string;
  movieTitle: string;
  currentScores: Record<string, number>;
  onAnalysisComplete?: () => void;
}

interface AnalysisRecord {
  id: string;
  created_at: string;
  age_scores: Record<string, number>;
  scenes_count: number;
  model_used?: string;
  analysis_duration_ms?: number;
}

export default function UnifiedAnalysisManager({ 
  movieId, 
  movieTitle, 
  currentScores, 
  onAnalysisComplete 
}: UnifiedAnalysisManagerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisSuccess, setAnalysisSuccess] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('');
  const [history, setHistory] = useState<AnalysisRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (isExpanded && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 8,
        left: rect.left + window.scrollX
      });
    }
  }, [isExpanded]);

  useEffect(() => {
    if (showHistory) {
      fetchAnalysisHistory();
    }
  }, [showHistory, movieId]);

  const fetchAnalysisHistory = async () => {
    try {
      const response = await fetch(`/api/movies/analysis-history?movieId=${movieId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch analysis history');
      }
      
      const data = await response.json();
      setHistory(data.history || []);
    } catch (error) {
      console.error('Failed to fetch analysis history:', error);
      // Fallback to empty array if API fails
      setHistory([]);
    }
  };

  const handleRerunAnalysis = async () => {
    if (isAnalyzing) return;

    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisSuccess(false);
    setProgress(0);
    setCurrentStep('Initializing AI analysis...');

    try {
      const progressSteps = [
        { step: '🤖 Connecting to Claude AI...', progress: 15 },
        { step: '📖 Reading movie subtitles...', progress: 30 },
        { step: '🎭 Analyzing emotional content...', progress: 50 },
        { step: '👶 Calculating age appropriateness...', progress: 70 },
        { step: '⏰ Cleaning timestamps...', progress: 85 },
        { step: '💾 Saving results...', progress: 100 }
      ];

      const progressInterval = setInterval(() => {
        const randomStep = progressSteps[Math.floor(Math.random() * progressSteps.length)];
        setCurrentStep(randomStep.step);
        setProgress(randomStep.progress);
      }, 600);

      const baseUrl = window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://tinyviewers.vercel.app';
      const apiUrl = `${baseUrl}/api/movies/analyze-scenes`;
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          movieId: movieId,
          movieTitle: movieTitle
        })
      });

      clearInterval(progressInterval);
      setProgress(100);
      setCurrentStep('✨ Analysis complete!');

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Analysis failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success) {
        setAnalysisSuccess(true);
        setTimeout(() => {
          if (onAnalysisComplete) {
            onAnalysisComplete();
          }
          window.location.reload();
        }, 2000);
      } else {
        throw new Error(result.error || 'Analysis failed');
      }

    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
      setProgress(0);
      setCurrentStep('');
    }
  };

  const getScoreChange = (current: number, previous: number) => {
    if (current > previous) return 'up';
    if (current < previous) return 'down';
    return 'same';
  };

  const getScoreChangeIcon = (change: string) => {
    switch (change) {
      case 'up': return <TrendingUp className="w-3 h-3 text-red-500" />;
      case 'down': return <TrendingDown className="w-3 h-3 text-green-500" />;
      default: return <Minus className="w-3 h-3 text-gray-400" />;
    }
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getAgeLabel = (age: string) => {
    const ageMap: { [key: string]: string } = {
      '24m': '2 years',
      '36m': '3 years', 
      '48m': '4 years',
      '60m': '5 years'
    };
    return ageMap[age] || age;
  };

  const getScoreColor = (score: number) => {
    if (score <= 1) return 'text-green-600 bg-green-50 border-green-200';
    if (score <= 2) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    if (score <= 3) return 'text-orange-600 bg-orange-50 border-orange-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  const getModelColor = (model?: string) => {
    if (!model) return 'text-gray-600 bg-gray-50';
    if (model.includes('Haiku')) return 'text-purple-600 bg-purple-50';
    if (model.includes('Sonnet')) return 'text-blue-600 bg-blue-50';
    return 'text-gray-600 bg-gray-50';
  };

  return (
    <>
      {/* Main Floating Action Button - Mobile optimized */}
      <motion.button
        ref={buttonRef}
        onClick={() => setIsExpanded(!isExpanded)}
        className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-blue-500 to-purple-600 text-white rounded-full shadow-2xl hover:shadow-3xl transition-all duration-300 z-50 flex items-center justify-center group"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        animate={{ 
          boxShadow: [
            "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
            "0 25px 50px -12px rgba(59, 130, 246, 0.25)",
            "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)"
          ]
        }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <motion.div
          animate={{ rotate: isExpanded ? 45 : 0 }}
          transition={{ duration: 0.3 }}
        >
          <Zap className="w-5 h-5 sm:w-6 sm:h-6" />
        </motion.div>
        
        {/* Pulse indicator */}
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute inset-0 bg-white dark:bg-gray-800/30 rounded-full"
        />
      </motion.button>

      {/* Expanded Menu */}
      {isExpanded && createPortal(
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.9 }}
          transition={{ duration: 0.2 }}
          className="fixed bottom-16 right-4 sm:bottom-24 sm:right-6 bg-white dark:bg-gray-800/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200/60 p-3 sm:p-4 z-[9999] min-w-[260px] sm:min-w-[280px]"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <Sparkles className="w-3 h-3 text-white" />
              </div>
              <h3 className="font-semibold text-slate-900">Analysis Tools</h3>
            </div>
            <motion.button
              onClick={() => setIsExpanded(false)}
              className="w-5 h-5 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <span className="text-slate-600 dark:text-slate-300 text-xs">×</span>
            </motion.button>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3">
            {/* Rerun Analysis */}
            <motion.button
              onClick={handleRerunAnalysis}
              disabled={isAnalyzing}
              className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all duration-300 ${
                analysisSuccess 
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                  : analysisError
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : isAnalyzing
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="flex items-center gap-3">
                {isAnalyzing ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  >
                    <RefreshCw className="w-4 h-4" />
                  </motion.div>
                ) : analysisSuccess ? (
                  <CheckCircle className="w-4 h-4" />
                ) : analysisError ? (
                  <AlertCircle className="w-4 h-4" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                <span className="font-medium">
                  {isAnalyzing ? 'Analyzing...' : analysisSuccess ? 'Complete!' : analysisError ? 'Retry' : 'Re-analyze'}
                </span>
              </div>
              {isAnalyzing && (
                <div className="w-16 h-1 bg-blue-200 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-blue-500 rounded-full"
                    initial={{ width: "0%" }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              )}
            </motion.button>

            {/* Analysis History */}
            <motion.button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition-all duration-300"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="flex items-center gap-3">
                <History className="w-4 h-4" />
                <span className="font-medium">Analysis History</span>
              </div>
              <motion.div
                animate={{ rotate: showHistory ? 180 : 0 }}
                transition={{ duration: 0.3 }}
              >
                <ChevronDown className="w-4 h-4" />
              </motion.div>
            </motion.button>
          </div>

          {/* Progress Tooltip */}
          {isAnalyzing && currentStep && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-3 p-2 bg-slate-100 rounded-lg text-xs text-slate-600 dark:text-slate-300"
            >
              {currentStep}
            </motion.div>
          )}
        </motion.div>,
        document.body
      )}

      {/* History Panel */}
      {showHistory && createPortal(
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="fixed bottom-16 right-4 sm:bottom-24 sm:right-6 bg-white dark:bg-gray-800/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200/60 p-4 sm:p-6 z-[9999] max-w-[calc(100vw-2rem)] sm:max-w-md"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <History className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Analysis Timeline</h3>
                <p className="text-xs text-slate-500">{movieTitle}</p>
              </div>
            </div>
            <motion.button
              onClick={() => setShowHistory(false)}
              className="w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <span className="text-slate-600 dark:text-slate-300 text-sm">×</span>
            </motion.button>
          </div>

          {/* Timeline */}
          <div className="space-y-4">
            {history.map((record, index) => {
              const previousRecord = history[index + 1];
              const isLatest = index === 0;
              
              return (
                <motion.div
                  key={record.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className={`relative ${isLatest ? 'ring-2 ring-blue-200 bg-blue-50/50' : 'bg-slate-50/50'} rounded-xl p-4 border border-slate-200/60`}
                >
                  {/* Timeline connector */}
                  {index < history.length - 1 && (
                    <div className="absolute -bottom-4 left-6 w-0.5 h-4 bg-gradient-to-b from-slate-300 to-transparent" />
                  )}
                  
                  {/* Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-slate-500" />
                      <span className="text-sm font-medium text-slate-700">
                        {formatDate(record.created_at)}
                      </span>
                      <span className="text-xs text-slate-400">
                        {formatTime(record.created_at)}
                      </span>
                    </div>
                    {record.model_used && (
                      <div className={`px-2 py-1 rounded-lg text-xs font-medium ${getModelColor(record.model_used)}`}>
                        {record.model_used}
                      </div>
                    )}
                  </div>

                  {/* Scores Grid */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {Object.entries(record.age_scores).map(([age, score]) => {
                      const change = previousRecord ? getScoreChange(score, previousRecord.age_scores[age]) : 'same';
                      
                      return (
                        <div key={age} className="flex items-center justify-between">
                          <span className="text-xs text-slate-600 dark:text-slate-300">{getAgeLabel(age)}</span>
                          <div className="flex items-center gap-1">
                            <span className={`px-2 py-1 rounded-md text-xs font-semibold border ${getScoreColor(score)}`}>
                              {score}
                            </span>
                            {previousRecord && (
                              <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ delay: 0.2 + index * 0.1 }}
                              >
                                {getScoreChangeIcon(change)}
                              </motion.div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <div className="flex items-center gap-3">
                      <span>{record.scenes_count} scenes analyzed</span>
                      {record.analysis_duration_ms && (
                        <span>⏱️ {(record.analysis_duration_ms / 1000).toFixed(1)}s</span>
                      )}
                    </div>
                    {isLatest && (
                      <motion.div
                        animate={{ scale: [1, 1.1, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="flex items-center gap-1 text-blue-600"
                      >
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
                        Latest
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="mt-6 pt-4 border-t border-slate-200/60">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{history.length} total analyses</span>
              <div className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-green-500" />
                <span>Improving over time</span>
              </div>
            </div>
          </div>
        </motion.div>,
        document.body
      )}
    </>
  );
}
