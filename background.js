const NINTENDO_ORIGIN = 'https://store-jp.nintendo.com';
const NINTENDO_CART_URL = `${NINTENDO_ORIGIN}/cart/`;
const STEAM_CART_URL = 'https://store.steampowered.com/cart/';
const SEARCH_CONCURRENCY = 5;
const CART_ADD_INTERVAL_MS = 900;
// Set to false to return to the per-request worker-window behavior.
const REUSE_WORKER_WINDOWS = true;

// Nintendo Store の日本語表記が Steam の英語表記とまったく異なる作品の別名。
// タイトルを追加する場合は、キーを英語タイトル、値をNintendo Storeでの表記にする。
const NINTENDO_TITLE_ALIASES = new Map([
  ['the colonists', ['ザ・コロニスト']]
]);
const STEAM_TITLE_ALIASES = new Map([
  ['ザ コロニスト', ['The Colonists']]
]);

const NINTENDO_TO_STEAM_PRODUCT_ALIASES = new Map([
  ['D70010000056430', { steamAppId: '1562700', title: 'SANABI', steamUrl: 'https://store.steampowered.com/app/1562700/SANABI/' }],
  ['D70010000088391', { steamAppId: '2383200', title: 'PATAPON 1+2 REPLAY', steamUrl: 'https://store.steampowered.com/app/2383200/12/' }],
  ['D70010000021659', { steamAppId: '384190', title: 'ABZU', steamUrl: 'https://store.steampowered.com/app/384190/ABZU/' }],
  ['D70010000038711', { steamAppId: '753640', title: 'Outer Wilds', steamUrl: 'https://store.steampowered.com/app/753640/Outer_Wilds/' }],
  ['D70010000043204', { steamAppId: '1135690', title: 'Unpacking', steamUrl: 'https://store.steampowered.com/app/1135690/Unpacking/' }],
  ['D70010000070250', { steamAppId: '2707930', title: 'Palia', steamUrl: 'https://store.steampowered.com/app/2707930/Palia/' }],
  ['D70010000013175', { steamAppId: '588650', title: 'Dead Cells', steamUrl: 'https://store.steampowered.com/app/588650/Dead_Cells/' }]
]);
const STEAM_TO_NINTENDO_PRODUCT_ALIASES = new Map([
  ['588650', { title: 'Dead Cells', productUrl: 'https://store-jp.nintendo.com/item/software/D70010000013175' }]
]);

let activeBuild = null;
let activeCart = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BUILD_LIST') {
    if (activeBuild) {
      sendResponse({ ok: false, error: 'すでに一覧を作成中です。' });
      return;
    }
    const job = {
      cancelled: false,
      total: message.games.length,
      completed: 0,
      originWindowId: message.originWindowId,
      direction: message.direction || 'steam-to-nintendo',
      limit: Number(message.limit) || 0,
      workerPool: [],
      workerWaiters: [],
      progress: { text: '一覧作成を開始しています…' }
    };
    activeBuild = job;
    createProgressTab(job)
      .then(() => createWorkerPool(job))
      .then(() => buildList(message.games, job))
      .catch((error) => sendBuildProgress({ state: 'cancelled', text: `処理を中断しました: ${error.message}` }))
      .finally(async () => {
        await closeWorkerPool(job);
        await closeProgressTab(job);
        if (activeBuild === job) activeBuild = null;
      });
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'CANCEL_BUILD') {
    if (activeBuild) activeBuild.cancelled = true;
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'GET_BUILD_STATUS') {
    sendResponse(activeBuild ? { active: true, ...activeBuild.progress } : { active: false });
    return;
  }

  if (message.type === 'LOOKUP_COUNTERPART_PRODUCT') {
    lookupCounterpartProduct(message)
      .then((counterpart) => sendResponse({ ok: true, counterpart }), (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'ADD_TO_NINTENDO_CART') {
    withCartWorker((job) => addToNintendoCart(message.productUrl, job)).then(async () => {
      await openCartTab(NINTENDO_CART_URL, sender.tab?.windowId);
      sendResponse({ ok: true });
    }, (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'ADD_MANY_TO_NINTENDO_CART') {
    withCartWorker((job) => addManyToNintendoCart(message.productUrls, job))
      .then(async (result) => {
        await openCartTab(NINTENDO_CART_URL, sender.tab?.windowId);
        sendResponse({ ok: true, ...result });
      }, (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'ADD_TO_STEAM_CART') {
    withCartWorker((job) => addToSteamCart(message.productUrl, message.title, job)).then(async () => {
      await openCartTab(STEAM_CART_URL, sender.tab?.windowId);
      sendResponse({ ok: true });
    }, (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'ADD_MANY_TO_STEAM_CART') {
    withCartWorker((job) => addManyToSteamCart(message.productUrls, job))
      .then(async (result) => {
        await openCartTab(STEAM_CART_URL, sender.tab?.windowId);
        sendResponse({ ok: true, ...result });
      }, (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

async function createProgressTab(job) {
  try {
    const options = { url: chrome.runtime.getURL('progress.html'), active: false };
    if (Number.isInteger(job.originWindowId)) options.windowId = job.originWindowId;
    const tab = await chrome.tabs.create(options);
    if (activeBuild === job) job.progressTabId = tab.id;
    else await chrome.tabs.remove(tab.id);
  } catch {
    // The build can continue without a progress tab.
  }
}

async function closeProgressTab(job) {
  if (job.progressTabId) await chrome.tabs.remove(job.progressTabId).catch(() => {});
}

async function createWorkerPool(job) {
  if (!REUSE_WORKER_WINDOWS || !job.total) return;
  const size = Math.min(SEARCH_CONCURRENCY, job.total);
  try {
    const windows = await Promise.all(Array.from({ length: size }, () => chrome.windows.create({
      url: chrome.runtime.getURL('progress.html'),
      type: 'popup',
      state: 'minimized',
      focused: false
    })));
    job.workerPool = await Promise.all(windows.map(async (workerWindow) => {
      const tab = workerWindow.tabs?.[0] || (await chrome.tabs.query({ windowId: workerWindow.id }))[0];
      if (!workerWindow.id || !tab?.id) throw new Error('検索用ウィンドウを作成できませんでした。');
      return { windowId: workerWindow.id, tabId: tab.id, busy: false };
    }));
  } catch {
    await closeWorkerPool(job);
  }
}

async function closeWorkerPool(job) {
  const workers = job.workerPool || [];
  job.workerPool = [];
  job.workerWaiters = [];
  await Promise.all(workers.map((worker) => chrome.windows.remove(worker.windowId).catch(() => {})));
}

async function withCartWorker(work) {
  if (activeCart) throw new Error('別のカート追加処理を実行中です。');
  const job = { total: 1, workerPool: [], workerWaiters: [] };
  activeCart = job;
  try {
    // 検索用とは別の最小化ポップアップを１枚だけ使い回す。
    await createWorkerPool(job);
    return await work(job);
  } finally {
    await closeWorkerPool(job);
    if (activeCart === job) activeCart = null;
  }
}

async function lookupCounterpartProduct(message) {
  const sourceUrl = String(message.sourceUrl || '');
  const job = { total: 1, workerPool: [], workerWaiters: [] };
  try {
    // 商品ページからの照合も、ユーザーの通常ウィンドウを使わない専用ポップアップで実行する。
    await createWorkerPool(job);
    if (message.direction === 'steam-to-nintendo') {
      if (!sourceUrl.startsWith('https://store.steampowered.com/app/')) throw new Error('Steamの商品ページを取得できませんでした。');
      const source = await openAndRead(sourceUrl, { type: 'STEAM_PRODUCT' }, job);
      if (!source?.steamTitle) throw new Error('Steamの商品情報を取得できませんでした。');
      const result = await enrichNintendoDetails(await findNintendoProduct({
        title: source.steamTitle,
        steamAppId: sourceUrl.match(/\/app\/(\d+)/)?.[1] || '',
        steamImage: source.steamImage || '',
        steamPrice: source.steamPrice || ''
      }, job), job);
      return { title: result.title, image: result.nintendoImage || result.image || '', url: result.productUrl, store: 'nintendo' };
    }

    if (message.direction === 'nintendo-to-steam') {
      if (!sourceUrl.startsWith(NINTENDO_ORIGIN)) throw new Error('Nintendo Storeの商品ページを取得できませんでした。');
      const source = await openAndRead(sourceUrl, { type: 'NINTENDO_PRODUCT' }, job);
      if (!source?.title) throw new Error('Nintendo Storeの商品情報を取得できませんでした。');
      const result = await enrichSteamDetails(await findSteamProduct({
        title: source.title,
        nintendoImage: source.image || '',
        nintendoProductUrl: sourceUrl
      }, job), job);
      return { title: result.title, image: result.steamImage || '', url: result.steamUrl, store: 'steam' };
    }
    throw new Error('検索方向を判定できませんでした。');
  } finally {
    await closeWorkerPool(job);
  }
}

async function openCartTab(url, originWindowId) {
  const options = { url, active: true };
  if (Number.isInteger(originWindowId)) options.windowId = originWindowId;
  await chrome.tabs.create(options);
}

function acquireWorker(job) {
  if (!REUSE_WORKER_WINDOWS || !job?.workerPool?.length) return Promise.resolve(null);
  const available = job.workerPool.find((worker) => !worker.busy);
  if (available) {
    available.busy = true;
    return Promise.resolve(available);
  }
  return new Promise((resolve) => job.workerWaiters.push(resolve));
}

function releaseWorker(job, worker) {
  if (!worker) return;
  const next = job.workerWaiters.shift();
  if (next) next(worker);
  else worker.busy = false;
}

async function buildList(games, job) {
  if (job.direction === 'nintendo-to-steam') return buildNintendoToSteamList(games, job);
  // Wishlist.js returns only games with a title, so no preliminary Steam product-page pass is needed.
  const nintendoResults = await mapWithConcurrency(games, SEARCH_CONCURRENCY, async (game) => {
    try {
      return { ...game, ...(await findNintendoProduct(game, job)) };
    } catch (error) {
      return {
        ...game,
        searchUrl: createNintendoSearchUrl(game.title),
        error: error.message || '見つかりませんでした'
      };
    } finally {
      job.completed += 1;
      sendBuildProgress({ text: `Nintendo Storeを検索中… ${job.completed} / ${job.total}` });
    }
  }, () => job.cancelled);

  if (job.cancelled) return finishCancelled();

  // Search result cards already contain Nintendo metadata. Only fill missing Steam price/image data.
  const results = await mapWithConcurrency(nintendoResults, SEARCH_CONCURRENCY, (result) => enrichSteamDetails(result, job), () => job.cancelled);
  if (job.cancelled) return finishCancelled();

  await chrome.storage.local.set({ results, resultMode: 'steam-to-nintendo', createdAt: new Date().toISOString() });
  const resultsOptions = { url: chrome.runtime.getURL('results.html'), active: true };
  if (Number.isInteger(job.originWindowId)) resultsOptions.windowId = job.originWindowId;
  await chrome.tabs.create(resultsOptions);
  await chrome.notifications.clear('wishlist-build-complete');
  await chrome.notifications.create('wishlist-build-complete', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon.svg'),
    title: 'Nintendo Store 検索結果',
    message: `${results.length} 件の一覧を作成しました。`,
    priority: 2
  });
  sendBuildProgress({ state: 'complete', text: '一覧を作成しました。' });
}

async function buildNintendoToSteamList(initialGames, job) {
  const games = await loadNintendoWishlistPages(initialGames, job);
  job.total = games.length;
  if (job.cancelled) return finishCancelled();
  if (!games.length) throw new Error('Nintendo Storeのお気に入りを取得できませんでした。');

  const steamResults = await mapWithConcurrency(games, SEARCH_CONCURRENCY, async (game) => {
    try {
      return { ...game, ...(await findSteamProduct(game, job)) };
    } catch (error) {
      return {
        ...game,
        searchUrl: createSteamSearchUrl(game.title),
        error: error.message || '見つかりませんでした'
      };
    } finally {
      job.completed += 1;
      sendBuildProgress({ text: `Steamを検索中… ${job.completed} / ${job.total}` });
    }
  }, () => job.cancelled);
  if (job.cancelled) return finishCancelled();

  const results = await mapWithConcurrency(steamResults, SEARCH_CONCURRENCY, (result) => enrichSteamDetails(result, job), () => job.cancelled);
  if (job.cancelled) return finishCancelled();

  await chrome.storage.local.set({ results, resultMode: 'nintendo-to-steam', createdAt: new Date().toISOString() });
  const resultsOptions = { url: chrome.runtime.getURL('results.html'), active: true };
  if (Number.isInteger(job.originWindowId)) resultsOptions.windowId = job.originWindowId;
  await chrome.tabs.create(resultsOptions);
  await chrome.notifications.clear('wishlist-build-complete');
  await chrome.notifications.create('wishlist-build-complete', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon.svg'),
    title: 'Steam 検索結果',
    message: `${results.length} 件の一覧を作成しました。`,
    priority: 2
  });
  sendBuildProgress({ state: 'complete', text: '一覧を作成しました。' });
}

async function loadNintendoWishlistPages(initialGames, job) {
  const target = job.limit > 0 ? job.limit : Number.POSITIVE_INFINITY;
  const found = new Map();
  const addGames = (games) => {
    for (const game of games) {
      const key = game.nintendoProductUrl || game.nintendoUrl || game.title;
      if (!key || found.has(key)) continue;
      found.set(key, game);
      if (found.size >= target) break;
    }
  };
  addGames(initialGames);
  for (let page = 2; found.size < target && !job.cancelled; page += 1) {
    const response = await openAndRead(`${NINTENDO_ORIGIN}/wishlist?page=${page}`, { type: 'GET_NINTENDO_WISHLIST' }, job);
    const pageGames = response?.games || [];
    if (!pageGames.length) break;
    const countBefore = found.size;
    addGames(pageGames);
    if (found.size === countBefore) break;
  }
  return [...found.values()].slice(0, target);
}

async function findSteamProduct(game, job) {
  const productId = String(game.nintendoProductUrl || game.nintendoUrl || '').match(/(D\d+)/i)?.[1]?.toUpperCase();
  const directMatch = productId && NINTENDO_TO_STEAM_PRODUCT_ALIASES.get(productId);
  if (directMatch) return { ...directMatch, matchScore: 100 };
  for (const plan of createSteamSearchPlans(game)) {
    const search = await openAndRead(createSteamSearchUrl(plan.query), { type: 'STEAM_SEARCH' }, job);
    const candidates = search.candidates || [];
    const candidate = chooseCandidate(candidates.filter((item) => !isSteamExcluded(item.title)), game, plan);
    if (candidate && candidate.score >= plan.minimumScore) {
      return {
        title: candidate.title,
        steamAppId: candidate.steamAppId,
        steamUrl: candidate.url,
        steamImage: candidate.image,
        steamPrice: candidate.price,
        matchScore: candidate.score
      };
    }
    if (candidates.length && candidates.every((item) => isSteamExcluded(item.title))) {
      throw new Error('Steamのバンドルまたはサウンドトラックは対象外です。');
    }
  }
  throw new Error('見つかりませんでした');
}

function createSteamSearchPlans(game) {
  const title = String(game.title || '').trim();
  const plans = [{ query: title, minimumScore: 8 }];
  const addPlan = (query, minimumScore = 90) => {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery || plans.some((plan) => normaliseTitle(plan.query) === normaliseTitle(cleanQuery))) return;
    plans.push({ query: cleanQuery, minimumScore });
  };
  addPlan(stripJapaneseReading(title), 70);
  const parts = title.split(/[\s　]+/).filter(Boolean);
  if (parts.length > 1) {
    addPlan(parts[0], 70);
    addPlan(parts.slice(0, -1).join(' '), 70);
  }
  for (const alias of STEAM_TITLE_ALIASES.get(normaliseTitle(title)) || []) addPlan(alias);
  return plans;
}

function createSteamSearchUrl(query) {
  return `https://store.steampowered.com/search/?term=${encodeURIComponent(query)}`;
}

function finishCancelled() {
  sendBuildProgress({ state: 'cancelled', text: '一覧作成を中断しました。' });
}

function sendBuildProgress(message) {
  if (activeBuild) activeBuild.progress = message;
  chrome.runtime.sendMessage({ type: 'BUILD_PROGRESS', ...message }).catch(() => {});
}

async function findNintendoProduct(game, job) {
  const steamAppId = String(game.steamAppId || game.steamUrl || '').match(/(?:\/app\/)?(\d+)/)?.[1] || '';
  const directMatch = steamAppId && STEAM_TO_NINTENDO_PRODUCT_ALIASES.get(steamAppId);
  if (directMatch) {
    return {
      ...directMatch,
      image: directMatch.nintendoImage || '',
      nintendoImage: directMatch.nintendoImage || '',
      favicon: `${NINTENDO_ORIGIN}/favicon.ico`,
      matchScore: 100
    };
  }
  const plans = createSearchPlans(game);
  for (const plan of plans) {
    const search = await openAndRead(createNintendoSearchUrl(plan.query), { type: 'NINTENDO_SEARCH' }, job);
    const candidate = chooseCandidate(search.candidates || [], game, plan);
    if (candidate && candidate.score >= plan.minimumScore) {
      return {
        searchUrl: createNintendoSearchUrl(plan.query),
        productUrl: candidate.url,
        title: candidate.title,
        image: candidate.image,
        nintendoPrice: candidate.price,
        nintendoImage: candidate.image,
        favicon: `${NINTENDO_ORIGIN}/favicon.ico`,
        matchScore: candidate.score
      };
    }
  }
  throw new Error('見つかりませんでした');
}

function createSearchPlans(game) {
  const title = String(game.title || '').trim();
  const plans = [{ query: title, minimumScore: 8 }];
  const addPlan = (query, requiredSubtitle = '', minimumScore = 80) => {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery || plans.some((plan) => normaliseTitle(plan.query) === normaliseTitle(cleanQuery))) return;
    plans.push({ query: cleanQuery, requiredSubtitle, minimumScore });
  };

  addPlan(stripJapaneseReading(title), '', 70);

  // 「主題 サブタイトル」では、主題の検索結果にサブタイトル全体が含まれる候補だけを許可する。
  const parts = title.split(/[\s　]+/).filter(Boolean);
  if (parts.length > 1) {
    addPlan(parts[0], parts.slice(1).join(' '));
    addPlan(parts.slice(0, -1).join(' '), parts.at(-1));
  }
  const colonSplit = title.match(/^(.+?)[：:]\s*(.+)$/);
  if (colonSplit) addPlan(colonSplit[1], colonSplit[2]);

  const aliasKey = normaliseTitle(title);
  for (const alias of NINTENDO_TITLE_ALIASES.get(aliasKey) || []) addPlan(alias, '', 90);
  return plans;
}

function createNintendoSearchUrl(query) {
  return `${NINTENDO_ORIGIN}/search/?q=${encodeURIComponent(query)}`;
}

async function enrichSteamDetails(result, job) {
  if (result.steamImage && result.steamPrice) return result;
  try {
    const detail = await openAndRead(`https://store.steampowered.com/app/${result.steamAppId}/`, { type: 'STEAM_PRODUCT' }, job);
    return {
      ...result,
      steamImage: result.steamImage || detail.steamImage || '',
      steamPrice: result.steamPrice || detail.steamPrice || ''
    };
  } catch {
    return result;
  }
}

async function enrichNintendoDetails(result, job) {
  if (result.nintendoImage || !result.productUrl) return result;
  try {
    const detail = await openAndRead(result.productUrl, { type: 'NINTENDO_PRODUCT' }, job);
    return {
      ...result,
      title: result.title || detail.title || '',
      image: detail.image || result.image || '',
      nintendoImage: detail.image || result.nintendoImage || ''
    };
  } catch {
    return result;
  }
}

function chooseCandidate(candidates, game, plan) {
  const query = normaliseTitle(plan.query);
  const original = normaliseTitle(game.title);
  const requiredSubtitle = normaliseTitle(plan.requiredSubtitle);
  const steamPrice = parsePrice(game.steamPrice || game.nintendoPrice);

  return candidates.map((candidate) => {
    const name = normaliseTitle(candidate.title);
    if (!name) return null;
    if (requiredSubtitle && !name.includes(requiredSubtitle)) return null;

    let score = name === query ? 100 : name.startsWith(query) || query.startsWith(name) ? 75 : name.includes(query) || query.includes(name) ? 65 : 0;
    if (name === original) score = Math.max(score, 100);
    if (requiredSubtitle) score += 40;

    const queryTokens = query.split(' ').filter((token) => token.length > 1);
    score += queryTokens.filter((token) => name.includes(token)).length * 8;
    const nintendoPrice = parsePrice(candidate.price);
    if (steamPrice && nintendoPrice) {
      score += Math.max(0, 15 - Math.round(Math.abs(steamPrice - nintendoPrice) / Math.max(steamPrice, nintendoPrice) * 15));
    }
    return { ...candidate, score };
  }).filter(Boolean).sort((left, right) => right.score - left.score)[0] || null;
}

function normaliseTitle(value) {
  const foldLatin = (character) => character.normalize('NFD').replace(/\p{M}/gu, '');
  return String(value || '')
    .toLocaleLowerCase('ja-JP')
    .normalize('NFKC')
    .replace(/[\u00c0-\u024f]/g, foldLatin)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripJapaneseReading(value) {
  return String(value || '').replace(/[（(]\s*[ぁ-んァ-ヶー・]+\s*[）)]/g, '').replace(/\s+/g, ' ').trim();
}

function isSteamExcluded(value) {
  return /\bbundle\b|soundtrack|バンドル|サウンドトラック/i.test(String(value || ''));
}

function parsePrice(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

async function addToNintendoCart(productUrl, job) {
  const result = await openAndRead(productUrl, { type: 'NINTENDO_ADD_TO_CART' }, job);
  if (!result?.ok) throw new Error(result?.error || 'カートに追加できませんでした。');
}

async function addToSteamCart(productUrl, title, job) {
  if (!productUrl?.startsWith('https://store.steampowered.com/app/')) throw new Error('Steamのゲーム商品ページではありません。');
  const result = await openAndRead(productUrl, { type: 'STEAM_ADD_TO_CART', title }, job);
  if (!result?.ok) throw new Error(result?.error || 'Steamのカートに追加できませんでした。');
}

async function addManyToSteamCart(productUrls, job) {
  const urls = [...new Set(productUrls)].filter((url) => url.startsWith('https://store.steampowered.com/app/'));
  const failed = [];
  let added = 0;
  for (const url of urls) {
    try {
      await addToSteamCart(url, '', job);
      added += 1;
    } catch (error) {
      failed.push({ url, error: error.message });
    }
    await delay(CART_ADD_INTERVAL_MS);
  }
  await chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon.svg'),
    title: 'Steam',
    message: failed.length ? `${added}件を追加しました。失敗: ${failed.length}件` : `${added}件をカートに追加しました。`
  });
  return { added, failed };
}

async function addManyToNintendoCart(productUrls, job) {
  const urls = [...new Set(productUrls)].filter((url) => url.startsWith(`${NINTENDO_ORIGIN}/item/`) || url.startsWith(`${NINTENDO_ORIGIN}/products/`));
  const failed = [];
  let added = 0;
  for (const url of urls) {
    try {
      await addToNintendoCart(url, job);
      added += 1;
    } catch (error) {
      failed.push({ url, error: error.message });
    }
    await delay(CART_ADD_INTERVAL_MS);
  }
  await chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon.svg'),
    title: 'Nintendo Store',
    message: failed.length ? `${added}件を追加しました。失敗: ${failed.length}件` : `${added}件をカートに追加しました。`
  });
  return { added, failed };
}

async function mapWithConcurrency(items, limit, mapper, isCancelled = () => false) {
  const output = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !isCancelled()) {
      const index = next++;
      output[index] = await mapper(items[index]);
    }
  }));
  return output;
}

async function openAndRead(url, message, job) {
  const worker = await acquireWorker(job);
  if (worker) {
    try {
      await navigateWorkerTab(worker.tabId, url);
      return await chrome.tabs.sendMessage(worker.tabId, message);
    } finally {
      releaseWorker(job, worker);
    }
  }

  let tab;
  let workerWindowId;
  if (job) {
    const workerWindow = await chrome.windows.create({ url, type: 'popup', state: 'minimized', focused: false });
    workerWindowId = workerWindow.id;
    tab = workerWindow.tabs?.[0] || (await chrome.tabs.query({ windowId: workerWindowId }))[0];
  } else {
    tab = await chrome.tabs.create({ url, active: false });
  }
  if (!tab?.id) throw new Error('検索用ページを作成できませんでした。');
  try {
    await waitForTabComplete(tab.id);
    return await chrome.tabs.sendMessage(tab.id, message);
  } finally {
    if (workerWindowId) await chrome.windows.remove(workerWindowId).catch(() => {});
    else await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function navigateWorkerTab(tabId, url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('ページの読み込みがタイムアウトしました。')), 30000);
    const onUpdated = (updatedId, info) => {
      if (updatedId === tabId && info.status === 'complete') finish();
    };
    const finish = (error) => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      error ? reject(error) : resolve();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId, { url, active: false }).then((tab) => {
      if (tab.status === 'complete') finish();
    }, finish);
  });
}

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('ページの読み込みがタイムアウトしました。')), 30000);
    const onUpdated = (updatedId, info) => {
      if (updatedId === tabId && info.status === 'complete') finish();
    };
    const finish = (error) => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      error ? reject(error) : resolve();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') finish();
    }, finish);
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
