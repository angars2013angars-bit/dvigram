/** Красивая чёрно-белая заставка перед входом в Dvis. */

export function showSplash(root, onFinish) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    root.removeEventListener('click', finish);
    onFinish();
  };

  root.innerHTML = `
    <div class="splash" role="presentation">
      <div class="splash__grid"></div>
      <div class="splash__beam"></div>
      <div class="splash__content">
        <div class="splash__mark">
          <span class="splash__ring splash__ring--one"></span>
          <span class="splash__ring splash__ring--two"></span>
          <span class="splash__core"></span>
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/>
          </svg>
        </div>
        <h1 class="splash__title" data-glitch="DVIS">Dvis</h1>
        <p class="splash__tagline">приватный канал · без имени и телефона</p>
        <div class="splash__advice">
          <span>Желательно: Tor +VPN + Brave</span>
        </div>
        <div class="splash__progress"><i></i></div>
        <p class="splash__skip">нажмите, чтобы войти</p>
      </div>
      <div class="splash__corner splash__corner--tl">DV / 01</div>
      <div class="splash__corner splash__corner--br">ANON · SECURE · DIRECT</div>
    </div>
  `;

  const timer = setTimeout(finish, 2800);
  root.addEventListener('click', finish);
}
