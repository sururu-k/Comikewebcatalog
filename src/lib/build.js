/**
 * API からお気に入りを組み立てる。サイト上のコンテンツスクリプトからも、
 * 拡張のシートページからも同じ手順で使えるようにここに置いている。
 *
 * 集める順番:
 *   お気に入り (wcid, 色, メモ)      ← /api/v2/User/Favorite
 *   サークル情報 (名前・執筆者・配置・頒布物・書店リンク)  ← /api/v3/Circle/Search
 *   エリア定義 (どのブロックがどのホールか)  ← /api/v2/Event/Base
 *   配置ジオメトリ (スペースごとの矩形)      ← /api/v2/MapTiles の minimap
 */
(function (root) {
  'use strict';

  const { api, plan, detail, store } = root.WCH;

  // サークル一覧は2万件を超えるので、一度引いたらセッション中は使い回す。
  const cache = { circles: null, eventInfo: null, lastModified: null, sizes: null, geo: new Map() };

  function say(cb, msg) {
    cb?.(msg);
  }

  function buildAreaIndex(eventInfo) {
    const idx = new Map(); // "day|block" → {area, areaName, building}
    for (const a of eventInfo.areas || []) {
      for (const b of a.blocks || []) {
        idx.set(`${a.day}|${b}`, { area: a.area, areaName: a.name, building: a.building });
      }
    }
    return idx;
  }

  async function loadBase(onProgress) {
    if (!cache.eventInfo) {
      say(onProgress, 'イベント情報を取得中…');
      cache.eventInfo = await api.getEventInfo();
    }
    if (!cache.lastModified) cache.lastModified = await api.mapTilesLastModified();
    if (!cache.sizes) {
      say(onProgress, '配置図の設定を取得中…');
      cache.sizes = await api.getMinimapSizes(cache.lastModified);
    }
    if (!cache.circles) {
      say(onProgress, 'サークル情報を取得中…');
      cache.circles = await api.getAllCircles((done, total) =>
        say(onProgress, `サークル情報 ${done.toLocaleString()} / ${total.toLocaleString()}`)
      );
    }
    return cache;
  }

  async function loadGeo(area, day, onProgress) {
    const key = `${day}|${area}`;
    if (cache.geo.has(key)) return cache.geo.get(key);
    say(onProgress, `配置図 ${area} Day${day} を取得中…`);
    let geo = [];
    try {
      geo = await api.getMinimapGeo(area, day, cache.lastModified);
    } catch (_) {
      geo = [];
    }
    cache.geo.set(key, geo);
    return geo;
  }

  const sizeFor = (sizes, area, day) =>
    (sizes || []).find((s) => s.AreaName === area && String(s.Day) === String(day));

  /**
   * お気に入りを、配置・色・メモ・頒布物・お使いメモが揃った形で返す。
   */
  async function collect(onProgress) {
    say(onProgress, 'お気に入りを取得中…');
    const favorites = await api.getFavorites();
    if (!favorites.length) {
      return { items: [], eventInfo: {}, geoByArea: new Map(), sizeByArea: new Map() };
    }

    const base = await loadBase(onProgress);
    const areaIdx = buildAreaIndex(base.eventInfo);
    const genres = detail.genreIndex(base.eventInfo);
    const notes = await store.loadNotes();

    const byWcid = new Map();
    for (const c of base.circles) byWcid.set(String(c.wcid), c);

    const merged = favorites.map((f) => {
      const raw = byWcid.get(String(f.wcid));
      const d = raw ? detail.normalize(raw, genres) : { wcid: String(f.wcid) };
      const a = areaIdx.get(`${d.day}|${d.block}`) || {};
      const n = notes[String(f.wcid)] || {};
      return {
        ...d,
        circleId: f.circleId,
        color: f.color,
        memo: f.memo || '',
        errand: n.errand || '',
        priority: n.priority || 0,
        budget: n.budget || 0,
        area: a.area || '',
        areaName: a.areaName || '',
        building: a.building || ''
      };
    });

    // 必要なエリアのジオメトリだけ取る
    const need = new Set();
    for (const m of merged) if (m.area && m.day) need.add(`${m.day}|${m.area}`);

    const geoByArea = new Map();
    const sizeByArea = new Map();
    for (const key of need) {
      const [day, area] = key.split('|');
      geoByArea.set(key, await loadGeo(area, day, onProgress));
      sizeByArea.set(key, sizeFor(base.sizes, area, day));
    }

    const geoByKey = new Map();
    for (const [, geo] of geoByArea) for (const g of geo) if (g.key) geoByKey.set(g.key, g);

    const placed = plan.attachGeo(merged, geoByKey);

    // 2スペースのサークルは wcid が2つ来る。同じ場所を2回歩かないよう1つに畳む。
    // 配置が引けた方を優先し、同条件ならスペース番号が若い方を残す。
    const best = new Map();
    for (const it of placed) {
      const k = it.circleId ? `c${it.circleId}` : `w${it.wcid}`;
      const cur = best.get(k);
      if (!cur) {
        best.set(k, it);
        continue;
      }
      // 一覧に単独のカードとして出るのは主スペース側だけなので、そちらを残す。
      // 副スペースの wcid を持っていると、サイトを開いても該当カードに辿り着けない。
      const better =
        (!!it.pos && !cur.pos) ||
        (!!it.pos === !!cur.pos && !!it.isMain && !cur.isMain) ||
        (!!it.pos === !!cur.pos && !!it.isMain === !!cur.isMain &&
          String(it.space).localeCompare(String(cur.space)) < 0);
      if (better) best.set(k, it);
    }

    return { items: [...best.values()], eventInfo: base.eventInfo, geoByArea, sizeByArea };
  }

  /** 収集データ（CSV / JSON 出力用）に取り込む。 */
  async function syncToStore(onProgress) {
    const { items } = await collect(onProgress);
    if (!items.length) return { added: 0, updated: 0, total: 0 };

    const rows = items.map((it) => ({
      wcid: it.wcid,
      name: it.name,
      author: it.writer,
      genre: it.genreName || it.genreCode,
      space: it.location || `${it.block}${it.space}`,
      area: it.building,
      hall: it.hallNumber,
      block: it.block,
      number: plan.parseSpaceNo(it.space).number,
      sub: plan.parseSpaceNo(it.space).sub,
      day: it.day,
      memo: it.memo,
      errand: it.errand,
      priority: (store.PRIORITIES.find((p) => p.value === it.priority) || {}).label || '',
      budget: it.budget || '',
      favorite: 'あり',
      favoriteColor: it.color,
      booksText: detail.booksText(it),
      priceTotal: it.priceTotal || '',
      hasNewBook: it.hasNewBook ? '新刊あり' : '',
      tagsText: (it.tags || []).join(' '),
      externalsText: detail.externalsText(it),
      location: it.location,
      lastUpdateAt: it.lastUpdateAt,
      books: it.books,
      externals: it.externals,
      cutUrl: it.cutUrl,
      webCutUrls: it.webCutUrls,
      detailUrl: `${api.BASE}/circle/list?wcid=${it.wcid}`,
      collectedAt: new Date().toISOString()
    }));

    return await store.upsert(rows);
  }

  root.WCH = root.WCH || {};
  root.WCH.build = { collect, syncToStore, cache };
})(window);
