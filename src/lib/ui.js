import { escapeHtml, icon } from './utils.js';

export function toast(message, type = 'info', timeout = 3400) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const item = document.createElement('div');
  item.className = `toast toast--${type}`;
  item.innerHTML = `<span class="toast__dot"></span><span>${escapeHtml(message)}</span>`;
  root.appendChild(item);
  requestAnimationFrame(() => item.classList.add('is-visible'));
  const remove = () => {
    item.classList.remove('is-visible');
    setTimeout(() => item.remove(), 220);
  };
  setTimeout(remove, timeout);
  item.addEventListener('click', remove);
}

export function openModal({ title, subtitle = '', content = '', wide = false, onMount }) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <section class="modal ${wide ? 'modal--wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
      <header class="modal__head">
        <div>
          <h2>${title}</h2>
          ${subtitle ? `<p>${subtitle}</p>` : ''}
        </div>
        <button class="icon-btn" data-close-modal aria-label="Закрыть">${icon('close', 20)}</button>
      </header>
      <div class="modal__body"></div>
    </section>
  `;
  overlay.querySelector('.modal__body').innerHTML = content;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-visible'));

  const close = () => {
    overlay.classList.remove('is-visible');
    setTimeout(() => overlay.remove(), 180);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('[data-close-modal]')) close();
  });
  if (typeof onMount === 'function') onMount(overlay, close);
  return close;
}

export function closeModal() {
  document.querySelectorAll('.modal-overlay').forEach((overlay) => overlay.remove());
}

export function confirmDialog(message, title = 'Подтверждение') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      closeModal();
      resolve(value);
    };
    openModal({
      title,
      content: `
        <p class="modal__text">${message}</p>
        <div class="modal__actions">
          <button class="btn btn--ghost" data-confirm="no">Отмена</button>
          <button class="btn btn--danger" data-confirm="yes">Удалить</button>
        </div>
      `,
      onMount(overlay) {
        overlay.querySelectorAll('[data-confirm]').forEach((btn) => {
          btn.addEventListener('click', () => finish(btn.dataset.confirm === 'yes'));
        });
      },
    });
  });
}
