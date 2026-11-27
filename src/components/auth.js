import { api } from '../lib/api.js';
import { KEY_HINT, getSavedKey, normalizeKey, saveKey } from '../lib/dvis.js';
import { deviceLabel, interfaceLabel } from '../lib/device.js';
import { copyText, toast } from '../lib/ui.js';
import { escapeHtml, icon } from '../lib/utils.js';

export function renderAuth(root, onSuccess) {
  let step = 'welcome';
  let issuedKey = '';
  let currentUser = null;
  let busy = false;

  function render() {
    root.innerHTML = `
      <div class="auth-shell">
        <div class="auth-noise"></div>
        <div class="auth-card">
          <div class="brand">
            <div class="brand__mark">${icon('lock', 26)}</div>
            <div>
              <h1>Dvis</h1>
              <p>анонимный мессенджер</p>
            </div>
          </div>
          <div id="auth-step">${stepHtml()}</div>
        </div>
        <p class="auth-foot">${icon('shield', 13)} ${escapeHtml(deviceLabel())} · ${escapeHtml(interfaceLabel())}</p>
      </div>
    `;
    bind();
  }

  function stepHtml() {
    if (step === 'reveal') {
      return `
        <div class="auth-step">
          <div class="step-badge">${icon('key', 18)} Ключ выдан</div>
          <h2>Сохраните ключ</h2>
          <p class="auth-sub">Короткий ключ — это ваш аккаунт. Он появится только сейчас и будет работать только на этом устройстве.</p>
          <div class="key-box"><span>${escapeHtml(issuedKey)}</span></div>
          <button class="btn btn--block" data-copy-key>${icon('copy', 17)} Скопировать ключ</button>
          <div class="warn-box">${icon('info', 16)} Запишите ключ. Потеряете устройство или ключ — восстановить аккаунт нельзя.</div>
          <button class="btn btn--primary btn--block" data-continue>Я сохранил — продолжить ${icon('arrow', 17)}</button>
        </div>
      `;
    }
    if (step === 'login') {
      return `
        <div class="auth-step">
          <button class="link-back" data-back>${icon('back', 15)} Назад</button>
          <div class="step-badge">${icon('key', 18)} Вход по ключу</div>
          <h2>Введите ключ</h2>
          <p class="auth-sub">Ключ действует только на этом устройстве — так даже короткий код нельзя подобрать со стороны.</p>
          <form id="login-form" class="auth-form">
            <label class="field">
              <span>Ключ Dvis</span>
              <input id="key-input" autocomplete="off" spellcheck="false" value="${escapeHtml(getSavedKey())}" placeholder="${KEY_HINT}" required />
            </label>
            <p class="field-error" id="auth-error"></p>
            <button class="btn btn--primary btn--block" type="submit">${icon('arrow', 17)} Войти</button>
          </form>
        </div>
      `;
    }
    return `
      <div class="auth-step">
        <div class="step-badge">${icon('shield', 17)} Приватно по умолчанию</div>
        <h2>Общайтесь без личности</h2>
        <p class="auth-sub">Dvis не просит телефон и почту. Ключ выдаётся один раз и привязывается к устройству. Люди находятся только по вашему приглашению.</p>
        <button class="btn btn--primary btn--block" data-create>${icon('plus', 18)} Создать аккаунт</button>
        <button class="btn btn--soft btn--block" data-login>${icon('key', 18)} У меня уже есть ключ</button>
        <div class="auth-note">${icon('info', 15)} При запуске без Netlify данные остаются только в этом браузере.</div>
      </div>
    `;
  }

  function bind() {
    root.querySelector('[data-create]')?.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      const btn = root.querySelector('[data-create]');
      btn.disabled = true;
      btn.textContent = 'Создаём ключ...';
      try {
        const result = await api.accountCreate();
        issuedKey = result.key;
        currentUser = result.user;
        saveKey(issuedKey);
        api.noteAuthenticated();
        step = 'reveal';
        render();
      } catch (error) {
        toast(error.message || 'Не удалось создать аккаунт', 'error');
        busy = false;
        render();
      }
    });

    root.querySelector('[data-login]')?.addEventListener('click', () => {
      step = 'login';
      render();
      root.querySelector('#key-input')?.focus();
    });

    root.querySelector('[data-back]')?.addEventListener('click', () => {
      step = 'welcome';
      render();
    });

    root.querySelector('#login-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      const errorBox = root.querySelector('#auth-error');
      try {
        const key = normalizeKey(root.querySelector('#key-input').value);
        busy = true;
        const result = await api.accountLogin({ key });
        currentUser = result.user;
        saveKey(key);
        api.noteAuthenticated();
        onSuccess(currentUser);
      } catch (error) {
        busy = false;
        errorBox.textContent = error.message || 'Не удалось войти';
      }
    });

    root.querySelector('[data-copy-key]')?.addEventListener('click', () => copyText(issuedKey, 'Ключ скопирован'));

    root.querySelector('[data-continue]')?.addEventListener('click', () => {
      issuedKey = '';
      onSuccess(currentUser);
    });
  }

  render();
}
