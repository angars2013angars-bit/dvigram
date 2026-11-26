import { localApi } from './localApi.js';

const API_URL = '/.netlify/functions/api';

let backendAvailable = true;
let fallbackAnnounced = false;
const modeListeners = new Set();

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
    this.transport = true;
  }
}

function localAction(action) {
  return action.replace(/\.([a-z])/g, (_, letter) => letter.toUpperCase());
}

async function localCall(action, body) {
  const fn = localApi[localAction(action)];
  if (typeof fn !== 'function') throw new ApiError(`Неизвестное локальное действие: ${action}`);
  return fn.call(localApi, body || {});
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

async function serverCall(action, body) {
  let response;
  try {
    response = await fetch(`${API_URL}?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new TransportError('Сервер недоступен');
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new TransportError('API Netlify не найден');
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new TransportError('Некорректный ответ API');
  }

  if (!response.ok) throw new ApiError(data.error || 'Ошибка запроса', response.status);
  return data;
}

async function call(action, body = {}) {
  if (!backendAvailable) return localCall(action, body);
  try {
    return await serverCall(action, body);
  } catch (error) {
    if (error.transport) {
      backendAvailable = false;
      announceFallback();
      return localCall(action, body);
    }
    throw error;
  }
}

function method(action) {
  return (body = {}) => call(action, body);
}

export const api = {
  init: () => call('me'),
  isDemo: () => !backendAvailable,
  onDemoMode(listener) {
    modeListeners.add(listener);
    if (!backendAvailable) listener(true);
    return () => modeListeners.delete(listener);
  },
  register: method('register'),
  login: method('login'),
  logout: method('logout'),
  me: method('me'),
  contacts: method('contacts'),
  profileUpdate: method('profile.update'),
  customizeUpdate: method('customize.update'),
  mediaAvatar: method('media.avatar'),
  mediaAvatarRemove: method('media.avatar.remove'),
  mediaMusic: method('media.music'),
  mediaMusicGet: method('media.music.get'),
  mediaMusicRemove: method('media.music.remove'),
  dailyClaim: method('daily.claim'),
  storeItems: method('store.items'),
  storeBuy: method('store.buy'),
  giftsList: method('gifts.list'),
  giftsSend: method('gifts.send'),
  adminUsers: method('admin.users'),
  adminUpdateUser: method('admin.updateUser'),
  chats: method('chats'),
  chatsCreate: method('chats.create'),
  chatsUpdate: method('chats.update'),
  messages: method('messages'),
  messagesSend: method('messages.send'),
  messagesRead: method('messages.read'),
  messagesEdit: method('messages.edit'),
  messagesDelete: method('messages.delete'),
  messagesReact: method('messages.react'),
};
