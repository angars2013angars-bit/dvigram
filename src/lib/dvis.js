/** Общие хелперы Dvis: коды приглашений и форматтеры. */

export const REACTIONS = ['👍', '❤️', '😂', '🔥', '😮', '😢'];

const CRED_STORAGE = 'dvis:credentials';
const CRED_COOKIE = 'dvis_credentials';

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
    /* без cookie данные остаются в хранилищах браузера */
  }
}

/**
 * Ник и пароль хранятся только в этом браузере, чтобы приложение могло тихо
 * восстановить сессию без экрана входа. Три копии защищают от частичной очистки.
 */
function validCredentials(value) {
  return Boolean(value && typeof value.nickname === 'string' && typeof value.password === 'string'
    && value.nickname.length >= 3 && value.password.length >= 6);
}

export function getSavedCredentials() {
  const sources = [];
  try { sources.push(localStorage.getItem(CRED_STORAGE)); } catch { /* ignore */ }
  try { sources.push(sessionStorage.getItem(CRED_STORAGE)); } catch { /* ignore */ }
  sources.push(readCookie(CRED_COOKIE));
  for (const raw of sources) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (validCredentials(parsed)) return parsed;
    } catch { /* ignore */ }
  }
  return null;
}

export function saveCredentials(credentials) {
  if (!validCredentials(credentials)) return;
  const raw = JSON.stringify({ nickname: credentials.nickname, password: credentials.password });
  try { localStorage.setItem(CRED_STORAGE, raw); } catch { /* ignore */ }
  try { sessionStorage.setItem(CRED_STORAGE, raw); } catch { /* ignore */ }
  if (readCookie(CRED_COOKIE) !== raw) writeCookie(CRED_COOKIE, raw, 60 * 60 * 24 * 90);
}

export function clearSavedCredentials() {
  try { localStorage.removeItem(CRED_STORAGE); } catch { /* ignore */ }
  try { sessionStorage.removeItem(CRED_STORAGE); } catch { /* ignore */ }
  try { document.cookie = `${CRED_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`; } catch { /* ignore */ }
}

function randomHex(bytes) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
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

/** Быстрая проверка на клиенте; сервер проверяет те же правила. */
export function validateNickname(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}\p{N}_ -]{3,24}$/u.test(text)) {
    throw new Error('Ник: 3–24 символа, буквы, цифры, пробел, дефис или подчёркивание');
  }
  return text;
}

export function validatePassword(value, confirm) {
  const text = String(value || '');
  if (text.length < 6 || text.length > 200) throw new Error('Пароль: от 6 до 200 символов');
  if (confirm !== undefined && text !== String(confirm || '')) throw new Error('Пароли не совпадают');
  return text;
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
