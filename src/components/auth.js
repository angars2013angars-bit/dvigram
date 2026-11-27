import { api } from '../lib/api.js';
import { getSavedCredentials, saveCredentials, validateNickname, validatePassword } from '../lib/dvis.js';
import { deviceLabel, interfaceLabel } from '../lib/device.js';
import { toast } from '../lib/ui.js';
import { escapeHtml, icon } from '../lib/utils.js';

export function renderAuth(root, onSuccess) {
  let step = 'welcome';
  let currentUser = null;
  let busy = false;
  const saved = getSavedCredentials() || { nickname: '', password: '' };

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
    if (step === 'register' || step === 'login') {
      const register = step === 'register';
      return `
        <div class="auth-step">
          <button class="link-back" data-back>${icon('back', 15)} Назад</button>
          <div class="step-badge">${icon(register ? 'plus' : 'lock', 18)} ${register ? 'Новый аккаунт' : 'Вход в аккаунт'}</div>
          <h2>${register ? 'Придумайте ник и пароль' : 'Введите ник и пароль'}</h2>
          <p class="auth-sub">${register
            ? 'Ник нужен только для входа и виден собеседникам как подпись. Ключей и кодов восстановления больше нет.'
            : 'Данные сохранены в этом браузере, поэтому обычно вход происходит сам. Здесь можно войти вручную.'}</p>
          <form id="auth-form" class="auth-form">
            <label class="field">
              <span>Ник</span>
              <input id="nick-input" autocomplete="username" spellcheck="false"
                value="${escapeHtml(saved.nickname)}"
                placeholder="Например, Тихый" maxlength="24" required />
            </label>
            <label class="field">
              <span>Пароль</span>
              <input id="pass-input" type="password" autocomplete="${register ? 'new-password' : 'current-password'}"
                value="${escapeHtml(register ? '' : saved.password)}" placeholder="Не короче 6 символов" required />
            </label>
            ${register ? `
              <label class="field">
                <span>Повторите пароль</span>
                <input id="confirm-input" type="password" autocomplete="new-password" placeholder="Ещё раз" required />
              </label>
            ` : ''}
            <p class="field-error" id="auth-error"></p>
            <button class="btn btn--primary btn--block" type="submit">${icon('arrow', 17)} ${register ? 'Создать аккаунт' : 'Войти'}</button>
          </form>
          ${register ? '' : `
            <button class="btn btn--soft btn--block" data-recover>${icon('shield', 16)} Не помню пароль — сменить на этом устройстве</button>
            <p class="hint">Новый пароль можно задать только на устройстве, где уже был вход в этот аккаунт.</p>
          `}
        </div>
      `;
    }
    return `
      <div class="auth-step">
        <div class="step-badge">${icon('shield', 17)} Приватно по умолчанию</div>
        <h2>Общайтесь без личности</h2>
        <p class="auth-sub">Dvis не просит телефон, почту и ключи. Вход по нику и паролю, люди находятся только по вашему приглашению.</p>
        ${saved.nickname ? `
          <button class="btn btn--primary btn--block" data-quick-login>${icon('arrow', 18)} Войти как ${escapeHtml(saved.nickname)}</button>
          <p class="hint">Пароль сохранён в этом браузере — нажатие одной кнопки восстановит сессию.</p>
        ` : ''}
        <button class="btn ${saved.nickname ? 'btn--soft' : 'btn--primary'} btn--block" data-create>${icon('plus', 18)} Создать аккаунт</button>
        <button class="btn btn--soft btn--block" data-login>${icon('lock', 18)} У меня уже есть аккаунт</button>
        <div class="auth-note">${icon('info', 15)} При запуске без Netlify данные остаются только в этом браузере.</div>
      </div>
    `;
  }

  function bind() {
    const errorBox = () => root.querySelector('#auth-error');

    root.querySelector('[data-create]')?.addEventListener('click', () => {
      step = 'register';
      render();
      root.querySelector('#nick-input')?.focus();
    });

    root.querySelector('[data-login]')?.addEventListener('click', () => {
      step = 'login';
      render();
      root.querySelector('#pass-input')?.focus();
    });

    root.querySelector('[data-back]')?.addEventListener('click', () => {
      step = 'welcome';
      render();
    });

    root.querySelector('[data-quick-login]')?.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      const btn = root.querySelector('[data-quick-login]');
      btn.disabled = true;
      btn.textContent = 'Входим...';
      try {
        const result = await api.accountLogin({ nickname: saved.nickname, password: saved.password });
        currentUser = result.user;
        api.noteAuthenticated();
        onSuccess(currentUser);
      } catch (error) {
        busy = false;
        toast(error.message || 'Не удалось войти', 'error');
        render();
      }
    });

    root.querySelector('[data-recover]')?.addEventListener('click', async () => {
      if (busy) return;
      const box = errorBox();
      try {
        const nickname = validateNickname(root.querySelector('#nick-input').value);
        const password = validatePassword(root.querySelector('#pass-input').value);
        busy = true;
        const result = await api.accountRecover({ nickname, password });
        saveCredentials({ nickname, password });
        api.noteAuthenticated();
        onSuccess(result.user);
      } catch (error) {
        busy = false;
        if (box) box.textContent = error.message || 'Не удалось сменить пароль';
      }
    });

    root.querySelector('#auth-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      const box = errorBox();
      try {
        const nickname = validateNickname(root.querySelector('#nick-input').value);
        const password = validatePassword(
          root.querySelector('#pass-input').value,
          step === 'register' ? root.querySelector('#confirm-input').value : undefined,
        );
        busy = true;
        const result = step === 'register'
          ? await api.accountCreate({ nickname, password })
          : await api.accountLogin({ nickname, password });
        currentUser = result.user;
        saveCredentials({ nickname, password });
        api.noteAuthenticated();
        onSuccess(currentUser);
      } catch (error) {
        busy = false;
        if (box) box.textContent = error.message || 'Не удалось войти';
        else toast(error.message || 'Не удалось войти', 'error');
      }
    });
  }

  render();
}
