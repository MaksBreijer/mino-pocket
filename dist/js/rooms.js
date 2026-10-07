// Lokalen reserveren: per dag zien wat bezet is, zelf boeken en eigen boekingen annuleren (student, coach en admin).
import { supabase, esc, message } from './supabase.js';

const time = (d) => new Date(d).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
const today = () => new Date().toLocaleDateString('sv-SE');

export const ROOM_STYLE = `<style>.rooms{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:12px 0}.room{border:1px solid #efd9ce;border-radius:12px;padding:12px;background:#fff}.room b{display:block;margin-bottom:6px}.slot{font-size:.9rem;padding:6px 0;border-top:1px solid #f3e6df;display:flex;justify-content:space-between;gap:8px;align-items:center}.slot.mine{color:#b9491d;font-weight:bold}.slot button{background:none;border:1px solid #efd9ce;border-radius:8px;padding:4px 8px;cursor:pointer;font:inherit;font-size:.8rem}.free{color:#3d8b5a;font-size:.9rem}.bookform{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;align-items:end}.bookform label{font-size:.85rem;color:#6f6560}.bookform input,.bookform select{width:100%;padding:10px;border:1px solid #dcbeb0;border-radius:8px;font:inherit;margin:4px 0 0}</style>`;

// box: element; me: { email }; opts: { admin, companyId }
export async function renderRooms(box, me, opts = {}) {
  if (!box.dataset.ready) {
    box.dataset.ready = 1;
    box.innerHTML = `<div class="bookform"><div><label>Datum<input type="date" class="r-date" value="${today()}"></label></div><div class="r-roomwrap"><label>Lokaal<select class="r-room"></select></label></div><div><label>Van<input type="time" class="r-from" value="09:00" step="900"></label></div><div><label>Tot<input type="time" class="r-to" value="11:00" step="900"></label></div><div><button class="button r-book" type="button">Reserveren</button></div></div><p class="r-msg hint" hidden></p><div class="rooms"></div>`;
    box.querySelector('.r-date').onchange = () => renderRooms(box, me, opts);
    box.querySelector('.r-book').onclick = () => book(box, me, opts);
  }
  const day = box.querySelector('.r-date').value || today();
  const from = new Date(day + 'T00:00'), to = new Date(from.getTime() + 864e5);
  const [{ data: rooms }, { data: bookings, error }] = await Promise.all([
    supabase.from('rooms').select('*').order('sort').order('name'),
    supabase.from('room_bookings').select('*, companies(name)').lt('starts_at', to.toISOString()).gt('ends_at', from.toISOString()).order('starts_at'),
  ]);
  if (error) return box.querySelector('.rooms').innerHTML = `<p class="hint">${esc(message(error))}</p>`;
  const sel = box.querySelector('.r-room'), keep = sel.value;
  sel.innerHTML = rooms.filter((r) => r.bookable || opts.admin).map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  if (keep) sel.value = keep;
  box.querySelector('.r-roomwrap').hidden = sel.options.length < 2;
  box.querySelector('.rooms').innerHTML = rooms.map((r) => {
    const list = bookings.filter((b) => b.room_id === r.id);
    if (!r.bookable && !list.length) return `<div class="room"><b>${esc(r.name)}</b><span class="hint">Niet te reserveren</span></div>`;
    return `<div class="room"><b>${esc(r.name)}</b>${list.length ? list.map((b) => {
      const mine = b.booked_by === me.email;
      return `<div class="slot${mine ? ' mine' : ''}"><span>${time(b.starts_at)}–${time(b.ends_at)}<br><small>${esc(b.companies?.name || (mine ? 'Jij' : b.booked_by))}${b.note ? ' · ' + esc(b.note) : ''}</small></span>${mine || opts.admin ? `<button data-cancel="${b.id}">Annuleren</button>` : ''}</div>`;
    }).join('') : '<span class="free">Hele dag vrij</span>'}</div>`;
  }).join('') || '<p class="hint">Nog geen lokalen.</p>';
  box.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = async () => {
    if (!confirm('Reservering annuleren?')) return;
    const { error } = await supabase.from('room_bookings').delete().eq('id', b.dataset.cancel);
    if (error) return alert(message(error));
    renderRooms(box, me, opts);
  });
}

async function book(box, me, opts) {
  const day = box.querySelector('.r-date').value, msg = box.querySelector('.r-msg');
  const starts = new Date(`${day}T${box.querySelector('.r-from').value}`), ends = new Date(`${day}T${box.querySelector('.r-to').value}`);
  if (!(ends > starts)) return show(msg, 'De eindtijd moet na de begintijd liggen.');
  const { error } = await supabase.from('room_bookings').insert({ room_id: box.querySelector('.r-room').value,
    starts_at: starts.toISOString(), ends_at: ends.toISOString(), company_id: opts.companyId || null });
  show(msg, error ? (error.code === '23P01' ? 'Dit lokaal is op dat moment al gereserveerd. Kies een andere tijd.' : message(error)) : 'Gereserveerd.');
  renderRooms(box, me, opts);
}
const show = (el, text) => { el.hidden = !text; el.textContent = text; };
