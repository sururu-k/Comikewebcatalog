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
   * イベント ID は Nuxt がページの window に埋めているだけで、
   * コンテンツスクリプト側（隔離ワールド）からは見えない。
   * 拡張のシートページからも API を叩けるよう、こちらから渡す。
   */
  function postConfig() {
    try {
      const id = window.__NUXT__?.config?.public?.eventId;
      if (id) window.postMessage({ __wch: 'wch-config', eventId: String(id) }, window.location.origin);
    } catch (_) {}
  }

  // config は document_start の時点ではまだ無いので、出てくるまで少し待つ。
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    const has = (() => {
      try {
        return !!window.__NUXT__?.config?.public?.eventId;
      } catch (_) {
        return false;
      }
    })();
    if (has || tries > 40) {
      clearInterval(timer);
      postConfig();
    }
  }, 250);

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
      p.then((res) => {
        try {
          const url = res.url || String(args[0]);
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
