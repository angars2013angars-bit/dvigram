import {
  HttpError,
  INVITE_TTL,
  addCallIce,
  assertParticipant,
  chatView,
  checkRateLimit,
  cleanText,
  clearRateLimit,
  clientKey,
  createSession,
  createUser,
  decoratedMessages,
  deleteCallIce,
  destroySession,
  deviceHash,
  emptyCookie,
  findUserByKey,
  generateInviteCode,
  generateKey,
  callView,
  getCall,
  getChat,
  getIndex,
  getInvite,
  getUser,
  getMessages,
  inviteView,
  listCallIce,
  newCall,
  json,
  makeMessageId,
  newChat,
  normalizeInvite,
  normalizeKey,
  parseBody,
  publicUser,
  pushMessage,
  requireUser,
  saveCall,
  saveChat,
  saveInvite,
  saveMessages,
  sessionCookie,
  setIndex,
  systemMessage,
  userFromEvent,
} from './_shared.mjs';

const PAGE_SIZE = 40;
const REACTIONS = new Set(['👍', '❤️', '😂', '🔥', '😮', '😢']);

async function registerChat(chat) {
  await saveChat(chat);
  const ids = await getIndex('chats');
  ids.push(chat.id);
  await setIndex('chats', ids);
  return chat;
}

async function visibleChats(userId) {
  const ids = await getIndex('chats');
  const chats = await Promise.all(ids.map((id) => getChat(id)));
  const mine = chats.filter((chat) => chat && chat.participantIds.includes(userId));
  return Promise.all(mine.map((chat) => chatView(chat, userId)));
}

async function oneMessage(chat, messageId) {
  const messages = await getMessages(chat.id);
  const message = messages.find((item) => item.id === messageId);
  if (!message) throw new HttpError(404, 'Сообщение не найдено');
  const [decorated] = await decoratedMessages([message]);
  return decorated;
}

async function myInvites(userId) {
  const codes = await getIndex('invites');
  const invites = await Promise.all(codes.map((code) => getInvite(code)));
  return invites
    .filter((invite) => invite && invite.creatorId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return json({ ok: true }, 200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Dvis-Device',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      });
    }

    const action = event.queryStringParameters?.action || '';
    const body = parseBody(event);
    const ip = clientKey(event);
    const device = deviceHash(event);

    /* ------------------------------ АККАУНТ ------------------------------- */
    if (action === 'account.create') {
      await checkRateLimit(`create:${ip}:${device}`, 10);
      const key = generateKey();
      const user = await createUser(key, device);
      const token = await createSession(user.id);
      return json({ user: publicUser(user), key }, 201, { 'Set-Cookie': sessionCookie(token) });
    }

    if (action === 'account.login') {
      await checkRateLimit(`login:${ip}:${device}`, 12);
      const key = normalizeKey(body.key);
      const user = await findUserByKey(key, device);
      if (!user) throw new HttpError(401, 'Ключ не найден или привязан к другому устройству');
      await clearRateLimit(`login:${ip}:${device}`);
      const token = await createSession(user.id);
      return json({ user: publicUser(user) }, 200, { 'Set-Cookie': sessionCookie(token) });
    }

    if (action === 'account.logout') {
      await destroySession(event);
      return json({ ok: true }, 200, { 'Set-Cookie': emptyCookie });
    }

    if (action === 'me') {
      const user = await userFromEvent(event);
      const valid = user && (!user.deviceHash || user.deviceHash === device);
      return json({ user: valid ? publicUser(user) : null });
    }

    if (action === 'profile.update') {
      const user = await requireUser(event);
      const name = cleanText(body.name, 40);
      if (name.length < 2) throw new HttpError(400, 'Имя должно быть не короче 2 символов');
      user.name = name;
      await saveUser(user);
      return json({ user: publicUser(user) });
    }

    /* -------------------------------- ЧАТЫ -------------------------------- */
    if (action === 'chats.list') {
      const user = await requireUser(event);
      const chats = await visibleChats(user.id);
      chats.sort((a, b) => b.updatedAt - a.updatedAt);
      return json({ chats });
    }

    if (action === 'chat.update') {
      const user = await requireUser(event);
      const chat = await getChat(cleanText(body.chatId, 80));
      assertParticipant(chat, user.id);
      const name = cleanText(body.name, 60);
      if (name.length < 2) throw new HttpError(400, 'Название должно быть не короче 2 символов');
      chat.name = name;
      await saveChat(chat);
      return json({ chat: await chatView(chat, user.id) });
    }

    if (action === 'chat.leave') {
      const user = await requireUser(event);
      const chat = await getChat(cleanText(body.chatId, 80));
      assertParticipant(chat, user.id);
      chat.participantIds = chat.participantIds.filter((id) => id !== user.id);
      if (chat.unread) delete chat.unread[user.id];
      await saveChat(chat);
      return json({ ok: true });
    }

    /* ----------------------------- ПРИГЛАШЕНИЯ ----------------------------- */
    if (action === 'invite.create') {
      const user = await requireUser(event);
      let chat = body.chatId ? await getChat(cleanText(body.chatId, 80)) : null;
      if (chat) assertParticipant(chat, user.id);
      else chat = await registerChat(newChat({ name: cleanText(body.name, 60), participantIds: [user.id], createdBy: user.id }));

      const invite = {
        code: generateInviteCode(),
        chatId: chat.id,
        creatorId: user.id,
        createdAt: Date.now(),
        expiresAt: Date.now() + INVITE_TTL,
        maxUses: body.reusable ? 50 : 1,
        uses: 0,
        revoked: false,
      };
      await saveInvite(invite);
      const codes = await getIndex('invites');
      codes.push(invite.code);
      await setIndex('invites', codes);
      return json({ invite: inviteView(invite), chat: await chatView(chat, user.id) });
    }

    if (action === 'invite.list') {
      const user = await requireUser(event);
      const invites = (await myInvites(user.id)).map(inviteView);
      return json({ invites });
    }

    if (action === 'invite.revoke') {
      const user = await requireUser(event);
      const code = normalizeInvite(body.code);
      const invite = await getInvite(code);
      if (!invite || invite.creatorId !== user.id) throw new HttpError(404, 'Приглашение не найдено');
      invite.revoked = true;
      await saveInvite(invite);
      return json({ invite: inviteView(invite) });
    }

    if (action === 'invite.join') {
      const user = await requireUser(event);
      const code = normalizeInvite(body.code);
      const invite = await getInvite(code);
      if (!invite) throw new HttpError(404, 'Приглашение не найдено');
      if (invite.revoked) throw new HttpError(410, 'Приглашение отозвано');
      if (invite.expiresAt < Date.now()) throw new HttpError(410, 'Срок действия приглашения истёк');
      if ((invite.uses || 0) >= invite.maxUses) throw new HttpError(410, 'Код приглашения уже использован');

      const chat = await getChat(invite.chatId);
      if (!chat) throw new HttpError(404, 'Чат приглашения не найден');
      if (chat.participantIds.includes(user.id)) throw new HttpError(409, 'Вы уже участник этого чата');

      chat.participantIds.push(user.id);
      chat.unread = chat.unread || {};
      chat.unread[user.id] = 0;
      invite.uses = (invite.uses || 0) + 1;
      await saveChat(chat);
      await saveInvite(invite);
      await pushMessage(chat, systemMessage(chat.id, 'Новый участник вошёл в чат'));
      return json({ chat: await chatView(chat, user.id) });
    }

    /* ------------------------------ СООБЩЕНИЯ ------------------------------ */
    if (action === 'messages.list') {
      const user = await requireUser(event);
      const chat = await getChat(cleanText(body.chatId, 80));
      assertParticipant(chat, user.id);
      let messages = await getMessages(chat.id);
      const before = Number(body.before) || 0;
      if (before) messages = messages.filter((message) => message.createdAt < before);
      const hasMore = messages.length > PAGE_SIZE;
      const page = messages.slice(-PAGE_SIZE);
      return json({ messages: await decoratedMessages(page), hasMore });
    }

    if (action === 'messages.send') {
      const user = await requireUser(event);
      const chat = await getChat(cleanText(body.chatId, 80));
      assertParticipant(chat, user.id);
      const text = cleanText(body.text, 4000);
      if (!text) throw new HttpError(400, 'Сообщение пустое');

      let replyTo = null;
      if (body.replyTo) {
        const original = (await getMessages(chat.id)).find((item) => item.id === body.replyTo);
        if (original) {
          const sender = original.senderId === 'system' ? null : await getUser(original.senderId);
          replyTo = {
            id: original.id,
            senderName: original.senderId === user.id ? 'Вы' : sender?.name || 'Аноним',
            text: original.deleted ? 'Сообщение удалено' : cleanText(original.text, 120),
          };
        }
      }

      const message = {
        id: makeMessageId(),
        chatId: chat.id,
        senderId: user.id,
        kind: 'text',
        text,
        replyTo,
        createdAt: Date.now(),
        editedAt: null,
        readBy: [user.id],
        reactions: {},
        deleted: false,
      };
      await pushMessage(chat, message);
      return json({ message: await oneMessage(chat, message.id) }, 201);
    }

    if (action === 'messages.read') {
      const user = await requireUser(event);
      const chat = await getChat(cleanText(body.chatId, 80));
      assertParticipant(chat, user.id);
      const messages = await getMessages(chat.id);
      let changed = false;
      messages.forEach((message) => {
        if (!message.readBy?.includes(user.id)) {
          message.readBy = [...(message.readBy || []), user.id];
          changed = true;
        }
      });
      if (chat.unread?.[user.id]) {
        chat.unread[user.id] = 0;
        changed = true;
      }
      if (changed) {
        await saveMessages(chat.id, messages);
        await saveChat(chat);
      }
      return json({ ok: true });
    }

    if (action === 'messages.react') {
      const user = await requireUser(event);
      const chat = await getChat(cleanText(body.chatId, 80));
      assertParticipant(chat, user.id);
      const emoji = String(body.emoji || '');
      if (!REACTIONS.has(emoji)) throw new HttpError(400, 'Неподдерживаемая реакция');
      const messages = await getMessages(chat.id);
      const message = messages.find((item) => item.id === body.messageId);
      if (!message) throw new HttpError(404, 'Сообщение не найдено');
      message.reactions = message.reactions || {};
      const users = message.reactions[emoji] || [];
      message.reactions[emoji] = users.includes(user.id) ? users.filter((id) => id !== user.id) : [...users, user.id];
      if (!message.reactions[emoji].length) delete message.reactions[emoji];
      await saveMessages(chat.id, messages);
      return json({ message: await oneMessage(chat, message.id) });
    }

    if (action === 'messages.delete') {
      const user = await requireUser(event);
      const chat = await getChat(cleanText(body.chatId, 80));
      assertParticipant(chat, user.id);
      const messages = await getMessages(chat.id);
      const message = messages.find((item) => item.id === body.messageId);
      if (!message) throw new HttpError(404, 'Сообщение не найдено');
      if (message.senderId !== user.id) throw new HttpError(403, 'Можно удалить только своё сообщение');
      message.deleted = true;
      message.text = '';
      message.replyTo = null;
      message.reactions = {};
      await saveMessages(chat.id, messages);
      return json({ message: await oneMessage(chat, message.id) });
    }

    /* -------------------------------- ЗВОНКИ ------------------------------- */
    if (action === 'call.start') {
      const user = await requireUser(event);
      const chat = await getChat(cleanText(body.chatId, 80));
      assertParticipant(chat, user.id);
      if (chat.participantIds.length !== 2) throw new HttpError(400, 'Звонки доступны только в личных чатах');
      const current = await getCall(chat.id);
      if (current && current.status !== 'ended') {
        if (current.status === 'active') throw new HttpError(409, 'В этом чате уже идёт звонок');
        if (Date.now() - current.createdAt < 2 * 60_000) throw new HttpError(409, 'В этом чате уже есть звонок');
        // Старый вызов, на который никто не ответил, закрываем автоматически.
        current.status = 'ended';
        current.endedAt = Date.now();
        await deleteCallIce(current);
        await saveCall(current);
      }
      const call = newCall({ chatId: chat.id, initiatorId: user.id });
      await saveCall(call);
      return json({ call: callView(call) }, 201);
    }

    if (action === 'call.signal') {
      const user = await requireUser(event);
      const chat = await getChat(cleanText(body.chatId, 80));
      assertParticipant(chat, user.id);
      const call = await getCall(chat.id);
      if (!call || call.status === 'ended') throw new HttpError(410, 'Звонок завершён');
      const kind = String(body.kind || '');
      const data = body.data;
      if (!['offer', 'answer', 'ice'].includes(kind) || !data || typeof data !== 'object') {
        throw new HttpError(400, 'Некорректный сигнал');
      }
      if (JSON.stringify(data).length > 8000) throw new HttpError(413, 'Сигнал слишком большой');
      if (kind === 'ice') {
        // Отдельный ключ на кандидата: параллельные сигналы не перетирают друг друга.
        await addCallIce(call, user.id, data);
      } else {
        call[kind] = { from: user.id, ...data };
        await saveCall(call);
      }
      return json({ ok: true });
    }

    if (action === 'call.active') {
      const user = await requireUser(event);
      const chat = await getChat(cleanText(body.chatId, 80));
      assertParticipant(chat, user.id);
      const call = await getCall(chat.id);
      if (!call || call.status === 'ended') throw new HttpError(410, 'Звонок завершён');
      if (call.status !== 'active') {
        call.status = 'active';
        call.activeAt = Date.now();
        await saveCall(call);
      }
      return json({ call: callView(call, await listCallIce(call)) });
    }

    if (action === 'call.end') {
      const user = await requireUser(event);
      const chat = await getChat(cleanText(body.chatId, 80));
      assertParticipant(chat, user.id);
      const call = await getCall(chat.id);
      if (call && call.status !== 'ended') {
        call.status = 'ended';
        call.endedAt = Date.now();
        await saveCall(call);
        await deleteCallIce(call);
      }
      return json({ ok: true });
    }

    if (action === 'calls.list') {
      const user = await requireUser(event);
      const chats = await visibleChats(user.id);
      const calls = await Promise.all(chats.map(async (chat) => {
        const call = await getCall(chat.id);
        if (!call || call.status === 'ended') return null;
        // Активный звонок может длиться сколь угодно долго. Старым считаем только
        // вызов, на который никто не ответил.
        if (call.status === 'ringing' && Date.now() - call.createdAt > 2 * 60_000) return null;
        const ice = await listCallIce(call);
        return {
          ...callView(call, ice),
          chatName: chat.name,
          initiatorName: chat.participants.find((p) => p.id === call.initiatorId)?.name || 'Аноним',
        };
      }));
      return json({ calls: calls.filter(Boolean) });
    }

    throw new HttpError(404, 'Неизвестное действие');
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error('[dvis] handler error', error);
    return json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
}
