-- Lokalen reserveren (één lokaal; nooit dubbel geboekt) en "mijn coach" voor studenten.
create extension if not exists btree_gist with schema extensions;

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort int not null default 0,
  bookable boolean not null default true
);
insert into public.rooms (name, sort, bookable) values ('Lokaal', 1, true);

create table public.room_bookings (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  booked_by text not null default public.my_email(),
  company_id uuid references public.companies (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- Een lokaal kan op hetzelfde moment maar door één persoon of team gereserveerd zijn.
  constraint room_bookings_no_overlap exclude using gist (room_id with =, tstzrange(starts_at, ends_at) with &&)
);

alter table public.rooms enable row level security;
alter table public.room_bookings enable row level security;

create policy read_all on public.rooms for select to authenticated using (true);
create policy admin_write on public.rooms for all to authenticated
  using (public.is_trusted_admin()) with check (public.is_trusted_admin());

create policy read_all on public.room_bookings for select to authenticated using (true);
create policy book_own on public.room_bookings for insert to authenticated
  with check (public.is_trusted_admin()
              or (booked_by = public.my_email() and exists (select 1 from public.rooms r where r.id = room_id and r.bookable)));
create policy cancel_own on public.room_bookings for delete to authenticated
  using (booked_by = public.my_email() or public.is_trusted_admin());

-- Coaches van de ingelogde student (team en persoonlijk) in een periode.
create or replace function public.my_coaches(p_period uuid)
returns table (email text, full_name text, kind text)
language sql stable security definer set search_path = '' as $$
  select distinct a.coach_email, coalesce(i.full_name, p.full_name, a.coach_email),
         case when a.company_id is null then 'persoonlijk' else 'team' end
  from public.coach_assignments a
  left join public.invites i on i.email = a.coach_email
  left join public.profiles p on p.email = a.coach_email
  where a.period_id = p_period
    and (a.student_email = public.my_email() or public.in_company(a.company_id));
$$;
revoke execute on function public.my_coaches(uuid) from public, anon;
grant execute on function public.my_coaches(uuid) to authenticated;
