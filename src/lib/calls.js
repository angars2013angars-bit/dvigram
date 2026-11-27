/** WebRTC-звонок: звук идёт напрямую, Netlify передаёт только сигналинг. */

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
const RING_TIMEOUT = 45_000;
const DISCONNECT_GRACE = 5_000;

export class CallSession {
  constructor({ api, chatId, meId, onState }) {
    this.api = api;
    this.chatId = chatId;
    this.meId = meId;
    this.onState = onState || (() => {});
    this.status = 'idle';
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.audio = null;
    this.answerApplied = false;
    this.seenIce = new Set();
    this.pendingIce = [];
    // Если Netlify на секунду недоступен, сигнал не теряется: он отправится
    // повторно на следующем опросе calls.list.
    this.pendingSignals = [];
    this.startedAt = 0;
    this.muted = false;
    this.closed = true;
    this.ringTimer = null;
    this.disconnectTimer = null;
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    if (status !== 'outgoing') {
      clearTimeout(this.ringTimer);
      this.ringTimer = null;
    }
    this.onState(status, this);
  }

  async markActive() {
    if (this.status === 'active') return;
    this.startedAt = this.startedAt || Date.now();
    await this.api.callActive({ chatId: this.chatId }).catch(() => {});
    this.setStatus('active');
  }

  createPeer() {
    this.closed = false;
    this.seenIce.clear();
    this.pendingIce = [];
    this.answerApplied = false;
    this.pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 2,
      bundlePolicy: 'max-bundle',
    });
    this.remoteStream = new MediaStream();
    this.audio = document.createElement('audio');
    this.audio.autoplay = true;
    this.audio.playsInline = true;
    this.audio.setAttribute('data-dvis-call', '');
    document.body.appendChild(this.audio);

    this.pc.ontrack = (event) => {
      if (!this.remoteStream.getTracks().includes(event.track)) this.remoteStream.addTrack(event.track);
      if (this.audio.srcObject !== this.remoteStream) this.audio.srcObject = this.remoteStream;
      this.audio.play().catch(() => {});
    };

    // Кандидаты Answers отправляются ещё до перехода в status: active —
    // проверяем только живой RTCPeerConnection, а не состояние звонка.
    this.pc.onicecandidate = (event) => {
      if (!event.candidate || !this.pc || this.closed) return;
      this.sendSignal('ice', event.candidate.toJSON());
    };

    // На некоторых браузерах connectionState обновляется с задержкой —
    // iceConnectionState даёт тот же результат раньше.
    this.pc.oniceconnectionstatechange = () => {
      if (!this.pc || this.closed) return;
      if (['connected', 'completed'].includes(this.pc.iceConnectionState)) this.markActive();
    };

    this.pc.onconnectionstatechange = () => {
      if (!this.pc || this.closed) return;
      const connection = this.pc.connectionState;
      if (connection === 'connected') {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = null;
        this.markActive();
        return;
      }
      if (connection === 'disconnected') {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = setTimeout(() => {
          if (this.pc?.connectionState === 'disconnected' && !this.closed) this.onState('failed', this);
        }, DISCONNECT_GRACE);
        return;
      }
      if (connection === 'failed' || connection === 'closed') {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = null;
        if (!this.closed) this.onState('failed', this);
      }
    };
  }

  async sendSignal(kind, data) {
    try {
      await this.api.callSignal({ chatId: this.chatId, kind, data });
      return true;
    } catch {
      // Не дублируем один и тот же сигнал в очереди.
      if (!this.pendingSignals.some((item) => item.kind === kind && JSON.stringify(item.data) === JSON.stringify(data))) {
        this.pendingSignals.push({ kind, data });
      }
      return false;
    }
  }

  async flushSignals() {
    if (!this.pendingSignals.length || this.closed) return;
    const pending = this.pendingSignals.splice(0);
    for (const signal of pending) await this.sendSignal(signal.kind, signal.data);
  }

  async getMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Браузер не поддерживает звонки. Откройте сайт по HTTPS');
    }
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (error) {
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        throw new Error('Разрешите доступ к микрофону в настройках браузера');
      }
      if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        throw new Error('Микрофон не найден');
      }
      throw error;
    }
    this.localStream.getTracks().forEach((track) => this.pc.addTrack(track, this.localStream));
  }

  rememberIce(entry) {
    if (!entry?.candidate || entry.from === this.meId) return false;
    const id = `${entry.from}|${JSON.stringify(entry.candidate)}`;
    if (this.seenIce.has(id)) return false;
    this.seenIce.add(id);
    return true;
  }

  async applyCandidate(candidate) {
    if (!this.pc || this.closed) return;
    if (!this.pc.remoteDescription) {
      this.pendingIce.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      /* устаревший кандидат — пропускаем */
    }
  }

  /** Безопасен к повторным вызовам: каждый кандидат применяется один раз. */
  async flushIce(call = null) {
    if (!this.pc || this.closed) return;
    for (const entry of call?.ice || []) {
      if (this.rememberIce(entry)) await this.applyCandidate(entry.candidate);
    }
    if (!this.pc.remoteDescription) return;
    const pending = this.pendingIce.splice(0);
    for (const candidate of pending) await this.applyCandidate(candidate);
  }

  queueIce(call) {
    return this.flushIce(call);
  }

  async start() {
    await this.api.callStart({ chatId: this.chatId });
    this.setStatus('outgoing');
    this.ringTimer = setTimeout(() => {
      if (this.status === 'outgoing') this.onState('timeout', this);
    }, RING_TIMEOUT);

    this.createPeer();
    await this.getMicrophone();
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.sendSignal('offer', this.pc.localDescription.toJSON());
  }

  async accept(call) {
    if (!call?.offer) throw new Error('Звонок уже завершён');
    this.createPeer();
    await this.getMicrophone();
    await this.pc.setRemoteDescription(new RTCSessionDescription(call.offer));
    await this.flushIce(call);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.sendSignal('answer', this.pc.localDescription.toJSON());
    await this.markActive();
  }

  async apply(call) {
    if (!this.pc || this.closed) return;
    await this.flushSignals();
    if (call.status === 'ended') {
      this.cleanup();
      this.setStatus('ended');
      return;
    }

    if (this.status === 'outgoing' && !this.answerApplied && call.answer && call.answer.from !== this.meId) {
      try {
        await this.pc.setRemoteDescription(new RTCSessionDescription(call.answer));
      } catch {
        this.onState('failed', this);
        return;
      }
      this.answerApplied = true;
      await this.flushIce(call);
      await this.markActive();
      return;
    }

    await this.flushIce(call);
  }

  toggleMute() {
    this.muted = !this.muted;
    this.localStream?.getAudioTracks().forEach((track) => { track.enabled = !this.muted; });
    return this.muted;
  }

  async end() {
    const chatId = this.chatId;
    this.cleanup();
    this.status = 'idle';
    this.onState('idle', this);
    await this.api.callEnd({ chatId }).catch(() => {});
  }

  cleanup() {
    clearTimeout(this.ringTimer);
    clearTimeout(this.disconnectTimer);
    this.ringTimer = null;
    this.disconnectTimer = null;
    this.closed = true;
    try { this.pc?.close(); } catch { /* уже закрыт */ }
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.remoteStream?.getTracks().forEach((track) => track.stop());
    this.audio?.remove();
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.audio = null;
    this.answerApplied = false;
    this.seenIce.clear();
    this.pendingIce = [];
    this.pendingSignals = [];
    this.muted = false;
  }
}
