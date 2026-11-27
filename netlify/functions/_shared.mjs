import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';

/**
 * Серверный слой Dvis.
 * Аккаунты по нику и паролю, приглашения и сообщения в Netlify Blobs.
 * Без Blobs (локально) используется память процесса — `netlify dev` работает без привязки сайта.
 */

const STORE_NAME = 'dvis-data';
// Долгая сессия + тихий релогин по сохранённым данным: приложение не
// выбрасывает пользователя в форму входа при каждом истечении cookie.
const SESSION_MAX_AGE = 60 * 60 * 24 * 365;
export const INVITE_TTL = 7 * 24 * 60 * 60 * 1000;

let blobsStore = null;
try {
  blobsStore = getStore({ name: STORE_NAME, consistency: 'strong' });
} catch (error) {
  console.warn('[dvis] Netlify Blobs недоступен, используется память процесса:', error.message);
}

const memory = new Map();

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function read(key, fallback = null) {
  if (blobsStore) {
    try {
      const value = await blobsStore.get(key, { type: 'json' });
      return value ?? fallback;
    } catch (error) {
      console.warn(`[dvis] fallback read ${key}:`, error.message);
    }
  }
  return memory.has(key) ? structuredClone(memory.get(key)) : fallback;
}

async function write(key, value) {
  memory.set(key, structuredClone(value));
  if (blobsStore) {
    try {
      await blobsStore.setJSON(key, value);
    } catch (error) {
      console.warn(`[dvis] fallback write ${key}:`, error.message);
    }
  }
}

async function remove(key) {
  memory.delete(key);
  if (blobsStore) {
    try {
      await blobsStore.delete(key);
    } catch (error) {
      console.warn(`[dvis] fallback delete ${key}:`, error.message);
    }
  }
}

/* ------------------------------- Утилиты --------------------------------- */

export function json(data, status = 200, headers = {}) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
    body: JSON.stringify(data),
  };
}

export function parseBody(event) {
  if (!event?.body) return {};
  try {
    const parsed = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new HttpError(400, 'Некорректный JSON');
  }
}

export function clientKey(event) {
  const forwarded = event.headers?.['x-forwarded-for'] || event.headers?.['x-nf-client-connection-ip'] || '';
  return String(forwarded).split(',')[0].trim() || event.headers?.['client-ip'] || 'local';
}

export function cleanText(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

export function pickColor(seed) {
  const palette = ['#d6d6d6', '#9a9a9a', '#f0f0f0', '#7d7d7d', '#bdbdbd', '#6f6f6f', '#e2e2e2', '#8c8c8c'];
  let n = 0;
  for (const ch of String(seed)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[n % palette.length];
}

const MIN_PASSWORD = 6;
const MAX_PASSWORD = 200;

/** Ник используется только для входа и как подпись в чате — каталога нет. */
export function normalizeNickname(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}\p{N}_ -]{3,24}$/u.test(text)) {
    throw new HttpError(400, 'Ник: 3–24 символа, буквы, цифры, пробел, дефис или подчёркивание');
  }
  return text;
}

export function validatePassword(value) {
  const text = String(value || '');
  if (text.length < MIN_PASSWORD || text.length > MAX_PASSWORD) {
    throw new HttpError(400, `Пароль: от ${MIN_PASSWORD} до ${MAX_PASSWORD} символов`);
  }
  return text;
}

export function normalizeInvite(value) {
  const text = String(value || '').toUpperCase().replace(/\s|-/g, '');
  const hex = text.startsWith('DVS') ? text.slice(3) : '';
  if (!/^[0-9A-F]{12}$/.test(hex)) throw new HttpError(400, 'Неверный формат кода приглашения');
  return `DVS-${hex.match(/.{1,4}/g).join('-')}`;
}

export function generateInviteCode() {
  return normalizeInvite(`DVS${randomBytes(6).toString('hex').toUpperCase()}`);
}

export function hashSecret(secret, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(secret, salt, 64).toString('hex') };
}

export function verifySecret(secret, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const actual = scryptSync(secret, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/* ----------------------------- Пользователи ------------------------------ */

const userKey = (id) => `users/${id}`;
const nickLookup = (nick) => `nicks/${createHash('sha256').update(nick.toLocaleLowerCase()).digest('hex')}`;
const sessionKey = (token) => `sessions/${createHash('sha256').update(token).digest('hex')}`;
const chatKey = (id) => `chats/${id}`;
const messagesKey = (id) => `messages/${id}`;
const inviteKey = (code) => `invites/${code}`;
const callKey = (chatId) => `calls/${chatId}`;
const callSignalKey = (chatId, callId, id) => `call-signals/${chatId}/${callId}/${id}`;

export function deviceHash(event) {
  // Основной канал — заголовок. Cookie-дубль нужен на случай, если прокси
  // вырезает пользовательские X-Dvis-* заголовки.
  const header = event.headers?.['x-dvis-device'] || event.headers?.['X-Dvis-Device'] || '';
  const cookie = parseCookies(event).dvis_device || '';
  const value = header || cookie;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(value))) {
    throw new HttpError(400, 'Не удалось определить устройство. Обновите страницу');
  }
  return createHash('sha256').update(String(value)).digest('hex');
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    nickname: user.nickname || user.name,
    color: user.color || '#c8c8c8',
    createdAt: user.createdAt,
    lastSeen: user.lastActive || user.createdAt,
    online: Date.now() - (user.lastActive || 0) < 60_000,
  };
}

export async function getUser(id) {
  return id ? read(userKey(id)) : null;
}

export async function saveUser(user) {
  await write(userKey(user.id), user);
}

const MAX_DEVICES = 5;

function allowedDevices(user) {
  if (Array.isArray(user?.deviceHashes)) return user.deviceHashes;
  return user?.deviceHash ? [user.deviceHash] : [];
}

async function rememberDevice(user, device) {
  const devices = allowedDevices(user);
  if (!devices.includes(device)) {
    user.deviceHashes = [...devices, device].slice(-MAX_DEVICES);
    delete user.deviceHash;
    await saveUser(user);
  }
  return user;
}

export async function createUser({ nickname, password, device }) {
  const name = normalizeNickname(nickname);
  const secret = validatePassword(password);
  const lookupKey = nickLookup(name);
  if (await read(lookupKey)) throw new HttpError(409, 'Этот ник уже занят. Выберите другой');

  const { salt, hash } = hashSecret(secret);
  const user = {
    id: `u_${randomUUID()}`,
    nickname: name,
    name,
    color: pickColor(name),
    passSalt: salt,
    passHash: hash,
    deviceHashes: [device],
    createdAt: Date.now(),
    lastActive: Date.now(),
  };
  await saveUser(user);
  await write(lookupKey, user.id);
  const ids = (await getIndex('users')) || [];
  ids.push(user.id);
  await setIndex('users', ids);
  return user;
}

export async function findUserByCredentials(nickname, password, device) {
  const name = normalizeNickname(nickname);
  const id = await read(nickLookup(name));
  if (!id) return null;
  const user = await getUser(id);
  if (!user || !verifySecret(String(password || ''), user.passSalt, user.passHash)) return null;
  return rememberDevice(user, device);
}

/**
 * Смена пароля без старого — только на устройстве, где уже был успешный вход.
 * Это спасает, когда пользователь забыл пароль или данные сессии сломались,
 * но не даёт злоумышленнику забрать аккаунт, зная только ник.
 */
export async function recoverPassword(nickname, password, device) {
  const name = normalizeNickname(nickname);
  const id = await read(nickLookup(name));
  if (!id) throw new HttpError(404, 'Ник не найден. Проверьте написание');
  const user = await getUser(id);
  if (!user) throw new HttpError(404, 'Ник не найден');
  if (!allowedDevices(user).includes(device)) {
    throw new HttpError(403, 'Пароль можно сменить только на устройстве, где уже был вход');
  }
  const secret = validatePassword(password);
  const { salt, hash } = hashSecret(secret);
  user.passSalt = salt;
  user.passHash = hash;
  await saveUser(user);
  return user;
}

export async function touchUser(user) {
  if (!user) return user;
  if (Date.now() - (user.lastActive || 0) >= 30_000) {
    user.lastActive = Date.now();
    await saveUser(user);
  }
  return user;
}

/* -------------------------------- Сессии --------------------------------- */

export function parseCookies(event) {
  const raw = event.headers?.cookie || event.headers?.Cookie || '';
  return raw.split(';').reduce((acc, part) => {
    const [name, ...rest] = part.trim().split('=');
    if (!name) return acc;
    try {
      acc[name] = decodeURIComponent(rest.join('='));
    } catch {
      acc[name] = rest.join('=');
    }
    return acc;
  }, {});
}

export function sessionCookie(token) {
  const secure = process.env.NETLIFY === 'true' && String(process.env.URL || '').startsWith('https://');
  return [
    `dvis_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export const emptyCookie = 'dvis_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';

export async function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  await write(sessionKey(token), { userId, expiresAt: Date.now() + SESSION_MAX_AGE * 1000 });
  return token;
}

export async function userFromEvent(event) {
  const token = parseCookies(event).dvis_session;
  if (!token) return null;
  const session = await read(sessionKey(token));
  if (!session || session.expiresAt < Date.now()) return null;
  return getUser(session.userId);
}

export async function requireUser(event) {
  const user = await userFromEvent(event);
  if (!user) throw new HttpError(401, 'Нужно войти в аккаунт');
  // Сессионная cookie — уже подтверждённый вход. Дополнительная проверка
  // deviceHash здесь выкидывала пользователя при смене ID устройства.
  await touchUser(user);
  return user;
}

export async function destroySession(event) {
  const token = parseCookies(event).dvis_session;
  if (token) await remove(sessionKey(token));
}

/* ---------------------------- Защита от перебора -------------------------- */

export async function checkRateLimit(key, max = 8, windowMs = 15 * 60_000) {
  const now = Date.now();
  const rec = (await read(`ratelimit/${key}`)) || { count: 0, resetAt: now + windowMs };
  if (rec.resetAt < now) {
    rec.count = 0;
    rec.resetAt = now + windowMs;
  }
  if (rec.count >= max) throw new HttpError(429, 'Слишком много попыток. Попробуйте позже');
  rec.count += 1;
  await write(`ratelimit/${key}`, rec);
}

export async function clearRateLimit(key) {
  await remove(`ratelimit/${key}`);
}

/* ---------------------------------- Чаты ---------------------------------- */

export async function getIndex(name) {
  return (await read(`indexes/${name}`, [])) || [];
}

export async function setIndex(name, value) {
  await write(`indexes/${name}`, value);
}

export function newChat({ name = '', participantIds, createdBy }) {
  const unread = {};
  participantIds.forEach((id) => { unread[id] = 0; });
  return {
    id: `c_${randomUUID()}`,
    name: cleanText(name, 60),
    participantIds,
    createdBy,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    unread,
  };
}

export async function getChat(id) {
  return id ? read(chatKey(id)) : null;
}

export async function saveChat(chat) {
  await write(chatKey(chat.id), chat);
}

export async function getMessages(chatId) {
  return (await read(messagesKey(chatId))) || [];
}

export async function saveMessages(chatId, messages) {
  await write(messagesKey(chatId), messages.slice(-1000));
}

export function assertParticipant(chat, userId) {
  if (!chat || !chat.participantIds.includes(userId)) throw new HttpError(403, 'Нет доступа к этому чату');
}

export function makeMessageId() {
  return `m_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

export function systemMessage(chatId, text) {
  return {
    id: makeMessageId(),
    chatId,
    senderId: 'system',
    kind: 'system',
    text,
    replyTo: null,
    createdAt: Date.now(),
    editedAt: null,
    readBy: [],
    reactions: {},
    deleted: false,
  };
}

export async function pushMessage(chat, message) {
  const messages = await getMessages(chat.id);
  messages.push(message);
  await saveMessages(chat.id, messages);
  chat.updatedAt = message.createdAt;
  chat.unread = chat.unread || {};
  chat.participantIds.forEach((id) => {
    if (id !== message.senderId) chat.unread[id] = (chat.unread[id] || 0) + 1;
  });
  await saveChat(chat);
  return message;
}

export async function chatView(chat, viewerId, messages = null) {
  const list = messages || (await getMessages(chat.id));
  const participants = await Promise.all(chat.participantIds.map((id) => getUser(id)));
  const people = participants.filter(Boolean).map(publicUser);
  const other = people.find((person) => person.id !== viewerId);
  const last = [...list].reverse().find((message) => !message.deleted || message.kind === 'system') || list[list.length - 1] || null;
  return {
    id: chat.id,
    name: chat.name || (other ? other.name : 'Новый чат'),
    type: people.length === 2 ? 'direct' : 'group',
    participants: people,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    unread: chat.unread?.[viewerId] || 0,
    lastMessage: last
      ? {
          id: last.id,
          text: last.deleted ? 'Сообщение удалено' : last.text,
          kind: last.kind,
          senderId: last.senderId,
          senderName: last.senderId === viewerId ? 'Вы' : last.senderId === 'system' ? 'Dvis' : other?.name || 'Аноним',
          createdAt: last.createdAt,
        }
      : null,
  };
}

export async function decoratedMessages(messages) {
  const ids = [...new Set(messages.map((message) => message.senderId).filter((id) => id && id !== 'system'))];
  const users = await Promise.all(ids.map(async (id) => [id, await getUser(id)]));
  const map = Object.fromEntries(users);
  return messages.map((message) => {
    const sender = map[message.senderId];
    return {
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      senderName: message.senderId === 'system' ? 'Dvis' : sender?.name || 'Аноним',
      senderColor: message.senderId === 'system' ? '#c8c8c8' : sender?.color || '#c8c8c8',
      kind: message.kind || 'text',
      text: message.deleted ? '' : message.text,
      replyTo: message.replyTo || null,
      createdAt: message.createdAt,
      editedAt: message.editedAt || null,
      readBy: message.readBy || [],
      reactions: message.reactions || {},
      deleted: Boolean(message.deleted),
    };
  });
}

/* ------------------------------- Приглашения ------------------------------ */

export function inviteView(invite) {
  return {
    code: invite.code,
    chatId: invite.chatId,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    maxUses: invite.maxUses,
    uses: invite.uses || 0,
    revoked: Boolean(invite.revoked),
    active: !invite.revoked && invite.expiresAt > Date.now() && (invite.uses || 0) < invite.maxUses,
  };
}

export async function getInvite(code) {
  return read(inviteKey(code));
}

export async function saveInvite(invite) {
  await write(inviteKey(invite.code), invite);
}

/* --------------------------------- Звонки --------------------------------- */

export function callView(call, ice = []) {
  if (!call) return null;
  return {
    id: call.id,
    chatId: call.chatId,
    initiatorId: call.initiatorId,
    status: call.status,
    createdAt: call.createdAt,
    offer: call.offer || null,
    answer: call.answer || null,
    ice,
    activeAt: call.activeAt || null,
    endedAt: call.endedAt || null,
  };
}

export async function getCall(chatId) {
  return chatId ? read(callKey(chatId)) : null;
}

export async function saveCall(call) {
  await write(callKey(call.chatId), call);
}

export function newCall({ chatId, initiatorId }) {
  return {
    id: `call_${randomUUID()}`,
    chatId,
    initiatorId,
    createdAt: Date.now(),
    status: 'ringing',
    offer: null,
    answer: null,
    activeAt: null,
    endedAt: null,
  };
}

/* ICE-кандидаты пишутся отдельными ключами: параллельные сигналы от двух
   участников не перетирают друг друга при read-modify-write общего call. */
export async function addCallIce(call, from, candidate) {
  if (!call?.id) return;
  await write(callSignalKey(call.chatId, call.id, `${Date.now()}-${randomUUID()}`), {
    from,
    candidate,
    createdAt: Date.now(),
  });
}

export async function listCallIce(call) {
  if (!call?.id) return [];
  const prefix = `call-signals/${call.chatId}/${call.id}/`;
  let keys = [];
  if (blobsStore) {
    try {
      const page = await blobsStore.list({ prefix, limit: 1000 });
      keys = page.blobs.map((item) => item.key);
    } catch (error) {
      console.warn('[dvis] fallback list ICE:', error.message);
    }
  }
  if (!keys.length) keys = [...memory.keys()].filter((key) => key.startsWith(prefix));
  const items = (await Promise.all(keys.map((key) => read(key)))).filter(Boolean);
  return items.sort((a, b) => a.createdAt - b.createdAt).slice(-80);
}

export async function deleteCallIce(call) {
  if (!call?.id) return;
  const prefix = `call-signals/${call.chatId}/${call.id}/`;
  const keys = [...memory.keys()].filter((key) => key.startsWith(prefix));
  if (blobsStore) {
    try {
      const page = await blobsStore.list({ prefix, limit: 1000 });
      page.blobs.forEach((item) => { if (!keys.includes(item.key)) keys.push(item.key); });
    } catch {
      /* память всё равно почистили */
    }
  }
  await Promise.all(keys.map((key) => remove(key)));
}
