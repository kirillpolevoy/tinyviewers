'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="max-w-4xl text-center">
        <h1 className="text-4xl font-bold mb-8">Toddler Movies</h1>
        <p className="text-xl mb-6">
          Skip the scares. Keep the joy. Find gentle films perfect for your little ones.
        </p>
        <p className="text-lg">
          Coming soon!
        </p>
      </div>
    </main>
  );
}
