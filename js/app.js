// ツギドコの画面
//   ふつうの画面（スマホが主・PC は横ならび）と、配信の画面（?stream=1・16:9 の大きい表示）
import { VERSION, T, loadPlaces, bitsFromB64, bitGet, bitSet, bitsNew, shareText, HASHTAG } from './shared/travel.js?v=0.1.2';
import { PREFS, PREF_SHORT, PREF_COLOR, PREF_GRID, GRID_W, GRID_H } from './shared/prefs.js?v=0.1.2';
import { TripMap, CAND_COLORS } from './map.js?v=0.1.2';
import { Net } from './net.js?v=0.1.2';
import { SHARE_URL, IS_PROD_PAGE } from './config.js?v=0.1.2';
import { makeShareCard } from './share-card.js?v=0.1.2';

// ---------- 小さな道具 ----------

const $ = (s) => document.querySelector(s);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'disabled' || k === 'hidden') e[k] = !!v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const num = (n) => Math.round(n || 0).toLocaleString('ja-JP');
// 旅の距離は長く続くと大きくなるので、10万をこえたら「12.3万」の形にする
const bigKm = (n) => (n >= 1e7 ? `${Math.round(n / 1e4).toLocaleString('ja-JP')}万` : n >= 1e5 ? `${(Math.floor(n / 1e3) / 10).toFixed(1)}万` : num(n));
const hhmm = (t) => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
function randId(n = 20) {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (const x of crypto.getRandomValues(new Uint8Array(n))) out += chars[x % chars.length];
  return out;
}

// Wikimedia Commons の画像（places.json の "a/ab/Name.jpg"）→ 縮小画像の住所
//   幅は Wikimedia の決まった大きさ（120・330・960）だけ使う（ほかの幅はことわられる）
function commonsThumb(img, w) {
  if (!img) return '';
  const name = img.split('/').pop();
  const ext = (name.split('.').pop() || '').toLowerCase();
  let file = name;
  if (ext === 'svg') file = `${name}.png`;
  else if (!['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return '';
  const enc = (s) => encodeURIComponent(s).replace(/%2F/g, '/');
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${enc(img)}/${w}px-${enc(file)}`;
}
const commonsPage = (img) => (img ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(img.split('/').pop())}` : '');

// ---------- 状態 ----------

const params = new URLSearchParams(location.search);
const STREAM = params.get('stream') === '1';
const S = {
  stream: STREAM,
  P: [],
  ready: false,
  seq: 0,
  cur: -1,
  prev: -1,
  leg: null,
  arriveAt: 0,
  endsAt: 0,
  stayMs: T.STAY_SEC * 1000,
  cands: [],
  tally: [],
  my: -1,
  pending: -1,
  stops: 0,
  km: 0,
  nVisited: 0,
  prefN: new Array(47).fill(0),
  bits: null,
  diary: [],
  thumbs: {}, // 町の番号 → 要約の縮小画像（日記に使う）
  wiki: null,
  n: 0,
  skew: 0, // サーバーの時計 − この端末の時計
  moving: false,
  firstVisit: false,
  curN: 0, // いまの町に来た回数（サーバーから。0.1.1 のサーバーは送らないので 0）
  vid: LS.get('tg-vid') || '',
  shownSeq: -1, // 候補のカードを作った町の番号（同じ町では作りなおさない）
};
if (!/^[A-Za-z0-9_-]{16,40}$/.test(S.vid)) { S.vid = randId(); LS.set('tg-vid', S.vid); }
const now = () => Date.now() + S.skew;

// ---------- 知らせ ----------

let toastT = 0;
function toast(text, kind = '') {
  const t = $('#toast');
  t.textContent = text;
  t.className = kind;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, kind === 'error' ? 4200 : 3000);
}

function netStatus(s) {
  const b = $('#netband');
  clearTimeout(netStatus.t);
  if (s === 'down') {
    b.textContent = '📡 通信が切れました。つなぎ直し中…';
    b.className = 'down';
    b.hidden = false;
  } else if (s === 'back') {
    b.textContent = '✅ つながりました！';
    b.className = 'back';
    b.hidden = false;
    netStatus.t = setTimeout(() => { b.hidden = true; }, 2000);
  } else {
    b.hidden = true;
  }
}

// ---------- 町の表示 ----------

function renderTown() {
  const p = S.P[S.cur];
  if (!p) return;
  $('#town-pref').textContent = p.prefName;
  $('#town-name').textContent = p.name;
  const badges = $('#town-badges');
  badges.replaceChildren();
  // 2番目の町から: はじめてなら「はじめての町」、2回目からは「N回目の訪問」（旅のはじまりの町は出さない）
  const visits = S.curN || (S.firstVisit ? 1 : 0);
  if (S.stops > 1 && visits === 1) badges.append(el('span', { class: 'badge new', text: 'はじめての町' }));
  if (S.stops > 1 && visits >= 2) badges.append(el('span', { class: 'badge again', text: `${num(visits)}回目の訪問` }));
  badges.append(el('span', { class: 'badge nth', text: `${num(S.stops)}番目の町` }));
  // 乗り物の札は長くなる（飛行機の「大館能代→沖永良部」など）ので最後に。短い2つが1行にならぶ（せまい画面で3行にしない）
  if (S.leg && S.leg.kind !== 'jump') badges.append(el('span', { class: 'badge leg', text: `${legText(S.leg)} ${num(S.leg.km)}km` }));
  renderMedia();
}

// 写真と説明（要約の写真 → Wikidata の代表画像 → 写真なしの絵はがき の順に使う）
function renderMedia() {
  const p = S.P[S.cur];
  if (!p) return;
  const w = S.wiki && S.wiki.i === S.cur ? S.wiki : null;
  const img = $('#photo-img');
  const tries = [];
  if (w?.thumb) {
    tries.push({
      src: w.thumb, srcset: w.big && w.big !== w.thumb ? `${w.thumb} 330w, ${w.big} 960w` : '',
      credit: { href: w.commons ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(w.file)}` : w.page, artist: w.artist, license: w.license },
    });
  }
  if (p.img && commonsThumb(p.img, 330)) {
    tries.push({ src: commonsThumb(p.img, 330), srcset: `${commonsThumb(p.img, 330)} 330w, ${commonsThumb(p.img, 960)} 960w`, credit: { href: commonsPage(p.img), artist: '', license: '' } });
  }
  const key = `${S.cur}|${tries.map((t) => t.src).join('|')}`;
  if (img.dataset.key !== key) {
    img.dataset.key = key;
    let k = 0;
    const show = () => {
      const t = tries[k];
      if (!t) {
        img.hidden = true;
        img.removeAttribute('src');
        img.removeAttribute('srcset');
        $('#photo').classList.add('nophoto');
        S.photoCredit = null;
        renderCredit();
        return;
      }
      $('#photo').classList.remove('nophoto');
      img.hidden = false;
      img.alt = `${p.prefName}${p.name}の写真`;
      img.sizes = STREAM ? '680px' : '(min-width: 900px) 440px, 100vw';
      if (t.srcset) img.srcset = t.srcset; else img.removeAttribute('srcset');
      img.src = t.src;
      S.photoCredit = t.credit;
      renderCredit();
    };
    img.onerror = () => { k += 1; show(); };
    show();
  }
  // 写真がないときの絵はがき（県の色と、町の名前の1字目）
  $('#photo').style.setProperty('--pc', PREF_COLOR[p.pref]);
  $('#postcard-kanji').textContent = p.name.slice(0, 1);
  $('#town-desc').textContent = w?.extract || `${p.prefName}${p.name}にやってきました。${p.pop ? `人口はおよそ${num(p.pop)}人。` : ''}`;
  renderCredit();
}

function renderCredit() {
  const p = S.P[S.cur];
  const w = S.wiki && S.wiki.i === S.cur ? S.wiki : null;
  const box = $('#town-credit');
  const parts = [];
  if (w) {
    parts.push(el('span', {}, '文: ', el('a', { href: w.page, target: '_blank', rel: 'noopener', text: `Wikipedia「${w.title}」` }), '（CC BY-SA 4.0）'));
  } else if (p?.title) {
    parts.push(el('span', {}, '記事: ', el('a', { href: `https://ja.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`, target: '_blank', rel: 'noopener', text: `Wikipedia「${p.title}」` })));
  }
  const c = S.photoCredit;
  if (c?.href) {
    const who = [c.artist, c.license].filter(Boolean).join(' / ');
    parts.push(el('span', {}, '写真: ', el('a', { href: c.href, target: '_blank', rel: 'noopener', text: who || 'Wikimedia Commons' }), who ? '（Wikimedia Commons）' : '（作者・ライセンスはリンク先）'));
  }
  box.replaceChildren(...parts.flatMap((x, k) => (k ? [el('span', { class: 'sep', text: '・' }), x] : [x])));
}

// ---------- 投票 ----------

const KIND_TAG = { far: '遠出', island: '島へ', sea: '海をわたる' };
// 乗り物の言い方（飛行機は「✈ 飛行機で（羽田→那覇）」）
const legText = (leg) => `${leg.icon} ${leg.mode}${leg.via ? `（${leg.via}）` : ''}`;

// 候補のカード（町が変わったときだけ作る。票の数は setCounts で書きかえるだけ）
function renderCands() {
  const box = $('#cands');
  if (S.moving) return;
  if (S.shownSeq === S.seq && box.children.length) { updateCounts(); return; }
  S.shownSeq = S.seq;
  box.replaceChildren(...S.cands.map((c, k) => {
    const p = S.P[c.i];
    const th = commonsThumb(p.img, 120);
    const tag = c.kind === 'plane' ? c.via : KIND_TAG[c.kind]; // 飛行機は「羽田→那覇」
    const b = el('button', {
      class: `cand kind-${c.kind}`, type: 'button', 'data-k': k, style: `--c:${CAND_COLORS[k % CAND_COLORS.length]}`,
      'aria-label': `${k + 1}番 ${c.dir}の${p.prefName}${p.name}（${c.km}km）に投票`,
      onclick: () => castVote(k),
    },
    el('span', { class: 'num', text: String(k + 1) }),
    el('span', { class: 'thumb' }, th ? el('img', { src: th, alt: '', loading: 'lazy', decoding: 'async', onerror: (e) => e.target.remove() }) : el('span', { class: 'th-kanji', text: p.name.slice(0, 1), style: `background:${PREF_COLOR[p.pref]}` }),
      // その町に来たことがあるか（写真の下に小さく。0.1.1 のサーバーは seen を送らないので出さない）
      Number.isInteger(c.seen) ? el('span', { class: `seen${c.seen ? '' : ' first'}`, text: c.seen ? `${num(c.seen + 1)}回目` : 'はじめて' }) : null),
    el('span', { class: 'body' },
      el('span', { class: 'l1' }, el('span', { class: 'dir', text: c.dir }), el('b', { class: 'nm', text: p.name })),
      el('span', { class: 'l2' }, el('span', { class: 'pf', text: p.prefName }), el('span', { class: 'md', text: `${c.icon}${c.mode} ${num(c.km)}km` }), tag ? el('span', { class: 'tag', text: tag }) : null),
      el('span', { class: 'bar' }, el('i'))),
    el('span', { class: 'pct' }, el('b', { text: '0%' }), el('small', { text: '0票' })),
    el('span', { class: 'mine', text: '✓ あなたの票' }));
    return b;
  }));
  updateCounts();
}

function updateCounts() {
  const counts = S.tally.length === S.cands.length ? S.tally : S.cands.map(() => 0);
  const total = counts.reduce((a, b) => a + b, 0);
  const max = Math.max(0, ...counts);
  const closed = now() >= S.endsAt;
  [...$('#cands').children].forEach((b, k) => {
    const n = counts[k] || 0;
    const pct = total ? Math.round((n / total) * 100) : 0;
    b.querySelector('.bar i').style.width = `${pct}%`;
    b.querySelector('.pct b').textContent = `${pct}%`;
    b.querySelector('.pct small').textContent = `${n}票`;
    b.classList.toggle('lead', total > 0 && n === max);
    b.classList.toggle('mine', S.my === k);
    b.classList.toggle('pending', S.pending === k);
    b.disabled = S.stream || S.pending >= 0 || closed || S.moving;
    b.setAttribute('aria-pressed', S.my === k ? 'true' : 'false');
  });
  map?.setCounts(counts, S.my);
  $('#vote-hint').textContent = S.stream
    ? `スマホで ${SHARE_URL.replace(/^https?:\/\//, '')} を開いて投票`
    : S.my >= 0 ? `あなたは ${S.my + 1}番に投票しました。締め切りまで変えられます` : '1人1票。締め切りまで何度でも変えられます';
  $('#viewers').textContent = num(S.n);
}

// 投票ボタン: 送って、サーバーの返事を待ってからボタンを戻す
async function castVote(k) {
  if (S.stream || S.pending >= 0 || S.moving) return;
  if (k === S.my) { toast('この候補に投票ずみです'); return; }
  const seq = S.seq;
  S.pending = k;
  updateCounts();
  const res = await net.request({ t: 'vote', seq, c: k });
  S.pending = -1;
  if (res.ok && res.seq === S.seq) {
    S.my = res.c;
    const p = S.P[S.cands[res.c]?.i];
    toast(`🗳 ${p ? p.name : ''}に投票しました`);
  } else if (res.error) {
    toast(res.error, 'error');
  }
  updateCounts();
}

// 残り時間（0.25秒ごと）
function tick() {
  if (!S.ready) return;
  const t = now();
  const box = $('#timer-box');
  if (S.moving) {
    $('#timer').textContent = '移動中…';
    $('#timer-bar').style.width = '100%';
    box.className = 'timer';
    return;
  }
  const left = Math.max(0, S.endsAt - t);
  const sec = Math.ceil(left / 1000);
  $('#timer').textContent = left > 0 ? `あと${sec}秒` : '集計中…';
  $('#timer-bar').style.width = `${Math.min(100, (left / S.stayMs) * 100)}%`;
  box.className = `timer${left > 0 && sec <= 5 ? ' hurry' : ''}${left <= 0 ? ' closed' : ''}`;
  // 締め切りの瞬間にボタンを止める
  if (left <= 0 && !tick.closed) { tick.closed = true; updateCounts(); }
  if (left > 0) tick.closed = false;
}

// ---------- 記録 ----------

function renderStats() {
  $('#st-km').textContent = bigKm(S.km);
  $('#st-towns').textContent = num(S.nVisited);
  $('#st-all').textContent = num(S.P.length);
  $('#st-prefs').textContent = String(S.prefN.filter((n) => n > 0).length);
}

const prefTotal = [];
function buildStamps() {
  const g = $('#stampgrid');
  g.style.setProperty('--gw', GRID_W);
  g.style.setProperty('--gh', GRID_H);
  for (let k = 0; k < 47; k++) prefTotal[k] = S.P.filter((p) => p.pref === k).length;
  g.replaceChildren(...PREFS.map((name, k) => el('button', {
    class: 'stamp', type: 'button', role: 'listitem', 'data-k': k,
    style: `grid-column:${PREF_GRID[k][0] + 1};grid-row:${PREF_GRID[k][1] + 1};--sc:${PREF_COLOR[k]}`,
    'aria-label': name,
    onclick: () => toast(`${name}: ${prefTotal[k]}町のうち${S.prefN[k]}町`),
  }, PREF_SHORT[k])));
}

function renderStamps() {
  const cur = S.P[S.cur]?.pref;
  [...$('#stampgrid').children].forEach((b, k) => {
    b.classList.toggle('on', S.prefN[k] > 0);
    b.classList.toggle('here', k === cur);
    b.title = `${PREFS[k]} ${S.prefN[k]}/${prefTotal[k]}`;
  });
}

function diaryItem(d) {
  const p = S.P[d.i];
  const th = S.thumbs[d.i] || commonsThumb(p.img, 120);
  return el('li', { 'data-n': d.n },
    el('span', { class: 'dthumb', style: `--pc:${PREF_COLOR[p.pref]}` }, th ? el('img', { src: th, alt: '', loading: 'lazy', decoding: 'async', onerror: (e) => e.target.remove() }) : null, el('span', { text: p.name.slice(0, 1) })),
    el('span', { class: 'dbody' },
      el('b', {}, el('small', { text: `#${num(d.n)} ` }), `${p.prefName} ${p.name}`),
      el('small', { text: `${d.mode || ''}${d.km ? ` ${num(d.km)}km` : ''}・${hhmm(d.at)}${d.votes ? `・${d.votes}票` : ''}` })));
}

function renderDiary() {
  const list = $('#diarylist');
  list.replaceChildren(...S.diary.slice().reverse().map(diaryItem));
}

function addDiary(d) {
  const list = $('#diarylist');
  if (list.querySelector(`li[data-n="${d.n}"]`)) return;
  list.prepend(diaryItem(d));
  while (list.children.length > T.DIARY_N) list.lastChild.remove();
}

// ---------- 共有 ----------

// スマホ（指で操作する端末）か。X を同じタブで開く（アプリに渡す）かに使う
const MOBILE = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || /iPhone|iPad|Android/i.test(navigator.userAgent);
const SITE_LABEL = '9qu1.com/tsugidoko/'; // 共有の画像に書く住所（手元で作っても本番の住所）

function shareTextNow() {
  const p = S.P[S.cur];
  return p ? shareText(p, S.km) : `みんなの投票で行き先を決める日本の旅 ${HASHTAG}`;
}

function renderShare() {
  $('#share-text').textContent = shareTextNow();
}

const xIntent = (text) => `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(SHARE_URL)}`;
// スマホは同じタブ（X のアプリに渡す）・PC は新しいタブ
function xTarget(a) {
  if (MOBILE) a.removeAttribute('target');
  else { a.target = '_blank'; a.rel = 'noopener'; }
}

// X は <a> のまま開かせる（スクリプトで window.open すると iPhone でアプリに渡らない）
function armShareLink() {
  const a = $('#share-x');
  const set = () => { a.href = xIntent(shareTextNow()); xTarget(a); };
  a.addEventListener('pointerdown', set);
  a.addEventListener('click', set);
  set();
}

// 共有の画像に描く中身（いまの町と旅の数字だけ。Wikimedia の写真や Wikipedia の文は入れない）
function cardInfo() {
  const p = S.ready ? S.P[S.cur] : null;
  const base = { hashtag: HASHTAG, site: SITE_LABEL, land: S.P };
  if (!p) return { ...base, town: null };
  return {
    ...base,
    town: { name: p.name, pref: p.prefName, lat: p.lat, lng: p.lng },
    lead: 'みんなの旅は今',
    // 2回目からは「9番目の町・2回目」
    nth: S.stops > 1 ? `${num(S.stops)}番目の町${S.curN >= 2 ? `・${num(S.curN)}回目` : ''}` : '旅のはじまり',
    stats: [
      { label: '旅の距離', value: bigKm(S.km), unit: 'km' },
      { label: 'めぐった市区町村', value: num(S.nVisited), unit: `/ ${num(S.P.length)}` },
      { label: '都道府県', value: String(S.prefN.filter((n) => n > 0).length), unit: '/ 47' },
    ],
    trail: S.diary.map((d) => S.P[d.i]).filter(Boolean),
    dots: S.P.filter((q) => bitGet(S.bits, q.i)).map((q) => ({ lat: q.lat, lng: q.lng, color: PREF_COLOR[q.pref] })),
  };
}

// 共有の窓（2回タップ: 1回目で窓を開いて画像を作り、2回目で保存する）
//   画像は窓を開いたときに作って blob URL にし、「画像を保存」の <a download> に先に入れておく（押してから作らない）
//   blob URL は窓を閉じたとき・作りなおしたときに捨てる（画像そのものは同じ町のあいだ取っておく）
const SB = { key: '', job: null, blob: null, name: '', url: '', failed: false, text: '', back: null };

function openShare() {
  if (S.stream) return;
  // 文は開いたときのもの（画像と同じ町。開いているあいだにバスが動いても変えない）
  SB.text = shareTextNow();
  $('#sb-text').textContent = SB.text;
  const xa = $('#sb-x');
  xa.href = xIntent(SB.text);
  xTarget(xa);
  SB.back = document.activeElement;
  $('#sharebox').hidden = false;
  document.addEventListener('keydown', onShareKey);
  $('#sb-card').focus({ preventScroll: true });
  prepareCard();
}

function closeShare() {
  if ($('#sharebox').hidden) return;
  $('#sharebox').hidden = true;
  document.removeEventListener('keydown', onShareKey);
  dropUrl();
  SB.back?.focus?.({ preventScroll: true });
}

// blob URL を捨てて、見本と保存のリンクからも外す
function dropUrl() {
  if (SB.url) URL.revokeObjectURL(SB.url);
  SB.url = '';
  $('#sb-img').removeAttribute('src');
  $('#sb-save').removeAttribute('href');
}

// Esc で閉じる・Tab は窓の中を回る
function onShareKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeShare(); return; }
  if (e.key !== 'Tab') return;
  const items = [...$('#sb-card').querySelectorAll('button, a[href]')].filter((x) => !x.hidden && !x.disabled);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === $('#sb-card'))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// 同じ町・同じ記録なら、前に作った画像を使い回す
function prepareCard() {
  const key = `${S.ready}|${S.seq}|${S.cur}|${S.km}`;
  if (SB.key !== key) {
    SB.key = key;
    SB.blob = null;
    SB.failed = false;
    dropUrl();
    const code = S.ready ? S.P[S.cur]?.code : '';
    SB.name = code ? `tsugidoko-${code}.png` : 'tsugidoko.png'; // ファイル名は英数字だけ
    SB.job = makeShareCard(cardInfo()).then(({ blob }) => {
      if (SB.key === key) SB.blob = blob;
    }).catch(() => {
      if (SB.key !== key) return;
      SB.failed = true;
      SB.key = ''; // 次に開いたときに作りなおす
    });
  }
  paintShare();
  SB.job.then(paintShare);
}

// 画像のできぐあいに合わせて、見本と「画像を保存」を出しわける
function paintShare() {
  if ($('#sharebox').hidden) return; // 閉じたあとにできあがったら、次に開いたときに URL を作る
  if (SB.blob && !SB.url) SB.url = URL.createObjectURL(SB.blob);
  const ready = !!SB.url;
  const img = $('#sb-img');
  if (ready && img.getAttribute('src') !== SB.url) img.src = SB.url;
  img.alt = ready ? `共有する画像: ${SB.text}` : '';
  img.hidden = !ready;
  const wait = $('#sb-wait');
  wait.hidden = ready;
  wait.textContent = SB.failed ? '画像を作れませんでした（文とURLは共有できます）' : '画像を作っています…';
  // 保存はスマホでも PC でも、ふつうのリンク（<a download>）として押させる
  const save = $('#sb-save');
  save.hidden = SB.failed;
  save.textContent = ready ? '画像を保存' : '画像を用意中…';
  if (ready) {
    save.href = SB.url;
    save.download = SB.name;
    save.removeAttribute('aria-disabled');
  } else {
    save.removeAttribute('href');
    save.setAttribute('aria-disabled', 'true');
  }
  $('#sb-note').hidden = save.hidden;
}

async function copyShare() {
  try {
    await navigator.clipboard.writeText(`${SB.text} ${SHARE_URL}`);
    toast('📋 文と住所をコピーしました');
  } catch {
    toast('コピーできませんでした', 'error');
  }
}

function armShareBox() {
  $('#share-dev').addEventListener('click', openShare);
  $('#sb-copy').addEventListener('click', copyShare);
  for (const x of document.querySelectorAll('#sharebox [data-close]')) x.addEventListener('click', closeShare);
}

// ---------- 届いたもの ----------

function applySnap(m) {
  S.skew = m.now - Date.now();
  if (m.you && m.you !== S.vid) { S.vid = m.you; LS.set('tg-vid', S.vid); }
  const tr = m.trip;
  const sameTown = S.ready && S.seq === m.seq && S.cur === tr.cur;
  S.seq = m.seq;
  S.cur = tr.cur;
  S.prev = tr.prev;
  S.leg = tr.leg;
  S.arriveAt = tr.arriveAt;
  S.endsAt = tr.endsAt;
  S.stayMs = tr.stayMs || S.stayMs;
  S.cands = tr.cands;
  S.stops = tr.stops;
  S.km = tr.km;
  S.nVisited = tr.nVisited;
  S.prefN = tr.prefN;
  S.bits = bitsFromB64(tr.visited, S.P.length);
  S.diary = m.diary || [];
  Object.assign(S.thumbs, m.wikis || {});
  S.tally = m.tally || [];
  S.my = Number.isInteger(m.my) ? m.my : -1;
  S.n = m.n || 0;
  S.curN = tr.curN || 0;
  if (m.wiki) S.wiki = m.wiki;
  if (!S.ready) {
    S.ready = true;
    document.body.classList.add('ready');
  }
  if (sameTown && !S.moving) {
    // つなぎ直しただけ（同じ町）: カードは作りなおさず、数字だけ合わせる
    updateCounts();
    renderMedia();
    return;
  }
  S.moving = false;
  S.arriving = null;
  S.firstVisit = false;
  const here = S.P[S.cur];
  map.placeBus(here);
  map.setDots(S.P, (i) => bitGet(S.bits, i));
  map.setTrail(S.diary.map((d) => S.P[d.i]));
  map.setCandidates(here, S.cands, S.P);
  map.frame(here, S.cands, S.P, false);
  hideBanner();
  renderTown();
  S.shownSeq = -1;
  renderCands();
  renderStats();
  renderStamps();
  renderDiary();
  renderShare();
}

function applyMove(m) {
  if (m.seq !== S.seq + 1) { net.resync(); return; } // 抜けがある → 取りなおす
  // 前の移動のアニメの途中に次の移動が来た → 前の町にはすぐ着いたことにする
  if (S.moving && S.arriving) S.arriving();
  S.skew = m.now - Date.now();
  const from = S.P[m.from];
  const to = S.P[m.to];
  const first = !bitGet(S.bits, m.to);
  const newPref = first && S.prefN[to.pref] === 0;
  // 締め切った結果をカードに一瞬だけ出す
  const finalCounts = m.final || [];
  const total = finalCounts.reduce((a, b) => a + b, 0);
  const ties = finalCounts.filter((n) => n === Math.max(0, ...finalCounts)).length;
  // 前の町のカードは、締め切った票数のまま見せておく（押せないようにして、勝った候補を光らせる）
  if (S.cands.length === finalCounts.length) S.tally = finalCounts;
  S.moving = true;
  S.pending = -1;
  updateCounts();
  if (m.leg?.pick != null) $('#cands').children[m.leg.pick]?.classList.add('winner');
  S.seq = m.seq;
  S.prev = m.from;
  S.cur = m.to;
  S.leg = m.leg;
  S.arriveAt = m.arriveAt;
  S.endsAt = m.endsAt;
  S.cands = m.cands;
  S.tally = m.cands.map(() => 0);
  S.my = -1;
  S.pending = -1;
  S.stops = m.stops;
  S.km = m.km;
  S.nVisited = m.nVisited;
  S.prefN = m.prefN;
  S.n = m.n ?? S.n;
  S.curN = m.curN || 0;
  bitSet(S.bits, m.to);
  S.diary.push(m.entry);
  if (S.diary.length > T.DIARY_N) S.diary.shift();
  S.wiki = m.wiki || null;
  if (m.wiki?.thumb) S.thumbs[m.to] = m.wiki.thumb;
  S.firstVisit = first;
  $('#viewers').textContent = num(S.n);
  const why = m.leg?.kind === 'jump' ? '（手元のテスト用のジャンプ）' : total === 0 ? '（だれも投票しなかったので、くじで決めました）' : ties > 1 ? '（同じ票数だったので、くじで決めました）' : `（${total}票のうち${finalCounts[m.leg.pick]}票）`;
  showBanner(`${legText(m.leg)} ${to.name}へ（${num(m.leg.km)}km）`, why);
  const ms = Math.max(0, m.arriveAt - now());
  S.arriving = () => arrive(to, first, newPref);
  tick();
  map.travel(from, to, ms, S.arriving);
}

function arrive(to, first, newPref) {
  if (!S.moving) return;
  S.moving = false;
  S.arriving = null;
  hideBanner();
  map.addDot(to);
  map.addTrail(to);
  map.setCandidates(to, S.cands, S.P);
  map.frame(to, S.cands, S.P, !document.hidden);
  renderTown();
  renderCands();
  renderStats();
  renderStamps();
  addDiary(S.diary[S.diary.length - 1]);
  renderShare();
  tick();
  if (newPref) toast(`🎌 ${to.prefName}のスタンプをゲット！`);
  else toast(`📍 ${to.name}に着きました`);
}

function showBanner(main, sub) {
  const b = $('#movebanner');
  b.replaceChildren(el('b', { text: main }), el('small', { text: sub }));
  b.hidden = false;
}
function hideBanner() {
  $('#movebanner').hidden = true;
}

function onMessage(m) {
  switch (m.t) {
    case 'snap':
      applySnap(m);
      return;
    case 'move':
      applyMove(m);
      return;
    case 'tally':
      if (m.seq !== S.seq) return;
      S.tally = m.c;
      S.n = m.n;
      if (!S.moving) updateCounts();
      else $('#viewers').textContent = num(S.n);
      return;
    case 'wiki':
      if (m.w?.thumb) S.thumbs[m.i] = m.w.thumb;
      if (m.i !== S.cur) return;
      S.wiki = m.w;
      if (!S.moving) renderMedia();
      return;
    case 'my':
      if (m.seq !== S.seq) return;
      S.my = m.c;
      updateCounts();
      return;
    default:
  }
}

// ---------- 配信の画面 ----------

function setupStream() {
  document.body.classList.add('stream');
  // 1920×1080 の舞台を、窓の大きさに合わせて縮める
  const fit = () => {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    document.documentElement.style.setProperty('--stage', String(s));
  };
  fit();
  addEventListener('resize', fit);
  const join = $('#join');
  join.hidden = false;
  $('#join-url').textContent = SHARE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
  // QR コード（qrcode-generator。配信の画面のときだけ読む）
  const sc = document.createElement('script');
  sc.src = 'vendor/qrcode/qrcode.js?v=1.4.4';
  sc.onload = () => {
    try {
      const q = window.qrcode(0, 'M');
      q.addData(SHARE_URL);
      q.make();
      $('#qr').innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    } catch {}
  };
  document.head.append(sc);
  // 記録とスタンプは地図の上にのせる
  const mw = $('#mapwrap');
  mw.append($('#stats'), $('#stamps'), $('#town-body'));
}

// ---------- はじまり ----------

let map = null;
let net = null;

async function main() {
  if (STREAM) setupStream();
  let data;
  for (let k = 0; k < 4 && !data; k++) {
    try {
      const res = await fetch(`places.json?v=${VERSION}`);
      if (res.ok) data = await res.json();
    } catch {}
    if (!data) await new Promise((r) => setTimeout(r, 1500 * (k + 1)));
  }
  if (!data) { toast('データを読めません。再読み込みしてね', 'error'); return; }
  S.P = loadPlaces(data);
  S.bits = bitsNew(S.P.length);
  $('#data-date').textContent = `・${data.fetchedAt} 取得`;
  map = new TripMap($('#map'), { stream: STREAM });
  buildStamps();
  armShareLink();
  armShareBox();
  setInterval(tick, 250);
  addEventListener('resize', () => map.invalidate());
  net = new Net({
    always: STREAM,
    hello: () => ({ vid: S.vid, seq: S.seq, vote: S.my >= 0 ? { seq: S.seq, c: S.my } : null, stream: STREAM }),
    onMessage,
    onStatus: netStatus,
    onReload: () => {
      // 新しい版がある → 読みなおす（くりかえし読みなおさないように、30秒に1回まで）
      let last = 0;
      try { last = Number(sessionStorage.getItem('tg-reload')) || 0; } catch {}
      if (Date.now() - last > 30000) {
        try { sessionStorage.setItem('tg-reload', String(Date.now())); } catch {}
        location.reload();
      } else {
        toast('新しい版があります。再読み込みしてね', 'error');
      }
    },
  });
  net.connect();
  // テストと調べもの用（中を見るだけ）
  window.tg = { S, map, net, castVote, redraw: () => { updateCounts(); tick(); }, version: VERSION, prod: IS_PROD_PAGE, cardInfo, makeShareCard, openShare, share: SB };
}

main();
