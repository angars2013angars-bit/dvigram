import { deviceId } from './device.js';
import { getSavedCredentials } from './dvis.js';
import { localApi } from './localApi.js';

const API_URL = '/.netlify/functions/api';
const RETRY_DELAY = 250;
const REPROBE_INTERVAL = 15_000;
const REQUEST_TIMEOUT = 12_000;

let backendAvailable = true;
let backendChecked = false;
let backendCheck = null;
let lastProbeAt = 0;
let fallbackAnnounced = false;
let reloginPromise = null;
let sessionLost = false;
const modeListeners = new Set();
const sessionListeners = new Set();

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

class TransportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TransportError';
    this.transport = true;
  }
}

const isTransport = (error) => Boolean(error?.transport);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function localAction(action) {
  return action.replace(/\.([a-z])/g, (_, letter) => letter.toUpperCase());
}

async function localCall(action, body) {
  const fn = localApi[localAction(action)];
  if (typeof fn !== 'function') throw new ApiError(`Неизвестное локальное действие: ${action}`);
  return fn.call(localApi, { ...body, deviceId: deviceId() });
}

function announceFallback() {
  if (fallbackAnnounced) return;
  fallbackAnnounced = true;
  modeListeners.forEach((listener) => {
    try {
      listener(true);
    } catch {
      /* игнорируем ошибки слушателей */
    }
  });
}

function markAuthenticated() {
  sessionLost = false;
}

function notifySessionLost(error) {
  if (sessionLost) return;
  sessionLost = true;
  sessionListeners.forEach((listener) => {
    try {
      listener(error);
    } catch {
      /* игнорируем ошибки слушателей */
    }
  });
}

async function serverCall(action, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  let response;
  try {
    response = await fetch(`${API_URL}?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Dvis-Device': deviceId(),
      },
      body: JSON.stringify(body || {}),
    });
  } catch {
    throw new TransportError('Сервер недоступен');
  } finally {
    clearTimeout(timer);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new TransportError('Сервер Dvis не найден');

  let data;
  try {
    data = await response.json();
  } catch {
    throw new TransportError('Некорректный ответ сервера');
  }
  if (!response.ok) throw new ApiError(data.error || 'Ошибка запроса', response.status);
  return data;
}

/**
 * Проверяем бэкенд один раз. В dev (Vite без Functions) разрешаем демо-режим.
 * В production transient-ошибка НЕ переводит навсегда в localStorage —
 * иначе аккаунт «вылетал» после любого сбоя сети и просил данные входа.
 */
async function probeBackend(force = false) {
  if (backendChecked && !force) return backendAvailable;
  if (backendCheck) return backendCheck;

  lastProbeAt = Date.now();
  backendCheck = (async () => {
    try {
      await serverCall('me', {});
      backendAvailable = true;
    } catch (error) {
      if (isTransport(error)) {
        // Vite без Netlify Functions = демо-режим на localStorage.
        // В production сетевой сбой НЕ переключает на локальные данные.
        backendAvailable = !import.meta.env.DEV;
        if (!backendAvailable) announceFallback();
      } else {
        // JSON-ответ со статусом 401/403 — это живой сервер.
        backendAvailable = true;
      }
    }
    backendChecked = true;
    lastProbeAt = Date.now();
    return backendAvailable;
  })();

  try {
    return await backendCheck;
  } finally {
    backendCheck = null;
  }
}

async function ensureBackend() {
  if (!backendChecked) return probeBackend();
  if (!backendAvailable && Date.now() - lastProbeAt > REPROBE_INTERVAL) return probeBackend(true);
  return backendAvailable;
}

/** Тихий релогин по сохранённому нику и паролю — экран ввода не показываем. */
async function relogin() {
  if (reloginPromise) return reloginPromise;
  const credentials = getSavedCredentials();
  if (!credentials) return false;

  reloginPromise = (async () => {
    try {
      await serverCall('account.login', credentials);
      markAuthenticated();
      return true;
    } catch (error) {
      // Сеть пропала — это не «вылет из аккаунта», а временная ошибка.
      // Сохранённые данные НЕ удаляем: следующий запрос повторит вход сам.
      if (isTransport(error)) throw new ApiError('Сервер временно недоступен. Попробуйте ещё раз', 503);
      // Данные НЕ удаляем: они нужны, чтобы пользователь мог исправить
      // пароль в форме входа, не создавая аккаунт заново.
      return false;
    }
  })();

  try {
    return await reloginPromise;
  } finally {
    reloginPromise = null;
  }
}

async function call(action, body = {}) {
  await ensureBackend();
  if (!backendAvailable) return localCall(action, body);

  const isAuthAction = action === 'account.login' || action === 'account.create' || action === 'me';
  let retriedTransport = false;
  let retriedAuth = false;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const result = await serverCall(action, body);
      if (action === 'account.login' || action === 'account.create') markAuthenticated();
      return result;
    } catch (error) {
      if (isTransport(error)) {
        if (!retriedTransport) {
          retriedTransport = true;
          await wait(RETRY_DELAY);
          continue;
        }
        throw new ApiError('Сервер временно недоступен. Попробуйте ещё раз', 503);
      }
      if (!isAuthAction && !retriedAuth && [401, 403].includes(error.status)) {
        retriedAuth = true;
        if (await relogin()) continue;
        notifySessionLost(error);
      }
      throw error;
    }
  }
  throw new ApiError('Не удалось выполнить запрос');
}

/** Восстановление сессии при запуске: cookie → сохранённые ник/пароль → форма входа. */
async function restore() {
  await ensureBackend();
  if (!backendAvailable) {
    try {
      return (await localCall('me')).user || null;
    } catch {
      return null;
    }
  }

  let retriedTransport = false;
  let retriedAuth = false;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const { user } = await serverCall('me');
      if (user) {
        markAuthenticated();
        return user;
      }
      // Сессия истекла, но данные для входа сохранены — логинимся тихо.
      if (!retriedAuth) {
        retriedAuth = true;
        if (await relogin()) continue;
      }
      return null;
    } catch (error) {
      if (isTransport(error)) {
        if (!retriedTransport) {
          retriedTransport = true;
          await wait(RETRY_DELAY);
          continue;
        }
        throw new ApiError('Сервер временно недоступен. Нажмите «Повторить»', 503);
      }
      if ([401, 403].includes(error.status)) {
        if (!retriedAuth) {
          retriedAuth = true;
          if (await relogin()) continue;
        }
        notifySessionLost(error);
        throw error;
      }
      throw error;
    }
  }
  return null;
}

function method(action) {
  return (body = {}) => call(action, body);
}

export const api = {
  init: restore,
  restore,
  isDemo: () => !backendAvailable,
  noteAuthenticated: markAuthenticated,
  onDemoMode(listener) {
    modeListeners.add(listener);
    if (!backendAvailable) listener(true);
    return () => modeListeners.delete(listener);
  },
  onSessionLost(listener) {
    sessionListeners.add(listener);
    if (sessionLost) listener();
    return () => sessionListeners.delete(listener);
  },
  clearSessionLost: markAuthenticated,
  accountCreate: method('account.create'),
  accountLogin: method('account.login'),
  accountRecover: method('account.recover'),
  logout: method('account.logout'),
  me: method('me'),
  profileUpdate: method('profile.update'),
  chatsList: method('chats.list'),
  chatUpdate: method('chat.update'),
  chatLeave: method('chat.leave'),
  inviteCreate: method('invite.create'),
  inviteList: method('invite.list'),
  inviteRevoke: method('invite.revoke'),
  inviteJoin: method('invite.join'),
  messagesList: method('messages.list'),
  messagesSend: method('messages.send'),
  messagesRead: method('messages.read'),
  messagesReact: method('messages.react'),
  messagesDelete: method('messages.delete'),
  callStart: method('call.start'),
  callSignal: method('call.signal'),
  callActive: method('call.active'),
  callEnd: method('call.end'),
  callsList: method('calls.list'),
};
