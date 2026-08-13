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

    return false;
  });
})();
