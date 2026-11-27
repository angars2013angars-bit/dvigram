/**
 * Локальный адаптер Dvis для разработки без Netlify Functions.
 * Данные хранятся в localStorage под префиксом dvis:local:*.
 */
import { generateInviteCode, normalizeInvite, validateNickname, validatePassword } from './dvis.js';

const K = {
  schema: 'dvis:schema',
  ready: 'dvis:local:ready',
  device: 'dvis:local:device',
  users: 'dvis:local:users',
  chats: 'dvis:local:chats',
  messages: 'dvis:local:messages',
  invites: 'dvis:local:invites',
  calls: 'dvis:local:calls',
  current: 'dvis:local:current',
};
const SCHEMA_VERSION = '2';

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

function ensure() {
  if (localStorage.getItem(K.schema) === SCHEMA_VERSION && localStorage.getItem(K.ready)) return;
  Object.values(K).forEach((key) => localStorage.removeItem(key));
  write(K.users, []);
  write(K.chats, []);
  write(K.messages, {});
  write(K.invites, {});
  write(K.calls, {});
  localStorage.setItem(K.ready, '1');
  localStorage.setItem(K.schema, SCHEMA_VERSION);
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function cleanText(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    nickname: user.nickname || user.name,
    color: user.color,
    createdAt: user.createdAt,
    lastSeen: user.lastActive || user.createdAt,
    online: Date.now() - (user.lastActive || 0) < 60_000,
  };
}

function requireUser() {
  const users = read(K.users, []);
  const user = users.find((item) => item.id === localStorage.getItem(K.current));
  if (!user) fail('Нужно войти в аккаунт', 401);
  user.lastActive = Date.now();
  write(K.users, users);
  return user;
}

function getChat(id) {
  return read(K.chats, []).find((chat) => chat.id === id) || null;
}

function saveChat(chat) {
  const chats = read(K.chats, []);
  const index = chats.findIndex((item) => item.id === chat.id);
  if (index >= 0) chats[index] = chat;
  else chats.push(chat);
  write(K.chats, chats);
}

function getMessages(chatId) {
  return read(K.messages, {})[chatId] || [];
}

function saveMessages(chatId, messages) {
  const all = read(K.messages, {});
  all[chatId] = messages.slice(-1000);
  write(K.messages, all);
}

function assertParticipant(chat, userId) {
  if (!chat || !chat.participantIds.includes(userId)) fail('Нет доступа к этому чату', 403);
}

function newChat({ name = '', participantIds, createdBy }) {
  const unread = {};
  participantIds.forEach((id) => { unread[id] = 0; });
  return {
    id: `c_${crypto.randomUUID()}`,
    name: cleanText(name, 60),
    participantIds,
    createdBy,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    unread,
  };
}

function systemMessage(chatId, text) {
  return {
    id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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

function pushMessage(chat, message) {
  const messages = getMessages(chat.id);
  messages.push(message);
  saveMessages(chat.id, messages);
  chat.updatedAt = message.createdAt;
  chat.unread = chat.unread || {};
  chat.participantIds.forEach((id) => {
    if (id !== message.senderId) chat.unread[id] = (chat.unread[id] || 0) + 1;
  });
  saveChat(chat);
  return message;
}

function chatView(chat, viewerId) {
  const users = read(K.users, []);
  const people = chat.participantIds.map((id) => users.find((user) => user.id === id)).filter(Boolean).map(publicUser);
  const other = people.find((person) => person.id !== viewerId);
  const list = getMessages(chat.id);
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

function decoratedMessages(messages) {
  const users = read(K.users, []);
  return messages.map((message) => {
    const sender = users.find((user) => user.id === message.senderId);
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

function inviteView(invite) {
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

function getCall(chatId) {
  return read(K.calls, {})[chatId] || null;
}

function saveCall(call) {
  const calls = read(K.calls, {});
  calls[call.chatId] = call;
  write(K.calls, calls);
}

export const localApi = {
  async accountCreate({ nickname, password, deviceId }) {
    ensure();
    const name = validateNickname(nickname);
    const secret = validatePassword(password);
    const users = read(K.users, []);
    if (users.some((item) => String(item.nickname || item.name).toLocaleLowerCase() === name.toLocaleLowerCase())) {
      fail('Этот ник уже занят. Выберите другой', 409);
    }
    const user = {
      id: `u_${crypto.randomUUID()}`,
      nickname: name,
      name,
      color: '#c8c8c8',
      // Демо-режим без Functions: данные уже лежат в localStorage,
      // поэтому пароль здесь хранится открыто. На сервере — только scrypt-хэш.
      password: secret,
      device: deviceId,
      createdAt: Date.now(),
      lastActive: Date.now(),
    };
    users.push(user);
    write(K.users, users);
    localStorage.setItem(K.current, user.id);
    localStorage.setItem(K.device, deviceId);
    return { user: publicUser(user) };
  },

  async accountLogin({ nickname, password, deviceId }) {
    ensure();
    const name = validateNickname(nickname);
    const users = read(K.users, []);
    const user = users.find((item) => String(item.nickname || item.name).toLocaleLowerCase() === name.toLocaleLowerCase()
      && item.password === String(password || ''));
    if (!user) fail('Неверный ник или пароль', 401);
    // Устройство запоминается для статистики, но никогда не блокирует вход.
    const devices = Array.isArray(user.devices) ? user.devices : [user.device].filter(Boolean);
    user.devices = Array.from(new Set([...devices, deviceId])).slice(-5);
    user.lastActive = Date.now();
    write(K.users, users);
    localStorage.setItem(K.current, user.id);
    localStorage.setItem(K.device, deviceId);
    return { user: publicUser(user) };
  },

  async accountLogout() {
    localStorage.removeItem(K.current);
    return { ok: true };
  },

  async me() {
    ensure();
    const users = read(K.users, []);
    const user = users.find((item) => item.id === localStorage.getItem(K.current));
    return { user: user ? publicUser(user) : null };
  },

  async profileUpdate({ name }) {
    ensure();
    const me = requireUser();
    const value = cleanText(name, 40);
    if (value.length < 2) fail('Имя должно быть не короче 2 символов');
    me.name = value;
    const users = read(K.users, []);
    users[users.findIndex((item) => item.id === me.id)] = me;
    write(K.users, users);
    return { user: publicUser(me) };
  },

  async chatsList() {
    ensure();
    const me = requireUser();
    const chats = read(K.chats, [])
      .filter((chat) => chat.participantIds.includes(me.id))
      .map((chat) => chatView(chat, me.id))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return { chats };
  },

  async chatUpdate({ chatId, name }) {
    ensure();
    const me = requireUser();
    const chat = getChat(chatId);
    assertParticipant(chat, me.id);
    const value = cleanText(name, 60);
    if (value.length < 2) fail('Название должно быть не короче 2 символов');
    chat.name = value;
    saveChat(chat);
    return { chat: chatView(chat, me.id) };
  },

  async chatLeave({ chatId }) {
    ensure();
    const me = requireUser();
    const chat = getChat(chatId);
    assertParticipant(chat, me.id);
    chat.participantIds = chat.participantIds.filter((id) => id !== me.id);
    if (chat.unread) delete chat.unread[me.id];
    saveChat(chat);
    return { ok: true };
  },

  async inviteCreate({ chatId, name, reusable }) {
    ensure();
    const me = requireUser();
    let chat = chatId ? getChat(chatId) : null;
    if (chat) assertParticipant(chat, me.id);
    else {
      chat = newChat({ name: cleanText(name, 60), participantIds: [me.id], createdBy: me.id });
      saveChat(chat);
    }
    const invite = {
      code: generateInviteCode(),
      chatId: chat.id,
      creatorId: me.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      maxUses: reusable ? 50 : 1,
      uses: 0,
      revoked: false,
    };
    const invites = read(K.invites, {});
    invites[invite.code] = invite;
    write(K.invites, invites);
    return { invite: inviteView(invite), chat: chatView(chat, me.id) };
  },

  async inviteList() {
    ensure();
    const me = requireUser();
    const invites = Object.values(read(K.invites, {}))
      .filter((invite) => invite.creatorId === me.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(inviteView);
    return { invites };
  },

  async inviteRevoke({ code }) {
    ensure();
    const me = requireUser();
    const normalized = normalizeInvite(code);
    const invites = read(K.invites, {});
    const invite = invites[normalized];
    if (!invite || invite.creatorId !== me.id) fail('Приглашение не найдено', 404);
    invite.revoked = true;
    invites[normalized] = invite;
    write(K.invites, invites);
    return { invite: inviteView(invite) };
  },

  async inviteJoin({ code }) {
    ensure();
    const me = requireUser();
    const normalized = normalizeInvite(code);
    const invites = read(K.invites, {});
    const invite = invites[normalized];
    if (!invite) fail('Приглашение не найдено', 404);
    if (invite.revoked) fail('Приглашение отозвано', 410);
    if (invite.expiresAt < Date.now()) fail('Срок действия приглашения истёк', 410);
    if ((invite.uses || 0) >= invite.maxUses) fail('Код приглашения уже использован', 410);
    const chat = getChat(invite.chatId);
    if (!chat) fail('Чат приглашения не найден', 404);
    if (chat.participantIds.includes(me.id)) fail('Вы уже участник этого чата', 409);
    chat.participantIds.push(me.id);
    chat.unread = chat.unread || {};
    chat.unread[me.id] = 0;
    invite.uses = (invite.uses || 0) + 1;
    invites[normalized] = invite;
    write(K.invites, invites);
    pushMessage(chat, systemMessage(chat.id, 'Новый участник вошёл в чат'));
    return { chat: chatView(chat, me.id) };
  },

  async messagesList({ chatId, before }) {
    ensure();
    const me = requireUser();
    const chat = getChat(chatId);
    assertParticipant(chat, me.id);
    let messages = getMessages(chatId);
    if (before) messages = messages.filter((message) => message.createdAt < before);
    const hasMore = messages.length > 40;
    return { messages: decoratedMessages(messages.slice(-40)), hasMore };
  },

  async messagesSend({ chatId, text, replyTo: replyId }) {
    ensure();
    const me = requireUser();
    const chat = getChat(chatId);
    assertParticipant(chat, me.id);
    const value = cleanText(text, 4000);
    if (!value) fail('Сообщение пустое');
    let replyTo = null;
    if (replyId) {
      const original = getMessages(chatId).find((item) => item.id === replyId);
      if (original) {
        const sender = original.senderId === 'system' ? null : read(K.users, []).find((user) => user.id === original.senderId);
        replyTo = {
          id: original.id,
          senderName: original.senderId === me.id ? 'Вы' : sender?.name || 'Аноним',
          text: original.deleted ? 'Сообщение удалено' : cleanText(original.text, 120),
        };
      }
    }
    const message = {
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      chatId,
      senderId: me.id,
      kind: 'text',
      text: value,
      replyTo,
      createdAt: Date.now(),
      editedAt: null,
      readBy: [me.id],
      reactions: {},
      deleted: false,
    };
    pushMessage(chat, message);
    return { message: decoratedMessages([message])[0] };
  },

  async messagesRead({ chatId }) {
    ensure();
    const me = requireUser();
    const chat = getChat(chatId);
    assertParticipant(chat, me.id);
    const messages = getMessages(chatId);
    messages.forEach((message) => {
      if (!message.readBy?.includes(me.id)) message.readBy = [...(message.readBy || []), me.id];
    });
    chat.unread = chat.unread || {};
    chat.unread[me.id] = 0;
    saveMessages(chatId, messages);
    saveChat(chat);
    return { ok: true };
  },

  async messagesReact({ chatId, messageId, emoji }) {
    ensure();
    const me = requireUser();
    const chat = getChat(chatId);
    assertParticipant(chat, me.id);
    const messages = getMessages(chatId);
    const message = messages.find((item) => item.id === messageId);
    if (!message) fail('Сообщение не найдено', 404);
    message.reactions = message.reactions || {};
    const users = message.reactions[emoji] || [];
    message.reactions[emoji] = users.includes(me.id) ? users.filter((id) => id !== me.id) : [...users, me.id];
    if (!message.reactions[emoji].length) delete message.reactions[emoji];
    saveMessages(chatId, messages);
    return { message: decoratedMessages([message])[0] };
  },

  async messagesDelete({ chatId, messageId }) {
    ensure();
    const me = requireUser();
    const chat = getChat(chatId);
    assertParticipant(chat, me.id);
    const messages = getMessages(chatId);
    const message = messages.find((item) => item.id === messageId);
    if (!message) fail('Сообщение не найдено', 404);
    if (message.senderId !== me.id) fail('Можно удалить только своё сообщение', 403);
    message.deleted = true;
    message.text = '';
    message.replyTo = null;
    message.reactions = {};
    saveMessages(chatId, messages);
    return { message: decoratedMessages([message])[0] };
  },

  async callStart({ chatId }) {
    ensure();
    const me = requireUser();
    const chat = getChat(chatId);
    assertParticipant(chat, me.id);
    if (chat.participantIds.length !== 2) fail('Звонки доступны только в личных чатах');
    const current = getCall(chatId);
    if (current && current.status !== 'ended') {
      if (current.status === 'active') fail('В этом чате уже идёт звонок', 409);
      if (Date.now() - current.createdAt < 2 * 60_000) fail('В этом чате уже есть звонок', 409);
    }
    const call = {
      id: `call_${crypto.randomUUID()}`,
      chatId,
      initiatorId: me.id,
      createdAt: Date.now(),
      status: 'ringing',
      offer: null,
      answer: null,
      ice: [],
      activeAt: null,
      endedAt: null,
    };
    saveCall(call);
    return { call };
  },

  async callSignal({ chatId, kind, data }) {
    ensure();
    const me = requireUser();
    assertParticipant(getChat(chatId), me.id);
    const call = getCall(chatId);
    if (!call || call.status === 'ended') fail('Звонок завершён', 410);
    if (kind === 'ice') {
      call.ice = (call.ice || []).slice(-60);
      call.ice.push({ from: me.id, candidate: data });
    } else call[kind] = { from: me.id, ...data };
    saveCall(call);
    return { ok: true };
  },

  async callActive({ chatId }) {
    ensure();
    const me = requireUser();
    assertParticipant(getChat(chatId), me.id);
    const call = getCall(chatId);
    if (!call || call.status === 'ended') fail('Звонок завершён', 410);
    if (call.status !== 'active') {
      call.status = 'active';
      call.activeAt = Date.now();
      saveCall(call);
    }
    return { call };
  },

  async callEnd({ chatId }) {
    ensure();
    const me = requireUser();
    assertParticipant(getChat(chatId), me.id);
    const call = getCall(chatId);
    if (call && call.status !== 'ended') {
      call.status = 'ended';
      call.endedAt = Date.now();
      saveCall(call);
    }
    return { ok: true };
  },

  async callsList() {
    ensure();
    const me = requireUser();
    const users = read(K.users, []);
    const chats = read(K.chats, []).filter((chat) => chat.participantIds.includes(me.id));
    const calls = chats.map((chat) => {
      const call = getCall(chat.id);
      if (!call || call.status === 'ended') return null;
      if (call.status === 'ringing' && Date.now() - call.createdAt > 2 * 60_000) return null;
      const initiator = users.find((user) => user.id === call.initiatorId);
      return { ...call, chatName: chatView(chat, me.id).name, initiatorName: initiator?.name || 'Аноним' };
    }).filter(Boolean);
    return { calls };
  },
};
