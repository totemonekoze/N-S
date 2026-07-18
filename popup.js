import {
  getLanguagePreference,
  getUiLanguage,
  isConnectionError,
  setLanguagePreference,
  translate,
  translateProgress
} from './i18n.js';

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
const addFavorite = document.querySelector('#add-favorite');
const languageSection = document.querySelector('#language-section');
const languageSelect = document.querySelector('#language-select');

let activeTab;
let listDirection;
let listSource = 'steam-wishlist';
let counterpartUrl = '';
let productDirection = '';
let language = 'ja';

const LIST_SOURCES = {
  'steam-wishlist': { requestType: 'GET_WISHLIST', direction: 'steam-to-nintendo', labelKey: 'steamWishlist', errorKey: 'steamWishlistError' },
  'steam-owned-games': { requestType: 'GET_STEAM_OWNED_GAMES', direction: 'steam-to-nintendo', labelKey: 'steamOwnedGames', errorKey: 'steamOwnedGamesError' },
  'nintendo-wishlist': { requestType: 'GET_NINTENDO_WISHLIST', direction: 'nintendo-to-steam', labelKey: 'nintendoWishlist', errorKey: 'nintendoWishlistError' },
  'nintendo-vgc': { requestType: 'GET_NINTENDO_VIRTUAL_GAME_CARDS', direction: 'nintendo-to-steam', labelKey: 'nintendoVirtualGameCards', errorKey: 'nintendoVirtualGameCardsError' }
};

const t = (key, values) => translate(language, key, values);

count.addEventListener('change', () => {
  customCount.hidden = count.value !== 'custom';
  if (!customCount.hidden) customCount.focus();
});

run.addEventListener('click', startListBuild);
cancel.addEventListener('click', async () => {
  cancel.disabled = true;
  status.textContent = t('cancelling');
  await chrome.runtime.sendMessage({ type: 'CANCEL_BUILD' });
});

languageSelect.addEventListener('change', async () => {
  await setLanguagePreference(languageSelect.value);
  language = await getUiLanguage();
  applyTranslations();
});

openProduct.addEventListener('click', async () => {
  if (!counterpartUrl || !activeTab?.id) return;
  await chrome.tabs.update(activeTab.id, { url: counterpartUrl, active: true });
  window.close();
});

addFavorite.addEventListener('click', async () => {
  if (!counterpartUrl || !productDirection || addFavorite.dataset.busy) return;
  addFavorite.dataset.busy = 'true';
  addFavorite.disabled = true;
  addFavorite.textContent = t('addingFavorite');
  try {
    const steamTarget = productDirection === 'nintendo-to-steam';
    const response = await chrome.runtime.sendMessage({
      type: steamTarget ? 'ADD_TO_STEAM_WISHLIST' : 'ADD_TO_NINTENDO_WISHLIST',
      productUrl: counterpartUrl,
      title: counterpartTitle.textContent
    });
    if (!response?.ok) throw new Error(response?.error || t('favoriteAddFailed'));
    addFavorite.textContent = response.alreadyAdded ? t('alreadyInWishlist') : t('favoriteAdded');
    productStatus.hidden = true;
  } catch (error) {
    productStatus.hidden = false;
    productStatus.textContent = popupErrorMessage(error, t('favoriteAddFailed'));
    addFavorite.disabled = false;
    addFavorite.textContent = t(productFavoriteLabelKey());
  } finally {
    delete addFavorite.dataset.busy;
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'BUILD_PROGRESS' || listSection.hidden) return;
  status.textContent = translateProgress(language, message);
  if (message.state === 'complete' || message.state === 'cancelled') {
    run.hidden = false;
    run.disabled = false;
    cancel.hidden = true;
  }
});

async function initialise() {
  language = await getUiLanguage();
  languageSelect.value = await getLanguagePreference();
  applyTranslations();
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = activeTab?.url || '';
  if (url.startsWith('https://store.steampowered.com/wishlist/')) return showListMode('steam-wishlist');
  if (/^https:\/\/steamcommunity\.com\/profiles\/\d+\/games(?:[/?#]|$)/.test(url)) return showListMode('steam-owned-games');
  if (url.startsWith('https://store-jp.nintendo.com/wishlist')) return showListMode('nintendo-wishlist');
  if (/^https:\/\/accounts\.nintendo\.com\/portal\/vgcs(?:[/?#]|$)/.test(url)) return showListMode('nintendo-vgc');
  if (url.startsWith('https://store.steampowered.com/app/')) return showProductMode('steam-to-nintendo');
  if (/^https:\/\/store-jp\.nintendo\.com\/(item|products)\//.test(url)) return showProductMode('nintendo-to-steam');
  showUnsupported();
}

async function showListMode(source) {
  listSource = source;
  listDirection = LIST_SOURCES[source].direction;
  listSection.hidden = false;
  popup.classList.toggle('nintendo', listDirection === 'nintendo-to-steam');
  heading.textContent = 'S:S';
  const build = await chrome.runtime.sendMessage({ type: 'GET_BUILD_STATUS' });
  if (!build?.active) return;
  status.textContent = translateProgress(language, build);
  run.hidden = true;
  cancel.hidden = false;
}

async function showProductMode(direction) {
  productDirection = direction;
  popup.classList.add('product');
  popup.classList.toggle('nintendo', direction === 'nintendo-to-steam');
  productSection.hidden = false;
  heading.textContent = 'S:S';
  try {
    const sourceProduct = await readOpenProduct(direction);
    const result = await chrome.runtime.sendMessage({
      type: 'LOOKUP_COUNTERPART_PRODUCT',
      direction,
      sourceUrl: activeTab.url,
      sourceProduct
    });
    if (!result?.ok || !result.counterpart?.url) throw new Error(result?.error || t('notFound'));
    counterpartUrl = result.counterpart.url;
    counterpartTitle.textContent = result.counterpart.title;
    counterpartImage.src = result.counterpart.image || '';
    counterpartImage.alt = result.counterpart.title;
    counterpartCard.hidden = false;
    openProduct.hidden = false;
    addFavorite.textContent = t(productFavoriteLabelKey());
    addFavorite.hidden = false;
    productStatus.hidden = true;
  } catch (error) {
    productStatus.textContent = popupErrorMessage(error, t('notFound'));
  }
}

function productFavoriteLabelKey() {
  return productDirection === 'nintendo-to-steam' ? 'addSteamWishlistPopup' : 'addNintendoWishlistPopup';
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
  popup.classList.remove('nintendo');
  popup.classList.add('unsupported');
  heading.textContent = 'S:S';
  unsupported.hidden = false;
  languageSection.hidden = false;
}

async function startListBuild() {
  run.disabled = true;
  const isCustom = count.value === 'custom';
  const limit = isCustom ? Number(customCount.value) : Number(count.value);
  if (!Number.isInteger(limit) || (isCustom ? limit < 1 : limit < 0)) {
    status.textContent = t('invalidCount');
    run.disabled = false;
    return;
  }
  try {
    const source = LIST_SOURCES[listSource];
    status.textContent = t('checkingSource', { source: t(source.labelKey) });
    const request = { type: source.requestType, limit };
    const result = await chrome.tabs.sendMessage(activeTab.id, request);
    if (!result?.games?.length) throw new Error(t(source.errorKey));
    status.textContent = t('preparingSearch');
    const started = await chrome.runtime.sendMessage({ type: 'BUILD_LIST', games: result.games, originWindowId: activeTab.windowId, direction: listDirection, sourceType: listSource, limit });
    if (!started?.ok) throw new Error(started?.error || t('alreadyBuilding'));
    run.hidden = true;
    cancel.hidden = false;
  } catch (error) {
    status.textContent = popupErrorMessage(error, t('startFailed'));
    run.disabled = false;
  }
}

function popupErrorMessage(error, fallback) {
  const message = String(error?.message || error || '');
  if (isConnectionError(message)) return t('reloadPage');
  if (language === 'en' && /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(message)) return fallback;
  if (/[A-Za-z]{3}/.test(message) && !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(message)) return fallback;
  return message || fallback;
}

function applyTranslations() {
  document.documentElement.lang = language;
  document.querySelector('#count-label').textContent = t('countLabel');
  document.querySelector('#count-10').textContent = t('count10');
  document.querySelector('#count-50').textContent = t('count50');
  document.querySelector('#count-100').textContent = t('count100');
  document.querySelector('#count-all').textContent = t('allItems');
  document.querySelector('#count-custom').textContent = t('customCount');
  customCount.placeholder = t('countPlaceholder');
  run.textContent = t('buildList');
  cancel.textContent = t('cancelBuild');
  if (!productStatus.hidden) productStatus.textContent = t('searching');
  openProduct.textContent = t('openProductPage');
  if (!addFavorite.dataset.busy && !addFavorite.disabled) addFavorite.textContent = t(productFavoriteLabelKey());
  document.querySelector('#unsupported-line-1').textContent = t('unsupportedLine1');
  document.querySelector('#unsupported-line-2').textContent = t('unsupportedLine2');
  document.querySelector('#unsupported-line-3').textContent = t('unsupportedLine3');
  document.querySelector('#language-label').textContent = t('language');
  languageSelect.options[0].textContent = t('languageAuto');
  languageSelect.options[1].textContent = t('languageJapanese');
  languageSelect.options[2].textContent = t('languageEnglish');
}

initialise().catch(showUnsupported);
