import './styles.css';
import { api } from './lib/api.js';
import { applyTheme, getStoredTheme, icon } from './lib/utils.js';
import { renderAuth } from './components/auth.js';
import { renderApp } from './components/app.js';

const root = document.getElementById('app');
let disposeApp = null;

applyTheme(getStoredTheme());

root.innerHTML = `
  <div class="boot-screen">
    <div class="boot-orb">${icon('send', 30)}</div>
    <p>Загружаем DviGram...</p>
  </div>
`;

// PWA: запоминаем событие установки, чтобы показать кнопку «Установить сейчас».
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  window.__dvigramInstallPrompt = event;
});
window.addEventListener('appinstalled', () => {
  window.__dvigramInstallPrompt = null;
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

async function boot() {
  try {
    await api.init();
    const { user } = await api.me();
    if (user) await showApp(user);
    else showAuth();
  } catch (error) {
    console.error('[dvigram] boot error', error);
    showAuth();
  }
}

boot();
