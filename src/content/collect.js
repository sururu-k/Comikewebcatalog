/**
 * 収集エンジン。
 *
 *  1. MutationObserver — 画面に出たカードを黙って拾い続ける（ユーザーが普通に眺めるだけで溜まる）
 *  2. 自動スクロール    — .reveal-sentinel を可視域に送り込んで一覧を最後まで展開する
 *  3. API フック受信    — MAIN world から流れてきた JSON をマージする
 */
(function (root) {
  'use strict';

  const { store, scrape, sel } = root.WCH;

  const state = {
    running: false,
    abort: false,
    lastStats: { added: 0, updated: 0, total: 0 },
    listeners: new Set()
  };

  function emit(evt) {
    for (const fn of state.listeners) {
      try {
        fn(evt);
      } catch (_) {}
    }
  }

  function onChange(fn) {
    state.listeners.add(fn);
    return () => state.listeners.delete(fn);
  }

  async function flush(records, source) {
    if (!records.length) return { added: 0, updated: 0, total: state.lastStats.total };
    const stats = await store.upsert(records);
    state.lastStats = stats;
    emit({ type: 'stats', stats, source });
    return stats;
  }

  /** 画面上のカードを一括で取り込む。 */
  async function collectVisible() {
    return await flush(scrape.scrapeVisible(), 'dom');
  }

  // --- 1. 自動収集オブザーバ --------------------------------------------

  let observer = null;
  let pending = false;

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      // カードは一度に何十枚も差し込まれるので、まとめてから読む。
      setTimeout(() => {
        pending = false;
        collectVisible();
      }, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    collectVisible();
  }

  function stopObserver() {
    observer?.disconnect();
    observer = null;
  }

  // --- 2. 自動スクロール -------------------------------------------------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function cardCount() {
    return document.querySelectorAll(sel.card).length;
  }

  /**
   * 一覧を末尾まで展開しながら収集する。
   * 無限スクロールなので、新着が出なくなる回数で終端を判断する。
   */
  async function autoScrollCollect(opts = {}) {
    if (state.running) return { stopped: true, reason: 'already-running' };
    const settings = await store.loadSettings();
    const stepMs = opts.stepMs ?? settings.scrollStepMs;
    const maxIdle = opts.maxIdle ?? settings.scrollMaxIdle;
    const maxRounds = opts.maxRounds ?? 400;

    state.running = true;
    state.abort = false;
    emit({ type: 'running', running: true });

    let idle = 0;
    let rounds = 0;
    let prev = cardCount();

    try {
      await collectVisible();

      while (!state.abort && idle < maxIdle && rounds < maxRounds) {
        rounds++;

        const sentinel = document.querySelector(sel.sentinel);
        if (sentinel) {
          sentinel.scrollIntoView({ block: 'end' });
        } else {
          // sentinel が見つからない構造でも一応最下部までは送る。
          window.scrollTo({ top: document.body.scrollHeight });
        }

        await sleep(stepMs);
        await collectVisible();

        const now = cardCount();
        if (now > prev) {
          idle = 0;
          prev = now;
        } else {
          idle++;
        }
        emit({ type: 'progress', rounds, cards: now, idle });
      }
    } finally {
      state.running = false;
      emit({ type: 'running', running: false });
    }

    return {
      stopped: state.abort,
      rounds,
      cards: cardCount(),
      stats: state.lastStats
    };
  }

  function stop() {
    state.abort = true;
  }

  // --- 3. API フックの受信 ----------------------------------------------

  function startNetListener() {
    window.addEventListener('message', (e) => {
      if (e.source !== window) return;
      const msg = e.data;
      if (!msg) return;

      // イベント ID はページ本体の window にしか無く、コンテンツスクリプト
      // （隔離ワールド）からは見えない。MAIN world 側から送ってもらう。
      // 控えておかないと、次のイベントが始まっても古い event_id を叩き続ける。
      if (msg.__wch === 'wch-config' && msg.eventId) {
        store.loadSettings().then((s) => {
          if (String(s.eventId) !== String(msg.eventId)) {
            store.saveSettings({ eventId: String(msg.eventId) });
          }
        });
        try {
          root.WCH.api?.setEventId(msg.eventId);
        } catch (_) {}
        emit({ type: 'event-id', eventId: String(msg.eventId) });
        return;
      }

      if (msg.__wch !== 'wch-net') return;
      try {
        const rows = scrape.fromApi(msg.data);
        if (rows.length) flush(rows, 'api');
      } catch (_) {}
    });
  }

  root.WCH.collect = {
    state,
    onChange,
    collectVisible,
    autoScrollCollect,
    stop,
    startObserver,
    stopObserver,
    startNetListener,
    cardCount
  };
})(window);
