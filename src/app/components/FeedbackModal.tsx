'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    comments: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.comments.trim()) {
      setError('Please provide your feedback comments');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to submit feedback');
      }

      setIsSubmitted(true);
      setFormData({ name: '', email: '', comments: '' });
    } catch (err) {
      setError('Failed to submit feedback. Please try again.');
      console.error('Feedback submission error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setIsSubmitted(false);
    setError(null);
    setFormData({ name: '', email: '', comments: '' });
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
          />
          
          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="relative w-full max-w-md bg-white/95 backdrop-blur-md rounded-3xl shadow-2xl border border-pink-200 overflow-hidden"
          >
            {!isSubmitted ? (
              <div className="p-8">
                {/* Header */}
                <div className="text-center mb-8">
                  <div className="text-4xl mb-4">💭</div>
                  <h2 className="text-2xl font-light text-slate-800 tracking-tight mb-2" style={{
                    fontFamily: 'system-ui, -apple-system, serif',
                    textShadow: '0 2px 8px rgba(168, 85, 247, 0.15)',
                  }}>
                    <span className="text-transparent bg-gradient-to-r from-pink-600 via-purple-500 to-emerald-500 bg-clip-text">
                      Share Your Feedback
                    </span>
                  </h2>
                  <p className="text-slate-600 text-sm">
                    Help us make Tiny Viewers even better! ✨
                  </p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Name Field */}
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-2">
                      Your Name <span className="text-slate-400">(optional)</span>
                    </label>
                    <input
                      type="text"
                      id="name"
                      name="name"
                      value={formData.name}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 bg-white/80 border border-pink-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-300 transition-all duration-300 text-slate-800"
                      placeholder="Your name"
                    />
                  </div>

                  {/* Email Field */}
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-2">
                      Email <span className="text-slate-400">(optional)</span>
                    </label>
                    <input
                      type="email"
                      id="email"
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 bg-white/80 border border-pink-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-300 transition-all duration-300 text-slate-800"
                      placeholder="your@email.com"
                    />
                  </div>

                  {/* Comments Field */}
                  <div>
                    <label htmlFor="comments" className="block text-sm font-medium text-slate-700 mb-2">
                      Your Feedback <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      id="comments"
                      name="comments"
                      value={formData.comments}
                      onChange={handleInputChange}
                      rows={4}
                      required
                      className="w-full px-4 py-3 bg-white/80 border border-pink-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-300 transition-all duration-300 text-slate-800 resize-none"
                      placeholder="Tell us what you think, what could be improved, or share any suggestions..."
                    />
                  </div>

                  {/* Error Message */}
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-red-600 text-sm bg-red-50 p-3 rounded-xl border border-red-200"
                    >
                      {error}
                    </motion.div>
                  )}

                  {/* Buttons */}
                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={handleClose}
                      className="flex-1 px-6 py-3 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-2xl transition-all duration-300 font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting || !formData.comments.trim()}
                      className="flex-1 px-6 py-3 bg-gradient-to-r from-pink-500 via-purple-500 to-emerald-500 text-white rounded-2xl hover:shadow-lg transition-all duration-300 font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isSubmitting ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          Send Feedback
                          <span className="text-lg">💌</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              /* Thank You Message */
              <div className="p-8 text-center">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                  className="text-6xl mb-6"
                >
                  🎉
                </motion.div>
                <h2 className="text-2xl font-light text-slate-800 tracking-tight mb-4" style={{
                  fontFamily: 'system-ui, -apple-system, serif',
                  textShadow: '0 2px 8px rgba(168, 85, 247, 0.15)',
                }}>
                  <span className="text-transparent bg-gradient-to-r from-pink-600 via-purple-500 to-emerald-500 bg-clip-text">
                    Thank You!
                  </span>
                </h2>
                <p className="text-slate-600 mb-8 leading-relaxed">
                  Your feedback has been received! We really appreciate you taking the time to help us improve Tiny Viewers. 💜
                </p>
                <button
                  onClick={handleClose}
                  className="px-8 py-3 bg-gradient-to-r from-pink-500 via-purple-500 to-emerald-500 text-white rounded-2xl hover:shadow-lg transition-all duration-300 font-medium"
                >
                  Close
                </button>
              </div>
            )}
            
            {/* Close Button */}
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all duration-300"
            >
              ✕
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
} 