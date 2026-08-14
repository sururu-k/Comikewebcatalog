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

  // --- 通路上の距離を使った並べ替え ---------------------------------------

  /** 距離行列（[from][to]、単位はスペース個数）を使った最近傍法。 */
  function nearestNeighborMatrix(n, distFn, startFrom) {
    const rest = [];
    for (let i = 0; i < n; i++) rest.push(i);
    const order = [];
    let cur = startFrom;
    while (rest.length) {
      let bi = 0;
      let bd = Infinity;
      for (let k = 0; k < rest.length; k++) {
        const d = distFn(cur, rest[k]);
        if (d < bd) {
          bd = d;
          bi = k;
        }
      }
      const next = rest.splice(bi, 1)[0];
      order.push(next);
      cur = next;
    }
    return order;
  }

  function matrixLength(order, distFn, startFrom) {
    let total = 0;
    let cur = startFrom;
    for (const i of order) {
      total += distFn(cur, i);
      cur = i;
    }
    return total;
  }

  function twoOptMatrix(order, distFn, startFrom, maxPasses = 40) {
    let best = order.slice();
    let bestLen = matrixLength(best, distFn, startFrom);
    for (let pass = 0; pass < maxPasses; pass++) {
      let improved = false;
      for (let i = 0; i < best.length - 1; i++) {
        for (let k = i + 1; k < best.length; k++) {
          const cand = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
          const len = matrixLength(cand, distFn, startFrom);
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
   * 巡回計画を作る。
   *
   * 島どうしの距離は直線ではなく、机を避けた通路上の最短経路で測る。
   * 直線で測ると机の上を突っ切る経路になり、描いた線も距離も実際と合わない。
   * 配置図のジオメトリが渡されなかった場合だけ、直線での概算に落ちる。
   *
   * @param {Array} items  ジオメトリ付きのお気に入り
   * @param {{geoByArea?:Map, sizeByArea?:Map, startCorner?:'south'|'north'}} [opts]
   */
  function buildPlan(items, opts = {}) {
    const gridLib = root.WCH.grid;
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

      const allGeo = opts.geoByArea?.get(key);
      const size = opts.sizeByArea?.get(key);
      const grid = gridLib && allGeo && allGeo.length ? gridLib.build(allGeo, size) : null;

      // 入口の位置は API から取れないので、南側（y が大きい方）の端を起点とみなす。
      const xs = islands.map((i) => i.pos.x);
      const ys = islands.map((i) => i.pos.y);
      const startPos =
        opts.startCorner === 'north'
          ? { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...ys) }
          : { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.max(...ys) };

      const alpha = islands.slice().sort((a, b) => String(a.block).localeCompare(String(b.block), 'ja'));

      if (!grid) {
        // 配置図が無いときだけ直線で概算する
        const naiveLen = pathLength(alpha, startPos);
        const nn = nearestNeighbor(islands, startPos);
        const { order, length } = twoOpt(nn, startPos);
        let cursor = startPos;
        for (const island of order) {
          island.items = orientIsland(island, cursor);
          cursor = island.items[island.items.length - 1].pos;
        }
        out.push({
          day, area, areaName: list[0].areaName || area, islands: order, route: null,
          stats: {
            circles: list.length, islands: order.length, length, naiveLength: naiveLen,
            savedRatio: naiveLen > 0 ? 1 - length / naiveLen : 0,
            meters: length * METERS_PER_SPACE, walkable: false, unreachable: 0
          }
        });
        continue;
      }

      // 各島の「立てるマス」を決める
      const startCell = gridLib.nearestFree(grid, startPos.x, startPos.y);
      for (const island of islands) {
        const rect = island.items[0].geo?.space || island.items[0].geo?.cut;
        island.cell = gridLib.accessCell(grid, rect, island.pos) || gridLib.nearestFree(grid, island.pos.x, island.pos.y);
      }

      // 起点と各島からの通路上の距離を一度ずつ求める
      const fields = islands.map((i) => gridLib.distances(grid, i.cell));
      const startField = gridLib.distances(grid, startCell);
      const costAt = (field, cell) => {
        if (!cell) return -1;
        return field.dist[cell[1] * grid.W + cell[0]];
      };

      let unreachable = 0;
      const distFn = (from, to) => {
        const field = from === -1 ? startField : fields[from];
        const c = costAt(field, islands[to].cell);
        if (c < 0) {
          unreachable++;
          // 通路で繋がらないときは直線で代用する（島の中に入り込めない配置など）
          const a = from === -1 ? startPos : islands[from].pos;
          return dist(a, islands[to].pos) * gridLib.ORTH;
        }
        return c;
      };

      const nn = nearestNeighborMatrix(islands.length, distFn, -1);
      const { order: orderIdx, length: cost } = twoOptMatrix(nn, distFn, -1);
      const naiveCost = matrixLength(alpha.map((i) => islands.indexOf(i)), distFn, -1);

      const order = orderIdx.map((i) => islands[i]);

      // 島の中の並びを、入ってきた側に近い端からにする
      let cursor = startPos;
      for (const island of order) {
        island.items = orientIsland(island, cursor);
        cursor = island.items[island.items.length - 1].pos;
      }

      // 各サークルの前に立つマスを出す。経路はここを順に通る。
      for (const island of order) {
        island.stops = island.items
          .map((it) => gridLib.accessCell(grid, it.geo?.space || it.geo?.cut, it.pos))
          .filter(Boolean);
        if (!island.stops.length && island.cell) island.stops = [island.cell];
        // バッジは経路が実際に来る場所（島の入口）に置く。
        // 島の重心に置くと、机の上に番号が乗って線と離れて見える。
        island.badge = island.stops[0] || island.cell;
      }

      // 実際に歩く線をつなぐ。
      // 同じブロックでも列をまたいで離れていることがあるので、島の中も含めて
      // すべての区間を通路探索でつなぐ。直線で結ぶと机を突っ切ってしまう。
      const stops = order.flatMap((island) => island.stops);
      const cells = [];
      let walked = 0;
      let fromCell = startCell;

      const fieldCache = new Map();
      const fieldFrom = (cell) => {
        const k = `${cell[0]},${cell[1]}`;
        if (!fieldCache.has(k)) fieldCache.set(k, gridLib.distances(grid, cell));
        return fieldCache.get(k);
      };

      for (const to of stops) {
        if (!fromCell) {
          fromCell = to;
          continue;
        }
        const field = fieldFrom(fromCell);
        const c = field.dist[to[1] * grid.W + to[0]];
        const seg = c >= 0 ? gridLib.pathTo(grid, field.prev, to) : [];
        if (c > 0) walked += c;
        if (seg.length) cells.push(...(cells.length ? seg.slice(1) : seg));
        else cells.push(to); // 万一つながらないときも線は切らない
        fromCell = to;
      }

      const route = gridLib.simplify(cells);

      const length = gridLib.toSpaces(walked || cost);
      const naiveLength = gridLib.toSpaces(naiveCost);

      out.push({
        day,
        area,
        areaName: list[0].areaName || area,
        islands: order,
        route,
        stats: {
          circles: list.length,
          islands: order.length,
          length,
          naiveLength,
          savedRatio: naiveLength > 0 ? 1 - length / naiveLength : 0,
          meters: length * METERS_PER_SPACE,
          walkable: true,
          unreachable
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
