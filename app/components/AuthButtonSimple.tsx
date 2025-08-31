'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabase';
import WorkingFeedbackModal from './WorkingFeedbackModal';

interface AuthUserInfo {
  id: string;
  email: string | null;
  avatar_url?: string | null;
  name?: string | null;
}

export default function AuthButtonSimple() {
  const [user, setUser] = useState<AuthUserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedCount, setSavedCount] = useState(0);
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Remove the console.log that's causing noise
  // console.log('AuthButtonSimple render - modal open:', isFeedbackModalOpen);

  // Function to refresh saved count with proper throttling
  const refreshSavedCount = async () => {
    if (!user || isRefreshing) {
      return;
    }
    
    setIsRefreshing(true);
    try {
      const { count, error } = await supabase
        .from('saved_movies')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);
      
      if (error) {
        console.warn('Error fetching saved count:', error);
        setSavedCount(0);
      } else {
        setSavedCount(count || 0);
      }
    } catch (err) {
      console.warn('Failed to fetch saved count:', err);
      setSavedCount(0);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    
    // Simple timeout to prevent hanging
    const timeout = setTimeout(() => {
      if (isMounted) setLoading(false);
    }, 2000);

    // Get user
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!isMounted) return;
      
      if (user) {
        setUser({
          id: user.id,
          email: user.email ?? null,
          avatar_url: user.user_metadata?.avatar_url ?? null,
          name: user.user_metadata?.full_name ?? null,
        });
        
        // Fetch saved count with throttling
        const fetchSavedCount = async () => {
          if (!isMounted) return;
          
          try {
            const { count, error } = await supabase
              .from('saved_movies')
              .select('id', { count: 'exact', head: true })
              .eq('user_id', user.id);
            
            if (error) {
              console.warn('Error fetching saved count:', error);
              if (isMounted) setSavedCount(0);
            } else {
              if (isMounted) setSavedCount(count || 0);
            }
          } catch (err) {
            console.warn('Failed to fetch saved count:', err);
            if (isMounted) setSavedCount(0);
          }
        };
        
        // Add 500ms delay to prevent rapid calls
        setTimeout(fetchSavedCount, 500);
      } else {
        setUser(null);
        setSavedCount(0);
      }
      setLoading(false);
      clearTimeout(timeout);
    }).catch(() => {
      if (isMounted) setLoading(false);
      clearTimeout(timeout);
    });

    // Auth listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;
      
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email ?? null,
          avatar_url: session.user.user_metadata?.avatar_url ?? null,
          name: session.user.user_metadata?.full_name ?? null,
        });
        
        // Temporarily disable all API calls to stop flood
        // if ((event === 'SIGNED_IN') && !isRefreshing) {
        //   const fetchSavedCount = async () => {
        //     if (!isMounted || isRefreshing) return;
        //     setIsRefreshing(true);
        //     try {
        //       const { count, error } = await supabase
        //         .from('saved_movies')
        //         .select('id', { count: 'exact', head: true })
        //         .eq('user_id', session.user.id);
        //       
        //       if (error) {
        //         console.warn('Error fetching saved count:', error);
        //         if (isMounted) setSavedCount(0);
        //       } else {
        //         if (isMounted) setSavedCount(count || 0);
        //       }
        //     } catch (err) {
        //       console.warn('Failed to fetch saved count:', err);
        //       if (isMounted) setSavedCount(0);
        //     } finally {
        //       if (isMounted) setIsRefreshing(false);
        //     }
        //   };
        // Only fetch on SIGNED_IN to prevent excessive calls
        if (event === 'SIGNED_IN' && !isRefreshing && isMounted) {
          // Add delay to prevent concurrent calls
          setTimeout(() => {
            if (isMounted) refreshSavedCount();
          }, 750);
        }
      } else {
        setUser(null);
        setSavedCount(0);
      }
      setLoading(false);
    });

    // Listen for custom events to refresh saved count with throttling
    const handleRefreshSavedCount = () => {
      // Add small delay to prevent rapid consecutive calls
      setTimeout(() => refreshSavedCount(), 200);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('refreshSavedCount', handleRefreshSavedCount);
    }

    return () => {
      isMounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
      // Clean up event listener
      if (typeof window !== 'undefined') {
        window.removeEventListener('refreshSavedCount', handleRefreshSavedCount);
      }
    };
  }, []); // Remove user dependency to prevent infinite loops

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

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: typeof window !== 'undefined' ? window.location.origin + '/movies' : undefined,
        queryParams: {
          access_type: 'offline',
          prompt: 'select_account',
        },
      },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  if (loading) {
    return (
      <div className="h-8 w-24 rounded-full bg-slate-200 animate-pulse" />
    );
  }

  return (
    <>
      <div className="flex items-center gap-3">
        {user ? (
          // Logged in - show My Library
          <Link
            href="/library"
            className="text-slate-600 hover:text-purple-600 transition-colors duration-300 px-3 py-2 rounded-full hover:bg-purple-50 flex items-center gap-2"
          >
            <span>My Library</span>
            {savedCount > 0 && (
              <span className="bg-purple-100 text-purple-700 text-xs font-medium px-2 py-1 rounded-full min-w-[1.5rem] text-center">
                {savedCount}
              </span>
            )}
          </Link>
        ) : (
          // Logged out - show Sign In button
          <button
            onClick={signInWithGoogle}
            className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-full hover:shadow-lg transition-all duration-300 font-medium text-sm hover:from-purple-600 hover:to-pink-600"
          >
            Sign In
          </button>
        )}
        
        {/* Hamburger Menu Button */}
        <div className="relative">
                     <button
             onClick={(e) => {
               e.stopPropagation();
               setShowMobileMenu(!showMobileMenu);
             }}
             className="p-2 text-slate-600 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-all duration-300"
           >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          
                     {/* Dropdown Menu */}
           {showMobileMenu && (
             <div 
               className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-200/50 py-2 z-50 backdrop-blur-sm"
               onClick={(e) => e.stopPropagation()}
             >
              {user ? (
                // Logged in menu
                <>
                  <Link
                    href="/profile"
                    className="block px-4 py-3 text-slate-700 hover:bg-purple-50 hover:text-purple-600 transition-all duration-200 font-medium"
                    onClick={() => setShowMobileMenu(false)}
                  >
                    My Profile
                  </Link>
                  <Link
                    href="/add-movie"
                    className="block px-4 py-3 text-slate-700 hover:bg-purple-50 hover:text-purple-600 transition-all duration-200 font-medium"
                    onClick={() => setShowMobileMenu(false)}
                  >
                    Add Movie to DB
                  </Link>
                  <button
                    onClick={() => {
                      setIsFeedbackModalOpen(true);
                      setShowMobileMenu(false);
                    }}
                    className="block w-full text-left px-4 py-3 text-slate-700 hover:bg-purple-50 hover:text-purple-600 transition-all duration-200 font-medium"
                  >
                    Feedback
                  </button>
                  <div className="border-t border-slate-200 my-2"></div>
                  <button
                    onClick={() => {
                      signOut();
                      setShowMobileMenu(false);
                    }}
                    className="block w-full text-left px-4 py-3 text-slate-700 hover:bg-red-50 hover:text-red-600 transition-all duration-200 font-medium"
                  >
                    Sign Out
                  </button>
                </>
                              ) : (
                // Logged out menu
                <>
                  <Link
                    href="/add-movie"
                    className="block px-4 py-3 text-slate-700 hover:bg-purple-50 hover:text-purple-600 transition-all duration-200 font-medium"
                    onClick={() => setShowMobileMenu(false)}
                  >
                    Add Movie to DB
                  </Link>
                  <button
                    onClick={() => {
                      setIsFeedbackModalOpen(true);
                      setShowMobileMenu(false);
                    }}
                    className="block w-full text-left px-4 py-3 text-slate-700 hover:bg-purple-50 hover:text-purple-600 transition-all duration-200 font-medium"
                  >
                    Feedback
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      
              <WorkingFeedbackModal
          isOpen={isFeedbackModalOpen}
          onClose={() => setIsFeedbackModalOpen(false)}
        />
    </>
  );
}
