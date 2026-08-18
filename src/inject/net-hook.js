/**
 * ページ本体(MAIN world)で fetch / XMLHttpRequest を包み、
 * サークル一覧まわりの JSON レスポンスを content script に横流しする。
 *
 * DOM から拾えるのはカード上に描画された分だけなので、API が返す生データ
 * （執筆者名・ジャンル・メモ等）が取れるならそちらを優先したい。
 * エンドポイントの正確なパスは配置公開状況で変わるため、URL では絞らず
 * 「サークルらしい形の JSON か」で判定している。
 */
(function () {
  'use strict';

  const TAG = 'wch-net';
  const MAX_BYTES = 4 * 1024 * 1024;

  // 画像・計測系は明らかに無関係なので早めに落とす。
  const IGNORE = /\/Spa\/CachedImage\/|\/v2\/track|\.(?:js|css|png|jpe?g|webp|gif|svg|woff2?)(?:\?|$)/i;

  function post(url, data) {
    try {
      window.postMessage({ __wch: TAG, url, data }, window.location.origin);
    } catch (_) {
      // 構造化複製できない値は諦める（DOM 側のフォールバックが拾う）
    }
  }

  /**
   * イベント ID を拡張側に渡す。
   *
   * ページの window.__NUXT__ から拾おうとしたが、Nuxt はハイドレーションが済むと
   * これを消してしまい、コンテンツスクリプトが起きた頃には無くなっている。
   * 一方で API のリクエスト URL には必ず event_id が乗っているので、
   * 通信を覗いているここで拾うのが確実。
   */
  let seenEventId = null;

  function sendEventId() {
    if (!seenEventId) return;
    try {
      window.postMessage({ __wch: 'wch-config', eventId: seenEventId }, window.location.origin);
    } catch (_) {}
  }

  function noteEventId(url) {
    const m = /[?&]event_id=(\d+)/.exec(String(url || ''));
    if (!m || m[1] === seenEventId) return;
    seenEventId = m[1];
    sendEventId();
  }

  // 通信は拡張側が聞き耳を立てる前に終わっていることがある。
  // 向こうから聞かれたら、そのとき分かっている値を返す。
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.__wch === 'wch-ask-config') sendEventId();
  });

  /** サークルらしいオブジェクトを含む JSON かどうかの当たり判定。 */
  function looksRelevant(data) {
    let hit = false;
    let depth = 0;

    (function walk(node) {
      if (hit || node === null || typeof node !== 'object' || depth > 6) return;
      depth++;
      if (Array.isArray(node)) {
        for (const v of node.slice(0, 50)) walk(v);
      } else {
        if ('wcid' in node) hit = true;
        else for (const v of Object.values(node)) walk(v);
      }
      depth--;
    })(data);

    return hit;
  }

  function handleText(url, text) {
    if (!text || text.length > MAX_BYTES) return;
    const head = text.trimStart()[0];
    if (head !== '{' && head !== '[') return;
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return;
    }
    if (looksRelevant(data)) post(url, data);
  }

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (...args) {
      const p = origFetch.apply(this, args);
      try {
        noteEventId(typeof args[0] === 'string' ? args[0] : args[0]?.url);
      } catch (_) {}
      p.then((res) => {
        try {
          const url = res.url || String(args[0]);
          noteEventId(url);
          if (IGNORE.test(url)) return;
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('json')) return;
          res.clone().text().then((t) => handleText(url, t), () => {});
        } catch (_) {}
      }, () => {});
      return p;
    };
  }

  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const origOpen = XHR.prototype.open;
    const origSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url, ...rest) {
      this.__wchUrl = url;
      try {
        noteEventId(url);
      } catch (_) {}
      return origOpen.call(this, method, url, ...rest);
    };

    XHR.prototype.send = function (...args) {
      this.addEventListener('load', () => {
        try {
          const url = this.responseURL || this.__wchUrl || '';
          if (IGNORE.test(url)) return;
          if (this.responseType === '' || this.responseType === 'text') {
            handleText(url, this.responseText);
          } else if (this.responseType === 'json' && looksRelevant(this.response)) {
            post(url, this.response);
          }
        } catch (_) {}
      });
      return origSend.apply(this, args);
    };
  }
})();
