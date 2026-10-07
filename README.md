# Mino Pocket

Webportaal voor de Minor Ondernemerschap met aparte omgevingen voor studenten, coaches en beheerders.

## Opbouw

- Frontend: statische pagina's in `dist/` (geen build nodig), praat rechtstreeks met Supabase via `supabase-js`.
- Database: Supabase. Het schema staat in `supabase/migrations/`.
- Beveiliging zit in de database (row level security): elke rol ziet en wijzigt alleen wat bij die rol hoort.

| Omgeving | Adres | Wie |
| --- | --- | --- |
| Student | `/` | studenten: rooster, assessments inleveren, feedback lezen |
| Coach | `/coach.html` | coaches: eigen teams/studenten, inleveringen, feedback geven |
| Admin | `/admin/` | admins, **alleen op een gekoppelde admin-tablet** |

Studenten en coaches loggen in via `/login.html`. Admins hebben een eigen inlogscherm op `/admin/`.

## Admin-tablet

Beheren kan alleen vanaf een gekoppeld apparaat. Bij het koppelen krijgt de tablet een geheim token
dat lokaal wordt bewaard en met elk verzoek meegaat (`x-device-token`). De database controleert bij elke
wijziging of het een admin-account is én of het token bij een gekoppeld, niet-ingetrokken apparaat hoort.
Een admin-wachtwoord op een ander apparaat geeft dus geen toegang.

- Eerste tablet: draai `select public.admin_bootstrap_code();` in de Supabase SQL-editor en vul de code in op de tablet (1 uur geldig).
- Extra tablet: maak op een gekoppelde tablet onder **Apparaten** een koppelcode (15 minuten geldig).
- Tablet kwijt: ontkoppel hem onder **Apparaten**, of zet `revoked_at` in de tabel `admin_devices`.

## Accounts

Alleen uitgenodigde e-mailadressen kunnen een account aanmaken. De admin nodigt mensen uit of importeert
een klas als CSV/Excel met de kolommen `email`, `naam`, `rol` (student/coach/admin) en optioneel `onderneming`.

Eerste admin: voeg jezelf toe in de SQL-editor en maak daarna een account aan op `/admin/`:

```sql
insert into public.invites (email, full_name, role) values ('jij@voorbeeld.nl', 'Jouw naam', 'admin');
```

## Installeren

Het Supabase-project **Minor Pocket** (organisatie Minor ondernemerschap HVA, `ftejmutneuokhuitsleg`) heeft alle migraties al en staat ingevuld in `dist/js/config.js`. Voor een nieuw project:

1. Draai de bestanden in `supabase/migrations/` op volgorde in het Supabase-project.
2. Zet in Supabase onder Authentication → Sign In / Providers → Email **Confirm email** uit (anders krijgt iedereen eerst een bevestigingsmail; het gratis plan verstuurt er maar een paar per uur).
3. Vul de project-URL en publishable key in `dist/js/config.js` in.
4. Host de map `dist/` (ChatGPT Site, Cloudflare Pages of elke statische host).
