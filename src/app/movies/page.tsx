import Link from 'next/link';
import MoviesList from './MoviesList';

interface SearchParams {
  search?: string;
  category?: string;
  age?: string;
}

export default function MoviesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const search = searchParams?.search ?? null;
  const category = searchParams?.category ?? null;
  const age = searchParams?.age ?? null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-purple-50 to-orange-50">
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/60 shadow-sm">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
          <Link href="/" className="text-2xl font-bold tracking-tight flex items-center gap-2">
            🧸 <span>Tiny Viewers</span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium">
            <a href="#feedback" className="hover:text-primary transition-colors">Feedback</a>
          </nav>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 md:px-8 pt-12 pb-24">
        <div className="max-w-4xl mb-16">
          <Link 
            href="/"
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-800 transition-colors duration-300 
                     text-base font-medium mb-8 hover:gap-3 group"
            prefetch={false}
          >
            <span className="transition-transform duration-300 group-hover:-translate-x-1">←</span>
            <span>Back to Home</span>
          </Link>
          
          <h1 className="text-5xl md:text-6xl font-extrabold bg-gradient-to-r from-blue-600 to-emerald-500 text-transparent bg-clip-text mb-6 drop-shadow-lg">
            {search ? `Results for "${search}"` : 'All Movies'}
          </h1>
          <p className="text-xl text-gray-700 mb-8 leading-relaxed">
            {search 
              ? `Showing toddler-safe movies matching your search`
              : 'Our complete collection of curated, toddler-friendly films'
            }
          </p>
          
          {search && (
            <div className="inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm px-4 py-2 rounded-full border border-white/60">
              <span className="text-sm text-gray-600">Search:</span>
              <span className="text-sm font-semibold text-gray-800">{search}</span>
            </div>
          )}
        </div>

        <div className="bg-white/60 backdrop-blur-sm rounded-3xl shadow-lg border border-white/60 p-8">
          <MoviesList 
            searchQuery={search} 
            categoryFilter={category} 
            ageFilter={age}
          />
        </div>
      </div>
    </div>
  );
} 