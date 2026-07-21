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
    readProductMetadata().then(respond);
    return true;
  }
  if (message.type === 'NINTENDO_ADD_TO_CART') {
    addToCart().then(respond, (error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'NINTENDO_ADD_TO_WISHLIST') {
    addToWishlist().then(respond, (error) => respond({ ok: false, error: error.message }));
    return true;
  }
});

async function readNintendoWishlist() {
  const candidates = await waitForCandidates(7000);
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

async function addToWishlist() {
  const deadline = Date.now() + 8000;
  let clickedButton = null;
  let clickedAt = 0;
  while (Date.now() < deadline) {
    const controls = wishlistControls();
    if (controls.some(isWishlistAddedControl)) return { ok: true, alreadyAdded: !clickedButton };

    if (!clickedButton) {
      const addButton = controls.find((control) => isWishlistAddControl(control) && !control.disabled);
      if (addButton) {
        clickedButton = addButton;
        clickedAt = Date.now();
        addButton.click();
      }
    } else if ((!clickedButton.isConnected || !isControlAvailable(clickedButton)) && Date.now() - clickedAt >= 500) {
      return { ok: true, alreadyAdded: false };
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  if (clickedButton) throw new Error('お気に入りへの追加を確認できませんでした。');
  throw new Error('お気に入りに追加するボタンが見つかりませんでした。ログイン状態を確認してください。');
}

function wishlistControls() {
  return [...document.querySelectorAll('main button, main [role="button"], main a')]
    .filter((control) => /ほしいもの|お気に入り|wishlist|favorite/i.test(wishlistControlLabel(control)))
    .filter(isControlAvailable);
}

function wishlistControlLabel(control) {
  return [
    control.textContent,
    control.getAttribute('aria-label'),
    control.getAttribute('title'),
    control.getAttribute('data-testid'),
    control.getAttribute('data-test'),
    control.className
  ].filter((value) => typeof value === 'string').join(' ').replace(/\s+/g, ' ').trim();
}

function isWishlistAddedControl(control) {
  const label = wishlistControlLabel(control);
  return control.getAttribute('aria-pressed') === 'true'
    || control.getAttribute('aria-checked') === 'true'
    || /(?:ほしいもの|お気に入り).*(?:追加済み|登録済み|から削除)|(?:remove from|in|on) (?:the )?(?:wishlist|favorites?)/i.test(label);
}

function isWishlistAddControl(control) {
  const label = wishlistControlLabel(control);
  return (
    /(?:ほしいもの|お気に入り).*(?:に追加|へ追加|登録)|add to (?:the )?(?:wishlist|favorites?)/i.test(label)
    || /^(?:ほしいもの|お気に入り)(?:リスト)?ボタン(?:\s|$)/i.test(label)
  ) && !isWishlistAddedControl(control);
}

function isControlAvailable(control) {
  if (!control?.isConnected || control.hidden || control.getAttribute('aria-hidden') === 'true') return false;
  const style = window.getComputedStyle(control);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

async function findCandidates() {
  // SPAがタイトルだけ先に描画する場合があるため、画像・価格が安定するまで待つ。
  const candidates = await waitForCandidates(7000);
  return { candidates, noMatch: document.querySelector('main')?.innerText.includes('条件に一致する商品は見つかりませんでした') || false };
}

async function waitForCandidates(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let best = [];
  let previousSignature = '';
  let stableCount = 0;
  while (Date.now() < deadline) {
    const candidates = collectCandidates();
    if (candidateCompleteness(candidates) >= candidateCompleteness(best)) best = candidates;
    const signature = candidates.map((item) => `${item.url}|${item.title}|${item.image}|${item.price}`).join('\n');
    stableCount = signature && signature === previousSignature ? stableCount + 1 : 0;
    const complete = candidates.length && candidates.every((item) => item.title && item.image && item.price);
    if ((complete && stableCount >= 2) || (candidates.length && stableCount >= 8)) return candidates;
    previousSignature = signature;
    await new Promise((resolve) => setTimeout(resolve, 140));
  }
  return best;
}

function candidateCompleteness(candidates) {
  return candidates.length * 10 + candidates.filter((item) => item.title).length + candidates.filter((item) => item.image).length + candidates.filter((item) => item.price).length;
}

function collectCandidates() {
  // 現行ストアは /item/software/...、旧形式は /products/... を使う。
  const candidates = [...document.querySelectorAll('a[href*="/item/"], a[href*="/products/"]')].map((a) => {
    const url = new URL(a.getAttribute('href'), location.href).href;
    const scope = a.closest('li, article, [class*="card"], [class*="product"], [class*="item"]') || a;
    const card = a.querySelector('img') ? a : scope;
    const imageNode = findProductImage(card) || findProductImage(scope);
    const image = readImageUrl(imageNode);
    const text = scope.textContent.replace(/\s+/g, ' ').trim();
    const priceText = scope.querySelector('.cart-product-price, [class*="price" i]')?.textContent || text;
    const price = readNintendoPrice(priceText);
    return { url, title: readCardTitle(card, imageNode) || readCardTitle(scope, findProductImage(scope)) || '', image, price };
  }).filter((item) => item.url.startsWith(STORE_ORIGIN) && (/\/item\//.test(item.url) || /\/products\//.test(item.url)));
  const bestByUrl = new Map();
  for (const candidate of candidates) {
    const existing = bestByUrl.get(candidate.url);
    if (!existing || candidateCompleteness([candidate]) > candidateCompleteness([existing])) bestByUrl.set(candidate.url, candidate);
  }
  return [...bestByUrl.values()].map((candidate, rank) => ({ ...candidate, rank }));
}

function findProductImage(scope) {
  return [...scope.querySelectorAll('img')].find((image) => isProductTitle(image.alt) && readImageUrl(image)) || null;
}

function readImageUrl(image) {
  if (!image) return '';
  const srcset = image.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0] || '';
  return [image.currentSrc, image.src, image.getAttribute('data-src'), image.getAttribute('data-lazy-src'), srcset]
    .map((value) => String(value || '').trim())
    .find((value) => /^https?:\/\//i.test(value) && !/(?:loading|placeholder|transparent|blank)\.(?:gif|png|svg)(?:\?|$)/i.test(value)) || '';
}

function readNintendoPrice(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (/無料/u.test(text)) return '無料';
  const matches = [...text.matchAll(/(?:[￥¥]\s*[\d,]+|[\d,]+\s*円)/gu)].map((match) => match[0].replace(/\s+/g, ''));
  return matches.at(-1) || '';
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

async function readProductMetadata() {
  const deadline = Date.now() + 6000;
  let best = readMetadata();
  while (Date.now() < deadline && (!best.title || !best.image || !best.price)) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const current = readMetadata();
    if (metadataCompleteness(current) >= metadataCompleteness(best)) best = current;
  }
  return best;
}

function metadataCompleteness(metadata) {
  return Number(Boolean(metadata.title)) + Number(Boolean(metadata.image)) + Number(Boolean(metadata.price));
}

function readMetadata() {
  const meta = (selector) => document.querySelector(selector)?.getAttribute('content')?.trim();
  const absolute = (value) => value ? new URL(value, location.href).href : undefined;
  const headingTitle = [...document.querySelectorAll('main h1')].map((node) => node.textContent.replace(/\s+/g, ' ').trim()).find(isProductTitle) || '';
  const title = cleanProductTitle(meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || headingTitle || document.title);
  const heroImage = [...document.querySelectorAll('main img')].find((image) => (!title || image.alt?.includes(title)) && readImageUrl(image));
  const cartButton = [...document.querySelectorAll('main button')].find((button) => button.textContent.replace(/\s+/g, ' ').trim() === 'カートに入れる');
  let purchaseScope = cartButton;
  while (purchaseScope?.parentElement && purchaseScope !== document.querySelector('main') && !purchaseScope.querySelector?.('.cart-product-price')) purchaseScope = purchaseScope.parentElement;
  const priceText = purchaseScope?.querySelector?.('.cart-product-price')?.textContent || document.querySelector('main .cart-product-price')?.textContent || '';
  return {
    title,
    image: absolute(meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]') || meta('meta[itemprop="image"]') || readImageUrl(heroImage)),
    price: readNintendoPrice(priceText),
    nintendoPrice: readNintendoPrice(priceText),
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
