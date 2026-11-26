import { api } from '../lib/api.js';
import { confirmDialog, openModal, toast } from '../lib/ui.js';
import {
  applyTheme,
  avatarHtml,
  debounce,
  escapeHtml,
  formatChatTime,
  formatDateSeparator,
  formatSize,
  formatTime,
  getSettings,
  getStoredTheme,
  icon,
  relativeTime,
  saveSettings,
} from '../lib/utils.js';
import { formatDuration, prepareAvatar, prepareMusic } from '../lib/media.js';

const EMOJIS = ['😀','😂','🥰','😎','🤔','😴','🤝','👍','👎','🔥','✨','🎉','💙','💚','🙏','👀','🚀','💡','☕','🍕','🏔️','🎧','📎','✅'];
const AVATAR_COLORS = ['#0b7cff', '#8b5cf6', '#f97316', '#10b981', '#ef4444', '#06b6d4', '#ec4899', '#f59e0b'];
const AVATAR_EMOJIS = ['', '👥', '🚀', '🏔️', '🌴', '🎮', '📚', '☕'];
const ACCENT_COLORS = ['#0b7cff', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#10b981', '#06b6d4', '#f59e0b'];
const ROLE_LABELS = { owner: 'Владелец DviGram', admin: 'Администратор DviGram', moderator: 'Модератор DviGram' };
const isPrivileged = (user) => user && ['admin', 'owner'].includes(user.role);

function identityHtml(user, options = {}) {
  if (!user) return '';
  const color = /^#[0-9a-f]{6}$/i.test(user.customization?.nameColor || '') ? user.customization.nameColor : '';
  const prefix = user.prefix
    ? `<span class="identity-prefix" title="${escapeHtml(ROLE_LABELS[user.role] || user.prefix)}">${escapeHtml(user.prefix)}</span>`
    : '';
  const badges = (user.badges || []).slice(0, 6).map((badge) => `<span class="identity-badge">${escapeHtml(badge)}</span>`).join('');
  const verified = user.verified
    ? `<span class="identity-verified" data-verified="${escapeHtml(user.name)}" role="button" tabindex="0" title="Пользователь верифицирован DviGram">${icon('verified', options.small ? 13 : 15)}</span>`
    : '';
  const name = options.plain
    ? escapeHtml(user.name)
    : `<span ${color ? `style="color:${color}"` : ''}>${escapeHtml(user.name)}</span>`;
  return `${prefix}${name}${verified}${badges}`;
}

function senderIdentityHtml(message) {
  const fake = {
    name: message.senderName,
    prefix: message.senderPrefix,
    role: message.senderRole,
    badges: message.senderBadges,
    verified: message.senderVerified,
    customization: { nameColor: message.senderNameColor },
  };
  return identityHtml(fake, { plain: true, small: true });
}

function autoLink(text) {
  return escapeHtml(text)
    .replace(/\n/g, '<br>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

function insertAtCursor(input, value) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = `${input.value.slice(0, start)}${value}${input.value.slice(end)}`;
  const pos = start + value.length;
  input.setSelectionRange(pos, pos);
  input.focus();
}

export function renderApp(root, user, onLogout) {
  const state = {
    user,
    users: [],
    chats: [],
    activeChatId: null,
    messages: [],
    hasMore: false,
    filter: 'all',
    search: '',
    messageSearch: '',
    theme: getStoredTheme(),
    settings: getSettings(),
    mobileView: 'list',
    replyTo: null,
    editingId: null,
    pendingAttachment: null,
    loadingOlder: false,
    chatRequestId: 0,
    pollTimer: null,
    tutorialTimer: null,
    installPrompt: null,
    audio: null,
    playingMusicFor: null,
    musicLoading: false,
    lastFeedSignature: '',
  };

  let contextMenu = null;
  const $ = (selector) => root.querySelector(selector);
  const activeChat = () => state.chats.find((chat) => chat.id === state.activeChatId) || null;

  function findUserById(id) {
    if (!id) return null;
    if (id === state.user.id) return state.user;
    const known = state.users.find((user) => user.id === id);
    if (known) return known;
    const chat = activeChat();
    if (chat?.other?.id === id) return chat.other;
    return chat?.participants?.find((user) => user.id === id) || null;
  }

  function musicPlayerHtml(user, scope) {
    const playing = state.playingMusicFor === user.id;
    if (!user?.music?.hasMusic) {
      return `<button class="btn btn--soft btn--block" data-open-profile>${icon('music', 16)} Добавить музыку в профиль</button>`;
    }
    return `
      <div class="music-player ${playing ? 'is-playing' : ''}">
        <button class="music-player__btn" data-music-user="${user.id}" title="${playing ? 'Остановить' : 'Слушать'}">
          ${icon(playing ? 'stop' : 'play', 17)}
        </button>
        <div class="music-player__info">
          <strong>${escapeHtml(user.music.name || 'Музыка профиля')}</strong>
          <span>${scope === 'own' ? 'Ваша музыка' : escapeHtml(user.name || 'Профиль')} · ${playing ? 'играет' : 'пауза'}</span>
        </div>
        <span class="music-player__wave"><i></i><i></i><i></i><i></i></span>
      </div>
    `;
  }

  applyTheme(state.theme);

  root.innerHTML = `
    <div class="app-shell ${state.settings.compact ? 'is-compact' : ''}" id="app-shell">
      <div class="scene3d" aria-hidden="true">
        <span class="shape shape--orb"></span>
        <span class="shape shape--ring"></span>
        <span class="shape shape--cube"><i></i><i></i><i></i><i></i><i></i><i></i></span>
        <span class="shape shape--diamond"></span>
        <span class="shape shape--spark shape--spark-a"></span>
        <span class="shape shape--spark shape--spark-b"></span>
      </div>
      <aside class="sidebar" id="sidebar">
        <header class="sidebar__head">
          <span class="brand-mark" aria-label="DviGram">${icon('send', 18)}</span>
          <div class="sidebar__heading">
            <strong>DviGram</strong>
            <span id="sidebar-status">в сети</span>
          </div>
          <div class="sidebar__head-actions">
            <button class="icon-btn" id="theme-toggle" title="Сменить тему">${icon(state.theme === 'dark' ? 'sun' : 'moon', 19)}</button>
            <button class="icon-btn" id="install-button" title="Установить как приложение">${icon('download', 19)}</button>
            <button class="icon-btn" id="store-button" title="Магазин DviGram">${icon('store', 19)}</button>
            <button class="icon-btn icon-btn--accent" id="new-chat" title="Новый чат">${icon('plus', 20)}</button>
          </div>
        </header>

        <button class="balance-chip" id="balance-chip" title="Ваш баланс DVC">
          ${icon('wallet', 16)} <strong id="balance-value">${state.user.balance || 0}</strong> DVC
          <span class="balance-chip__action">${icon('gift', 15)} Подарки</span>
        </button>

        <div class="sidebar__search">
          ${icon('search', 18)}
          <input id="chat-search" type="search" placeholder="Поиск чатов" aria-label="Поиск чатов" />
          <kbd>Ctrl K</kbd>
        </div>

        <div class="filters" id="filters" role="tablist">
          <button class="filter is-active" data-filter="all" role="tab">Все</button>
          <button class="filter" data-filter="unread" role="tab">Непрочитанные</button>
          <button class="filter" data-filter="groups" role="tab">Группы и каналы</button>
        </div>

        <div class="chat-list" id="chat-list" aria-label="Список чатов"></div>

        <footer class="sidebar__footer" id="sidebar-footer"></footer>
      </aside>

      <main class="chat-area" id="chat-area">
        <section class="chat-empty" id="chat-empty">
          <div class="chat-empty__orb">${icon('send', 40)}</div>
          <h2>Выберите чат</h2>
          <p>Выберите общий канал, напишите кому-то лично или создайте новую группу.</p>
          <button class="btn btn--primary" id="empty-new-chat">${icon('plus', 18)} Новый чат</button>
        </section>

        <section class="chat-pane is-hidden" id="chat-pane">
          <header class="chat-header" id="chat-header"></header>
          <div class="message-search is-hidden" id="message-search-bar">
            ${icon('search', 16)}
            <input id="message-search-input" type="search" placeholder="Поиск по сообщениям" />
            <button class="icon-btn" id="close-message-search" aria-label="Закрыть поиск">${icon('close', 16)}</button>
          </div>
          <div class="messages" id="messages" tabindex="0"></div>
          <div class="composer-wrap">
            <div class="composer-preview is-hidden" id="composer-preview"></div>
            <form class="composer" id="composer">
              <button type="button" class="icon-btn" id="emoji-button" title="Эмодзи">${icon('emoji', 21)}</button>
              <button type="button" class="icon-btn" id="attach-button" title="Прикрепить файл">${icon('paperclip', 20)}</button>
              <input type="file" id="file-input" hidden />
              <textarea id="message-input" rows="1" placeholder="Напишите сообщение..." aria-label="Сообщение"></textarea>
              <button type="button" class="icon-btn" id="mic-button" title="Голосовое сообщение (демо)">${icon('mic', 20)}</button>
              <button type="submit" class="send-btn" title="Отправить">${icon('send', 19)}</button>
            </form>
            <div class="emoji-picker is-hidden" id="emoji-picker">
              ${EMOJIS.map((emoji) => `<button type="button" class="emoji-item" data-emoji="${emoji}">${emoji}</button>`).join('')}
            </div>
          </div>
        </section>
      </main>

      <aside class="details-panel" id="details-panel" aria-label="Информация"></aside>
      <button class="details-backdrop" id="details-backdrop" aria-label="Закрыть панель"></button>
    </div>
  `;

  // Футер с кнопками профиля/выхода должен существовать до навешивания обработчиков.
  renderSidebarFooter();
  applyCustomization();

  /* --------------------------------- Рендер -------------------------------- */

  function applyCustomization() {
    const shell = $('#app-shell');
    const c = state.user.customization || {};
    shell.style.setProperty('--accent', /^#[0-9a-f]{6}$/i.test(c.accent) ? c.accent : '#0b7cff');
    shell.style.setProperty('--chat-font-scale', Number(c.fontScale) || 1);
    shell.classList.toggle('bubble-soft', c.bubbleStyle === 'soft');
    shell.classList.toggle('bubble-glass', c.bubbleStyle === 'glass');
    shell.dataset.pattern = c.pattern || 'dots';
  }

  function renderSidebarFooter() {
    const footer = $('#sidebar-footer');
    if (!footer) return;
    footer.innerHTML = `
      ${avatarHtml(state.user, 38)}
      <div class="sidebar__footer-info">
        <strong>${identityHtml(state.user, { small: true })}</strong>
        <span>${state.user.premium ? '💎 Premium' : api.isDemo() ? 'демо-режим' : 'в сети'}</span>
      </div>
      <button class="icon-btn" id="footer-profile" title="Профиль и кастомизация">${icon('palette', 18)}</button>
      ${isPrivileged(state.user) ? `<button class="icon-btn icon-btn--danger" id="footer-admin" title="Панель администратора">${icon('shield', 18)}</button>` : ''}
      <button class="icon-btn" id="footer-logout" title="Выйти">${icon('logout', 18)}</button>
    `;
    const balance = $('#balance-value');
    if (balance) balance.textContent = String(state.user.balance || 0);
  }

  function renderChatList() {
    const query = state.search.trim().toLowerCase();
    const chats = state.chats.filter((chat) => {
      if (state.filter === 'unread' && !chat.unread) return false;
      if (state.filter === 'groups' && !['group', 'channel'].includes(chat.type)) return false;
      if (!query) return true;
      return `${chat.name} ${chat.lastMessage?.text || ''}`.toLowerCase().includes(query);
    });

    $('#chat-list').innerHTML = chats.length
      ? chats.map((chat) => {
          const last = chat.lastMessage;
          const groupish = chat.type === 'group' || chat.type === 'channel';
          const prefix = groupish && last && last.senderId !== state.user.id
            ? `${escapeHtml((last.senderName || '').split(' ')[0])}: `
            : last && last.senderId === state.user.id ? 'Вы: ' : '';
          const text = last ? prefix + autoLink(last.text) : 'Начните общение';
          const titleUser = chat.type === 'direct' ? chat.other : null;
          const typeIcon = chat.type === 'channel' ? icon('megaphone', 13) : chat.type === 'group' ? icon('users', 13) : '';
          return `
            <button class="chat-item ${chat.id === state.activeChatId ? 'is-active' : ''} ${chat.pinned ? 'is-pinned' : ''}"
              data-chat-id="${chat.id}" ${chat.unread ? 'data-has-unread="true"' : ''}>
              ${avatarHtml({ ...chat, online: chat.online }, 52)}
              <span class="chat-item__body">
                <span class="chat-item__top">
                  <strong>${typeIcon}${titleUser ? identityHtml(titleUser, { small: true }) : escapeHtml(chat.name)}</strong>
                  <time>${formatChatTime(last?.createdAt || chat.updatedAt)}</time>
                </span>
                <span class="chat-item__bottom">
                  <span class="chat-item__text">${chat.muted ? icon('mute', 14) : ''}${text}</span>
                  ${chat.unread ? `<span class="unread-badge">${chat.unread > 99 ? '99+' : chat.unread}</span>` : ''}
                </span>
              </span>
              <span class="chat-item__menu" data-chat-menu="${chat.id}" role="button" tabindex="0">${icon('more', 17)}</span>
            </button>
          `;
        }).join('')
      : `<div class="list-empty">${icon(state.filter === 'unread' ? 'check' : 'search', 28)}<p>Ничего не найдено</p></div>`;
  }

  function renderChatHeader() {
    const chat = activeChat();
    if (!chat) return;
    const directUser = chat.type === 'direct' ? chat.other : null;
    const typeLabel = chat.type === 'channel' ? '📢 Канал' : chat.type === 'group' ? '👥 Группа' : '';
    $('#chat-header').innerHTML = `
      <button class="icon-btn mobile-back" id="mobile-back" aria-label="Назад">${icon('back', 21)}</button>
      ${avatarHtml({ ...chat, online: chat.online }, 42)}
      <div class="chat-header__info">
        <strong>${directUser ? identityHtml(directUser, { small: true }) : escapeHtml(chat.name)}</strong>
        <span>${chat.type === 'group' || chat.type === 'channel'
          ? `${typeLabel} · ${chat.participants.length} участника`
          : directUser?.status ? escapeHtml(directUser.status) : chat.online ? 'в сети' : relativeTime(directUser?.lastSeen)}</span>
      </div>
      <div class="chat-header__actions">
        ${directUser?.music?.hasMusic ? `<button class="icon-btn music-toggle ${state.playingMusicFor === directUser.id ? 'is-playing' : ''}" data-music-user="${directUser.id}" title="Музыка профиля">${icon(state.playingMusicFor === directUser.id ? 'stop' : 'music', 19)}</button>` : ''}
        <button class="icon-btn" data-chat-action="search" title="Поиск по сообщениям">${icon('search', 19)}</button>
        <button class="icon-btn desktop-only" data-chat-action="call" title="Звонок (демо)">${icon('phone', 19)}</button>
        <button class="icon-btn desktop-only" data-chat-action="video" title="Видеозвонок (демо)">${icon('video', 20)}</button>
        <button class="icon-btn" data-chat-action="details" title="Информация">${icon('info', 20)}</button>
      </div>
    `;
  }

  function messageHtml(message, index, list) {
    if (message.kind === 'system') {
      return `<div class="system-message" data-message-id="${message.id}">${escapeHtml(message.text)}</div>`;
    }

    const own = message.senderId === state.user.id;
    const showAvatar = !own && (index === 0 || list[index - 1]?.senderId !== message.senderId);
    const showName = activeChat()?.type === 'group' && !own;
    const read = own && activeChat()?.participantIds
      .filter((id) => id !== state.user.id)
      .every((id) => message.readBy?.includes(id));
    const reactions = Object.entries(message.reactions || {}).map(([emoji, ids]) => `
      <button class="reaction ${ids.includes(state.user.id) ? 'is-mine' : ''}" data-react="${emoji}" data-message-id="${message.id}">
        ${emoji}<span>${ids.length}</span>
      </button>
    `).join('');

    const privilege = ROLE_LABELS[message.senderRole] ? `<span class="sender-role" title="${escapeHtml(ROLE_LABELS[message.senderRole])}">${message.senderRole === 'owner' ? '👑' : message.senderRole === 'admin' ? '🛡️' : '🛡'}</span>` : '';
    return `
      <article class="message-row ${own ? 'is-own' : ''} ${showAvatar ? 'has-avatar' : ''} ${message.senderPremium ? 'is-premium' : ''}" data-message-id="${message.id}">
        ${!own ? `<span class="message-row__avatar">${showAvatar ? avatarHtml({ name: message.senderName, avatar: message.senderAvatar }, 30) : ''}</span>` : ''}
        <div class="message-bubble">
          ${showName ? `<span class="message-sender" style="color:${message.senderNameColor && /^#[0-9a-f]{6}$/i.test(message.senderNameColor) ? message.senderNameColor : message.senderAvatar?.color || '#0b7cff'}">${senderIdentityHtml(message)}${privilege}</span>` : ''}
          ${message.replyTo ? `
            <div class="message-reply">
              <strong>${escapeHtml(message.replyTo.senderName)}</strong>
              <span>${escapeHtml(message.replyTo.text)}</span>
            </div>
          ` : ''}
          ${message.attachment ? `
            <div class="file-card">
              <span class="file-card__icon">${icon('file', 22)}</span>
              <div><strong>${escapeHtml(message.attachment.name)}</strong><span>${formatSize(message.attachment.size)}</span></div>
            </div>
          ` : ''}
          ${message.gift ? `
            <div class="gift-card" style="--gift-color:${/^#[0-9a-f]{6}$/i.test(message.gift.color) ? message.gift.color : '#f59e0b'}">
              <span class="gift-card__emoji">${escapeHtml(message.gift.emoji)}</span>
              <div><small>NFT-ПОДАРОК · ${escapeHtml(message.gift.rarity)}</small><strong>${escapeHtml(message.gift.name)}</strong><span>от ${escapeHtml(message.gift.fromName)} · #${escapeHtml(message.gift.uid.slice(-6))}</span></div>
            </div>
          ` : ''}
          ${message.text ? `<div class="message-text">${autoLink(message.text)}</div>` : ''}
          <footer class="message-meta">
            <time>${formatTime(message.createdAt)}</time>
            ${own ? `<span class="read-state ${read ? 'is-read' : ''}">${icon(read ? 'checks' : 'check', 15)}</span>` : ''}
            ${message.editedAt ? '<span class="edited">изм.</span>' : ''}
          </footer>
          ${reactions ? `<div class="reactions">${reactions}</div>` : ''}
          <button class="message-menu-btn" data-message-menu="${message.id}" aria-label="Действия">${icon('more', 15)}</button>
        </div>
      </article>
    `;
  }

  function renderMessages() {
    const container = $('#messages');
    const query = state.messageSearch.trim().toLowerCase();
    const list = query
      ? state.messages.filter((message) => String(message.text || '').toLowerCase().includes(query))
      : state.messages;

    if (!list.length) {
      container.innerHTML = `
        <div class="messages-empty">${icon(query ? 'search' : 'send', 32)}
          <p>${query ? 'Сообщения не найдены' : 'Это начало вашей переписки'}</p>
        </div>`;
      return;
    }

    let html = state.hasMore && !query
      ? `<button class="load-more" id="load-more">${icon('arrowDown', 16)} Загрузить предыдущие</button>`
      : '';
    html += list.map((message, index) => {
      const prev = list[index - 1];
      const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
      return `${newDay ? `<div class="date-separator"><span>${formatDateSeparator(message.createdAt)}</span></div>` : ''}${messageHtml(message, index, list)}`;
    }).join('');
    container.innerHTML = html;
  }

  function renderComposerPreview() {
    const box = $('#composer-preview');
    const parts = [];
    if (state.replyTo) {
      parts.push(`
        <span class="preview-tag">${icon('reply', 14)} Ответ ${escapeHtml(state.replyTo.senderName)}</span>
        <span class="preview-text">${escapeHtml(state.replyTo.text)}</span>
        <button class="icon-btn" data-clear-reply title="Отменить ответ">${icon('close', 15)}</button>
      `);
    }
    if (state.editingId) {
      parts.push(`
        <span class="preview-tag">${icon('edit', 14)} Редактирование</span>
        <button class="icon-btn" data-clear-edit title="Отменить">${icon('close', 15)}</button>
      `);
    }
    if (state.pendingAttachment) {
      parts.push(`
        <span class="preview-tag">${icon('file', 14)} ${escapeHtml(state.pendingAttachment.name)} · ${formatSize(state.pendingAttachment.size)}</span>
        <button class="icon-btn" data-clear-attachment title="Убрать файл">${icon('close', 15)}</button>
      `);
    }
    box.innerHTML = parts.join('');
    box.classList.toggle('is-hidden', !parts.length);
  }

  function renderDetails() {
    const chat = activeChat();
    const panel = $('#details-panel');
    const themeButtons = ['light', 'dark', 'system'].map((value) => `
      <button class="segment ${state.theme === value ? 'is-active' : ''}" data-theme-value="${value}">
        ${value === 'light' ? 'Светлая' : value === 'dark' ? 'Тёмная' : 'Системная'}
      </button>
    `).join('');

    if (!chat) {
      const role = ROLE_LABELS[state.user.role];
      panel.innerHTML = `
        <div class="details-inner">
          <div class="details-profile">
            ${avatarHtml(state.user, 84)}
            <h3>${identityHtml(state.user)}</h3>
            <p>@${escapeHtml(state.user.login)}${role ? ` · ${role}` : ''}</p>
            <span class="status-pill">${state.user.premium ? '💎 Premium' : 'в сети'}</span>
            ${state.user.status ? `<p class="profile-status">${escapeHtml(state.user.status)}</p>` : ''}
          </div>
          <div class="details-section">
            <h4>Музыка профиля</h4>
            ${musicPlayerHtml(state.user, 'own')}
          </div>
          <div class="details-section">
            <h4>Кошелёк · ${state.user.balance || 0} DVC</h4>
            <div class="quick-actions">
              <button class="quick-action" data-open-store>${icon('store', 18)} Магазин</button>
              <button class="quick-action" data-open-gifts>${icon('gift', 18)} Подарки</button>
              <button class="quick-action" data-open-customize>${icon('palette', 18)} Кастомизация</button>
              ${isPrivileged(state.user) ? `<button class="quick-action quick-action--danger" data-open-admin>${icon('shield', 18)} Админка</button>` : ''}
            </div>
          </div>
          ${(state.user.gifts || []).length ? `
            <div class="details-section">
              <h4>Полученные NFT · ${state.user.giftCount || state.user.gifts.length}</h4>
              <div class="gift-shelf">
                ${state.user.gifts.slice(-6).reverse().map((gift) => `<span class="gift-shelf__item" style="--gift-color:${/^#[0-9a-f]{6}$/i.test(gift.color) ? gift.color : '#f59e0b'}" title="${escapeHtml(gift.name)} от ${escapeHtml(gift.fromName)}">${escapeHtml(gift.emoji)}</span>`).join('')}
              </div>
            </div>
          ` : ''}
          <div class="details-section">
            <h4>О себе</h4>
            <p class="details-bio">${escapeHtml(state.user.bio || 'Добавьте короткое описание в профиле')}</p>
            <button class="btn btn--soft btn--block" data-open-profile>${icon('edit', 16)} Редактировать профиль</button>
          </div>
          <div class="details-section">
            <h4>Настройки</h4>
            <div class="segmented">${themeButtons}</div>
            <label class="switch-row"><span>${icon('bell', 16)} Уведомления</span><input type="checkbox" data-setting="notifications" ${state.settings.notifications ? 'checked' : ''}><i></i></label>
            <label class="switch-row"><span>${icon('grid', 16)} Компактный режим</span><input type="checkbox" data-setting="compact" ${state.settings.compact ? 'checked' : ''}><i></i></label>
            <label class="switch-row"><span>${icon('send', 16)} Enter отправляет</span><input type="checkbox" data-setting="enterToSend" ${state.settings.enterToSend ? 'checked' : ''}><i></i></label>
          </div>
          <div class="details-section">
            <button class="quick-action quick-action--install" data-open-install>${icon('smartphone', 18)} Как сделать приложение на телефоне</button>
          </div>
          <div class="details-section details-hint">
            ${icon('sparkles', 18)}
            <p>Совет: нажмите <kbd>Ctrl</kbd> + <kbd>K</kbd> для быстрого поиска чата.</p>
          </div>
        </div>
      `;
      return;
    }

    const media = state.messages.filter((message) => message.attachment).slice(0, 6);
    panel.innerHTML = `
      <div class="details-inner">
        <div class="details-profile">
          ${avatarHtml({ ...chat, online: chat.online }, 84)}
          <h3>${chat.other ? identityHtml(chat.other) : escapeHtml(chat.name)}</h3>
          <p>${chat.type === 'group' || chat.type === 'channel' ? `${chat.participants.length} участника` : chat.online ? 'в сети' : 'не в сети'}</p>
          ${chat.other?.status ? `<p class="profile-status">${escapeHtml(chat.other.status)}</p>` : ''}
        </div>
        ${chat.other?.music?.hasMusic ? `
          <div class="details-section">
            <h4>Музыка собеседника</h4>
            ${musicPlayerHtml(chat.other, 'other')}
          </div>
        ` : ''}
        <div class="details-actions">
          <button class="icon-btn" data-chat-action="mute" title="Без звука">${icon(chat.muted ? 'mute' : 'bell', 18)}</button>
          <button class="icon-btn" data-chat-action="pin" title="Закрепить">${icon('pin', 18)}</button>
          <button class="icon-btn" data-chat-action="search" title="Поиск">${icon('search', 18)}</button>
        </div>
        ${chat.type === 'group' ? `
          <div class="details-section">
            <h4>Участники · ${chat.participants.length}</h4>
            <div class="member-list">
              ${chat.participants.map((member) => `
                <div class="member">${avatarHtml(member, 34)}<div><strong>${identityHtml(member, { small: true })}</strong><span>${member.online ? 'в сети' : relativeTime(member.lastSeen)}</span></div></div>
              `).join('')}
            </div>
          </div>
        ` : ''}
        <div class="details-section">
          <h4>Файлы · ${media.length}</h4>
          <div class="media-grid">
            ${media.length ? media.map((message) => `
              <button class="media-tile" title="${escapeHtml(message.attachment.name)}">${icon('file', 22)}<span>${escapeHtml(message.attachment.name.slice(0, 14))}</span></button>
            `).join('') : '<p class="details-bio">Пока нет вложений</p>'}
          </div>
        </div>
        <div class="details-section">
          <h4>Тема интерфейса</h4>
          <div class="segmented">${themeButtons}</div>
          <label class="switch-row"><span>${icon('bell', 16)} Уведомления</span><input type="checkbox" data-setting="notifications" ${state.settings.notifications ? 'checked' : ''}><i></i></label>
          <label class="switch-row"><span>${icon('grid', 16)} Компактный режим</span><input type="checkbox" data-setting="compact" ${state.settings.compact ? 'checked' : ''}><i></i></label>
        </div>
        <div class="details-section">
          <button class="quick-action quick-action--install" data-open-install>${icon('smartphone', 18)} Приложение на экран Домой</button>
        </div>
      </div>
    `;
  }

  function renderAll() {
    renderChatHeader();
    renderChatList();
    renderDetails();
    renderComposerPreview();
    if (state.activeChatId) {
      $('#chat-pane').classList.remove('is-hidden');
      $('#chat-empty').classList.add('is-hidden');
    } else {
      $('#chat-pane').classList.add('is-hidden');
      $('#chat-empty').classList.remove('is-hidden');
    }
    $('#app-shell').classList.toggle('is-compact', state.settings.compact);
    $('#app-shell').classList.toggle('mobile-chat-open', state.mobileView === 'chat');
  }

  /* -------------------------------- Действия -------------------------------- */

  async function loadInitial() {
    try {
      const [chatsRes, contactsRes] = await Promise.all([api.chats(), api.contacts()]);
      state.chats = chatsRes.chats;
      state.users = contactsRes.users;
      renderChatList();
      renderSidebarFooter();
      renderDetails();
    } catch (error) {
      toast(error.message || 'Не удалось загрузить чаты', 'error');
    }
  }

  function scrollToBottom(smooth = false) {
    const container = $('#messages');
    container.scrollTo({ top: container.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  async function loadMessages({ older = false } = {}) {
    const chatId = state.activeChatId;
    if (!chatId) return;
    const requestId = state.chatRequestId;
    const container = $('#messages');
    const previousHeight = container.scrollHeight;

    try {
      const data = await api.messages({ chatId, before: older ? state.messages[0]?.id : undefined });
      if (requestId !== state.chatRequestId || state.activeChatId !== chatId) return;
      state.messages = older ? [...data.messages, ...state.messages] : data.messages;
      state.hasMore = data.hasMore;
      renderMessages();
      if (older) container.scrollTop += container.scrollHeight - previousHeight;
      else scrollToBottom();
    } catch (error) {
      toast(error.message || 'Не удалось загрузить сообщения', 'error');
    }
  }

  async function selectChat(id) {
    if (!id) return;
    state.activeChatId = id;
    state.chatRequestId += 1;
    state.mobileView = 'chat';
    state.replyTo = null;
    state.editingId = null;
    state.pendingAttachment = null;
    state.messageSearch = '';
    $('#message-search-input').value = '';
    $('#message-search-bar').classList.add('is-hidden');
    $('#emoji-picker').classList.add('is-hidden');
    $('#message-input').value = '';
    $('#app-shell').classList.remove('details-open');
    renderAll();
    $('#messages').innerHTML = '<div class="messages-empty">Загрузка...</div>';
    await loadMessages();
    try {
      await api.messagesRead({ chatId: id });
      const chat = state.chats.find((item) => item.id === id);
      if (chat) chat.unread = 0;
      renderChatList();
    } catch {
      /* чтение не критично */
    }
    setTimeout(() => $('#message-input')?.focus(), 80);
  }

  async function refreshChats() {
    try {
      const [chatsRes, contactsRes] = await Promise.all([api.chats(), api.contacts()]);
      const signature = JSON.stringify([chatsRes.chats, contactsRes.users]);
      if (signature === state.lastFeedSignature) return;
      state.lastFeedSignature = signature;
      state.chats = chatsRes.chats;
      state.users = contactsRes.users;
      renderChatList();
      renderDetails();
    } catch {
      /* тихий ретрай на следующем тике */
    }
  }

  async function poll() {
    if (document.hidden) return;
    await refreshChats();
    if (!state.activeChatId) return;
    try {
      const data = await api.messages({ chatId: state.activeChatId });
      const incoming = data.messages.length !== state.messages.length ||
        data.messages.some((message, index) => message.id !== state.messages[index]?.id);
      if (incoming) {
        state.messages = data.messages;
        state.hasMore = data.hasMore;
        renderMessages();
      }
      const needsRead = state.chats.find((chat) => chat.id === state.activeChatId)?.unread > 0 ||
        state.messages.some((message) => message.senderId !== state.user.id && !message.readBy?.includes(state.user.id));
      if (needsRead) {
        await api.messagesRead({ chatId: state.activeChatId });
        const chat = state.chats.find((item) => item.id === state.activeChatId);
        if (chat) chat.unread = 0;
        renderChatList();
      }
    } catch {
      /* тихий ретрай */
    }
  }

  async function updateMessage(message) {
    const index = state.messages.findIndex((item) => item.id === message.id);
    if (index >= 0) state.messages[index] = message;
    renderMessages();
  }

  async function sendMessage() {
    const input = $('#message-input');
    const text = input.value.trim();
    const chatId = state.activeChatId;
    if (!chatId) return;

    if (state.editingId) {
      if (!text) return;
      try {
        const { message } = await api.messagesEdit({ chatId, messageId: state.editingId, text });
        state.editingId = null;
        input.value = '';
        autoResize();
        renderComposerPreview();
        await updateMessage(message);
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    if (!text && !state.pendingAttachment) return;
    try {
      const { message } = await api.messagesSend({
        chatId,
        text,
        attachment: state.pendingAttachment,
        replyTo: state.replyTo?.id,
      });
      state.messages.push(message);
      state.replyTo = null;
      state.pendingAttachment = null;
      input.value = '';
      autoResize();
      renderComposerPreview();
      renderMessages();
      scrollToBottom(true);
      refreshChats();
    } catch (error) {
      toast(error.message || 'Не удалось отправить сообщение', 'error');
    }
  }

  function autoResize() {
    const input = $('#message-input');
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  }

  function closeContextMenu() {
    contextMenu?.remove();
    contextMenu = null;
  }

  function showContextMenu(anchor, items) {
    closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = items.map((item) => `
      <button data-context-action="${item.action}" data-payload="${escapeHtml(item.payload || '')}" ${item.danger ? 'class="is-danger"' : ''}>
        ${icon(item.icon, 16)}<span>${escapeHtml(item.label)}</span>
      </button>
    `).join('');
    document.body.appendChild(menu);
    contextMenu = menu;
    const rect = anchor.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    menu.style.top = `${rect.bottom + height + 8 > window.innerHeight ? Math.max(8, rect.top - height - 6) : rect.bottom + 6}px`;

    menu.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-context-action]');
      if (!button) return;
      const action = button.dataset.contextAction;
      closeContextMenu();
      await handleContextAction(action, button.dataset.payload);
    });
  }

  async function handleContextAction(action, payload) {
    if (action.startsWith('react:')) {
      const [messageId, emoji] = [payload?.split('|')[0], action.slice(6)];
      try {
        const { message } = await api.messagesReact({ chatId: state.activeChatId, messageId, emoji });
        await updateMessage(message);
        burstReaction(messageId, emoji);
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }
    if (action === 'reply') {
      const message = state.messages.find((item) => item.id === payload);
      if (message) {
        state.replyTo = { id: message.id, senderName: message.senderName, text: message.text || 'Файл' };
        state.editingId = null;
        renderComposerPreview();
        $('#message-input').focus();
      }
      return;
    }
    if (action === 'copy') {
      const message = state.messages.find((item) => item.id === payload);
      if (message) {
        await navigator.clipboard?.writeText(message.text || '');
        toast('Скопировано', 'success');
      }
      return;
    }
    if (action === 'edit') {
      const message = state.messages.find((item) => item.id === payload);
      if (message) {
        state.editingId = message.id;
        state.replyTo = null;
        $('#message-input').value = message.text;
        autoResize();
        renderComposerPreview();
        $('#message-input').focus();
      }
      return;
    }
    if (action === 'delete') {
      const ok = await confirmDialog('Удалить это сообщение?', 'Удаление');
      if (!ok) return;
      try {
        await api.messagesDelete({ chatId: state.activeChatId, messageId: payload });
        const local = state.messages.find((item) => item.id === payload);
        if (local) {
          local.kind = 'system';
          local.text = 'Сообщение удалено';
          local.reactions = {};
          local.deleted = true;
        }
        renderMessages();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }
    if (action === 'pin' || action === 'mute') {
      const chat = action === 'pin' ? state.chats.find((item) => item.id === payload) : activeChat();
      if (!chat) return;
      try {
        const { chat: updated } = await api.chatsUpdate({
          chatId: chat.id,
          ...(action === 'pin' ? { pinned: !chat.pinned } : { muted: !chat.muted }),
        });
        const idx = state.chats.findIndex((item) => item.id === updated.id);
        if (idx >= 0) state.chats[idx] = updated;
        renderChatList();
        renderChatHeader();
        renderDetails();
        toast(action === 'pin' ? (updated.pinned ? 'Чат закреплён' : 'Чат откреплён') : (updated.muted ? 'Звук выключен' : 'Звук включён'), 'success');
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  }

  /* -------------------------------- Модальные -------------------------------- */

  function openNewChatModal() {
    let contactQuery = '';
    let selected = new Set();
    let tab = 'direct';

    openModal({
      title: 'Новый чат',
      subtitle: 'Выберите контакт или создайте группу',
      wide: true,
      content: `
        <div class="modal-tabs">
          <button class="modal-tab is-active" data-tab="direct">Личный чат</button>
          <button class="modal-tab" data-tab="group">Новая группа</button>
          <button class="modal-tab" data-tab="channel">Канал</button>
        </div>
        <div data-panel="direct">
          <div class="modal-search">${icon('search', 16)}<input id="contact-search" placeholder="Поиск по контактам" /></div>
          <div class="contact-list" id="contact-list"></div>
        </div>
        <div data-panel="group" class="is-hidden">
          <div class="field"><label>Название группы</label><div class="field__control"><input id="group-name" placeholder="Например, Поездка в горы" /></div></div>
          <div class="avatar-picker" id="group-emoji">
            ${AVATAR_EMOJIS.map((emoji, i) => `<button class="emoji-choice ${i === 1 ? 'is-active' : ''}" data-emoji-choice="${emoji}">${emoji || '👥'}</button>`).join('')}
          </div>
          <div class="modal-search">${icon('search', 16)}<input id="group-search" placeholder="Поиск участников" /></div>
          <div class="contact-list" id="group-contacts"></div>
          <button class="btn btn--primary btn--block" id="create-group">Создать группу</button>
        </div>
        <div data-panel="channel" class="is-hidden">
          <div class="field"><label>Название канала</label><div class="field__control"><input id="channel-name" placeholder="Например, Новости DviGram" /></div></div>
          <div class="field"><label>Описание</label><div class="field__control"><input id="channel-description" placeholder="Коротко о канале" /></div></div>
          <div class="avatar-picker" id="channel-emoji">
            ${['📢', '💬', '🔥', '📚', '🎮', '☕'].map((emoji, i) => `<button class="emoji-choice ${i === 0 ? 'is-active' : ''}" data-channel-emoji="${emoji}">${emoji}</button>`).join('')}
          </div>
          <button class="btn btn--primary btn--block" id="create-channel">Создать канал</button>
        </div>
      `,
      onMount(overlay, close) {
        let chosenEmoji = '👥';
        let chosenChannelEmoji = '📢';

        function contactHtml(user, withCheckbox) {
          return `
            <button class="contact-row ${selected.has(user.id) ? 'is-selected' : ''}" data-user-id="${user.id}">
              ${avatarHtml(user, 42)}
              <span><strong>${escapeHtml(user.name)}</strong><small>@${escapeHtml(user.login)} · ${user.online ? 'в сети' : relativeTime(user.lastSeen)}</small></span>
              ${withCheckbox ? `<span class="contact-check">${selected.has(user.id) ? icon('check', 14) : ''}</span>` : icon('chevronRight', 17)}
            </button>
          `;
        }

        function renderContacts() {
          const list = state.users.filter((user) => user.name.toLowerCase().includes(contactQuery) || user.login.includes(contactQuery));
          overlay.querySelector('#contact-list').innerHTML = list.length
            ? list.map((user) => contactHtml(user, false)).join('')
            : '<p class="list-empty">Контакты не найдены</p>';

          const groupList = state.users.filter((user) => user.name.toLowerCase().includes(contactQuery) || user.login.includes(contactQuery));
          overlay.querySelector('#group-contacts').innerHTML = groupList.length
            ? groupList.map((user) => contactHtml(user, true)).join('')
            : '<p class="list-empty">Контакты не найдены</p>';
        }

        renderContacts();

        overlay.querySelectorAll('.modal-tab').forEach((btn) => {
          btn.addEventListener('click', () => {
            tab = btn.dataset.tab;
            overlay.querySelectorAll('.modal-tab').forEach((item) => item.classList.toggle('is-active', item === btn));
            overlay.querySelectorAll('[data-panel]').forEach((panel) => panel.classList.toggle('is-hidden', panel.dataset.panel !== tab));
          });
        });

        const search = (event) => {
          contactQuery = event.target.value.trim().toLowerCase();
          renderContacts();
        };
        overlay.querySelector('#contact-search').addEventListener('input', search);
        overlay.querySelector('#group-search').addEventListener('input', search);

        overlay.addEventListener('click', async (event) => {
          const emojiBtn = event.target.closest('[data-emoji-choice]');
          if (emojiBtn) {
            chosenEmoji = emojiBtn.dataset.emojiChoice || '👥';
            overlay.querySelectorAll('[data-emoji-choice]').forEach((item) => item.classList.toggle('is-active', item === emojiBtn));
            return;
          }
          const channelEmojiBtn = event.target.closest('[data-channel-emoji]');
          if (channelEmojiBtn) {
            chosenChannelEmoji = channelEmojiBtn.dataset.channelEmoji || '📢';
            overlay.querySelectorAll('[data-channel-emoji]').forEach((item) => item.classList.toggle('is-active', item === channelEmojiBtn));
            return;
          }
          const row = event.target.closest('[data-user-id]');
          if (row) {
            const id = row.dataset.userId;
            if (tab === 'group') {
              if (selected.has(id)) selected.delete(id);
              else selected.add(id);
              renderContacts();
              return;
            }
            try {
              const { chat } = await api.chatsCreate({ userId: id });
              close();
              await refreshChats();
              selectChat(chat.id);
            } catch (error) {
              toast(error.message, 'error');
            }
          }
        });

        overlay.querySelector('#create-group').addEventListener('click', async () => {
          const name = overlay.querySelector('#group-name').value.trim();
          try {
            const { chat } = await api.chatsCreate({ name, participantIds: [...selected], isGroup: true, avatarEmoji: chosenEmoji });
            close();
            await refreshChats();
            selectChat(chat.id);
            toast('Группа создана 🎉', 'success');
          } catch (error) {
            toast(error.message, 'error');
          }
        });

        overlay.querySelector('#create-channel').addEventListener('click', async () => {
          const name = overlay.querySelector('#channel-name').value.trim();
          const description = overlay.querySelector('#channel-description').value.trim();
          try {
            const { chat } = await api.chatsCreate({ name, description, isChannel: true, avatarEmoji: chosenChannelEmoji });
            close();
            await refreshChats();
            selectChat(chat.id);
            toast('Канал создан 📢', 'success');
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      },
    });
  }

  function openProfileModal() {
    const claimedToday = state.user.dailyClaimDate === new Date().toISOString().slice(0, 10);

    function musicBoxHtml() {
      return state.user.music?.hasMusic
        ? `${musicPlayerHtml(state.user, 'own')}
           <div class="profile-music__actions">
             <label class="btn btn--soft btn--small">${icon('music', 15)} Заменить<input type="file" id="music-file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.webm" hidden /></label>
             <button type="button" class="btn btn--ghost btn--small" id="music-remove">${icon('trash', 15)} Удалить</button>
           </div>`
        : `<label class="upload-zone" for="music-file">
             ${icon('music', 26)}
             <strong>Загрузить музыку в профиль</strong>
             <span>MP3, M4A, WAV, OGG, WebM · до 2.5 МБ</span>
             <input type="file" id="music-file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.webm" hidden />
           </label>`;
    }

    openModal({
      title: 'Редактировать профиль',
      subtitle: 'Фото, музыка, статус и ежедневный бонус',
      wide: true,
      content: `
        <form id="profile-form">
          <div class="profile-editor">
            <div class="profile-editor__avatar">
              <div id="profile-avatar-preview">${avatarHtml(state.user, 84)}</div>
              <label class="btn btn--soft btn--small">${icon('image', 15)} Загрузить фото
                <input type="file" id="avatar-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
              </label>
              <button type="button" class="btn btn--ghost btn--small ${state.user.avatar?.image ? '' : 'is-hidden'}" id="avatar-remove">${icon('trash', 15)} Удалить фото</button>
              <small>JPEG, PNG, WebP, GIF · будет уменьшено до 256×256</small>
            </div>
            <div class="profile-editor__fields">
              <div class="field"><label>Имя</label><div class="field__control"><input id="profile-name" value="${escapeHtml(state.user.name)}" maxlength="60" /></div></div>
              <div class="field"><label>Статус</label><div class="field__control"><input id="profile-status" value="${escapeHtml(state.user.status || '')}" maxlength="80" placeholder="Например: в поисках вдохновения ✨" /></div></div>
              <div class="field"><label>О себе</label><div class="field__control"><textarea id="profile-bio" rows="3" maxlength="180">${escapeHtml(state.user.bio || '')}</textarea></div></div>
            </div>
          </div>
          <div class="field"><label>Цвет аватара</label>
            <div class="color-picker">
              ${AVATAR_COLORS.map((color) => `<button type="button" class="color-choice ${state.user.avatar?.color === color ? 'is-active' : ''}" data-color="${color}" style="--swatch:${color}"></button>`).join('')}
            </div>
          </div>
          <div class="field"><label>Эмодзи аватара</label>
            <div class="avatar-picker">
              ${AVATAR_EMOJIS.map((emoji) => `<button type="button" class="emoji-choice ${state.user.avatar?.emoji === emoji ? 'is-active' : ''}" data-profile-emoji="${emoji}">${emoji || 'АА'}</button>`).join('')}
            </div>
          </div>
          <div class="field"><label>Музыка профиля</label><div id="profile-music">${musicBoxHtml()}</div></div>
          <div class="daily-card">
            <div class="daily-card__icon">${icon('gift', 22)}</div>
            <div><strong>Ежедневный бонус</strong><span>Серия: ${state.user.streak || 0} дн. · нажмите, чтобы получить +25 DVC</span></div>
            <button type="button" class="btn btn--primary btn--small" id="daily-claim" ${claimedToday ? 'disabled' : ''}>
              ${claimedToday ? 'Получено' : 'Забрать'}
            </button>
          </div>
          <button class="btn btn--primary btn--block" type="submit">Сохранить профиль</button>
        </form>
      `,
      onMount(overlay, close) {
        let color = state.user.avatar?.color || AVATAR_COLORS[0];
        let emoji = state.user.avatar?.emoji || '';

        const refreshAvatar = () => {
          const preview = overlay.querySelector('#profile-avatar-preview');
          if (preview) preview.innerHTML = avatarHtml(state.user, 84);
          overlay.querySelector('#avatar-remove')?.classList.toggle('is-hidden', !state.user.avatar?.image);
          overlay.querySelectorAll('[data-color]').forEach((item) => item.classList.toggle('is-active', item.dataset.color === state.user.avatar?.color));
          overlay.querySelectorAll('[data-profile-emoji]').forEach((item) => item.classList.toggle('is-active', item.dataset.profileEmoji === (state.user.avatar?.emoji || '')));
        };
        const refreshMusic = () => {
          const box = overlay.querySelector('#profile-music');
          if (box) box.innerHTML = musicBoxHtml();
        };

        overlay.querySelectorAll('[data-color]').forEach((btn) => {
          btn.addEventListener('click', () => {
            color = btn.dataset.color;
            overlay.querySelectorAll('[data-color]').forEach((item) => item.classList.toggle('is-active', item === btn));
          });
        });
        overlay.querySelectorAll('[data-profile-emoji]').forEach((btn) => {
          btn.addEventListener('click', () => {
            emoji = btn.dataset.profileEmoji;
            overlay.querySelectorAll('[data-profile-emoji]').forEach((item) => item.classList.toggle('is-active', item === btn));
          });
        });

        overlay.querySelector('#avatar-file').addEventListener('change', async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          try {
            const image = await prepareAvatar(file);
            const { user } = await api.mediaAvatar({ image });
            setSelf(user);
            refreshAvatar();
            toast('Аватарка обновлена 📸', 'success');
          } catch (error) {
            toast(error.message, 'error');
          }
          event.target.value = '';
        });
        overlay.querySelector('#avatar-remove').addEventListener('click', async () => {
          try {
            const { user } = await api.mediaAvatarRemove();
            setSelf(user);
            refreshAvatar();
            toast('Фото удалено', 'info');
          } catch (error) {
            toast(error.message, 'error');
          }
        });

        overlay.addEventListener('change', async (event) => {
          if (event.target.id !== 'music-file') return;
          const file = event.target.files?.[0];
          if (!file) return;
          try {
            const dataUrl = await prepareMusic(file);
            const { user } = await api.mediaMusic({ dataUrl, name: file.name, size: file.size });
            setSelf(user);
            refreshMusic();
            toast('Музыка добавлена в профиль 🎧', 'success');
          } catch (error) {
            toast(error.message, 'error');
          }
          event.target.value = '';
        });
        overlay.addEventListener('click', async (event) => {
          if (event.target.closest('#music-remove')) {
            try {
              const { user } = await api.mediaMusicRemove();
              setSelf(user);
              refreshMusic();
              stopMusic();
              toast('Музыка удалена', 'info');
            } catch (error) {
              toast(error.message, 'error');
            }
          }
          if (event.target.closest('#daily-claim')) {
            const btn = event.target.closest('#daily-claim');
            btn.disabled = true;
            try {
              const result = await api.dailyClaim();
              setSelf(result.user);
              btn.textContent = 'Получено';
              toast(`+${result.reward} DVC · серия ${result.streak} дн. 🔥`, 'success');
            } catch (error) {
              btn.disabled = false;
              toast(error.message, 'error');
            }
          }
        });

        overlay.querySelector('#profile-form').addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            const { user: updated } = await api.profileUpdate({
              name: overlay.querySelector('#profile-name').value,
              status: overlay.querySelector('#profile-status').value,
              bio: overlay.querySelector('#profile-bio').value,
              avatar: { color, emoji },
            });
            setSelf(updated);
            close();
            toast('Профиль обновлён', 'success');
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      },
    });
  }

  /* ---------------------------- Магазин и привилегии -------------------------- */

  function setSelf(updated) {
    state.user = updated;
    applyCustomization();
    renderSidebarFooter();
    renderDetails();
    renderChatList();
    if (activeChat()?.type === 'direct') renderChatHeader();
  }

  function stopMusic() {
    if (state.audio) {
      state.audio.pause();
      state.audio.currentTime = 0;
      state.audio = null;
    }
    state.playingMusicFor = null;
    renderDetails();
    if (activeChat()?.type === 'direct') renderChatHeader();
  }

  async function toggleMusic(user) {
    if (!user?.music?.hasMusic) return;
    if (state.playingMusicFor === user.id) {
      stopMusic();
      return;
    }
    if (state.musicLoading) return;
    state.musicLoading = true;
    try {
      if (state.audio) {
        state.audio.pause();
        state.audio = null;
      }
      const media = await api.mediaMusicGet({ userId: user.id });
      const audio = new Audio(media.dataUrl);
      audio.loop = true;
      audio.volume = 0.75;
      audio.onended = () => {
        if (state.audio === audio) stopMusic();
      };
      state.audio = audio;
      state.playingMusicFor = user.id;
      await audio.play();
      renderDetails();
      if (activeChat()?.type === 'direct') renderChatHeader();
      toast(`Слушаем: ${media.name} 🎧`, 'info');
    } catch (error) {
      state.audio = null;
      state.playingMusicFor = null;
      toast(error.message || 'Не удалось воспроизвести музыку', 'error');
    } finally {
      state.musicLoading = false;
    }
  }

  function burstReaction(messageId, emoji) {
    const row = root.querySelector(`.message-row[data-message-id="${messageId}"]`);
    if (!row) return;
    row.classList.remove('is-burst');
    void row.offsetWidth;
    row.classList.add('is-burst');
    const particle = document.createElement('span');
    particle.className = 'reaction-burst';
    particle.textContent = emoji;
    row.appendChild(particle);
    setTimeout(() => {
      particle.remove();
      row.classList.remove('is-burst');
    }, 900);
  }

  function openVerifiedModal(name) {
    openModal({
      title: 'Верификация DviGram',
      content: `
        <div class="verified-card">
          <span class="verified-card__icon">${icon('verified', 44)}</span>
          <h3>${escapeHtml(name)}</h3>
          <p>Пользователь верифицирован DviGram</p>
          <small>Личность и статус подтверждены официальной администрацией DviGram.</small>
        </div>
      `,
    });
  }

  function openInstallModal() {
    let tab = 'android';
    const steps = {
      android: `
        <ol class="install-steps">
          <li><span>1</span><div><strong>Откройте сайт в Chrome</strong><p>DviGram должен быть открыт именно в браузере Google Chrome.</p></div></li>
          <li><span>2</span><div><strong>Нажмите меню ⋮</strong><p>В правом верхнем углу браузера откройте меню.</p></div></li>
          <li><span>3</span><div><strong>«Установить приложение»</strong><p>Если пункт называется «Добавить на главный экран» — это нормально.</p></div></li>
          <li><span>4</span><div><strong>Подтвердите установку</strong><p>Иконка DviGram появится на экране Домой и будет открываться без рамки браузера.</p></div></li>
        </ol>
      `,
      ios: `
        <ol class="install-steps">
          <li><span>1</span><div><strong>Откройте сайт в Safari</strong><p>На iPhone установка работает именно через Safari.</p></div></li>
          <li><span>2</span><div><strong>Нажмите «Поделиться»</strong><p>Квадрат со стрелкой вверх в нижней части экрана.</p></div></li>
          <li><span>3</span><div><strong>«На экран «Домой»»</strong><p>Прокрутите список действий вниз и выберите этот пункт.</p></div></li>
          <li><span>4</span><div><strong>«Добавить»</strong><p>Иконка DviGram сохранится как обычное приложение.</p></div></li>
        </ol>
      `,
    };

    openModal({
      title: 'DviGram как приложение',
      subtitle: 'Добавьте сайт на экран Домой — будет как настоящий мессенджер',
      wide: true,
      content: `
        <div class="install-tabs">
          <button class="install-tab is-active" data-install-tab="android">${icon('smartphone', 16)} Android</button>
          <button class="install-tab" data-install-tab="ios">iOS / iPhone</button>
        </div>
        <div id="install-steps">${steps.android}</div>
        <div class="install-note">${icon('sparkles', 17)} После установки интерфейс открывается в полноэкранном режиме: без адресной строки, с отдельной иконкой и быстрым доступом к чатам.</div>
        ${state.installPrompt ? `<button class="btn btn--primary btn--block" id="pwa-install">${icon('download', 17)} Установить сейчас</button>` : ''}
      `,
      onMount(overlay, close) {
        const renderSteps = () => {
          overlay.querySelector('#install-steps').innerHTML = steps[tab];
          overlay.querySelectorAll('[data-install-tab]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.installTab === tab));
        };
        overlay.querySelectorAll('[data-install-tab]').forEach((btn) => {
          btn.addEventListener('click', () => {
            tab = btn.dataset.installTab;
            renderSteps();
          });
        });
        overlay.querySelector('#pwa-install')?.addEventListener('click', async () => {
          const prompt = state.installPrompt;
          if (!prompt) return;
          prompt.prompt?.();
          await prompt.userChoice?.catch(() => {});
          state.installPrompt = null;
          close();
        });
      },
    });
  }

  function openStoreModal() {
    let items = [];
    openModal({
      title: 'Магазин DviGram',
      subtitle: `Баланс: ${state.user.balance || 0} DVC`,
      wide: true,
      content: '<div id="store-content" class="modal-loading">Загрузка товаров...</div>',
      onMount(overlay) {
        async function load() {
          const box = overlay.querySelector('#store-content');
          try {
            const data = await api.storeItems();
            items = data.items;
            overlay.querySelector('.modal__head p').textContent = `Баланс: ${state.user.balance || 0} DVC · покупки приходят аккаунту dvinsky`;
            box.innerHTML = `
              <div class="store-grid">
                ${items.map((item) => `
                  <article class="store-card">
                    <span class="store-card__emoji">${escapeHtml(item.emoji)}</span>
                    <h3>${escapeHtml(item.name)}</h3>
                    <p>${escapeHtml(item.description)}</p>
                    <strong>${item.price} DVC</strong>
                    <button class="btn btn--primary btn--block" data-buy="${escapeHtml(item.id)}" ${state.user.balance < item.price ? 'disabled' : ''}>
                      ${state.user.balance < item.price ? 'Недостаточно DVC' : 'Купить'}
                    </button>
                  </article>
                `).join('')}
              </div>
              <p class="modal-note">DVC начисляются за активные сообщения: +2 за каждое отправленное сообщение.</p>
            `;
          } catch (error) {
            box.innerHTML = `<p class="modal__text">${escapeHtml(error.message)}</p>`;
          }
        }
        overlay.addEventListener('click', async (event) => {
          const btn = event.target.closest('[data-buy]');
          if (!btn) return;
          btn.disabled = true;
          try {
            const result = await api.storeBuy({ item: btn.dataset.buy });
            setSelf(result.user);
            toast(`${result.item.emoji} ${result.item.name} активировано. Уведомление отправлено @dvinsky`, 'success', 5000);
            await load();
          } catch (error) {
            toast(error.message, 'error');
            btn.disabled = false;
          }
        });
        load();
      },
    });
  }

  function openGiftsModal() {
    openModal({
      title: 'NFT-подарки',
      subtitle: 'Отправьте подарок — он сохранится в профиле получателя',
      wide: true,
      content: '<div id="gift-content" class="modal-loading">Загрузка подарков...</div>',
      onMount(overlay, close) {
        let selectedGift = null;
        async function load() {
          const box = overlay.querySelector('#gift-content');
          try {
            const [gifts, contacts] = await Promise.all([api.giftsList(), api.contacts()]);
            selectedGift = gifts.gifts[0]?.id || null;
            box.innerHTML = `
              <div class="gift-grid">
                ${gifts.gifts.map((gift) => `
                  <button class="gift-option ${gift.id === selectedGift ? 'is-active' : ''}" data-gift="${escapeHtml(gift.id)}" style="--gift-color:${escapeHtml(gift.color)}">
                    <span>${escapeHtml(gift.emoji)}</span>
                    <strong>${escapeHtml(gift.name)}</strong>
                    <small>${escapeHtml(gift.rarity)} · ${gift.price} DVC</small>
                  </button>
                `).join('')}
              </div>
              <div class="field"><label>Кому отправить</label><div class="field__control">
                <select id="gift-recipient">
                  ${contacts.users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)} · @${escapeHtml(user.login)}</option>`).join('')}
                </select>
              </div></div>
              <button class="btn btn--primary btn--block" id="send-gift" ${contacts.users.length ? '' : 'disabled'}>Отправить подарок</button>
              <p class="modal-note">Баланс: ${state.user.balance || 0} DVC</p>
            `;
          } catch (error) {
            box.innerHTML = `<p class="modal__text">${escapeHtml(error.message)}</p>`;
          }
        }
        overlay.addEventListener('click', async (event) => {
          const option = event.target.closest('[data-gift]');
          if (option) {
            selectedGift = option.dataset.gift;
            overlay.querySelectorAll('[data-gift]').forEach((item) => item.classList.toggle('is-active', item === option));
            return;
          }
          if (!event.target.closest('#send-gift')) return;
          const btn = event.target.closest('#send-gift');
          const recipient = overlay.querySelector('#gift-recipient')?.value;
          if (!recipient || !selectedGift) return;
          btn.disabled = true;
          try {
            const result = await api.giftsSend({ giftId: selectedGift, userId: recipient });
            setSelf({ ...state.user, balance: result.balance });
            close();
            await refreshChats();
            if (result.message?.chatId) selectChat(result.message.chatId);
            toast('NFT-подарок отправлен 🎁', 'success');
          } catch (error) {
            toast(error.message, 'error');
            btn.disabled = false;
          }
        });
        load();
      },
    });
  }

  function openCustomizeModal() {
    const c = state.user.customization || {};
    openModal({
      title: 'Кастомизация интерфейса',
      subtitle: 'Эти настройки видны только вам',
      content: `
        <form id="customize-form">
          <div class="field"><label>Акцентный цвет</label>
            <div class="color-picker">
              ${ACCENT_COLORS.map((color) => `<button type="button" class="color-choice ${c.accent === color ? 'is-active' : ''}" data-accent="${color}" style="--swatch:${color}"></button>`).join('')}
            </div>
          </div>
          <div class="field"><label>Цвет вашего имени в чатах</label>
            <div class="color-picker">
              <button type="button" class="color-choice color-choice--none ${!c.nameColor ? 'is-active' : ''}" data-name-color="" style="--swatch:transparent">✕</button>
              ${ACCENT_COLORS.map((color) => `<button type="button" class="color-choice ${c.nameColor === color ? 'is-active' : ''}" data-name-color="${color}" style="--swatch:${color}"></button>`).join('')}
            </div>
          </div>
          <div class="field"><label>Размер текста чата: <span id="scale-label">${Number(c.fontScale) || 1}</span></label>
            <div class="field__control"><input id="font-scale" type="range" min="0.85" max="1.25" step="0.05" value="${Number(c.fontScale) || 1}" /></div>
          </div>
          <div class="field"><label>Стиль сообщений</label>
            <div class="segmented">
              <button type="button" class="segment ${c.bubbleStyle === 'classic' ? 'is-active' : ''}" data-bubble="classic">Классика</button>
              <button type="button" class="segment ${c.bubbleStyle === 'soft' ? 'is-active' : ''}" data-bubble="soft">Мягкий</button>
              <button type="button" class="segment ${c.bubbleStyle === 'glass' ? 'is-active' : ''}" data-bubble="glass">Стекло</button>
            </div>
          </div>
          <div class="field"><label>Узор фона</label>
            <div class="segmented">
              <button type="button" class="segment ${c.pattern === 'dots' ? 'is-active' : ''}" data-pattern="dots">Точки</button>
              <button type="button" class="segment ${c.pattern === 'waves' ? 'is-active' : ''}" data-pattern="waves">Волны</button>
              <button type="button" class="segment ${c.pattern === 'none' ? 'is-active' : ''}" data-pattern="none">Без узора</button>
            </div>
          </div>
          <button class="btn btn--primary btn--block" type="submit">Сохранить оформление</button>
        </form>
      `,
      onMount(overlay, close) {
        const values = {
          accent: c.accent || '#0b7cff',
          nameColor: c.nameColor || '',
          fontScale: Number(c.fontScale) || 1,
          bubbleStyle: c.bubbleStyle || 'classic',
          pattern: c.pattern || 'dots',
        };
        overlay.addEventListener('click', (event) => {
          const accent = event.target.closest('[data-accent]');
          const color = event.target.closest('[data-name-color]');
          const bubble = event.target.closest('[data-bubble]');
          const pattern = event.target.closest('[data-pattern]');
          if (accent || color || bubble || pattern) {
            event.preventDefault();
            const btn = accent || color || bubble || pattern;
            if (accent) {
              values.accent = accent.dataset.accent;
              overlay.querySelectorAll('[data-accent]').forEach((item) => item.classList.toggle('is-active', item === accent));
            } else if (color) {
              values.nameColor = color.dataset.nameColor;
              overlay.querySelectorAll('[data-name-color]').forEach((item) => item.classList.toggle('is-active', item === color));
            } else if (bubble) {
              values.bubbleStyle = bubble.dataset.bubble;
              overlay.querySelectorAll('[data-bubble]').forEach((item) => item.classList.toggle('is-active', item === bubble));
            } else {
              values.pattern = pattern.dataset.pattern;
              overlay.querySelectorAll('[data-pattern]').forEach((item) => item.classList.toggle('is-active', item === pattern));
            }
          }
        });
        overlay.querySelector('#font-scale').addEventListener('input', (event) => {
          values.fontScale = Number(event.target.value);
          overlay.querySelector('#scale-label').textContent = String(values.fontScale);
        });
        overlay.querySelector('#customize-form').addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            const { user } = await api.customizeUpdate(values);
            setSelf(user);
            close();
            toast('Оформление сохранено 🎨', 'success');
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      },
    });
  }

  function openAdminModal() {
    if (!isPrivileged(state.user)) {
      toast('Доступно только администраторам', 'error');
      return;
    }
    let people = [];
    let selectedId = null;
    openModal({
      title: 'Панель администратора',
      subtitle: 'Баны, муты, роли, префиксы, галочки и баланс',
      wide: true,
      content: '<div id="admin-content" class="modal-loading">Загрузка пользователей...</div>',
      onMount(overlay) {
        async function load() {
          const box = overlay.querySelector('#admin-content');
          try {
            const data = await api.adminUsers();
            people = data.users;
            if (!selectedId || !people.some((user) => user.id === selectedId)) selectedId = people[0]?.id || null;
            const target = people.find((user) => user.id === selectedId);
            box.innerHTML = `
              <div class="admin-layout">
                <div class="admin-user-list">
                  ${people.map((user) => `
                    <button class="admin-user ${user.id === selectedId ? 'is-active' : ''}" data-admin-user="${escapeHtml(user.id)}">
                      ${avatarHtml(user, 36)}
                      <span><strong>${escapeHtml(user.name)}</strong><small>@${escapeHtml(user.login)} · ${escapeHtml(user.role)}${user.verified ? ' · ✔' : ''}</small></span>
                    </button>
                  `).join('')}
                </div>
                <div class="admin-form">
                  ${target ? `
                    <div class="admin-target">${avatarHtml(target, 44)}<div><strong>${identityHtml(target, { small: true })}</strong><span>@${escapeHtml(target.login)} · ${target.balance || 0} DVC</span></div></div>
                    <form id="admin-form-fields">
                      <div class="field"><label>Роль</label><div class="field__control">
                        <select id="admin-role">
                          <option value="user" ${target.role === 'user' ? 'selected' : ''}>Пользователь</option>
                          <option value="moderator" ${target.role === 'moderator' ? 'selected' : ''}>Модератор</option>
                          <option value="admin" ${target.role === 'admin' ? 'selected' : ''}>Администратор</option>
                        </select>
                      </div></div>
                      <label class="switch-row"><span>${icon('sparkles', 16)} Premium подписка</span><input type="checkbox" id="admin-premium" ${target.premium ? 'checked' : ''}><i></i></label>
                      <div class="field"><label>Срок Premium, дней</label><div class="field__control"><input id="admin-premium-days" type="number" min="1" max="3650" value="30" /></div></div>
                      <div class="field"><label>Префикс перед именем</label><div class="field__control"><input id="admin-prefix" maxlength="24" value="${escapeHtml(target.prefix || '')}" placeholder="ADMIN" /></div></div>
                      <div class="field"><label>Значки (эмодзи через пробел)</label><div class="field__control"><input id="admin-badges" maxlength="80" value="${escapeHtml((target.badges || []).join(' '))}" placeholder="⭐ 🛡️ 💎" /></div></div>
                      <label class="switch-row"><span>${icon('verified', 16)} Верификация «Пользователь верифицирован DviGram»</span><input type="checkbox" id="admin-verified" ${target.verified ? 'checked' : ''}><i></i></label>
                      <div class="field"><label>Баланс DVC</label><div class="field__control"><input id="admin-balance" type="number" min="0" max="1000000000" value="${target.balance || 0}" /></div></div>
                      <div class="field-row">
                        <div class="field"><label>Мут, минут (0 = снять)</label><div class="field__control"><input id="admin-mute" type="number" min="0" max="10080" value="0" /></div></div>
                        <div class="field"><label>Бан, минут (0 = снять)</label><div class="field__control"><input id="admin-ban" type="number" min="0" max="525600" value="0" /></div></div>
                      </div>
                      <div class="field"><label>Предупреждение</label><div class="field__control"><input id="admin-warning" maxlength="180" placeholder="Причина или предупреждение" /></div></div>
                      <button class="btn btn--primary btn--block" type="submit">Применить изменения</button>
                    </form>
                  ` : '<p class="modal__text">Нет пользователей</p>'}
                </div>
              </div>
            `;
          } catch (error) {
            box.innerHTML = `<p class="modal__text">${escapeHtml(error.message)}</p>`;
          }
        }
        overlay.addEventListener('click', (event) => {
          const userBtn = event.target.closest('[data-admin-user]');
          if (!userBtn) return;
          selectedId = userBtn.dataset.adminUser;
          load();
        });
        overlay.addEventListener('submit', async (event) => {
          if (!event.target.closest('#admin-form-fields')) return;
          event.preventDefault();
          const input = (id) => overlay.querySelector(`#${id}`);
          try {
            const result = await api.adminUpdateUser({
              userId: selectedId,
              role: input('admin-role').value,
              premium: input('admin-premium').checked,
              premiumDays: Number(input('admin-premium-days').value) || 30,
              prefix: input('admin-prefix').value,
              badges: input('admin-badges').value.split(/[\s,]+/).filter(Boolean),
              verified: input('admin-verified').checked,
              balance: Number(input('admin-balance').value) || 0,
              muteMinutes: Number(input('admin-mute').value) || 0,
              banMinutes: Number(input('admin-ban').value) || 0,
              warning: input('admin-warning').value,
            });
            toast(`Настройки ${result.user.name} обновлены`, 'success');
            if (result.user.id === state.user.id) setSelf(result.user);
            await Promise.all([load(), refreshChats()]);
          } catch (error) {
            toast(error.message, 'error');
          }
        });
        load();
      },
    });
  }

  /* ------------------------------- Обработчики ------------------------------- */

  $('#chat-list').addEventListener('click', (event) => {
    if (event.target.closest('[data-verified]')) {
      event.stopPropagation();
      openVerifiedModal(event.target.closest('[data-verified]').dataset.verified);
      return;
    }
    const menuBtn = event.target.closest('[data-chat-menu]');
    if (menuBtn) {
      event.stopPropagation();
      const chat = state.chats.find((item) => item.id === menuBtn.dataset.chatMenu);
      if (chat) {
        showContextMenu(menuBtn, [
          { action: 'pin', label: chat.pinned ? 'Открепить' : 'Закрепить', icon: 'pin', payload: chat.id },
          { action: 'mute', label: chat.muted ? 'Включить звук' : 'Без звука', icon: 'bell', payload: chat.id },
        ]);
      }
      return;
    }
    const item = event.target.closest('[data-chat-id]');
    if (item) selectChat(item.dataset.chatId);
  });

  $('#chat-list').addEventListener('contextmenu', (event) => {
    const item = event.target.closest('[data-chat-id]');
    if (!item) return;
    event.preventDefault();
    const chat = state.chats.find((entry) => entry.id === item.dataset.chatId);
    if (chat) {
      showContextMenu(item, [
        { action: 'pin', label: chat.pinned ? 'Открепить' : 'Закрепить', icon: 'pin', payload: chat.id },
        { action: 'mute', label: chat.muted ? 'Включить звук' : 'Без звука', icon: 'bell', payload: chat.id },
      ]);
    }
  });

  $('#filters').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-filter]');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    $('#filters').querySelectorAll('.filter').forEach((item) => item.classList.toggle('is-active', item === btn));
    renderChatList();
  });

  const onChatSearch = debounce((value) => {
    state.search = value;
    renderChatList();
  }, 160);
  $('#chat-search').addEventListener('input', (event) => onChatSearch(event.target.value));

  $('#theme-toggle').addEventListener('click', () => {
    state.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(state.theme);
    $('#theme-toggle').innerHTML = icon(state.theme === 'dark' ? 'sun' : 'moon', 19);
    renderDetails();
  });

  $('#new-chat').addEventListener('click', openNewChatModal);
  $('#empty-new-chat').addEventListener('click', openNewChatModal);
  $('#install-button').addEventListener('click', openInstallModal);
  $('#store-button').addEventListener('click', openStoreModal);
  $('#balance-chip').addEventListener('click', openGiftsModal);
  $('#sidebar-footer').addEventListener('click', (event) => {
    if (!event.target.closest('#footer-profile')) return;
    openModal({
      title: 'Профиль и оформление',
      content: `
        <div class="profile-menu">
          <button class="profile-menu__item" data-menu="profile">${icon('user', 18)} Редактировать профиль</button>
          <button class="profile-menu__item" data-menu="customize">${icon('palette', 18)} Кастомизация интерфейса</button>
          <button class="profile-menu__item" data-menu="store">${icon('store', 18)} Магазин DviGram</button>
          <button class="profile-menu__item" data-menu="gifts">${icon('gift', 18)} NFT-подарки</button>
          <button class="profile-menu__item" data-menu="install">${icon('smartphone', 18)} Установить приложение</button>
          ${isPrivileged(state.user) ? `<button class="profile-menu__item" data-menu="admin">${icon('shield', 18)} Панель администратора</button>` : ''}
        </div>
      `,
      onMount(overlay, close) {
        overlay.addEventListener('click', (event) => {
          const btn = event.target.closest('[data-menu]');
          if (!btn) return;
          close();
          const action = btn.dataset.menu;
          if (action === 'profile') openProfileModal();
          if (action === 'customize') openCustomizeModal();
          if (action === 'store') openStoreModal();
          if (action === 'gifts') openGiftsModal();
          if (action === 'install') openInstallModal();
          if (action === 'admin') openAdminModal();
        });
      },
    });
  });
  $('#sidebar-footer').addEventListener('click', async (event) => {
    if (event.target.closest('#footer-admin')) {
      openAdminModal();
      return;
    }
    if (event.target.closest('#footer-logout')) {
      await api.logout();
      onLogout();
    }
  });

  $('#chat-header').addEventListener('click', (event) => {
    const identity = event.target.closest('[data-verified]');
    if (identity) {
      openVerifiedModal(identity.dataset.verified);
      return;
    }
    if (event.target.closest('#mobile-back')) {
      state.mobileView = 'list';
      $('#app-shell').classList.remove('mobile-chat-open');
      return;
    }
    const btn = event.target.closest('[data-chat-action]');
    if (!btn) return;
    const action = btn.dataset.chatAction;
    if (action === 'details') {
      $('#app-shell').classList.toggle('details-open');
      return;
    }
    if (action === 'search') {
      $('#message-search-bar').classList.toggle('is-hidden');
      if (!$('#message-search-bar').classList.contains('is-hidden')) $('#message-search-input').focus();
      return;
    }
    if (action === 'call' || action === 'video') {
      toast('Звонки — демонстрационная функция', 'info');
      return;
    }
    handleContextAction(action, state.activeChatId);
  });

  $('#details-panel').addEventListener('click', (event) => {
    const identity = event.target.closest('[data-verified]');
    if (identity) {
      openVerifiedModal(identity.dataset.verified);
      return;
    }
    if (event.target.closest('[data-open-profile]')) {
      openProfileModal();
      return;
    }
    if (event.target.closest('[data-open-store]')) {
      openStoreModal();
      return;
    }
    if (event.target.closest('[data-open-gifts]')) {
      openGiftsModal();
      return;
    }
    if (event.target.closest('[data-open-customize]')) {
      openCustomizeModal();
      return;
    }
    if (event.target.closest('[data-open-admin]')) {
      openAdminModal();
      return;
    }
    const themeBtn = event.target.closest('[data-theme-value]');
    if (themeBtn) {
      state.theme = themeBtn.dataset.themeValue;
      applyTheme(state.theme);
      $('#theme-toggle').innerHTML = icon(state.theme === 'dark' ? 'sun' : 'moon', 19);
      renderDetails();
      return;
    }
    const actionBtn = event.target.closest('[data-chat-action]');
    if (actionBtn) {
      handleContextAction(actionBtn.dataset.chatAction, state.activeChatId);
      return;
    }
    const media = event.target.closest('.media-tile');
    if (media) toast('Просмотр файлов недоступен в демо', 'info');
  });

  $('#details-panel').addEventListener('change', (event) => {
    const input = event.target.closest('[data-setting]');
    if (!input) return;
    state.settings[input.dataset.setting] = input.checked;
    saveSettings(state.settings);
    $('#app-shell').classList.toggle('is-compact', state.settings.compact);
    toast('Настройка сохранена', 'success');
  });

  $('#details-backdrop').addEventListener('click', () => $('#app-shell').classList.remove('details-open'));

  $('#close-message-search').addEventListener('click', () => {
    state.messageSearch = '';
    $('#message-search-input').value = '';
    $('#message-search-bar').classList.add('is-hidden');
    renderMessages();
  });
  $('#message-search-input').addEventListener('input', (event) => {
    state.messageSearch = event.target.value;
    renderMessages();
  });

  $('#messages').addEventListener('scroll', async () => {
    const container = $('#messages');
    if (container.scrollTop < 80 && state.hasMore && !state.loadingOlder) {
      state.loadingOlder = true;
      await loadMessages({ older: true });
      state.loadingOlder = false;
    }
  }, { passive: true });

  $('#messages').addEventListener('click', async (event) => {
    const identity = event.target.closest('[data-verified]');
    if (identity) {
      openVerifiedModal(identity.dataset.verified);
      return;
    }
    const reactionBtn = event.target.closest('[data-react]');
    if (reactionBtn) {
      try {
        const { message } = await api.messagesReact({
          chatId: state.activeChatId,
          messageId: reactionBtn.dataset.messageId,
          emoji: reactionBtn.dataset.react,
        });
        await updateMessage(message);
        burstReaction(message.id, reactionBtn.dataset.react);
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }
    const menuBtn = event.target.closest('[data-message-menu]');
    if (menuBtn) {
      const message = state.messages.find((item) => item.id === menuBtn.dataset.messageMenu);
      if (!message) return;
      const own = message.senderId === state.user.id;
      const items = [
        { action: 'reply', label: 'Ответить', icon: 'reply', payload: message.id },
        ...EMOJIS.slice(8, 12).map((emoji) => ({ action: `react:${emoji}`, label: `Реакция ${emoji}`, icon: 'emoji', payload: message.id })),
        { action: 'copy', label: 'Копировать', icon: 'copy', payload: message.id },
        ...(own && message.kind !== 'system' ? [{ action: 'edit', label: 'Изменить', icon: 'edit', payload: message.id }] : []),
        ...(own ? [{ action: 'delete', label: 'Удалить', icon: 'trash', payload: message.id, danger: true }] : []),
      ];
      showContextMenu(menuBtn, items);
      return;
    }
    const link = event.target.closest('a');
    if (link) event.stopPropagation();
  });

  const onDocumentClick = (event) => {
    if (contextMenu && !event.target.closest('.context-menu') && !event.target.closest('[data-message-menu]') && !event.target.closest('[data-chat-menu]')) {
      closeContextMenu();
    }
    if (!event.target.closest('#emoji-picker') && !event.target.closest('#emoji-button')) {
      $('#emoji-picker').classList.add('is-hidden');
    }
    const musicBtn = event.target.closest('[data-music-user]');
    if (musicBtn) {
      const user = findUserById(musicBtn.dataset.musicUser);
      if (user) toggleMusic(user);
    }
    if (event.target.closest('[data-open-install]')) openInstallModal();
  };
  document.addEventListener('click', onDocumentClick);

  $('#emoji-button').addEventListener('click', () => $('#emoji-picker').classList.toggle('is-hidden'));
  $('#emoji-picker').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-emoji]');
    if (!btn) return;
    insertAtCursor($('#message-input'), btn.dataset.emoji);
    autoResize();
  });

  $('#attach-button').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    state.pendingAttachment = { name: file.name, size: file.size, type: file.type || 'application/octet-stream' };
    renderComposerPreview();
    event.target.value = '';
    toast('Файл прикреплён (демо: без загрузки байтов)', 'info');
  });

  $('#composer-preview').addEventListener('click', (event) => {
    if (event.target.closest('[data-clear-reply]')) state.replyTo = null;
    if (event.target.closest('[data-clear-edit]')) {
      state.editingId = null;
      $('#message-input').value = '';
    }
    if (event.target.closest('[data-clear-attachment]')) state.pendingAttachment = null;
    renderComposerPreview();
  });

  $('#mic-button').addEventListener('click', () => {
    toast('Запись голосового — демо-режим 🎙️', 'info');
  });

  $('#composer').addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage();
  });

  $('#message-input').addEventListener('input', autoResize);
  $('#message-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      if (state.settings.enterToSend) {
        event.preventDefault();
        sendMessage();
      } else if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        sendMessage();
      }
    }
  });

  const onDocumentKeydown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      $('#chat-search').focus();
    }
    if (event.key === 'Escape' && state.mobileView === 'chat' && !document.querySelector('.modal-overlay')) {
      state.mobileView = 'list';
      $('#app-shell').classList.remove('mobile-chat-open');
    }
  };
  document.addEventListener('keydown', onDocumentKeydown);

  const offDemoMode = api.onDemoMode(() => {
    renderSidebarFooter();
    toast('Сервер Netlify не найден — включён демо-режим', 'info', 5000);
  });

  state.installPrompt = window.__dvigramInstallPrompt || null;

  renderAll();
  renderSidebarFooter();
  loadInitial();
  state.pollTimer = setInterval(poll, 2500);

  const isTouch = window.matchMedia?.('(pointer: coarse)').matches;
  if (isTouch && !localStorage.getItem('dvigram:pwa-tutorial')) {
    state.tutorialTimer = setTimeout(() => {
      try {
        localStorage.setItem('dvigram:pwa-tutorial', '1');
      } catch {
        /* приватный режим */
      }
      openInstallModal();
    }, 1400);
  }

  return () => {
    clearInterval(state.pollTimer);
    clearTimeout(state.tutorialTimer);
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onDocumentKeydown);
    stopMusic();
    offDemoMode();
    closeContextMenu();
  };
}
