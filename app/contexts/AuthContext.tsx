'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthUserInfo {
  id: string;
  email: string | null;
  avatar_url?: string | null;
  name?: string | null;
}

interface AuthContextType {
  user: AuthUserInfo | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Standardized OAuth configuration
const OAUTH_CONFIG = {
  provider: 'google' as const,
  options: {
    redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined,
    queryParams: {
      access_type: 'offline',
      prompt: 'select_account',
    },
  },
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUserInfo | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Convert Supabase user to our AuthUserInfo format
  const formatUser = useCallback((user: User | null): AuthUserInfo | null => {
    if (!user) return null;
    
    return {
      id: user.id,
      email: user.email || null,
      avatar_url: user.user_metadata?.avatar_url || null,
      name: user.user_metadata?.full_name || null,
    };
  }, []);

  // Refresh user data with retry logic
  const refreshUser = useCallback(async (retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const { data: { user: authUser }, error: userError } = await supabase.auth.getUser();
        
        if (userError) {
          console.warn(`Auth refresh attempt ${i + 1} failed:`, userError);
          if (i === retries - 1) throw userError;
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
          continue;
        }

        const { data: { session: authSession }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.warn(`Session refresh attempt ${i + 1} failed:`, sessionError);
          if (i === retries - 1) throw sessionError;
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
          continue;
        }

        setUser(formatUser(authUser));
        setSession(authSession);
        setError(null);
        return;
      } catch (err) {
        console.error(`Auth refresh attempt ${i + 1} error:`, err);
        if (i === retries - 1) {
          setError(err instanceof Error ? err.message : 'Failed to refresh authentication');
        }
      }
    }
  }, [formatUser]);

  // Sign in with retry logic
  const signIn = useCallback(async (retries = 3) => {
    setLoading(true);
    setError(null);
    
    for (let i = 0; i < retries; i++) {
      try {
        const { error } = await supabase.auth.signInWithOAuth(OAUTH_CONFIG);
        
        if (error) {
          console.warn(`Sign in attempt ${i + 1} failed:`, error);
          if (i === retries - 1) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
          continue;
        }
        
        return; // Success
      } catch (err) {
        console.error(`Sign in attempt ${i + 1} error:`, err);
        if (i === retries - 1) {
          setError(err instanceof Error ? err.message : 'Failed to sign in');
        }
      }
    }
    
    setLoading(false);
  }, []);

  // Sign out
  const signOut = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      setUser(null);
      setSession(null);
    } catch (err) {
      console.error('Sign out error:', err);
      setError(err instanceof Error ? err.message : 'Failed to sign out');
    } finally {
      setLoading(false);
    }
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Initialize auth state and listen for changes
  useEffect(() => {
    let isMounted = true;
    
    // Initial auth check
    const initializeAuth = async () => {
      try {
        await refreshUser();
      } catch (err) {
        console.error('Initial auth check failed:', err);
        setError('Failed to initialize authentication');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    initializeAuth();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state change:', event, session?.user?.id);
        
        if (!isMounted) return;

        switch (event) {
          case 'SIGNED_IN':
            setUser(formatUser(session?.user || null));
            setSession(session);
            setError(null);
            break;
          case 'SIGNED_OUT':
            setUser(null);
            setSession(null);
            setError(null);
            break;
          case 'TOKEN_REFRESHED':
            setSession(session);
            break;
          case 'USER_UPDATED':
            setUser(formatUser(session?.user || null));
            setSession(session);
            break;
        }
        
        setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [refreshUser, formatUser]);

  const value: AuthContextType = {
    user,
    session,
    loading,
    error,
    signIn,
    signOut,
    refreshUser,
    clearError,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// Custom hook to use auth context
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Export the OAuth config for components that need it
export { OAUTH_CONFIG };
