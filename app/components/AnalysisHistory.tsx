'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { History, Clock, TrendingUp, TrendingDown, Minus, Calendar, Sparkles, Zap } from 'lucide-react';

interface AnalysisHistoryProps {
  movieId: string;
  movieTitle: string;
  currentScores: Record<string, number>;
}

interface AnalysisRecord {
  id: string;
  created_at: string;
  age_scores: Record<string, number>;
  scenes_count: number;
  model?: string;
}

export default function AnalysisHistory({ movieId, movieTitle, currentScores }: AnalysisHistoryProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [history, setHistory] = useState<AnalysisRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (isOpen) {
      fetchAnalysisHistory();
    }
  }, [isOpen, movieId]);

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 8,
        left: rect.left + window.scrollX
      });
    }
  }, [isOpen]);

  const fetchAnalysisHistory = async () => {
    setIsLoading(true);
    try {
      // Enhanced mock data with more realistic progression
      const mockHistory: AnalysisRecord[] = [
        {
          id: '1',
          created_at: new Date().toISOString(),
          age_scores: currentScores,
          scenes_count: 12,
          model: 'Claude 3.5 Haiku'
        },
        {
          id: '2',
          created_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
          age_scores: { '24m': 4, '36m': 3, '48m': 2, '60m': 1 },
          scenes_count: 10,
          model: 'Claude 3.5 Sonnet'
        },
        {
          id: '3',
          created_at: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
          age_scores: { '24m': 5, '36m': 4, '48m': 3, '60m': 2 },
          scenes_count: 8,
          model: 'Claude 3.5 Sonnet'
        }
      ];
      setHistory(mockHistory);
    } catch (error) {
      console.error('Failed to fetch analysis history:', error);
    } finally {
      setIsLoading(false);
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
      <motion.button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-2 bg-white/90 backdrop-blur-sm text-slate-700 px-4 py-2 rounded-xl hover:bg-white hover:border-slate-300 border border-slate-200/60 shadow-lg hover:shadow-xl transition-all duration-300 text-sm font-medium"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.3 }}
        >
          <History className="w-4 h-4" />
        </motion.div>
        <span>Analysis History</span>
        <motion.div
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="w-2 h-2 bg-blue-500 rounded-full"
        />
      </motion.button>

      {isOpen && createPortal(
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="fixed bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200/60 p-6 z-[9999] max-w-md"
          style={{
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            transform: 'translateX(-50%)'
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Analysis Timeline</h3>
                <p className="text-xs text-slate-500">{movieTitle}</p>
              </div>
            </div>
            <motion.button
              onClick={() => setIsOpen(false)}
              className="w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <span className="text-slate-600 text-sm">×</span>
            </motion.button>
          </div>

          {/* Timeline */}
          <div className="space-y-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-6 h-6 border-2 border-blue-200 border-t-blue-600 rounded-full"
                />
              </div>
            ) : (
              history.map((record, index) => {
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
                      {record.model && (
                        <div className={`px-2 py-1 rounded-lg text-xs font-medium ${getModelColor(record.model)}`}>
                          {record.model}
                        </div>
                      )}
                    </div>

                    {/* Scores Grid */}
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {Object.entries(record.age_scores).map(([age, score]) => {
                        const change = previousRecord ? getScoreChange(score, previousRecord.age_scores[age]) : 'same';
                        
                        return (
                          <div key={age} className="flex items-center justify-between">
                            <span className="text-xs text-slate-600">{getAgeLabel(age)}</span>
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
                      <span>{record.scenes_count} scenes analyzed</span>
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
              })
            )}
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