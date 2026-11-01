// 通信: 旅の変化も、投票も WebSocket で（投票は番号つきで送り、サーバーの返事 ack を待つ）
//   切れにくくする仕組み（100ピタ・クニトリの一式を WebSocket 向けにしたもの）
//   ・切れたら 0.5秒から倍々で（最大60秒）つなぎ直し、hello で「いまの町の番号」と「入れた票」を伝える
//   ・町の番号が飛んだら（move の抜けがあったら）すぐ hello で取りなおす
//   ・画面に戻った / focus / online で hello。5秒なにも届かなければ張りなおす（凍った接続）
//   ・12秒ごとに ping（サーバーは起きずに自動で返す）。30秒なにも届かなければ張りなおす
//   ・切断が1.5秒続いたら帯を出す（すぐ戻る切断ではちらつかせない）
//   ・送るのは emit()（send という名前はボタンの変数とぶつかるので使わない）
import { VERSION } from './shared/travel.js?v=0.1.0';
import { WS_URL } from './config.js?v=0.1.0';

const ACK_MS = 6000;

export class Net {
  constructor(h) {
    this.h = h; // { hello(): 送る中身, onMessage(m), onStatus(s), onReload(v), always: 配信の画面（うしろでもつなぎつづける） }
    this.always = !!h.always;
    this.ws = null;
    this.lastRx = 0;
    this.retry = 0;
    this.downSince = 0;
    this.resyncing = false;
    this.reqId = 0;
    this.waiting = new Map(); // 返事待ちの投票: id → { done, timer }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.wake(); });
    window.addEventListener('focus', () => this.wake());
    window.addEventListener('online', () => this.wake());
    setInterval(() => this.heartbeat(), 12000);
  }

  connect() {
    clearTimeout(this.rt);
    if (this.ws && this.ws.readyState <= 1) return;
    let ws;
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      this.lost(null);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.retry = 0;
      this.lastRx = Date.now();
      this.hello();
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      this.lastRx = Date.now();
      this.onMessage(e.data);
    };
    ws.onclose = ws.onerror = () => this.lost(ws);
  }

  lost(ws) {
    if (ws && this.ws !== ws) return;
    this.ws = null;
    this.down();
    this.failWaiting();
    clearTimeout(this.rt);
    // 画面がうしろのあいだはつなぎなおさない（まえにもどったときの wake でつなぐ）。配信の画面はうしろでもつなぐ
    if (document.hidden && !this.always) return;
    // 待ち時間は 0.5秒から倍にして最大60秒（みんながいっせいにつなぎなおさないように ±20% ずらす）
    const wait = Math.min(60000, 500 * 2 ** Math.min(this.retry++, 7)) * (0.8 + Math.random() * 0.4);
    this.rt = setTimeout(() => this.connect(), wait);
  }

  // 凍った接続を捨てて張りなおす
  reopen() {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onerror = ws.onmessage = null;
      try { ws.close(); } catch {}
    }
    this.down();
    this.failWaiting();
    this.connect();
  }

  down() {
    if (this.downSince) return;
    this.downSince = Date.now();
    clearTimeout(this.bandT);
    this.bandT = setTimeout(() => this.h.onStatus('down'), 1500);
  }

  up() {
    if (!this.downSince) return;
    clearTimeout(this.bandT);
    const shown = Date.now() - this.downSince >= 1500;
    this.downSince = 0;
    this.h.onStatus(shown ? 'back' : 'up');
  }

  get connected() {
    return this.ws?.readyState === 1;
  }

  // そのまま送る（届いたかは分からない）
  emit(o) {
    if (this.ws?.readyState !== 1) return false;
    try { this.ws.send(JSON.stringify(o)); return true; } catch { return false; }
  }

  // 送って返事を待つ（6秒で返事がなければ失敗として、押しなおせるようにする）
  request(o) {
    return new Promise((done) => {
      if (!this.connected) { done({ error: '📡 つながってから、もう一度押してね', net: true }); return; }
      const id = ++this.reqId;
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        done({ error: '📡 返事がありません。もう一度押してね', net: true });
      }, ACK_MS);
      this.waiting.set(id, { done, timer });
      if (!this.emit({ ...o, id })) {
        clearTimeout(timer);
        this.waiting.delete(id);
        done({ error: '📡 つながってから、もう一度押してね', net: true });
      }
    });
  }

  failWaiting() {
    for (const [id, w] of this.waiting) {
      clearTimeout(w.timer);
      w.done({ error: '📡 通信が切れました。もう一度押してね', net: true });
      this.waiting.delete(id);
    }
  }

  hello() {
    this.resyncing = true;
    this.emit({ t: 'hello', v: VERSION, ...this.h.hello() });
  }

  // 画面に戻ったとき
  wake() {
    if (!this.ws || this.ws.readyState > 1) { this.connect(); return; }
    if (this.ws.readyState !== 1) return;
    const t0 = Date.now();
    this.hello();
    clearTimeout(this.wd);
    this.wd = setTimeout(() => { if (this.lastRx < t0) this.reopen(); }, 5000);
  }

  heartbeat() {
    if (document.hidden && !this.always) return;
    if (!this.ws || this.ws.readyState > 1) { this.connect(); return; }
    if (this.ws.readyState !== 1) return;
    if (Date.now() - this.lastRx > 30000) { this.reopen(); return; }
    this.emit({ t: 'ping' });
  }

  onMessage(data) {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'pong':
        return;
      case 'reload':
        this.h.onReload(m.v);
        return;
      case 'ack': {
        const w = this.waiting.get(m.id);
        if (!w) return;
        clearTimeout(w.timer);
        this.waiting.delete(m.id);
        w.done(m);
        return;
      }
      case 'snap':
        this.resyncing = false;
        this.up();
        this.h.onMessage(m);
        return;
      default:
        this.h.onMessage(m);
    }
  }

  // 抜けがあった → 取りなおす（何度呼ばれても、返事が来るまでは1回だけ）
  resync() {
    if (!this.resyncing) this.hello();
  }
}
