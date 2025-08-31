'use client';

import React, { useState, useEffect } from 'react';
import { Heart, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';

interface SaveButtonProps {
  movieId: string;
  movieTitle?: string;
  size?: 'sm' | 'md' | 'lg';
}

export default function SaveButton({ movieId, movieTitle, size = 'md' }: SaveButtonProps) {
  const [isSaved, setIsSaved] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const sizeClasses = {
    sm: 'p-1.5',
    md: 'p-2',
    lg: 'p-3'
  };

  const iconSizes = {
    sm: 16,
    md: 20,
    lg: 24
  };

  useEffect(() => {
    checkAuthAndSavedStatus();
  }, [movieId]);

  const checkAuthAndSavedStatus = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      
      if (user) {
        // Check if movie is already saved
        try {
          const { data, error } = await supabase
            .from('saved_movies')
            .select('id')
            .eq('user_id', user.id)
            .eq('movie_id', movieId)
            .single();
          
          if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
            console.warn('Error checking saved status:', error);
            setIsSaved(false);
          } else {
            setIsSaved(!!data);
          }
        } catch (error) {
          console.warn('Could not check saved status:', error);
          setIsSaved(false);
        }
      }
    } catch (error) {
      console.error('Error checking auth:', error);
    }
  };

  const handleSaveToggle = async () => {
    if (!user) {
      // Could trigger auth modal here
      return;
    }

    setIsLoading(true);
    
    try {
      if (isSaved) {
        // Remove from saved movies
        const { error } = await supabase
          .from('saved_movies')
          .delete()
          .eq('user_id', user.id)
          .eq('movie_id', movieId);
        
        if (error) {
          console.error('Error removing saved movie:', error);
          throw error;
        }
        
        setIsSaved(false);
        
        // Trigger refresh of saved count in auth button
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('refreshSavedCount'));
        }
      } else {
        // Add to saved movies
        const { error } = await supabase
          .from('saved_movies')
          .insert({
            user_id: user.id,
            movie_id: movieId
          });
        
        if (error) {
          console.error('Error saving movie:', error);
          throw error;
        }
        
        setIsSaved(true);
        setJustSaved(true);
        setShowSuccess(true);
        
        // Trigger refresh of saved count in auth button
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('refreshSavedCount'));
        }
        
        // Hide success animation after 2 seconds
        setTimeout(() => setShowSuccess(false), 2000);
        setTimeout(() => setJustSaved(false), 600);
      }
    } catch (error) {
      console.warn('Error toggling save status:', error);
      // Revert UI state on error
      setIsSaved(!isSaved);
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) {
    return null; // Don't show save button for unauthenticated users
  }

  return (
    <div className="relative">
      <motion.button
        onClick={handleSaveToggle}
        disabled={isLoading}
        whileHover={{ scale: isLoading ? 1 : 1.1 }}
        whileTap={{ scale: 0.95 }}
        animate={{ 
          scale: justSaved ? [1, 1.3, 1] : 1,
          rotate: justSaved ? [0, -10, 10, 0] : 0
        }}
        transition={{ 
          duration: 0.6, 
          ease: "easeOut",
          scale: { type: "spring", stiffness: 400, damping: 17 }
        }}
        className={`
          ${sizeClasses[size]}
          rounded-full
          transition-all duration-300
          relative
          ${isSaved 
            ? 'text-red-500 hover:text-red-600 bg-red-50 hover:bg-red-100 shadow-lg shadow-red-100' 
            : 'text-gray-400 hover:text-red-500 bg-gray-50 hover:bg-red-50'
          }
          ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
          ${justSaved ? 'bg-gradient-to-r from-red-400 to-pink-400 text-white shadow-lg' : ''}
        `}
        title={isSaved ? 'Remove from library' : 'Save to library'}
      >
        <Heart 
          size={iconSizes[size]} 
          fill={isSaved ? 'currentColor' : 'none'}
          className={isLoading ? 'animate-pulse' : ''}
        />
      </motion.button>

      {/* Success Toast */}
      <AnimatePresence>
        {showSuccess && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.8 }}
            animate={{ opacity: 1, y: -40, scale: 1 }}
            exit={{ opacity: 0, y: -60, scale: 0.8 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="absolute left-1/2 transform -translate-x-1/2 -top-2 pointer-events-none z-50"
          >
            <div className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium whitespace-nowrap">
              <Sparkles size={16} className="text-emerald-200" />
              <span>Added to library!</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating hearts animation */}
      <AnimatePresence>
        {justSaved && (
          <>
            {[...Array(3)].map((_, i) => (
              <motion.div
                key={i}
                initial={{ 
                  opacity: 0,
                  scale: 0,
                  x: 0,
                  y: 0
                }}
                animate={{ 
                  opacity: [0, 1, 0],
                  scale: [0, 1, 0.5],
                  x: [0, (i - 1) * 20],
                  y: [0, -30 - i * 10]
                }}
                transition={{ 
                  duration: 1.2,
                  delay: i * 0.1,
                  ease: "easeOut"
                }}
                className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              >
                <Heart 
                  size={12} 
                  fill="currentColor" 
                  className="text-red-400"
                />
              </motion.div>
            ))}
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
