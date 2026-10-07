-- Startdata: de huidige minorperiode en de twee assessments uit het prototype.
insert into public.periods (name, is_current) values
  ('Minor 42 · halfjaar 1', true),
  ('Minor 42 · halfjaar 2', false)
on conflict (name) do nothing;

insert into public.assessments (period_id, title, description, file_hint)
select p.id, a.title, a.description, a.file_hint
from public.periods p,
  (values
    ('Pitch & Portfolio', 'Een pitchdeck en portfolio met probleem, doelgroep, validatie en volgende experimenten.', 'PDF of PowerPoint'),
    ('Ondernemingsplan', 'Een onderbouwd plan met waardepropositie, verdienmodel, planning en financiële uitgangspunten.', 'PDF of Word')
  ) as a (title, description, file_hint)
where p.is_current
on conflict (period_id, title) do nothing;
