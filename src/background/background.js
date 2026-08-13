/**
 * バックグラウンド。今のところ役割は少なく、
 * ポップアップからのダウンロード要求を受けるだけ。
 *
 * Chrome は service_worker、Firefox は background.scripts として同じファイルを読む。
 * どちらでも動くよう、トップレベルで待ち受けを登録する（起動時に必ず実行される）。
 */
(function () {
  'use strict';

  const api = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;

  // シートから開いたサイトのタブ。閉じられていたら作り直す。
  let siteTabId = null;
  api.tabs.onRemoved.addListener((id) => {
    if (id === siteTabId) siteTabId = null;
  });

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'download') {
      api.downloads.download({ url: msg.url, filename: msg.filename, saveAs: false }, (id) => {
        const err = api.runtime.lastError;
        sendResponse(err ? { ok: false, error: err.message } : { ok: true, id });
      });
      return true;
    }

    // 巡回シートは拡張のページ。コンテンツスクリプトから chrome-extension:// を
    // window.open しても開けないので、ここでタブを作る。
    if (msg?.type === 'open-sheet') {
      api.tabs.create({ url: api.runtime.getURL('src/sheet/sheet.html') }, (tab) => {
        const err = api.runtime.lastError;
        sendResponse(err ? { ok: false, error: err.message } : { ok: true, tabId: tab?.id });
      });
      return true;
    }

    // シートからサークルを開くとき。次々に押してもタブが増えないよう、
    // 1枚だけ持っておいて使い回す。
    if (msg?.type === 'open-site' && msg.url) {
      const open = () =>
        api.tabs.create({ url: msg.url }, (tab) => {
          siteTabId = tab?.id ?? null;
          sendResponse({ ok: true, tabId: siteTabId, reused: false });
        });

      if (siteTabId === null) {
        open();
      } else {
        api.tabs.update(siteTabId, { url: msg.url, active: true }, (tab) => {
          if (api.runtime.lastError || !tab) {
            siteTabId = null;
            open();
          } else {
            sendResponse({ ok: true, tabId: siteTabId, reused: true });
          }
        });
      }
      return true;
    }

    return false;
  });
})();
