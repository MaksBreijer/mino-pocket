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

Admins kunnen op `/admin/` ook inloggen met alleen een gebruikersnaam; die wordt aangevuld tot `<naam>@minorpocket.nl`.
Het admin-account `minorondernemerschap26` bestaat al in het project Minor Pocket.

Eerste admin: voeg jezelf toe in de SQL-editor en maak daarna een account aan op `/admin/`:

```sql
insert into public.invites (email, full_name, role) values ('jij@voorbeeld.nl', 'Jouw naam', 'admin');
```

## Database MO

De bestaande spreadsheet "Database MO" gaat via de beheeromgeving in de app (onderdeel *Database MO importeren*): download de sheet als .xlsx en kies het bestand op de admin-tablet. De omzetting staat in `dist/admin/import-mo.js`, het wegschrijven in `public.import_mo` (migratie 4). Opnieuw importeren is veilig; niets wordt dubbel toegevoegd.

- Elke minor (Minor 33 t/m 42, en oudere teamnummers) is een periode; teams krijgen hun teamnummer, idee en website.
- Studenten (ook zonder e-mailadres) staan in `students`; met e-mailadres krijgen ze een uitnodiging en teamlidmaatschap.
- Startup-, tussen- en eindassessments, OP's, sprints, individuele cijfers en de cijferlijsten staan in `assessment_records`; de aanwezigheidsformulieren in `attendance`.
- Studenten zien de beoordelingen van hun team en hun eigen persoonlijke cijfers, coaches die van hun teams, admins alles. Telefoonnummers en adressen worden niet overgenomen.

## Installeren

Het Supabase-project **Minor Pocket** (organisatie Minor ondernemerschap HVA, `ftejmutneuokhuitsleg`) heeft alle migraties al en staat ingevuld in `dist/js/config.js`. Voor een nieuw project:

1. Draai de bestanden in `supabase/migrations/` op volgorde in het Supabase-project.
2. Zet in Supabase onder Authentication → Sign In / Providers → Email **Confirm email** uit (anders krijgt iedereen eerst een bevestigingsmail; het gratis plan verstuurt er maar een paar per uur).
3. Vul de project-URL en publishable key in `dist/js/config.js` in.
4. Host de map `dist/` (ChatGPT Site, Cloudflare Pages of elke statische host).

## Live zetten

De site staat op **https://lively-voice-78a8.makscoolbreijer.workers.dev** (Cloudflare Worker `lively-voice-78a8`, statische bestanden uit `dist/`, zie `wrangler.jsonc`). Elke merge naar `main` zet hem automatisch live via `.github/workflows/deploy.yml`. Daarvoor moet in GitHub onder Settings → Secrets and variables → Actions het secret `CLOUDFLARE_API_TOKEN` staan: een Cloudflare API-token (sjabloon *Edit Cloudflare Workers*) van het account waar de Worker in staat. Handmatig opnieuw uitrollen kan via Actions → Deploy naar Cloudflare → Run workflow.
