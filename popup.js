const popup = document.querySelector('#popup');
const heading = document.querySelector('#heading');
const listSection = document.querySelector('#list-section');
const productSection = document.querySelector('#product-section');
const unsupported = document.querySelector('#unsupported');
const run = document.querySelector('#run');
const cancel = document.querySelector('#cancel');
const status = document.querySelector('#status');
const count = document.querySelector('#count');
const customCount = document.querySelector('#custom-count');
const productStatus = document.querySelector('#product-status');
const counterpartCard = document.querySelector('#counterpart-card');
const counterpartImage = document.querySelector('#counterpart-image');
const counterpartTitle = document.querySelector('#counterpart-title');
const openProduct = document.querySelector('#open-product');

let activeTab;
let listDirection;
let counterpartUrl = '';

count.addEventListener('change', () => {
  customCount.hidden = count.value !== 'custom';
  if (!customCount.hidden) customCount.focus();
});

run.addEventListener('click', startListBuild);
cancel.addEventListener('click', async () => {
  cancel.disabled = true;
  status.textContent = '中断しています…';
  await chrome.runtime.sendMessage({ type: 'CANCEL_BUILD' });
});

openProduct.addEventListener('click', async () => {
  if (!counterpartUrl || !activeTab?.id) return;
  await chrome.tabs.update(activeTab.id, { url: counterpartUrl, active: true });
  window.close();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'BUILD_PROGRESS' || listSection.hidden) return;
  status.textContent = message.text;
  if (message.state === 'complete' || message.state === 'cancelled') {
    run.hidden = false;
    run.disabled = false;
    cancel.hidden = true;
  }
});

async function initialise() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = activeTab?.url || '';
  if (url.startsWith('https://store.steampowered.com/wishlist/')) return showListMode('steam-to-nintendo');
  if (url.startsWith('https://store-jp.nintendo.com/wishlist')) return showListMode('nintendo-to-steam');
  if (url.startsWith('https://store.steampowered.com/app/')) return showProductMode('steam-to-nintendo');
  if (/^https:\/\/store-jp\.nintendo\.com\/(item|products)\//.test(url)) return showProductMode('nintendo-to-steam');
  showUnsupported();
}

async function showListMode(direction) {
  listDirection = direction;
  listSection.hidden = false;
  popup.classList.toggle('nintendo', direction === 'nintendo-to-steam');
  heading.textContent = 'N/S';
  const build = await chrome.runtime.sendMessage({ type: 'GET_BUILD_STATUS' });
  if (!build?.active) return;
  status.textContent = build.text || '検索処理中です…';
  run.hidden = true;
  cancel.hidden = false;
}

async function showProductMode(direction) {
  popup.classList.toggle('nintendo', direction === 'nintendo-to-steam');
  productSection.hidden = false;
  heading.textContent = 'N/S';
  try {
    const sourceProduct = await readOpenProduct(direction);
    const result = await chrome.runtime.sendMessage({
      type: 'LOOKUP_COUNTERPART_PRODUCT',
      direction,
      sourceUrl: activeTab.url,
      sourceProduct
    });
    if (!result?.ok || !result.counterpart?.url) throw new Error(result?.error || '見つかりませんでした。');
    counterpartUrl = result.counterpart.url;
    counterpartTitle.textContent = result.counterpart.title;
    counterpartImage.src = result.counterpart.image || '';
    counterpartImage.alt = result.counterpart.title;
    counterpartCard.hidden = false;
    openProduct.hidden = false;
    productStatus.hidden = true;
  } catch (error) {
    productStatus.textContent = error.message || '見つかりませんでした。';
  }
}

async function readOpenProduct(direction) {
  const type = direction === 'steam-to-nintendo' ? 'STEAM_PRODUCT' : 'NINTENDO_PRODUCT';
  try {
    return await chrome.tabs.sendMessage(activeTab.id, { type });
  } catch {
    // 既存タブにコンテンツスクリプトがない場合は、バックグラウンド側で従来どおり再取得する。
    return null;
  }
}

function showUnsupported() {
  popup.classList.add('unsupported');
  unsupported.hidden = false;
}

async function startListBuild() {
  run.disabled = true;
  const isCustom = count.value === 'custom';
  const limit = isCustom ? Number(customCount.value) : Number(count.value);
  if (!Number.isInteger(limit) || (isCustom ? limit < 1 : limit < 0)) {
    status.textContent = '任意の件数には 1 以上の整数を入力してください。';
    run.disabled = false;
    return;
  }
  try {
    status.textContent = 'お気に入りリストを確認しています…';
    const request = listDirection === 'steam-to-nintendo' ? { type: 'GET_WISHLIST', limit } : { type: 'GET_NINTENDO_WISHLIST' };
    const result = await chrome.tabs.sendMessage(activeTab.id, request);
    if (!result?.games?.length) throw new Error(listDirection === 'nintendo-to-steam' ? 'Nintendo Storeのお気に入りを取得できませんでした。ログイン状態を確認してください。' : 'ゲームを取得できませんでした。');
    status.textContent = `${result.games.length} 件を検索しています…`;
    const started = await chrome.runtime.sendMessage({ type: 'BUILD_LIST', games: result.games, originWindowId: activeTab.windowId, direction: listDirection, limit });
    if (!started?.ok) throw new Error(started?.error || 'すでに一覧を作成中です。');
    run.hidden = true;
    cancel.hidden = false;
  } catch (error) {
    status.textContent = error.message || '処理を開始できませんでした。';
    run.disabled = false;
  }
}

initialise().catch(showUnsupported);
