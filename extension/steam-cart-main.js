(() => {
  const PURCHASE_SUFFIXES = ['を購入', 'を購入する', 'purchase'];

  document.addEventListener('steam-wishlist-cart-request', async (event) => {
    const { requestId, title: requestedTitle } = event.detail || {};
    if (!requestId) return;

    try {
      const result = await addSteamCartItem(requestedTitle);
      respondCart(requestId, result);
    } catch (error) {
      respondCart(requestId, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  document.addEventListener('steam-wishlist-add-request', async (event) => {
    const { requestId, appId } = event.detail || {};
    if (!requestId) return;

    try {
      const result = await addSteamWishlistItem(appId);
      respondWishlist(requestId, result);
    } catch (error) {
      respondWishlist(requestId, { ok: false, error: error instanceof Error ? error.message : String(error) });
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

  async function addSteamWishlistItem(requestedAppId) {
    const appId = String(requestedAppId || location.pathname.match(/\/app\/(\d+)/)?.[1] || '');
    if (!/^\d+$/.test(appId)) throw new Error('SteamのゲームIDを取得できませんでした。');
    if (await verifyWishlistMembership(appId, 1)) return { ok: true, alreadyAdded: true };

    let actionError = null;
    if (typeof window.AddToWishlist === 'function') {
      try {
        window.AddToWishlist(
          Number(appId),
          'add_to_wishlist_area',
          'add_to_wishlist_area_success',
          'add_to_wishlist_area_fail',
          '1_5_9__407'
        );
        await waitForWishlistConfirmation();
      } catch (error) {
        actionError = error;
      }
    } else {
      const button = findWishlistAddButton();
      if (button) {
        try {
          button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
          button.click();
          await waitForWishlistConfirmation(5000);
        } catch (error) {
          actionError = error;
        }
      }
    }

    if (await verifyWishlistMembership(appId, 2)) {
      markWishlistAdded();
      return { ok: true, alreadyAdded: false };
    }

    try {
      await requestWishlistApi(appId);
    } catch (error) {
      actionError = error;
    }

    if (!await verifyWishlistMembership(appId)) {
      throw actionError || new Error('Steamのウィッシュリストに反映されませんでした。');
    }
    markWishlistAdded();
    return { ok: true, alreadyAdded: false };
  }

  function findWishlistAddButton() {
    return [...document.querySelectorAll('main button, main a, main [role="button"], #add_to_wishlist_area button, #add_to_wishlist_area a')]
      .find((element) => {
        if (!isDisplayed(element) || element.disabled || element.getAttribute('aria-disabled') === 'true') return false;
        const label = wishlistElementLabel(element);
        return /add to (?:your )?wishlist|ウィッシュリスト.*(?:に追加|へ追加)/i.test(label)
          && !/追加済み|から削除|on (?:your )?wishlist|remove from/i.test(label);
      }) || null;
  }

  function wishlistElementLabel(element) {
    return text([
      element.textContent,
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('data-tooltip-text')
    ].filter(Boolean).join(' '));
  }

  async function requestWishlistApi(appId) {
    const sessionId = text(window.g_sessionID || document.cookie.match(/(?:^|;\s*)sessionid=([^;]+)/)?.[1]);
    if (!sessionId) throw new Error('Steamへログインしてください。');
    const response = await fetch('https://store.steampowered.com/api/addtowishlist', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: new URLSearchParams({ sessionid: sessionId, appid: appId, snr: '1_5_9__407' }).toString()
    });
    const responseText = await response.text();
    let payload = null;
    try {
      payload = responseText ? JSON.parse(responseText) : null;
    } catch {
      // SteamがJSON以外を返した場合は失敗として扱う。
    }
    const accepted = payload && Object.prototype.hasOwnProperty.call(payload, 'success') && [1, true, '1'].includes(payload.success);
    if (!response.ok || !accepted || /<html|sign\s*in|login/i.test(responseText)) {
      throw new Error(response.status === 401 || response.status === 403 ? 'Steamへログインしてください。' : 'Steamのウィッシュリストに追加できませんでした。');
    }
  }

  async function verifyWishlistMembership(appId, attempts = 6) {
    try {
      window.GDynamicStore?.InvalidateCache?.();
    } catch {
      // 下記のキャッシュ無効化済みAPIで確認を続ける。
    }
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await fetch(`https://store.steampowered.com/dynamicstore/userdata/?ss=${Date.now()}-${attempt}`, {
          credentials: 'include',
          cache: 'no-store',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (response.ok) {
          const payload = await response.json();
          const wishlist = Array.isArray(payload?.rgWishlist) ? payload.rgWishlist.map(String) : [];
          if (wishlist.includes(appId)) return true;
          if (payload?.bIsLoggedIn === false) throw new Error('Steamへログインしてください。');
        }
      } catch (error) {
        if (/ログイン/.test(String(error?.message || error))) throw error;
      }
      if (attempt < attempts - 1) await delay(300);
    }
    return false;
  }

  function isWishlistAdded() {
    const success = document.querySelector('#add_to_wishlist_area_success');
    if (success && isDisplayed(success)) return true;
    return [...document.querySelectorAll('button, a, [role="button"]')].some((element) => {
      if (!isDisplayed(element)) return false;
      const label = text([
        element.textContent,
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        element.getAttribute('data-tooltip-text')
      ].filter(Boolean).join(' '));
      return (
        element.getAttribute('aria-pressed') === 'true' && /wishlist|ウィッシュリスト/i.test(label)
      ) || /(?:on|in) (?:your )?wishlist|remove from (?:your )?wishlist|ウィッシュリスト.*(?:追加済み|から削除)/i.test(label);
    });
  }

  async function waitForWishlistConfirmation(timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (isWishlistAdded()) return;
      const failure = document.querySelector('#add_to_wishlist_area_fail');
      if (failure && isDisplayed(failure)) throw new Error('Steamのウィッシュリストに追加できませんでした。');
      await delay(100);
    }
    throw new Error('Steamのウィッシュリスト追加を確認できませんでした。');
  }

  function markWishlistAdded() {
    const addArea = document.querySelector('#add_to_wishlist_area');
    const successArea = document.querySelector('#add_to_wishlist_area_success');
    if (addArea) addArea.style.display = 'none';
    if (successArea) successArea.style.display = '';
    try {
      window.GDynamicStore?.InvalidateCache?.();
    } catch {
      // キャッシュ更新関数がないSteam UIでも、API追加結果は成功として扱う。
    }
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

  function respondCart(requestId, result) {
    document.dispatchEvent(new CustomEvent('steam-wishlist-cart-response', { detail: { requestId, result } }));
  }

  function respondWishlist(requestId, result) {
    document.dispatchEvent(new CustomEvent('steam-wishlist-add-response', { detail: { requestId, result } }));
  }
})();
