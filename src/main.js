import './styles.css';
import { api } from './lib/api.js';
import { toast } from './lib/ui.js';
import { applyTheme, icon } from './lib/utils.js';
import { showSplash } from './components/splash.js';
import { renderAuth } from './components/auth.js';
import { renderApp } from './components/app.js';
import { deviceId } from './lib/device.js';

const root = document.getElementById('app');
let disposeApp = null;

applyTheme();
deviceId();

/* Бейдж Netlify (в т.ч. «Powered by Netlify») перекрывает кнопку отправки.
   Netlify рендерит его в изолированном iframe с z-index 2147483645, поэтому
   скрываем сам iframe, а не его содержимое. API /.netlify/functions/api не трогаем. */
const BADGE_TEXT = /^(?:(?:made|powered)\s+(?:by|with)\s+)?netlify\b/i;
const BADGE_SELECTOR = [
  '#nl-badge-frame',
  'iframe[title*="netlify" i]',
  'iframe[id^="nl-"]',
  'iframe[data-nl-ready]',
  '#netlify-badge',
  '[class*="netlify-badge" i]',
  '[class*="nl-badge" i]',
  '[data-testid*="netlify-badge" i]',
  'netlify-dev-toolbar',
].join(',');

function hideNetlifyBadge() {
  document.querySelectorAll(BADGE_SELECTOR).forEach((element) => element.classList.add('dvis-netlify-badge'));

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  for (const textNode of nodes) {
    const value = textNode.textContent.trim();
    if (!BADGE_TEXT.test(value) || value.length > 60) continue;
    let element = textNode.parentElement;
    while (element && element !== document.body && !element.id?.startsWith('app')) {
      if (element.getBoundingClientRect().width > 420) break;
      element.classList.add('dvis-netlify-badge');
      element = element.parentElement;
      if (element?.closest('.dvis-netlify-badge')) break;
    }
  }
}

hideNetlifyBadge();
const badgeObserver = new MutationObserver(() => {
  badgeObserver.disconnect();
  requestAnimationFrame(() => {
    hideNetlifyBadge();
    badgeObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['id', 'class', 'title', 'data-nl-ready'],
    });
  });
});
badgeObserver.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['id', 'class', 'title', 'data-nl-ready'],
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  window.__dvisInstallPrompt = event;
});
window.addEventListener('appinstalled', () => {
  window.__dvisInstallPrompt = null;
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* офлайн-режим не критичен */
    });
  });
}

function showAuth() {
  disposeApp?.();
  disposeApp = null;
  renderAuth(root, showApp);
}

async function showApp(user) {
  disposeApp?.();
  disposeApp = renderApp(root, user, async () => {
    await api.logout().catch(() => {});
    showAuth();
  });
}

function showRetry(message) {
  root.innerHTML = `
    <div class="boot-screen">
      <div class="boot-orb">${icon('lock', 28)}</div>
      <p>${message}</p>
      <button class="btn btn--primary" data-retry>Повторить</button>
    </div>
  `;
  root.querySelector('[data-retry]')?.addEventListener('click', boot);
}

let sessionEventsReady = false;

api.onSessionLost((error) => {
  if (!sessionEventsReady) return;
  toast(error?.message || 'Сессия завершена. Войдите по нику и паролю', 'error', 5000);
  showAuth();
});

async function boot() {
  try {
    const user = await api.restore();
    sessionEventsReady = true;
    if (user) showApp(user);
    else showAuth();
  } catch (error) {
    sessionEventsReady = true;
    console.error('[dvis] boot error', error);
    if ([400, 401, 403].includes(error.status)) showAuth();
    else showRetry('Не удалось подключиться к серверу Dvis');
  }
}

// Небольшая пауза нужна, чтобы заставка успела показаться даже при быстром API.
showSplash(root, () => {
  requestAnimationFrame(() => boot());
});

// На случай, если модуль загрузился с ошибкой — оставляем понятный экран.
window.addEventListener('error', (event) => {
  if (!root.querySelector('.splash, .auth-shell, .phone')) {
    root.innerHTML = `<div class="boot-screen"><div class="boot-orb">${icon('lock', 28)}</div><p>Dvis загружается...</p></div>`;
  }
  console.error('[dvis] page error', event.message);
});
