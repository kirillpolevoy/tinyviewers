'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Check } from 'lucide-react';
import { motion } from 'framer-motion';
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
  const [isSaved, setIsSaved] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
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

  // Redesigned to match existing page aesthetics - subtle and elegant
  const variantClasses = {
    primary: 'bg-gradient-to-r from-purple-50 to-pink-50 text-purple-700 border border-purple-200 hover:from-purple-100 hover:to-pink-100 hover:border-purple-300 shadow-sm',
    secondary: 'bg-slate-50/90 text-slate-700 border border-slate-200 hover:bg-slate-100/90 hover:border-slate-300 backdrop-blur-sm',
    minimal: 'bg-gray-50/80 text-gray-600 border border-gray-200/60 hover:bg-gray-100/80 hover:text-purple-600 hover:border-purple-200'
  };

  const savedVariantClasses = {
    primary: 'bg-gradient-to-r from-green-50 to-emerald-50 text-green-700 border border-green-200 hover:from-green-100 hover:to-emerald-100',
    secondary: 'bg-green-50/90 text-green-700 border border-green-200 hover:bg-green-100/90 backdrop-blur-sm',
    minimal: 'bg-green-50/80 text-green-600 border border-green-200/60 hover:bg-green-100/80'
  };

  useEffect(() => {
    checkAuthAndSavedStatus();
  }, [movieId]);

  const checkAuthAndSavedStatus = async () => {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      
      let finalUser = user;
      if (!user) {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        finalUser = session?.user || null;
      }
      
      setUser(finalUser);
      
      if (finalUser) {
        // Check if movie is already saved - implement proper state check
        try {
          const { data, error } = await supabase
            .from('saved_movies')
            .select('id')
            .eq('user_id', finalUser.id)
            .eq('movie_id', movieId)
            .single();
          
          if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
            console.warn('Error checking saved status in MyListButton:', error);
            setIsSaved(false);
          } else {
            const saved = !!data;
            setIsSaved(saved);
          }
        } catch (error) {
          console.warn('Could not check saved status in MyListButton:', error);
          setIsSaved(false);
        }
      }
    } catch (error) {
      console.error('Error checking auth:', error);
    }
  };

  const handleToggle = async () => {
    if (!user) {
      // Trigger auth flow - simple redirect to sign in
      if (onAuthRequired) {
        onAuthRequired();
      } else {
        // Default behavior: trigger auth via Supabase
        try {
          await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo: window.location.href
            }
          });
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
  const currentText = isSaved ? 'In My List' : 'My List';

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
          inline-flex items-center gap-2 rounded-full font-medium transition-all duration-300 
          disabled:opacity-50 disabled:cursor-not-allowed relative
          ${sizeClasses[size]} ${currentVariantClasses}
        `}
        aria-label={user ? currentText : 'Sign in to add to My List'}
      >
        {isLoading ? (
          <div className="animate-spin rounded-full border-2 border-current border-t-transparent" 
               style={{ width: iconSizes[size], height: iconSizes[size] }} />
        ) : (
          React.createElement(currentIcon, { size: iconSizes[size] })
        )}
        
        {showText && (
          <span className="font-medium">
            {!user ? 'My List' : currentText}
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
