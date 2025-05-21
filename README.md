# Toddler-Friendly Movies

A Next.js application that helps parents find age-appropriate movies for toddlers by providing detailed scene-by-scene analysis and age-specific ratings.

## Features

- Browse movies with age-specific ratings
- View detailed scene breakdowns
- Filter content by age group (12m, 24m, 36m)
- Visual indicators for scene intensity

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env.local` file in the root directory with your Supabase credentials:
```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

3. Set up your Supabase database:
   - Create a new project at [supabase.com](https://supabase.com)
   - Go to the SQL editor
   - Run the SQL script from `supabase/migrations/create_tables.sql`

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Technology Stack

- Next.js 14
- TypeScript
- Tailwind CSS
- Supabase (Database & Authentication)

## Project Structure

- `/src/app` - Next.js app router pages
- `/src/lib` - Utility functions and configurations
- `/src/types` - TypeScript type definitions
- `/supabase` - Database migrations and configurations

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
