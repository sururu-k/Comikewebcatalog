/**
 * 巡回計画。お気に入りを実際の配置座標に載せて、歩く順番を組み立てる。
 *
 * 配置図のジオメトリ（スペースごとの矩形）が取れるので、ブロック名の五十音順ではなく
 * 「実際に近い島から順に回る」順序を出せる。
 *
 * 手順:
 *   1. 日 × エリア（東123 / 東7 / 西12 / 南12 …）で分ける
 *   2. その中をブロック単位の島にまとめ、島の重心を出す
 *   3. 島を最近傍法で並べ、2-opt で交差を解く
 *   4. 島の中は、前の島から入ってきた側に近い端から順に並べる（蛇行）
 */
(function (root) {
  'use strict';

  // Comiket のスペースは1つおよそ 0.9m 幅。距離の目安表示にだけ使う。
  const METERS_PER_SPACE = 0.9;

  function centroid(rect) {
    return { x: (rect[0] + rect[2]) / 2, y: (rect[1] + rect[3]) / 2 };
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** スペース番号 "01a" → {number:1, sub:'a'} */
  function parseSpaceNo(s) {
    const m = String(s || '').match(/(\d+)\s*([abAB])?/);
    return m ? { number: Number(m[1]), sub: (m[2] || '').toLowerCase() } : { number: 9999, sub: '' };
  }

  /**
   * スペースのジオメトリキー。
   *
   * 配置図側のキーは "2/Ｖ01a" のように **日 / ブロック + スペース番号** で、
   * ホール番号ではない。東123ホールの1日目だけはホール番号と日がたまたま
   * 一致するので、ホール番号で組み立てても通ってしまい間違いに気づきにくい。
   */
  function geoKey(item) {
    return `${item.day ?? ''}/${item.block ?? ''}${item.space ?? ''}`;
  }

  /**
   * お気に入りにジオメトリを紐付ける。
   * @param {Array} items  {wcid, day, block, space, …}
   * @param {Map<string,object>} geoByKey  "2/Ｖ01a" → geo
   */
  function attachGeo(items, geoByKey) {
    return items.map((it) => {
      // API が geoKeys を返しているならそれが一番確実。
      const keys = (it.geoKeys && it.geoKeys.length ? it.geoKeys : [geoKey(it)]).filter(Boolean);
      let geo = null;
      for (const k of keys) {
        geo = geoByKey.get(k);
        if (geo) break;
      }
      return geo ? { ...it, geo, pos: centroid(geo.space || geo.cut) } : { ...it, geo: null, pos: null };
    });
  }

  /** 最近傍法。start に一番近いものから順に貪欲に繋ぐ。 */
  function nearestNeighbor(nodes, start) {
    const rest = nodes.slice();
    const order = [];
    let cur = start;
    while (rest.length) {
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < rest.length; i++) {
        const d = dist(cur, rest[i].pos);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      const next = rest.splice(bi, 1)[0];
      order.push(next);
      cur = next.pos;
    }
    return order;
  }

  function pathLength(order, start) {
    let total = 0;
    let cur = start;
    for (const n of order) {
      total += dist(cur, n.pos);
      cur = n.pos;
    }
    return total;
  }

  /** 2-opt。区間を反転して短くなるならそのまま採用する。 */
  function twoOpt(order, start, maxPasses = 40) {
    let best = order.slice();
    let bestLen = pathLength(best, start);

    for (let pass = 0; pass < maxPasses; pass++) {
      let improved = false;
      for (let i = 0; i < best.length - 1; i++) {
        for (let k = i + 1; k < best.length; k++) {
          const cand = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
          const len = pathLength(cand, start);
          if (len < bestLen - 1e-9) {
            best = cand;
            bestLen = len;
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
    return { order: best, length: bestLen };
  }

  /**
   * 島（同じ日・エリア・ブロックのまとまり）を作る。
   */
  function buildIslands(items) {
    const map = new Map();
    for (const it of items) {
      if (!it.pos) continue;
      const key = `${it.day}|${it.area}|${it.block}`;
      if (!map.has(key)) {
        map.set(key, { day: it.day, area: it.area, areaName: it.areaName, block: it.block, items: [] });
      }
      map.get(key).items.push(it);
    }
    for (const island of map.values()) {
      const xs = island.items.map((i) => i.pos.x);
      const ys = island.items.map((i) => i.pos.y);
      island.pos = { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length };
      island.items.sort((a, b) => {
        const pa = parseSpaceNo(a.space);
        const pb = parseSpaceNo(b.space);
        return pa.number - pb.number || pa.sub.localeCompare(pb.sub);
      });
    }
    return [...map.values()];
  }

  /**
   * 島の中の並びを、入ってきた側に近い端からにする。
   * 島は基本的に一直線に並ぶので、これだけで無駄な往復が減る。
   */
  function orientIsland(island, from) {
    const items = island.items;
    if (items.length < 2 || !from) return items;
    const headD = dist(from, items[0].pos);
    const tailD = dist(from, items[items.length - 1].pos);
    return tailD < headD ? items.slice().reverse() : items;
  }

  /**
   * 巡回計画を作る。
   *
   * @param {Array} items  ジオメトリ付きのお気に入り
   * @param {{startCorner?:'south'|'north'}} [opts]
   * @returns {Array<{day, area, areaName, islands:Array, stats:object}>}
   */
  function buildPlan(items, opts = {}) {
    const withGeo = items.filter((i) => i.pos);
    const groups = new Map();

    for (const it of withGeo) {
      const key = `${it.day}|${it.area}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }

    const out = [];
    for (const [key, list] of groups) {
      const [day, area] = key.split('|');
      const islands = buildIslands(list);
      if (!islands.length) continue;

      // 入口の位置は API から取れないので、南側（y が大きい方）の端を起点とみなす。
      const ys = islands.map((i) => i.pos.y);
      const xs = islands.map((i) => i.pos.x);
      const start =
        opts.startCorner === 'north'
          ? { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...ys) }
          : { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.max(...ys) };

      const naiveLen = pathLength(
        islands.slice().sort((a, b) => String(a.block).localeCompare(String(b.block), 'ja')),
        start
      );
      const nn = nearestNeighbor(islands, start);
      const { order, length } = twoOpt(nn, start);

      let cursor = start;
      for (const island of order) {
        island.items = orientIsland(island, cursor);
        cursor = island.items[island.items.length - 1].pos;
      }

      out.push({
        day,
        area,
        areaName: list[0].areaName || area,
        islands: order,
        stats: {
          circles: list.length,
          islands: order.length,
          length,
          naiveLength: naiveLen,
          savedRatio: naiveLen > 0 ? 1 - length / naiveLen : 0,
          meters: length * METERS_PER_SPACE
        }
      });
    }

    out.sort((a, b) => String(a.day).localeCompare(String(b.day)) || String(a.area).localeCompare(String(b.area)));
    return out;
  }

  /** 配置が取れなかったぶん。計画には載らないので別に出す。 */
  function withoutGeo(items) {
    return items.filter((i) => !i.pos);
  }

  root.WCH = root.WCH || {};
  root.WCH.plan = {
    METERS_PER_SPACE,
    attachGeo,
    geoKey,
    buildPlan,
    buildIslands,
    withoutGeo,
    nearestNeighbor,
    twoOpt,
    pathLength,
    centroid,
    parseSpaceNo
  };
})(window);
