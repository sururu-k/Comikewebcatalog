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
    if (msg?.type !== 'download') return false;

    api.downloads.download(
      { url: msg.url, filename: msg.filename, saveAs: false },
      (id) => {
        const err = api.runtime.lastError;
        sendResponse(err ? { ok: false, error: err.message } : { ok: true, id });
      }
    );
    return true;
  });
})();
