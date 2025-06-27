'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface PasscodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function PasscodeModal({ isOpen, onClose, onSuccess }: PasscodeModalProps) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [isShaking, setIsShaking] = useState(false);
  const CORRECT_PASSCODE = '777';

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setPasscode('');
      setError('');
      setIsShaking(false);
    }
  }, [isOpen]);

  const handleInputChange = (value: string) => {
    // Only allow digits and limit to 3 characters
    const digits = value.replace(/\D/g, '').slice(0, 3);
    setPasscode(digits);
    setError('');
    setIsShaking(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (passcode.length !== 3) {
      setError('Please enter a 3-digit code');
      triggerShake();
      return;
    }

    if (passcode === CORRECT_PASSCODE) {
      onSuccess();
      onClose();
    } else {
      setError('Incorrect code. Please try again.');
      setPasscode('');
      triggerShake();
    }
  };

  const triggerShake = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 500);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit(e as any);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ 
            opacity: 1, 
            scale: 1, 
            y: 0,
            x: isShaking ? [-10, 10, -10, 10, 0] : 0
          }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ 
            duration: isShaking ? 0.5 : 0.3,
            ease: "easeOut"
          }}
          className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6 sm:p-8">
            {/* Header */}
            <div className="text-center mb-6">
              <div className="text-4xl mb-3">🔒</div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">
                Access Required
              </h2>
              <p className="text-slate-600">
                Enter the 3-digit passcode to add movies
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="passcode" className="block text-sm font-medium text-slate-700">
                  Passcode
                </label>
                <input
                  type="text"
                  id="passcode"
                  value={passcode}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="000"
                  className={`w-full px-4 py-3 text-center text-2xl font-mono bg-white border rounded-xl focus:outline-none focus:ring-2 transition-all duration-300 ${
                    error 
                      ? 'border-red-300 focus:ring-red-500 focus:border-red-400' 
                      : 'border-slate-300 focus:ring-purple-500 focus:border-purple-400'
                  }`}
                  maxLength={3}
                  autoFocus
                />
                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-red-600 text-sm text-center"
                  >
                    {error}
                  </motion.p>
                )}
              </div>

              {/* Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-colors duration-300 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={passcode.length !== 3}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl hover:shadow-lg transition-all duration-300 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98]"
                >
                  <span className="flex items-center justify-center gap-2">
                    <span>Enter</span>
                    <span>🚀</span>
                  </span>
                </button>
              </div>
            </form>

            {/* Help text */}
            <div className="mt-6 text-center">
              <p className="text-xs text-slate-500">
                💡 Need access? Contact an administrator
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
} 