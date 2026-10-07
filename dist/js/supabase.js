import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const DEVICE_KEY = 'mino-admin-device';

export function deviceToken() {
  try { return localStorage.getItem(DEVICE_KEY); } catch { return null; }
}

export function setDeviceToken(token) {
  localStorage.setItem(DEVICE_KEY, token);
}

// Op de admin-tablet gaat het apparaattoken mee met elk verzoek; de database
// staat beheer alleen toe als dat token bij een gekoppeld apparaat hoort.
const token = deviceToken();
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { headers: token ? { 'x-device-token': token } : {} },
});

export async function currentProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
  return data;
}

// Stuurt naar de juiste inlogpagina als de gebruiker niet de verwachte rol heeft.
export async function requireRole(role, loginPath = '/login.html') {
  const profile = await currentProfile();
  if (!profile || profile.role !== role) {
    location.replace(loginPath);
    return new Promise(() => {});
  }
  return profile;
}

export async function logout(path = '/login.html') {
  await supabase.auth.signOut();
  location.replace(path);
}

export async function currentPeriod() {
  const { data } = await supabase.from('periods').select('*').eq('is_current', true).maybeSingle();
  return data;
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function formatDate(value) {
  return new Date(value).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function message(error) {
  const text = error?.message || String(error);
  if (/Invalid login credentials/i.test(text)) return 'E-mailadres of wachtwoord klopt niet.';
  if (/niet uitgenodigd|Database error saving new user/i.test(text)) return 'Dit e-mailadres is niet uitgenodigd. Vraag de admin om je toe te voegen.';
  if (/row-level security/i.test(text)) return 'Je hebt geen toegang om dit op te slaan.';
  return text;
}
