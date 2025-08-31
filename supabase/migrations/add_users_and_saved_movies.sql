-- Enable required extensions (safe if already enabled)
create extension if not exists "uuid-ossp";

-- PROFILES TABLE (optional but useful)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamp with time zone default now()
);

alter table public.profiles enable row level security;

-- Policies: users can manage only their own profile; public can select limited fields
drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
create policy "Profiles are viewable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid());

-- SAVED MOVIES TABLE
create table if not exists public.saved_movies (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  movie_id uuid not null references public.movies(id) on delete cascade,
  created_at timestamp with time zone default now(),
  unique (user_id, movie_id)
);

alter table public.saved_movies enable row level security;

-- Policies: each user can CRUD only their own rows
drop policy if exists "Users can view their saved movies" on public.saved_movies;
create policy "Users can view their saved movies"
  on public.saved_movies for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can insert their own saved movies" on public.saved_movies;
create policy "Users can insert their own saved movies"
  on public.saved_movies for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can delete their own saved movies" on public.saved_movies;
create policy "Users can delete their own saved movies"
  on public.saved_movies for delete
  to authenticated
  using (user_id = auth.uid());


