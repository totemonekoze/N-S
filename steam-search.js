const STEAM_ORIGIN = 'https://store.steampowered.com';

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type !== 'STEAM_SEARCH') return;
  readSteamSearch().then(respond);
  return true;
});

async function readSteamSearch() {
  const deadline = Date.now() + 7000;
  let candidates = collectSteamCandidates();
  while (!candidates.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    candidates = collectSteamCandidates();
  }
  return { candidates };
}

function collectSteamCandidates() {
  const seen = new Set();
  const rows = collectResultRows();
  const candidates = rows.map((row) => {
    const url = row.href;
    const steamAppId = url.match(/\/app\/(\d+)/)?.[1] || '';
    const scope = row.closest('.search_result_row, [data-ds-appid], li, article') || row;
    const imageNode = row.querySelector('img') || scope.querySelector('img');
    const priceNode = row.querySelector('.discount_final_price, .search_price, [class*="price" i]') || scope.querySelector('.discount_final_price, .search_price, [class*="price" i]');
    const titleNode = row.querySelector('.title, [class*="title" i]') || scope.querySelector('.title, [class*="title" i]');
    const searchKey = steamTitleFromUrl(url);
    return {
      url,
      steamAppId,
      title: titleNode?.textContent.replace(/\s+/g, ' ').trim() || imageNode?.alt?.trim() || firstTitleLine(row.innerText) || searchKey,
      searchKey,
      image: imageNode?.currentSrc || imageNode?.src || '',
      price: priceNode?.textContent.replace(/\s+/g, ' ').trim() || ''
    };
  }).filter((item) => item.steamAppId && item.title && item.url.startsWith(STEAM_ORIGIN) && !seen.has(item.steamAppId) && seen.add(item.steamAppId));
  return candidates.map((candidate, rank) => ({ ...candidate, rank }));
}

function collectResultRows() {
  const primary = [...document.querySelectorAll('a.search_result_row[href*="/app/"], #search_resultsRows a[href*="/app/"]')];
  if (primary.length) return primary;
  return [...document.querySelectorAll('a[href*="/app/"]')].filter((row) => {
    const appId = row.dataset.dsAppid || row.closest('[data-ds-appid]')?.dataset.dsAppid || row.href.match(/\/app\/(\d+)/)?.[1];
    return Boolean(appId && row.closest('[class*="search" i], #search_resultsRows, main'));
  });
}

function firstTitleLine(value) {
  return String(value || '').split(/\n+/).map((line) => line.trim()).find((line) => line && !/^(?:¥|￥|\d|無料|\d{4}年)/.test(line)) || '';
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
