-- Een team kan twee coaches hebben.
drop index public.coach_assignments_team;
create unique index coach_assignments_team on public.coach_assignments (company_id, coach_email) where company_id is not null;
