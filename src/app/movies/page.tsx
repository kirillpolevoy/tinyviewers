import Link from 'next/link';
import MoviesList from './MoviesList';

export default function MoviesPage({ 
  searchParams 
}: { 
  searchParams: { 
    search?: string; 
    category?: string;  
    age?: string; 
  };
}) {
  const search = searchParams?.search ?? null;
  const category = searchParams?.category ?? null;
  const age = searchParams?.age ?? null;

  return (
    <div className="min-h-screen bg-[#F5F5F0]">
      <div className="max-w-[90rem] mx-auto px-8 md:px-16 pt-16 pb-24">
        <div className="max-w-3xl">
          <Link 
            href="/"
            className="text-[#6B6B63] hover:text-[#2C2C27] transition-colors duration-300 
                     text-base tracking-wide font-light"
            prefetch={false}
          >
            ← Back
          </Link>
          <h1 className="text-4xl md:text-5xl font-light text-[#2C2C27] mt-12 mb-6 tracking-tight leading-[1.1]">
            {search ? `Movies for "${search}"` : 'All Movies'}
          </h1>
          <p className="text-xl text-[#6B6B63] font-light tracking-wide mb-16">
            Curated films perfect for your little ones
          </p>
        </div>

        <MoviesList 
          searchQuery={search} 
          categoryFilter={category} 
          ageFilter={age}
        />
      </div>
    </div>
  );
} 