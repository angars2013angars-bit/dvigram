import { api } from '../lib/api.js';
import { CallSession } from '../lib/calls.js';
import { deviceLabel, interfaceLabel, isDesktopLayout } from '../lib/device.js';
import { REACTIONS, formatDate, formatDuration, formatTime, getSavedKey, maskKey } from '../lib/dvis.js';
import { closeModal, confirmDialog, copyText, openModal, toast } from '../lib/ui.js';
import { escapeHtml, icon } from '../lib/utils.js';

export function renderApp(root, user, onLogout) {
  const state = {
    user,
    chats: [],
    messages: [],
    invites: [],
    lastInvite: null,
    activeChatId: null,
    view: 'chats',
    settingsTab: 'account',
    keyRevealed: false,
    inviteTab: 'create',
    search: '',
    replyTo: null,
    pollTimer: null,
    chatsSignature: '',
    messagesSignature: '',
    installPrompt: window.__dvisInstallPrompt || null,
    desktop: isDesktopLayout(),
    callSession: null,
    callStatus: 'idle',
    callChatId: null,
    callInfo: null,
    callStartedAt: 0,
    callTimer: null,
    declinedCallId: null,
    callBusy: false,
  };

  const $ = (selector) => root.querySelector(selector);
  const activeChat = () => state.chats.find((chat) => chat.id === state.activeChatId) || null;

  root.innerHTML = `
    <div class="phone">
      <div class="phone__glow"></div>
      <header class="topbar" id="topbar"></header>
      <main class="content" id="content"></main>
      <nav class="tabbar" id="tabbar">
        <button class="tabbar__item" data-tab="chats">${icon('chat', 21)}<span>Чаты</span></button>
        <button class="tabbar__item" data-tab="settings">${icon('gear', 21)}<span>Настройки</span></button>
      </nav>
      <div id="call-layer"></div>
    </div>
  `;
  root.dataset.mode = state.desktop ? 'desktop' : 'mobile';

  /* ------------------------------ Шапка ---------------------------------- */

  function renderTopbar() {
    const topbar = $('#topbar');
    if (state.view === 'chat') {
      const chat = activeChat();
      topbar.innerHTML = `
        <button class="icon-btn" data-back aria-label="Назад">${icon('back', 22)}</button>
        <div class="topbar__heading">
          <strong>${escapeHtml(chat?.name || 'Чат')}</strong>
          <span>${chat?.type === 'direct' ? 'личный чат · звонок доступен' : `${chat?.participants?.length || 0} участников`}</span>
        </div>
        ${chat?.type === 'direct' ? `<button class="icon-btn" data-call aria-label="Позвонить">${icon('phone', 20)}</button>` : ''}
        <button class="icon-btn" data-chat-menu aria-label="Меню чата">${icon('more', 22)}</button>
      `;
    } else if (state.view === 'settings') {
      topbar.innerHTML = `
        <div class="topbar__heading">
          <strong>Настройки</strong>
          <span>Dvis · ${escapeHtml(interfaceLabel())}</span>
        </div>
        <button class="icon-btn" data-tab="chats" aria-label="К чатам">${icon('chat', 20)}</button>
      `;
    } else if (state.desktop) {
      topbar.innerHTML = `
        <div class="topbar__heading">
          <strong>Dvis</strong>
          <span>Выберите чат слева или создайте приглашение</span>
        </div>
      `;
    } else {
      topbar.innerHTML = `
        <div class="brand brand--small">
          <div class="brand__mark">${icon('lock', 19)}</div>
          <div><strong>Dvis</strong><span>${icon('shield', 12)} без имени и телефона</span></div>
        </div>
        <button class="icon-btn icon-btn--accent" data-new-invite aria-label="Новое приглашение">${icon('plus', 22)}</button>
      `;
    }
  }

  /* ------------------------------ Список чатов --------------------------- */

  function chatsViewHtml() {
    const query = state.search.trim().toLowerCase();
    const chats = state.chats.filter((chat) => !query || chat.name.toLowerCase().includes(query));
    return `
      <section class="view view--chats">
        <div class="pane-head">
          <div class="brand brand--small">
            <div class="brand__mark">${icon('lock', 19)}</div>
            <div><strong>Dvis</strong><span>${icon('shield', 12)} без имени и телефона</span></div>
          </div>
          <button class="icon-btn icon-btn--accent" data-new-invite aria-label="Новое приглашение">${icon('plus', 22)}</button>
        </div>
        <label class="searchbar">${icon('search', 18)}
          <input id="chat-search" value="${escapeHtml(state.search)}" placeholder="Поиск по чатам" autocomplete="off" />
        </label>
        <div class="chat-list">
          ${chats.length ? chats.map((chat) => `
            <button class="chat-item" data-chat-id="${chat.id}">
              <span class="avatar" style="--avatar-color:${chat.participants[0]?.color || '#c8c8c8'}">${escapeHtml(chat.name.slice(0, 2).toUpperCase())}</span>
              <span class="chat-item__body">
                <span class="chat-item__top">
                  <strong>${escapeHtml(chat.name)}</strong>
                  <time>${chat.lastMessage ? formatTime(chat.lastMessage.createdAt) : ''}</time>
                </span>
                <span class="chat-item__bottom">
                  <span>${chat.lastMessage ? (chat.lastMessage.kind === 'system' ? '' : `${escapeHtml(chat.lastMessage.senderName)}: `) + escapeHtml(chat.lastMessage.text) : 'Начните переписку'}</span>
                  ${chat.unread ? `<b class="unread">${chat.unread}</b>` : ''}
                </span>
              </span>
            </button>
          `).join('') : `
            <div class="empty-state">
              <div class="empty-state__icon">${icon(query ? 'search' : 'chat', 30)}</div>
              <h3>${query ? 'Ничего не найдено' : 'Пока нет чатов'}</h3>
              <p>${query ? 'Попробуйте другой запрос' : 'Люди находятся только по вашему приглашению.'}</p>
              ${query ? '' : `<button class="btn btn--primary" data-new-invite>${icon('plus', 17)} Создать приглашение</button>`}
            </div>
          `}
        </div>
        <p class="list-hint">${icon('lock', 13)} Поиск людей отключён — только коды приглашений</p>
      </section>
    `;
  }

  function renderChatListOnly() {
    const host = $('.chat-list');
    if (!host || state.view !== 'chats') return;
    const template = document.createElement('template');
    template.innerHTML = chatsViewHtml();
    host.innerHTML = template.content.querySelector('.chat-list').innerHTML;
    renderTabbar();
  }

  /* ------------------------------- Переписка ----------------------------- */

  function messageHtml(message, previous) {
    if (message.kind === 'system') {
      return `<div class="system-note">${escapeHtml(message.text)}</div>`;
    }
    const mine = message.senderId === state.user.id;
    const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
    const reactions = Object.entries(message.reactions || {}).map(([emoji, ids]) => `
      <button class="reaction ${ids.includes(state.user.id) ? 'is-mine' : ''}" data-react="${emoji}" data-message-id="${message.id}">${emoji} ${ids.length}</button>
    `).join('');
    const read = (message.readBy || []).some((id) => id !== state.user.id);
    return `
      ${newDay ? `<div class="day-sep">${formatDate(message.createdAt)}</div>` : ''}
      <div class="message-row ${mine ? 'is-own' : ''}" data-message-id="${message.id}">
        ${mine ? '' : `<span class="avatar avatar--tiny" style="--avatar-color:${message.senderColor}">${escapeHtml(message.senderName.slice(0, 1))}</span>`}
        <div class="message-col">
          ${message.replyTo ? `<div class="reply-preview"><strong>${escapeHtml(message.replyTo.senderName)}</strong><span>${escapeHtml(message.replyTo.text)}</span></div>` : ''}
          <div class="bubble ${message.deleted ? 'is-deleted' : ''}" data-open-actions="${message.id}">
            ${message.deleted ? 'Сообщение удалено' : escapeHtml(message.text)}
          </div>
          <div class="message-meta">${formatTime(message.createdAt)} ${mine ? `<span class="read-mark ${read ? 'is-read' : ''}">${icon('checks', 13)}</span>` : ''}</div>
          ${reactions ? `<div class="reactions">${reactions}</div>` : ''}
        </div>
      </div>
    `;
  }

  function renderMessages(scroll = false) {
    const host = $('#messages');
    if (!host) return;
    host.innerHTML = state.messages.map((message, index) => messageHtml(message, state.messages[index - 1])).join('');
    if (scroll || true) requestAnimationFrame(() => { host.scrollTop = host.scrollHeight; });
  }

  function chatViewHtml() {
    return `
      <section class="view view--chat">
        <div class="messages" id="messages"></div>
        <div class="composer-wrap">
          ${state.replyTo ? `
            <div class="reply-bar">
              <div><strong>${escapeHtml(state.replyTo.senderName)}</strong><span>${escapeHtml(state.replyTo.text)}</span></div>
              <button data-cancel-reply aria-label="Отменить ответ">${icon('close', 17)}</button>
            </div>
          ` : ''}
          <div class="emoji-strip is-hidden" id="emoji-strip">
            ${REACTIONS.map((emoji) => `<button data-emoji="${emoji}">${emoji}</button>`).join('')}
          </div>
          <form class="composer" id="composer-form">
            <button type="button" class="icon-btn" id="emoji-button" aria-label="Эмодзи">${icon('smile', 21)}</button>
            <textarea id="message-input" rows="1" maxlength="4000" placeholder="Сообщение"></textarea>
            <button type="submit" class="send-btn" aria-label="Отправить">${icon('send', 20)}</button>
          </form>
        </div>
      </section>
    `;
  }

  /* ------------------------------- Настройки ----------------------------- */

  function settingsViewHtml() {
    const tabs = [
      ['account', 'Аккаунт'],
      ['invites', 'Приглашения'],
      ['about', 'О приложении'],
    ];
    return `
      <section class="view view--settings">
        <div class="segmented">
          ${tabs.map(([id, label]) => `<button class="${state.settingsTab === id ? 'is-active' : ''}" data-settings-tab="${id}">${label}</button>`).join('')}
        </div>
        <div class="settings-body">${settingsBodyHtml()}</div>
      </section>
    `;
  }

  function settingsBodyHtml() {
    const storedKey = getSavedKey();
    if (state.settingsTab === 'account') {
      return `
        <div class="card">
          <div class="card__title">${icon('key', 17)} Ключ аккаунта</div>
          <div class="masked-key ${state.keyRevealed ? 'is-revealed' : ''}">${escapeHtml(state.keyRevealed && storedKey ? storedKey : maskKey(storedKey))}</div>
          <div class="key-actions">
            <button class="btn btn--soft" data-copy-key>${icon('copy', 16)} Копировать</button>
            <button class="btn btn--soft" data-toggle-key>${icon(state.keyRevealed ? 'eyeOff' : 'eye', 16)} ${state.keyRevealed ? 'Скрыть' : 'Показать'}</button>
          </div>
          <p class="hint">Ключ привязан к этому устройству и хранится только в браузере. Показать его можно сразу, без перезагрузки.</p>
        </div>
        <div class="card">
          <div class="card__title">${icon('shield', 17)} Устройство и версия</div>
          <p class="hint">${escapeHtml(deviceLabel())} · ${escapeHtml(interfaceLabel())}. Версия выбрана автоматически при входе.</p>
        </div>
        <form class="card" id="profile-form">
          <div class="card__title">${icon('edit', 17)} Имя в чате</div>
          <label class="field"><span>Как вас видят собеседники</span><input id="profile-name" value="${escapeHtml(state.user.name)}" maxlength="40" /></label>
          <button class="btn btn--primary btn--block" type="submit">Сохранить</button>
        </form>
        <button class="btn btn--danger btn--block" data-logout>${icon('back', 17)} Выйти из аккаунта</button>
      `;
    }

    if (state.settingsTab === 'invites') {
      const inviteTabs = `
        <div class="segmented segmented--inner">
          <button class="${state.inviteTab === 'create' ? 'is-active' : ''}" data-invite-tab="create">Создать код</button>
          <button class="${state.inviteTab === 'join' ? 'is-active' : ''}" data-invite-tab="join">Войти по коду</button>
        </div>
      `;
      const create = `
        <form class="card" id="invite-create-form">
          <div class="card__title">${icon('plus', 17)} Новое приглашение</div>
          <label class="field"><span>Название чата <em>необязательно</em></span><input id="invite-name" maxlength="60" placeholder="Например: Личный чат" /></label>
          <label class="switch-row"><span>Многоразовый код</span><input type="checkbox" id="invite-reusable" /><i></i></label>
          <button class="btn btn--primary btn--block" type="submit">${icon('arrow', 17)} Создать приглашение</button>
        </form>
        ${state.lastInvite ? inviteCardHtml(state.lastInvite, true) : ''}
        <div class="card">
          <div class="card__title">${icon('users', 17)} Мои активные коды</div>
          ${state.invites.length ? state.invites.map((invite) => inviteCardHtml(invite, false)).join('') : '<p class="hint">Активных приглашений нет.</p>'}
        </div>
      `;
      const join = `
        <form class="card" id="invite-join-form">
          <div class="card__title">${icon('key', 17)} Код приглашения</div>
          <p class="hint">Введите код, которым с вами поделились. Поиск пользователей в Dvis отключён.</p>
          <label class="field"><span>Код DVS-XXXX-XXXX-XXXX</span><input id="join-code" autocomplete="off" spellcheck="false" placeholder="DVS-A1B2-C3D4-E5F6" required /></label>
          <button class="btn btn--primary btn--block" type="submit">${icon('arrow', 17)} Войти в чат</button>
        </form>
      `;
      return inviteTabs + (state.inviteTab === 'create' ? create : join);
    }

    return `
      <div class="card">
        <div class="card__title">${icon('phone', 17)} Приложение на телефоне</div>
        <p class="hint">Добавьте Dvis на экран Домой — откроется как обычное приложение, без адресной строки.</p>
        <button class="btn btn--soft btn--block" data-install>${icon('download', 17)} Как установить</button>
      </div>
      <div class="card">
        <div class="card__title">${icon('shield', 17)} О приватности</div>
        <p class="hint">Аккаунт — только ключ. Профили не ищутся, переписка доступна лишь участникам чата, созданного по приглашению.</p>
      </div>
      <p class="version">Dvis · версия 1.0 · ${api.isDemo() ? 'демо-режим' : 'сервер подключён'}</p>
    `;
  }

  function inviteCardHtml(invite, highlight) {
    return `
      <div class="invite-card ${highlight ? 'is-new' : ''} ${invite.active ? '' : 'is-inactive'}">
        <div class="invite-card__head">
          <code>${escapeHtml(invite.code)}</code>
          <span>${invite.active ? `осталось ${invite.maxUses - invite.uses}` : invite.revoked ? 'отозван' : 'неактивен'}</span>
        </div>
        <div class="invite-card__actions">
          <button data-copy-invite="${invite.code}">${icon('copy', 15)} Код</button>
          <button data-share-invite="${invite.code}">${icon('share', 15)} Поделиться</button>
          ${invite.revoked ? '' : `<button data-revoke-invite="${invite.code}">${icon('trash', 15)} Отозвать</button>`}
        </div>
      </div>
    `;
  }

  /* -------------------------------- Звонки -------------------------------- */

  function resetCall() {
    state.callSession = null;
    state.callChatId = null;
    state.callInfo = null;
    state.callStatus = 'idle';
    state.callStartedAt = 0;
    clearInterval(state.callTimer);
    state.callTimer = null;
  }

  function renderCallLayer() {
    const layer = $('#call-layer');
    if (!layer) return;
    if (state.callStatus === 'idle') {
      layer.innerHTML = '';
      return;
    }
    if (state.callStatus === 'incoming') {
      const call = state.callInfo;
      layer.innerHTML = `
        <div class="call-backdrop">
          <div class="call-card call-card--incoming">
            <div class="call-pulse">${icon('phone', 30)}</div>
            <span class="call-label">Входящий вызов</span>
            <h2>${escapeHtml(call?.initiatorName || 'Аноним')}</h2>
            <p>${escapeHtml(call?.chatName || 'Личный чат')}</p>
            <div class="call-actions">
              <button class="call-btn call-btn--accept" data-call-answer>${icon('phone', 20)} Ответить</button>
              <button class="call-btn call-btn--decline" data-call-decline>${icon('close', 20)} Отклонить</button>
            </div>
          </div>
        </div>
      `;
      return;
    }
    const outgoing = state.callStatus === 'outgoing';
    const chatName = state.callInfo?.chatName || activeChat()?.name || 'Собеседник';
    layer.innerHTML = `
      <div class="call-pill ${outgoing ? 'is-outgoing' : 'is-active'}">
        <span class="call-pill__pulse"></span>
        <div class="call-pill__text">
          <strong>${outgoing ? 'Исходящий вызов' : 'Идёт звонок'}</strong>
          <span>${escapeHtml(chatName)} · <b id="call-timer">${formatDuration(outgoing ? 0 : Date.now() - state.callStartedAt)}</b></span>
        </div>
        <button class="call-mini" data-call-mute aria-label="Микрофон">${icon(state.callSession?.muted ? 'micOff' : 'mic', 16)}</button>
        <button class="call-mini call-mini--end" data-call-end aria-label="Завершить">${icon('close', 17)}</button>
      </div>
    `;
  }

  function handleCallState(status, session) {
    state.callStatus = status;
    if (status === 'timeout') {
      toast('Абонент не ответил', 'info');
      session.end().catch(() => {});
      return;
    }
    if (status === 'failed') {
      toast('Соединение прервано', 'error');
      session.end().catch(() => {});
      return;
    }
    if (status === 'idle' || status === 'ended') {
      resetCall();
      renderCallLayer();
      return;
    }
    if (status === 'active' && !state.callTimer) {
      state.callStartedAt = state.callStartedAt || Date.now();
      state.callTimer = setInterval(() => {
        const timer = $('#call-timer');
        if (timer) timer.textContent = formatDuration(Date.now() - state.callStartedAt);
      }, 1000);
    }
    renderCallLayer();
  }

  function makeCallSession(chatId) {
    return new CallSession({
      api,
      chatId,
      meId: state.user.id,
      onState: handleCallState,
    });
  }

  async function startOutgoingCall() {
    const chat = activeChat();
    if (!chat || chat.type !== 'direct' || state.callStatus !== 'idle' || state.callBusy) return;
    state.callBusy = true;
    state.callChatId = chat.id;
    state.callInfo = { chatName: chat.name };
    const session = makeCallSession(chat.id);
    state.callSession = session;
    try {
      await session.start();
    } catch (error) {
      toast(error.message || 'Не удалось начать звонок', 'error');
      session.cleanup();
      await api.callEnd({ chatId: chat.id }).catch(() => {});
      resetCall();
      renderCallLayer();
    } finally {
      state.callBusy = false;
    }
  }

  async function acceptIncomingCall() {
    const call = state.callInfo;
    if (!call?.offer || state.callSession || state.callBusy) return;
    state.callBusy = true;
    const session = makeCallSession(call.chatId);
    state.callSession = session;
    try {
      await session.accept(call);
    } catch (error) {
      toast(error.message || 'Не удалось ответить на звонок', 'error');
      session.cleanup();
      await api.callEnd({ chatId: call.chatId }).catch(() => {});
      resetCall();
      renderCallLayer();
    } finally {
      state.callBusy = false;
    }
  }

  async function declineIncomingCall() {
    const call = state.callInfo;
    state.declinedCallId = call?.id || null;
    await api.callEnd({ chatId: call?.chatId }).catch(() => {});
    resetCall();
    renderCallLayer();
  }

  async function endCall() {
    const session = state.callSession;
    const chatId = state.callChatId;
    resetCall();
    renderCallLayer();
    if (session) {
      session.cleanup();
      await api.callEnd({ chatId }).catch(() => {});
    }
    toast('Звонок завершён', 'info');
  }

  async function pollCalls() {
    try {
      const { calls } = await api.callsList();
      const current = state.callChatId ? calls.find((call) => call.chatId === state.callChatId) : null;

      if (state.callSession) {
        if (!current || current.status === 'ended') {
          if (state.callStatus !== 'idle') toast('Звонок завершён', 'info');
          state.callSession.cleanup();
          resetCall();
          renderCallLayer();
          return;
        }
        await state.callSession.apply(current);
        return;
      }

      if (state.callStatus !== 'idle') return;
      const incoming = calls.find((call) =>
        call.status === 'ringing' && call.offer && call.initiatorId !== state.user.id && call.id !== state.declinedCallId,
      );
      if (incoming) {
        state.callInfo = incoming;
        state.callChatId = incoming.chatId;
        state.callStatus = 'incoming';
        renderCallLayer();
      }
    } catch {
      /* тихий ретрай */
    }
  }

  function desktopEmptyHtml() {
    return `
      <section class="view view--empty">
        <div class="empty-state">
          <div class="empty-state__icon">${icon('chat', 32)}</div>
          <h3>Выберите чат</h3>
          <p>Здесь появится переписка. Новых людей можно добавить только по приглашению.</p>
          <button class="btn btn--primary" data-new-invite>${icon('plus', 17)} Создать приглашение</button>
        </div>
      </section>
    `;
  }

  function renderContent() {
    const content = $('#content');
    root.dataset.view = state.view;
    if (state.desktop) {
      const main = state.view === 'settings'
        ? settingsViewHtml()
        : state.view === 'chat' && activeChat()
          ? chatViewHtml()
          : desktopEmptyHtml();
      content.innerHTML = `
        <div class="desktop-grid">
          <aside class="desktop-list">${chatsViewHtml()}</aside>
          <section class="desktop-main">${main}</section>
        </div>
      `;
    } else {
      content.innerHTML = state.view === 'chats' ? chatsViewHtml() : state.view === 'chat' ? chatViewHtml() : settingsViewHtml();
    }
    if (state.view === 'chat' && activeChat()) renderMessages();
    renderTopbar();
    renderTabbar();
  }

  function renderTabbar() {
    root.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.tab === state.view || (btn.dataset.tab === 'chats' && state.view === 'chat'));
    });
  }

  /* ------------------------------- Действия ------------------------------ */

  async function refreshChats() {
    try {
      const { chats } = await api.chatsList();
      const signature = JSON.stringify(chats);
      if (signature === state.chatsSignature) return;
      state.chatsSignature = signature;
      state.chats = chats;
      if (state.view === 'chats') renderChatListOnly();
      else if (state.view === 'chat') renderTopbar();
    } catch {
      /* тихий ретрай */
    }
  }

  async function loadMessages() {
    if (!state.activeChatId) return;
    try {
      const { messages } = await api.messagesList({ chatId: state.activeChatId });
      state.messages = messages;
      state.messagesSignature = JSON.stringify(messages);
      renderMessages(true);
      await api.messagesRead({ chatId: state.activeChatId });
    } catch (error) {
      toast(error.message || 'Не удалось загрузить сообщения', 'error');
    }
  }

  async function openChat(id) {
    state.activeChatId = id;
    state.view = 'chat';
    state.replyTo = null;
    state.messages = [];
    renderContent();
    await loadMessages();
  }

  async function sendMessage() {
    const input = $('#message-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text || !state.activeChatId) return;
    input.value = '';
    input.style.height = '';
    try {
      const { message } = await api.messagesSend({
        chatId: state.activeChatId,
        text,
        replyTo: state.replyTo?.id,
      });
      state.replyTo = null;
      if (!state.messages.some((item) => item.id === message.id)) state.messages.push(message);
      state.messagesSignature = JSON.stringify(state.messages);
      renderMessages(true);
      refreshChats();
    } catch (error) {
      input.value = text;
      toast(error.message || 'Не удалось отправить сообщение', 'error');
    }
  }

  async function react(messageId, emoji) {
    if (!REACTIONS.includes(emoji)) return;
    try {
      const { message } = await api.messagesReact({ chatId: state.activeChatId, messageId, emoji });
      const index = state.messages.findIndex((item) => item.id === message.id);
      if (index >= 0) state.messages[index] = message;
      state.messagesSignature = JSON.stringify(state.messages);
      renderMessages();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function openMessageActions(messageId) {
    const message = state.messages.find((item) => item.id === messageId);
    if (!message || message.kind === 'system') return;
    openModal({
      title: 'Сообщение',
      subtitle: message.senderName,
      content: `
        <p class="message-quote">${escapeHtml(message.deleted ? 'Сообщение удалено' : message.text)}</p>
        <div class="reaction-picker">${REACTIONS.map((emoji) => `<button data-quick-react="${emoji}">${emoji}</button>`).join('')}</div>
        <div class="action-list">
          <button data-message-action="reply">${icon('reply', 18)} Ответить</button>
          <button data-message-action="copy">${icon('copy', 18)} Скопировать текст</button>
          ${message.senderId === state.user.id && !message.deleted ? `<button class="is-danger" data-message-action="delete">${icon('trash', 18)} Удалить</button>` : ''}
        </div>
      `,
      onMount(overlay, close) {
        overlay.querySelectorAll('[data-quick-react]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            close();
            await react(messageId, btn.dataset.quickReact);
          });
        });
        overlay.querySelectorAll('[data-message-action]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const action = btn.dataset.messageAction;
            close();
            if (action === 'reply') {
              state.replyTo = { id: message.id, senderName: message.senderName, text: message.deleted ? 'Сообщение удалено' : message.text };
              renderContent();
              $('#message-input')?.focus();
            }
            if (action === 'copy') copyText(message.text, 'Текст скопирован');
            if (action === 'delete') {
              if (!(await confirmDialog('Удалить сообщение у всех участников чата?', 'Удалить сообщение'))) return;
              try {
                const { message: deleted } = await api.messagesDelete({ chatId: state.activeChatId, messageId });
                const index = state.messages.findIndex((item) => item.id === deleted.id);
                if (index >= 0) state.messages[index] = deleted;
                renderMessages();
                toast('Сообщение удалено', 'info');
              } catch (error) {
                toast(error.message, 'error');
              }
            }
          });
        });
      },
    });
  }

  function openChatMenu() {
    const chat = activeChat();
    if (!chat) return;
    openModal({
      title: chat.name,
      subtitle: chat.type === 'direct' ? 'Личный чат' : `${chat.participants.length} участников`,
      content: `
        <form class="card" id="chat-rename-form">
          <label class="field"><span>Название чата</span><input id="chat-rename-input" value="${escapeHtml(chat.name)}" maxlength="60" /></label>
          <button class="btn btn--primary btn--block" type="submit">Сохранить название</button>
        </form>
        <button class="btn btn--danger btn--block" data-leave-chat>${icon('back', 17)} Покинуть чат</button>
      `,
      onMount(overlay, close) {
        overlay.querySelector('#chat-rename-form').addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            await api.chatUpdate({ chatId: chat.id, name: overlay.querySelector('#chat-rename-input').value });
            close();
            state.chatsSignature = '';
            await refreshChats();
            renderTopbar();
            toast('Название обновлено', 'success');
          } catch (error) {
            toast(error.message, 'error');
          }
        });
        overlay.querySelector('[data-leave-chat]').addEventListener('click', async () => {
          close();
          if (!(await confirmDialog('Покинуть чат? Приглашение понадобится снова.', 'Покинуть чат', 'Покинуть'))) return;
          try {
            await api.chatLeave({ chatId: chat.id });
            state.activeChatId = null;
            state.view = 'chats';
            state.chatsSignature = '';
            await refreshChats();
            renderContent();
            toast('Вы покинули чат', 'info');
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      },
    });
  }

  async function loadInvites() {
    try {
      const { invites } = await api.inviteList();
      state.invites = invites;
      if (state.view === 'settings' && state.settingsTab === 'invites') renderContent();
    } catch (error) {
      toast(error.message || 'Не удалось загрузить приглашения', 'error');
    }
  }

  function inviteLink(code) {
    return `${location.origin}${location.pathname}?invite=${encodeURIComponent(code)}`;
  }

  function openInstallModal() {
    const steps = {
      android: [
        ['Откройте сайт в Chrome', 'Dvis должен быть открыт именно в Chrome.'],
        ['Нажмите меню ⋮', 'В правом верхнем углу браузера.'],
        ['«Установить приложение»', 'Или «Добавить на главный экран».'],
        ['Подтвердите', 'Иконка Dvis появится на экране Домой.'],
      ],
      ios: [
        ['Откройте сайт в Safari', 'На iPhone установка работает через Safari.'],
        ['Нажмите «Поделиться»', 'Квадрат со стрелкой вверх внизу экрана.'],
        ['«На экран «Домой»»', 'Прокрутите список действий вниз.'],
        ['«Добавить»', 'Dvis сохранится как обычное приложение.'],
      ],
    };
    let tab = 'android';
    openModal({
      title: 'Dvis как приложение',
      subtitle: 'Добавьте на экран Домой',
      content: `
        <div class="segmented segmented--inner">
          <button class="install-tab is-active" data-install-tab="android">Android</button>
          <button class="install-tab" data-install-tab="ios">iOS</button>
        </div>
        <ol class="install-steps" id="install-steps"></ol>
        ${state.installPrompt ? `<button class="btn btn--primary btn--block" id="pwa-install">${icon('download', 17)} Установить сейчас</button>` : ''}
      `,
      onMount(overlay, close) {
        const renderSteps = () => {
          overlay.querySelector('#install-steps').innerHTML = steps[tab]
            .map(([title, text], index) => `<li><span>${index + 1}</span><div><strong>${title}</strong><p>${text}</p></div></li>`)
            .join('');
          overlay.querySelectorAll('[data-install-tab]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.installTab === tab));
        };
        renderSteps();
        overlay.querySelectorAll('[data-install-tab]').forEach((btn) => {
          btn.addEventListener('click', () => { tab = btn.dataset.installTab; renderSteps(); });
        });
        overlay.querySelector('#pwa-install')?.addEventListener('click', async () => {
          state.installPrompt.prompt?.();
          await state.installPrompt.userChoice?.catch(() => {});
          state.installPrompt = null;
          close();
        });
      },
    });
  }

  async function handleInviteFromUrl() {
    const code = new URLSearchParams(location.search).get('invite');
    if (!code) return;
    history.replaceState({}, '', location.pathname);
    try {
      const { chat } = await api.inviteJoin({ code });
      state.chatsSignature = '';
      await refreshChats();
      state.activeChatId = chat.id;
      toast('Вы вошли в чат по приглашению', 'success');
      await openChat(chat.id);
    } catch (error) {
      state.settingsTab = 'invites';
      state.inviteTab = 'join';
      state.view = 'settings';
      renderContent();
      const input = $('#join-code');
      if (input) input.value = code;
      toast(error.message || 'Не удалось использовать приглашение', 'error');
    }
  }

  /* ------------------------------- События ------------------------------- */

  root.addEventListener('click', async (event) => {
    const target = event.target;

    if (target.closest('[data-tab]')) {
      const tab = target.closest('[data-tab]').dataset.tab;
      state.view = tab;
      if (tab === 'settings' && state.settingsTab === 'invites') loadInvites();
      renderContent();
      return;
    }
    if (target.closest('[data-new-invite]')) {
      state.view = 'settings';
      state.settingsTab = 'invites';
      state.inviteTab = 'create';
      renderContent();
      loadInvites();
      return;
    }
    if (target.closest('[data-back]')) {
      state.view = 'chats';
      renderContent();
      return;
    }
    if (target.closest('[data-settings-tab]')) {
      state.settingsTab = target.closest('[data-settings-tab]').dataset.settingsTab;
      if (state.settingsTab === 'invites') loadInvites();
      renderContent();
      return;
    }
    if (target.closest('[data-invite-tab]')) {
      state.inviteTab = target.closest('[data-invite-tab]').dataset.inviteTab;
      renderContent();
      return;
    }
    if (target.closest('[data-call]')) return startOutgoingCall();
    if (target.closest('[data-call-answer]')) return acceptIncomingCall();
    if (target.closest('[data-call-decline]')) return declineIncomingCall();
    if (target.closest('[data-call-end]')) return endCall();
    if (target.closest('[data-call-mute]')) {
      const muted = state.callSession?.toggleMute();
      toast(muted ? 'Микрофон выключен' : 'Микрофон включён', 'info');
      renderCallLayer();
      return;
    }
    const chatButton = target.closest('[data-chat-id]');
    if (chatButton) return openChat(chatButton.dataset.chatId);
    if (target.closest('[data-chat-menu]')) return openChatMenu();
    if (target.closest('[data-cancel-reply]')) {
      state.replyTo = null;
      renderContent();
      return;
    }
    if (target.closest('#emoji-button')) {
      $('#emoji-strip')?.classList.toggle('is-hidden');
      return;
    }
    const emojiButton = target.closest('[data-emoji]');
    if (emojiButton) {
      const input = $('#message-input');
      input.value += emojiButton.dataset.emoji;
      input.focus();
      $('#emoji-strip')?.classList.add('is-hidden');
      return;
    }
    const reactButton = target.closest('[data-react]');
    if (reactButton) return react(reactButton.dataset.messageId, reactButton.dataset.react);
    const actionTarget = target.closest('[data-open-actions]');
    if (actionTarget) return openMessageActions(actionTarget.dataset.openActions);
    if (target.closest('[data-copy-key]')) return copyText(getSavedKey(), 'Ключ скопирован');
    if (target.closest('[data-toggle-key]')) {
      state.keyRevealed = !state.keyRevealed;
      renderContent();
      return;
    }
    const copyInvite = target.closest('[data-copy-invite]');
    if (copyInvite) return copyText(copyInvite.dataset.copyInvite, 'Код скопирован');
    const shareInvite = target.closest('[data-share-invite]');
    if (shareInvite) {
      const code = shareInvite.dataset.shareInvite;
      if (navigator.share) {
        try { await navigator.share({ title: 'Dvis', text: `Приглашение в Dvis: ${code}`, url: inviteLink(code) }); } catch { /* отмена */ }
      } else copyText(inviteLink(code), 'Ссылка скопирована');
      return;
    }
    const revokeInvite = target.closest('[data-revoke-invite]');
    if (revokeInvite) {
      if (!(await confirmDialog('Отозвать этот код приглашения?', 'Отозвать приглашение', 'Отозвать'))) return;
      try {
        await api.inviteRevoke({ code: revokeInvite.dataset.revokeInvite });
        if (state.lastInvite?.code === revokeInvite.dataset.revokeInvite) state.lastInvite = null;
        await loadInvites();
        toast('Приглашение отозвано', 'info');
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }
    if (target.closest('[data-install]')) return openInstallModal();
    if (target.closest('[data-logout]')) {
      if (!(await confirmDialog('Выйти из аккаунта? Ключ останется в браузере.', 'Выйти', 'Выйти'))) return;
      await api.logout();
      onLogout();
    }
  });

  root.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.id === 'composer-form') return sendMessage();

    if (form.id === 'profile-form') {
      try {
        const { user: updated } = await api.profileUpdate({ name: form.querySelector('#profile-name').value });
        state.user = updated;
        toast('Имя сохранено', 'success');
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    if (form.id === 'invite-create-form') {
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const result = await api.inviteCreate({
          name: form.querySelector('#invite-name').value,
          reusable: form.querySelector('#invite-reusable').checked,
        });
        state.lastInvite = result.invite;
        state.chatsSignature = '';
        await Promise.all([loadInvites(), refreshChats()]);
        renderContent();
        toast('Код приглашения создан', 'success');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        btn.disabled = false;
      }
      return;
    }

    if (form.id === 'invite-join-form') {
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const { chat } = await api.inviteJoin({ code: form.querySelector('#join-code').value });
        state.chatsSignature = '';
        await refreshChats();
        await openChat(chat.id);
        toast('Вы вошли в чат', 'success');
      } catch (error) {
        toast(error.message, 'error');
        btn.disabled = false;
      }
    }
  });

  root.addEventListener('input', (event) => {
    if (event.target.id === 'chat-search') {
      state.search = event.target.value;
      renderChatListOnly();
    }
    if (event.target.id === 'message-input') {
      event.target.style.height = 'auto';
      event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
    }
  });

  root.addEventListener('keydown', (event) => {
    if (event.target.id === 'message-input' && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
    if (event.key === 'Escape' && state.view === 'chat') {
      state.view = 'chats';
      renderContent();
    }
  });

  /* ------------------------------- Запуск -------------------------------- */

  const offDemoMode = api.onDemoMode(() => toast('Сервер не найден — работает локальный режим Dvis', 'info', 4500));
  state.installPrompt = window.__dvisInstallPrompt || null;

  renderContent();
  refreshChats();
  handleInviteFromUrl();

  state.pollTimer = setInterval(async () => {
    if (document.hidden) return;
    await refreshChats();
    if (state.view !== 'chat' || !state.activeChatId) return;
    try {
      const { messages } = await api.messagesList({ chatId: state.activeChatId });
      const signature = JSON.stringify(messages);
      if (signature !== state.messagesSignature) {
        state.messages = messages;
        state.messagesSignature = signature;
        renderMessages();
      }
      await api.messagesRead({ chatId: state.activeChatId });
    } catch {
      /* тихий ретрай */
    }
  }, 2200);

  pollCalls();
  state.callPollTimer = setInterval(() => {
    if (!document.hidden) pollCalls();
  }, 1300);

  let resizeTimer = null;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const next = isDesktopLayout();
      if (next === state.desktop) return;
      state.desktop = next;
      root.dataset.mode = next ? 'desktop' : 'mobile';
      renderContent();
    }, 160);
  };
  window.addEventListener('resize', onResize);

  return () => {
    clearInterval(state.pollTimer);
    clearInterval(state.callPollTimer);
    clearInterval(state.callTimer);
    clearTimeout(resizeTimer);
    window.removeEventListener('resize', onResize);
    state.callSession?.cleanup();
    offDemoMode();
    closeModal();
  };
}
