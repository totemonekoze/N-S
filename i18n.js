const MESSAGES = {
  ja: {
    countLabel: '取得件数',
    count10: '10件',
    count50: '50件',
    count100: '100件',
    allItems: '全件',
    customCount: '任意の件数',
    countPlaceholder: '件数',
    buildList: '検索して一覧を作成',
    cancelBuild: '作成を中断',
    cancelling: '中断しています…',
    searching: '検索しています…',
    preparingSearch: '検索処理の準備中です…',
    searchInProgress: '検索処理中です…',
    openProductPage: '商品ページへ',
    notFound: '見つかりませんでした。',
    reloadPage: 'ページをリロードしてください',
    invalidCount: '任意の件数には 1 以上の整数を入力してください。',
    alreadyBuilding: 'すでに一覧を作成中です。',
    startFailed: '処理を開始できませんでした。',
    checkingSource: '{source}を確認しています…',
    steamWishlist: 'Steamのウィッシュリスト',
    steamOwnedGames: 'Steamの所持ゲーム',
    nintendoWishlist: 'Nintendo Storeのお気に入りリスト',
    nintendoVirtualGameCards: 'バーチャルゲームカード',
    steamWishlistError: 'Steamのウィッシュリストを取得できませんでした。',
    steamOwnedGamesError: 'Steamの所持ゲームを取得できませんでした。公開設定を確認してください。',
    nintendoWishlistError: 'Nintendo Storeのお気に入りを取得できませんでした。ログイン状態を確認してください。',
    nintendoVirtualGameCardsError: 'バーチャルゲームカードを取得できませんでした。ログイン状態を確認してください。',
    unsupportedLine1: 'Nintendo Store、',
    unsupportedLine2: 'または Steamのページで',
    unsupportedLine3: '起動してください',
    language: '表示言語',
    languageAuto: 'ブラウザーの設定',
    languageJapanese: '日本語',
    languageEnglish: 'English',
    settingsTitle: 'S:S の設定',
    languageDescription: '拡張機能内の表示言語を選択します。詳細画面の説明文はブラウザーの言語に合わせて自動表示されます。',
    saved: '保存しました。',
    operationFinished: '作成処理は完了または中断されています。',
    listCreated: '一覧を作成しました。',
    buildCancelled: '一覧作成を中断しました。',
    searchingNintendo: 'Nintendo Storeを検索中… {completed} / {total}',
    searchingSteam: 'Steamを検索中… {completed} / {total}',
    searchResults: '検索結果',
    summary: '{total} 件中 {matched} 件が{store}で見つかりました{date}',
    createdDate: '（{date}）',
    addManyToCart: 'まとめてカートに入れる',
    addManyToFavorite: 'まとめてお気に入りに追加',
    clearSelection: '選択解除',
    batchAddCount: 'まとめてカートに追加（{count}）',
    batchFavoriteCount: 'まとめてお気に入りに追加（{count}）',
    addingCount: '追加中…（{count}）',
    addFailed: '追加に失敗しました',
    cartAddFailed: 'カート追加に失敗しました',
    selectProduct: 'この商品を選択',
    openSteamProduct: 'Steam商品ページを開く',
    openNintendoProduct: 'Nintendo Store商品ページを開く',
    searchSteam: 'Steamで検索',
    openStoreProduct: '商品ページを開く',
    addSteamCart: 'Steamのカートに追加',
    addCart: 'カートに入れる',
    addSteamWishlist: 'Steamのウィッシュリストに追加',
    addNintendoWishlist: 'Nintendo Storeのお気に入りに追加',
    addSteamWishlistPopup: 'ウィッシュリストに追加',
    addNintendoWishlistPopup: 'ほしいものリストに追加',
    addingFavorite: 'お気に入りに追加中…',
    favoriteAdded: 'お気に入りに追加しました',
    alreadyInWishlist: 'お気に入りに追加済みです',
    favoriteAddFailed: 'お気に入り追加に失敗しました',
    adding: '追加中…',
    added: '追加しました',
    addFailedShort: '追加に失敗',
    priceUnavailable: '価格情報なし',
    searchError: '検索エラー',
    searchFailed: '検索に失敗しました',
    searchNintendo: 'Nintendo Storeで検索',
    resultsCreatedCount: '{count} 件の一覧を作成しました。',
    singleCartAdded: '{title}をカートに追加しました！',
    singleCartFailed: '{title}をカートに追加できませんでした。',
    singleFavoriteAdded: '{title}をお気に入りに追加しました！',
    singleFavoriteAlready: '{title}はお気に入りに追加済みです。',
    singleFavoriteFailed: '{title}をお気に入りに追加できませんでした。',
    batchCartAdded: '{added}件をカートに追加しました！',
    batchCartFailed: '{added}件をカートに追加しました。{failed}件は追加できませんでした。',
    batchFavoriteAdded: '{added}件をお気に入りに追加しました！',
    batchFavoriteFailed: '{added}件をお気に入りに追加しました。{failed}件は追加できませんでした。'
  },
  en: {
    countLabel: 'Items to retrieve',
    count10: '10 items',
    count50: '50 items',
    count100: '100 items',
    allItems: 'All items',
    customCount: 'Custom count',
    countPlaceholder: 'Count',
    buildList: 'Search and create list',
    cancelBuild: 'Cancel creation',
    cancelling: 'Cancelling…',
    searching: 'Searching…',
    preparingSearch: 'Preparing the search…',
    searchInProgress: 'Search in progress…',
    openProductPage: 'Open product page',
    notFound: 'Not found.',
    reloadPage: 'Please reload the page',
    invalidCount: 'Enter a whole number greater than zero.',
    alreadyBuilding: 'A list is already being created.',
    startFailed: 'Could not start the process.',
    checkingSource: 'Checking {source}…',
    steamWishlist: 'Steam wishlist',
    steamOwnedGames: 'Steam game library',
    nintendoWishlist: 'Nintendo Store wishlist',
    nintendoVirtualGameCards: 'Virtual Game Cards',
    steamWishlistError: 'Could not retrieve the Steam wishlist.',
    steamOwnedGamesError: 'Could not retrieve the Steam game library. Check its privacy settings.',
    nintendoWishlistError: 'Could not retrieve the Nintendo Store wishlist. Check that you are signed in.',
    nintendoVirtualGameCardsError: 'Could not retrieve Virtual Game Cards. Check that you are signed in.',
    unsupportedLine1: 'Open S:S on a',
    unsupportedLine2: 'Nintendo Store or Steam',
    unsupportedLine3: 'supported page.',
    language: 'Display language',
    languageAuto: 'Use browser setting',
    languageJapanese: '日本語',
    languageEnglish: 'English',
    settingsTitle: 'S:S settings',
    languageDescription: 'Choose the language used by the extension. The description on the extension details page follows the browser language.',
    saved: 'Saved.',
    operationFinished: 'The creation process has finished or was cancelled.',
    listCreated: 'The list has been created.',
    buildCancelled: 'List creation was cancelled.',
    searchingNintendo: 'Searching Nintendo Store… {completed} / {total}',
    searchingSteam: 'Searching Steam… {completed} / {total}',
    searchResults: 'Search Results',
    summary: '{matched} of {total} items were found on {store}{date}',
    createdDate: ' ({date})',
    addManyToCart: 'Add multiple items to cart',
    addManyToFavorite: 'Add multiple items to wishlist',
    clearSelection: 'Clear selection',
    batchAddCount: 'Add selected items ({count})',
    batchFavoriteCount: 'Add selected to wishlist ({count})',
    addingCount: 'Adding… ({count})',
    addFailed: 'Could not add items',
    cartAddFailed: 'Could not add to cart',
    selectProduct: 'Select this product',
    openSteamProduct: 'Open Steam product page',
    openNintendoProduct: 'Open Nintendo Store product page',
    searchSteam: 'Search on Steam',
    openStoreProduct: 'Open product page',
    addSteamCart: 'Add to Steam cart',
    addCart: 'Add to cart',
    addSteamWishlist: 'Add to Steam wishlist',
    addNintendoWishlist: 'Add to Nintendo Store wishlist',
    addSteamWishlistPopup: 'Add to wishlist',
    addNintendoWishlistPopup: 'Add to wishlist',
    addingFavorite: 'Adding to wishlist…',
    favoriteAdded: 'Added to wishlist',
    alreadyInWishlist: 'Already on wishlist',
    favoriteAddFailed: 'Could not add to wishlist',
    adding: 'Adding…',
    added: 'Added',
    addFailedShort: 'Add failed',
    priceUnavailable: 'Price unavailable',
    searchError: 'Search error',
    searchFailed: 'Search failed',
    searchNintendo: 'Search Nintendo Store',
    resultsCreatedCount: 'Created a list of {count} items.',
    singleCartAdded: 'Added {title} to the cart!',
    singleCartFailed: 'Could not add {title} to the cart.',
    singleFavoriteAdded: 'Added {title} to the wishlist!',
    singleFavoriteAlready: '{title} is already on the wishlist.',
    singleFavoriteFailed: 'Could not add {title} to the wishlist.',
    batchCartAdded: 'Added {added} items to the cart!',
    batchCartFailed: 'Added {added} items to the cart. Could not add {failed} items.',
    batchFavoriteAdded: 'Added {added} items to the wishlist!',
    batchFavoriteFailed: 'Added {added} items to the wishlist. Could not add {failed} items.'
  }
};

const STORAGE_KEY = 'uiLanguage';

export function browserLanguage() {
  const value = chrome.i18n?.getUILanguage?.() || globalThis.navigator?.language || 'ja';
  return String(value).toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export async function getUiLanguage() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] === 'ja' || stored[STORAGE_KEY] === 'en' ? stored[STORAGE_KEY] : browserLanguage();
}

export async function getLanguagePreference() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] === 'ja' || stored[STORAGE_KEY] === 'en' ? stored[STORAGE_KEY] : 'auto';
}

export async function setLanguagePreference(value) {
  if (value === 'ja' || value === 'en') await chrome.storage.local.set({ [STORAGE_KEY]: value });
  else await chrome.storage.local.remove(STORAGE_KEY);
}

export function translate(language, key, values = {}) {
  const dictionary = MESSAGES[language] || MESSAGES.ja;
  const template = dictionary[key] ?? MESSAGES.ja[key] ?? key;
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    template
  );
}

export function translateProgress(language, progress, fallbackKey = 'searchInProgress') {
  if (progress?.key) return translate(language, progress.key, progress.values || {});
  if (language === 'ja' && progress?.text) return progress.text;
  return translate(language, progress?.fallbackKey || fallbackKey);
}

export function isConnectionError(message) {
  return /Could not establish connection|Receiving end does not exist|message port|extension port|message channel|back\/forward cache/i.test(String(message || ''));
}
