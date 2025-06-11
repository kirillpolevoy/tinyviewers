# 🎬 Subtitle-Based Movie Analysis System

## 🎯 **Objective**
Enhance movie & scene analysis by leveraging scraped movie subtitles for more accurate, comprehensive data using Claude AI.

## 🏗️ **Architecture**

```
Movies DB → TMDB (IMDB IDs) → OpenSubtitles → Supabase Storage → Claude Analysis → Enhanced Data
```

## 📊 **Database Schema Updates**

### **Movies Table - New Column**
```sql
-- Added to existing movies table
imdb_id TEXT  -- Format: "tt1234567"
```

### **New Subtitles Table**
```sql
CREATE TABLE subtitles (
    id UUID PRIMARY KEY,
    movie_id UUID REFERENCES movies(id),
    subtitle_text TEXT NOT NULL,
    language VARCHAR(10) DEFAULT 'en',
    source VARCHAR(50) DEFAULT 'opensubtitles', 
    file_format VARCHAR(10) DEFAULT 'srt',
    download_url TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## 🚀 **Setup Instructions**

### **1. Environment Variables**
Add to your `.env.local`:

```bash
# Existing
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# TMDB (for IMDB ID fetching)
TMDB_API_KEY=your_tmdb_key

# OpenSubtitles (for subtitle scraping)
OPENSUBTITLES_API_KEY=your_opensubtitles_key
```

### **2. Get API Keys**

#### **TMDB API Key** (Free)
1. Go to [themoviedb.org](https://www.themoviedb.org/)
2. Create account → Settings → API → Request API Key
3. Choose "Developer" → Fill out form
4. Copy your API Key

#### **OpenSubtitles API Key** (Free)
1. Go to [opensubtitles.com](https://www.opensubtitles.com/)
2. Create account → Consumer section
3. Create new application
4. Copy your API Key

### **3. Database Migration**
Run the SQL scripts in Supabase SQL editor:

```bash
# 1. Add IMDB ID column
cat scripts/01_add_imdb_id_column.sql

# 2. Create subtitles table  
cat scripts/02_create_subtitles_table.sql
```

### **4. Run the Scripts**
```bash
# Fetch IMDB IDs for all movies
npm run fetch:imdb

# Scrape subtitles for all movies with IMDB IDs
npm run scrape:subtitles

# Or run both in sequence
npm run setup:subtitles
```

## 📋 **Processing Pipeline**

### **Phase 1A: IMDB ID Collection**
- ✅ Add `imdb_id` column to movies table
- ✅ Create script to fetch IMDB IDs via TMDB API
- ✅ Process all 236 movies
- ✅ Rate limit: 4 requests/second (TMDB limit)

### **Phase 1B: Subtitle Scraping** 
- ✅ Create subtitles table
- ✅ Build OpenSubtitles integration
- ✅ Download highest-rated English subtitles
- ✅ Store full subtitle text in Supabase
- ✅ Rate limit: 1 request/second (respectful)

### **Phase 2: Claude Analysis** (Next)
- Parse subtitle content with Claude
- Extract scene-by-scene analysis
- Generate enhanced movie summaries
- Update both scenes and movies tables

## 🔧 **Script Details**

### **fetch-imdb-ids.js**
- Searches TMDB for each movie by title
- Retrieves IMDB ID from TMDB movie details
- Updates movies table with IMDB IDs
- **Rate limit**: 250ms between requests
- **Output**: Progress tracking, success/failure rates

### **scrape-subtitles.js**
- Queries movies with IMDB IDs but no subtitles
- Searches OpenSubtitles API for best English subtitle
- Downloads subtitle content as plain text
- Stores in Supabase subtitles table
- **Rate limit**: 1000ms between requests
- **Filtering**: Highest-rated subtitles preferred

## 📈 **Expected Results**

### **Volume Estimates**
- **Movies**: 236 total
- **IMDB ID Success Rate**: ~85% (200+ movies)
- **Subtitle Availability**: ~70% (140+ movies)
- **Final Coverage**: ~60% of movies with subtitle analysis

### **Data Quality**
- English subtitles only
- SRT format (timestamped)
- High-quality sources prioritized
- Full movie dialogue captured

## 🔄 **Usage After Setup**

### **Query Subtitles**
```typescript
// Get subtitle for analysis
const { data: subtitle } = await supabase
  .from('subtitles')
  .select('subtitle_text')
  .eq('movie_id', movieId)
  .single();
```

### **Check Coverage**
```sql
-- Movies with subtitles
SELECT COUNT(*) FROM movies m
JOIN subtitles s ON m.id = s.movie_id;

-- Movies missing subtitles
SELECT title FROM movies m
LEFT JOIN subtitles s ON m.id = s.movie_id  
WHERE s.id IS NULL AND m.imdb_id IS NOT NULL;
```

## 🚨 **Rate Limiting & Respectful Usage**

### **TMDB**: 40 requests/10 seconds
- Script uses 250ms delays (4 req/sec)
- Well within limits

### **OpenSubtitles**: No official limit
- Script uses 1000ms delays (1 req/sec)  
- Conservative approach to avoid blocking

### **Error Handling**
- Automatic retries for network issues
- Graceful failure with detailed logging
- Resume capability (skips existing data)

## 🔮 **Next Phase: Claude Analysis**

Once subtitles are collected, we'll create:

1. **Scene Analysis Script**: Parse subtitles → identify scenes → extract intensity markers
2. **Movie Summary Enhancement**: Generate better summaries using full dialogue
3. **Age Rating Refinement**: More accurate age scores based on actual content
4. **Batch Processing**: Analyze all movies with subtitles
5. **Quality Validation**: Compare new vs. existing scene data

This creates a **data-driven foundation** for superior movie analysis! 🎯 