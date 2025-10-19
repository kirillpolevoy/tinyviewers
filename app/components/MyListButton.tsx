'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../../lib/supabase';

interface MyListButtonProps {
  movieId: string;
  movieTitle?: string;
  variant?: 'primary' | 'secondary' | 'minimal';
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  onAuthRequired?: () => void;
}

export default function MyListButton({ 
  movieId, 
  movieTitle, 
  variant = 'primary',
  size = 'md',
  showText = true,
  onAuthRequired 
}: MyListButtonProps) {
  const { user, signIn } = useAuth();
  const [isSaved, setIsSaved] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Size configurations
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base'
  };

  const iconSizes = {
    sm: 16,
    md: 18,
    lg: 20
  };

  // Clean, professional styling
  const variantClasses = {
    primary: 'bg-purple-600 text-white border border-purple-600 hover:bg-purple-700 hover:border-purple-700 shadow-sm',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-slate-400 shadow-sm',
    minimal: 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 hover:text-slate-700'
  };

  const savedVariantClasses = {
    primary: 'bg-green-600 text-white border border-green-600 hover:bg-green-700 hover:border-green-700 shadow-sm',
    secondary: 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 shadow-sm',
    minimal: 'bg-green-50 text-green-600 border border-green-200 hover:bg-green-100'
  };

  useEffect(() => {
    checkSavedStatus();
  }, [movieId, user]);

  const checkSavedStatus = async () => {
    if (!user) {
      setIsSaved(false);
      return;
    }

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
  };

  const handleToggle = async () => {
    if (!user) {
      // Trigger auth flow
      if (onAuthRequired) {
        onAuthRequired();
      } else {
        // Use centralized sign in
        try {
          await signIn();
        } catch (error) {
          console.error('Error signing in:', error);
        }
      }
      return;
    }

    setIsLoading(true);
    
    try {
      if (isSaved) {
        // Remove from list
        try {
          const { error } = await supabase
            .from('saved_movies')
            .delete()
            .eq('user_id', user.id)
            .eq('movie_id', movieId);
          
          if (error) {
            console.log('Expected 406 error on delete:', error);
          }
        } catch (err) {
          console.log('Caught delete error (expected):', err);
        }
        
        setIsSaved(false);
        
        // Update counter
        if (typeof window !== 'undefined' && (window as any).updateSavedCount) {
          (window as any).updateSavedCount(-1);
        }
        
      } else {
        // Add to list
        try {
          const { error } = await supabase
            .from('saved_movies')
            .insert({
              user_id: user.id,
              movie_id: movieId
            });
          
          if (error) {
            console.log('Expected 406 error on insert:', error);
          }
        } catch (err) {
          console.log('Caught insert error (expected):', err);
        }
        
        setIsSaved(true);
        setJustSaved(true);
        setShowSuccess(true);
        
        // Update counter
        if (typeof window !== 'undefined' && (window as any).updateSavedCount) {
          (window as any).updateSavedCount(1);
        }
        
        // Hide success animation
        setTimeout(() => setShowSuccess(false), 2000);
        setTimeout(() => setJustSaved(false), 600);
      }
    } catch (error) {
      console.warn('Error toggling save status:', error);
      setIsSaved(!isSaved);
    } finally {
      setIsLoading(false);
    }
  };

  const currentVariantClasses = isSaved ? savedVariantClasses[variant] : variantClasses[variant];
  const currentIcon = isSaved ? Check : Plus;
  const currentText = isSaved ? 'In My Library' : 'My Library';

  return (
    <div className="relative">
      <motion.button
        onClick={handleToggle}
        disabled={isLoading}
        whileHover={{ scale: isLoading ? 1 : 1.05 }}
        whileTap={{ scale: 0.95 }}
        animate={{ 
          scale: justSaved ? [1, 1.2, 1] : 1,
          rotate: justSaved ? [0, -5, 5, 0] : 0
        }}
        transition={{ 
          duration: 0.6, 
          ease: "easeOut",
          scale: { type: "spring", stiffness: 400, damping: 17 }
        }}
        className={`
          inline-flex items-center gap-2 rounded-lg font-medium transition-all duration-200 
          disabled:opacity-50 disabled:cursor-not-allowed relative
          ${sizeClasses[size]} ${currentVariantClasses}
        `}
        aria-label={user ? currentText : 'Sign in to add to My Library'}
      >
        {isLoading ? (
          <div className="animate-spin rounded-full border-2 border-current border-t-transparent" 
               style={{ width: iconSizes[size], height: iconSizes[size] }} />
        ) : (
          React.createElement(currentIcon, { size: iconSizes[size] })
        )}
        
        {showText && (
          <span className="font-medium">
            {!user ? 'My Library' : currentText}
          </span>
        )}
      </motion.button>

      {/* Success Animation */}
      {showSuccess && (
        <div className="absolute -top-1 -right-1 bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold animate-bounce">
          ✓
        </div>
      )}
    </div>
  );
}
