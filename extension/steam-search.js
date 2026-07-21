const STEAM_ORIGIN = 'https://store.steampowered.com';

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type !== 'STEAM_SEARCH') return;
  readSteamSearch().then(respond);
  return true;
});

async function readSteamSearch() {
  const startedAt = Date.now();
  const deadline = Date.now() + 7000;
  const query = new URLSearchParams(location.search).get('term') || '';
  const queryKey = normaliseSteamSearchTitle(query);
  let best = [];
  let previousSignature = '';
  let stableCount = 0;
  while (Date.now() < deadline) {
    const candidates = collectSteamCandidates();
    if (steamCandidateCompleteness(candidates) >= steamCandidateCompleteness(best)) best = candidates;
    const signature = candidates.map((candidate) => `${candidate.steamAppId}|${candidate.title}`).join('\n');
    stableCount = signature && signature === previousSignature ? stableCount + 1 : 0;
    const hasExactTitle = queryKey && candidates.some((candidate) => normaliseSteamSearchTitle(candidate.title) === queryKey);
    // Steam検索は結果行を段階的に描画する。先頭のDLCだけで確定せず、本体行まで待つ。
    if (candidates.length && ((hasExactTitle && stableCount >= 1) || (Date.now() - startedAt >= 900 && stableCount >= 3))) {
      return { candidates };
    }
    previousSignature = signature;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return { candidates: best };
}

function steamCandidateCompleteness(candidates) {
  return candidates.length * 10 + candidates.filter((candidate) => candidate.title).length;
}

function normaliseSteamSearchTitle(value) {
  return globalThis.SS_SEARCH_RULES.normaliseTitle(value);
}

function collectSteamCandidates() {
  const seen = new Set();
  const rows = collectResultRows();
  const candidates = rows.map((row) => {
    const url = row.href;
    const steamAppId = url.match(/\/app\/(\d+)/)?.[1] || '';
    const scope = row.closest('.search_result_row, [data-ds-appid], li, article') || row;
    const imageNode = row.querySelector('img') || scope.querySelector('img');
    const priceNode = row.querySelector('.match_subtitle, .discount_final_price, .search_price, [class*="price" i]') || scope.querySelector('.match_subtitle, .discount_final_price, .search_price, [class*="price" i]');
    const titleNode = row.querySelector('.match_name, .title, [class*="title" i]') || scope.querySelector('.match_name, .title, [class*="title" i]');
    const searchKey = steamTitleFromUrl(url);
    return {
      url,
      steamAppId,
      title: titleNode?.textContent.replace(/\s+/g, ' ').trim() || imageNode?.alt?.trim() || firstTitleLine(row.innerText) || searchKey,
      searchKey,
      searchText: (scope.innerText || scope.textContent || '').replace(/\s+/g, ' ').trim(),
      image: readImageUrl(imageNode),
      price: readSteamPrice(priceNode?.textContent || '')
    };
  }).filter((item) => item.steamAppId && item.title && item.url.startsWith(STEAM_ORIGIN) && !seen.has(item.steamAppId) && seen.add(item.steamAppId));
  return candidates.map((candidate, rank) => ({ ...candidate, rank }));
}

function readImageUrl(image) {
  if (!image) return '';
  const srcset = image.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0] || '';
  return [image.currentSrc, image.src, image.getAttribute('data-src'), image.getAttribute('data-lazy-src'), srcset]
    .map((value) => String(value || '').trim())
    .find((value) => /^https?:\/\//i.test(value) && !/(?:loading|placeholder|transparent|blank)\.(?:gif|png|svg)(?:\?|$)/i.test(value)) || '';
}

function readSteamPrice(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (/^(?:無料|free(?:\s+to\s+play)?)$/iu.test(text)) return /無料/u.test(text) ? '無料' : 'Free';
  const matches = [...text.matchAll(/(?:[￥¥$€£]\s*[\d,.]+|[\d,.]+\s*(?:円|USD|JPY|EUR|GBP))/giu)].map((match) => match[0].replace(/\s+/g, ''));
  return matches.at(-1) || '';
}

function collectResultRows() {
  const primary = [...document.querySelectorAll('a.search_result_row[href*="/app/"], #search_resultsRows a[href*="/app/"], a.match_app[href*="/app/"]')];
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
