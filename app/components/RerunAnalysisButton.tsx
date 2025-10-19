'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Sparkles, CheckCircle, AlertCircle, Zap } from 'lucide-react';

interface RerunAnalysisButtonProps {
  movieId: string;
  movieTitle: string;
  onAnalysisComplete?: () => void;
  variant?: 'primary' | 'secondary' | 'minimal' | 'floating';
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
}

export default function RerunAnalysisButton({
  movieId,
  movieTitle,
  onAnalysisComplete,
  variant = 'floating',
  size = 'md',
  showText = true
}: RerunAnalysisButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('');
  const [showTooltip, setShowTooltip] = useState(false);

  // Reset error state when component mounts or movieId changes
  React.useEffect(() => {
    setError(null);
    setIsSuccess(false);
  }, [movieId]);

  const handleRerunAnalysis = async () => {
    if (isLoading) return;

    // Reset all states
    setIsLoading(true);
    setError(null);
    setIsSuccess(false);
    setProgress(0);
    setCurrentStep('Initializing AI analysis...');

    try {
      console.log(`🔄 Rerunning analysis for: ${movieTitle}`);
      console.log(`🆔 Movie ID: ${movieId}`);
      
      // Enhanced progress steps with more personality
      const progressSteps = [
        { step: '🤖 Connecting to Claude AI...', progress: 15 },
        { step: '📖 Reading movie subtitles...', progress: 30 },
        { step: '🎭 Analyzing emotional content...', progress: 50 },
        { step: '👶 Calculating age appropriateness...', progress: 70 },
        { step: '⏰ Cleaning timestamps...', progress: 85 },
        { step: '💾 Saving results...', progress: 100 }
      ];

      // Simulate progress updates with personality
      const progressInterval = setInterval(() => {
        const randomStep = progressSteps[Math.floor(Math.random() * progressSteps.length)];
        setCurrentStep(randomStep.step);
        setProgress(randomStep.progress);
      }, 600);

      // Check if we're in development or production
      const baseUrl = window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://tinyviewers.vercel.app';
      const apiUrl = `${baseUrl}/api/movies/analyze-scenes`;
      
      console.log(`🌐 API URL: ${apiUrl}`);
      
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

      console.log(`📡 Response status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error:', response.status, errorText);
        throw new Error(`Analysis failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`📊 API Response:`, result);

      if (result.success) {
        console.log('✅ Analysis completed successfully!');
        console.log(`📊 New Overall Scores: ${JSON.stringify(result.overallScores)}`);
        console.log(`🎬 New Scenes: ${result.scenesCount} scenes`);
        
        setIsSuccess(true);
        
        // Call the completion callback after a short delay
        setTimeout(() => {
          if (onAnalysisComplete) {
            onAnalysisComplete();
          }
          // Refresh the page to show updated data
          window.location.reload();
        }, 2000);
        
      } else {
        throw new Error(result.error || 'Analysis failed');
      }

    } catch (err) {
      console.error('❌ Rerun analysis failed:', err);
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsLoading(false);
      setProgress(0);
      setCurrentStep('');
    }
  };

  const getButtonContent = () => {
    if (isSuccess) {
      return (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="flex items-center gap-2"
        >
          <CheckCircle className="w-4 h-4 text-emerald-600" />
          {showText && (
            <motion.span
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="text-emerald-700 font-medium"
            >
              Complete!
            </motion.span>
          )}
        </motion.div>
      );
    }
    
    if (error) {
      return (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 text-red-500" />
          {showText && (
            <motion.span
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="text-red-600 font-medium"
            >
              Retry
            </motion.span>
          )}
        </motion.div>
      );
    }
    
    if (isLoading) {
      return (
        <div className="flex items-center gap-2">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          >
            <RefreshCw className="w-4 h-4 text-blue-600" />
          </motion.div>
          {showText && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="text-blue-700 font-medium"
            >
              Analyzing...
            </motion.span>
          )}
        </div>
      );
    }
    
    return (
      <div className="flex items-center gap-2">
        <motion.div
          animate={{ 
            rotate: [0, 10, -10, 0],
            scale: [1, 1.1, 1]
          }}
          transition={{ 
            duration: 2, 
            repeat: Infinity, 
            ease: "easeInOut" 
          }}
        >
          <Sparkles className="w-4 h-4 text-purple-600" />
        </motion.div>
        {showText && (
          <span className="text-slate-700 font-medium">Re-analyze</span>
        )}
      </div>
    );
  };

  const getButtonStyles = () => {
    const baseStyles = "inline-flex items-center justify-center font-medium transition-all duration-300 rounded-xl border relative overflow-hidden group";
    
    if (isSuccess) {
      return `${baseStyles} bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 shadow-sm hover:shadow-md`;
    }
    
    if (error) {
      return `${baseStyles} bg-red-50 text-red-700 border-red-200 hover:bg-red-100 shadow-sm hover:shadow-md`;
    }
    
    if (isLoading) {
      return `${baseStyles} bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 shadow-sm hover:shadow-md`;
    }
    
    if (variant === 'floating') {
      return `${baseStyles} bg-white/90 backdrop-blur-sm text-slate-700 border-slate-200/60 hover:bg-white hover:border-slate-300 shadow-lg hover:shadow-xl`;
    }
    
    return `${baseStyles} bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-700`;
  };

  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return 'px-3 py-1.5 text-sm';
      case 'lg':
        return 'px-6 py-3 text-base';
      default:
        return 'px-4 py-2 text-sm';
    }
  };

  return (
    <div className="relative">
      <motion.button
        onClick={handleRerunAnalysis}
        disabled={isLoading}
        className={`${getButtonStyles()} ${getSizeStyles()}`}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {getButtonContent()}
        
        {/* Progress bar overlay */}
        {isLoading && (
          <motion.div
            className="absolute bottom-0 left-0 h-1 bg-blue-400/30 rounded-full"
            initial={{ width: "0%" }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        )}
      </motion.button>

      {/* Enhanced tooltip */}
      <AnimatePresence>
        {showTooltip && currentStep && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.9 }}
            transition={{ duration: 0.2 }}
            className="absolute -top-14 left-1/2 transform -translate-x-1/2 bg-slate-900 text-white text-xs px-3 py-2 rounded-lg shadow-xl whitespace-nowrap z-50"
          >
            {currentStep}
            <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-900"></div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
