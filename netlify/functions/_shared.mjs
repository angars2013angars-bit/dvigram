import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';

/**
 * Общий слой серверной части DviGram.
 * Данные хранятся в Netlify Blobs. Если локально нет контекста Blobs,
 * используется in-memory Map — чтобы `netlify dev` работал без привязки сайта.
 */

const STORE_NAME = 'dvigram-data';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 дней

// Лимиты медиа: Netlify Functions принимает запросы до ~6 МБ.
export const MEDIA_LIMITS = {
  avatarBytes: 320 * 1024,
  musicBytes: 2.5 * 1024 * 1024,
};

export const GENERAL_CHAT_NAME = 'Общий - DviGram';
export const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || '82Idomih)';

export const SHOP_ITEMS = {
  premium: { id: 'premium', name: 'DviGram Premium', price: 700, emoji: '💎', description: 'Значок 💎, приоритет и кастомные цвета' },
  moderator: { id: 'moderator', name: 'Права модератора', price: 1800, emoji: '🛡️', description: 'Права модератора в чатах и каналах' },
};

export const GIFT_CATALOG = [
  { id: 'rose', name: 'Небесная роза', emoji: '🌹', rarity: 'Обычный', price: 50, color: '#ef4444' },
  { id: 'rocket', name: 'Ракета DviGram', emoji: '🚀', rarity: 'Редкий', price: 150, color: '#0b7cff' },
  { id: 'crown', name: 'Корона создателя', emoji: '👑', rarity: 'Легендарный', price: 500, color: '#f59e0b' },
  { id: 'diamond', name: 'Алмазный NFT', emoji: '💎', rarity: 'Мифический', price: 900, color: '#06b6d4' },
];

let blobsStore = null;
try {
  blobsStore = getStore({ name: STORE_NAME, consistency: 'strong' });
} catch (error) {
  console.warn('[dvigram] Netlify Blobs недоступен, используется память процесса:', error.message);
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
      console.warn(`[dvigram] fallback read ${key}:`, error.message);
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
      console.warn(`[dvigram] fallback write ${key}:`, error.message);
    }
  }
}

async function remove(key) {
  memory.delete(key);
  if (blobsStore) {
    try {
      await blobsStore.delete(key);
    } catch (error) {
      console.warn(`[dvigram] fallback delete ${key}:`, error.message);
    }
  }
}

/* --------------------------------- Медиа ----------------------------------- */

const mediaKey = (userId, kind) => `media/${userId}/${kind}`;

function dataUrlBytes(value) {
  const base64 = String(value).split(',')[1] || '';
  return Math.floor((base64.length * 3) / 4);
}

export function validateImageDataUrl(value, maxBytes = MEDIA_LIMITS.avatarBytes) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(value || ''));
  if (!match) throw new HttpError(400, 'Поддерживаются PNG, JPEG, WebP и GIF');
  if (dataUrlBytes(match[2]) > maxBytes) throw new HttpError(400, 'Аватарка слишком большая. Максимум 320 КБ');
  return value;
}

export function validateAudioDataUrl(value, maxBytes = MEDIA_LIMITS.musicBytes) {
  const match = /^data:(audio\/(?:mpeg|mp4|wav|webm|ogg|x-wav|x-m4a|aac));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(value || ''));
  if (!match) throw new HttpError(400, 'Поддерживаются MP3, M4A, WAV, OGG и WebM');
  if (dataUrlBytes(match[2]) > maxBytes) throw new HttpError(400, 'Музыка слишком большая. Максимум 2.5 МБ');
  return { dataUrl: value, type: match[1] };
}

export async function saveMedia(userId, kind, payload) {
  await write(mediaKey(userId, kind), { ...payload, updatedAt: Date.now() });
}

export async function getMedia(userId, kind) {
  return read(mediaKey(userId, kind));
}

export async function removeMedia(userId, kind) {
  await remove(mediaKey(userId, kind));
}

/* ----------------------------- Пароли и токены ---------------------------- */

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHash) {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function makeMessageId() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* --------------------------------- Пользователи ------------------------------- */

const loginKey = (login) => `logins/${encodeURIComponent(login.trim().toLowerCase())}`;
const userKey = (id) => `users/${id}`;
const sessionKey = (token) => `sessions/${tokenHash(token)}`;
const chatKey = (id) => `chats/${id}`;
const messagesKey = (id) => `messages/${id}`;

export function defaultCustomization() {
  return {
    accent: '#0b7cff',
    nameColor: '',
    fontScale: 1,
    bubbleStyle: 'classic',
    pattern: 'dots',
  };
}

export function publicUser(user) {
  if (!user) return null;
  const now = Date.now();
  return {
    id: user.id,
    name: user.name,
    login: user.login,
    bio: user.bio || '',
    status: cleanText(user.status, 80),
    avatar: user.avatar || { color: '#0b7cff', emoji: '' },
    music: user.music
      ? {
          name: cleanText(user.music.name, 120),
          type: cleanText(user.music.type, 60),
          size: Math.max(0, Number(user.music.size) || 0),
          createdAt: user.music.createdAt || 0,
          hasMusic: true,
        }
      : null,
    dailyClaimDate: user.dailyClaimDate || '',
    streak: Math.max(0, Number(user.streak) || 0),
    createdAt: user.createdAt,
    lastSeen: user.lastActive || user.createdAt,
    online: now - (user.lastActive || 0) < 60_000,
    role: user.role || 'user',
    premium: Boolean(user.premium),
    premiumUntil: user.premiumUntil || 0,
    prefix: user.prefix || '',
    badges: (user.badges || []).slice(0, 8),
    verified: Boolean(user.verified),
    balance: Math.max(0, Number(user.balance) || 0),
    mutedUntil: user.mutedUntil || 0,
    bannedUntil: user.bannedUntil || 0,
    warnings: (user.warnings || []).slice(-5),
    gifts: (user.gifts || []).slice(-12).reverse(),
    giftCount: (user.gifts || []).length,
    customization: { ...defaultCustomization(), ...(user.customization || {}) },
  };
}

export async function findUserByLogin(login) {
  const id = await read(loginKey(login));
  return id ? read(userKey(id)) : null;
}

export async function getUser(id) {
  return id ? read(userKey(id)) : null;
}

export async function saveUser(user) {
  await write(userKey(user.id), user);
}

export async function listUsers() {
  const ids = (await read('indexes/users', [])) || [];
  const users = await Promise.all(ids.map((id) => read(userKey(id))));
  return users.filter(Boolean);
}

function baseUser({ name, login, password, role = 'user', extra = {} }) {
  const { salt, hash } = hashPassword(password);
  return {
    id: `u_${randomUUID()}`,
    name,
    login: login.trim().toLowerCase(),
    salt,
    passwordHash: hash,
    bio: '',
    status: '',
    avatar: { color: pickColor(login), emoji: '' },
    music: null,
    dailyClaimDate: '',
    streak: 0,
    createdAt: Date.now(),
    lastActive: Date.now(),
    role,
    premium: false,
    premiumUntil: 0,
    prefix: '',
    badges: [],
    verified: false,
    balance: 1000,
    mutedUntil: 0,
    bannedUntil: 0,
    warnings: [],
    gifts: [],
    customization: defaultCustomization(),
    ...extra,
  };
}

export async function createUser({ name, login, password }) {
  const existing = await findUserByLogin(login);
  if (existing) throw new HttpError(409, 'Этот логин уже занят');

  const user = baseUser({ name, login, password });
  await saveUser(user);
  await write(loginKey(user.login), user.id);
  const ids = (await read('indexes/users', [])) || [];
  ids.push(user.id);
  await write('indexes/users', ids);
  await ensureGeneralChat(user.id);
  return user;
}

export async function ensureSeedAccounts() {
  const seeds = [
    {
      login: 'admin',
      name: 'Администратор DviGram',
      role: 'admin',
      extra: {
        verified: true,
        premium: true,
        balance: 99999,
        prefix: 'ADMIN',
        badges: ['⭐', '🛡️'],
        avatar: { color: '#ef4444', emoji: '🛡️' },
        bio: 'Официальный администратор DviGram',
      },
    },
    {
      login: 'dvinsky',
      name: 'dvinsky',
      role: 'owner',
      extra: {
        verified: true,
        premium: true,
        balance: 99999,
        prefix: 'OWNER',
        badges: ['👑', '💎'],
        avatar: { color: '#8b5cf6', emoji: '👑' },
        bio: 'Создатель DviGram. Сюда приходят уведомления о покупках.',
      },
    },
  ];

  const created = [];
  for (const seed of seeds) {
    const existing = await findUserByLogin(seed.login);
    if (!existing) {
      const user = baseUser({
        name: seed.name,
        login: seed.login,
        password: SEED_ADMIN_PASSWORD,
        role: seed.role,
        extra: seed.extra,
      });
      await saveUser(user);
      await write(loginKey(user.login), user.id);
      const ids = (await read('indexes/users', [])) || [];
      ids.push(user.id);
      await write('indexes/users', ids);
      await ensureGeneralChat(user.id);
      created.push(user);
    }
  }
  return created;
}

export async function getIndex(name) {
  return (await read(`indexes/${name}`, [])) || [];
}

export async function setIndex(name, value) {
  await write(`indexes/${name}`, value);
}

export function pickColor(seed) {
  const palette = ['#0b7cff', '#8b5cf6', '#f97316', '#10b981', '#ef4444', '#06b6d4', '#ec4899', '#f59e0b'];
  let n = 0;
  for (const ch of String(seed)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[n % palette.length];
}

/* ---------------------------------- Сессии ---------------------------------- */

export function parseCookies(event) {
  const raw = event.headers?.cookie || event.headers?.Cookie || '';
  return raw.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (key) acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

export function getSessionToken(event) {
  return parseCookies(event).dvigram_session || null;
}

export async function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  await write(sessionKey(token), { userId, expiresAt: Date.now() + SESSION_MAX_AGE * 1000 });
  return token;
}

export function sessionCookie(token) {
  const isHttps = process.env.NETLIFY === 'true' && String(process.env.URL || '').startsWith('https://');
  const secure = isHttps ? 'Secure; ' : '';
  return `dvigram_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}; ${secure}`;
}

export const emptyCookie = 'dvigram_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';

export async function userFromEvent(event) {
  const token = getSessionToken(event);
  if (!token) return null;
  const session = await read(sessionKey(token));
  if (!session || session.expiresAt < Date.now()) return null;
  return getUser(session.userId);
}

export function isBanned(user) {
  return Boolean(user && user.bannedUntil && user.bannedUntil > Date.now());
}

export function isMuted(user) {
  return Boolean(user && user.mutedUntil && user.mutedUntil > Date.now());
}

export function isAdmin(user) {
  return user?.role === 'admin' || user?.role === 'owner';
}

export function isModerator(user) {
  return isAdmin(user) || user?.role === 'moderator';
}

export async function requireUser(event) {
  const user = await userFromEvent(event);
  if (!user) throw new HttpError(401, 'Нужно войти в аккаунт');
  if (isBanned(user)) throw new HttpError(403, 'Аккаунт заблокирован администрацией DviGram');
  return user;
}

export async function requireAdmin(event) {
  const user = await requireUser(event);
  if (!isAdmin(user)) throw new HttpError(403, 'Доступно только администраторам');
  return user;
}

export async function destroySession(event) {
  const token = getSessionToken(event);
  if (token) await remove(sessionKey(token));
}

export async function touchUser(user) {
  if (!user) return user;
  let changed = false;
  if (user.premium && user.premiumUntil && user.premiumUntil < Date.now()) {
    user.premium = false;
    user.premiumUntil = 0;
    user.badges = (user.badges || []).filter((badge) => badge !== '💎');
    changed = true;
  }
  if (Date.now() - (user.lastActive || 0) >= 30_000) {
    user.lastActive = Date.now();
    changed = true;
  }
  if (changed) await saveUser(user);
  return user;
}

/* ----------------------------- Защита от перебора ---------------------------- */

export async function checkRateLimit(key, max = 6, windowMs = 15 * 60_000) {
  const now = Date.now();
  const rec = (await read(`ratelimit/${key}`)) || { count: 0, resetAt: now + windowMs };
  if (rec.resetAt < now) {
    rec.count = 0;
    rec.resetAt = now + windowMs;
  }
  if (rec.count >= max) {
    throw new HttpError(429, 'Слишком много попыток. Попробуйте позже');
  }
  rec.count += 1;
  await write(`ratelimit/${key}`, rec);
}

export async function clearRateLimit(key) {
  await remove(`ratelimit/${key}`);
}

/* ---------------------------------- Чаты ------------------------------------ */

export function newChat({ type, name, participantIds, createdBy, avatar, description = '' }) {
  const unread = {};
  participantIds.forEach((id) => { unread[id] = 0; });
  return {
    id: `c_${randomUUID()}`,
    type,
    name: name || '',
    description,
    avatar: avatar || { color: pickColor(name || participantIds.join()), emoji: type === 'channel' ? '📢' : '' },
    participantIds,
    createdBy,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinnedBy: {},
    mutedBy: {},
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

export async function assertParticipant(chat, userId) {
  if (!chat || !chat.participantIds.includes(userId)) {
    throw new HttpError(403, 'Нет доступа к этому чату');
  }
}

export function systemMessage(text, chatId) {
  return {
    id: makeMessageId(),
    chatId,
    senderId: 'system',
    text,
    kind: 'system',
    attachment: null,
    gift: null,
    replyTo: null,
    createdAt: Date.now(),
    editedAt: null,
    readBy: [],
    reactions: {},
  };
}

export async function pushMessage(chat, message) {
  const messages = await getMessages(chat.id);
  messages.push(message);
  await saveMessages(chat.id, messages);
  chat.updatedAt = message.createdAt;
  chat.unread = chat.unread || {};
  chat.participantIds.forEach((id) => {
    if (id !== message.senderId && id !== 'system') chat.unread[id] = (chat.unread[id] || 0) + 1;
  });
  await saveChat(chat);
  return message;
}

export async function ensureGeneralChat(userId) {
  let id = await read('indexes/general');
  const users = await listUsers();

  if (!id) {
    const chat = newChat({
      type: 'channel',
      name: GENERAL_CHAT_NAME,
      description: 'Общий канал для всех пользователей DviGram',
      participantIds: users.map((user) => user.id),
      createdBy: 'system',
      avatar: { color: '#0b7cff', emoji: '💬' },
    });
    await saveChat(chat);
    const ids = await getIndex('chats');
    ids.push(chat.id);
    await setIndex('chats', ids);
    await write('indexes/general', chat.id);
    await saveMessages(chat.id, [systemMessage('Добро пожаловать в общий канал DviGram! 👋', chat.id)]);
    return chat;
  }

  const chat = await getChat(id);
  if (chat && !chat.participantIds.includes(userId)) {
    chat.participantIds.push(userId);
    chat.unread = chat.unread || {};
    chat.unread[userId] = 0;
    await saveChat(chat);
  }
  return chat;
}

export async function findOrCreateDirectChat(firstId, secondId) {
  const ids = await getIndex('chats');
  for (const id of ids) {
    const chat = await getChat(id);
    if (
      chat &&
      chat.type === 'direct' &&
      chat.participantIds.length === 2 &&
      chat.participantIds.includes(firstId) &&
      chat.participantIds.includes(secondId)
    ) {
      return chat;
    }
  }
  const chat = newChat({ type: 'direct', participantIds: [firstId, secondId], createdBy: firstId });
  await saveChat(chat);
  ids.push(chat.id);
  await setIndex('chats', ids);
  return chat;
}

export async function notifyDvinsky(sender, text) {
  const dv = await findUserByLogin('dvinsky');
  if (!dv || dv.id === sender.id) return null;
  const chat = await findOrCreateDirectChat(sender.id, dv.id);
  const message = {
    id: makeMessageId(),
    chatId: chat.id,
    senderId: sender.id,
    text,
    kind: 'text',
    attachment: null,
    gift: null,
    replyTo: null,
    createdAt: Date.now(),
    editedAt: null,
    readBy: [sender.id],
    reactions: {},
  };
  return pushMessage(chat, message);
}

export async function chatView(chat, viewerId, usersMap) {
  const messages = await getMessages(chat.id);
  const last = messages[messages.length - 1] || null;
  const otherId = chat.type === 'direct' ? chat.participantIds.find((id) => id !== viewerId) : null;
  const other = otherId ? usersMap[otherId] || (await getUser(otherId)) : null;
  const name = chat.type === 'direct' ? other?.name || 'Удалённый пользователь' : chat.name;
  const sender = last ? usersMap[last.senderId] || (await getUser(last.senderId)) : null;
  const lastText = last
    ? last.kind === 'file' ? `📎 ${last.attachment?.name || 'Файл'}`
      : last.kind === 'gift' ? `🎁 ${last.gift?.name || 'NFT-подарок'}`
        : last.text
    : '';

  return {
    id: chat.id,
    type: chat.type,
    name,
    description: chat.description || '',
    avatar: chat.type === 'direct' ? other?.avatar || chat.avatar : chat.avatar,
    participantIds: chat.participantIds,
    participants: chat.participantIds.map((id) => publicUser(usersMap[id] || null)).filter(Boolean),
    other: other ? publicUser(other) : null,
    otherId,
    online: chat.type === 'direct' ? Boolean(other && Date.now() - (other.lastActive || 0) < 60_000) : false,
    lastMessage: last
      ? {
          id: last.id,
          text: lastText,
          senderId: last.senderId,
          senderName: sender?.name || '',
          createdAt: last.createdAt,
        }
      : null,
    unread: chat.unread?.[viewerId] || 0,
    pinned: Boolean(chat.pinnedBy?.[viewerId]),
    muted: Boolean(chat.mutedBy?.[viewerId]),
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };
}

/* --------------------------------- Утилиты ---------------------------------- */

export function cleanText(value, max = 4000) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

export function json(body, status = 200, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

export function parseBody(event) {
  if (!event.body) return {};
  try {
    return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch {
    throw new HttpError(400, 'Некорректный JSON');
  }
}

export function clientKey(event) {
  return String(event.headers?.['x-forwarded-for'] || event.headers?.['client-ip'] || 'local')
    .split(',')[0]
    .trim();
}
