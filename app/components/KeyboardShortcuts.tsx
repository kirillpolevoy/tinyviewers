'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface KeyboardShortcutsProps {
  onRerunAnalysis: () => void;
  onToggleHistory: () => void;
  onToggleSuggestions: () => void;
}

export default function KeyboardShortcuts({ 
  onRerunAnalysis, 
  onToggleHistory, 
  onToggleSuggestions 
}: KeyboardShortcutsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pressedKeys, setPressedKeys] = useState<string[]>([]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Prevent default for our shortcuts
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        
        if (key === 'r' && event.ctrlKey) {
          event.preventDefault();
          onRerunAnalysis();
          showKeyPress(['Ctrl', 'R']);
        } else if (key === 'h' && event.ctrlKey) {
          event.preventDefault();
          onToggleHistory();
          showKeyPress(['Ctrl', 'H']);
        } else if (key === 's' && event.ctrlKey) {
          event.preventDefault();
          onToggleSuggestions();
          showKeyPress(['Ctrl', 'S']);
        } else if (key === '?' && event.ctrlKey) {
          event.preventDefault();
          setIsOpen(!isOpen);
          showKeyPress(['Ctrl', '?']);
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (['r', 'h', 's', '?'].includes(key)) {
          setTimeout(() => setPressedKeys([]), 1000);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [onRerunAnalysis, onToggleHistory, onToggleSuggestions, isOpen]);

  const showKeyPress = (keys: string[]) => {
    setPressedKeys(keys);
    setTimeout(() => setPressedKeys([]), 1000);
  };

  const shortcuts = [
    {
      keys: ['Ctrl', 'R'],
      action: 'Rerun Analysis',
      description: 'Start a fresh analysis of the current movie'
    },
    {
      keys: ['Ctrl', 'H'],
      action: 'Toggle History',
      description: 'Show/hide analysis history'
    },
    {
      keys: ['Ctrl', 'S'],
      action: 'Toggle Suggestions',
      description: 'Show/hide smart suggestions'
    },
    {
      keys: ['Ctrl', '?'],
      action: 'Show Shortcuts',
      description: 'Display this help dialog'
    }
  ];

  return (
    <>
      {/* Keyboard shortcut indicator */}
      <AnimatePresence>
        {pressedKeys.length > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="fixed top-4 right-4 bg-slate-800 text-white px-4 py-2 rounded-lg shadow-lg z-50 flex items-center gap-2"
          >
            {pressedKeys.map((key, index) => (
              <React.Fragment key={index}>
                <kbd className="bg-slate-700 px-2 py-1 rounded text-sm font-mono">
                  {key}
                </kbd>
                {index < pressedKeys.length - 1 && (
                  <span className="text-slate-400">+</span>
                )}
              </React.Fragment>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Shortcuts help dialog */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setIsOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-slate-800">
                  Keyboard Shortcuts
                </h3>
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3">
                {shortcuts.map((shortcut, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                  >
                    <div>
                      <div className="font-medium text-slate-800 text-sm">
                        {shortcut.action}
                      </div>
                      <div className="text-slate-600 text-xs">
                        {shortcut.description}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, keyIndex) => (
                        <React.Fragment key={keyIndex}>
                          <kbd className="bg-white border border-slate-300 px-2 py-1 rounded text-xs font-mono text-slate-700">
                            {key}
                          </kbd>
                          {keyIndex < shortcut.keys.length - 1 && (
                            <span className="text-slate-400 text-xs">+</span>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </div>

              <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                <div className="text-blue-800 text-sm font-medium">
                  💡 Pro Tip
                </div>
                <div className="text-blue-700 text-xs mt-1">
                  Press <kbd className="bg-blue-100 px-1 py-0.5 rounded text-xs">Ctrl</kbd> + <kbd className="bg-blue-100 px-1 py-0.5 rounded text-xs">?</kbd> anytime to see this help
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
