'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function Home() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      console.log('Searching for:', searchQuery.trim());
      const searchUrl = `/movies?search=${encodeURIComponent(searchQuery.trim())}`;
      console.log('Navigating to:', searchUrl);
      router.push(searchUrl);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F5F5F0] px-4">
      <div className="w-full max-w-2xl text-center mb-16">
        <h1 className="text-6xl md:text-7xl font-light text-[#2C2C27] mb-6 tracking-tight">
          Skip the scares.
          <br />
          Keep the joy.
        </h1>
        <p className="text-xl text-[#6B6B63] font-light tracking-wide">
          No more guesswork. Watch with confidence.
        </p>
      </div>

      <form onSubmit={handleSearch} className="w-full max-w-xl">
        <div className="relative group">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Try 'Moana' or 'Frozen'..."
            className="w-full px-4 sm:px-8 py-7 text-xl rounded-2xl border-0 
                     bg-white/80 backdrop-blur-sm text-[#2C2C27]
                     focus:ring-2 focus:ring-[#2C2C27] outline-none 
                     transition-all duration-300 shadow-[0_2px_20px_rgba(0,0,0,0.04)]
                     hover:shadow-[0_2px_30px_rgba(0,0,0,0.08)]
                     placeholder:text-[#6B6B63]/60 pr-20 sm:pr-32"
            autoFocus
          />
          <button
            type="submit"
            className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 px-4 sm:px-8 py-3.5
                     bg-[#2C2C27] text-white text-base sm:text-lg rounded-xl
                     hover:bg-[#1A1A16] transition-colors duration-300
                     font-light tracking-wide"
          >
            Search
          </button>
        </div>
      </form>

      <div className="mt-8 text-[#6B6B63]/80 text-sm tracking-wide font-light">
        Press Enter to search or{' '}
        <Link 
          href="/movies" 
          className="text-[#2C2C27] hover:text-[#1A1A16] underline underline-offset-2 transition-colors duration-300"
        >
          View All
        </Link>
      </div>
    </div>
  );
}
