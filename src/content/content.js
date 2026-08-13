/**
 * エントリポイント。SPA なので URL 遷移では再読み込みされない前提で、
 * カードが現れたらパネルを出す方式にしている。
 */
(function (root) {
  'use strict';

  const api = root.browser?.runtime ? root.browser : root.chrome;
  const { store, collect, panel, isListPage } = root.WCH;

  let booted = false;

  async function boot() {
    if (booted) return;
    booted = true;

    collect.startNetListener();

    const settings = await store.loadSettings();

    // イベント ID はサイトの Nuxt config にしか無い。拡張のシートページからも
    // API を叩けるよう、見えたときに控えておく。
    const id = root.__NUXT__?.config?.public?.eventId;
    if (id && String(id) !== String(settings.eventId)) {
      await store.saveSettings({ eventId: String(id) });
    }

    if (settings.autoCollect) collect.startObserver();

    panel.ensure();
  }

  /** 一覧が描画されるのを待ってから起動する。 */
  function waitForList() {
    if (isListPage()) return boot();

    const obs = new MutationObserver(() => {
      if (isListPage()) {
        obs.disconnect();
        boot();
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    // 一覧以外のページに居続ける場合は無駄に監視し続けないよう打ち切る。
    setTimeout(() => obs.disconnect(), 60000);
  }

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      switch (msg?.type) {
        case 'ping':
          sendResponse({ ok: true, onList: isListPage(), cards: collect.cardCount() });
          break;

        case 'toggle-panel':
          if (!booted) await boot();
          else panel.toggle();
          sendResponse({ ok: true });
          break;

        case 'collect-visible': {
          const stats = await collect.collectVisible();
          sendResponse({ ok: true, stats });
          break;
        }

        case 'auto-collect': {
          const res = await collect.autoScrollCollect();
          sendResponse({ ok: true, res });
          break;
        }

        case 'stop':
          collect.stop();
          root.WCH.bulk.stop();
          sendResponse({ ok: true });
          break;

        case 'stats': {
          const rows = await store.loadList();
          sendResponse({ ok: true, total: rows.length, cards: collect.cardCount() });
          break;
        }

        default:
          sendResponse({ ok: false, error: 'unknown-message' });
      }
    })();
    return true; // 非同期応答
  });

  waitForList();
})(window);
