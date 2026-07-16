(() => {
  const PURCHASE_SUFFIXES = ['を購入', 'を購入する', 'purchase'];

  document.addEventListener('steam-wishlist-cart-request', async (event) => {
    const { requestId, title: requestedTitle } = event.detail || {};
    if (!requestId) return;

    try {
      const result = await addSteamCartItem(requestedTitle);
      respond(requestId, result);
    } catch (error) {
      respond(requestId, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  async function addSteamCartItem(requestedTitle) {
    const pageTitle = text(document.querySelector('#appHubAppName')?.textContent || requestedTitle);
    if (!pageTitle) throw new Error('Steamのゲームタイトルを取得できませんでした。');
    if (isExcluded(pageTitle)) throw new Error('バンドルまたはサウンドトラックはカートに追加できません。');

    const purchase = await waitForPurchase(pageTitle);
    if (!purchase) throw new Error('Steamの商品本体を購入する枠が見つかりませんでした。');

    const button = findCartButton(purchase);
    if (!button) throw new Error('Steamのカートに入れるボタンが見つかりませんでした。');
    if (inCart(button)) {
      button.click();
      return { ok: true, alreadyInCart: true };
    }

    const packageId = packageIdFor(button);
    if (packageId && typeof window.addToCart === 'function') {
      window.addToCart(packageId);
    } else {
      // Steamの旧UI・新UIの双方で、ページ本体のハンドラを呼べない場合のフォールバック。
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      button.click();
    }

    await waitForCartConfirmation();
    return { ok: true };
  }

  async function waitForPurchase(title) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const area = [...document.querySelectorAll('.game_area_purchase_game, .game_area_purchase_section')]
        .find((candidate) => isMainPurchaseArea(candidate, title));
      if (area) return area;
      await delay(100);
    }
    return null;
  }

  function isMainPurchaseArea(area, title) {
    if (isExcluded(area.textContent)) return false;
    const headings = [...area.querySelectorAll('h1, h2, h3, .title')].map((element) => text(element.textContent));
    return headings.some((heading) => isExactPurchaseHeading(heading, title));
  }

  function isExactPurchaseHeading(heading, title) {
    const value = compact(heading);
    const game = compact(title);
    return PURCHASE_SUFFIXES.some((suffix) => value === `${game}${compact(suffix)}`) || value === `buy${game}`;
  }

  function findCartButton(area) {
    return [...area.querySelectorAll('a, button, [role="button"]')].find((element) => {
      if (element.getAttribute('aria-disabled') === 'true' || element.disabled) return false;
      const value = text(element.textContent);
      return /カートに入れる|カートの中|add to cart|view cart/i.test(value) && isDisplayed(element);
    }) || null;
  }

  function packageIdFor(button) {
    const href = button.getAttribute('href') || '';
    const match = href.match(/addToCart\(\s*(\d+)/i)
      || button.id.match(/btn_add_to_cart_(\d+)/i)
      || button.closest('[id*="add_to_cart_"]')?.id.match(/add_to_cart_(\d+)/i);
    return match ? Number(match[1]) : 0;
  }

  async function waitForCartConfirmation() {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const modalButton = [...document.querySelectorAll('a, button, [role="button"]')]
        .find((element) => isDisplayed(element) && /カートを表示|カートの中|view cart|cart\s*\(\d+/i.test(text(element.textContent)));
      if (modalButton) {
        modalButton.click();
        await delay(250);
        return;
      }
      await delay(100);
    }
    throw new Error('Steamのカート追加確認が表示されませんでした。');
  }

  function inCart(button) {
    return /カートの中|view cart/i.test(text(button.textContent));
  }

  function isExcluded(value) {
    return /\bbundle\b|soundtrack|バンドル|サウンドトラック/i.test(String(value || ''));
  }

  function isDisplayed(element) {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  }

  function text(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function compact(value) {
    return text(value).replace(/\s+/g, '').toLocaleLowerCase('ja-JP');
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function respond(requestId, result) {
    document.dispatchEvent(new CustomEvent('steam-wishlist-cart-response', { detail: { requestId, result } }));
  }
})();
