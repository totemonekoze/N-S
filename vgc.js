const NINTENDO_ACCOUNT_ORIGIN = 'https://accounts.nintendo.com';

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type !== 'GET_NINTENDO_VIRTUAL_GAME_CARDS') return;
  collectVirtualGameCards(message.limit).then((games) => respond({ games }));
  return true;
});

async function collectVirtualGameCards(limit) {
  const found = new Map();
  const deadline = Date.now() + 6000;
  collectVisibleVirtualGameCards(found);
  while (!found.size && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    collectVisibleVirtualGameCards(found);
  }
  await collectVirtualGameCardsWhileScrolling(found, limit);
  const games = [...found.values()].filter((game) => game.title);
  return limit > 0 ? games.slice(0, limit) : games;
}

function collectVisibleVirtualGameCards(found) {
  const cards = document.querySelectorAll('[data-testid*="game" i], [data-testid*="card" i], [class*="game" i], [class*="card" i], article, li');
  for (const card of cards) {
    const imageNode = [...card.querySelectorAll('img[alt]')].find((image) => isVirtualGameTitle(image.alt));
    const title = normaliseVirtualGameTitle(
      imageNode?.alt ||
      [...card.querySelectorAll('[data-testid*="title" i], [class*="title" i], [class*="name" i], h1, h2, h3, h4, p, [aria-label]')]
        .map((node) => node.textContent || node.getAttribute('aria-label') || '')
        .map(normaliseVirtualGameTitle)
        .find(isVirtualGameTitle) || ''
    );
    const key = title.toLocaleLowerCase('ja-JP');
    if (!key || !isVirtualGameTitle(title) || found.has(key)) continue;
    found.set(key, {
      title,
      nintendoTitle: title,
      nintendoImage: imageNode?.currentSrc || imageNode?.src || '',
      nintendoPrice: '',
      favicon: `${NINTENDO_ACCOUNT_ORIGIN}/favicon.ico`
    });
  }
}

async function collectVirtualGameCardsWhileScrolling(found, limit) {
  const target = limit > 0 ? limit : Number.POSITIVE_INFINITY;
  if (found.size >= target) return;
  const root = document.scrollingElement || document.documentElement;
  const initialPosition = window.scrollY;
  const step = Math.max(360, Math.floor(window.innerHeight * 0.8));
  let position = 0;
  try {
    for (let attempts = 0; attempts < 250 && found.size < target; attempts += 1) {
      const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo(0, position);
      await new Promise((resolve) => setTimeout(resolve, 120));
      collectVisibleVirtualGameCards(found);
      if (position >= maximum) break;
      position = Math.min(maximum, position + step);
    }
  } finally {
    window.scrollTo(0, initialPosition);
  }
}

function normaliseVirtualGameTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isVirtualGameTitle(value) {
  const title = normaliseVirtualGameTitle(value);
  if (title.length < 2 || title.length > 180) return false;
  return !/^(?:Nintendo|ニンテンドー|バーチャルゲームカード|ゲームカード|メニュー|ログイン|ログアウト|戻る|次へ|設定|購入|ダウンロード|ヘルプ|利用規約|プライバシーポリシー|任天堂ホームページ|アカウント新規作成)$/iu.test(title);
}
