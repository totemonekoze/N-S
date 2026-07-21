import { getUiLanguage, isConnectionError, translate } from './i18n.js';

const cards = document.querySelector('#cards');
const summary = document.querySelector('#summary');
const template = document.querySelector('#card-template');
const enterSelection = document.querySelector('#enter-selection');
const enterFavoriteSelection = document.querySelector('#enter-favorite-selection');
const cancelSelection = document.querySelector('#cancel-selection');
const selectionActions = document.querySelector('#selection-actions');
const batchAdd = document.querySelector('#batch-add');
const selectedProducts = new Set();
const productCards = new Map();
let steamMode = false;
let storeActionInProgress = false;
let selectionAction = 'cart';
const language = await getUiLanguage();
const t = (key, values) => translate(language, key, values);
document.documentElement.lang = language;
document.title = t('searchResults');
enterSelection.textContent = t('addManyToCart');
enterFavoriteSelection.textContent = t('addManyToFavorite');
cancelSelection.textContent = t('clearSelection');

function setSelectionMode(enabled, { action = selectionAction, force = false } = {}) {
  if (storeActionInProgress && !force) return;
  if (enabled) selectionAction = action;
  document.body.classList.toggle('selection-mode', enabled);
  enterSelection.hidden = enabled;
  enterFavoriteSelection.hidden = enabled;
  selectionActions.hidden = !enabled;
  if (!enabled) {
    selectedProducts.clear();
    document.querySelectorAll('.select-card').forEach((checkbox) => { checkbox.checked = false; });
  }
  updateBatchButton();
}

function updateBatchButton() {
  batchAdd.disabled = storeActionInProgress || selectedProducts.size === 0;
  batchAdd.textContent = t(selectionAction === 'favorite' ? 'batchFavoriteCount' : 'batchAddCount', { count: selectedProducts.size });
}

function setStoreActionInProgress(inProgress) {
  storeActionInProgress = inProgress;
  cancelSelection.disabled = inProgress;
  document.querySelectorAll('.select-card').forEach((checkbox) => { checkbox.disabled = inProgress; });
  updateBatchButton();
}

enterSelection.addEventListener('click', () => setSelectionMode(true, { action: 'cart' }));
enterFavoriteSelection.addEventListener('click', () => setSelectionMode(true, { action: 'favorite' }));
cancelSelection.addEventListener('click', () => setSelectionMode(false));

batchAdd.addEventListener('click', async () => {
  if (!selectedProducts.size || storeActionInProgress) return;
  const action = selectionAction;
  setStoreActionInProgress(true);
  batchAdd.textContent = t('addingCount', { count: selectedProducts.size });
  try {
    const response = await chrome.runtime.sendMessage({
      type: action === 'favorite'
        ? (steamMode ? 'ADD_MANY_TO_STEAM_WISHLIST' : 'ADD_MANY_TO_NINTENDO_WISHLIST')
        : (steamMode ? 'ADD_MANY_TO_STEAM_CART' : 'ADD_MANY_TO_NINTENDO_CART'),
      productUrls: [...selectedProducts]
    });
    if (response?.ok) {
      for (const failure of response.failed || []) {
        const entry = productCards.get(failure.url);
        if (entry) showActionFailure(entry, failure.error, action === 'favorite' ? t('favoriteAddFailed') : t('cartAddFailed'));
      }
      setSelectionMode(false, { force: true });
    } else {
      batchAdd.textContent = t('addFailed');
    }
  } catch {
    batchAdd.textContent = t('addFailed');
  } finally {
    setStoreActionInProgress(false);
  }
});

function showActionFailure(entry, message, fallback = t('cartAddFailed')) {
  entry.card.classList.add('error-card');
  entry.note.hidden = false;
  entry.note.textContent = shortErrorMessage(message, fallback);
}

function shortErrorMessage(message, fallback) {
  const text = String(message || '');
  if (isConnectionError(text)) return t('reloadPage');
  if (language === 'en' && /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text)) return fallback;
  if (/[A-Za-z]{3}/.test(text) && !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text)) return fallback;
  return text || fallback;
}

chrome.storage.local.get(['results', 'createdAt', 'resultMode'], ({ results = [], createdAt, resultMode }) => {
  steamMode = resultMode === 'nintendo-to-steam';
  document.body.classList.toggle('steam-mode', steamMode);
  const matched = results.filter((item) => steamMode ? item.steamUrl : item.productUrl).length;
  const storeName = steamMode ? 'Steam' : 'Nintendo Store';
  const date = createdAt
    ? t('createdDate', { date: new Date(createdAt).toLocaleString(language === 'ja' ? 'ja-JP' : 'en-US') })
    : '';
  summary.textContent = t('summary', { total: results.length, matched, store: storeName, date });
  for (const item of results) render(item);
});

function render(item) {
  const node = template.content.cloneNode(true);
  const card = node.querySelector('.card');
  const productLink = node.querySelector('.product-link');
  const cartButton = node.querySelector('.cart-button');
  const favoriteButton = node.querySelector('.favorite-button');
  const selectCard = node.querySelector('.select-card');
  const selectControl = node.querySelector('.select-control');
  const note = node.querySelector('.error-note');
  const actions = node.querySelector('.actions');
  const steamCoverLink = node.querySelector('.steam-cover-link');
  const nintendoCoverLink = node.querySelector('.nintendo-cover-link');
  const steamSearchUrl = `https://store.steampowered.com/search/?term=${encodeURIComponent(item.nintendoTitle || item.title)}`;
  const steamProductUrl = item.steamUrl || (item.steamAppId ? `https://store.steampowered.com/app/${item.steamAppId}/` : '');
  const nintendoProductUrl = item.productUrl || item.nintendoProductUrl || item.nintendoUrl || '';
  const destination = steamMode
    ? steamProductUrl || item.searchUrl || steamSearchUrl
    : nintendoProductUrl || item.searchUrl || `https://store-jp.nintendo.com/search/?q=${encodeURIComponent(item.title)}`;

  productLink.href = destination;
  productLink.textContent = '📋';
  setActionLabel(productLink, steamMode
    ? (steamProductUrl ? t('openSteamProduct') : t('searchSteam'))
    : (nintendoProductUrl ? t('openStoreProduct') : t('searchNintendo')));
  setCoverLink(steamCoverLink, steamProductUrl, t('openSteamProduct'));
  setCoverLink(nintendoCoverLink, nintendoProductUrl, t('openNintendoProduct'));

  const targetProductUrl = steamMode ? steamProductUrl : nintendoProductUrl;
  cartButton.hidden = false;
  cartButton.href = targetProductUrl || destination;
  cartButton.textContent = '🛒';
  setActionLabel(cartButton, steamMode ? t('addSteamCart') : t('addCart'));
  cartButton.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!targetProductUrl || cartButton.dataset.busy) return;
    cartButton.dataset.busy = 'true';
    setActionLabel(cartButton, t('adding'));
    cartButton.setAttribute('aria-disabled', 'true');
    try {
      const response = await chrome.runtime.sendMessage({
        type: steamMode ? 'ADD_TO_STEAM_CART' : 'ADD_TO_NINTENDO_CART',
        productUrl: targetProductUrl,
        title: item.title
      });
      if (response?.ok) {
        cartButton.classList.add('completed');
        setActionLabel(cartButton, t('added'));
      } else {
        setActionLabel(cartButton, t('addFailedShort'));
        showActionFailure({ card, note }, response?.error);
      }
    } catch (error) {
      setActionLabel(cartButton, t('addFailedShort'));
      showActionFailure({ card, note }, error?.message);
    } finally {
      cartButton.removeAttribute('aria-disabled');
      delete cartButton.dataset.busy;
    }
  });

  favoriteButton.hidden = false;
  favoriteButton.href = targetProductUrl || destination;
  favoriteButton.textContent = '⭐';
  setActionLabel(favoriteButton, steamMode ? t('addSteamWishlist') : t('addNintendoWishlist'));
  favoriteButton.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!targetProductUrl || favoriteButton.dataset.busy) return;
    favoriteButton.dataset.busy = 'true';
    favoriteButton.setAttribute('aria-disabled', 'true');
    setActionLabel(favoriteButton, t('addingFavorite'));
    try {
      const response = await chrome.runtime.sendMessage({
        type: steamMode ? 'ADD_TO_STEAM_WISHLIST' : 'ADD_TO_NINTENDO_WISHLIST',
        productUrl: targetProductUrl,
        title: item.title
      });
      if (response?.ok) {
        favoriteButton.classList.add('completed');
        setActionLabel(favoriteButton, response.alreadyAdded ? t('alreadyInWishlist') : t('favoriteAdded'));
      } else {
        setActionLabel(favoriteButton, t('favoriteAddFailed'));
        showActionFailure({ card, note }, response?.error || t('favoriteAddFailed'), t('favoriteAddFailed'));
      }
    } catch (error) {
      setActionLabel(favoriteButton, t('favoriteAddFailed'));
      showActionFailure({ card, note }, error?.message || t('favoriteAddFailed'), t('favoriteAddFailed'));
    } finally {
      favoriteButton.removeAttribute('aria-disabled');
      delete favoriteButton.dataset.busy;
    }
  });

  const cover = node.querySelector('.cover');
  cover.src = item.image || item.nintendoImage || '';
  cover.alt = item.nintendoTitle || item.title;
  cover.addEventListener('error', () => { cover.style.visibility = 'hidden'; });
  const steamCover = node.querySelector('.steam-cover');
  steamCover.src = item.steamImage || '';
  steamCover.alt = `${item.title}（Steam）`;
  steamCover.addEventListener('error', () => { steamCover.style.visibility = 'hidden'; });
  node.querySelector('.steam-store-icon').src = 'https://store.steampowered.com/favicon.ico';
  node.querySelector('.nintendo-store-icon').src = item.favicon || 'https://store-jp.nintendo.com/favicon.ico';
  node.querySelector('.steam-price').textContent = item.steamPrice || t('priceUnavailable');
  node.querySelector('.nintendo-price').textContent = item.nintendoPrice || (item.error ? t('searchError') : t('priceUnavailable'));
  const title = node.querySelector('.product-title');
  title.textContent = item.title || '';
  title.title = item.title || '';
  const source = node.querySelector('.source');
  const favicon = node.querySelector('.favicon');
  favicon.src = steamMode ? 'https://store.steampowered.com/favicon.ico' : item.favicon || 'https://store-jp.nintendo.com/favicon.ico';
  source.lastChild.textContent = steamMode ? 'Steam' : 'Nintendo Store';
  selectCard.setAttribute('aria-label', t('selectProduct'));

  if (item.error) {
    card.classList.add('error-card');
    note.hidden = false;
    note.textContent = shortErrorMessage(item.error, t('searchFailed'));
    cartButton.hidden = true;
    favoriteButton.hidden = true;
    actions.classList.add('single-action');
    selectCard.disabled = true;
    selectControl.hidden = true;
    setActionLabel(productLink, steamMode ? t('searchSteam') : t('searchNintendo'));
  }

  if (!item.error && targetProductUrl) {
    productCards.set(targetProductUrl, { card, note });
    selectCard.addEventListener('change', () => {
      if (selectCard.checked) selectedProducts.add(targetProductUrl);
      else selectedProducts.delete(targetProductUrl);
      updateBatchButton();
    });
    selectControl.addEventListener('click', (event) => event.stopPropagation());
    card.addEventListener('click', (event) => {
      if (!document.body.classList.contains('selection-mode') || selectCard.disabled || storeActionInProgress) return;
      event.preventDefault();
      event.stopPropagation();
      selectCard.checked = !selectCard.checked;
      selectCard.dispatchEvent(new Event('change'));
    });
  }
  cards.append(node);
}

function setCoverLink(link, url, label) {
  link.title = label;
  link.setAttribute('aria-label', label);
  if (url) link.href = url;
  else {
    link.removeAttribute('href');
    link.setAttribute('aria-disabled', 'true');
  }
}

function setActionLabel(element, label) {
  element.title = label;
  element.setAttribute('aria-label', label);
}
