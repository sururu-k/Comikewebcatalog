/**
 * API からお気に入りを組み立てて、巡回計画とシートまで持っていく。
 *
 * 必要なものを集める順番:
 *   お気に入り (wcid, 色, メモ)  ← /api/v2/User/Favorite
 *   サークル情報 (名前, 執筆者, 日, ブロック, スペース)  ← /api/v3/Circle/Search
 *   エリア定義 (どのブロックがどのホールか)  ← /api/v2/Event/Base
 *   配置ジオメトリ (スペースごとの矩形)  ← /api/v2/MapTiles の minimap
 */
(function (root) {
  'use strict';

  const { api, plan, sheet, store } = root.WCH;

  // サークル一覧は 2 万件以上あるので、一度引いたらセッション中は使い回す。
  const cache = { circles: null, eventInfo: null, lastModified: null, sizes: null, geo: new Map() };

  function progress(cb, msg) {
    cb?.(msg);
  }

  /** ブロック名から所属エリアを引く表を作る。 */
  function buildAreaIndex(eventInfo) {
    const idx = new Map(); // "day|block" → {area, name, building}
    for (const a of eventInfo.areas || []) {
      for (const b of a.blocks || []) {
        idx.set(`${a.day}|${b}`, { area: a.area, areaName: a.name, building: a.building });
      }
    }
    return idx;
  }

  async function loadBase(onProgress) {
    if (!cache.eventInfo) {
      progress(onProgress, 'イベント情報を取得中…');
      cache.eventInfo = await api.getEventInfo();
    }
    if (!cache.lastModified) {
      cache.lastModified = await api.mapTilesLastModified();
    }
    if (!cache.sizes) {
      progress(onProgress, '配置図の設定を取得中…');
      cache.sizes = await api.getMinimapSizes(cache.lastModified);
    }
    if (!cache.circles) {
      progress(onProgress, 'サークル情報を取得中…');
      cache.circles = await api.getAllCircles((done, total) =>
        progress(onProgress, `サークル情報 ${done} / ${total}`)
      );
    }
    return cache;
  }

  async function loadGeo(area, day, onProgress) {
    const key = `${day}|${area}`;
    if (cache.geo.has(key)) return cache.geo.get(key);
    progress(onProgress, `配置図 ${area} Day${day} を取得中…`);
    let geo = [];
    try {
      geo = await api.getMinimapGeo(area, day, cache.lastModified);
    } catch (e) {
      geo = [];
    }
    cache.geo.set(key, geo);
    return geo;
  }

  function sizeFor(sizes, area, day) {
    return (sizes || []).find((s) => s.AreaName === area && String(s.Day) === String(day));
  }

  /**
   * お気に入りを、配置と色とメモが揃った形にして返す。
   * @returns {{items:Array, eventInfo:object, geoByArea:Map, sizeByArea:Map}}
   */
  async function collect(onProgress) {
    progress(onProgress, 'お気に入りを取得中…');
    const favorites = await api.getFavorites();
    if (!favorites.length) return { items: [], eventInfo: {}, geoByArea: new Map(), sizeByArea: new Map() };

    const base = await loadBase(onProgress);
    const areaIdx = buildAreaIndex(base.eventInfo);

    const byWcid = new Map();
    for (const c of base.circles) byWcid.set(String(c.wcid), c);

    // お気に入り × サークル情報
    const merged = favorites.map((f) => {
      const c = byWcid.get(String(f.wcid)) || {};
      const a = areaIdx.get(`${c.day}|${c.block}`) || {};
      return {
        wcid: String(f.wcid),
        circleId: f.circleId,
        color: f.color,
        memo: f.memo || '',
        name: c.name || '',
        writer: c.writer || '',
        day: c.day || '',
        block: c.block || '',
        space: c.space || '',
        hallNumber: c.hallNumber || '',
        genre: c.genre || '',
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

    // スペースキー → geo
    const geoByKey = new Map();
    for (const [, geo] of geoByArea) {
      for (const g of geo) if (g.key) geoByKey.set(g.key, g);
    }

    const placed = plan.attachGeo(merged, geoByKey);

    // 2スペースのサークルはお気に入りに wcid が2つ入る。同じ場所を2回歩かないよう
    // 1つに畳む。配置が引けた方を優先し、同条件ならスペース番号が若い方を残す。
    const best = new Map();
    for (const it of placed) {
      const k = it.circleId ? `c${it.circleId}` : `w${it.wcid}`;
      const cur = best.get(k);
      if (!cur) {
        best.set(k, it);
        continue;
      }
      const better =
        (!!it.pos && !cur.pos) ||
        (!!it.pos === !!cur.pos && String(it.space).localeCompare(String(cur.space)) < 0);
      if (better) best.set(k, it);
    }

    return { items: [...best.values()], eventInfo: base.eventInfo, geoByArea, sizeByArea };
  }

  /** 巡回シートを開くところまで一気にやる。 */
  async function openSheet(onProgress, opts = {}) {
    const { items, eventInfo, geoByArea, sizeByArea } = await collect(onProgress);
    if (!items.length) return { error: 'お気に入りが1件もありません' };

    progress(onProgress, '巡回順を計算中…');
    const groups = plan.buildPlan(items, opts);
    const leftovers = plan.withoutGeo(items);

    const days = eventInfo.days || [];
    const eventName = eventInfo.nth ? `コミックマーケット${eventInfo.nth}` : '';
    const dayText = days.map((d) => `${d.day}日目 ${d.date}(${d.dayOfWeek})`).join(' / ');

    progress(onProgress, 'シートを生成中…');
    const res = sheet.open(groups, geoByArea, sizeByArea, leftovers, {
      title: 'お気に入り巡回シート',
      eventName: [eventName, dayText].filter(Boolean).join(' ・ ')
    });

    return { ...res, groups: groups.length, leftovers: leftovers.length };
  }

  /** API で取れた情報を収集データにも取り込む（CSV 出力を充実させる）。 */
  async function syncToStore(onProgress) {
    const { items } = await collect(onProgress);
    if (!items.length) return { added: 0, updated: 0, total: 0 };

    const rows = items.map((it) => ({
      wcid: it.wcid,
      name: it.name,
      author: it.writer,
      genre: it.genre,
      space: `${it.building || ''}${it.hallNumber || ''} ${it.block}${it.space}`.trim(),
      area: it.building,
      hall: it.hallNumber,
      block: it.block,
      number: plan.parseSpaceNo(it.space).number,
      sub: plan.parseSpaceNo(it.space).sub,
      day: it.day,
      memo: it.memo,
      favorite: 'あり',
      favoriteColor: it.color,
      detailUrl: `${api.BASE}/circle/list?wcid=${it.wcid}`,
      collectedAt: new Date().toISOString()
    }));

    return await store.upsert(rows);
  }

  root.WCH.favorites = { collect, openSheet, syncToStore, cache };
})(window);
