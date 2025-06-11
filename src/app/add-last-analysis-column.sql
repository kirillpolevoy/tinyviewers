-- Add last_claude_analysis timestamp column to movies table
ALTER TABLE movies 
ADD COLUMN last_claude_analysis TIMESTAMP; 