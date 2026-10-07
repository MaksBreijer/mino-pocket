-- Import van "Database MO": studenten, teams, coaches, beoordelingen en
-- aanwezigheid uit de bestaande spreadsheet van de minor.

alter table public.companies
  add column team_number int,
  add column idea text,
  add column website text;
create unique index companies_team_number on public.companies (team_number) where team_number is not null;

-- Elke minor (33 t/m 42) is een periode; Minor 42 is de huidige.
update public.periods set name = 'Minor 42' where name = 'Minor 42 · halfjaar 1';
update public.periods set name = 'Minor 43' where name = 'Minor 42 · halfjaar 2';
insert into public.periods (name) select 'Minor ' || n from generate_series(33, 41) n on conflict (name) do nothing;

-- Alle studenten, ook zonder e-mailadres (die kunnen niet inloggen).
create table public.students (
  id uuid primary key default gen_random_uuid(),
  period_id uuid references public.periods (id) on delete set null,
  company_id uuid references public.companies (id) on delete set null,
  student_number text,
  full_name text not null,
  email text check (email = lower(email)),
  active boolean
);
-- Studenten zonder studentnummer worden op naam herkend.
create unique index students_key on public.students (period_id, (coalesce(student_number, lower(full_name))));
create index students_email on public.students (email);
create index students_number on public.students (student_number);
create index students_name on public.students (lower(full_name));
create index students_company on public.students (company_id);

-- Beoordelingen uit de formulieren (startup-, tussen-, eindassessment, OP's,
-- individueel) en de cijferlijsten. details bevat alle ingevulde velden.
create table public.assessment_records (
  id uuid primary key default gen_random_uuid(),
  period_id uuid references public.periods (id) on delete set null,
  company_id uuid references public.companies (id) on delete cascade,
  student_email text check (student_email = lower(student_email)),
  student_number text,
  source text not null,
  assessed_on date,
  assessors text,
  attempt text,
  grade text,
  details jsonb not null default '{}',
  import_key text unique
);
create index assessment_records_company on public.assessment_records (company_id);
create index assessment_records_student on public.assessment_records (student_email);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  period_id uuid references public.periods (id) on delete set null,
  full_name text not null,
  student_email text check (student_email = lower(student_email)),
  checked_at timestamptz not null,
  session text,
  remark text,
  import_key text unique
);

alter table public.students enable row level security;
alter table public.assessment_records enable row level security;
alter table public.attendance enable row level security;

create policy read_students on public.students for select to authenticated
  using (email = public.my_email()
         or (company_id is not null and (public.coaches_company(company_id) or public.in_company(company_id)))
         or public.is_trusted_admin());
create policy admin_write on public.students for all to authenticated
  using (public.is_trusted_admin()) with check (public.is_trusted_admin());

create policy read_records on public.assessment_records for select to authenticated
  using (student_email = public.my_email()
         or (company_id is not null and (public.in_company(company_id) or public.coaches_company(company_id)))
         or (student_email is not null and public.coaches_student(student_email))
         or public.is_trusted_admin());
create policy admin_write on public.assessment_records for all to authenticated
  using (public.is_trusted_admin()) with check (public.is_trusted_admin());

create policy read_attendance on public.attendance for select to authenticated
  using (student_email = public.my_email()
         or (student_email is not null and public.coaches_student(student_email))
         or public.is_trusted_admin());
create policy admin_write on public.attendance for all to authenticated
  using (public.is_trusted_admin()) with check (public.is_trusted_admin());

-- Importfunctie voor de beheeromgeving (gekoppelde tablet) en de SQL-editor.
-- Opnieuw importeren is veilig: bestaande regels worden bijgewerkt of overgeslagen.
create or replace function public.import_mo(kind text, rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare r jsonb; n int := 0; pid uuid; cid uuid;
begin
  if session_user = 'authenticator' and not public.is_trusted_admin() then
    raise exception 'Alleen beschikbaar op een gekoppelde beheertablet' using errcode = '42501';
  end if;
  for r in select * from jsonb_array_elements(rows) loop
    pid := (select id from public.periods where name = r ->> 'minor');
    if pid is null and r ->> 'minor' is not null then
      insert into public.periods (name) values (r ->> 'minor') returning id into pid;
    end if;
    if kind = 'coach' then
      insert into public.invites (email, full_name, role) values (r ->> 'email', r ->> 'name', 'coach')
      on conflict (email) do update set full_name = excluded.full_name, role = 'coach'
        where public.invites.role <> 'admin';
    elsif kind = 'team' then
      insert into public.companies (period_id, name, team_number, idea, website)
      values (pid, r ->> 'name', (r ->> 'nr')::int, r ->> 'idea', r ->> 'web')
      on conflict (team_number) where team_number is not null
      do update set name = excluded.name, idea = excluded.idea, website = excluded.website, period_id = excluded.period_id
      returning id into cid;
      insert into public.coach_assignments (period_id, coach_email, company_id)
      select pid, e, cid from jsonb_array_elements_text(coalesce(r -> 'coaches', '[]')) e
      on conflict do nothing;
    elsif kind = 'student' then
      cid := (select id from public.companies where team_number = (r ->> 'team')::int);
      insert into public.students (period_id, company_id, student_number, full_name, email, active)
      values (pid, cid, r ->> 'nr', r ->> 'name', r ->> 'email', (r ->> 'active')::boolean)
      on conflict (period_id, (coalesce(student_number, lower(full_name)))) do update
        set company_id = excluded.company_id, full_name = excluded.full_name, email = excluded.email, active = excluded.active;
      if r ->> 'email' is not null then
        insert into public.invites (email, full_name, role) values (r ->> 'email', r ->> 'name', 'student')
        on conflict (email) do nothing;
        if cid is not null then
          insert into public.company_members (company_id, email) values (cid, r ->> 'email') on conflict do nothing;
        end if;
      end if;
    elsif kind = 'record' then
      cid := (select id from public.companies where team_number = (r ->> 'team')::int);
      insert into public.assessment_records (period_id, company_id, student_email, student_number, source,
        assessed_on, assessors, attempt, grade, details, import_key)
      values (coalesce(pid, (select period_id from public.companies where id = cid)), cid,
        coalesce(r ->> 'email', (select s.email from public.students s where s.student_number = r ->> 'nr' and s.email is not null limit 1)),
        r ->> 'nr', r ->> 'src', (r ->> 'date')::date, r ->> 'by', r ->> 'try', r ->> 'grade', coalesce(r -> 'd', '{}'), md5(r::text))
      on conflict (import_key) do nothing;
    elsif kind = 'attendance' then
      insert into public.attendance (period_id, full_name, student_email, checked_at, session, remark, import_key)
      select coalesce(s.period_id, pid), r ->> 'name', s.email, (r ->> 'at')::timestamp at time zone 'Europe/Amsterdam',
             r ->> 'session', r ->> 'remark', md5(r::text)
      from (select 1) x
      left join lateral (select period_id, email from public.students
                         where lower(full_name) = lower(r ->> 'name')
                         order by (select p.name from public.periods p where p.id = period_id) desc nulls last limit 1) s on true
      on conflict (import_key) do nothing;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.import_mo(text, jsonb) from public, anon;
grant execute on function public.import_mo(text, jsonb) to authenticated;
