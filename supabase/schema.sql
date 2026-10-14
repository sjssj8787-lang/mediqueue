create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  phone text not null,
  age text not null,
  service text not null default 'General Medicine',
  role text not null default 'patient' check (role in ('patient', 'staff', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, phone, age, service, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    coalesce(new.raw_user_meta_data ->> 'age', ''),
    coalesce(new.raw_user_meta_data ->> 'service', 'General Medicine'),
    'patient'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.staff_profiles (
  id text primary key,
  name text not null,
  email text not null,
  role text not null check (role in ('Doctor', 'Nurse', 'Reception', 'Counter Staff', 'Admin')),
  created_at timestamptz not null default now()
);

alter table public.staff_profiles enable row level security;

-- These public policies support the current client-only admin demo. Replace them with authenticated admin checks before production.
drop policy if exists "Public can view staff profiles" on public.staff_profiles;
create policy "Public can view staff profiles"
  on public.staff_profiles for select
  to anon, authenticated
  using (true);

drop policy if exists "Public can create staff profiles" on public.staff_profiles;
create policy "Public can create staff profiles"
  on public.staff_profiles for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Public can update staff profiles" on public.staff_profiles;
create policy "Public can update staff profiles"
  on public.staff_profiles for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Public can delete staff profiles" on public.staff_profiles;
create policy "Public can delete staff profiles"
  on public.staff_profiles for delete
  to anon, authenticated
  using (true);

-- Table for Contact Us Form Inquiries
create table if not exists public.contact_inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  message text not null,
  status text not null default 'Unread' check (status in ('Unread', 'Read', 'Replied')),
  created_at timestamptz not null default now()
);

alter table public.contact_inquiries enable row level security;

-- Anyone can submit a contact message
drop policy if exists "Anyone can submit contact inquiry" on public.contact_inquiries;
create policy "Anyone can submit contact inquiry"
  on public.contact_inquiries for insert
  with check (true);

-- Anyone authenticated can view contact inquiries
drop policy if exists "Authenticated users can view inquiries" on public.contact_inquiries;
create policy "Authenticated users can view inquiries"
  on public.contact_inquiries for select
  using (true);

-- Anyone authenticated can update contact inquiries
drop policy if exists "Authenticated users can update inquiries" on public.contact_inquiries;
create policy "Authenticated users can update inquiries"
  on public.contact_inquiries for update
  using (true);

-- Anyone authenticated can delete contact inquiries
drop policy if exists "Authenticated users can delete inquiries" on public.contact_inquiries;
create policy "Authenticated users can delete inquiries"
  on public.contact_inquiries for delete
  using (true);

