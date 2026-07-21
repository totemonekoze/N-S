(() => {
  if (globalThis.SS_SEARCH_RULES) return;

  const japaneseGlyphEquivalents = new Map([
    ['噓', '嘘'],
    ['髙', '高'],
    ['﨑', '崎'],
    ['神', '神'],
    ['塚', '塚'],
    ['羽', '羽'],
    ['福', '福'],
    ['諸', '諸'],
    ['都', '都']
  ]);
  const steamExcludedPattern = /\b(?:bundle|soundtrack|ost|dlc|downloadable\s+content|content\s+pack|expansion(?:\s+pack)?|season\s+pass|character\s+pack|costume\s+pack|weapon\s+pack|demo|playtest|test\s*play|beta|prologue|trial)\b|バンドル|サウンドトラック|ダウンロードコンテンツ|拡張コンテンツ|シナリオ配信|追加|装備|デモ|体験版|テストプレイ|プレイテスト|ベータ/i;

  function normaliseTitle(value) {
    const foldLatin = (character) => character.normalize('NFD').replace(/\p{M}/gu, '');
    return String(value || '')
      .toLocaleLowerCase('ja-JP')
      .normalize('NFKC')
      .replace(/[噓髙﨑神塚羽福諸都]/gu, (character) => japaneseGlyphEquivalents.get(character) || character)
      .replace(/[\u00c0-\u024f]/g, foldLatin)
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isSteamExcluded(candidate) {
    const value = typeof candidate === 'object'
      ? [candidate.title, candidate.type, candidate.category].filter(Boolean).join(' ')
      : String(candidate || '');
    return steamExcludedPattern.test(value);
  }

  Object.defineProperty(globalThis, 'SS_SEARCH_RULES', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({ normaliseTitle, isSteamExcluded })
  });
})();
