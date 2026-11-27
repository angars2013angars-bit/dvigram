/** Общие хелперы Dvis: короткие ключи, коды приглашений и форматтеры. */

export const KEY_HINT = 'DV-AB3K-9QWE';
export const REACTIONS = ['👍', '❤️', '😂', '🔥', '😮', '😢'];

const KEY_STORAGE = 'dvis:key';
const KEY_COOKIE = 'dvis_key';
const KEY_RE = /^DV-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

function readCookie(name) {
  try {
    const part = document.cookie.split('; ').find((item) => item.startsWith(`${name}=`));
    return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
  } catch {
    return '';
  }
}

function writeCookie(name, value, maxAge) {
  try {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
  } catch {
    /* без cookie ключ остаётся в хранилищах браузера */
  }
}

/**
 * Ключ хранится только на устройстве; сервер его повторно не отдаёт.
 * Три копии (localStorage, sessionStorage, cookie) нужны, чтобы ключ не
 * «вылетал» после очистки одного хранилища или перезапуска вкладки.
 */
export function getSavedKey() {
  const sources = [];
  try { sources.push(localStorage.getItem(KEY_STORAGE)); } catch { /* ignore */ }
  try { sources.push(sessionStorage.getItem(KEY_STORAGE)); } catch { /* ignore */ }
  sources.push(readCookie(KEY_COOKIE));
  return sources.find((value) => typeof value === 'string' && KEY_RE.test(value)) || '';
}

export function saveKey(key) {
  if (!KEY_RE.test(String(key || ''))) return;
  try { localStorage.setItem(KEY_STORAGE, key); } catch { /* ignore */ }
  try { sessionStorage.setItem(KEY_STORAGE, key); } catch { /* ignore */ }
  if (readCookie(KEY_COOKIE) !== key) writeCookie(KEY_COOKIE, key, 60 * 60 * 24 * 90);
}

export function clearSavedKey() {
  try { localStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ }
  try { sessionStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ }
  try { document.cookie = `${KEY_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`; } catch { /* ignore */ }
}

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomHex(bytes) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function randomChars(count) {
  const values = new Uint8Array(count);
  crypto.getRandomValues(values);
  return Array.from(values, (byte) => KEY_ALPHABET[byte % KEY_ALPHABET.length]).join('');
}

export function generateKey() {
  const body = randomChars(8);
  return `DV-${body.slice(0, 4)}-${body.slice(4)}`;
}

export function normalizeKey(value) {
  const text = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = text.startsWith('DV') ? text.slice(2) : '';
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(body)) throw new Error('Неверный формат ключа. ' + KEY_HINT);
  return `DV-${body.slice(0, 4)}-${body.slice(4)}`;
}

export function generateInviteCode() {
  return `DVS-${randomHex(6).match(/.{1,4}/g).join('-')}`;
}

export function normalizeInvite(value) {
  const text = String(value || '').toUpperCase().replace(/\s|-/g, '');
  const hex = text.startsWith('DVS') ? text.slice(3) : '';
  if (!/^[0-9A-F]{12}$/.test(hex)) throw new Error('Неверный формат кода. Пример: DVS-A1B2-C3D4-E5F6');
  return `DVS-${hex.match(/.{1,4}/g).join('-')}`;
}

export function maskKey(key) {
  if (!key) return 'DV-••••-••••';
  return key.replace(/[A-Z2-9]/g, '•');
}

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'D';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', hour12: false }) +
    (sameDay ? '' : ' · ' + date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }));
}

export function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return 'Сегодня';
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}
