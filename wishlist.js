function normalise(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type === 'STEAM_PRODUCT') {
    respond(readSteamProduct());
    return;
  }
  if (message.type === 'STEAM_ADD_TO_CART') {
    addSteamToCart(message.title).then(respond, (error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message.type !== 'GET_WISHLIST') return;
  collectWishlistGames(message.limit).then((games) => respond({ games }));
  return true;
});

async function collectWishlistGames(limit) {
  const found = new Map();
  collectVisibleWishlistRows(found);

  // 新しいウィッシュリストは仮想スクロールで、初期DOMには見えているゲームだけが入る。
  // Steam自身に続きの行を描画させながら、指定件数に達するまで順に収集する。
  await collectVirtualizedWishlistRows(found, limit);

  const wishlistData = readPageJson('g_rgWishlistData');
  const appInfo = readPageJson('g_rgAppInfo') || {};
  for (const entry of wishlistEntries(wishlistData)) {
    if (!entry.steamAppId || found.has(entry.steamAppId)) continue;
    const info = appInfo[entry.steamAppId] || {};
    found.set(entry.steamAppId, {
      steamAppId: entry.steamAppId,
      title: normalise(info.name || info.title || entry.title || ''),
      steamImage: '',
      steamPrice: ''
    });
  }

  // 旧レイアウトでは公式のページングAPIも補助として利用する。
  await loadWishlistPages(found, limit);
  const games = [...found.values()].filter((game) => game.title);
  return limit > 0 ? games.slice(0, limit) : games;
}

function collectVisibleWishlistRows(found) {
  const addGame = (steamAppId, title, node) => {
    if (!steamAppId || !title || /^\d+$/.test(title) || found.has(steamAppId)) return;
    const row = node?.closest('.wishlist_row, [data-app-id], [data-rfd-draggable-id^="WishlistItem-"]') || node;
    const imageNode = row?.querySelector('img[src*="/apps/"][src*="/header"]') || row?.querySelector('img[src]');
    const rawPrice = row?.querySelector('.discount_final_price, .discount_price, .price, [class*="price"]')?.textContent ||
      (row?.textContent || '').match(/[¥￥]\s?[\d,]+/)?.[0] || '';
    found.set(steamAppId, {
      steamAppId,
      title,
      steamImage: imageNode?.currentSrc || imageNode?.src || '',
      steamPrice: normalise(rawPrice)
    });
  };

  document.querySelectorAll('[data-app-id]').forEach((node) => {
    const appId = node.dataset.appId;
    const title = normalise(
      node.querySelector('.title, .ellipsis, .wishlist_row_title, [class*=title]')?.textContent ||
      node.getAttribute('data-ds-appid') || ''
    );
    addGame(appId, title, node);
  });
  document.querySelectorAll('a[href*="/app/"]').forEach((link) => {
    const appId = link.href.match(/\/app\/(\d+)/)?.[1];
    const title = normalise(link.querySelector('.title, .ellipsis')?.textContent || link.textContent);
    addGame(appId, title, link);
  });
}

async function collectVirtualizedWishlistRows(found, limit) {
  const target = limit > 0 ? limit : Number.POSITIVE_INFINITY;
  if (found.size >= target) return;

  const scrollRoot = findWishlistScrollRoot();
  if (!scrollRoot) return;
  const pageScroll = scrollRoot === document.scrollingElement || scrollRoot === document.documentElement || scrollRoot === document.body;
  const initialPosition = pageScroll ? window.scrollY : scrollRoot.scrollTop;
  const viewport = Math.max(300, pageScroll ? window.innerHeight : scrollRoot.clientHeight);
  const maximum = Math.max(0, pageScroll
    ? document.documentElement.scrollHeight - window.innerHeight
    : scrollRoot.scrollHeight - scrollRoot.clientHeight);
  const step = Math.max(360, Math.floor(viewport * 0.8));

  try {
    for (let position = 0; position <= maximum && found.size < target; position += step) {
      if (pageScroll) window.scrollTo(0, position);
      else scrollRoot.scrollTop = position;
      await waitForVirtualRows();
      collectVisibleWishlistRows(found);
    }
  } finally {
    if (pageScroll) window.scrollTo(0, initialPosition);
    else scrollRoot.scrollTop = initialPosition;
  }
}

function findWishlistScrollRoot() {
  const row = document.querySelector('[data-rfd-draggable-id^="WishlistItem-"]');
  for (let element = row?.parentElement; element && element !== document.body; element = element.parentElement) {
    if (element.scrollHeight > element.clientHeight + 100) return element;
  }
  return document.scrollingElement || document.documentElement;
}

function waitForVirtualRows() {
  return new Promise((resolve) => window.setTimeout(resolve, 160));
}

function readSteamProduct() {
  const meta = (selector) => document.querySelector(selector)?.getAttribute('content')?.trim();
  const priceText = normalise(document.querySelector('.discount_final_price, .game_purchase_price, .discount_original_price, [class*="price"]')?.textContent);
  return {
    steamTitle: normalise(document.querySelector('#appHubAppName')?.textContent || meta('meta[property="og:title"]')?.replace(/\s+on\s+Steam$/i, '') || ''),
    steamImage: meta('meta[property="og:image"]') || document.querySelector('.game_header_image_full, .game_header_image')?.src || '',
    steamPrice: priceText.match(/[¥￥]\s?[\d,]+/)?.[0] || priceText || ''
  };
}

async function addSteamToCart(requestedTitle) {
  const title = normalise(document.querySelector('#appHubAppName')?.textContent || requestedTitle);
  if (!title) throw new Error('Steamのゲームタイトルを取得できませんでした。');
  if (isSteamExcluded(title)) throw new Error('バンドルまたはサウンドトラックはカートに追加できません。');

  const requestId = `steam-cart-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      document.removeEventListener('steam-wishlist-cart-response', onResponse);
      reject(new Error('Steamのカート追加処理が時間切れになりました。'));
    }, 12000);
    const onResponse = (event) => {
      if (event.detail?.requestId !== requestId) return;
      clearTimeout(timeout);
      document.removeEventListener('steam-wishlist-cart-response', onResponse);
      resolve(event.detail.result);
    };
    document.addEventListener('steam-wishlist-cart-response', onResponse);
    document.dispatchEvent(new CustomEvent('steam-wishlist-cart-request', {
      detail: { requestId, title }
    }));
  });

  if (!result?.ok) throw new Error(result?.error || 'Steamのカートに追加できませんでした。');
  return result;
}

function isSteamExcluded(text) {
  return /\bbundle\b|soundtrack|バンドル|サウンドトラック/i.test(String(text || ''));
}

function wishlistEntries(data) {
  if (!data) return [];
  const values = Array.isArray(data) ? data : Array.isArray(data.apps) ? data.apps : Object.entries(data).map(([steamAppId, value]) => ({ steamAppId, ...(value || {}) }));
  return values.map((value) => ({ steamAppId: String(value.steamAppId || value.appid || value.app_id || value.id || ''), title: value.name || value.title || '' }));
}

async function loadWishlistPages(found, limit) {
  const target = limit > 0 ? limit : Number.POSITIVE_INFINITY;
  if (found.size >= target) return;
  const baseUrl = wishlistBaseUrl();
  if (!baseUrl) return;
  let unchangedPages = 0;
  for (let page = 0; page < 100 && found.size < target; page += 1) {
    try {
      const response = await fetch(`${baseUrl}wishlistdata/?p=${page}`, { credentials: 'include' });
      if (!response.ok) break;
      const entries = wishlistEntries(await response.json());
      if (!entries.length) break;
      const countBefore = found.size;
      for (const entry of entries) {
        if (!entry.steamAppId || found.has(entry.steamAppId)) continue;
        found.set(entry.steamAppId, { steamAppId: entry.steamAppId, title: normalise(entry.title), steamImage: '', steamPrice: '' });
        if (found.size >= target) break;
      }
      unchangedPages = found.size === countBefore ? unchangedPages + 1 : 0;
      if (unchangedPages >= 3) break;
    } catch {
      break;
    }
  }
}

function wishlistBaseUrl() {
  for (const script of document.scripts) {
    const match = (script.textContent || '').match(/g_strWishlistBaseURL\s*=\s*["']([^"']+)["']/);
    if (match) return match[1].endsWith('/') ? match[1] : `${match[1]}/`;
  }
  const steamId = [...document.scripts].map((script) => (script.textContent || '').match(/g_steamID\s*=\s*["']?(\d+)/)?.[1]).find(Boolean);
  return steamId ? `https://store.steampowered.com/wishlist/profiles/${steamId}/` : null;
}

function readPageJson(variableName) {
  const marker = new RegExp(`(?:var\\s+)?${variableName}\\s*=\\s*`);
  for (const script of document.scripts) {
    const source = script.textContent || '';
    const match = marker.exec(source);
    if (!match) continue;
    const start = source.indexOf('{', match.index + match[0].length);
    if (start < 0) continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (quoted) {
        if (!escaped && character === '"') quoted = false;
        escaped = !escaped && character === '\\';
        continue;
      }
      if (character === '"') {
        quoted = true;
        continue;
      }
      if (character === '{') depth += 1;
      if (character === '}' && --depth === 0) {
        try {
          return JSON.parse(source.slice(start, index + 1));
        } catch {
          break;
        }
      }
    }
  }
  return null;
}
