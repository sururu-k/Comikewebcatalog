/**
 * サイトの内部 API クライアント。
 *
 * DOM から拾うより速く確実なので、こちらが取れるならこちらを主経路にする。
 * コンテンツスクリプトは同一オリジンなので、fetch に credentials を付ければ
 * ログインセッションのまま呼べる。
 *
 * 認証は Bearer。トークンは Cookie2Token がセッションクッキーから発行する
 * client_credentials で、リフレッシュトークンのような使い捨ての値ではないが、
 * 無駄に叩かないようメモリ上でだけ短時間キャッシュする（保存はしない）。
 *
 * 判明しているエンドポイント（すべて実アクセスで確認済み）:
 *
 *   POST   /api/v2/Cookie2Token          scope=openid&grant_type=client_credentials → access_token
 *   GET    /api/v2/User/Favorite         ?event_id=N        → favorites[{wcid,circleId,color,memo,createdAt}]
 *   POST   /api/v2/User/Favorite         {wcid,color,memo,event_id}
 *   DELETE /api/v2/User/Favorite         {event_id,wcid:[...]}
 *   GET    /api/v2/User/FavoriteColor                       → favoriteColorNames[{color,name}]
 *   GET    /api/v3/Circle/Search         count は 5000 まで可 → circles[{wcid,name,writer,day,block,space,hallNumber,genre,…}]
 *   GET    /api/v2/Event/Base            ?event_id=N        → eventInfo{days,areas,genre}
 *   POST   /api/v2/MapTilesLastModified  {event_id}         → lastModified
 *   GET    /api/v2/MapTiles              ?path=tile256/minimap/… → 配置図のジオメトリ
 */
(function (root) {
  'use strict';

  const BASE = 'https://webcatalog.circle.ms';

  // イベント ID。サイト上では Nuxt の config から拾えるが、拡張のページには
  // それが無いので、拾えたときに保存しておいて使い回す。
  let EVENT_ID = '230';

  function eventId() {
    try {
      const id = root.__NUXT__?.config?.public?.eventId;
      if (id) return String(id);
    } catch (_) {}
    return EVENT_ID;
  }

  function setEventId(id) {
    if (id) EVENT_ID = String(id);
  }

  let cached = null; // {token, expires}

  async function token(force) {
    if (!force && cached && cached.expires > Date.now()) return cached.token;

    const res = await fetch(`${BASE}/api/v2/Cookie2Token`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ scope: 'openid', grant_type: 'client_credentials' })
    });
    if (!res.ok) throw new Error(`Cookie2Token ${res.status}（ログインし直しが必要かもしれません）`);

    const j = await res.json();
    if (!j.access_token) throw new Error('Cookie2Token がトークンを返しませんでした');

    // expires_in が来ればそれに従い、来なければ控えめに5分。
    const ttl = (Number(j.expires_in) || 300) * 1000;
    cached = { token: `Bearer ${j.access_token}`, expires: Date.now() + ttl - 30000 };
    return cached.token;
  }

  async function call(path, opts = {}) {
    const doIt = async (t) =>
      await fetch(BASE + path, {
        method: opts.method || 'GET',
        credentials: 'include',
        headers: {
          Authorization: t,
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
          ...(opts.headers || {})
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });

    let res = await doIt(await token());
    if (res.status === 401) res = await doIt(await token(true)); // 期限切れなら一度だけ取り直す
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return opts.raw ? res : await res.json();
  }

  // --- お気に入り --------------------------------------------------------

  async function getFavorites() {
    const j = await call(`/api/v2/User/Favorite?event_id=${eventId()}`);
    return j.favorites || [];
  }

  async function getFavoriteColors() {
    const j = await call('/api/v2/User/FavoriteColor');
    return j.favoriteColorNames || [];
  }

  async function addFavorite(wcid, color, memo) {
    return await call('/api/v2/User/Favorite', {
      method: 'POST',
      body: { wcid: Number(wcid), color: Number(color) || 1, memo: memo || '', event_id: Number(eventId()) }
    });
  }

  async function removeFavorites(wcids) {
    return await call('/api/v2/User/Favorite', {
      method: 'DELETE',
      body: { event_id: Number(eventId()), wcid: wcids.map(Number) }
    });
  }

  // --- サークル ----------------------------------------------------------

  // isMain=true を付けると2スペースサークルの副スペース側が落ちる（21108件になる）。
  // お気に入りには副スペースの wcid も入っているので、付けずに全 22854 件を取る。
  const SEARCH_BASE =
    '/api/v3/Circle/Search?area=&genresCsv=&blocksCsv=&canUseElectronicPayment=false' +
    '&favoriteMemo=false&sort=1&isSearchCircleName=true&isSearchAuthor=true&isSearchProductInfo=true';

  /**
   * 全サークルを取得する。1回 5000 件まで返るので数回で終わる。
   * @param {(done:number, total:number) => void} [onProgress]
   */
  async function getAllCircles(onProgress) {
    const COUNT = 5000;
    const out = [];
    let page = 1;
    let total = Infinity;

    while (out.length < total && page <= 20) {
      const j = await call(`${SEARCH_BASE}&event_id=${eventId()}&page=${page}&count=${COUNT}`);
      const list = j.circles || [];
      total = j.maxcount ?? list.length;
      out.push(...list);
      onProgress?.(out.length, total);
      if (!list.length) break;
      page++;
    }
    return out;
  }

  // --- イベント情報・配置図 ----------------------------------------------

  async function getEventInfo() {
    const j = await call(`/api/v2/Event/Base?event_id=${eventId()}`);
    return j.eventInfo || {};
  }

  async function mapTilesLastModified() {
    const j = await call('/api/v2/MapTilesLastModified', {
      method: 'POST',
      body: { event_id: Number(eventId()) }
    });
    return j.lastModified ?? j.last_modified ?? '';
  }

  function tilePath(p, lastModified) {
    return (
      `/api/v2/MapTiles?event_id=${eventId()}` +
      `&path=${encodeURIComponent(p)}&lastModified=${encodeURIComponent(lastModified)}`
    );
  }

  async function getMinimapSizes(lastModified) {
    return await call(tilePath('tile256/minimap/minimapSizeSettings.json', lastModified));
  }

  /**
   * 指定エリア・日の配置ジオメトリ。
   * geo[] = {key:"1/ア01a", space:[x1,y1,x2,y2], cut:[…], wcid, hall}
   * 座標はスペース1つを1とする格子単位。ピクセルにするには
   * SpaceWidth / SpaceHeight を掛ける。
   */
  async function getMinimapGeo(areaCode, day, lastModified) {
    const j = await call(tilePath(`tile256/minimap/${areaCode}-Day${day}.json`, lastModified));
    return j.geo || [];
  }

  root.WCH = root.WCH || {};
  root.WCH.api = {
    BASE,
    eventId,
    setEventId,
    token,
    call,
    getFavorites,
    getFavoriteColors,
    addFavorite,
    removeFavorites,
    getAllCircles,
    getEventInfo,
    mapTilesLastModified,
    getMinimapSizes,
    getMinimapGeo
  };
})(window);
