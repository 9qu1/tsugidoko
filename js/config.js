// どこにつなぐか
//   本番（まだ出していない）: 画面は GitHub Pages（https://9qu1.com/tsugidoko/）、通信は Cloudflare（https://tsugidoko.nakamido.workers.dev）
//   手元: 画面も通信も wrangler dev（同じ場所）

const PROD_PAGE_HOSTS = ['9qu1.com', '9qu1.github.io'];
export const IS_PROD_PAGE = PROD_PAGE_HOSTS.includes(location.hostname);
export const API_ORIGIN = IS_PROD_PAGE ? 'https://tsugidoko.nakamido.workers.dev' : '';
export const WS_URL = IS_PROD_PAGE
  ? 'wss://tsugidoko.nakamido.workers.dev/ws'
  : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
// このページの住所（/tsugidoko/ の下でも、手元の / でも）
export const PAGE_URL = location.origin + location.pathname.replace(/[^/]*$/, '');
// 共有や配信の画面で案内する住所（本番は 9qu1.com の住所。手元は手元の住所）
export const SHARE_URL = IS_PROD_PAGE ? 'https://9qu1.com/tsugidoko/' : PAGE_URL;

// 地図（国土地理院の地理院タイル・淡色地図）。キー不要・出典の表示が条件
export const TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
export const TILE_CREDIT = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">出典：国土地理院</a>';
