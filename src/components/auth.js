import { api } from '../lib/api.js';
import { toast } from '../lib/ui.js';
import { avatarHtml, icon } from '../lib/utils.js';

export function renderAuth(root, onAuthenticated) {
  let mode = 'login';
  let showPassword = false;

  root.innerHTML = `
    <main class="auth-shell">
      <section class="auth-art" aria-hidden="true">
        <div class="auth-art__glow auth-art__glow--one"></div>
        <div class="auth-art__glow auth-art__glow--two"></div>
        <div class="auth-brand">
          <span class="brand-mark brand-mark--large">${icon('send', 26)}</span>
          <span>Dvi<span>Gram</span></span>
        </div>
        <div class="auth-art__copy">
          <p class="eyebrow">Мессенджер нового поколения</p>
          <h1>Общайтесь<br><em>без границ</em></h1>
          <p>Личные чаты, каналы, группы, реакции, NFT-подарки и внутренняя валюта. Всё в одном лёгком интерфейсе.</p>
        </div>
        <div class="chat-scene">
          <div class="float-card float-card--one">
            ${avatarHtml({ name: 'Алина Соколова', avatar: { color: '#8b5cf6' } }, 42)}
            <div><strong>Алина</strong><span>Посмотри новый макет ✨</span></div>
            <time>12:04</time>
          </div>
          <div class="float-card float-card--two">
            <div class="float-card__bubble">Очень красиво! 💙</div>
            ${avatarHtml({ name: 'Вы', avatar: { color: '#0b7cff' } }, 34)}
          </div>
          <div class="float-card float-card--three">
            <span class="float-card__icon">${icon('users', 20)}</span>
            <div><strong>Планы на выходные</strong><span>3 участника · онлайн</span></div>
          </div>
        </div>
        <ul class="auth-features">
          <li>${icon('lock', 16)} Хеширование паролей</li>
          <li>${icon('sparkles', 16)} Кастомизация интерфейса</li>
          <li>${icon('shield', 16)} Админка и модерация</li>
        </ul>
      </section>

      <section class="auth-panel">
        <div class="auth-card">
          <div class="brand-mark auth-mobile-mark">${icon('send', 20)}</div>
          <h2 class="auth-card__title">Добро пожаловать</h2>
          <p class="auth-card__subtitle" id="auth-subtitle">Войдите, чтобы продолжить общение</p>

          <div class="auth-tabs" role="tablist">
            <button class="auth-tab is-active" data-mode="login" role="tab" aria-selected="true">Вход</button>
            <button class="auth-tab" data-mode="register" role="tab" aria-selected="false">Регистрация</button>
          </div>

          <form id="auth-form" novalidate>
            <div class="field is-hidden" data-register-field>
              <label for="auth-name">Имя</label>
              <div class="field__control">
                <span class="field__icon">${icon('user', 18)}</span>
                <input id="auth-name" name="name" type="text" placeholder="Как к вам обращаться" autocomplete="name" />
              </div>
            </div>

            <div class="field">
              <label for="auth-login">Логин</label>
              <div class="field__control">
                <span class="field__icon">${icon('mail', 18)}</span>
                <input id="auth-login" name="login" type="text" placeholder="например, alex_2026" autocomplete="username" required />
              </div>
            </div>

            <div class="field">
              <label for="auth-password">Пароль</label>
              <div class="field__control">
                <span class="field__icon">${icon('lock', 18)}</span>
                <input id="auth-password" name="password" type="password" placeholder="Минимум 8 символов" autocomplete="current-password" required />
                <button type="button" class="field__toggle" id="toggle-password" aria-label="Показать пароль">${icon('eye', 18)}</button>
              </div>
              <div class="strength is-hidden" data-strength>
                <div class="strength__bars"><i></i><i></i><i></i><i></i></div>
                <span class="strength__label">Слабый пароль</span>
              </div>
            </div>

            <div class="field is-hidden" data-register-field>
              <label for="auth-confirm">Повторите пароль</label>
              <div class="field__control">
                <span class="field__icon">${icon('lock', 18)}</span>
                <input id="auth-confirm" name="confirm" type="password" placeholder="Ещё раз пароль" autocomplete="new-password" />
              </div>
            </div>

            <p class="form-error" id="auth-error" role="alert"></p>

            <button class="btn btn--primary btn--block" id="auth-submit" type="submit">
              <span class="btn__label">Войти</span>
              <span class="btn__loader" aria-hidden="true"></span>
            </button>
          </form>

          <div class="auth-demo is-hidden" id="auth-demo">
            <div class="auth-demo__head">${icon('sparkles', 16)} Демо-режим</div>
            <p>Сервер Netlify не подключён — данные сохраняются в этом браузере. На сервере доступны аккаунты admin и dvinsky с паролем <b>82Idomih)</b>.</p>
            <button class="btn btn--soft btn--block" id="demo-login">Войти как <b>demo</b> / <b>demo1234</b></button>
          </div>

          <p class="auth-footnote">Нажимая «Продолжить», вы соглашаетесь с правилами DviGram.</p>
        </div>
      </section>
    </main>
  `;

  const form = root.querySelector('#auth-form');
  const errorEl = root.querySelector('#auth-error');
  const submitBtn = root.querySelector('#auth-submit');
  const subtitle = root.querySelector('#auth-subtitle');
  const strength = root.querySelector('[data-strength]');
  const passwordInput = root.querySelector('#auth-password');
  const confirmInput = root.querySelector('#auth-confirm');

  function setMode(next) {
    mode = next;
    root.querySelectorAll('.auth-tab').forEach((tab) => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    root.querySelectorAll('[data-register-field]').forEach((field) => field.classList.toggle('is-hidden', mode !== 'register'));
    strength.classList.toggle('is-hidden', mode !== 'register');
    subtitle.textContent = mode === 'login' ? 'Войдите, чтобы продолжить общение' : 'Создайте аккаунт за пару секунд';
    submitBtn.querySelector('.btn__label').textContent = mode === 'login' ? 'Войти' : 'Создать аккаунт';
    passwordInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    confirmInput.required = mode === 'register';
    root.querySelector('#auth-name').required = mode === 'register';
    errorEl.textContent = '';
  }

  function updateStrength() {
    if (mode !== 'register') return;
    const value = passwordInput.value;
    let score = 0;
    if (value.length >= 8) score++;
    if (/[A-ZА-Я]/u.test(value)) score++;
    if (/\d/.test(value)) score++;
    if (/[^A-Za-zА-Яа-я0-9]/u.test(value)) score++;
    strength.dataset.score = String(score);
    strength.querySelector('.strength__label').textContent = ['Слабый', 'Простой', 'Нормальный', 'Хороший', 'Отличный'][score];
  }

  root.querySelectorAll('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
  });

  root.querySelector('#toggle-password').addEventListener('click', () => {
    showPassword = !showPassword;
    passwordInput.type = showPassword ? 'text' : 'password';
    confirmInput.type = showPassword ? 'text' : 'password';
  });

  passwordInput.addEventListener('input', updateStrength);
  confirmInput.addEventListener('input', updateStrength);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.textContent = '';
    const payload = {
      name: root.querySelector('#auth-name').value.trim(),
      login: root.querySelector('#auth-login').value.trim(),
      password: passwordInput.value,
      confirm: confirmInput.value,
    };

    if (!payload.login || !payload.password) {
      errorEl.textContent = 'Заполните логин и пароль';
      return;
    }
    if (mode === 'register') {
      if (payload.name.length < 2) {
        errorEl.textContent = 'Укажите имя (минимум 2 символа)';
        return;
      }
      if (payload.password !== payload.confirm) {
        errorEl.textContent = 'Пароли не совпадают';
        return;
      }
    }

    submitBtn.classList.add('is-loading');
    submitBtn.disabled = true;
    try {
      const result = mode === 'login' ? await api.login(payload) : await api.register(payload);
      toast(mode === 'login' ? 'С возвращением!' : 'Аккаунт создан 🎉', 'success');
      onAuthenticated(result.user);
    } catch (error) {
      errorEl.textContent = error.message || 'Не удалось войти';
    } finally {
      submitBtn.classList.remove('is-loading');
      submitBtn.disabled = false;
    }
  });

  function revealDemo() {
    root.querySelector('#auth-demo').classList.remove('is-hidden');
  }
  if (api.isDemo()) {
    revealDemo();
  } else {
    let unsubscribe = () => {};
    unsubscribe = api.onDemoMode(() => {
      revealDemo();
      unsubscribe();
    });
  }

  root.querySelector('#demo-login').addEventListener('click', async () => {
    root.querySelector('#auth-login').value = 'demo';
    root.querySelector('#auth-password').value = 'demo1234';
    setMode('login');
    form.requestSubmit();
  });
}
