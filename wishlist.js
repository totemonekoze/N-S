function normalise(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type === 'STEAM_PRODUCT') {
    readSteamProductWithWait().then(respond);
    return true;
  }
  if (message.type === 'STEAM_ADD_TO_CART') {
    addSteamToCart(message.title).then(respond, (error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'STEAM_ADD_TO_WISHLIST') {
    addSteamToWishlist().then(respond, (error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'GET_STEAM_OWNED_GAMES') {
    collectOwnedSteamGames(message.limit).then((games) => respond({ games }));
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

async function collectOwnedSteamGames(limit) {
  const found = new Map();
  collectVisibleOwnedGameRows(found);
  await collectOwnedGameRowsWhileScrolling(found, limit);
  const games = [...found.values()].filter((game) => game.title);
  return limit > 0 ? games.slice(0, limit) : games;
}

function collectVisibleOwnedGameRows(found) {
  const addGame = (appId, title, row, imageNode) => {
    const key = appId || title.toLocaleLowerCase('ja-JP');
    if (!key || !title || found.has(key)) return;
    found.set(key, {
      steamAppId: String(appId || ''),
      title,
      steamImage: imageNode?.currentSrc || imageNode?.src || '',
      steamPrice: ''
    });
  };

  // 旧コミュニティ画面の行形式。
  const nodes = document.querySelectorAll('[data-appid], [data-app-id], [data-ds-appid], .gameListRow, .gameListRowItem');
  for (const node of nodes) {
    const row = node.closest('.gameListRow, [data-appid], [data-app-id], [data-ds-appid]') || node;
    const appId = node.dataset.appid || node.dataset.appId || node.dataset.dsAppid || row.dataset.appid || row.dataset.appId || row.dataset.dsAppid || steamAppIdFromHref(row.querySelector('a[href*="/app/"], a[href*="/stats/"]')?.href) || '';
    const imageNode = row.querySelector('img[src]');
    const title = normalise(
      row.querySelector('.gameListRowItemName, .gameListRowItem, .title, [class*="title" i], [class*="name" i]')?.textContent ||
      imageNode?.alt ||
      node.textContent ||
      ''
    );
    addGame(appId, title, row, imageNode);
  }

  // 新しいSteamコミュニティ画面はクラス名が毎回変わるReactの仮想リスト。
  // 商品ページへのリンクを基準にカードを特定することで、表示形式に依存せず取得する。
  const appLinks = document.querySelectorAll('a[href*="store.steampowered.com/app/"], a[href^="/app/"]');
  for (const link of appLinks) {
    const appId = steamAppIdFromHref(link.href);
    if (!appId) continue;
    const row = link.closest('[role="button"], .gameListRow, [data-appid], [data-app-id]') || link.parentElement;
    const title = ownedGameTitleFromRow(row, appId) || normalise(link.textContent);
    const imageNode = ownedGameImageFromRow(row, appId);
    addGame(appId, title || normalise(imageNode?.alt), row, imageNode);
  }
}

function steamAppIdFromHref(href) {
  return String(href || '').match(/\/app\/(\d+)(?:[/?#]|$)/)?.[1] || '';
}

function ownedGameTitleFromRow(row, appId) {
  if (!row) return '';
  const appLinks = [...row.querySelectorAll('a[href*="/app/"]')]
    .filter((link) => steamAppIdFromHref(link.href) === appId)
    .map((link) => normalise(link.textContent))
    .filter((text) => text && !/^(?:ストアページ|store page|掲示板|forums?|グループ|公式webサイト|news)$/i.test(text));
  return appLinks[0] || '';
}

function ownedGameImageFromRow(row, appId) {
  if (!row) return null;
  const appImage = [...row.querySelectorAll('img[src]')].find((image) => {
    const source = image.currentSrc || image.src || '';
    return new RegExp(`/apps/${appId}/`, 'i').test(source);
  });
  return appImage || row.querySelector('img[src]');
}

async function collectOwnedGameRowsWhileScrolling(found, limit) {
  const target = limit > 0 ? limit : Number.POSITIVE_INFINITY;
  if (found.size >= target) return;
  const root = findOwnedGamesScrollRoot();
  const pageScroll = root === document.scrollingElement || root === document.documentElement || root === document.body;
  const initialPosition = pageScroll ? window.scrollY : root.scrollTop;
  const viewport = Math.max(300, pageScroll ? window.innerHeight : root.clientHeight);
  const step = Math.max(360, Math.floor(viewport * 0.8));
  let position = 0;
  try {
    for (let attempts = 0; attempts < 250 && found.size < target; attempts += 1) {
      const maximum = Math.max(0, pageScroll
        ? document.documentElement.scrollHeight - window.innerHeight
        : root.scrollHeight - root.clientHeight);
      if (pageScroll) window.scrollTo(0, position);
      else root.scrollTop = position;
      await waitForVirtualRows();
      collectVisibleOwnedGameRows(found);
      if (position >= maximum) break;
      position = Math.min(maximum, position + step);
    }
  } finally {
    if (pageScroll) window.scrollTo(0, initialPosition);
    else root.scrollTop = initialPosition;
  }
}

function findOwnedGamesScrollRoot() {
  const row = document.querySelector('.gameListRow, .gameListRowItem, [data-appid], [data-app-id], a[href*="store.steampowered.com/app/"]')?.closest('[role="button"], .gameListRow, [data-appid], [data-app-id]');
  for (let element = row?.parentElement; element && element !== document.body; element = element.parentElement) {
    if (element.scrollHeight > element.clientHeight + 100) return element;
  }
  return document.scrollingElement || document.documentElement;
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

async function readSteamProductWithWait() {
  const deadline = Date.now() + 3500;
  let best = readSteamProduct();
  let previousSignature = '';
  let stableCount = 0;
  while (Date.now() < deadline) {
    const current = readSteamProduct();
    if (steamMetadataCompleteness(current) >= steamMetadataCompleteness(best)) best = current;
    const signature = `${current.steamTitle}|${current.steamImage}|${current.steamPrice}`;
    stableCount = signature && signature === previousSignature ? stableCount + 1 : 0;
    if (current.steamTitle && current.steamImage && (current.steamPrice || stableCount >= 2)) return current;
    previousSignature = signature;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return best;
}

function steamMetadataCompleteness(metadata) {
  return Number(Boolean(metadata.steamTitle)) + Number(Boolean(metadata.steamImage)) + Number(Boolean(metadata.steamPrice));
}

function readSteamProduct() {
  const meta = (selector) => document.querySelector(selector)?.getAttribute('content')?.trim();
  const steamDisplayTitle = normalise(document.querySelector('#appHubAppName')?.textContent || meta('meta[property="og:title"]')?.replace(/^Steam[：:]\s*/i, '').replace(/\s+on\s+Steam$/i, '') || '');
  const purchase = readSteamBasePurchase();
  const steamOriginalTitle = purchase.title;
  const imageNode = document.querySelector('.game_header_image_full, .game_header_image');
  // DLC一覧はゲーム本体の商品ページにも表示される。商品自身の種別はパンくずだけで判定する。
  const steamCategory = [...document.querySelectorAll('.breadcrumbs, .breadcrumb, [class*="breadcrumb" i]')]
    .map((node) => normalise(node.textContent))
    .filter(Boolean)
    .join(' ');
  return {
    // Steamの表示言語でタイトルが翻訳されても、購入欄には原題が残る場合がある。
    // 相互検索では原題を優先し、画面上の翻訳名も照合用に保持する。
    steamTitle: steamOriginalTitle || steamDisplayTitle,
    steamOriginalTitle,
    steamDisplayTitle,
    steamImage: readSteamImageUrl(meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]') || document.querySelector('link[rel="image_src"]')?.getAttribute('href') || readImageUrl(imageNode)),
    steamPrice: purchase.price,
    steamCategory
  };
}

function readSteamBasePurchase() {
  const sections = document.querySelectorAll('.game_area_purchase_game[id^="game_area_purchase_section_add_to_cart_"]');
  for (const section of sections) {
    const title = normalise(section.querySelector('.title')?.textContent)
      .replace(/^\s*(?:buy|purchase)\s+/i, '')
      .replace(/\s*(?:を購入する|を購入|の購入)\s*$/u, '')
      .trim();
    if (!title || isSteamExcluded(title)) continue;
    const priceText = section.querySelector('.discount_final_price, .game_purchase_price')?.textContent || section.textContent || '';
    return { title, price: readSteamPrice(priceText) };
  }
  return { title: '', price: '' };
}

function readImageUrl(image) {
  if (!image) return '';
  const srcset = image.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0] || '';
  return [image.currentSrc, image.src, image.getAttribute('data-src'), image.getAttribute('data-lazy-src'), srcset]
    .map(readSteamImageUrl)
    .find(Boolean) || '';
}

function readSteamImageUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) && !/(?:loading|placeholder|transparent|blank)\.(?:gif|png|svg)(?:\?|$)/i.test(url) ? url : '';
}

function readSteamPrice(value) {
  const text = normalise(value);
  if (/\bfree(?:\s+to\s+play)?\b|無料/iu.test(text)) return /無料/u.test(text) ? '無料' : 'Free';
  const matches = [...text.matchAll(/(?:[￥¥$€£]\s*[\d,.]+|[\d,.]+\s*(?:円|USD|JPY|EUR|GBP))/giu)].map((match) => match[0].replace(/\s+/g, ''));
  return matches.at(-1) || '';
}

async function addSteamToCart(requestedTitle) {
  const title = normalise(document.querySelector('#appHubAppName')?.textContent || requestedTitle);
  if (!title) throw new Error('Steamのゲームタイトルを取得できませんでした。');
  if (isSteamExcluded(title)) throw new Error('バンドル、サウンドトラック、またはDLCはカートに追加できません。');

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

async function addSteamToWishlist() {
  const appId = location.pathname.match(/\/app\/(\d+)/)?.[1] || '';
  if (!appId) throw new Error('SteamのゲームIDを取得できませんでした。');

  const requestId = `steam-wishlist-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      document.removeEventListener('steam-wishlist-add-response', onResponse);
      reject(new Error('Steamのウィッシュリスト追加処理が時間切れになりました。'));
    }, 15000);
    const onResponse = (event) => {
      if (event.detail?.requestId !== requestId) return;
      clearTimeout(timeout);
      document.removeEventListener('steam-wishlist-add-response', onResponse);
      resolve(event.detail.result);
    };
    document.addEventListener('steam-wishlist-add-response', onResponse);
    document.dispatchEvent(new CustomEvent('steam-wishlist-add-request', {
      detail: { requestId, appId }
    }));
  });

  if (!result?.ok) throw new Error(result?.error || 'Steamのウィッシュリストに追加できませんでした。');
  return result;
}

function isSteamExcluded(text) {
  return globalThis.SS_SEARCH_RULES.isSteamExcluded(text);
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
