'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '../contexts/AuthContext';
import WorkingFeedbackModal from './WorkingFeedbackModal';

export default function AuthButtonSimple() {
  const { user, loading, error, signIn, signOut, clearError } = useAuth();
  const [savedCount, setSavedCount] = useState(0);
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Function to refresh saved count with proper throttling
  const refreshSavedCount = useCallback(async () => {
    console.log('refreshSavedCount called, user:', user?.id, 'isRefreshing:', isRefreshing);
    if (!user || isRefreshing) {
      return;
    }
    
    setIsRefreshing(true);
    try {
      // Import supabase here to avoid circular dependency
      const { supabase } = await import('../../lib/supabase');
      
      // Force fresh data by adding timestamp to prevent caching
      const { count, error } = await supabase
        .from('saved_movies')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .limit(1000); // Add limit to force fresh query
      
      if (error) {
        console.warn('Error fetching saved count:', error);
        setSavedCount(0);
      } else {
        console.log('Fetched saved count:', count);
        setSavedCount(count || 0);
      }
    } catch (err) {
      console.warn('Failed to fetch saved count:', err);
      setSavedCount(0);
    } finally {
      setIsRefreshing(false);
    }
  }, [user, isRefreshing]);

  // Expose direct count update functions globally
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).updateSavedCount = (delta: number) => {
        console.log('Direct counter update, delta:', delta);
        setSavedCount(prev => Math.max(0, prev + delta));
      };
      (window as any).forceRefreshSavedCount = () => {
        console.log('Force refresh triggered');
        refreshSavedCount();
      };
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).updateSavedCount;
        delete (window as any).forceRefreshSavedCount;
      }
    };
  }, [refreshSavedCount]);

  // Fetch saved count when user changes
  useEffect(() => {
    if (user) {
      refreshSavedCount();
    } else {
      setSavedCount(0);
    }
  }, [user, refreshSavedCount]);

  // Listen for custom events to refresh saved count with throttling
  useEffect(() => {
    const handleRefreshSavedCount = () => {
      console.log('handleRefreshSavedCount triggered');
      // Add small delay to prevent rapid consecutive calls
      setTimeout(() => refreshSavedCount(), 200);
    };
    
    if (typeof window !== 'undefined') {
      window.addEventListener('refreshSavedCount', handleRefreshSavedCount);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('refreshSavedCount', handleRefreshSavedCount);
      }
    };
  }, [refreshSavedCount]);

  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showMobileMenu) {
        setShowMobileMenu(false);
      }
    };

    if (showMobileMenu) {
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showMobileMenu]);

  // Handle sign in with error handling
  const handleSignIn = async () => {
    try {
      await signIn();
    } catch (err) {
      console.error('Sign in failed:', err);
    }
  };

  // Handle sign out with error handling
  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('Sign out failed:', err);
    }
  };

  if (loading) {
    return (
      <div className="h-8 w-24 rounded-full bg-slate-200 dark:bg-gray-700 animate-pulse" />
    );
  }

  return (
    <>
      {/* Error display */}
      {error && (
        <div className="fixed top-4 right-4 bg-red-100 dark:bg-red-900/90 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-200 px-4 py-3 rounded z-50">
          <div className="flex items-center justify-between">
            <span className="text-sm">{error}</span>
            <button
              onClick={clearError}
              className="ml-4 text-red-500 dark:text-red-300 hover:text-red-700 dark:hover:text-red-100"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        {/* Desktop Menu */}
        <div className="hidden lg:flex items-center gap-3">
          {user ? (
            <>
              <Link
                href="/library"
                className="text-slate-600 dark:text-slate-300 hover:text-purple-600 dark:hover:text-purple-400 transition-colors duration-300 px-3 py-2 rounded-full hover:bg-purple-50 flex items-center gap-2"
              >
                <span>My Library</span>
                {savedCount > 0 && (
                  <span className="bg-purple-100 text-purple-700 text-xs font-medium px-2 py-1 rounded-full min-w-[1.5rem] text-center">
                    {savedCount}
                  </span>
                )}
              </Link>
              
              {/* Desktop Dropdown Menu */}
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMobileMenu(!showMobileMenu);
                  }}
                  className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  </svg>
                </button>

                {/* Desktop Dropdown */}
                {showMobileMenu && (
                  <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 py-2 z-50">
                    <Link
                      href="/add-movie"
                      className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      onClick={() => setShowMobileMenu(false)}
                    >
                      Add Movie
                    </Link>
                    <Link
                      href="/profile"
                      className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      onClick={() => setShowMobileMenu(false)}
                    >
                      Profile
                    </Link>
                    <button
                      onClick={() => {
                        setIsFeedbackModalOpen(true);
                        setShowMobileMenu(false);
                      }}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      Feedback
                    </button>
                    
                    <hr className="my-2 border-gray-200 dark:border-gray-600" />
                    
                    <button
                      onClick={() => {
                        handleSignOut();
                        setShowMobileMenu(false);
                      }}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <button
              onClick={handleSignIn}
              className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-full hover:shadow-lg transition-all duration-300 font-medium text-sm hover:from-purple-600 hover:to-pink-600"
            >
              Sign In
            </button>
          )}
        </div>

        {/* Mobile Hamburger Menu */}
        <div className="lg:hidden relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMobileMenu(!showMobileMenu);
            }}
            className="lg:hidden p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>

          {/* Mobile Menu Dropdown */}
          {showMobileMenu && (
            <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 py-2 z-50">
              {user ? (
                <>
                  <Link
                    href="/profile"
                    className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    onClick={() => setShowMobileMenu(false)}
                  >
                    My Profile
                  </Link>
                  <Link
                    href="/add-movie"
                    className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    onClick={() => setShowMobileMenu(false)}
                  >
                    Add Movie to DB
                  </Link>
                  <button
                    onClick={() => {
                      setIsFeedbackModalOpen(true);
                      setShowMobileMenu(false);
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Feedback
                  </button>
                  
                  <hr className="my-2 border-gray-200 dark:border-gray-600" />
                  
                  <button
                    onClick={() => {
                      handleSignOut();
                      setShowMobileMenu(false);
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Sign Out
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    handleSignIn();
                    setShowMobileMenu(false);
                  }}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Sign In
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Feedback Modal */}
      <WorkingFeedbackModal
        isOpen={isFeedbackModalOpen}
        onClose={() => setIsFeedbackModalOpen(false)}
      />
    </>
  );
}