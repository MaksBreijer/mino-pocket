// Zet het Excel-bestand "Database MO" (Google Sheets → Downloaden → .xlsx) om
// naar regels voor public.import_mo: coaches, teams, studenten, beoordelingen
// en aanwezigheid. Werkt in de browser (window.XLSX) en in Node (meegegeven XLSX).

const EMPTY = new Set(['', 'nan', '0', '#REF!', '#N/A', 'None', 'FALSE', 'False', '#VALUE!', '#DIV/0!']);
const pad = n => String(n).padStart(2, '0');

function val(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    if (v === 0 || Number.isNaN(v)) return null;
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  }
  if (typeof v === 'boolean') return v ? 'True' : null;
  const s = String(v).trim();
  return EMPTY.has(s) ? null : s;
}

function email(v) {
  const s = val(v)?.toLowerCase();
  return s && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(s) ? s : null;
}

function teamnr(v) {
  const m = val(v)?.match(/^\s*(\d{4})(?!\d)/);
  return m ? Number(m[1]) : null;
}

// Minors 20 t/m 45; andere nummers zijn tikfouten in de formulieren.
const minorName = n => (n >= 20 && n <= 45 ? `Minor ${n}` : null);
const minorOfTeam = nr => (nr ? minorName(Math.floor(nr / 100)) : null);
function minor(v) {
  const m = val(v)?.match(/(\d{2})/);
  return m ? minorName(+m[1]) : null;
}

// Excel-datum (getal) of tekst → "YYYY-MM-DDTHH:MM:SS" (lokale Nederlandse tijd)
function stamp(XLSX, v) {
  if (typeof v === 'number' && v > 40000) {
    const d = XLSX.SSF.parse_date_code(v);
    return `${d.y}-${pad(d.m)}-${pad(d.d)}T${pad(d.H)}:${pad(d.M)}:${pad(Math.floor(d.S))}`;
  }
  const s = val(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(m[4] || 0)}:${pad(m[5] || 0)}:${pad(m[6] || 0)}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}T${pad(m[4] || 0)}:${pad(m[5] || 0)}:${pad(m[6] || 0)}`;
  return null;
}
const date = (XLSX, v) => {
  const s = stamp(XLSX, v);
  return s && +s.slice(0, 4) >= 2015 ? s.slice(0, 10) : null;
};

function clean(o) {
  for (const k of Object.keys(o)) if (o[k] === null || o[k] === undefined || (Array.isArray(o[k]) && !o[k].length)) delete o[k];
  return o;
}

// Kolomkoppen zoals in de sheet; dubbele koppen krijgen ".1", ".2" (SheetJS maakt er "_1" van).
function rows(XLSX, wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return { cols: [], data: [] };
  const data = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true }).map(r => {
    const o = {};
    for (const [k, v] of Object.entries(r)) o[k.replace(/_(\d+)$/, '.$1')] = v;
    return o;
  });
  const head = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0 })[0] || [];
  const cols = [], seen = {};
  for (const h of head) {
    if (h === null || h === undefined) continue;
    const k = String(h);
    cols.push(seen[k] ? `${k}.${seen[k]}` : k);
    seen[k] = (seen[k] || 0) + 1;
  }
  return { cols, data };
}

const TEAM_GRADES = ['SUA E', 'SUA H', 'CStartup', 'Tuss.Ass.', 'Eind.Ass.Portf.', 'Eind.Ass.Portf.her.', 'Cportf.', 'Eind.Ass.bedr.',
  'Eind.Ass.bedr.her.', 'Cbedrijf', 'OP1', 'OP1her', 'COP1', 'OP2', 'OP2her', 'COP2', 'OP3', 'OP3her', 'COP3', 'Op4', 'OP4her',
  'COP4', 'OP5', 'OP5her', 'COP5', "Gem.OP's", 'BAMStrat', 'BAMBrand', 'BAMUit', 'Feedback', 'BedrijfFinance', 'BedrijfJuridisch',
  'BedrijfIE', 'BedrijfFeedback', 'Salesbeoordeling1', 'Salesbeoordeling1.1', 'Salesbeoordeling1.2', 'SalesFeedback',
  'Creativebeoordeling1', 'Creativebeoordeling2', 'CreativeFeedback'];

// Formulierbladen: bron in de app en de kolom met het cijfer.
const FORMS = {
  'Startupassessment': ['Startupassessment', 'Cijfer Start.Ass.'],
  'Startup pilot': ['Startupassessment (pilot)', null],
  'newTussen': ['Tussenassessment', null],
  'Tussenassessment': ['Tussenassessment', 'Cijfer'],
  'Eindassessment': ['Eindassessment', 'Beoordeling Onderneming met een cijfer (12ECTS)'],
  'OP1 SDG': ['OP1 SDG', "Cijfer OP1 SDG's"],
  'OP 2 Netwerken': ['OP2 Netwerken', 'Cijfer OP2 Netwerken '],
  'OP3 Creative Campagnes': ['OP3 Creative campagnes', 'Gemiddelde'],
  'OP 4 Finance': ['OP4 Finance', null],
  'Sprint BAM': ['Sprint BAM', null],
  'Sprint Bedrijfsklaar': ['Sprint Bedrijfsklaar', null],
  'Sprint Sales': ['Sprint Sales', null],
  'Sprint Campagne & Sales': ['Sprint Campagne & Sales', null],
  'Sprint Creative': ['Sprint Creative', null],
  'Sales Resultaten': ['Sales resultaten', null],
};
const SKIP = /Row ID|^Image$|^Button$|Edit URL|^Unnamed|^__EMPTY|^minor$/i;
const ASSESSOR_COLS = ['Coach', 'Feedbackgever', 'Standup Coach', 'Stand Up Coach', 'Naam invuller'];

export function transformMO(XLSX, wb) {
  // Coaches: naam → e-mail (uit Coaches en Users met rol Coach)
  const coachByName = new Map(), coaches = new Map();
  for (const r of rows(XLSX, wb, 'Coaches').data) {
    const n = val(r['Naam']), e = email(r['E-mail']);
    if (n && e) { coachByName.set(n.toLowerCase(), e); coaches.set(e, n); }
  }
  const users = rows(XLSX, wb, 'Users').data;
  for (const r of users) {
    if (val(r['Role']) !== 'Coach') continue;
    const n = val(r['Naam']), e = email(r['E-mail']);
    if (n && e) {
      if (!coachByName.has(n.toLowerCase())) coachByName.set(n.toLowerCase(), e);
      if (!coaches.has(e)) coaches.set(e, n);
    }
  }
  const coachRows = [...coaches].map(([e, n]) => ({ email: e, name: n }));

  // Teams + cijferoverzicht per team
  const teamRows = [], records = [], teams = new Set(), names = new Set(), unknownCoaches = new Set();
  for (const r of rows(XLSX, wb, 'Teams').data) {
    const nr = teamnr(r['Teamnr']);
    if (!nr || teams.has(nr)) continue;
    teams.add(nr);
    const mn = minor(r['Minor']) || minorOfTeam(nr);
    const cs = [];
    for (const c of [val(r['Coach']), val(r['Coach2'])]) {
      if (!c) continue;
      const e = coachByName.get(c.toLowerCase());
      e ? cs.push(e) : unknownCoaches.add(c);
    }
    let name = val(r[' Teamnaam']) || `Team ${nr}`;
    if (names.has(`${mn}|${name.toLowerCase()}`)) name = `${name} (${nr})`;
    names.add(`${mn}|${name.toLowerCase()}`);
    const web = val(r['Website']);
    teamRows.push(clean({ nr, name, idea: val(r['Bedrijfsidee']), web: web && web.includes('.') ? web : null, minor: mn, coaches: cs }));
    const d = clean(Object.fromEntries(TEAM_GRADES.map(k => [k, val(r[k])])));
    if (Object.keys(d).length) records.push(clean({ team: nr, minor: mn, src: 'Cijferlijst team', grade: d['Cbedrijf'] ?? null, d }));
  }

  // Studenten
  const students = [], seen = new Set();
  for (const r of users) {
    const n = val(r['Naam']);
    if (!n || val(r['Role']) === 'Coach') continue;
    const nr = val(r['Stud.nr']), tn = teamnr(r['Team nr']);
    const mn = minor(r['Minor']) || minor(r['Role']) || minorOfTeam(tn);
    if (!mn) continue;
    const key = `${mn}|${nr || n.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = r['Actief'];
    const active = a === true || /^true$/i.test(String(a ?? '')) ? true : a === false || /^false$/i.test(String(a ?? '')) ? false : null;
    students.push(clean({ minor: mn, team: teams.has(tn) ? tn : null, nr, name: n, email: email(r['E-mail']), active }));
  }

  // Formulieren (assessments, OP's, sprints)
  for (const [sheet, [src, gcol]] of Object.entries(FORMS)) {
    const { cols, data } = rows(XLSX, wb, sheet);
    const tcol = cols.find(c => /^(teamnummer|selecteer je team|teamnr)/i.test(c.trim()));
    if (!tcol) continue;
    const acol = cols.filter(c => /^assessor/i.test(c) || ASSESSOR_COLS.includes(c));
    const kcol = cols.find(c => /kans/i.test(c));
    const mcol = cols.find(c => c.toLowerCase() === 'minor');
    const dcol = cols.includes('Datum toets') ? 'Datum toets' : 'Tijdstempel';
    for (const r of data) {
      const nr = teamnr(r[tcol]);
      if (!nr) continue;
      const d = {};
      for (const c of cols) {
        if ([tcol, kcol, mcol, dcol, 'Tijdstempel'].includes(c) || acol.includes(c) || SKIP.test(c)) continue;
        const v = val(r[c]);
        if (v && !v.startsWith('http')) d[c.replace(/\s+/g, ' ').trim()] = v;
      }
      const g = gcol ? val(r[gcol]) : null;
      if (!Object.keys(d).length && !g) continue;
      d['Teamnummer'] = String(nr);
      const by = acol.map(c => val(r[c])).filter(Boolean).join(', ');
      records.push(clean({ team: nr, minor: (mcol && minor(r[mcol])) || minorOfTeam(nr), src, date: date(XLSX, r[dcol]),
        by: by || null, try: kcol ? val(r[kcol]) : null, grade: g, d }));
    }
  }

  // Individuele cijfers
  for (const r of rows(XLSX, wb, 'Individueel').data) {
    const nr = val(r['Studentnummer']);
    if (!nr) continue;
    records.push(clean({ nr, src: 'Individueel assessment', date: date(XLSX, r['Datum toets']), by: val(r['Assessor 1']),
      try: val(r['Eerste kans of herkansing?']), grade: val(r['Cijfer Student']),
      d: clean({ Naam: val(r['Naam Student (voor- achternaam)']), Opmerkingen: val(r['Opmerkingen']) }) }));
  }
  for (const r of rows(XLSX, wb, 'Cijferlijst Indiviueel').data) {
    const nr = val(r['Studnr.']), tn = teamnr(r['Teamnr.']);
    if (!nr) continue;
    const d = clean({ Naam: val(r['Naam']), Cbedrijf: val(r['Cbedrijf']), 'Cindv.': val(r['Cindv.']), "COP's": val(r["COP's"]), 'Cindv.H': val(r['Cindv.H']) });
    records.push(clean({ team: tn, minor: minorOfTeam(tn), nr, src: 'Cijferlijst individueel', grade: d['Cindv.'] ?? null, d }));
  }

  // Aanwezigheid
  const attendance = [];
  for (const r of rows(XLSX, wb, 'Aanwezigheid').data) {
    const n = val(r['Wat is je naam']), t = stamp(XLSX, r['Tijdstempel']);
    if (!n || !t || +t.slice(0, 4) < 2015) continue;
    attendance.push(clean({ name: n, at: t, session: val(r['Passcode ']), remark: val(r['Goede flow zo? Of mis je iets?']) }));
  }

  return {
    steps: [['coach', coachRows], ['team', teamRows], ['student', students], ['record', records], ['attendance', attendance]],
    unknownCoaches: [...unknownCoaches].sort(),
  };
}
