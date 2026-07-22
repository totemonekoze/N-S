import './search-rules.js';
import SEARCH_PATTERNS from './search-patterns.json' with { type: 'json' };
import { getUiLanguage, translate } from './i18n.js';

const NINTENDO_ORIGIN = 'https://store-jp.nintendo.com';
const NINTENDO_CART_URL = `${NINTENDO_ORIGIN}/cart/`;
const STEAM_ORIGIN = 'https://store.steampowered.com';
const STEAM_CART_URL = `${STEAM_ORIGIN}/cart/`;
const STEAM_API_TIMEOUT_MS = 2500;
const SEARCH_CONCURRENCY = 5;
const STORE_ACTION_INTERVAL_MS = 900;
const TITLE_VARIANT_CACHE_LIMIT = 1000;

const SEARCH_RULES = globalThis.SS_SEARCH_RULES;

const ENGLISH_KATAKANA_WORDS = new Map(Object.entries(SEARCH_PATTERNS.englishToKatakana || {}));

const NINTENDO_TO_STEAM_PRODUCT_ALIASES = new Map([
  ['D70010000056430', { steamAppId: '1562700', title: 'SANABI', steamUrl: 'https://store.steampowered.com/app/1562700/SANABI/' }],
  ['D70010000088391', { steamAppId: '2383200', title: 'PATAPON 1+2 REPLAY', steamUrl: 'https://store.steampowered.com/app/2383200/12/' }],
  ['D70010000021659', { steamAppId: '384190', title: 'ABZU', steamUrl: 'https://store.steampowered.com/app/384190/ABZU/' }],
  ['D70010000038711', { steamAppId: '753640', title: 'Outer Wilds', steamUrl: 'https://store.steampowered.com/app/753640/Outer_Wilds/' }],
  ['D70010000043204', { steamAppId: '1135690', title: 'Unpacking', steamUrl: 'https://store.steampowered.com/app/1135690/Unpacking/' }],
  ['D70010000051038', { steamAppId: '1150690', title: 'OMORI', steamUrl: 'https://store.steampowered.com/app/1150690/OMORI/' }],
  ['D70010000060038', { steamAppId: '1859280', title: '7 Days to End with You', steamUrl: 'https://store.steampowered.com/app/1859280/7_Days_to_End_with_You/' }],
  ['D70010000070250', { steamAppId: '2707930', title: 'Palia', steamUrl: 'https://store.steampowered.com/app/2707930/Palia/' }],
  ['D70010000101809', { steamAppId: '2129530', title: 'REANIMAL', steamUrl: 'https://store.steampowered.com/app/2129530/REANIMAL/' }],
  ['D70010000120822', { steamAppId: '3339880', title: 'OFF', steamUrl: 'https://store.steampowered.com/app/3339880/OFF/' }],
  ['D70010000029014', { steamAppId: '1446780', title: 'Monster Hunter Rise', steamUrl: 'https://store.steampowered.com/app/1446780/' }],
  ['D70010000002564', { steamAppId: '477160', title: 'Human Fall Flat', steamUrl: 'https://store.steampowered.com/app/477160/Human_Fall_Flat/' }],
  ['D70010000013175', { steamAppId: '588650', title: 'Dead Cells', steamUrl: 'https://store.steampowered.com/app/588650/Dead_Cells/' }]
]);
const STEAM_TO_NINTENDO_PRODUCT_ALIASES = new Map([
  ['588650', { title: 'Dead Cells', productUrl: 'https://store-jp.nintendo.com/item/software/D70010000013175' }],
  ['1150690', { title: 'OMORI', productUrl: 'https://store-jp.nintendo.com/item/software/D70010000051038' }],
  ['1859280', { title: '7 Days to End with You', productUrl: 'https://store-jp.nintendo.com/item/software/D70010000060038' }],
  ['2129530', { title: 'REANIMAL', productUrl: 'https://store-jp.nintendo.com/item/software/D70010000101809' }],
  ['3339880', { title: 'OFF', productUrl: 'https://store-jp.nintendo.com/item/software/D70010000120822' }]
]);

let activeBuild = null;
let activeStoreAction = null;
const titleVariantCache = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BUILD_LIST') {
    if (activeBuild) {
      sendResponse({ ok: false, error: 'すでに一覧を作成中です。' });
      return;
    }
    const direction = message.direction || 'steam-to-nintendo';
    const job = {
      ...createWorkerJob(message.games.length, { lazyWorkers: direction === 'nintendo-to-steam' }),
      cancelled: false,
      completed: 0,
      originWindowId: message.originWindowId,
      direction,
      sourceType: message.sourceType || (message.direction === 'nintendo-to-steam' ? 'nintendo-wishlist' : 'steam-wishlist'),
      limit: Number(message.limit) || 0,
      progress: { key: 'preparingSearch' }
    };
    activeBuild = job;
    createProgressTab(job)
      .then(() => job.lazyWorkers ? undefined : createWorkerPool(job))
      .then(() => buildList(message.games, job))
      .catch((error) => sendBuildProgress({ state: 'cancelled', text: compactErrorMessage(error, '処理に失敗しました'), fallbackKey: 'startFailed' }))
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
      await notifySingleStoreAction('Nintendo Store', 'cart', message.title);
      await openCartTab(NINTENDO_CART_URL, sender.tab?.windowId).catch(() => {});
      sendResponse({ ok: true });
    }, async (error) => {
      await notifySingleStoreAction('Nintendo Store', 'cart', message.title, { error });
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  if (message.type === 'ADD_MANY_TO_NINTENDO_CART') {
    withCartWorker((job) => addManyToNintendoCart(message.productUrls, job))
      .then(async (result) => {
        await openCartTab(NINTENDO_CART_URL, sender.tab?.windowId).catch(() => {});
        sendResponse({ ok: true, ...result });
      }, async (error) => {
        await notifyBatchStoreAction('Nintendo Store', 'cart', 0, selectedUrlCount(message.productUrls));
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === 'ADD_TO_STEAM_CART') {
    withCartWorker((job) => addToSteamCart(message.productUrl, message.title, job)).then(async () => {
      await notifySingleStoreAction('Steam', 'cart', message.title);
      await openCartTab(STEAM_CART_URL, sender.tab?.windowId).catch(() => {});
      sendResponse({ ok: true });
    }, async (error) => {
      await notifySingleStoreAction('Steam', 'cart', message.title, { error });
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  if (message.type === 'ADD_MANY_TO_STEAM_CART') {
    withCartWorker((job) => addManyToSteamCart(message.productUrls, job))
      .then(async (result) => {
        await openCartTab(STEAM_CART_URL, sender.tab?.windowId).catch(() => {});
        sendResponse({ ok: true, ...result });
      }, async (error) => {
        await notifyBatchStoreAction('Steam', 'cart', 0, selectedUrlCount(message.productUrls));
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === 'ADD_TO_NINTENDO_WISHLIST') {
    withWishlistWorker((job) => addToNintendoWishlist(message.productUrl, job))
      .then(async (result) => {
        await notifySingleStoreAction('Nintendo Store', 'favorite', message.title, { alreadyAdded: result.alreadyAdded });
        sendResponse({ ok: true, ...result });
      }, async (error) => {
        await notifySingleStoreAction('Nintendo Store', 'favorite', message.title, { error });
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === 'ADD_TO_STEAM_WISHLIST') {
    withWishlistWorker((job) => addToSteamWishlist(message.productUrl, job))
      .then(async (result) => {
        await notifySingleStoreAction('Steam', 'favorite', message.title, { alreadyAdded: result.alreadyAdded });
        sendResponse({ ok: true, ...result });
      }, async (error) => {
        await notifySingleStoreAction('Steam', 'favorite', message.title, { error });
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === 'ADD_MANY_TO_NINTENDO_WISHLIST') {
    withWishlistWorker((job) => addManyToNintendoWishlist(message.productUrls, job))
      .then((result) => sendResponse({ ok: true, ...result }), async (error) => {
        await notifyBatchStoreAction('Nintendo Store', 'favorite', 0, selectedUrlCount(message.productUrls));
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === 'ADD_MANY_TO_STEAM_WISHLIST') {
    withWishlistWorker((job) => addManyToSteamWishlist(message.productUrls, job))
      .then((result) => sendResponse({ ok: true, ...result }), async (error) => {
        await notifyBatchStoreAction('Steam', 'favorite', 0, selectedUrlCount(message.productUrls));
        sendResponse({ ok: false, error: error.message });
      });
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
  if (!job.total) return;
  const size = Math.min(SEARCH_CONCURRENCY, job.total);
  try {
    const windows = await Promise.all(Array.from({ length: size }, () => chrome.windows.create({
      url: 'about:blank',
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

function createWorkerJob(total = 1, { lazyWorkers = false } = {}) {
  return { total, lazyWorkers, workerPool: [], workerWaiters: [], workerPoolPromise: null, readCache: new Map() };
}

async function withDedicatedWorker(work, { lazyWorkers = false } = {}) {
  const job = createWorkerJob(1, { lazyWorkers });
  if (!lazyWorkers) await createWorkerPool(job);
  try {
    return await work(job);
  } finally {
    await closeWorkerPool(job);
  }
}

async function withCartWorker(work) {
  return withStoreActionWorker(work);
}

async function withWishlistWorker(work) {
  return withStoreActionWorker(work);
}

async function withStoreActionWorker(work) {
  if (activeStoreAction) throw new Error('別の追加処理を実行中です。');
  const operation = {};
  activeStoreAction = operation;
  try {
    return await withDedicatedWorker(work);
  } finally {
    if (activeStoreAction === operation) activeStoreAction = null;
  }
}

async function lookupCounterpartProduct(message) {
  const sourceUrl = String(message.sourceUrl || '');
  return withDedicatedWorker(async (job) => {
    if (message.direction === 'steam-to-nintendo') {
      if (!sourceUrl.startsWith('https://store.steampowered.com/app/')) throw new Error('Steamの商品ページを取得できませんでした。');
      const source = hasSteamProductTitle(message.sourceProduct)
        ? message.sourceProduct
        : await openAndRead(sourceUrl, { type: 'STEAM_PRODUCT' }, job);
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
      const source = hasNintendoProductTitle(message.sourceProduct)
        ? message.sourceProduct
        : await openAndRead(sourceUrl, { type: 'NINTENDO_PRODUCT' }, job);
      if (!source?.title) throw new Error('Nintendo Storeの商品情報を取得できませんでした。');
      // 一覧作成と同じ照合・商品ページ再読み込みの経路を使う。
      const result = await enrichSteamDetails(await findSteamProductWithSourceFallback({
        title: source.title,
        nintendoImage: source.image || '',
        nintendoProductUrl: sourceUrl
      }, job), job);
      return { title: result.title, image: result.steamImage || '', url: result.steamUrl, store: 'steam' };
    }
    throw new Error('検索方向を判定できませんでした。');
  }, { lazyWorkers: message.direction === 'nintendo-to-steam' });
}

async function ensureWorkerPool(job) {
  if (!job || job.workerPool?.length) return;
  if (!job.workerPoolPromise) {
    job.workerPoolPromise = createWorkerPool(job).finally(() => { job.workerPoolPromise = null; });
  }
  await job.workerPoolPromise;
}

function hasSteamProductTitle(product) {
  return Boolean(String(product?.steamTitle || '').trim());
}

function hasNintendoProductTitle(product) {
  return Boolean(String(product?.title || '').trim());
}

async function openCartTab(url, originWindowId) {
  const options = { url, active: true };
  if (Number.isInteger(originWindowId)) options.windowId = originWindowId;
  await chrome.tabs.create(options);
}

function acquireWorker(job) {
  if (!job?.workerPool?.length) return Promise.resolve(null);
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
        error: compactErrorMessage(error, '見つかりませんでした')
      };
    } finally {
      job.completed += 1;
      sendBuildProgress({ key: 'searchingNintendo', values: { completed: job.completed, total: job.total } });
    }
  }, () => job.cancelled);

  if (job.cancelled) return finishCancelled();

  const results = await mapWithConcurrency(nintendoResults, SEARCH_CONCURRENCY, (result) => enrichStoreDetails(result, job), () => job.cancelled);
  if (job.cancelled) return finishCancelled();

  await publishResults(job, results, 'steam-to-nintendo');
}

async function buildNintendoToSteamList(initialGames, job) {
  const games = job.sourceType === 'nintendo-wishlist'
    ? await loadNintendoWishlistPages(initialGames, job)
    : initialGames.slice(0, job.limit > 0 ? job.limit : initialGames.length);
  job.total = games.length;
  if (job.cancelled) return finishCancelled();
  if (!games.length) throw new Error('Nintendo Storeのお気に入りを取得できませんでした。');

  const steamResults = await mapWithConcurrency(games, SEARCH_CONCURRENCY, async (game) => {
    try {
      return { ...game, ...(await findSteamProductWithSourceFallback(game, job)) };
    } catch (error) {
      return {
        ...game,
        searchUrl: createSteamSearchUrl(game.title),
        error: compactErrorMessage(error, '見つかりませんでした')
      };
    } finally {
      job.completed += 1;
      sendBuildProgress({ key: 'searchingSteam', values: { completed: job.completed, total: job.total } });
    }
  }, () => job.cancelled);
  if (job.cancelled) return finishCancelled();

  const results = await mapWithConcurrency(steamResults, SEARCH_CONCURRENCY, (result) => enrichStoreDetails(result, job), () => job.cancelled);
  if (job.cancelled) return finishCancelled();

  await publishResults(job, results, 'nintendo-to-steam');
}

async function publishResults(job, results, resultMode) {
  await chrome.storage.local.set({ results, resultMode, createdAt: new Date().toISOString() });
  const resultsOptions = { url: chrome.runtime.getURL('results.html'), active: true };
  if (Number.isInteger(job.originWindowId)) resultsOptions.windowId = job.originWindowId;
  await chrome.tabs.create(resultsOptions);
  const language = await getUiLanguage();
  await chrome.notifications.clear('wishlist-build-complete');
  await chrome.notifications.create('wishlist-build-complete', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon.png'),
    title: translate(language, 'searchResults'),
    message: translate(language, 'resultsCreatedCount', { count: results.length }),
    priority: 2
  });
  sendBuildProgress({ state: 'complete', key: 'listCreated' });
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
  let excludedMatchFound = false;
  let firstSafeFallback = null;
  const plans = createSteamSearchPlans(game);
  for (const phoneticPass of [false, true]) {
    // 通常・正規化・別名で一致しなかった場合だけ、音写と明示的な読みへ進む。
    for (const plan of plans) {
      if (Boolean(plan.phonetic) !== phoneticPass) continue;
      // Steam StoreのJSON応答を先に使い、完全一致だけは検索タブを開かず確定する。
      // 前方一致はDOM候補と統合してから判定し、完全一致優先を崩さない。
      const apiCandidates = await fetchSteamSearchCandidates(plan.query, job);
      if (apiCandidates.length) {
        const apiExact = await verifySteamMatches(apiCandidates, plan, job, true);
        excludedMatchFound ||= apiExact.excluded;
        if (apiExact.candidate) return steamMatchFromCandidate(apiExact.candidate);
      }

      const search = await openAndRead(createSteamSearchUrl(plan.query), { type: 'STEAM_SEARCH' }, job);
      const primaryCandidates = mergeSteamCandidates(apiCandidates, search.candidates || []);

      // 通常検索内の完全一致は、補助検索を待たず即時採用する。
      const primaryExact = await verifySteamMatches(primaryCandidates, plan, job, true);
      excludedMatchFound ||= primaryExact.excluded;
      if (primaryExact.candidate) return steamMatchFromCandidate(primaryExact.candidate);

      // 一般語・新作は通常検索の上位に出ないことがあるため、Steamの候補検索も統合する。
      const suggestion = await openAndRead(createSteamSuggestionUrl(plan.query), { type: 'STEAM_SEARCH' }, job);
      const allCandidates = mergeSteamCandidates(primaryCandidates, suggestion.candidates || []);
      const verified = await verifySteamMatches(allCandidates, plan, job);
      excludedMatchFound ||= verified.excluded;
      if (verified.candidate) return steamMatchFromCandidate(verified.candidate);

      // 日本語題名に対してSteamが英語の候補だけを返すことがある。その場合に限り、
      // 非DLCの先頭候補を最後の補助候補として保持する。英題同士の曖昧な先頭候補は採用しない。
      if (!firstSafeFallback && !plan.phonetic) {
        for (const candidate of verified.allowedCandidates) {
          if (!isCrossScriptSteamFallback(game.title, candidate.title)) continue;
          if (await isSteamProductExcluded(candidate, job)) {
            excludedMatchFound = true;
            continue;
          }
          firstSafeFallback = candidate;
          break;
        }
      }
    }
  }
  if (firstSafeFallback) return steamMatchFromCandidate(firstSafeFallback);
  if (excludedMatchFound) throw new Error('Steamのバンドル、サウンドトラック、またはDLCは対象外です。');
  throw new Error('見つかりませんでした');
}

async function verifySteamMatches(allCandidates, plan, job, exactOnly = false) {
  const allowedCandidates = allCandidates.filter((item) => !isSteamExcluded(item));
  const excludedCandidates = allCandidates.filter((item) => isSteamExcluded(item));
  // エラー分類は、検索結果に除外商品があったかではなく、タイトルが一致した除外商品があったかで決める。
  let excluded = findPrefixCandidates(excludedCandidates, plan).length > 0;
  const matches = findPrefixCandidates(allowedCandidates, plan)
    .filter((candidate) => !exactOnly || candidate.prefixStrength === 3);
  for (const candidate of matches) {
    if (await isSteamProductExcluded(candidate, job)) {
      excluded = true;
      continue;
    }
    return { candidate, allowedCandidates, excluded };
  }

  // Steamが検索結果を日本語化し、URLスラッグも「_」に置換する作品では、
  // 検索1位の商品ページに残る本体購入名を完全一致・前方一致用の別表記として確認する。
  const localizedCandidate = allowedCandidates[0];
  if (localizedCandidate) {
    try {
      const detail = await readSteamProductDetails(localizedCandidate, job);
      const enrichedCandidate = {
        ...localizedCandidate,
        steamOriginalTitle: detail?.steamOriginalTitle || detail?.steamTitle || '',
        steamCategory: detail?.steamCategory || ''
      };
      if (isSteamExcluded({
        ...enrichedCandidate,
        title: [localizedCandidate.title, enrichedCandidate.steamOriginalTitle].filter(Boolean).join(' '),
        category: enrichedCandidate.steamCategory
      })) {
        excluded = true;
      } else {
        const localizedMatches = findPrefixCandidates([enrichedCandidate], plan)
          .filter((candidate) => !exactOnly || candidate.prefixStrength === 3);
        if (localizedMatches[0]) return { candidate: localizedMatches[0], allowedCandidates, excluded };
      }
    } catch {
      // 表示タイトルによる通常の照合と後続検索を継続する。
    }
  }
  return { candidate: null, allowedCandidates, excluded };
}

function mergeSteamCandidates(...candidateLists) {
  const found = new Map();
  for (const candidate of candidateLists.flat()) {
    const key = candidate.steamAppId || candidate.url;
    if (!key) continue;
    const existing = found.get(key);
    found.set(key, existing ? mergeSteamCandidate(existing, candidate) : candidate);
  }
  return [...found.values()].map((candidate, rank) => ({ ...candidate, rank }));
}

function mergeSteamCandidate(existing, incoming) {
  const existingSlug = steamTitleFromUrl(existing.url);
  const incomingSlug = steamTitleFromUrl(incoming.url);
  const preferredUrl = incomingSlug && !existingSlug ? incoming.url : existing.url || incoming.url;
  return {
    ...existing,
    ...incoming,
    url: preferredUrl,
    searchKey: incoming.searchKey || existing.searchKey || steamTitleFromUrl(preferredUrl),
    image: existing.image || incoming.image,
    price: existing.price || incoming.price,
    type: existing.type || incoming.type
  };
}

async function isSteamProductExcluded(candidate, job) {
  if (isSteamExcluded(candidate)) return true;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const detail = await readSteamProductDetails(candidate, job);
      return isSteamExcluded({
        ...candidate,
        title: [candidate.title, detail?.steamOriginalTitle, detail?.steamTitle].filter(Boolean).join(' '),
        category: detail?.steamCategory || ''
      });
    } catch {
      // 次の検索ワーカーで一度だけ再試行する。
    }
  }
  // 商品ページの一時的な読み込み失敗だけで、通常ゲームを検索対象外にしない。
  // 検索結果のタイトルに含まれるDLC・サウンドトラック等は事前に除外済み。
  return false;
}

function steamMatchFromCandidate(candidate) {
  return {
    title: candidate.title,
    steamAppId: candidate.steamAppId,
    steamUrl: candidate.url,
    steamImage: candidate.image,
    steamPrice: candidate.price,
    matchScore: candidate.score
  };
}

async function findSteamProductWithSourceFallback(game, job) {
  try {
    return await findSteamProduct(game, job);
  } catch (firstError) {
    const resolvedGame = await resolveNintendoSourceGame(game, job);
    if (normaliseTitle(resolvedGame.title) === normaliseTitle(game.title)) throw firstError;
    try {
      return await findSteamProduct(resolvedGame, job);
    } catch {
      throw firstError;
    }
  }
}

// お気に入りカードのDOMは表示形式により、ロゴや種別をタイトルとして返すことがある。
// 一度検索に失敗した場合だけ、商品ページのOGタイトルで再検索する。
async function resolveNintendoSourceGame(game, job) {
  const productUrl = String(game.nintendoProductUrl || game.nintendoUrl || '');
  if (!productUrl.startsWith(NINTENDO_ORIGIN)) return game;
  try {
    const detail = await openAndRead(productUrl, { type: 'NINTENDO_PRODUCT' }, job);
    const title = String(detail?.title || '').trim();
    if (!title) return game;
    return {
      ...game,
      title,
      nintendoTitle: title,
      nintendoImage: game.nintendoImage || detail.image || ''
    };
  } catch {
    return game;
  }
}

function createSteamSearchPlans(game) {
  const { searchTitle, exactEnglishWord, plans: sharedPlans, readings } = createSharedTitleSearchPlans(game);
  const plans = sharedPlans.map((plan) => ({ ...plan, phonetic: false, exactEnglishWord }));
  const addPlan = (query, { phonetic = false } = {}) => {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery || plans.some((plan) => normaliseTitle(plan.query) === normaliseTitle(cleanQuery))) return;
    plans.push({ query: cleanQuery, requiredSubtitle: '', minimumScore: 70, allowTopResult: true, phonetic, exactEnglishWord });
  };
  // Steam固有: 日本語題名をローマ字でも補助検索する。
  for (const alias of sharedTitleAliases(searchTitle)) addPlan(alias);
  for (const romanised of kanaSearchVariants(searchTitle)) addPlan(romanised, { phonetic: true });
  for (const romanised of katakanaTitleSearchVariants(searchTitle)) addPlan(romanised, { phonetic: true });
  for (const reading of readings) addPlan(reading, { phonetic: true });
  return plans;
}

function createSteamSearchUrl(query) {
  return `https://store.steampowered.com/search/?term=${encodeURIComponent(query)}`;
}

function createSteamSuggestionUrl(query) {
  return `https://store.steampowered.com/search/suggest?term=${encodeURIComponent(query)}&f=games&cc=JP&l=japanese&use_store_query=1&use_search_spellcheck=1`;
}

function createSteamStoreSearchApiUrl(query) {
  return `${STEAM_ORIGIN}/api/storesearch/?term=${encodeURIComponent(query)}&l=japanese&cc=JP`;
}

function createSteamAppDetailsApiUrl(appId) {
  return `${STEAM_ORIGIN}/api/appdetails?appids=${encodeURIComponent(appId)}&l=japanese&cc=JP`;
}

async function fetchSteamSearchCandidates(query, job) {
  try {
    const payload = await fetchSteamJson(createSteamStoreSearchApiUrl(query), job);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return items.map((item, rank) => {
      const steamAppId = String(item?.id || item?.appid || '');
      return {
        url: steamAppId ? `${STEAM_ORIGIN}/app/${steamAppId}/` : '',
        steamAppId,
        title: String(item?.name || '').trim(),
        searchKey: '',
        image: String(item?.tiny_image || item?.header_image || '').trim(),
        price: steamApiPrice(item),
        type: String(item?.type || ''),
        rank
      };
    }).filter((candidate) => candidate.steamAppId && candidate.title);
  } catch {
    return [];
  }
}

async function readSteamProductDetails(candidate, job) {
  const appId = String(candidate?.steamAppId || candidate?.url || '').match(/(?:\/app\/)?(\d+)/)?.[1] || '';
  if (appId) {
    try {
      const payload = await fetchSteamJson(createSteamAppDetailsApiUrl(appId), job);
      const entry = payload?.[appId];
      const data = entry?.success ? entry.data : null;
      if (data) {
        return {
          steamTitle: String(data.name || '').trim(),
          steamOriginalTitle: String(data.name || '').trim(),
          steamImage: String(data.header_image || data.capsule_image || '').trim(),
          steamPrice: steamApiPrice(data),
          steamCategory: String(data.type || '').trim(),
          steamType: String(data.type || '').trim()
        };
      }
    } catch {
      // Store APIが使用できない場合は、従来の商品ページDOM取得へ戻る。
    }
  }
  const productUrl = candidate?.url || (appId ? `${STEAM_ORIGIN}/app/${appId}/` : '');
  if (!productUrl) throw new Error('Steamの商品ページを取得できませんでした。');
  return openAndRead(productUrl, { type: 'STEAM_PRODUCT' }, job);
}

function steamApiPrice(item) {
  if (item?.is_free) return '無料';
  const price = item?.price_overview || item?.price || {};
  const formatted = String(price.final_formatted || price.initial_formatted || '').trim();
  if (formatted) return formatted;
  const finalValue = Number(price.final);
  if (!Number.isFinite(finalValue)) return '';
  if (finalValue === 0) return '無料';
  return `${Math.round(finalValue / 100).toLocaleString('ja-JP')}円`;
}

async function fetchSteamJson(url, job) {
  const cacheKey = `STEAM_API:${url}`;
  if (job?.readCache?.has(cacheKey)) return job.readCache.get(cacheKey);
  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STEAM_API_TIMEOUT_MS);
    try {
      const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`Steam API: ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  })();
  if (job?.readCache) job.readCache.set(cacheKey, request);
  try {
    return await request;
  } catch (error) {
    job?.readCache?.delete(cacheKey);
    throw error;
  }
}

function finishCancelled() {
  sendBuildProgress({ state: 'cancelled', key: 'buildCancelled' });
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
  for (const phoneticPass of [false, true]) {
    // 通常・正規化・別名で一致しなかった場合だけ、音写と明示的な読みへ進む。
    for (const plan of plans) {
      if (Boolean(plan.phonetic) !== phoneticPass) continue;
      const search = await openAndRead(createNintendoSearchUrl(plan.query), { type: 'NINTENDO_SEARCH' }, job);
      const candidates = search.candidates || [];
      const candidate = selectCandidate(candidates, game, plan);
      if (candidate && isAcceptedCandidate(candidate, candidates, plan)) {
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
  }
  throw new Error('見つかりませんでした');
}

function createSearchPlans(game) {
  const { searchTitle, exactEnglishWord, plans: sharedPlans, readings } = createSharedTitleSearchPlans(game);
  const plans = sharedPlans.map((plan) => ({ ...plan, phonetic: false, exactEnglishWord }));
  const addPlan = (query, { phonetic = false, minimumScore = 70 } = {}) => {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery || plans.some((plan) => normaliseTitle(plan.query) === normaliseTitle(cleanQuery))) return;
    plans.push({ query: cleanQuery, requiredSubtitle: '', minimumScore, allowTopResult: true, phonetic, exactEnglishWord });
  };
  // Nintendo Store固有: 英題をカタカナ読みでも補助検索する。
  for (const alias of sharedTitleAliases(searchTitle)) addPlan(alias, { minimumScore: 90 });
  for (const kanaTitle of englishKatakanaSearchVariants(searchTitle)) addPlan(kanaTitle, { phonetic: true });
  for (const reading of readings) addPlan(reading, { phonetic: true });
  return plans;
}

// 両ストアで共通に使う検索語と優先順位。ストアごとの差分は各 create*SearchPlans に限定する。
function createSharedTitleSearchPlans(game) {
  const title = String(game.title || '').trim();
  const searchTitle = stripPlatformEditionSuffix(title);
  const exactEnglishWord = isSingleEnglishWord(searchTitle);
  const plans = [];
  const addPlan = (query, { requiredSubtitle = '', minimumScore = 70, allowTopResult = true } = {}) => {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery || plans.some((plan) => normaliseTitle(plan.query) === normaliseTitle(cleanQuery))) return;
    plans.push({ query: cleanQuery, requiredSubtitle, minimumScore, allowTopResult });
  };

  // 1. 元のゲーム名（Switch版などのプラットフォーム表記だけ除く）を最優先。
  //    この検索の完全一致、続く前方一致を解決してから、下記の正規化候補へ進む。
  addPlan(searchTitle, { minimumScore: 8 });
  // 4. ふりがな・エディション・括弧書きを除去した共通表記。
  for (const variant of titleVariants(searchTitle)) addPlan(variant);
  // 5. 主題と副題に分かれたタイトルは、副題も一致した候補だけを採用。
  const parts = searchTitle.split(/[\s　]+/).filter(Boolean);
  if (parts.length > 1) {
    addPlan(parts[0], { requiredSubtitle: parts.slice(1).join(' '), minimumScore: 80, allowTopResult: false });
    addPlan(parts.slice(0, -1).join(' '), { requiredSubtitle: parts.at(-1), minimumScore: 80, allowTopResult: false });
  }
  const colonSplit = searchTitle.match(/^(.+?)[：:]\s*(.+)$/);
  if (colonSplit) addPlan(colonSplit[1], { requiredSubtitle: colonSplit[2], minimumScore: 80, allowTopResult: false });
  return { searchTitle, exactEnglishWord, plans, readings: extractExplicitTitleReadings(searchTitle) };
}

function sharedTitleAliases(title) {
  const titleKey = normaliseTitle(title);
  for (const aliases of SEARCH_PATTERNS.titleAliases || []) {
    const values = Array.isArray(aliases) ? aliases : [];
    if (values.some((value) => normaliseTitle(value) === titleKey)) {
      return values.filter((value) => normaliseTitle(value) !== titleKey);
    }
  }
  return [];
}

function createNintendoSearchUrl(query) {
  return `${NINTENDO_ORIGIN}/search/?q=${encodeURIComponent(query)}`;
}

async function enrichSteamDetails(result, job) {
  if ((hasUsableImage(result.steamImage) && hasStorePrice(result.steamPrice)) || !result.steamAppId) return result;
  try {
    const detail = await readSteamProductDetails(result, job);
    return {
      ...result,
      steamImage: hasUsableImage(result.steamImage) ? result.steamImage : detail.steamImage || '',
      steamPrice: hasStorePrice(result.steamPrice) ? result.steamPrice : detail.steamPrice || ''
    };
  } catch {
    return result;
  }
}

async function enrichNintendoDetails(result, job) {
  const productUrl = result.productUrl || result.nintendoProductUrl || result.nintendoUrl || '';
  if ((hasUsableImage(result.nintendoImage || result.image) && hasStorePrice(result.nintendoPrice)) || !productUrl) return result;
  try {
    const detail = await openAndRead(productUrl, { type: 'NINTENDO_PRODUCT' }, job);
    const nintendoImage = hasUsableImage(result.nintendoImage || result.image)
      ? result.nintendoImage || result.image
      : detail.image || '';
    return {
      ...result,
      title: result.title || detail.title || '',
      image: nintendoImage,
      nintendoImage,
      nintendoPrice: hasStorePrice(result.nintendoPrice) ? result.nintendoPrice : detail.nintendoPrice || detail.price || '',
      favicon: result.favicon || detail.favicon || `${NINTENDO_ORIGIN}/favicon.ico`
    };
  } catch {
    return result;
  }
}

async function enrichStoreDetails(result, job) {
  return enrichSteamDetails(await enrichNintendoDetails(result, job), job);
}

function hasUsableImage(value) {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) && !/(?:loading|placeholder|transparent|blank)\.(?:gif|png|svg)(?:\?|$)/i.test(url);
}

function hasStorePrice(value) {
  return /[\d]|無料|free/iu.test(String(value || ''));
}

function chooseCandidate(candidates, game, plan) {
  const queryForms = titleVariants(plan.query).map(normaliseTitle).filter(Boolean);
  const originalForms = titleVariants(game.title).map(normaliseTitle).filter(Boolean);
  const requiredSubtitle = normaliseTitle(plan.requiredSubtitle);
  const steamPrice = parsePrice(game.steamPrice || game.nintendoPrice);

  return candidates.map((candidate) => {
    const nameForms = candidateTitleForms(candidate);
    if (!nameForms.length) return null;
    if (requiredSubtitle && !nameForms.some((name) => name.includes(requiredSubtitle))) return null;

    let score = Math.max(0, ...queryForms.flatMap((query) => nameForms.map((name) => titleMatchScore(name, query))));
    if (nameForms.some((name) => originalForms.includes(name))) score = Math.max(score, 100);
    if (requiredSubtitle) score += 40;

    const queryTokens = [...new Set(queryForms.flatMap((query) => query.split(' ').filter((token) => token.length > 1)))];
    score += queryTokens.filter((token) => nameForms.some((name) => name.includes(token))).length * 8;
    const nintendoPrice = parsePrice(candidate.price);
    if (score > 0 && steamPrice && nintendoPrice) {
      score += Math.max(0, 15 - Math.round(Math.abs(steamPrice - nintendoPrice) / Math.max(steamPrice, nintendoPrice) * 15));
    }
    return { ...candidate, score };
  }).filter(Boolean).sort((left, right) => right.score - left.score || (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER))[0] || null;
}

// 検索結果でタイトルの前方一致を確認できた場合は、価格や表記記号の差に
// 影響されず採用する。完全一致を最優先し、同点時は検索結果の上位を選ぶ。
function selectCandidate(candidates, game, plan) {
  const prefixCandidate = findPrefixCandidate(candidates, plan);
  if (prefixCandidate) return prefixCandidate;
  if (plan.exactEnglishWord) return null;
  return chooseCandidate(candidates, game, plan);
}

function findPrefixCandidate(candidates, plan) {
  return findPrefixCandidates(candidates, plan)[0] || null;
}

function findPrefixCandidates(candidates, plan) {
  const queryForms = titleVariants(plan.query).map(normaliseTitle).filter(Boolean);
  const phoneticKey = plan.phonetic ? titlePhoneticKey(plan.query) : '';
  const requiredSubtitle = normaliseTitle(plan.requiredSubtitle);
  const allowPrefix = !plan.exactEnglishWord && isDistinctiveTitle(plan.query);
  if (!queryForms.length) return [];

  const matches = candidates.map((candidate) => {
    const nameForms = candidateTitleForms(candidate);
    if (requiredSubtitle && !nameForms.some((name) => name.includes(requiredSubtitle))) return null;
    let strength = 0;
    for (const query of queryForms) {
      for (const name of nameForms) {
        if (name === query) strength = Math.max(strength, 3);
        else if (allowPrefix && name.startsWith(query)) strength = Math.max(strength, 2);
      }
    }
    if (phoneticKey && nameForms.some((name) => {
      const candidateKey = titlePhoneticKey(name);
      return plan.exactEnglishWord ? candidateKey === phoneticKey : candidateKey.startsWith(phoneticKey);
    })) strength = Math.max(strength, 2);
    return strength ? { ...candidate, score: Math.max(candidate.score || 0, 70 + strength * 10), prefixMatch: true, prefixStrength: strength } : null;
  }).filter(Boolean);

  return matches.sort((left, right) => right.prefixStrength - left.prefixStrength || (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER));
}

function candidateTitleForms(candidate) {
  const slugTitle = steamTitleFromUrl(candidate.url);
  return [...new Set([candidate.title, candidate.searchKey, candidate.steamOriginalTitle, slugTitle]
    .flatMap((value) => titleVariants(value).map(normaliseTitle))
    .filter(Boolean))];
}

function steamTitleFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const appIndex = parts.indexOf('app');
    const slug = appIndex >= 0 ? parts[appIndex + 2] : '';
    return slug ? decodeURIComponent(slug).replace(/_/g, ' ') : '';
  } catch {
    return '';
  }
}

function isAcceptedCandidate(candidate, candidates, plan) {
  if (candidate.prefixMatch) return true;
  if (candidate.score >= plan.minimumScore) return true;
  if (!plan.allowTopResult || candidate.rank !== candidates[0]?.rank || !isDistinctiveTitle(plan.query)) return false;
  return usesDifferentWritingSystems(plan.query, candidate.title);
}

function titleMatchScore(name, query) {
  if (name === query) return 100;
  if (name.startsWith(query) || query.startsWith(name)) return 75;
  if (name.includes(query) || query.includes(name)) return 65;
  return 0;
}

function titleVariants(value) {
  const cacheKey = String(value || '');
  const cached = titleVariantCache.get(cacheKey);
  if (cached) return cached;
  const variants = new Map();
  const add = (candidate) => {
    const clean = cleanStoreTitle(candidate);
    const key = normaliseTitle(clean);
    if (key) variants.set(key, clean);
  };
  const original = stripPlatformEditionSuffix(cleanStoreTitle(value));
  add(original);
  add(stripJapaneseReading(original));
  add(stripTrailingKanaReading(original));
  add(stripEditionSuffix(original));
  add(stripEditionSuffix(stripJapaneseReading(original)));
  add(stripEditionSuffix(stripTrailingKanaReading(original)));

  const parts = original.split(/[‐‑‒–—―-]+/u).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    const titleParts = parts.filter((part) => !isEditionDescriptor(part));
    add(titleParts.join(' '));
    add(titleParts.filter((part) => /[A-Za-z]/.test(part)).join(' '));
    add(titleParts.filter((part) => /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(part)).join(' '));
  }

  for (const candidate of [...variants.values()]) {
    add(stripJapaneseReading(candidate));
    add(stripTrailingKanaReading(candidate));
    add(stripEditionSuffix(candidate));
  }
  const result = [...variants.values()];
  if (titleVariantCache.size >= TITLE_VARIANT_CACHE_LIMIT) titleVariantCache.clear();
  titleVariantCache.set(cacheKey, result);
  return result;
}

function cleanStoreTitle(value) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s*[|｜]\s*(?:(?:My\s*)?Nintendo\s*Store|マイニンテンドーストア|Steam).*$/iu, '')
    .replace(/\s+on\s+Steam$/iu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripEditionSuffix(value) {
  const suffix = /(?:\s*[-‐‑‒–—―:：]?\s*)(?:(?:digital\s*)?(?:deluxe|complete|definitive|ultimate|special|standard|gold|premium)\s*edition|(?:デジタル\s*)?(?:デラックス|コンプリート|完全|決定|アルティメット|スペシャル|通常)版)\s*$/iu;
  let result = String(value || '').trim();
  while (suffix.test(result)) result = result.replace(suffix, '').trim();
  return result;
}

function stripPlatformEditionSuffix(value) {
  return String(value || '')
    .replace(/\s*[\(\[（【]\s*(?:for\s+)?(?:nintendo\s*)?switch(?:\s*(?:™|®|\(tm\)))?\s*(?:ver(?:sion)?|edition|version|版)\.?\s*[\)\]）】]/giu, ' ')
    .replace(/(?:\s*[-:：|／/]\s*|\s+)(?:for\s+)?(?:nintendo\s*)?switch(?:\s*(?:™|®|\(tm\)))?\s*(?:(?:ver(?:sion)?|edition|version)(?:\.|\b)|版)/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isEditionDescriptor(value) {
  return /^(?:(?:digital\s*)?(?:deluxe|complete|definitive|ultimate|special|standard|gold|premium)\s*edition|(?:デジタル\s*)?(?:デラックス|コンプリート|完全|決定|アルティメット|スペシャル|通常)版)$/iu.test(String(value || '').trim());
}

function isDistinctiveTitle(value) {
  const compact = normaliseTitle(value).replace(/\s/g, '');
  const latinToken = String(value || '').normalize('NFKC').replace(/[^A-Za-z0-9]/g, '');
  return compact.length >= 5 || /^[A-Z0-9]{3,4}$/.test(latinToken);
}

function usesDifferentWritingSystems(left, right) {
  const japanese = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
  const latin = /[A-Za-z]/;
  return (japanese.test(left) && latin.test(right)) || (latin.test(left) && japanese.test(right));
}

function isCrossScriptSteamFallback(sourceTitle, candidateTitle) {
  const japanese = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
  const latin = /[A-Za-z]/;
  return japanese.test(String(sourceTitle || '')) && latin.test(String(candidateTitle || ''));
}

function normaliseTitle(value) {
  return SEARCH_RULES.normaliseTitle(value);
}

function stripJapaneseReading(value) {
  return String(value || '')
    .replace(/[（(]\s*[\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+\s*[）)]/gu, '')
    .replace(/[［[]\s*[\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+\s*[\]］]/gu, '')
    .replace(/【\s*[\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+\s*】/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTrailingKanaReading(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/^(.+?)(?:\s*[-‐‑‒–—―:：/／|｜]\s*|\s+)([\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+)$/u);
  return match && /[A-Za-z0-9]/.test(match[1]) ? match[1].trim() : text;
}

function extractJapaneseReadings(value) {
  const readings = new Set();
  const text = String(value || '');
  for (const match of text.matchAll(/[（(［[【]\s*([\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+)\s*[）)］\]】]/gu)) {
    const reading = match[1].replace(/\s+/g, ' ').trim();
    if (isDistinctiveTitle(reading)) readings.add(reading);
  }
  const trailing = text.match(/(?:\s*[-‐‑‒–—―:：/／|｜]\s*|\s+)([\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+)$/u)?.[1]?.trim();
  if (trailing && isDistinctiveTitle(trailing)) readings.add(trailing);
  return [...readings];
}

function extractExplicitTitleReadings(value) {
  const readings = new Set(extractJapaneseReadings(value));
  const text = String(value || '');
  for (const match of text.matchAll(/[（(［[【]\s*([^（）()\[\]［］【】]{2,80})\s*[）)］\]】]/gu)) {
    const reading = match[1].replace(/\s+/g, ' ').trim();
    const baseTitle = text.replace(match[0], ' ').replace(/\s+/g, ' ').trim();
    const readingLength = normaliseTitle(reading).replace(/\s/g, '').length;
    if (readingLength >= 2 && usesDifferentWritingSystems(baseTitle, reading)) readings.add(reading);
  }
  return [...readings];
}

function kanaSearchVariants(value) {
  return [...new Set(extractJapaneseReadings(value).map(romaniseKana).filter(isDistinctiveTitle))];
}

function katakanaTitleSearchVariants(value) {
  if (!isKatakanaOnlyTitle(value)) return [];
  const englishWords = englishWordsFromKatakana(value);
  const romanised = romaniseKana(value);
  return [...new Set([
    englishWords,
    romanised && isDistinctiveTitle(romanised) ? romanised : ''
  ].filter(Boolean))];
}

// 英題の読みをNintendo Storeで再検索するための、一般的なゲーム名で使われる語の発音表記。
// この検索は通常検索が0件だった場合にだけ使うため、表記ゆれの補助に限定される。

function englishWordsFromKatakana(value) {
  const compact = String(value || '')
    .normalize('NFKC')
    .replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (!compact || !/^[\p{Script=Katakana}ー]+$/u.test(compact)) return '';
  const entries = [...ENGLISH_KATAKANA_WORDS]
    .map(([english, reading]) => ({ english, reading: reading.replace(/[\s・]/g, '') }))
    .filter(({ reading }) => reading)
    .sort((left, right) => right.reading.length - left.reading.length);
  const best = Array(compact.length + 1).fill(null);
  best[0] = [];
  for (let index = 0; index < compact.length; index += 1) {
    if (!best[index]) continue;
    for (const entry of entries) {
      if (!compact.startsWith(entry.reading, index)) continue;
      const nextIndex = index + entry.reading.length;
      const candidate = [...best[index], entry.english];
      if (!best[nextIndex] || candidate.length < best[nextIndex].length) best[nextIndex] = candidate;
    }
  }
  return best[compact.length]?.join(' ') || '';
}

function englishKatakanaSearchVariants(value) {
  const title = String(value || '').normalize('NFKC').trim();
  if (!title || /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(title)) return [];
  const words = title.match(/[A-Za-z]+/g) || [];
  if (!words.length) return [];
  const reading = words.map((word) => englishWordToKatakana(word));
  return reading.every(Boolean) ? [reading.join(' ')] : [];
}

function englishWordToKatakana(word) {
  const normalized = String(word || '').toLocaleLowerCase('en-US');
  // 不確かな綴りを機械的に読ませると誤採用につながるため、確実な語だけを検索語にする。
  return ENGLISH_KATAKANA_WORDS.get(normalized) || '';
}

function isKatakanaOnlyTitle(value) {
  const letters = String(value || '')
    .normalize('NFKC')
    .replace(/[\s\d０-９\p{P}\p{S}]/gu, '');
  return Boolean(letters) && /^[\p{Script=Katakana}ー]+$/u.test(letters);
}

function isSingleEnglishWord(value) {
  return /^[A-Za-z]+(?:['’][A-Za-z]+)?$/u.test(String(value || '').trim());
}

function titlePhoneticKey(value) {
  const source = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(String(value || ''))
    ? romaniseKana(value)
    : normaliseTitle(value);
  return normaliseTitle(source)
    .replace(/hy/g, 'h')
    .replace(/[lr]/g, 'r')
    .replace(/([bcdfghjklmnpqrstvwxyz])\1+/g, '$1')
    .replace(/[aeiou]/g, '')
    .replace(/\s/g, '');
}

function romaniseKana(value) {
  const source = String(value || '').normalize('NFKC').replace(/[ぁ-ゖ]/g, (character) => String.fromCodePoint(character.codePointAt(0) + 0x60));
  const syllables = {
    キャ: 'kya', キュ: 'kyu', キョ: 'kyo', シャ: 'sha', シュ: 'shu', ショ: 'sho', チャ: 'cha', チュ: 'chu', チョ: 'cho',
    ニャ: 'nya', ニュ: 'nyu', ニョ: 'nyo', ヒャ: 'hya', ヒュ: 'hyu', ヒョ: 'hyo', ミャ: 'mya', ミュ: 'myu', ミョ: 'myo',
    リャ: 'rya', リュ: 'ryu', リョ: 'ryo', ギャ: 'gya', ギュ: 'gyu', ギョ: 'gyo', ジャ: 'ja', ジュ: 'ju', ジョ: 'jo',
    ビャ: 'bya', ビュ: 'byu', ビョ: 'byo', ピャ: 'pya', ピュ: 'pyu', ピョ: 'pyo', ティ: 'ti', ディ: 'di', トゥ: 'tu', ドゥ: 'du',
    ファ: 'fa', フィ: 'fi', フェ: 'fe', フォ: 'fo', ウィ: 'wi', ウェ: 'we', ウォ: 'wo', ヴァ: 'va', ヴィ: 'vi', ヴェ: 've', ヴォ: 'vo'
  };
  const single = {
    ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o', カ: 'ka', キ: 'ki', ク: 'ku', ケ: 'ke', コ: 'ko', サ: 'sa', シ: 'shi', ス: 'su', セ: 'se', ソ: 'so',
    タ: 'ta', チ: 'chi', ツ: 'tsu', テ: 'te', ト: 'to', ナ: 'na', ニ: 'ni', ヌ: 'nu', ネ: 'ne', ノ: 'no', ハ: 'ha', ヒ: 'hi', フ: 'fu', ヘ: 'he', ホ: 'ho',
    マ: 'ma', ミ: 'mi', ム: 'mu', メ: 'me', モ: 'mo', ヤ: 'ya', ユ: 'yu', ヨ: 'yo', ラ: 'ra', リ: 'ri', ル: 'ru', レ: 're', ロ: 'ro', ワ: 'wa', ヲ: 'wo', ン: 'n',
    ガ: 'ga', ギ: 'gi', グ: 'gu', ゲ: 'ge', ゴ: 'go', ザ: 'za', ジ: 'ji', ズ: 'zu', ゼ: 'ze', ゾ: 'zo', ダ: 'da', ヂ: 'ji', ヅ: 'zu', デ: 'de', ド: 'do',
    バ: 'ba', ビ: 'bi', ブ: 'bu', ベ: 'be', ボ: 'bo', パ: 'pa', ピ: 'pi', プ: 'pu', ペ: 'pe', ポ: 'po', ヴ: 'vu'
  };
  let result = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const pair = source.slice(index, index + 2);
    if (syllables[pair]) {
      result += syllables[pair];
      index += 1;
    } else if (character === 'ッ') {
      const following = syllables[source.slice(index + 1, index + 3)] || single[source[index + 1]] || '';
      result += following ? following[0] : '';
    } else if (character === 'ー') {
      const vowel = result.match(/[aeiou](?!.*[aeiou])/u)?.[0] || '';
      result += vowel;
    } else {
      result += single[character] || (/[A-Za-z0-9]/.test(character) ? character.toLowerCase() : ' ');
    }
  }
  return result.replace(/\s+/g, ' ').trim();
}

function isSteamExcluded(candidate) {
  return SEARCH_RULES.isSteamExcluded(candidate);
}

function compactErrorMessage(error, fallback) {
  const message = String(error?.message || error || '');
  if (/Could not establish connection|Receiving end does not exist|message port|extension port|message channel|back\/forward cache/i.test(message)) {
    return 'ページをリロードしてください';
  }
  if (/[A-Za-z]{3}/.test(message) && !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(message)) {
    return fallback;
  }
  return message || fallback;
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

async function addToNintendoWishlist(productUrl, job) {
  if (!productUrl?.startsWith(`${NINTENDO_ORIGIN}/item/`) && !productUrl?.startsWith(`${NINTENDO_ORIGIN}/products/`)) {
    throw new Error('Nintendo Storeのゲーム商品ページではありません。');
  }
  const result = await openAndRead(productUrl, { type: 'NINTENDO_ADD_TO_WISHLIST' }, job);
  if (!result?.ok) throw new Error(result?.error || 'Nintendo Storeのお気に入りに追加できませんでした。');
  return { alreadyAdded: Boolean(result.alreadyAdded) };
}

async function addToSteamWishlist(productUrl, job) {
  if (!productUrl?.startsWith('https://store.steampowered.com/app/')) throw new Error('Steamのゲーム商品ページではありません。');
  const result = await openAndRead(productUrl, { type: 'STEAM_ADD_TO_WISHLIST' }, job);
  if (!result?.ok) throw new Error(result?.error || 'Steamのウィッシュリストに追加できませんでした。');
  return { alreadyAdded: Boolean(result.alreadyAdded) };
}

async function addManyToSteamCart(productUrls, job) {
  return addManyToStoreAction(
    productUrls,
    (url) => url.startsWith('https://store.steampowered.com/app/'),
    (url) => addToSteamCart(url, '', job),
    'Steam',
    'cart'
  );
}

async function addManyToNintendoCart(productUrls, job) {
  return addManyToStoreAction(
    productUrls,
    (url) => url.startsWith(`${NINTENDO_ORIGIN}/item/`) || url.startsWith(`${NINTENDO_ORIGIN}/products/`),
    (url) => addToNintendoCart(url, job),
    'Nintendo Store',
    'cart'
  );
}

async function addManyToSteamWishlist(productUrls, job) {
  return addManyToStoreAction(
    productUrls,
    (url) => url.startsWith('https://store.steampowered.com/app/'),
    (url) => addToSteamWishlist(url, job),
    'Steam',
    'favorite'
  );
}

async function addManyToNintendoWishlist(productUrls, job) {
  return addManyToStoreAction(
    productUrls,
    (url) => url.startsWith(`${NINTENDO_ORIGIN}/item/`) || url.startsWith(`${NINTENDO_ORIGIN}/products/`),
    (url) => addToNintendoWishlist(url, job),
    'Nintendo Store',
    'favorite'
  );
}

async function addManyToStoreAction(productUrls, isValidUrl, addItem, storeName, action) {
  const urls = [...new Set(productUrls)].filter(isValidUrl);
  const failed = [];
  let added = 0;
  for (const [index, url] of urls.entries()) {
    try {
      await addItem(url);
      added += 1;
    } catch (error) {
      failed.push({ url, error: error.message });
    }
    if (index < urls.length - 1) await delay(STORE_ACTION_INTERVAL_MS);
  }
  await notifyBatchStoreAction(storeName, action, added, failed.length);
  return { added, failed };
}

async function notifySingleStoreAction(storeName, action, title, { error, alreadyAdded = false } = {}) {
  const language = await getUiLanguage();
  const productTitle = String(title || storeName).trim();
  const key = error
    ? (action === 'favorite' ? 'singleFavoriteFailed' : 'singleCartFailed')
    : action === 'favorite' && alreadyAdded
      ? 'singleFavoriteAlready'
      : action === 'favorite'
        ? 'singleFavoriteAdded'
        : 'singleCartAdded';
  await createStoreNotification(storeName, translate(language, key, { title: productTitle }), Boolean(error));
}

async function notifyBatchStoreAction(storeName, action, added, failed) {
  const language = await getUiLanguage();
  const key = action === 'favorite'
    ? (failed ? 'batchFavoriteFailed' : 'batchFavoriteAdded')
    : (failed ? 'batchCartFailed' : 'batchCartAdded');
  await createStoreNotification(storeName, translate(language, key, { added, failed }), failed > 0);
}

async function createStoreNotification(storeName, message, isError = false) {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon.png'),
      title: isError ? `⚠ ${storeName}` : storeName,
      message,
      priority: 2
    });
  } catch {
    // 通知を表示できなくても、ストア側の追加結果は維持する。
  }
}

function selectedUrlCount(productUrls) {
  return Math.max(1, new Set(Array.isArray(productUrls) ? productUrls : []).size);
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
  const cacheKey = isCacheableRead(message) ? `${message.type}:${url}` : '';
  if (cacheKey && job?.readCache?.has(cacheKey)) return job.readCache.get(cacheKey);
  const request = readPage(url, message, job);
  if (cacheKey && job?.readCache) job.readCache.set(cacheKey, request);
  try {
    return await request;
  } catch (error) {
    if (cacheKey) job?.readCache?.delete(cacheKey);
    throw error;
  }
}

function isCacheableRead(message) {
  return ['STEAM_PRODUCT', 'NINTENDO_PRODUCT', 'STEAM_SEARCH', 'NINTENDO_SEARCH', 'GET_NINTENDO_WISHLIST'].includes(message.type);
}

async function readPage(url, message, job) {
  if (job?.lazyWorkers && !job.workerPool?.length) await ensureWorkerPool(job);
  const worker = await acquireWorker(job);
  if (worker) {
    try {
      await navigateWorkerTab(worker.tabId, url);
      return await chrome.tabs.sendMessage(worker.tabId, message);
    } finally {
      releaseWorker(job, worker);
    }
  }

  const workerWindow = await chrome.windows.create({ url, type: 'popup', state: 'minimized', focused: false });
  const workerWindowId = workerWindow.id;
  const tab = workerWindow.tabs?.[0] || (await chrome.tabs.query({ windowId: workerWindowId }))[0];
  if (!tab?.id) throw new Error('検索用ページを作成できませんでした。');
  try {
    await waitForTabComplete(tab.id);
    return await chrome.tabs.sendMessage(tab.id, message);
  } finally {
    await chrome.windows.remove(workerWindowId).catch(() => {});
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
