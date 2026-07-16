const STEAM_ORIGIN = 'https://store.steampowered.com';

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type !== 'STEAM_SEARCH') return;
  readSteamSearch().then(respond);
  return true;
});

async function readSteamSearch() {
  const deadline = Date.now() + 5000;
  let candidates = collectSteamCandidates();
  while (!candidates.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    candidates = collectSteamCandidates();
  }
  return { candidates };
}

function collectSteamCandidates() {
  const seen = new Set();
  return [...document.querySelectorAll('a.search_result_row[href*="/app/"], #search_resultsRows a[href*="/app/"]')].map((row) => {
    const url = row.href;
    const steamAppId = url.match(/\/app\/(\d+)/)?.[1] || '';
    const imageNode = row.querySelector('img');
    const priceNode = row.querySelector('.discount_final_price, .search_price, [class*="price"]');
    return {
      url,
      steamAppId,
      title: row.querySelector('.title')?.textContent.replace(/\s+/g, ' ').trim() || imageNode?.alt?.trim() || '',
      image: imageNode?.currentSrc || imageNode?.src || '',
      price: priceNode?.textContent.replace(/\s+/g, ' ').trim() || ''
    };
  }).filter((item) => item.steamAppId && item.title && item.url.startsWith(STEAM_ORIGIN) && !seen.has(item.steamAppId) && seen.add(item.steamAppId));
}
