'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

const ThemeToggle = () => {
  const { setTheme, theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--tv-border-subtle)] bg-[var(--tv-surface-overlay)] text-[var(--tv-text-secondary)]">
        <Moon className="h-4 w-4" aria-hidden="true" />
      </span>
    );
  }

  const currentTheme = theme === 'system' ? resolvedTheme : theme;
  const isDark = currentTheme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--tv-border-subtle)] bg-[var(--tv-surface-overlay)] px-3 text-sm font-medium text-[var(--tv-text-secondary)] shadow-sm transition-all duration-200 hover:scale-[1.02] hover:border-[var(--tv-border-strong)] hover:text-[var(--tv-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
      <span className="hidden sm:inline">{isDark ? 'Light' : 'Dark'}</span>
    </button>
  );
};

export default ThemeToggle;

