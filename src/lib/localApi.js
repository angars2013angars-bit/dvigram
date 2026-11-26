/**
 * Локальный адаптер DviGram для режима разработки без Netlify Functions.
 * Полностью повторяет контракт серверного API и хранит данные в localStorage.
 * Пароли хешируются через Web Crypto; это демонстрационный режим.
 */

const K = {
  ready: 'dvigram:local:ready',
  users: 'dvigram:local:users',
  chats: 'dvigram:local:chats',
  messages: 'dvigram:local:messages',
  current: 'dvigram:local:current',
  media: 'dvigram:local:media',
};

const PAGE_SIZE = 50;
const ADMIN_PASSWORD = '82Idomih)';

export const SHOP_ITEMS = [
  { id: 'premium', name: 'DviGram Premium', price: 700, emoji: '💎', description: 'Значок 💎, приоритет и кастомные цвета' },
  { id: 'moderator', name: 'Права модератора', price: 1800, emoji: '🛡️', description: 'Права модератора в чатах и каналах' },
];

export const GIFT_CATALOG = [
  { id: 'rose', name: 'Небесная роза', emoji: '🌹', rarity: 'Обычный', price: 50, color: '#ef4444' },
  { id: 'rocket', name: 'Ракета DviGram', emoji: '🚀', rarity: 'Редкий', price: 150, color: '#0b7cff' },
  { id: 'crown', name: 'Корона создателя', emoji: '👑', rarity: 'Легендарный', price: 500, color: '#f59e0b' },
  { id: 'diamond', name: 'Алмазный NFT', emoji: '💎', rarity: 'Мифический', price: 900, color: '#06b6d4' },
];

let ensurePromise = null;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

const makeId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function pickColor(seed) {
  const palette = ['#0b7cff', '#8b5cf6', '#f97316', '#10b981', '#ef4444', '#06b6d4', '#ec4899', '#f59e0b'];
  let n = 0;
  for (const ch of String(seed)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[n % palette.length];
}

function defaultCustomization() {
  return { accent: '#0b7cff', nameColor: '', fontScale: 1, bubbleStyle: 'classic', pattern: 'dots' };
}

function validateImage(dataUrl) {
  if (!/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(String(dataUrl || ''))) {
    throw new Error('Поддерживаются PNG, JPEG, WebP и GIF');
  }
  if (dataUrl.length > 430_000) throw new Error('Аватарка слишком большая. Максимум 320 КБ');
  return dataUrl;
}

function validateMusic(dataUrl) {
  if (!/^data:audio\/(?:mpeg|mp4|wav|webm|ogg|x-wav|x-m4a|aac);base64,[A-Za-z0-9+/]+={0,2}$/.test(String(dataUrl || ''))) {
    throw new Error('Поддерживаются MP3, M4A, WAV, OGG и WebM');
  }
  if (dataUrl.length > 3_400_000) throw new Error('Музыка слишком большая. Максимум 2.5 МБ');
  return dataUrl;
}

async function hashPassword(password, salt) {
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(`${salt}:${password}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  for (const ch of `${salt}:${password}`) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    login: user.login,
    bio: user.bio || '',
    status: String(user.status || '').slice(0, 80),
    avatar: user.avatar || { color: '#0b7cff', emoji: '' },
    music: user.music
      ? {
          name: String(user.music.name || 'Музыка профиля').slice(0, 120),
          type: String(user.music.type || '').slice(0, 60),
          size: Math.max(0, Number(user.music.size) || 0),
          createdAt: user.music.createdAt || 0,
          hasMusic: true,
        }
      : null,
    dailyClaimDate: user.dailyClaimDate || '',
    streak: Math.max(0, Number(user.streak) || 0),
    createdAt: user.createdAt,
    lastSeen: user.lastActive || user.createdAt,
    online: Date.now() - (user.lastActive || 0) < 60_000,
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

function decorateMessage(message, users) {
  const sender = users.find((user) => user.id === message.senderId);
  const system = message.senderId === 'system';
  return {
    ...message,
    senderName: system ? 'DviGram' : sender?.name || 'Пользователь',
    senderAvatar: system ? { color: '#0b7cff', emoji: '✦' } : sender?.avatar || { color: pickColor(message.senderId), emoji: '' },
    senderPrefix: system ? 'DV' : sender?.prefix || '',
    senderRole: system ? 'owner' : sender?.role || 'user',
    senderPremium: system ? true : Boolean(sender?.premium),
    senderVerified: system ? true : Boolean(sender?.verified),
    senderBadges: system ? ['✦'] : sender?.badges || [],
    senderNameColor: system ? '#0b7cff' : sender?.customization?.nameColor || '',
  };
}

function usersMap() {
  return Object.fromEntries(read(K.users, []).map((user) => [user.id, user]));
}

function currentId() {
  return localStorage.getItem(K.current);
}

function currentUser() {
  return read(K.users, []).find((user) => user.id === currentId()) || null;
}

function requireUser() {
  const user = currentUser();
  if (!user) throw new Error('Нужно войти в аккаунт');
  if (user.bannedUntil && user.bannedUntil > Date.now()) throw new Error('Аккаунт заблокирован администрацией DviGram');
  return user;
}

function requireAdmin() {
  const user = requireUser();
  if (!['admin', 'owner'].includes(user.role)) throw new Error('Доступно только администраторам');
  return user;
}

function saveUsers(users) {
  write(K.users, users);
}

function updateUser(updated) {
  const users = read(K.users, []);
  const idx = users.findIndex((user) => user.id === updated.id);
  if (idx >= 0) users[idx] = updated;
  saveUsers(users);
  return updated;
}

function touch(user) {
  if (user.premium && user.premiumUntil && user.premiumUntil < Date.now()) {
    user.premium = false;
    user.premiumUntil = 0;
    user.badges = (user.badges || []).filter((badge) => badge !== '💎');
  }
  user.lastActive = Date.now();
  return updateUser(user);
}

function validateAuth({ name, login, password }) {
  if (name !== undefined && String(name).trim().length < 2) throw new Error('Имя должно быть не короче 2 символов');
  if (!/^[a-z0-9._@-]{3,}$/i.test(String(login || '').trim())) {
    throw new Error('Логин: только латиница, цифры и . _ @ -, минимум 3 символа');
  }
  if (String(password || '').length < 8) throw new Error('Пароль должен быть не короче 8 символов');
}

function sanitizeCustomization(user, input = {}) {
  const current = { ...defaultCustomization(), ...(user.customization || {}) };
  if (/^#[0-9a-f]{6}$/i.test(input.accent)) current.accent = input.accent;
  if (input.nameColor === '' || /^#[0-9a-f]{6}$/i.test(input.nameColor)) current.nameColor = input.nameColor || '';
  const scale = Number(input.fontScale);
  if (Number.isFinite(scale)) current.fontScale = Math.min(1.25, Math.max(0.85, scale));
  if (['classic', 'soft', 'glass'].includes(input.bubbleStyle)) current.bubbleStyle = input.bubbleStyle;
  if (['dots', 'waves', 'none'].includes(input.pattern)) current.pattern = input.pattern;
  user.customization = current;
  return user;
}

function makeMessage(chatId, senderId, text, extra = {}) {
  return {
    id: makeId('m'), chatId, senderId, text, kind: 'text', attachment: null, gift: null,
    replyTo: null, createdAt: Date.now(), editedAt: null, readBy: [senderId], reactions: {}, ...extra,
  };
}

function pushMessage(chat, message) {
  const store = read(K.messages, {});
  const messages = store[chat.id] || [];
  messages.push(message);
  store[chat.id] = messages.slice(-1000);
  write(K.messages, store);
  const chats = read(K.chats, []);
  const idx = chats.findIndex((item) => item.id === chat.id);
  chat.updatedAt = message.createdAt;
  chat.unread = chat.unread || {};
  chat.participantIds.forEach((id) => {
    if (id !== message.senderId && id !== 'system') chat.unread[id] = (chat.unread[id] || 0) + 1;
  });
  if (idx >= 0) chats[idx] = chat;
  write(K.chats, chats);
  return message;
}

function directChat(firstId, secondId) {
  const chats = read(K.chats, []);
  let chat = chats.find(
    (item) => item.type === 'direct' && item.participantIds.length === 2 &&
      item.participantIds.includes(firstId) && item.participantIds.includes(secondId),
  );
  if (chat) return chat;
  chat = {
    id: makeId('c'), type: 'direct', name: '', description: '',
    avatar: { color: pickColor(secondId), emoji: '' }, participantIds: [firstId, secondId],
    createdBy: firstId, createdAt: Date.now(), updatedAt: Date.now(),
    pinnedBy: {}, mutedBy: {}, unread: { [firstId]: 0, [secondId]: 0 },
  };
  chats.push(chat);
  write(K.chats, chats);
  write(K.messages, { ...read(K.messages, {}), [chat.id]: [] });
  return chat;
}

function notifyDvinsky(sender, text) {
  const dv = read(K.users, []).find((user) => user.login === 'dvinsky');
  if (!dv || dv.id === sender.id) return;
  const chat = directChat(sender.id, dv.id);
  pushMessage(chat, makeMessage(chat.id, sender.id, text));
}

function ensureGeneralChat(userId) {
  const chats = read(K.chats, []);
  let general = chats.find((chat) => chat.isGeneral);
  if (!general) {
    general = {
      id: 'demo_general', type: 'channel', name: 'Общий - DviGram', isGeneral: true,
      description: 'Общий канал для всех пользователей DviGram',
      avatar: { color: '#0b7cff', emoji: '💬' },
      participantIds: read(K.users, []).map((user) => user.id), createdBy: 'system',
      createdAt: Date.now(), updatedAt: Date.now(), pinnedBy: {}, mutedBy: {},
      unread: Object.fromEntries(read(K.users, []).map((user) => [user.id, 0])),
    };
    chats.push(general);
    write(K.chats, chats);
    write(K.messages, {
      ...read(K.messages, {}),
      demo_general: [makeMessage('demo_general', 'system', 'Добро пожаловать в общий канал DviGram! 👋', { kind: 'system', readBy: [] })],
    });
    return;
  }
  if (!general.participantIds.includes(userId)) {
    general.participantIds.push(userId);
    general.unread[userId] = 0;
    write(K.chats, chats);
  }
}

/* --------------------------------- Демо-данные -------------------------------- */

async function seed() {
  if (localStorage.getItem(K.ready)) return;
  const now = Date.now();
  const salt = 'dvigram-demo-salt';
  const demoHash = await hashPassword('demo1234', salt);
  const adminHash = await hashPassword(ADMIN_PASSWORD, salt);

  const mkUser = (id, name, login, hash, extra = {}) => ({
    id, name, login, salt, passwordHash: hash, bio: '', status: '',
    avatar: { color: pickColor(login), emoji: '' }, music: null, dailyClaimDate: '', streak: 0,
    createdAt: now - 8_640_000_000, lastActive: now, role: 'user', premium: false,
    premiumUntil: 0, prefix: '', badges: [], verified: false, balance: 1000,
    mutedUntil: 0, bannedUntil: 0, warnings: [], gifts: [], customization: defaultCustomization(), ...extra,
  });

  const users = [
    mkUser('demo_me', 'Вы (демо)', 'demo', demoHash, { bio: 'Это демо-аккаунт' }),
    mkUser('admin_demo', 'Администратор DviGram', 'admin', adminHash, {
      role: 'admin', verified: true, premium: true, balance: 99999, prefix: 'ADMIN',
      badges: ['⭐', '🛡️'], avatar: { color: '#ef4444', emoji: '🛡️' }, bio: 'Официальный администратор DviGram',
    }),
    mkUser('owner_demo', 'dvinsky', 'dvinsky', adminHash, {
      role: 'owner', verified: true, premium: true, balance: 99999, prefix: 'OWNER',
      badges: ['👑', '💎'], avatar: { color: '#8b5cf6', emoji: '👑' }, bio: 'Создатель DviGram',
    }),
    mkUser('demo_alina', 'Алина Соколова', 'alina', demoHash, {
      bio: 'Дизайнер. Люблю кофе и пиксели ✨', avatar: { color: '#8b5cf6', emoji: '' }, lastActive: now - 20_000,
    }),
    mkUser('demo_max', 'Максим Орлов', 'max', demoHash, {
      bio: 'Фронтенд, гитара, горы', avatar: { color: '#f97316', emoji: '' }, lastActive: now - 3_600_000,
    }),
    mkUser('demo_ira', 'Ирина Ким', 'ira', demoHash, {
      bio: 'Планирую всё и сразу', avatar: { color: '#10b981', emoji: '' }, lastActive: now - 180_000,
    }),
  ];

  const allIds = users.map((user) => user.id);
  const chats = [
    {
      id: 'demo_general', type: 'channel', name: 'Общий - DviGram', isGeneral: true,
      description: 'Общий канал для всех пользователей DviGram', avatar: { color: '#0b7cff', emoji: '💬' },
      participantIds: allIds, createdBy: 'system', createdAt: now - 400_000_000, updatedAt: now - 600_000,
      pinnedBy: {}, mutedBy: {}, unread: Object.fromEntries(allIds.map((id) => [id, 0])),
    },
    {
      id: 'demo_chat_alina', type: 'direct', name: '', avatar: { color: '#8b5cf6', emoji: '' },
      participantIds: ['demo_me', 'demo_alina'], createdBy: 'demo_me',
      createdAt: now - 300_000_000, updatedAt: now - 180_000,
      pinnedBy: { demo_me: true }, mutedBy: {}, unread: { demo_me: 0, demo_alina: 0 },
    },
    {
      id: 'demo_chat_max', type: 'direct', name: '', avatar: { color: '#f97316', emoji: '' },
      participantIds: ['demo_me', 'demo_max'], createdBy: 'demo_max',
      createdAt: now - 200_000_000, updatedAt: now - 3_600_000,
      pinnedBy: {}, mutedBy: {}, unread: { demo_me: 2, demo_max: 0 },
    },
    {
      id: 'demo_chat_group', type: 'group', name: 'Планы на выходные', avatar: { color: '#10b981', emoji: '🏔️' },
      participantIds: ['demo_me', 'demo_alina', 'demo_ira'], createdBy: 'demo_ira',
      createdAt: now - 100_000_000, updatedAt: now - 86_400_000,
      pinnedBy: {}, mutedBy: { demo_me: true }, unread: { demo_me: 0, demo_alina: 0, demo_ira: 0 },
    },
  ];

  const msg = (id, chatId, senderId, text, minutesAgo, extra = {}) =>
    makeMessage(chatId, senderId, text, { id, createdAt: now - minutesAgo * 60_000, readBy: [senderId, 'demo_me'], ...extra });

  const messages = {
    demo_general: [
      msg('gm0', 'demo_general', 'system', 'Добро пожаловать в общий канал DviGram! 👋', 2000, { kind: 'system', readBy: [] }),
      msg('gm1', 'demo_general', 'owner_demo', 'Привет всем! Это официальный канал DviGram 👑', 1900, { reactions: { '🔥': ['demo_me', 'demo_alina'] } }),
      msg('gm2', 'demo_general', 'admin_demo', 'Правила простые: общайтесь дружно и не спамьте 🛡️', 1800),
    ],
    demo_chat_alina: [
      msg('dm1', 'demo_chat_alina', 'demo_alina', 'Привет! Посмотри новый макет 👋', 92),
      msg('dm2', 'demo_chat_alina', 'demo_me', 'О, уже готов? Скидывай!', 90),
      msg('dm3', 'demo_chat_alina', 'demo_alina', 'Вот, сохранил в Figma', 88, { reactions: { '🔥': ['demo_me'] } }),
      msg('dm4', 'demo_chat_alina', 'demo_me', 'Очень красиво. Особенно градиенты 💙', 86),
      msg('dm5', 'demo_chat_alina', 'demo_alina', 'Спасибо! Завтра покажу мобильную версию', 3, { readBy: ['demo_alina'] }),
    ],
    demo_chat_max: [
      msg('dm6', 'demo_chat_max', 'demo_max', 'Ты видел новый релиз Vite?', 190),
      msg('dm7', 'demo_chat_max', 'demo_me', 'Да, сборка стала заметно быстрее', 185),
      msg('dm8', 'demo_chat_max', 'demo_max', 'Нужно будет обновить проект на неделе', 62, { readBy: ['demo_max'] }),
      msg('dm9', 'demo_chat_max', 'demo_max', 'И не забудь про Netlify Functions 🙂', 60, { readBy: ['demo_max'] }),
    ],
    demo_chat_group: [
      msg('dm10', 'demo_chat_group', 'demo_ira', 'Планирую поездку в горы. Кто с нами?', 1500),
      msg('dm11', 'demo_chat_group', 'demo_alina', 'Я за! Только нужно взять тёплые куртки', 1490, { reactions: { '🙌': ['demo_me', 'demo_ira'] } }),
      msg('dm12', 'demo_chat_group', 'demo_me', 'Я тоже еду. Можно я буду водителем?', 1480),
    ],
  };

  saveUsers(users);
  write(K.chats, chats);
  write(K.messages, messages);
  localStorage.setItem(K.ready, '1');
}

async function ensure() {
  if (!ensurePromise) ensurePromise = seed();
  await ensurePromise;
}

/* ---------------------------------- Методы API -------------------------------- */

export const localApi = {
  isDemo: true,

  async register({ name, login, password }) {
    await ensure();
    validateAuth({ name, login, password });
    const normalized = String(login).trim().toLowerCase();
    const users = read(K.users, []);
    if (users.some((user) => user.login === normalized)) throw new Error('Этот логин уже занят');
    const salt = makeId('salt');
    const user = {
      id: makeId('u'), name: String(name).trim(), login: normalized, salt,
      passwordHash: await hashPassword(password, salt), bio: '', status: '',
      avatar: { color: pickColor(normalized), emoji: '' }, music: null, dailyClaimDate: '', streak: 0,
      createdAt: Date.now(), lastActive: Date.now(), role: 'user', premium: false,
      premiumUntil: 0, prefix: '', badges: [], verified: false, balance: 1000,
      mutedUntil: 0, bannedUntil: 0, warnings: [], gifts: [], customization: defaultCustomization(),
    };
    users.push(user);
    saveUsers(users);
    ensureGeneralChat(user.id);
    localStorage.setItem(K.current, user.id);
    return { user: publicUser(user) };
  },

  async login({ login, password }) {
    await ensure();
    const normalized = String(login || '').trim().toLowerCase();
    const user = read(K.users, []).find((item) => item.login === normalized);
    if (!user || (await hashPassword(String(password || ''), user.salt)) !== user.passwordHash) {
      throw new Error('Неверный логин или пароль');
    }
    if (user.bannedUntil && user.bannedUntil > Date.now()) throw new Error('Аккаунт заблокирован администрацией DviGram');
    localStorage.setItem(K.current, user.id);
    return { user: publicUser(touch(user)) };
  },

  async logout() {
    localStorage.removeItem(K.current);
    return { ok: true };
  },

  async me() {
    await ensure();
    const user = currentUser();
    return { user: user ? publicUser(touch(user)) : null };
  },

  async contacts() {
    await ensure();
    const me = requireUser();
    const users = read(K.users, [])
      .filter((user) => user.id !== me.id)
      .map(publicUser)
      .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, 'ru'));
    return { users };
  },

  async profileUpdate({ name, bio, status, avatar, customization }) {
    await ensure();
    const me = requireUser();
    if (String(name || '').trim().length < 2) throw new Error('Имя должно быть не короче 2 символов');
    me.name = String(name).trim();
    me.bio = String(bio || '').slice(0, 180);
    me.status = String(status || '').slice(0, 80);
    if (/^#[0-9a-f]{6}$/i.test(avatar?.color)) me.avatar = { ...me.avatar, color: avatar.color };
    if (avatar?.emoji) me.avatar = { ...me.avatar, emoji: String(avatar.emoji).slice(0, 8) };
    if (avatar?.image === '') me.avatar = { ...me.avatar, image: '' };
    else if (avatar?.image) me.avatar = { ...me.avatar, image: validateImage(avatar.image) };
    sanitizeCustomization(me, customization);
    updateUser(me);
    return { user: publicUser(me) };
  },

  async customizeUpdate(input) {
    await ensure();
    const me = requireUser();
    sanitizeCustomization(me, input);
    updateUser(me);
    return { user: publicUser(me) };
  },

  async mediaAvatar({ image }) {
    await ensure();
    const me = requireUser();
    me.avatar = { ...me.avatar, image: validateImage(image) };
    updateUser(me);
    return { user: publicUser(me) };
  },

  async mediaAvatarRemove() {
    await ensure();
    const me = requireUser();
    me.avatar = { ...me.avatar, image: '' };
    updateUser(me);
    return { user: publicUser(me) };
  },

  async mediaMusic({ dataUrl, name, size }) {
    await ensure();
    const me = requireUser();
    const url = validateMusic(dataUrl);
    const media = read(K.media, {});
    media[me.id] = { dataUrl: url, name: String(name || 'Музыка профиля').slice(0, 120) };
    write(K.media, media);
    me.music = {
      name: media[me.id].name,
      type: url.slice(5, url.indexOf(';')),
      size: Math.max(0, Number(size) || 0),
      createdAt: Date.now(),
    };
    updateUser(me);
    return { user: publicUser(me) };
  },

  async mediaMusicGet({ userId }) {
    await ensure();
    requireUser();
    const media = read(K.media, {})[userId];
    if (!media?.dataUrl) throw new Error('Музыка не найдена');
    return media;
  },

  async mediaMusicRemove() {
    await ensure();
    const me = requireUser();
    const media = read(K.media, {});
    delete media[me.id];
    write(K.media, media);
    me.music = null;
    updateUser(me);
    return { user: publicUser(me) };
  },

  async dailyClaim() {
    await ensure();
    const me = requireUser();
    const today = new Date().toISOString().slice(0, 10);
    if (me.dailyClaimDate === today) throw new Error('Бонус уже получен сегодня. Возвращайтесь завтра!');
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    me.streak = me.dailyClaimDate === yesterday ? Math.max(0, Number(me.streak) || 0) + 1 : 1;
    me.dailyClaimDate = today;
    me.balance = Math.min(1_000_000_000, (me.balance || 0) + 25);
    updateUser(me);
    return { user: publicUser(me), reward: 25, streak: me.streak };
  },

  async storeItems() {
    return { items: SHOP_ITEMS, gifts: GIFT_CATALOG };
  },

  async storeBuy({ item: itemId }) {
    await ensure();
    const me = requireUser();
    const item = SHOP_ITEMS.find((entry) => entry.id === itemId);
    if (!item) throw new Error('Товар не найден');
    if (me.balance < item.price) throw new Error(`Недостаточно DVC. Нужно ${item.price}, у вас ${me.balance}`);
    if (item.id === 'moderator' && me.role !== 'user') throw new Error('У вас уже есть расширенные права');
    me.balance -= item.price;
    if (item.id === 'premium') {
      me.premium = true;
      me.premiumUntil = Date.now() + 30 * 86_400_000;
      if (!me.badges.includes('💎')) me.badges.push('💎');
    } else {
      me.role = 'moderator';
      if (!me.badges.includes('🛡️')) me.badges.push('🛡️');
    }
    updateUser(me);
    notifyDvinsky(me, `🛒 Покупка: ${item.emoji} ${item.name}. Пользователь @${me.login} (${me.name}). Остаток баланса: ${me.balance} DVC.`);
    return { user: publicUser(me), item };
  },

  async giftsList() {
    return { gifts: GIFT_CATALOG };
  },

  async giftsSend({ giftId, userId }) {
    await ensure();
    const me = requireUser();
    const gift = GIFT_CATALOG.find((item) => item.id === giftId);
    const target = read(K.users, []).find((user) => user.id === userId);
    if (!gift) throw new Error('Подарок не найден');
    if (!target) throw new Error('Получатель не найден');
    if (target.id === me.id) throw new Error('Нельзя дарить себе');
    if (me.balance < gift.price) throw new Error(`Недостаточно DVC. Нужно ${gift.price}`);
    me.balance -= gift.price;
    updateUser(me);
    const owned = {
      uid: makeId('nft'), giftId: gift.id, name: gift.name, emoji: gift.emoji, rarity: gift.rarity,
      color: gift.color, fromId: me.id, fromName: me.name, createdAt: Date.now(),
    };
    target.gifts = target.gifts || [];
    target.gifts.push(owned);
    updateUser(target);
    const chat = directChat(me.id, target.id);
    const message = pushMessage(chat, makeMessage(chat.id, me.id, `Отправил вам NFT-подарок ${gift.emoji} ${gift.name}`, {
      kind: 'gift', gift: owned,
    }));
    return { message: decorateMessage(message, read(K.users, [])), balance: me.balance };
  },

  async adminUsers() {
    await ensure();
    requireAdmin();
    return { users: read(K.users, []).map(publicUser) };
  },

  async adminUpdateUser(input) {
    await ensure();
    const admin = requireAdmin();
    const users = read(K.users, []);
    const target = users.find((user) => user.id === input.userId);
    if (!target) throw new Error('Пользователь не найден');
    if (target.role === 'owner') throw new Error('Нельзя изменять создателя DviGram');
    if (target.id === admin.id && input.role) throw new Error('Нельзя менять свою роль');

    if (input.role) {
      if (!['user', 'moderator', 'admin'].includes(input.role)) throw new Error('Недопустимая роль');
      target.role = input.role;
    }
    if (typeof input.premium === 'boolean') {
      target.premium = input.premium;
      target.premiumUntil = input.premium ? Date.now() + Math.max(1, Math.min(3650, Number(input.premiumDays) || 30)) * 86_400_000 : 0;
      target.badges = input.premium
        ? [...new Set([...(target.badges || []), '💎'])]
        : (target.badges || []).filter((badge) => badge !== '💎');
    }
    if (typeof input.prefix === 'string') target.prefix = String(input.prefix).trim().slice(0, 24).toUpperCase();
    if (Array.isArray(input.badges)) target.badges = input.badges.slice(0, 8).map((b) => String(b).slice(0, 8)).filter(Boolean);
    if (typeof input.verified === 'boolean') target.verified = input.verified;
    if (input.balance !== undefined) {
      const amount = Math.floor(Number(input.balance));
      if (!Number.isFinite(amount)) throw new Error('Некорректный баланс');
      target.balance = Math.max(0, Math.min(1_000_000_000, amount));
    }
    if (input.muteMinutes !== undefined) {
      const minutes = Math.max(0, Math.min(10080, Math.floor(Number(input.muteMinutes) || 0)));
      target.mutedUntil = minutes ? Date.now() + minutes * 60_000 : 0;
    }
    if (input.banMinutes !== undefined) {
      const minutes = Math.max(0, Math.min(525600, Math.floor(Number(input.banMinutes) || 0)));
      target.bannedUntil = minutes ? Date.now() + minutes * 60_000 : 0;
    }
    const warning = String(input.warning || '').trim().slice(0, 180);
    if (warning) target.warnings = [...(target.warnings || []), { text: warning, from: admin.id, createdAt: Date.now() }].slice(-10);
    saveUsers(users);
    return { user: publicUser(target) };
  },

  async chats() {
    await ensure();
    const me = requireUser();
    const users = usersMap();
    const allMessages = read(K.messages, {});
    const chats = read(K.chats, [])
      .filter((chat) => chat.participantIds.includes(me.id))
      .map((chat) => {
        const messages = allMessages[chat.id] || [];
        const last = messages[messages.length - 1];
        const other = chat.type === 'direct' ? users[chat.participantIds.find((id) => id !== me.id)] : null;
        const sender = last ? users[last.senderId] : null;
        const lastText = last
          ? last.kind === 'file' ? `📎 ${last.attachment?.name || 'Файл'}`
            : last.kind === 'gift' ? `🎁 ${last.gift?.name || 'NFT-подарок'}` : last.text
          : '';
        return {
          id: chat.id,
          type: chat.type,
          name: chat.type === 'direct' ? other?.name || 'Удалённый пользователь' : chat.name,
          description: chat.description || '',
          avatar: chat.type === 'direct' ? other?.avatar || chat.avatar : chat.avatar,
          participantIds: chat.participantIds,
          participants: chat.participantIds.map((id) => publicUser(users[id])).filter(Boolean),
          other: other ? publicUser(other) : null,
          otherId: other?.id || null,
          online: chat.type === 'direct' ? Boolean(other && Date.now() - (other.lastActive || 0) < 60_000) : false,
          lastMessage: last ? {
            id: last.id, text: lastText, senderId: last.senderId,
            senderName: sender?.name || (last.senderId === 'system' ? 'DviGram' : ''), createdAt: last.createdAt,
          } : null,
          unread: chat.unread?.[me.id] || 0,
          pinned: Boolean(chat.pinnedBy?.[me.id]),
          muted: Boolean(chat.mutedBy?.[me.id]),
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
        };
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
    return { chats };
  },

  async chatsCreate({ userId, name, description, participantIds, isGroup, isChannel, avatarEmoji }) {
    await ensure();
    const me = requireUser();
    const chats = read(K.chats, []);
    let chat;

    if (isChannel) {
      if (String(name || '').trim().length < 2) throw new Error('Название канала должно быть не короче 2 символов');
      const participants = read(K.users, []).map((user) => user.id);
      chat = {
        id: makeId('c'), type: 'channel', name: String(name).trim(),
        description: String(description || '').slice(0, 180),
        avatar: { color: pickColor(name), emoji: String(avatarEmoji || '📢').slice(0, 8) },
        participantIds: participants, createdBy: me.id, createdAt: Date.now(), updatedAt: Date.now(),
        pinnedBy: {}, mutedBy: {}, unread: Object.fromEntries(participants.map((id) => [id, 0])),
      };
    } else if (isGroup) {
      if (String(name || '').trim().length < 2) throw new Error('Название группы должно быть не короче 2 символов');
      const participants = [...new Set([me.id, ...(participantIds || [])])];
      if (participants.length < 2) throw new Error('Добавьте хотя бы одного участника');
      chat = {
        id: makeId('c'), type: 'group', name: String(name).trim(), description: '',
        avatar: { color: pickColor(name), emoji: String(avatarEmoji || '👥').slice(0, 8) },
        participantIds: participants, createdBy: me.id, createdAt: Date.now(), updatedAt: Date.now(),
        pinnedBy: {}, mutedBy: {}, unread: Object.fromEntries(participants.map((id) => [id, 0])),
      };
    } else {
      const other = read(K.users, []).find((user) => user.id === userId);
      if (!other || other.id === me.id) throw new Error('Пользователь не найден');
      const existing = chats.find(
        (item) => item.type === 'direct' && item.participantIds.length === 2 &&
          item.participantIds.includes(me.id) && item.participantIds.includes(other.id),
      );
      if (existing) {
        const view = (await this.chats()).chats.find((item) => item.id === existing.id);
        return { chat: view };
      }
      chat = {
        id: makeId('c'), type: 'direct', name: '', description: '', avatar: other.avatar || { color: pickColor(other.login), emoji: '' },
        participantIds: [me.id, other.id], createdBy: me.id, createdAt: Date.now(), updatedAt: Date.now(),
        pinnedBy: {}, mutedBy: {}, unread: { [me.id]: 0, [other.id]: 0 },
      };
    }

    chats.push(chat);
    write(K.chats, chats);
    write(K.messages, { ...read(K.messages, {}), [chat.id]: [] });
    const view = (await this.chats()).chats.find((item) => item.id === chat.id);
    return { chat: view };
  },

  async chatsUpdate({ chatId, pinned, muted }) {
    await ensure();
    const me = requireUser();
    const chats = read(K.chats, []);
    const chat = chats.find((item) => item.id === chatId);
    if (!chat || !chat.participantIds.includes(me.id)) throw new Error('Нет доступа к этому чату');
    if (typeof pinned === 'boolean') chat.pinnedBy[me.id] = pinned;
    if (typeof muted === 'boolean') chat.mutedBy[me.id] = muted;
    write(K.chats, chats);
    const view = (await this.chats()).chats.find((item) => item.id === chat.id);
    return { chat: view };
  },

  async messages({ chatId, before }) {
    await ensure();
    const me = requireUser();
    const chat = read(K.chats, []).find((item) => item.id === chatId);
    if (!chat || !chat.participantIds.includes(me.id)) throw new Error('Нет доступа к этому чату');
    const all = read(K.messages, {})[chatId] || [];
    let end = all.length;
    if (before) {
      const idx = all.findIndex((message) => message.id === before);
      if (idx > 0) end = idx;
    }
    const start = Math.max(0, end - PAGE_SIZE);
    const users = read(K.users, []);
    return { messages: all.slice(start, end).map((message) => decorateMessage(message, users)), hasMore: start > 0 };
  },

  async messagesSend({ chatId, text, attachment, replyTo }) {
    await ensure();
    const me = requireUser();
    if (me.mutedUntil && me.mutedUntil > Date.now()) throw new Error('Вы не можете писать сообщения: mute активен');
    const chats = read(K.chats, []);
    const chat = chats.find((item) => item.id === chatId);
    if (!chat || !chat.participantIds.includes(me.id)) throw new Error('Нет доступа к этому чату');
    const clean = String(text || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, 4000);
    if (!clean && !attachment) throw new Error('Введите сообщение');

    const store = read(K.messages, {});
    const messages = store[chatId] || [];
    let reply = null;
    if (replyTo) {
      const original = messages.find((message) => message.id === replyTo);
      if (original) {
        const sender = read(K.users, []).find((user) => user.id === original.senderId);
        reply = {
          id: original.id,
          text: original.kind === 'file' ? `📎 ${original.attachment?.name}` : original.text,
          senderName: sender?.name || 'DviGram',
        };
      }
    }

    const message = makeMessage(chatId, me.id, clean, {
      kind: attachment ? 'file' : 'text',
      attachment: attachment ? {
        name: String(attachment.name || 'Файл').slice(0, 150),
        size: Math.max(0, Number(attachment.size) || 0),
        type: String(attachment.type || 'application/octet-stream').slice(0, 80),
      } : null,
      replyTo: reply,
    });
    pushMessage(chat, message);
    me.balance = Math.min(1_000_000_000, (me.balance || 0) + 2);
    updateUser(me);
    return { message: decorateMessage(message, read(K.users, [])) };
  },

  async messagesRead({ chatId }) {
    await ensure();
    const me = requireUser();
    const chats = read(K.chats, []);
    const chat = chats.find((item) => item.id === chatId);
    if (!chat || !chat.participantIds.includes(me.id)) throw new Error('Нет доступа к этому чату');
    chat.unread[me.id] = 0;
    write(K.chats, chats);
    const store = read(K.messages, {});
    const messages = store[chatId] || [];
    let changed = false;
    messages.forEach((message) => {
      if (message.senderId !== me.id && message.senderId !== 'system' && !message.readBy.includes(me.id)) {
        message.readBy.push(me.id);
        changed = true;
      }
    });
    if (changed) {
      store[chatId] = messages;
      write(K.messages, store);
    }
    return { ok: true };
  },

  async messagesEdit({ chatId, messageId, text }) {
    await ensure();
    const me = requireUser();
    const store = read(K.messages, {});
    const messages = store[chatId] || [];
    const message = messages.find((item) => item.id === messageId);
    if (!message || message.senderId !== me.id) throw new Error('Можно редактировать только свои сообщения');
    const clean = String(text || '').trim().slice(0, 4000);
    if (!clean) throw new Error('Введите сообщение');
    message.text = clean;
    message.editedAt = Date.now();
    write(K.messages, store);
    return { message: decorateMessage(message, read(K.users, [])) };
  },

  async messagesDelete({ chatId, messageId }) {
    await ensure();
    const me = requireUser();
    const store = read(K.messages, {});
    const messages = store[chatId] || [];
    const message = messages.find((item) => item.id === messageId);
    if (!message || message.senderId !== me.id) throw new Error('Можно удалить только своё сообщение');
    message.kind = 'system';
    message.text = 'Сообщение удалено';
    message.attachment = null;
    message.gift = null;
    message.replyTo = null;
    message.reactions = {};
    message.deleted = true;
    write(K.messages, store);
    return { ok: true };
  },

  async messagesReact({ chatId, messageId, emoji }) {
    await ensure();
    requireUser();
    const store = read(K.messages, {});
    const messages = store[chatId] || [];
    const message = messages.find((item) => item.id === messageId);
    if (!message) throw new Error('Сообщение не найдено');
    const clean = String(emoji || '').slice(0, 8);
    if (!clean) throw new Error('Выберите эмодзи');
    message.reactions = message.reactions || {};
    const list = new Set(message.reactions[clean] || []);
    if (list.has(currentId())) list.delete(currentId());
    else list.add(currentId());
    if (list.size) message.reactions[clean] = [...list];
    else delete message.reactions[clean];
    write(K.messages, store);
    return { message: decorateMessage(message, read(K.users, [])) };
  },
};
