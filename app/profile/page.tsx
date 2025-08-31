'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabase';
import { Heart, Film, ArrowLeft, LogOut, Camera, Upload } from 'lucide-react';
import { motion } from 'framer-motion';

interface UserProfile {
  id: string;
  email: string;
  display_name?: string;
  avatar_url?: string;
  custom_avatar_url?: string;
}

export default function ProfilePage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const initProfile = async () => {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) {
          window.location.href = '/';
          return;
        }

        // Try to get custom avatar from profiles table, fallback to Google avatar
        let customAvatarUrl = null;
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('avatar_url')
            .eq('id', authUser.id)
            .single();
          customAvatarUrl = profile?.avatar_url;
        } catch (error) {
          // Profile doesn't exist yet, that's ok
        }

        setUser({
          id: authUser.id,
          email: authUser.email || '',
          display_name: authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'User',
          avatar_url: authUser.user_metadata?.avatar_url, // Google avatar
          custom_avatar_url: customAvatarUrl // Custom uploaded avatar
        });

      } catch (error) {
        console.error('Error initializing profile:', error);
      } finally {
        setLoading(false);
      }
    };

    initProfile();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  const uploadAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setUploading(true);
      
      if (!event.target.files || event.target.files.length === 0) {
        return;
      }

      const file = event.target.files[0];
      
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert('Please choose an image smaller than 5MB.');
        return;
      }

      // Validate file type
      if (!file.type.startsWith('image/')) {
        alert('Please choose an image file.');
        return;
      }

      // For now, we'll just convert the image to a data URL and store it in the profiles table
      // This avoids the need for Supabase Storage configuration
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const dataUrl = e.target?.result as string;
          
          // Update user profile with data URL
          const { error: updateError } = await supabase
            .from('profiles')
            .upsert({
              id: user!.id,
              email: user!.email,
              display_name: user!.display_name,
              avatar_url: dataUrl // Store as data URL temporarily
            });

          if (updateError) {
            console.warn('Profile update error (table may not exist):', updateError.message);
            // Still update local state for better UX
          }

          // Update local state
          setUser(prev => prev ? { ...prev, custom_avatar_url: dataUrl } : null);
          
        } catch (error) {
          console.error('Error processing avatar:', error);
          alert('Error processing image. Please try again.');
        } finally {
          setUploading(false);
        }
      };

      reader.readAsDataURL(file);

    } catch (error) {
      console.error('Error uploading avatar:', error);
      alert('Error uploading avatar. Please try again.');
      setUploading(false);
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  // Get the avatar to display (custom first, then Google, then fallback)
  const getAvatarUrl = () => {
    return user?.custom_avatar_url || user?.avatar_url;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-800 mb-4">Please sign in to view your profile</h1>
          <Link
            href="/"
            className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors inline-block"
          >
            Go to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Back Button */}
        <Link
          href="/movies"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-purple-600 transition-colors mb-6"
        >
          <ArrowLeft size={20} />
          Back to Movies
        </Link>

        {/* Profile Header */}
        <div className="bg-white rounded-xl p-8 shadow-sm border border-slate-200 mb-6">
          <div className="flex items-center gap-6 mb-6">
            {/* Avatar with upload functionality */}
            <div className="relative">
              <motion.div 
                whileHover={{ scale: 1.05 }}
                onClick={handleAvatarClick}
                className="w-20 h-20 rounded-full cursor-pointer overflow-hidden border-4 border-white shadow-lg"
              >
                {getAvatarUrl() ? (
                  <img 
                    src={getAvatarUrl()} 
                    alt="Profile avatar"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white text-3xl font-bold">
                    {user.display_name?.[0]?.toUpperCase() || 'U'}
                  </div>
                )}
              </motion.div>
              
              {/* Camera overlay */}
              <motion.div 
                whileHover={{ opacity: 1 }}
                className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center opacity-0 transition-opacity cursor-pointer"
                onClick={handleAvatarClick}
              >
                {uploading ? (
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                ) : (
                  <Camera size={24} className="text-white" />
                )}
              </motion.div>
              
              {/* Hidden file input */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={uploadAvatar}
                accept="image/*"
                className="hidden"
              />
            </div>

            <div>
              <h1 className="text-3xl font-bold text-slate-800 mb-2">
                {user.display_name || 'User'}
              </h1>
              <p className="text-slate-600 mb-2">{user.email}</p>
              <p className="text-sm text-slate-500">
                {getAvatarUrl() ? 'Click avatar to change photo' : 'Click avatar to add photo'}
              </p>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-slate-800">Quick Actions</h2>
          
          <Link href="/library">
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="bg-white rounded-xl p-6 shadow-sm border border-slate-200 hover:shadow-md transition-all duration-200 cursor-pointer"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center">
                  <Heart size={24} />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800">My Library</h3>
                  <p className="text-sm text-slate-600">View your saved movies</p>
                </div>
              </div>
            </motion.div>
          </Link>

          <Link href="/movies">
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="bg-white rounded-xl p-6 shadow-sm border border-slate-200 hover:shadow-md transition-all duration-200 cursor-pointer"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                  <Film size={24} />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800">Browse Movies</h3>
                  <p className="text-sm text-slate-600">Discover family-friendly content</p>
                </div>
              </div>
            </motion.div>
          </Link>

          <motion.div
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={signOut}
            className="bg-white rounded-xl p-6 shadow-sm border border-slate-200 hover:shadow-md transition-all duration-200 cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-red-100 text-red-600 flex items-center justify-center">
                <LogOut size={24} />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800">Sign Out</h3>
                <p className="text-sm text-slate-600">Sign out of your account</p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}