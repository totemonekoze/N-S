const STORE_ORIGIN = 'https://store-jp.nintendo.com';

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type === 'GET_NINTENDO_WISHLIST') {
    readNintendoWishlist().then(respond);
    return true;
  }
  if (message.type === 'NINTENDO_SEARCH') {
    findCandidates().then(respond);
    return true;
  }
  if (message.type === 'NINTENDO_PRODUCT') {
    respond(readMetadata());
  }
  if (message.type === 'NINTENDO_ADD_TO_CART') {
    addToCart().then(respond, (error) => respond({ ok: false, error: error.message }));
    return true;
  }
});

async function readNintendoWishlist() {
  const deadline = Date.now() + 5000;
  let candidates = collectCandidates();
  while (!candidates.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    candidates = collectCandidates();
  }
  const games = candidates.map((candidate) => ({
    title: candidate.title,
    nintendoTitle: candidate.title,
    nintendoImage: candidate.image,
    nintendoPrice: candidate.price,
    nintendoProductUrl: candidate.url,
    nintendoUrl: candidate.url,
    favicon: `${STORE_ORIGIN}/favicon.ico`
  })).filter((game) => game.title);
  return { games, page: Number(new URL(location.href).searchParams.get('page') || 1) };
}

async function addToCart() {
  const deadline = Date.now() + 5000;
  let button;
  while (!(button = [...document.querySelectorAll('button')].find((item) => item.textContent.replace(/\s+/g, ' ').trim() === 'カートに入れる' && !item.disabled)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!button) throw new Error('カートに入れるボタンが見つかりませんでした。');
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  return { ok: true };
}

async function findCandidates() {
  // SPA の検索結果が描画されるまで最大 4 秒待つ。
  const deadline = Date.now() + 4000;
  let candidates = collectCandidates();
  while (!candidates.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    candidates = collectCandidates();
  }
  return { candidates, noMatch: document.querySelector('main')?.innerText.includes('条件に一致する商品は見つかりませんでした') || false };
}

function collectCandidates() {
  const seen = new Set();
  // 現行ストアは /item/software/...、旧形式は /products/... を使う。
  const candidates = [...document.querySelectorAll('a[href*="/item/"], a[href*="/products/"]')].map((a) => {
    const url = new URL(a.getAttribute('href'), location.href).href;
    const scope = a.closest('li, article, [class*="card"], [class*="product"], [class*="item"]') || a;
    const card = a.querySelector('img[src]') ? a : scope;
    const imageNode = findProductImage(card) || findProductImage(scope);
    const image = imageNode?.currentSrc || imageNode?.src || '';
    const text = card.textContent.replace(/\s+/g, ' ').trim();
    const price = text.match(/(?:(?:￥|¥)\s*)?[\d,]+\s*円/)?.[0] || '';
    return { url, title: readCardTitle(card, imageNode) || readCardTitle(scope, findProductImage(scope)) || '', image, price };
  }).filter((item) => item.url.startsWith(STORE_ORIGIN) && (/\/item\//.test(item.url) || /\/products\//.test(item.url)) && !seen.has(item.url) && seen.add(item.url));
  return candidates.map((candidate, rank) => ({ ...candidate, rank }));
}

function findProductImage(scope) {
  return [...scope.querySelectorAll('img[src]')].find((image) => isProductTitle(image.alt)) || null;
}

function readCardTitle(scope, imageNode) {
  const imageTitle = imageNode?.alt?.replace(/\s+/g, ' ').trim() || '';
  if (isProductTitle(imageTitle)) return imageTitle;
  const texts = [...scope.querySelectorAll('h1, h2, h3, h4, p, [class*="title" i], [class*="name" i]')]
    .map((node) => node.textContent.replace(/\s+/g, ' ').trim())
    .filter(isProductTitle);
  return texts.sort((left, right) => right.length - left.length)[0] || '';
}

function isProductTitle(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length < 2 || text.length > 180) return false;
  return !/^(?:ソフト|追加コンテンツ|ダウンロード版|パッケージ版|購入はこちら|Nintendo Switch(?: 2)?|Switch 2 のロゴ|\d[\d,]*円|\d+%OFF)$/iu.test(text);
}

function readMetadata() {
  const meta = (selector) => document.querySelector(selector)?.getAttribute('content')?.trim();
  const absolute = (value) => value ? new URL(value, location.href).href : undefined;
  return {
    title: cleanProductTitle(meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || document.title),
    image: absolute(meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]') || meta('meta[itemprop="image"]')),
    favicon: absolute(document.querySelector('link[rel~="icon"]')?.getAttribute('href')) || `${STORE_ORIGIN}/favicon.ico`
  };
}

function cleanProductTitle(value) {
  return String(value || '')
    .replace(/\s*[|｜]\s*(?:(?:My\s*)?Nintendo\s*Store|マイニンテンドーストア).*$/iu, '')
    .replace(/\s+on\s+Steam$/iu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
