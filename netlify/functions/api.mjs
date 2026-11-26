import {
  GIFT_CATALOG,
  HttpError,
  SHOP_ITEMS,
  assertParticipant,
  chatView,
  checkRateLimit,
  cleanText,
  clearRateLimit,
  clientKey,
  createSession,
  createUser,
  destroySession,
  emptyCookie,
  ensureSeedAccounts,
  findOrCreateDirectChat,
  findUserByLogin,
  getChat,
  getIndex,
  getMedia,
  getMessages,
  getUser,
  isAdmin,
  isBanned,
  isMuted,
  json,
  listUsers,
  makeMessageId,
  newChat,
  notifyDvinsky,
  parseBody,
  pickColor,
  publicUser,
  pushMessage,
  requireAdmin,
  requireUser,
  removeMedia,
  saveChat,
  saveMedia,
  saveMessages,
  saveUser,
  sessionCookie,
  setIndex,
  touchUser,
  userFromEvent,
  validateAudioDataUrl,
  validateImageDataUrl,
  verifyPassword,
} from './_shared.mjs';

const PAGE_SIZE = 50;
let seedPromise = null;

function ensureSeed() {
  if (!seedPromise) {
    seedPromise = ensureSeedAccounts().catch((error) => {
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}

function mapById(users) {
  return Object.fromEntries(users.map((user) => [user.id, user]));
}

function sanitizeCustomization(user, input = {}) {
  const current = { ...user.customization };
  if (/^#[0-9a-f]{6}$/i.test(input.accent)) current.accent = input.accent;
  if (input.nameColor === '' || /^#[0-9a-f]{6}$/i.test(input.nameColor)) current.nameColor = input.nameColor || '';
  const scale = Number(input.fontScale);
  if (Number.isFinite(scale)) current.fontScale = Math.min(1.25, Math.max(0.85, scale));
  if (['classic', 'soft', 'glass'].includes(input.bubbleStyle)) current.bubbleStyle = input.bubbleStyle;
  if (['dots', 'waves', 'none'].includes(input.pattern)) current.pattern = input.pattern;
  user.customization = current;
  return user;
}

async function decoratedMessage(message, usersMap) {
  const sender = usersMap[message.senderId] || (message.senderId === 'system' ? null : await getUser(message.senderId));
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

async function allChats() {
  return (await getIndex('chats').then((ids) => Promise.all(ids.map((id) => getChat(id))))).filter(Boolean);
}

async function findDirectChat(userId, otherId) {
  const chats = await allChats();
  return chats.find(
    (chat) =>
      chat.type === 'direct' &&
      chat.participantIds.length === 2 &&
      chat.participantIds.includes(userId) &&
      chat.participantIds.includes(otherId),
  );
}

function normalizePremium(user) {
  if (user.premium && user.premiumUntil && user.premiumUntil < Date.now()) {
    user.premium = false;
    user.premiumUntil = 0;
    return true;
  }
  return false;
}

export async function handler(event) {
  try {
    await ensureSeed();

    if (event.httpMethod === 'OPTIONS') {
      return json({ ok: true }, 200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
    }

    const action = event.queryStringParameters?.action || '';
    const body = ['GET', 'HEAD'].includes(event.httpMethod) ? {} : parseBody(event);
    const ip = clientKey(event);

    /* ------------------------------- AUTH -------------------------------- */
    if (action === 'register') {
      const name = cleanText(body.name, 60);
      const login = cleanText(body.login, 120).toLowerCase();
      const password = String(body.password || '');

      if (name.length < 2) throw new HttpError(400, 'Имя должно быть не короче 2 символов');
      if (!/^[a-z0-9._@-]{3,}$/i.test(login)) {
        throw new HttpError(400, 'Логин: только латиница, цифры и . _ @ -, минимум 3 символа');
      }
      if (password.length < 8) throw new HttpError(400, 'Пароль должен быть не короче 8 символов');
      if (password.length > 200) throw new HttpError(400, 'Пароль слишком длинный');

      await checkRateLimit(`register:${ip}`, 15);
      const user = await createUser({ name, login, password });
      const token = await createSession(user.id);
      return json({ user: publicUser(user) }, 201, { 'Set-Cookie': sessionCookie(token) });
    }

    if (action === 'login') {
      const login = cleanText(body.login, 120).toLowerCase();
      const password = String(body.password || '');
      const limitKey = `login:${ip}:${login}`;

      await checkRateLimit(limitKey, 8);
      const user = await findUserByLogin(login);
      const valid = user && verifyPassword(password, user.salt, user.passwordHash);
      if (!valid) throw new HttpError(401, 'Неверный логин или пароль');
      if (isBanned(user)) throw new HttpError(403, 'Аккаунт заблокирован администрацией DviGram');

      await clearRateLimit(limitKey);
      await touchUser(user);
      const token = await createSession(user.id);
      return json({ user: publicUser(user) }, 200, { 'Set-Cookie': sessionCookie(token) });
    }

    if (action === 'logout') {
      await destroySession(event);
      return json({ ok: true }, 200, { 'Set-Cookie': emptyCookie });
    }

    if (action === 'me') {
      const user = await userFromEvent(event);
      if (!user) return json({ user: null });
      if (isBanned(user)) throw new HttpError(403, 'Аккаунт заблокирован администрацией DviGram');
      if (normalizePremium(user)) await saveUser(user);
      await touchUser(user);
      return json({ user: publicUser(user) });
    }

    /* ---------------------------- ПОЛЬЗОВАТЕЛИ ---------------------------- */
    if (action === 'contacts') {
      const me = await requireUser(event);
      const users = await listUsers();
      return json({
        users: users
          .filter((user) => user.id !== me.id)
          .map(publicUser)
          .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, 'ru')),
      });
    }

    if (action === 'profile.update' || action === 'customize.update') {
      const user = await requireUser(event);
      if (action === 'profile.update') {
        const name = cleanText(body.name, 60);
        if (name.length < 2) throw new HttpError(400, 'Имя должно быть не короче 2 символов');
        user.name = name;
        user.bio = cleanText(body.bio, 180);
        user.status = cleanText(body.status, 80);
        const color = cleanText(body.avatar?.color, 20);
        const emoji = cleanText(body.avatar?.emoji, 8);
        if (/^#[0-9a-f]{6}$/i.test(color)) user.avatar = { ...user.avatar, color };
        if (emoji) user.avatar = { ...user.avatar, emoji };
        if (body.avatar?.image === '') {
          user.avatar = { ...user.avatar, image: '' };
        } else if (body.avatar?.image) {
          user.avatar = { ...user.avatar, image: validateImageDataUrl(body.avatar.image) };
        }
      }
      sanitizeCustomization(user, body.customization || body);
      await saveUser(user);
      return json({ user: publicUser(user) });
    }

    /* ------------------------------- МЕДИА -------------------------------- */
    if (action === 'media.avatar') {
      const user = await requireUser(event);
      const image = validateImageDataUrl(body.image);
      user.avatar = { ...user.avatar, image };
      await saveUser(user);
      return json({ user: publicUser(user) });
    }

    if (action === 'media.avatar.remove') {
      const user = await requireUser(event);
      user.avatar = { ...user.avatar, image: '' };
      await saveUser(user);
      return json({ user: publicUser(user) });
    }

    if (action === 'media.music') {
      const user = await requireUser(event);
      const { dataUrl, type } = validateAudioDataUrl(body.dataUrl);
      const size = Math.max(0, Math.min(2_500_000, Math.floor(Number(body.size) || 0)));
      await saveMedia(user.id, 'music', { dataUrl, type, name: cleanText(body.name, 120) || 'Музыка профиля' });
      user.music = { name: cleanText(body.name, 120) || 'Музыка профиля', type, size, createdAt: Date.now() };
      await saveUser(user);
      return json({ user: publicUser(user) });
    }

    if (action === 'media.music.get') {
      await requireUser(event);
      const userId = cleanText(body.userId, 80);
      const media = await getMedia(userId, 'music');
      if (!media?.dataUrl) throw new HttpError(404, 'Музыка не найдена');
      return json({ dataUrl: media.dataUrl, name: media.name || 'Музыка профиля', type: media.type });
    }

    if (action === 'media.music.remove') {
      const user = await requireUser(event);
      await removeMedia(user.id, 'music');
      user.music = null;
      await saveUser(user);
      return json({ user: publicUser(user) });
    }

    if (action === 'daily.claim') {
      const user = await requireUser(event);
      const today = new Date().toISOString().slice(0, 10);
      if (user.dailyClaimDate === today) throw new HttpError(409, 'Бонус уже получен сегодня. Возвращайтесь завтра!');
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      user.streak = user.dailyClaimDate === yesterday ? Math.max(0, Number(user.streak) || 0) + 1 : 1;
      user.dailyClaimDate = today;
      user.balance = Math.min(1_000_000_000, (user.balance || 0) + 25);
      await saveUser(user);
      return json({ user: publicUser(user), reward: 25, streak: user.streak });
    }

    /* ------------------------------ МАГАЗИН ------------------------------ */
    if (action === 'store.items') {
      return json({ items: Object.values(SHOP_ITEMS), gifts: GIFT_CATALOG });
    }

    if (action === 'store.buy') {
      const me = await requireUser(event);
      const item = SHOP_ITEMS[cleanText(body.item, 30)];
      if (!item) throw new HttpError(404, 'Товар не найден');
      if (me.balance < item.price) {
        throw new HttpError(400, `Недостаточно DVC. Нужно ${item.price}, у вас ${me.balance}`);
      }
      if (item.id === 'moderator' && me.role !== 'user') {
        throw new HttpError(400, 'У вас уже есть расширенные права');
      }

      me.balance -= item.price;
      if (item.id === 'premium') {
        me.premium = true;
        me.premiumUntil = Date.now() + 30 * 86_400_000;
        if (!me.badges.includes('💎')) me.badges.push('💎');
      } else {
        me.role = 'moderator';
        if (!me.badges.includes('🛡️')) me.badges.push('🛡️');
      }
      await saveUser(me);
      await notifyDvinsky(me, `🛒 Покупка: ${item.emoji} ${item.name}. Пользователь @${me.login} (${me.name}). Остаток баланса: ${me.balance} DVC.`);
      return json({ user: publicUser(me), item }, 201);
    }

    if (action === 'gifts.list') {
      return json({ gifts: GIFT_CATALOG });
    }

    if (action === 'gifts.send') {
      const me = await requireUser(event);
      const gift = GIFT_CATALOG.find((item) => item.id === cleanText(body.giftId, 40));
      const target = await getUser(cleanText(body.userId, 80));
      if (!gift) throw new HttpError(404, 'Подарок не найден');
      if (!target) throw new HttpError(404, 'Получатель не найден');
      if (target.id === me.id) throw new HttpError(400, 'Нельзя дарить себе');
      if (me.balance < gift.price) throw new HttpError(400, `Недостаточно DVC. Нужно ${gift.price}`);

      me.balance -= gift.price;
      await saveUser(me);

      const owned = {
        uid: `nft_${makeMessageId()}`,
        giftId: gift.id,
        name: gift.name,
        emoji: gift.emoji,
        rarity: gift.rarity,
        color: gift.color,
        fromId: me.id,
        fromName: me.name,
        createdAt: Date.now(),
      };
      target.gifts = target.gifts || [];
      target.gifts.push(owned);
      await saveUser(target);

      const chat = await findOrCreateDirectChat(me.id, target.id);
      const message = await pushMessage(chat, {
        id: makeMessageId(),
        chatId: chat.id,
        senderId: me.id,
        text: `Отправил вам NFT-подарок ${gift.emoji} ${gift.name}`,
        kind: 'gift',
        attachment: null,
        gift: owned,
        replyTo: null,
        createdAt: Date.now(),
        editedAt: null,
        readBy: [me.id],
        reactions: {},
      });

      return json({ message: await decoratedMessage(message, mapById(await listUsers())), balance: me.balance }, 201);
    }

    /* ------------------------------- АДМИНКА ------------------------------ */
    if (action === 'admin.users') {
      await requireAdmin(event);
      return json({ users: (await listUsers()).map(publicUser) });
    }

    if (action === 'admin.updateUser') {
      const admin = await requireAdmin(event);
      const target = await getUser(cleanText(body.userId, 80));
      if (!target) throw new HttpError(404, 'Пользователь не найден');
      if (target.role === 'owner') throw new HttpError(403, 'Нельзя изменять создателя DviGram');
      if (target.id === admin.id && body.role) throw new HttpError(400, 'Нельзя менять свою роль');

      if (typeof body.role === 'string') {
        if (!['user', 'moderator', 'admin'].includes(body.role)) throw new HttpError(400, 'Недопустимая роль');
        target.role = body.role;
        if (body.role !== 'moderator' && body.role !== 'admin') target.premium = target.premium && target.premiumUntil > Date.now();
      }
      if (typeof body.premium === 'boolean') {
        target.premium = body.premium;
        target.premiumUntil = body.premium ? Date.now() + Math.max(1, Math.min(3650, Number(body.premiumDays) || 30)) * 86_400_000 : 0;
        if (body.premium && !target.badges.includes('💎')) target.badges.push('💎');
        if (!body.premium) target.badges = target.badges.filter((badge) => badge !== '💎');
      }
      if (typeof body.prefix === 'string') target.prefix = cleanText(body.prefix, 24).toUpperCase();
      if (Array.isArray(body.badges)) {
        target.badges = body.badges
          .slice(0, 8)
          .map((badge) => cleanText(badge, 8))
          .filter(Boolean);
      }
      if (typeof body.verified === 'boolean') target.verified = body.verified;
      if (body.balance !== undefined) {
        const amount = Math.floor(Number(body.balance));
        if (!Number.isFinite(amount)) throw new HttpError(400, 'Некорректный баланс');
        target.balance = Math.max(0, Math.min(1_000_000_000, amount));
      }
      if (body.muteMinutes !== undefined) {
        const minutes = Math.max(0, Math.min(10080, Math.floor(Number(body.muteMinutes) || 0)));
        target.mutedUntil = minutes ? Date.now() + minutes * 60_000 : 0;
      }
      if (body.banMinutes !== undefined) {
        const minutes = Math.max(0, Math.min(525600, Math.floor(Number(body.banMinutes) || 0)));
        target.bannedUntil = minutes ? Date.now() + minutes * 60_000 : 0;
      }
      const warning = cleanText(body.warning, 180);
      if (warning) {
        target.warnings = target.warnings || [];
        target.warnings.push({ text: warning, from: admin.id, createdAt: Date.now() });
        target.warnings = target.warnings.slice(-10);
      }

      await saveUser(target);
      return json({ user: publicUser(target) });
    }

    /* -------------------------------- ЧАТЫ -------------------------------- */
    if (action === 'chats') {
      const me = await requireUser(event);
      const usersMap = mapById(await listUsers());
      const chats = await allChats();
      const views = await Promise.all(
        chats
          .filter((chat) => chat.participantIds.includes(me.id))
          .map((chat) => chatView(chat, me.id, usersMap)),
      );
      views.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
      return json({ chats: views });
    }

    if (action === 'chats.create') {
      const me = await requireUser(event);
      const isGroup = Boolean(body.isGroup);
      const isChannel = Boolean(body.isChannel);
      let chat;

      if (isChannel) {
        const name = cleanText(body.name, 80);
        if (name.length < 2) throw new HttpError(400, 'Название канала должно быть не короче 2 символов');
        const participants = (await listUsers()).map((user) => user.id);
        chat = newChat({
          type: 'channel',
          name,
          description: cleanText(body.description, 180),
          participantIds: participants,
          createdBy: me.id,
          avatar: { color: pickColor(name), emoji: String(body.avatarEmoji || '📢').slice(0, 8) },
        });
      } else if (isGroup) {
        const name = cleanText(body.name, 80);
        if (name.length < 2) throw new HttpError(400, 'Название группы должно быть не короче 2 символов');
        const requested = Array.isArray(body.participantIds) ? body.participantIds : [];
        const participants = [...new Set([me.id, ...requested])].filter((id) => typeof id === 'string');
        if (participants.length < 2) throw new HttpError(400, 'Добавьте хотя бы одного участника');
        for (const id of participants) {
          if (!(await getUser(id))) throw new HttpError(400, 'Один из участников не найден');
        }
        chat = newChat({
          type: 'group',
          name,
          participantIds: participants,
          createdBy: me.id,
          avatar: { color: pickColor(name), emoji: String(body.avatarEmoji || '👥').slice(0, 8) },
        });
      } else {
        const otherId = cleanText(body.userId, 80);
        const other = await getUser(otherId);
        if (!other) throw new HttpError(404, 'Пользователь не найден');
        if (other.id === me.id) throw new HttpError(400, 'Нельзя создать чат с собой');
        const existing = await findDirectChat(me.id, other.id);
        if (existing) return json({ chat: await chatView(existing, me.id, mapById(await listUsers())) });
        chat = newChat({
          type: 'direct',
          participantIds: [me.id, other.id],
          createdBy: me.id,
          avatar: { color: other.avatar?.color || pickColor(other.login), emoji: '' },
        });
      }

      await saveChat(chat);
      const ids = await getIndex('chats');
      ids.push(chat.id);
      await setIndex('chats', ids);
      return json({ chat: await chatView(chat, me.id, mapById(await listUsers())) }, 201);
    }

    if (action === 'chats.update') {
      const me = await requireUser(event);
      const chat = await getChat(cleanText(body.chatId, 80));
      await assertParticipant(chat, me.id);
      if (typeof body.pinned === 'boolean') chat.pinnedBy[me.id] = body.pinned;
      if (typeof body.muted === 'boolean') chat.mutedBy[me.id] = body.muted;
      await saveChat(chat);
      return json({ chat: await chatView(chat, me.id, mapById(await listUsers())) });
    }

    /* ------------------------------ СООБЩЕНИЯ ----------------------------- */
    if (action === 'messages') {
      const me = await requireUser(event);
      const chat = await getChat(cleanText(body.chatId || event.queryStringParameters?.chatId, 80));
      await assertParticipant(chat, me.id);
      const all = await getMessages(chat.id);
      let end = all.length;
      const before = cleanText(body.before || event.queryStringParameters?.before, 80);
      if (before) {
        const idx = all.findIndex((message) => message.id === before);
        if (idx > 0) end = idx;
      }
      const start = Math.max(0, end - PAGE_SIZE);
      const usersMap = mapById(await listUsers());
      const page = await Promise.all(all.slice(start, end).map((msg) => decoratedMessage(msg, usersMap)));
      return json({ messages: page, hasMore: start > 0 });
    }

    if (action === 'messages.send') {
      const me = await requireUser(event);
      if (isMuted(me)) throw new HttpError(403, 'Вы не можете писать сообщения: mute активен');
      const chat = await getChat(cleanText(body.chatId, 80));
      await assertParticipant(chat, me.id);

      const text = cleanText(body.text, 4000);
      const rawAttachment = body.attachment;
      const attachment = rawAttachment
        ? {
            name: cleanText(rawAttachment.name, 150) || 'Файл',
            size: Math.max(0, Number(rawAttachment.size) || 0),
            type: cleanText(rawAttachment.type, 80) || 'application/octet-stream',
          }
        : null;
      if (!text && !attachment) throw new HttpError(400, 'Введите сообщение');

      const messages = await getMessages(chat.id);
      let replyTo = null;
      if (body.replyTo) {
        const original = messages.find((msg) => msg.id === body.replyTo);
        if (original) {
          const sender = await getUser(original.senderId);
          replyTo = {
            id: original.id,
            text: original.kind === 'file' ? `📎 ${original.attachment?.name}` : original.text,
            senderName: sender?.name || 'DviGram',
          };
        }
      }

      const message = {
        id: makeMessageId(),
        chatId: chat.id,
        senderId: me.id,
        text,
        kind: attachment ? 'file' : 'text',
        attachment,
        gift: null,
        replyTo,
        createdAt: Date.now(),
        editedAt: null,
        readBy: [me.id],
        reactions: {},
      };
      await pushMessage(chat, message);

      // Внутренняя валюта начисляется за активность в чатах.
      me.balance = Math.min(1_000_000_000, (me.balance || 0) + 2);
      await saveUser(me);

      return json({ message: await decoratedMessage(message, mapById(await listUsers())) }, 201);
    }

    if (action === 'messages.read') {
      const me = await requireUser(event);
      const chat = await getChat(cleanText(body.chatId, 80));
      await assertParticipant(chat, me.id);
      chat.unread = chat.unread || {};
      chat.unread[me.id] = 0;
      await saveChat(chat);

      const messages = await getMessages(chat.id);
      let changed = false;
      messages.forEach((msg) => {
        if (msg.senderId !== me.id && msg.senderId !== 'system' && !msg.readBy.includes(me.id)) {
          msg.readBy.push(me.id);
          changed = true;
        }
      });
      if (changed) await saveMessages(chat.id, messages);
      return json({ ok: true });
    }

    if (action === 'messages.edit') {
      const me = await requireUser(event);
      const chat = await getChat(cleanText(body.chatId, 80));
      await assertParticipant(chat, me.id);
      const messages = await getMessages(chat.id);
      const message = messages.find((msg) => msg.id === cleanText(body.messageId, 80));
      if (!message) throw new HttpError(404, 'Сообщение не найдено');
      if (message.senderId !== me.id) throw new HttpError(403, 'Можно редактировать только свои сообщения');
      const text = cleanText(body.text, 4000);
      if (!text) throw new HttpError(400, 'Введите сообщение');
      message.text = text;
      message.editedAt = Date.now();
      await saveMessages(chat.id, messages);
      return json({ message: await decoratedMessage(message, mapById(await listUsers())) });
    }

    if (action === 'messages.delete') {
      const me = await requireUser(event);
      const chat = await getChat(cleanText(body.chatId, 80));
      await assertParticipant(chat, me.id);
      const messages = await getMessages(chat.id);
      const message = messages.find((msg) => msg.id === cleanText(body.messageId, 80));
      if (!message) throw new HttpError(404, 'Сообщение не найдено');
      if (message.senderId !== me.id) throw new HttpError(403, 'Можно удалить только своё сообщение');
      message.kind = 'system';
      message.text = 'Сообщение удалено';
      message.attachment = null;
      message.gift = null;
      message.replyTo = null;
      message.reactions = {};
      message.deleted = true;
      await saveMessages(chat.id, messages);
      return json({ ok: true });
    }

    if (action === 'messages.react') {
      const me = await requireUser(event);
      const chat = await getChat(cleanText(body.chatId, 80));
      await assertParticipant(chat, me.id);
      const messages = await getMessages(chat.id);
      const message = messages.find((msg) => msg.id === cleanText(body.messageId, 80));
      if (!message) throw new HttpError(404, 'Сообщение не найдено');
      const emoji = cleanText(body.emoji, 8);
      if (!emoji) throw new HttpError(400, 'Выберите эмодзи');
      message.reactions = message.reactions || {};
      const list = new Set(message.reactions[emoji] || []);
      if (list.has(me.id)) list.delete(me.id);
      else list.add(me.id);
      if (list.size) message.reactions[emoji] = [...list];
      else delete message.reactions[emoji];
      await saveMessages(chat.id, messages);
      return json({ message: await decoratedMessage(message, mapById(await listUsers())) });
    }

    throw new HttpError(404, 'Неизвестное действие API');
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error('[dvigram:api]', error);
    return json({ error: error.message || 'Внутренняя ошибка сервера' }, status);
  }
}
