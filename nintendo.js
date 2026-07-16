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
  return [...document.querySelectorAll('a[href*="/item/"], a[href*="/products/"]')].map((a) => {
    const url = new URL(a.getAttribute('href'), location.href).href;
    const scope = a.closest('li, article, [class*="card"], [class*="product"], [class*="item"]') || a;
    const imageNode = scope.querySelector('img[src]');
    const image = imageNode?.currentSrc || imageNode?.src || '';
    const text = scope.textContent.replace(/\s+/g, ' ').trim();
    const price = text.match(/(?:(?:￥|¥)\s*)?[\d,]+\s*円/)?.[0] || '';
    // 商品カードの画像altは、検索結果全体の文字列より正確な商品名。
    return { url, title: imageNode?.alt?.trim() || a.textContent.replace(/\s+/g, ' ').trim() || text, image, price };
  }).filter((item) => item.url.startsWith(STORE_ORIGIN) && (/\/item\//.test(item.url) || /\/products\//.test(item.url)) && !seen.has(item.url) && seen.add(item.url));
}

function readMetadata() {
  const meta = (selector) => document.querySelector(selector)?.getAttribute('content')?.trim();
  const absolute = (value) => value ? new URL(value, location.href).href : undefined;
  return {
    title: meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || document.title,
    image: absolute(meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]') || meta('meta[itemprop="image"]')),
    favicon: absolute(document.querySelector('link[rel~="icon"]')?.getAttribute('href')) || `${STORE_ORIGIN}/favicon.ico`
  };
}
