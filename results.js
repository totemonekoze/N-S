const cards = document.querySelector('#cards');
const summary = document.querySelector('#summary');
const template = document.querySelector('#card-template');
const enterSelection = document.querySelector('#enter-selection');
const cancelSelection = document.querySelector('#cancel-selection');
const selectionActions = document.querySelector('#selection-actions');
const batchAdd = document.querySelector('#batch-add');
const selectedProducts = new Set();
const productCards = new Map();
let steamMode = false;
let cartAdditionInProgress = false;

function setSelectionMode(enabled, force = false) {
  if (cartAdditionInProgress && !force) return;
  document.body.classList.toggle('selection-mode', enabled);
  enterSelection.hidden = enabled;
  selectionActions.hidden = !enabled;
  if (!enabled) {
    selectedProducts.clear();
    document.querySelectorAll('.select-card').forEach((checkbox) => { checkbox.checked = false; });
  }
  updateBatchButton();
}

function updateBatchButton() {
  batchAdd.disabled = cartAdditionInProgress || selectedProducts.size === 0;
  batchAdd.textContent = `まとめてカートに追加（${selectedProducts.size}）`;
}

function setCartAdditionInProgress(inProgress) {
  cartAdditionInProgress = inProgress;
  cancelSelection.disabled = inProgress;
  document.querySelectorAll('.select-card').forEach((checkbox) => { checkbox.disabled = inProgress; });
  updateBatchButton();
}

enterSelection.addEventListener('click', () => setSelectionMode(true));
cancelSelection.addEventListener('click', () => setSelectionMode(false));

batchAdd.addEventListener('click', async () => {
  if (!selectedProducts.size || cartAdditionInProgress) return;
  setCartAdditionInProgress(true);
  batchAdd.textContent = `追加中…（${selectedProducts.size}）`;
  try {
    const response = await chrome.runtime.sendMessage({ type: steamMode ? 'ADD_MANY_TO_STEAM_CART' : 'ADD_MANY_TO_NINTENDO_CART', productUrls: [...selectedProducts] });
    if (response?.ok) {
      for (const failure of response.failed || []) {
        const entry = productCards.get(failure.url);
        if (entry) showCartFailure(entry, failure.error);
      }
      setSelectionMode(false, true);
    } else {
      batchAdd.textContent = '追加に失敗しました';
    }
  } catch {
    batchAdd.textContent = '追加に失敗しました';
  } finally {
    setCartAdditionInProgress(false);
  }
});

function showCartFailure(entry, message) {
  entry.card.classList.add('error-card');
  entry.note.hidden = false;
  entry.note.textContent = message || 'カートへの追加に失敗しました';
}

chrome.storage.local.get(['results', 'createdAt', 'resultMode'], ({ results = [], createdAt, resultMode }) => {
  steamMode = resultMode === 'nintendo-to-steam';
  document.title = steamMode ? 'N→S' : 'S→N';
  document.body.classList.toggle('steam-mode', steamMode);
  const matched = results.filter((item) => steamMode ? item.steamUrl : item.productUrl).length;
  const storeName = steamMode ? 'Steam' : 'Nintendo Store';
  summary.textContent = `${results.length} 件中 ${matched} 件が${storeName}で見つかりました${createdAt ? `（${new Date(createdAt).toLocaleString('ja-JP')}）` : ''}`;
  for (const item of results) render(item);
});

function render(item) {
  const node = template.content.cloneNode(true);
  const card = node.querySelector('.card');
  const productLink = node.querySelector('.product-link');
  const cartButton = node.querySelector('.cart-button');
  const selectCard = node.querySelector('.select-card');
  const selectControl = node.querySelector('.select-control');
  const note = node.querySelector('.error-note');
  const actions = node.querySelector('.actions');
  const steamSearchUrl = `https://store.steampowered.com/search/?term=${encodeURIComponent(item.nintendoTitle || item.title)}`;
  const destination = steamMode
    ? item.steamUrl || item.searchUrl || steamSearchUrl
    : item.productUrl || item.searchUrl || `https://store-jp.nintendo.com/search/?q=${encodeURIComponent(item.title)}`;

  productLink.href = destination;
  productLink.textContent = steamMode ? (item.steamUrl ? 'Steam商品ページを開く' : 'Steamで検索') : '商品ページを開く';
  const cartUrl = steamMode ? item.steamUrl : item.productUrl;
  cartButton.hidden = false;
  cartButton.href = cartUrl || destination;
  cartButton.textContent = steamMode ? 'Steamのカートに追加' : 'カートに入れる';
  cartButton.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!cartUrl || cartButton.dataset.busy) return;
    cartButton.dataset.busy = 'true';
    cartButton.textContent = '追加中…';
    cartButton.setAttribute('aria-disabled', 'true');
    const response = await chrome.runtime.sendMessage({
      type: steamMode ? 'ADD_TO_STEAM_CART' : 'ADD_TO_NINTENDO_CART',
      productUrl: cartUrl,
      title: item.title
    });
    if (response?.ok) cartButton.textContent = '追加しました';
    else {
      cartButton.textContent = '追加に失敗';
      showCartFailure({ card, note }, response?.error);
      cartButton.removeAttribute('aria-disabled');
      delete cartButton.dataset.busy;
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
  node.querySelector('.steam-price').textContent = item.steamPrice || '価格情報なし';
  node.querySelector('.nintendo-price').textContent = item.nintendoPrice || (item.error ? '検索エラー' : '価格情報なし');
  node.querySelector('.product-title').textContent = item.title;
  const source = node.querySelector('.source');
  const favicon = node.querySelector('.favicon');
  favicon.src = steamMode ? 'https://store.steampowered.com/favicon.ico' : item.favicon || 'https://store-jp.nintendo.com/favicon.ico';
  source.lastChild.textContent = steamMode ? 'Steam' : 'Nintendo Store';

  if (item.error) {
    card.classList.add('error-card');
    note.hidden = false;
    note.textContent = item.error;
    cartButton.hidden = true;
    actions.classList.add('single-action');
    selectCard.disabled = true;
    selectControl.hidden = true;
    productLink.textContent = steamMode ? 'Steamで検索' : 'Nintendo Storeで検索';
  }

  if (!item.error && cartUrl) {
    productCards.set(cartUrl, { card, note });
    selectCard.addEventListener('change', () => {
      if (selectCard.checked) selectedProducts.add(cartUrl);
      else selectedProducts.delete(cartUrl);
      updateBatchButton();
    });
  }
  cards.append(node);
}
