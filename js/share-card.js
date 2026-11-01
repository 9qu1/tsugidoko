// 共有の画像（結果カード・1200×630 の PNG）を canvas で作る
//   背景は地図（国土地理院の淡色地図のタイルを canvas に描く）。通ってきた道・行った町の点・バス・いまの町のピンを重ねる
//   左に札: 題名「ツギドコ？」・いまの町（大きく）・旅の数字・#ツギドコ・9qu1.com/tsugidoko/
//   タイルは crossOrigin='anonymous' で読む（地理院タイルは Origin を付けてたずねると Access-Control-Allow-Origin: * を返す）
//   読めないタイルが残ったら、町の点で日本の形をかんたんに描く（そのときは地図の出典の文字も入れない）
//   Wikimedia の写真や Wikipedia の文は入れない（作者の表示が要るライセンスのため）。町の名前と数字だけ
import { TILE_URL } from './config.js?v=0.1.2';

export const CARD_W = 1200;
export const CARD_H = 630;
const FAMILY = 'M PLUS Rounded 1c';
const FONT = `"${FAMILY}", "Hiragino Maru Gothic ProN", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif`;
const INK = '#1f2a44', SUB = '#5d6b85', ACCENT = '#ef5a3c', PAPER = 'rgba(255, 247, 236, 0.96)', SOFT = '#f6ede1';
const CREDIT = '地図：出典 国土地理院';
const BUBBLE = '次どこ？';
const DIGITS = '0123456789,./万km'; // 数字はいつも読んでおく（旅が進むと出てくる字が変わるので）

// 札（左）と、地図で見せたいところ（右・いまの町と最近の道をここに入れる）
const PANEL = { x: 36, y: 36, w: 600, h: 558 };
const IN_X = PANEL.x + 44, IN_R = PANEL.x + PANEL.w - 40; // 札の中の左右
const FOCUS = { x: 716, y: 170, w: 410, h: 360 };
const Z_MIN = 5, Z_MAX = 8; // 8 より寄ると道が混みあって、日本のどのあたりか分かりにくい
const FIT_N = 16; // 地図に入れる最近の道（町の数）

// ---------- 地図の計算（Web メルカトル・タイル 256px） ----------

const TS = 256;
const wx = (lng, z) => ((lng + 180) / 360) * TS * 2 ** z;
const wy = (lat, z) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TS * 2 ** z;
};

// 世界の点 (cx, cy) を FOCUS のまんなかに置く（タイルが画素にぴったり重なるように整数にする）
const viewAt = (z, cx, cy) => ({ z, ox: Math.round(cx - (FOCUS.x + FOCUS.w / 2)), oy: Math.round(cy - (FOCUS.y + FOCUS.h / 2)) });

// pts が FOCUS に入るいちばん大きいズーム（Z_MIN でも入らなければ、いまの町 here をまんなかに）
function fitView(pts, here) {
  for (let z = Z_MAX; z >= Z_MIN; z--) {
    const xs = pts.map((p) => wx(p.lng, z)), ys = pts.map((p) => wy(p.lat, z));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (x1 - x0 <= FOCUS.w && y1 - y0 <= FOCUS.h) return viewAt(z, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  return viewAt(Z_MIN, wx(here.lng, Z_MIN), wy(here.lat, Z_MIN));
}

// ---------- タイル ----------

const tileCache = new Map(); // 住所 → 読めた画像（読めなかったものは入れない＝次にまた読む）

function loadTile(url, ms) {
  if (tileCache.has(url)) return Promise.resolve(tileCache.get(url));
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // これがないと canvas が汚れて PNG にできない
    const t = setTimeout(() => { img.onload = img.onerror = null; resolve(null); }, ms);
    img.onload = () => { clearTimeout(t); tileCache.set(url, img); resolve(img); };
    img.onerror = () => { clearTimeout(t); resolve(null); };
    img.src = url;
  });
}

function tilesFor(v) {
  const n = 2 ** v.z;
  const out = [];
  for (let ty = Math.floor(v.oy / TS); ty <= Math.floor((v.oy + CARD_H - 1) / TS); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(v.ox / TS); tx <= Math.floor((v.ox + CARD_W - 1) / TS); tx++) {
      const x = ((tx % n) + n) % n;
      out.push({ url: TILE_URL.replace('{z}', v.z).replace('{x}', x).replace('{y}', ty), dx: tx * TS - v.ox, dy: ty * TS - v.oy });
    }
  }
  return out;
}

// 全部読めたら画像の配列、1枚でも読めなければ null（1回目で読めなかったものは、もう1回だけ）
async function loadTiles(list) {
  let imgs = await Promise.all(list.map((t) => loadTile(t.url, 7000)));
  if (imgs.some((x) => !x)) imgs = await Promise.all(list.map((t, k) => imgs[k] || loadTile(t.url, 5000)));
  return imgs.every(Boolean) ? imgs : null;
}

// ---------- 文字 ----------

const font = (w, px) => `${w} ${px}px ${FONT}`;

// 描く文字を太さごとに読んでおく（Google Fonts の日本語は文字ごとに分かれていて、渡した字しか読まない）
async function loadFonts(byWeight) {
  if (!document.fonts?.load) return;
  await Promise.all(Object.entries(byWeight).map(([w, text]) => document.fonts.load(`${w} 40px "${FAMILY}"`, text).catch(() => [])));
}

// 幅 maxW に入る大きさ（max から min まで）。min でも入らなければ横に縮めて描く
function fitText(ctx, text, weight, max, min, maxW) {
  let s = max;
  ctx.font = font(weight, s);
  let w = ctx.measureText(text).width;
  if (w > maxW) {
    s = Math.max(min, Math.floor((max * maxW) / w));
    ctx.font = font(weight, s);
    w = ctx.measureText(text).width;
    while (w > maxW && s > min) { s -= 1; ctx.font = font(weight, s); w = ctx.measureText(text).width; }
  }
  return { size: s, width: Math.min(w, maxW), squeeze: w > maxW ? maxW / w : 1 };
}

// fitText で決めた大きさで描く（align: left / right / center）
function drawText(ctx, text, x, y, weight, f, color, align = 'left', meta = null) {
  ctx.save();
  ctx.font = font(weight, f.size);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.translate(x, y);
  if (f.squeeze < 1) { ctx.scale(f.squeeze, 1); if (meta) meta.squeezed += 1; }
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// ---------- 絵 ----------

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// アイコン（favicon.svg と同じ形: 赤い角丸の四角に白いピン）
const PIN = 'M32 9c-9.4 0-17 7.4-17 16.6C15 38 32 55 32 55s17-17 17-29.4C49 16.4 41.4 9 32 9z';
function drawIcon(ctx, x, y, size) {
  const k = size / 64;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  rr(ctx, 0, 0, 64, 64, 16);
  ctx.fillStyle = ACCENT;
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fill(new Path2D(PIN));
  ctx.beginPath();
  ctx.arc(32, 25.5, 7, 0, Math.PI * 2);
  ctx.fillStyle = ACCENT;
  ctx.fill();
  ctx.restore();
}

// いまの町のピン（先が (x, y)）
function drawPin(ctx, x, y) {
  const k = 1.6;
  ctx.save();
  ctx.translate(x - 32 * k, y - 55 * k);
  ctx.scale(k, k);
  const p = new Path2D(PIN);
  ctx.shadowColor = 'rgba(31, 42, 68, 0.3)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = ACCENT;
  ctx.fill(p);
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#fff';
  ctx.stroke(p);
  ctx.beginPath();
  ctx.arc(32, 25.5, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();
  return 46 * k; // ピンの高さ
}

// バス（og.png と同じ形。左上が (x, y)・幅 90）
function drawBus(ctx, x, y) {
  const k = 0.75;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.fillStyle = 'rgba(31, 42, 68, 0.2)';
  rr(ctx, 6, 16, 108, 56, 16);
  ctx.fill();
  rr(ctx, 6, 8, 108, 56, 16);
  ctx.fillStyle = '#f7a531';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  for (const wx0 of [18, 48, 78]) { rr(ctx, wx0, 18, 24, 18, 4); ctx.fill(); }
  ctx.fillStyle = ACCENT;
  ctx.fillRect(10, 44, 100, 6);
  ctx.fillStyle = INK;
  for (const cx of [34, 86]) { ctx.beginPath(); ctx.arc(cx, 66, 10, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

// 地図（タイル、または町の点で描いた日本の形）＋道・点・バス・ピン
function drawMap(ctx, v, info, imgs, tiles) {
  ctx.fillStyle = imgs ? '#e9eef2' : '#cddff0';
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const px = (p) => [wx(p.lng, v.z) - v.ox, wy(p.lat, v.z) - v.oy];
  if (imgs) {
    tiles.forEach((t, k) => ctx.drawImage(imgs[k], t.dx, t.dy, TS, TS));
  } else {
    // タイルなし: 町の代表地点に丸を描いて陸のかわりにする（ズームに合わせて大きく）
    const r = 4 * 2 ** (v.z - Z_MIN);
    ctx.fillStyle = '#f5f1e8';
    for (const p of info.land || []) {
      const [x, y] = px(p);
      if (x < -r || y < -r || x > CARD_W + r || y > CARD_H + r) continue;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const trail = (info.trail || []).map(px);
  if (trail.length > 1) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const [w, c] of [[11, 'rgba(255, 255, 255, 0.85)'], [6, 'rgba(239, 90, 60, 0.85)']]) {
      ctx.beginPath();
      trail.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineWidth = w;
      ctx.strokeStyle = c;
      ctx.stroke();
    }
  }
  for (const d of info.dots || []) {
    const [x, y] = px(d);
    if (x < -10 || y < -10 || x > CARD_W + 10 || y > CARD_H + 10) continue;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = d.color;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
  if (!info.town) return;
  const [hx, hy] = px(info.town);
  // バスはピンの横。来た道にかぶらないように、前の町と反対の側へ（入らない側には置かない）
  const prev = trail.length > 1 ? trail[trail.length - 2] : null;
  const roomR = hx + 22 + 90 < CARD_W - 12, roomL = hx - 22 - 90 > PANEL.x + PANEL.w + 12;
  const right = roomR && (!roomL || !prev || prev[0] <= hx);
  drawBus(ctx, right ? hx + 22 : hx - 22 - 90, hy - 50);
  const ph = drawPin(ctx, hx, hy);
  // ふきだし「次どこ？」
  const f = fitText(ctx, BUBBLE, 800, 28, 28, 400);
  const bw = Math.ceil(f.width) + 36, bh = 50, by = hy - ph - 20 - bh;
  ctx.fillStyle = INK;
  rr(ctx, hx - bw / 2, by, bw, bh, 25);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(hx - 9, by + bh - 1);
  ctx.lineTo(hx + 9, by + bh - 1);
  ctx.lineTo(hx, by + bh + 11);
  ctx.closePath();
  ctx.fill();
  drawText(ctx, BUBBLE, hx, by + 35, 800, f, '#fff', 'center');
}

// 左の札
function drawPanel(ctx, info, meta) {
  const P = PANEL;
  ctx.fillStyle = 'rgba(31, 42, 68, 0.18)';
  rr(ctx, P.x, P.y + 12, P.w, P.h, 34);
  ctx.fill();
  rr(ctx, P.x, P.y, P.w, P.h, 34);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  ctx.stroke();

  // 題名「ツギドコ？」（ドコだけ赤。og.png と同じ）
  drawIcon(ctx, IN_X, 70, 52);
  let x = IN_X + 66;
  for (const [s, c] of [['ツギ', INK], ['ドコ', ACCENT], ['？', INK]]) {
    const f = fitText(ctx, s, 800, 46, 46, 400);
    drawText(ctx, s, x, 113, 800, f, c);
    x += f.width;
  }
  const W = IN_R - IN_X;
  if (info.town) {
    // みんなの旅は今 ／ 何番目の町
    const lead = fitText(ctx, info.lead, 700, 28, 20, W * 0.55);
    drawText(ctx, info.lead, IN_X, 190, 700, lead, SUB, 'left', meta);
    const nf = fitText(ctx, info.nth, 800, 22, 16, W - lead.width - 20 - 32); // 「9番目の町・2回目」も入るように、あいた幅いっぱいまで
    const pw = Math.ceil(nf.width) + 32;
    rr(ctx, IN_R - pw, 160, pw, 42, 21);
    ctx.fillStyle = ACCENT;
    ctx.fill();
    drawText(ctx, info.nth, IN_R - pw / 2, 189, 800, nf, '#fff', 'center', meta);
    // 都道府県と町の名前（町は入るいちばん大きい字で。上下はまんなかに）
    drawText(ctx, info.town.pref, IN_X, 246, 800, fitText(ctx, info.town.pref, 800, 40, 24, W), INK, 'left', meta);
    const nm = fitText(ctx, info.town.name, 800, 116, 48, W);
    meta.nameSize = nm.size;
    meta.nameWidth = Math.round(nm.width);
    drawText(ctx, info.town.name, IN_X, Math.round(328 + nm.size * 0.36), 800, nm, INK, 'left', meta);
    // 旅の数字（画面の「記録」と同じ3つ。幅は 1 : 1.25 : 0.85）
    const gap = 12, ratio = [1, 1.25, 0.85], unit = (W - gap * 2) / ratio.reduce((a, b) => a + b, 0);
    let bx = IN_X;
    (info.stats || []).slice(0, 3).forEach((st, k) => {
      const bw = Math.round(unit * ratio[k]), top = 404, bh = 104;
      rr(ctx, bx, top, bw, bh, 16);
      ctx.fillStyle = SOFT;
      ctx.fill();
      drawText(ctx, st.label, bx + 16, top + 34, 700, fitText(ctx, st.label, 700, 20, 14, bw - 28), SUB, 'left', meta);
      // 数字と単位をいっしょに入れる
      const uf = fitText(ctx, st.unit, 700, 20, 14, bw);
      const vf = fitText(ctx, st.value, 800, 42, 22, bw - 28 - uf.width - 4);
      drawText(ctx, st.value, bx + 14, top + 84, 800, vf, INK, 'left', meta);
      drawText(ctx, st.unit, bx + 14 + vf.width + 4, top + 84, 700, uf, SUB);
      bx += bw + gap;
    });
  } else {
    // まだ町が分からないとき: 遊びの説明
    [['みんなの投票で', INK], ['行き先を決める', INK], ['日本の旅', ACCENT]].forEach(([s, c], k) => {
      drawText(ctx, s, IN_X, 222 + k * 82, 800, fitText(ctx, s, 800, 60, 30, W), c, 'left', meta);
    });
    const s = '1台のバスが、日本の市区町村をめぐります';
    drawText(ctx, s, IN_X, 440, 700, fitText(ctx, s, 700, 24, 16, W), SUB, 'left', meta);
  }
  // ハッシュタグと住所
  const hf = fitText(ctx, info.hashtag || '', 800, 30, 20, W * 0.4);
  drawText(ctx, info.hashtag || '', IN_X, 562, 800, hf, ACCENT, 'left', meta);
  drawText(ctx, info.site || '', IN_R, 562, 800, fitText(ctx, info.site || '', 800, 26, 16, W - hf.width - 20), INK, 'right', meta);
}

function drawCredit(ctx) {
  const f = fitText(ctx, CREDIT, 800, 20, 20, 400);
  const w = Math.ceil(f.width) + 20;
  rr(ctx, CARD_W - 14 - w, CARD_H - 12 - 32, w, 32, 8);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
  ctx.fill();
  drawText(ctx, CREDIT, CARD_W - 14 - w / 2, CARD_H - 12 - 9, 800, f, INK, 'center');
}

// ---------- 入口 ----------

// info: {
//   town: { name, pref, lat, lng } または null（まだ町が分からない）
//   lead: 'みんなの旅は今'・nth: '12番目の町'・stats: [{ label, value, unit }]×3
//   trail: 通ってきた町 [{ lat, lng }]（古い順・最後がいまの町）・dots: 行った町 [{ lat, lng, color }]
//   land: 全部の町 [{ lat, lng }]（タイルが読めないときに日本の形を描く）・hashtag・site
// }
// → { blob: PNG, meta: { tiles: 地図のタイルを描けたか, z, nameSize, squeezed: 横に縮めた文字の数 } }
export async function makeShareCard(info) {
  const here = info.town || { lat: 36.6, lng: 137.6 }; // 町がないときは日本のまんなかを広く
  const v = info.town ? fitView([...(info.trail || []).slice(-FIT_N), here], here) : viewAt(Z_MIN, wx(here.lng, Z_MIN), wy(here.lat, Z_MIN));
  const tiles = tilesFor(v);
  // 太さごとに、描く文字を全部つなげて読む
  const t = info.town;
  const s800 = ['ツギドコ？', BUBBLE, CREDIT, info.hashtag, info.site, DIGITS];
  const s700 = [DIGITS];
  if (t) {
    s800.push(t.name, t.pref, info.nth, ...(info.stats || []).map((x) => x.value));
    s700.push(info.lead, ...(info.stats || []).flatMap((x) => [x.label, x.unit]));
  } else {
    s800.push('みんなの投票で行き先を決める日本の旅');
    s700.push('1台のバスが、日本の市区町村をめぐります');
  }
  const [, imgs] = await Promise.all([
    loadFonts({ 800: s800.filter(Boolean).join(''), 700: s700.filter(Boolean).join('') }),
    loadTiles(tiles),
  ]);
  const draw = (useTiles) => {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext('2d');
    const meta = { tiles: !!useTiles, z: v.z, nameSize: 0, nameWidth: 0, squeezed: 0 };
    drawMap(ctx, v, info, useTiles, tiles);
    drawPanel(ctx, info, meta);
    if (useTiles) drawCredit(ctx);
    return { canvas, ctx, meta };
  };
  let out = draw(imgs);
  if (imgs) {
    // 念のため: canvas が汚れていたら（CORS が通らなかった）タイルなしで描きなおす
    try { out.ctx.getImageData(0, 0, 1, 1); } catch { out = draw(null); }
  }
  const blob = await new Promise((r) => out.canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('画像を作れませんでした');
  return { blob, meta: out.meta };
}
