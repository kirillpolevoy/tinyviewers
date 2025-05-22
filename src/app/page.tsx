'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">Toddler Movies</h1>
      <p className="mt-4 text-xl">Coming soon!</p>
    </main>
  );
}
