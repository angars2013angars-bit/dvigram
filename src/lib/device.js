/** Определение устройства и типа интерфейса. */

const DEVICE_KEY = 'dvis:device';
const DEVICE_COOKIE = 'dvis_device';
let memoryId = null;

function randomId() {
  if (globalThis.crypto?.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().slice(0, 8);
  }
  const bytes = new Uint8Array(20);
  if (globalThis.crypto?.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function valid(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(id);
}

function readCookie(name) {
  try {
    const part = document.cookie.split('; ').find((item) => item.startsWith(`${name}=`));
    if (!part) return '';
    return decodeURIComponent(part.slice(name.length + 1));
  } catch {
    return '';
  }
}

function writeCookie(name, value) {
  try {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  } catch {
    /* cookie могут быть отключены — остаётся заголовок X-Dvis-Device */
  }
}

/**
 * Один ID устройства живёт сразу в localStorage, sessionStorage и cookie.
 * Если браузер почистил часть хранилища, вход не «вылетает»: сервер видит
 * тот же ID и не придирается к устройству.
 */
export function deviceId() {
  if (memoryId && valid(memoryId)) return memoryId;

  let id = '';
  try { id = localStorage.getItem(DEVICE_KEY) || ''; } catch { /* ignore */ }
  if (!valid(id)) { try { id = sessionStorage.getItem(DEVICE_KEY) || ''; } catch { /* ignore */ } }
  if (!valid(id)) id = readCookie(DEVICE_COOKIE);
  if (!valid(id)) id = randomId();

  memoryId = id;
  try { localStorage.setItem(DEVICE_KEY, id); } catch { /* ignore */ }
  try { sessionStorage.setItem(DEVICE_KEY, id); } catch { /* ignore */ }
  if (readCookie(DEVICE_COOKIE) !== id) writeCookie(DEVICE_COOKIE, id);
  return id;
}

export function isDesktopLayout() {
  const wide = window.matchMedia('(min-width: 900px)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const mobileUA = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return wide && finePointer && !mobileUA;
}

export function deviceLabel() {
  const ua = navigator.userAgent;
  const data = navigator.userAgentData;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'Apple · мобильный Safari';
  if (/Android/i.test(ua)) return 'Android · мобильный браузер';
  if (/Mac/i.test(ua)) return 'macOS · настольный браузер';
  if (/Windows/i.test(ua)) return 'Windows · настольный браузер';
  if (/Linux/i.test(ua)) return 'Linux · настольный браузер';
  return data?.platform || 'Это устройство';
}

export function interfaceLabel() {
  return isDesktopLayout() ? 'ПК-версия' : 'Мобильная версия';
}
