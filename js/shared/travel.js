// 旅の計算（サーバーと画面とテストの3つが同じものを読む）
//   距離・方角・次の行き先の候補の選び方・乗り物の言い方
import { PREFS } from './prefs.js?v=0.1.0';

export const VERSION = '0.1.0';

export const T = {
  STAY_SEC: 25, // 1つの町にいる時間（投票の時間）。手元は .dev.vars の STAY_SEC で短くできる
  STAY_MIN_PROD: 15, // 本番ではこれより短くしない（まちがった値で目覚ましが鳴りっぱなしにならないように）
  MOVE_MS: 4000, // 次の町へ動くアニメの時間（このあいだも次の投票はできる）
  RECENT_N: 40, // 最近行った町（候補から外す）
  NEAR_POOL: 12, // 近くの町の候補を選ぶもと（近い順）
  NEAR_MAX_KM: 120, // 「近く」とみなす上限（これより遠いのは近くの候補にしない）
  EXTRA_CHANCE: 0.5, // 4つ目の候補（遠出・島へ）が出る確率
  ISLAND_CHANCE: 0.35, // 4つ目が出るとき、島が近くにあれば島にする確率
  FAR_MIN_KM: 80,
  FAR_MAX_KM: 300,
  ISLAND_MAX_KM: 300,
  DIARY_N: 120, // 画面に送る日記の件数（最近のぶん）
  START_CODE: '13102', // スタート: 東京都中央区（日本橋）
  VOTES_PER_IP: 20, // 1つの回線から1回の投票で数える端末の数（家族・学校・スマホの回線の共有（CGNAT）で数台〜数十台ある）
};

// ---------- 町のデータ ----------

// places.json（列の名前が先頭に1回だけの形）→ 町の配列
export function loadPlaces(data) {
  const ix = Object.fromEntries(data.cols.map((c, k) => [c, k]));
  return data.rows.map((r, i) => {
    const group = data.groups[r[ix.group]];
    const pref = r[ix.pref];
    return {
      i,
      code: r[ix.code],
      name: r[ix.name],
      pref,
      prefName: data.prefs[pref],
      lat: r[ix.lat],
      lng: r[ix.lng],
      title: r[ix.title],
      img: r[ix.img],
      pop: r[ix.pop],
      group,
      island: group !== '本土',
      main: mainIsland(pref),
    };
  });
}

// 本土の4つの島（海峡をこえるかどうかに使う）
export function mainIsland(pref) {
  if (pref === 0) return '北海道';
  if (pref >= 35 && pref <= 38) return '四国';
  if (pref >= 39 && pref <= 45) return '九州';
  if (pref === 46) return '沖縄';
  return '本州';
}

// ---------- 距離と方角 ----------

const RAD = Math.PI / 180;
export function distKm(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// 北を0度・時計回り
export function bearing(a, b) {
  const y = Math.sin((b.lng - a.lng) * RAD) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lng - a.lng) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

export const DIRS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
export const dirName = (deg) => DIRS[Math.round(deg / 45) % 8];

// 2つの方角の差（0〜180度）
export function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// ---------- 乗り物 ----------

// 本土の島と島のあいだの海峡（近くの候補で、ちがう島へわたるとき）
const STRAITS = {
  '北海道|本州': { icon: '⛴', label: '津軽海峡をこえて' },
  '本州|四国': { icon: '🌉', label: '瀬戸内海をこえて' },
  '本州|九州': { icon: '🌉', label: '関門海峡をこえて' },
  '四国|九州': { icon: '⛴', label: '豊後水道をこえて' },
};

export function travelMode(from, to, kind, km) {
  if (from.group !== to.group) {
    // 島へ・島から（橋がない）
    if (from.group === '小笠原諸島' || to.group === '小笠原諸島') return { icon: '🚢', label: '船で' };
    if (km < 150) return { icon: '⛴', label: 'フェリーで' };
    if (km < 600 && (from.group === '本土' || to.group === '本土')) return { icon: '⛴', label: '船と列車で' };
    return km < 300 ? { icon: '⛴', label: 'フェリーで' } : { icon: '✈', label: '飛行機で' };
  }
  const pair = [from.main, to.main].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).join('|');
  if (kind === 'far') {
    // 新幹線が通っているのは本州・九州・北海道（青函トンネル）。四国は特急、四国と九州のあいだは船
    const rail = (m) => m === '本州' || m === '九州' || m === '北海道';
    const bullet = from.main === to.main ? km >= 150 && (from.main === '本州' || from.main === '九州') : rail(from.main) && rail(to.main);
    if (bullet) return { icon: '🚄', label: '新幹線で' };
    if (pair === '四国|九州') return { icon: '⛴', label: 'フェリーで' };
    return { icon: '🚃', label: '特急で' };
  }
  if (from.main !== to.main) return STRAITS[pair] || { icon: '⛴', label: 'フェリーで' };
  if (km < 25) return { icon: '🚌', label: 'バスで' };
  return { icon: '🚃', label: '電車で' };
}
const ORDER = ['北海道', '本州', '四国', '九州', '沖縄'];

// ---------- 次の行き先の候補 ----------

// 乱数（テストで同じ結果を出せるように、種から作れるもの）
export function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 方角がばらけるように k 件えらぶ
//   pool は近い順。すべての組み合わせ（12件から3件なら220通り）に点をつけて、いちばん高い組を取る
//   点 = 方角のひらき（いちばんせまい2つの差。100度で頭打ち）− 遠さ ＋ すこしの偶然
//   taken は先に決まった候補の方角（それとも離れるように）
export function spreadPick(pool, k, rng, taken = []) {
  if (pool.length <= k) return pool.slice();
  const ref = Math.max(1, pool[Math.min(pool.length - 1, 2)].km);
  const jitter = pool.map(() => rng() * 0.5);
  let best = null, bestScore = -Infinity;
  const pick = [];
  const rec = (start) => {
    if (pick.length === k) {
      const brgs = [...taken, ...pick.map((c) => c.brg)];
      let minAng = 180;
      for (let a = 0; a < brgs.length; a++) for (let b = a + 1; b < brgs.length; b++) minAng = Math.min(minAng, angleDiff(brgs[a], brgs[b]));
      let far = 0, jit = 0;
      for (const c of pick) { far += c.km / ref; jit += jitter[c.idx]; }
      const score = (Math.min(minAng, 100) / 100) * 3 - far / k + jit / k;
      if (score > bestScore) { bestScore = score; best = pick.slice(); }
      return;
    }
    for (let j = start; j < pool.length; j++) {
      pick.push(pool[j]);
      rec(j + 1);
      pick.pop();
    }
  };
  pool.forEach((c, idx) => { c.idx = idx; });
  rec(0);
  return best;
}

// 今いる町 cur から、次の行き先の候補（近くの3つ＋ときどき遠出か島）を選ぶ
//   recent: 最近行った町の番号の Set（外す）・visited: 行ったことのある町の判定（遠出は行ったことのない町を先に）
export function pickCandidates(P, cur, { recent = new Set(), visited = () => false, rng = Math.random, extraChance = T.EXTRA_CHANCE } = {}) {
  const here = P[cur];
  const withInfo = (p) => ({ i: p.i, km: distKm(here, p), brg: bearing(here, p) });
  let all = [];
  for (const p of P) if (p.i !== cur && !recent.has(p.i)) all.push(withInfo(p));
  // 最近行った町ばかりで足りないときは、最近の町もゆるす
  if (all.length < 4) all = P.filter((p) => p.i !== cur).map(withInfo);
  all.sort((a, b) => a.km - b.km);

  // 近くの3つ: 同じ陸続き（同じ島）から
  const same = all.filter((c) => P[c.i].group === here.group && c.km <= T.NEAR_MAX_KM).slice(0, T.NEAR_POOL);
  const near = spreadPick(same, 3, rng).map((c) => ({ ...c, kind: 'near' }));
  // 島で町が足りない → 海をわたった先の近い町で埋める
  if (near.length < 3) {
    const used = new Set(near.map((c) => c.i));
    const sea = all.filter((c) => !used.has(c.i) && P[c.i].group !== here.group).slice(0, 8);
    const fill = spreadPick(sea, 3 - near.length, rng, near.map((c) => c.brg));
    near.push(...fill.map((c) => ({ ...c, kind: 'sea' })));
  }
  // それでも足りない（本土で近くが最近の町ばかり）→ 近い順で埋める
  if (near.length < 3) {
    const used = new Set(near.map((c) => c.i));
    for (const c of all) {
      if (near.length >= 3) break;
      if (!used.has(c.i)) near.push({ ...c, kind: P[c.i].group === here.group ? 'near' : 'sea' });
    }
  }
  const out = near;

  // 4つ目: 遠出か島へ
  if (rng() < extraChance) {
    const used = new Set(out.map((c) => c.i));
    let extra = null;
    if (here.group === '本土' && rng() < T.ISLAND_CHANCE) {
      const isl = all.filter((c) => !used.has(c.i) && P[c.i].group !== here.group && c.km <= T.ISLAND_MAX_KM).slice(0, 5);
      if (isl.length) extra = { ...isl[Math.floor(rng() * isl.length)], kind: 'island' };
    }
    if (!extra) {
      const far = all.filter((c) => !used.has(c.i) && c.km >= T.FAR_MIN_KM && c.km <= T.FAR_MAX_KM);
      const fresh = far.filter((c) => !visited(c.i));
      const from = fresh.length ? fresh : far;
      if (from.length) extra = { ...from[Math.floor(rng() * from.length)], kind: 'far' };
    }
    if (extra) out.push(extra);
  }

  // 画面に出す形（近くの候補は北から時計回りの順。遠出・島はいちばん最後）
  const nearOnes = out.filter((c) => c.kind === 'near' || c.kind === 'sea').sort((a, b) => a.brg - b.brg);
  const extras = out.filter((c) => c.kind === 'far' || c.kind === 'island');
  return [...nearOnes, ...extras].map((c) => {
    const m = travelMode(here, P[c.i], c.kind, c.km);
    return { i: c.i, km: Math.round(c.km), dir: dirName(c.brg), brg: Math.round(c.brg), kind: c.kind, icon: m.icon, mode: m.label };
  });
}

// ---------- 投票の集計 ----------

// counts: 候補ごとの票の数 → 行き先の番号（同数はランダム・0票もランダム）
export function decideWinner(counts, rng = Math.random) {
  const max = Math.max(0, ...counts);
  const tops = counts.map((n, k) => (n === max ? k : -1)).filter((k) => k >= 0);
  return tops[Math.floor(rng() * tops.length)];
}

// ---------- 行った町の記録（1町1ビット） ----------

export function bitsNew(n) {
  return new Uint8Array(Math.ceil(n / 8));
}
export const bitGet = (b, i) => (b[i >> 3] >> (i & 7)) & 1;
export function bitSet(b, i) {
  b[i >> 3] |= 1 << (i & 7);
}
export function bitsToB64(b) {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
export function bitsFromB64(s, n) {
  const out = bitsNew(n);
  try {
    const bin = atob(s || '');
    for (let k = 0; k < Math.min(bin.length, out.length); k++) out[k] = bin.charCodeAt(k);
  } catch {}
  return out;
}

// ---------- 文 ----------

export const placeLabel = (p) => `${p.prefName}${p.name}`;
export const prefOf = (k) => PREFS[k];

// 共有の文（X の投稿画面・端末の共有）
export function shareText(p, km) {
  return `みんなの旅は今 ${p.prefName}${p.name}。ここまで ${Math.round(km).toLocaleString('ja-JP')}km。次どこ行く？ #ツギドコ`;
}
