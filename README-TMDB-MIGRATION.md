# TMDB Data Migration - Performance Optimization

This migration stores TMDB poster URLs, ratings, and descriptions directly in the database instead of fetching them on every page load. This makes the app **much faster**.

## Step 1: Add Database Columns

1. Go to your [Supabase Dashboard](https://app.supabase.com)
2. Navigate to **SQL Editor**
3. Run the script from `scripts/add-tmdb-columns.sql`:

```sql
ALTER TABLE movies 
ADD COLUMN IF NOT EXISTS tmdb_poster_url TEXT,
ADD COLUMN IF NOT EXISTS tmdb_rating TEXT,
ADD COLUMN IF NOT EXISTS tmdb_description TEXT,
ADD COLUMN IF NOT EXISTS tmdb_updated_at TIMESTAMP WITH TIME ZONE;
```

## Step 2: Populate TMDB Data

Run the migration script to fetch and store TMDB data for all movies:

```bash
npm run migrate:tmdb
```

This will:
- Fetch poster URLs, ratings, and descriptions from TMDB
- Store them in the database
- Process movies in small batches to avoid rate limiting
- Only update movies that don't have TMDB data yet

## Step 3: Enjoy Fast Performance! 

The app will now:
- ✅ Load movie lists instantly (no API calls)
- ✅ Display posters immediately
- ✅ Show TMDB ratings and descriptions
- ✅ Only make TMDB calls for new movies

## Before vs After

**Before:** Every page load made 10+ TMDB API calls
**After:** Zero TMDB API calls on page load

## Re-running the Migration

You can safely re-run the migration script - it will only process movies that don't have TMDB data yet.

## Adding New Movies

When you add new movies to the database, just run the migration script again to fetch their TMDB data. 