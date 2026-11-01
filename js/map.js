// 地図（Leaflet ＋ 国土地理院の淡色地図）
//   旅人のバス・通ってきた線・行ったことのある町の点・次の候補の札をのせる
import { TILE_URL, TILE_CREDIT } from './config.js?v=0.1.2';
import { PREF_COLOR } from './shared/prefs.js?v=0.1.2';

const L = window.L;
export const CAND_COLORS = ['#ef5a3c', '#2f7fe0', '#1f9d63', '#9254de'];

// 旅人（小さなバス）の絵
const BUS_SVG = `<svg viewBox="0 0 64 56" width="44" height="38" aria-hidden="true">
  <ellipse cx="32" cy="51" rx="22" ry="4" fill="rgba(0,0,0,.18)"/>
  <rect x="6" y="8" width="52" height="36" rx="10" fill="#ff8a3d" stroke="#fff" stroke-width="3"/>
  <rect x="6" y="30" width="52" height="6" fill="#ffd166"/>
  <rect x="12" y="13" width="12" height="11" rx="3" fill="#dff3ff"/>
  <rect x="26" y="13" width="12" height="11" rx="3" fill="#dff3ff"/>
  <rect x="40" y="13" width="12" height="11" rx="3" fill="#dff3ff"/>
  <circle cx="18" cy="45" r="6" fill="#33405a" stroke="#fff" stroke-width="2"/>
  <circle cx="46" cy="45" r="6" fill="#33405a" stroke="#fff" stroke-width="2"/>
  <circle cx="54" cy="36" r="2.5" fill="#fff6c2"/>
</svg>`;

export class TripMap {
  constructor(el, { stream = false } = {}) {
    this.stream = stream;
    this.map = L.map(el, {
      zoomControl: false,
      attributionControl: true,
      minZoom: 5,
      maxZoom: 15,
      zoomSnap: 0.25,
      maxBounds: [[17, 116], [49, 158]],
      maxBoundsViscosity: 0.8,
      preferCanvas: true,
    }).setView([35.68, 139.77], 10);
    if (!stream) L.control.zoom({ position: 'bottomleft', zoomInTitle: '拡大', zoomOutTitle: '縮小' }).addTo(this.map);
    this.map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    this.tiles = L.tileLayer(TILE_URL, { minZoom: 5, maxZoom: 18, attribution: TILE_CREDIT, crossOrigin: false }).addTo(this.map);
    this.renderer = L.canvas({ padding: 0.3 });
    this.dotLayer = L.layerGroup().addTo(this.map);
    this.trail = L.polyline([], { color: '#ef5a3c', weight: 3, opacity: 0.55, renderer: this.renderer, interactive: false }).addTo(this.map);
    this.candLayer = L.layerGroup().addTo(this.map);
    this.bus = L.marker([35.68, 139.77], {
      icon: L.divIcon({ className: 'bus-icon', html: BUS_SVG, iconSize: [44, 38], iconAnchor: [22, 34] }),
      zIndexOffset: 1000,
      keyboard: false,
      interactive: false,
    }).addTo(this.map);
    this.dots = new Map();
    this.candParts = [];
    this.anim = 0;
  }

  // 行ったことのある町の点（県の色）
  addDot(p) {
    if (this.dots.has(p.i)) return;
    const c = L.circleMarker([p.lat, p.lng], {
      renderer: this.renderer, radius: this.stream ? 4 : 3, weight: 1, color: '#fff', fillColor: PREF_COLOR[p.pref], fillOpacity: 0.95, interactive: false,
    }).addTo(this.dotLayer);
    this.dots.set(p.i, c);
  }

  setDots(P, has) {
    this.dotLayer.clearLayers();
    this.dots.clear();
    for (const p of P) if (has(p.i)) this.addDot(p);
  }

  setTrail(points) {
    this.trail.setLatLngs(points.map((p) => [p.lat, p.lng]));
  }

  addTrail(p) {
    this.trail.addLatLng([p.lat, p.lng]);
    const n = this.trail.getLatLngs().length;
    if (n > 160) this.trail.setLatLngs(this.trail.getLatLngs().slice(n - 160));
  }

  placeBus(p) {
    cancelAnimationFrame(this.anim);
    this.bus.setLatLng([p.lat, p.lng]);
  }

  // 次の候補の札と点線
  setCandidates(here, cands, P) {
    this.candLayer.clearLayers();
    this.candParts = cands.map((c, k) => {
      const to = P[c.i];
      const color = CAND_COLORS[k % CAND_COLORS.length];
      const line = L.polyline([[here.lat, here.lng], [to.lat, to.lng]], {
        color, weight: 3, opacity: 0.85, dashArray: '6 7', renderer: this.renderer, interactive: false,
      }).addTo(this.candLayer);
      const label = L.marker([to.lat, to.lng], {
        icon: L.divIcon({
          className: 'cand-pin',
          html: `<span class="pin" style="--c:${color}"><b>${k + 1}</b><span class="nm"></span><span class="pc"></span></span>`,
          iconSize: null,
          iconAnchor: [14, 14],
        }),
        keyboard: false,
        interactive: false,
        zIndexOffset: 500,
      }).addTo(this.candLayer);
      // 名前は textContent で入れる（HTML として読ませない）
      const el = label.getElement();
      if (el) el.querySelector('.nm').textContent = to.name;
      return { line, label, color };
    });
  }

  // 票の割合で、線の太さと札の数字を変える（札は作りなおさない）
  setCounts(counts, mine) {
    const total = counts.reduce((a, b) => a + b, 0);
    const max = Math.max(0, ...counts);
    this.candParts.forEach((part, k) => {
      const n = counts[k] || 0;
      const lead = total > 0 && n === max;
      part.line.setStyle({ weight: lead ? 6 : 3, opacity: lead ? 1 : 0.7 });
      const el = part.label.getElement();
      if (!el) return;
      el.classList.toggle('lead', lead);
      el.classList.toggle('mine', mine === k);
      el.querySelector('.pc').textContent = total ? `${Math.round((n / total) * 100)}%` : '';
    });
  }

  clearCandidates() {
    this.candLayer.clearLayers();
    this.candParts = [];
  }

  // 上にのせた部品（題名・記録・説明など）にかくれないように、地図の端をあける
  pads() {
    // 候補の札は点の右へのびるので、右側を多めにあける
    return this.stream
      ? { paddingTopLeft: [80, 240], paddingBottomRight: [260, 300] }
      : { paddingTopLeft: [30, 64], paddingBottomRight: [120, 30] };
  }

  // いまの町と近くの候補が入るように寄る
  //   遠出・島・飛行機の候補まで入れると、近くの候補が1か所にかたまって見えないので、そちらは点線の向きだけ見せる
  frame(here, cands, P, animate = true) {
    const nearOnes = cands.filter((c) => c.kind !== 'far' && c.kind !== 'island' && c.kind !== 'plane');
    const use = nearOnes.length ? nearOnes : cands;
    const pts = [[here.lat, here.lng], ...use.map((c) => [P[c.i].lat, P[c.i].lng])];
    const b = L.latLngBounds(pts);
    this.map.flyToBounds(b, { ...this.pads(), maxZoom: 12, duration: animate ? 0.9 : 0, animate });
  }

  // from から to へ、ms かけてバスを動かす（画面がうしろなら動かさずに着く）
  travel(from, to, ms, done) {
    cancelAnimationFrame(this.anim);
    this.clearCandidates();
    if (document.hidden || ms < 300) {
      this.bus.setLatLng([to.lat, to.lng]);
      done?.();
      return;
    }
    const b = L.latLngBounds([[from.lat, from.lng], [to.lat, to.lng]]);
    this.map.flyToBounds(b, { ...this.pads(), maxZoom: 12, duration: 0.7 });
    const line = L.polyline([[from.lat, from.lng], [from.lat, from.lng]], { color: '#ef5a3c', weight: 4, opacity: 0.9, renderer: this.renderer, interactive: false }).addTo(this.candLayer);
    const start = performance.now() + 700;
    const dur = Math.max(400, ms - 1100);
    const step = (t) => {
      const k = Math.min(1, Math.max(0, (t - start) / dur));
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const lat = from.lat + (to.lat - from.lat) * e;
      const lng = from.lng + (to.lng - from.lng) * e;
      this.bus.setLatLng([lat, lng]);
      line.setLatLngs([[from.lat, from.lng], [lat, lng]]);
      if (k < 1) this.anim = requestAnimationFrame(step);
      else done?.();
    };
    this.anim = requestAnimationFrame(step);
  }

  flyTo(p, zoom = 11) {
    this.map.flyTo([p.lat, p.lng], zoom, { duration: 0.8 });
  }

  invalidate() {
    this.map.invalidateSize({ pan: false });
  }
}
