/**
 * 一括操作。お気に入りの付け外し・色指定・メモ入力。
 *
 * サイト側の UI を順に操作していく方式なので、1件ずつ間隔を空ける・件数上限を設ける・
 * いつでも中断できる、の3点は必ず守る。直接 API を叩くより遅いが、
 * サイト側の状態管理と食い違わない。
 *
 * サイト側の挙動で踏みやすい点（バンドルを読んで確認済み）:
 *
 *  - お気に入りボタンの**左クリックはメニューを開かない**。その場でトグルする。
 *    未登録なら既定色で登録し、登録済みで既定色と同じなら解除する。
 *    メニューを開くのは長押しか contextmenu。
 *  - メニュー内の色ボタンは「いまと同じ色」を押すと解除になる。
 *    目的の色に揃えたいだけなら、すでにその色のカードは触らない。
 *  - メモ欄はお気に入り登録済みのカードにしか出ない。保存は blur。
 */
(function (root) {
  'use strict';

  const { store, sel, scrape } = root.WCH;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const state = { running: false, abort: false };

  function stop() {
    state.abort = true;
  }

  async function waitFor(selector, timeoutMs = 2500, stepMs = 60) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null) return el;
      await sleep(stepMs);
    }
    return null;
  }

  async function waitGone(selector, timeoutMs = 1500, stepMs = 60) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const el = document.querySelector(selector);
      if (!el || el.offsetParent === null) return true;
      await sleep(stepMs);
    }
    return false;
  }

  function closeMenu() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const scrim = document.querySelector('.v-overlay__scrim');
    if (scrim) scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  /** お気に入りメニューを開く。左クリックはトグルなので使えない。 */
  async function openFavoriteMenu(card) {
    const btn = card.querySelector(sel.favButton);
    if (!btn) return null;
    btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    return await waitFor(sel.favColorIcon, 2500);
  }

  /** 開いているメニューの色ボタンを {色番号: 要素} で返す。 */
  function menuColorButtons() {
    const out = new Map();
    for (const el of document.querySelectorAll(sel.favColorIcon)) {
      const m = (el.className || '').match(/text-favorite(\d+)/);
      if (m) out.set(Number(m[1]), el);
    }
    return out;
  }

  function currentColor(card) {
    return scrape.favoriteState(card).color;
  }

  /**
   * 対象カードの絞り込み。
   * @param {'all'|'unfavorited'|'favorited'} scope
   * @returns {{cards:Element[], filtered:boolean}}
   */
  function targetsDetailed(scope) {
    const cards = Array.from(document.querySelectorAll(sel.card));
    if (scope !== 'unfavorited' && scope !== 'favorited') return { cards, filtered: true };

    const states = cards.map((c) => scrape.favoriteState(c).favorited);
    if (states.every((v) => v === undefined)) return { cards, filtered: false };

    const want = scope === 'favorited';
    return { cards: cards.filter((c, i) => states[i] === want), filtered: true };
  }

  function targets(scope) {
    return targetsDetailed(scope).cards;
  }

  /** メニューを一度開いて、選べる色番号を読み取る。 */
  async function readColorOptions() {
    const card = document.querySelector(sel.card);
    if (!card) return [];
    const opened = await openFavoriteMenu(card);
    if (!opened) {
      closeMenu();
      return [];
    }
    const colors = Array.from(menuColorButtons().keys()).sort((a, b) => a - b);
    closeMenu();
    await waitGone(sel.favColorIcon);
    return colors;
  }

  /**
   * お気に入りの一括登録／解除（既定色）。
   * ボタンの左クリック1回で済むので色指定より速い。
   *
   * @param {{scope:string, action:'add'|'remove'}} opts
   */
  async function toggleFavorite(opts) {
    if (state.running) return { error: 'already-running' };
    const settings = await store.loadSettings();
    const interval = opts.intervalMs ?? settings.bulkIntervalMs;
    const limit = opts.limit ?? settings.bulkMaxItems;

    const list = targetsDetailed(opts.scope).cards.slice(0, limit);
    state.running = true;
    state.abort = false;

    let done = 0;
    let skipped = 0;
    let failed = 0;

    try {
      for (const card of list) {
        if (state.abort) break;

        const cur = scrape.favoriteState(card).favorited;
        // すでに目的の状態なら触らない（押すと逆に戻ってしまう）。
        if ((opts.action === 'add' && cur === true) || (opts.action === 'remove' && cur === false)) {
          skipped++;
          continue;
        }

        const btn = card.querySelector(sel.favButton);
        if (!btn) {
          failed++;
          continue;
        }
        btn.click();
        done++;

        await sleep(interval);
        opts.onProgress?.({ done, skipped, failed, total: list.length });
      }
    } finally {
      state.running = false;
    }

    return { done, skipped, failed, total: list.length, stopped: state.abort };
  }

  /**
   * 色を指定しての一括設定。メニューを開いて色ボタンを押す。
   * すでにその色のカードは押すと解除になってしまうので飛ばす。
   *
   * @param {{scope:string, color:number}} opts
   */
  async function setFavoriteColor(opts) {
    if (state.running) return { error: 'already-running' };
    const settings = await store.loadSettings();
    const interval = opts.intervalMs ?? settings.bulkIntervalMs;
    const limit = opts.limit ?? settings.bulkMaxItems;

    const list = targetsDetailed(opts.scope).cards.slice(0, limit);
    state.running = true;
    state.abort = false;

    let done = 0;
    let skipped = 0;
    let failed = 0;

    try {
      for (const card of list) {
        if (state.abort) break;

        if (currentColor(card) === opts.color) {
          skipped++;
          continue;
        }

        const opened = await openFavoriteMenu(card);
        if (!opened) {
          failed++;
          closeMenu();
          await sleep(interval);
          continue;
        }

        const target = menuColorButtons().get(opts.color);
        if (target) {
          target.click();
          done++;
        } else {
          failed++;
        }

        closeMenu();
        await waitGone(sel.favColorIcon);
        await sleep(interval);
        opts.onProgress?.({ done, skipped, failed, total: list.length });
      }
    } finally {
      closeMenu();
      state.running = false;
    }

    return { done, skipped, failed, total: list.length, stopped: state.abort };
  }

  // --- メモ --------------------------------------------------------------

  /**
   * Vue の v-model に反映させるには、ネイティブの value セッターで書いてから
   * input イベントを投げる必要がある（el.value = x だけでは state が動かない）。
   */
  function setInputValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * メモの一括入力。お気に入りメニュー内の textarea に書いて blur で保存させる。
   * メモ欄は登録済みのカードにしか出ないため、未登録のカードは自動的に飛ばされる。
   *
   * @param {{scope:string, text:string, mode?:'append'|'replace'|'dry'}} opts
   */
  async function setMemo(opts) {
    if (state.running) return { error: 'already-running' };
    const settings = await store.loadSettings();
    const interval = Math.max(opts.intervalMs ?? settings.bulkIntervalMs, 500);
    const limit = opts.limit ?? settings.bulkMaxItems;
    const mode = opts.mode || 'append';

    const list = targetsDetailed(opts.scope).cards.slice(0, limit);
    state.running = true;
    state.abort = false;

    let done = 0;
    let skipped = 0;
    let failed = 0;
    const missed = [];

    try {
      for (const card of list) {
        if (state.abort) break;
        const wcid = card.getAttribute(sel.cardId);

        const opened = await openFavoriteMenu(card);
        if (!opened) {
          failed++;
          missed.push(wcid);
          closeMenu();
          await sleep(interval);
          continue;
        }

        const menu = document.querySelector(sel.favMenu) || document;
        const area = menu.querySelector(sel.favMemoInput);

        if (!area) {
          // お気に入り未登録のカードにはメモ欄が出ない。
          skipped++;
          closeMenu();
          await waitGone(sel.favColorIcon);
          await sleep(interval);
          continue;
        }

        if (mode === 'dry') {
          done++;
        } else {
          const base = mode === 'append' && area.value ? `${area.value}\n` : '';
          setInputValue(area, base + opts.text);
          area.dispatchEvent(new Event('blur', { bubbles: true }));
          area.blur();
          done++;
        }

        closeMenu();
        await waitGone(sel.favColorIcon);
        await sleep(interval);
        opts.onProgress?.({ done, skipped, failed, total: list.length });
      }
    } finally {
      closeMenu();
      state.running = false;
    }

    return { done, skipped, failed, missed, total: list.length, stopped: state.abort };
  }

  root.WCH.bulk = {
    state,
    stop,
    targets,
    targetsDetailed,
    currentColor,
    readColorOptions,
    toggleFavorite,
    setFavoriteColor,
    setMemo,
    openFavoriteMenu,
    menuColorButtons
  };
})(window);
