// Beoordelingen en aanwezigheid uit "Database MO" tonen (student, coach en admin).
import { supabase, esc } from './supabase.js';

const ORDER = ['Startupassessment', 'Startupassessment (pilot)', 'Tussenassessment', 'Eindassessment', 'OP1 SDG', 'OP2 Netwerken',
  'OP3 Creative campagnes', 'OP4 Finance', 'Sprint BAM', 'Sprint Bedrijfsklaar', 'Sprint Sales', 'Sprint Creative',
  'Sprint Campagne & Sales', 'Sales resultaten', 'Individueel assessment', 'Cijferlijst individueel', 'Cijferlijst team'];
const rank = (s) => (ORDER.indexOf(s) + 1 || 99);
const day = (d) => new Date(d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });

export const RECORD_STYLE = `<style>.rec{border:1px solid #efd9ce;border-radius:12px;margin:8px 0;background:#fff}.rec summary{padding:11px 13px;cursor:pointer;display:flex;justify-content:space-between;gap:10px;align-items:baseline}.rec summary small{color:#6f6560}.rec .grade{font-weight:bold;color:#b9491d;white-space:nowrap}.rec dl{margin:0;padding:0 13px 12px;display:grid;grid-template-columns:minmax(120px,38%) 1fr;gap:6px 12px;font-size:.92rem}.rec dt{color:#6f6560}.rec dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:600px){.rec dl{grid-template-columns:1fr}.rec dd{margin-bottom:6px}}</style>`;

// Alle rijen ophalen; de API geeft er maximaal 1000 per keer.
export async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

export function recordsHtml(records, nameOf = (e) => e) {
  if (!records.length) return '<p class="hint">Nog geen beoordelingen gevonden.</p>';
  return [...records]
    .sort((a, b) => rank(a.source) - rank(b.source) || String(a.assessed_on || '').localeCompare(String(b.assessed_on || '')))
    .map((r) => {
      const meta = [r.assessed_on && day(r.assessed_on), r.attempt, r.assessors && 'door ' + r.assessors,
        r.student_email && nameOf(r.student_email)].filter(Boolean).map(esc).join(' · ');
      const rows = Object.entries(r.details || {}).filter(([k]) => k !== 'Teamnummer')
        .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
      return `<details class="rec"><summary><span><b>${esc(r.source)}</b><br><small>${meta || '&nbsp;'}</small></span>${r.grade ? `<span class="grade">${esc(r.grade)}</span>` : ''}</summary>${rows ? `<dl>${rows}</dl>` : ''}</details>`;
    }).join('');
}

export function attendanceHtml(rows) {
  if (!rows.length) return '<p class="hint">Geen aanwezigheid geregistreerd.</p>';
  const people = {};
  for (const r of rows) (people[r.full_name] ||= []).push(r);
  return Object.entries(people).sort(([a], [b]) => a.localeCompare(b)).map(([name, list]) =>
    `<details class="rec"><summary><span><b>${esc(name)}</b></span><span class="grade">${list.length}×</span></summary><dl>${list
      .sort((a, b) => a.checked_at.localeCompare(b.checked_at))
      .map((r) => `<dt>${day(r.checked_at)}</dt><dd>${esc(r.session || 'Aanwezig')}${r.remark ? ' · ' + esc(r.remark) : ''}</dd>`).join('')}</dl></details>`).join('');
}

// Beoordelingen van een team en/of losse studenten.
export function loadRecords({ companyIds = [], emails = [] }) {
  const or = [];
  if (companyIds.length) or.push(`company_id.in.(${companyIds.join(',')})`);
  if (emails.length) or.push(`student_email.in.(${emails.map((e) => `"${e}"`).join(',')})`);
  if (!or.length) return Promise.resolve([]);
  return fetchAll(() => supabase.from('assessment_records').select('*').or(or.join(',')).order('assessed_on'));
}

export function loadAttendance(emails) {
  if (!emails.length) return Promise.resolve([]);
  return fetchAll(() => supabase.from('attendance').select('*').in('student_email', emails).order('checked_at'));
}
