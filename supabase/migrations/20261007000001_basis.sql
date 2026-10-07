-- Minor Pocket: basisschema, rollen en beveiliging.
-- Rollen: student, coach, admin. Admins kunnen alleen beheren vanaf een
-- gekoppeld apparaat (de admin-tablet); dat apparaat stuurt zijn geheime
-- token mee in de header x-device-token.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tabellen

create table public.invites (
  email text primary key check (email = lower(email)),
  role text not null default 'student' check (role in ('student', 'coach', 'admin')),
  full_name text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text,
  role text not null check (role in ('student', 'coach', 'admin')),
  created_at timestamptz not null default now()
);

create table public.periods (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index periods_one_current on public.periods (is_current) where is_current;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.periods (id) on delete cascade,
  name text not null,
  unique (period_id, name)
);

-- Studenten worden op e-mail aan een onderneming gekoppeld, zodat de admin
-- dit al kan doen voordat de student een account heeft.
create table public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null check (email = lower(email)),
  primary key (company_id, email)
);

create table public.coach_assignments (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.periods (id) on delete cascade,
  coach_email text not null check (coach_email = lower(coach_email)),
  company_id uuid references public.companies (id) on delete cascade,
  student_email text check (student_email = lower(student_email)),
  check ((company_id is null) <> (student_email is null))
);
create unique index coach_assignments_team on public.coach_assignments (period_id, company_id) where company_id is not null;
create unique index coach_assignments_person on public.coach_assignments (period_id, student_email) where student_email is not null;

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.periods (id) on delete cascade,
  title text not null,
  description text,
  file_hint text,
  due_at timestamptz,
  unique (period_id, title)
);

create table public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.periods (id) on delete cascade,
  starts_at timestamptz not null,
  title text not null,
  location text
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  student_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  file_path text not null,
  file_name text not null,
  created_at timestamptz not null default now()
);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  student_email text check (student_email = lower(student_email)),
  coach_id uuid not null default auth.uid() references public.profiles (id),
  score numeric(3, 1) check (score between 1 and 10),
  body text not null,
  created_at timestamptz not null default now(),
  check ((company_id is null) <> (student_email is null))
);

create table public.admin_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create table public.admin_pairing_codes (
  code_hash text primary key,
  created_by uuid references public.profiles (id),
  expires_at timestamptz not null,
  used_at timestamptz
);

-- ---------------------------------------------------------------- helpers

create or replace function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.my_email() returns text
language sql stable security definer set search_path = '' as $$
  select email from public.profiles where id = auth.uid()
$$;

create or replace function public.device_token_hash() returns text
language sql stable set search_path = '' as $$
  select encode(extensions.digest(
    coalesce(current_setting('request.headers', true)::json ->> 'x-device-token', ''), 'sha256'), 'hex')
$$;

-- Admin op een gekoppeld apparaat. Dit is de enige manier om te beheren.
create or replace function public.is_trusted_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_role() = 'admin'
     and exists (select 1 from public.admin_devices
                 where token_hash = public.device_token_hash() and revoked_at is null)
$$;

create or replace function public.coaches_company(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.coach_assignments
                 where company_id = p_company and coach_email = public.my_email())
$$;

create or replace function public.coaches_student(p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.coach_assignments a
                 where a.coach_email = public.my_email()
                   and (a.student_email = p_email
                        or exists (select 1 from public.company_members m
                                   where m.company_id = a.company_id and m.email = p_email)))
$$;

create or replace function public.in_company(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.company_members
                 where company_id = p_company and email = public.my_email())
$$;

-- Alleen uitgenodigde e-mailadressen kunnen een account aanmaken.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv public.invites;
begin
  select * into inv from public.invites where email = lower(new.email);
  if not found then
    raise exception 'Dit e-mailadres is niet uitgenodigd voor Minor Pocket.';
  end if;
  insert into public.profiles (id, email, full_name, role)
  values (new.id, lower(new.email), inv.full_name, inv.role);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- apparaat koppelen

-- Een gekoppelde admin-tablet maakt een eenmalige code voor een nieuw apparaat.
create or replace function public.create_pairing_code() returns text
language plpgsql security definer set search_path = '' as $$
declare code text := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
begin
  if not public.is_trusted_admin() then
    raise exception 'Alleen vanaf een gekoppelde admin-tablet.';
  end if;
  insert into public.admin_pairing_codes (code_hash, created_by, expires_at)
  values (encode(extensions.digest(code, 'sha256'), 'hex'), auth.uid(), now() + interval '15 minutes');
  return code;
end $$;

-- Eerste tablet: draai `select public.admin_bootstrap_code();` in de Supabase
-- SQL-editor. Niet aanroepbaar vanuit de app.
create or replace function public.admin_bootstrap_code() returns text
language plpgsql security definer set search_path = '' as $$
declare code text := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
begin
  insert into public.admin_pairing_codes (code_hash, expires_at)
  values (encode(extensions.digest(code, 'sha256'), 'hex'), now() + interval '1 hour');
  return code;
end $$;

-- Koppelt het huidige apparaat. Geeft het geheime apparaattoken terug, dat de
-- tablet lokaal bewaart. In de database staat alleen de hash.
create or replace function public.pair_admin_device(p_code text, p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  token text := encode(extensions.gen_random_bytes(32), 'hex');
  n int;
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Alleen admins kunnen een apparaat koppelen.';
  end if;
  update public.admin_pairing_codes set used_at = now()
   where code_hash = encode(extensions.digest(upper(trim(p_code)), 'sha256'), 'hex')
     and used_at is null and expires_at > now();
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Code ongeldig of verlopen.';
  end if;
  insert into public.admin_devices (name, token_hash, created_by)
  values (coalesce(nullif(trim(p_name), ''), 'Admin-tablet'),
          encode(extensions.digest(token, 'sha256'), 'hex'), auth.uid());
  return token;
end $$;

create or replace function public.touch_admin_device() returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trusted_admin() then return false; end if;
  update public.admin_devices set last_seen_at = now() where token_hash = public.device_token_hash();
  return true;
end $$;

revoke execute on function public.admin_bootstrap_code() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.invites enable row level security;
alter table public.profiles enable row level security;
alter table public.periods enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.coach_assignments enable row level security;
alter table public.assessments enable row level security;
alter table public.schedule_events enable row level security;
alter table public.submissions enable row level security;
alter table public.feedback enable row level security;
alter table public.admin_devices enable row level security;
alter table public.admin_pairing_codes enable row level security;

create policy admin_all on public.invites for all to authenticated
  using (public.is_trusted_admin()) with check (public.is_trusted_admin());

create policy read_profiles on public.profiles for select to authenticated
  using (id = auth.uid() or role = 'coach' or public.my_role() = 'coach' or public.is_trusted_admin());
create policy admin_update on public.profiles for update to authenticated
  using (public.is_trusted_admin()) with check (public.is_trusted_admin());

-- Algemene gegevens: iedereen die ingelogd is mag lezen, alleen de tablet schrijft.
create policy read_all on public.periods for select to authenticated using (true);
create policy admin_write on public.periods for all to authenticated
  using (public.is_trusted_admin()) with check (public.is_trusted_admin());
create policy read_all on public.companies for select to authenticated using (true);
create policy admin_write on public.companies for all to authenticated
  using (public.is_trusted_admin()) with check (public.is_trusted_admin());
create policy read_all on public.company_members for select to authenticated using (true);
create policy admin_write on public.company_members for all to authenticated
  using (public.is_trusted_admin()) with check (public.is_trusted_admin());
create policy read_all on public.assessments for select to authenticated using (true);
create policy admin_write on public.assessments for all to authenticated
  using (public.is_trusted_admin()) with check (public.is_trusted_admin());
create policy read_all on public.schedule_events for select to authenticated using (true);
create policy admin_write on public.schedule_events for all to authenticated
  using (public.is_trusted_admin()) with check (public.is_trusted_admin());

create policy read_own on public.coach_assignments for select to authenticated
  using (coach_email = public.my_email() or public.is_trusted_admin());
create policy admin_write on public.coach_assignments for all to authenticated
  using (public.is_trusted_admin()) with check (public.is_trusted_admin());

create policy read_submissions on public.submissions for select to authenticated
  using (student_id = auth.uid()
         or public.coaches_student((select email from public.profiles p where p.id = student_id))
         or public.is_trusted_admin());
create policy student_insert on public.submissions for insert to authenticated
  with check (student_id = auth.uid() and public.my_role() = 'student');

create policy read_feedback on public.feedback for select to authenticated
  using (student_email = public.my_email()
         or (company_id is not null and public.in_company(company_id))
         or coach_id = auth.uid()
         or public.is_trusted_admin());
create policy coach_insert on public.feedback for insert to authenticated
  with check (coach_id = auth.uid() and public.my_role() = 'coach'
              and ((company_id is not null and public.coaches_company(company_id))
                   or (student_email is not null and public.coaches_student(student_email))));

create policy admin_read on public.admin_devices for select to authenticated
  using (public.is_trusted_admin());
create policy admin_revoke on public.admin_devices for update to authenticated
  using (public.is_trusted_admin()) with check (public.is_trusted_admin());
-- admin_pairing_codes: geen policies, alleen via de functies hierboven.

-- ---------------------------------------------------------------- opslag

insert into storage.buckets (id, name, public) values ('submissions', 'submissions', false)
on conflict (id) do nothing;

create policy student_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'submissions' and (storage.foldername(name))[1] = auth.uid()::text);
create policy read_uploads on storage.objects for select to authenticated
  using (bucket_id = 'submissions' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.coaches_student((select email from public.profiles p where p.id::text = (storage.foldername(name))[1]))
    or public.is_trusted_admin()));
