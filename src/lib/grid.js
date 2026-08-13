/**
 * 会場の通行可能マスと、その上での最短経路。
 *
 * 配置図のジオメトリはスペース1つを1とする格子座標で来るので、そのまま
 * 「机が置いてあるマス = 通れない」「それ以外 = 通路」として扱える。
 * 島の重心どうしを直線で結ぶと机の上を突っ切ってしまうため、経路も距離も
 * ここで求めた通路上の最短経路を使う。
 *
 * 斜め移動を許し、コストは縦横 10 / 斜め 14（≒√2）。
 * 机の角を斜めにすり抜けるのは禁止しているので、隙間の無いところは通らない。
 */
(function (root) {
  'use strict';

  const ORTH = 10;
  const DIAG = 14;

  /**
   * 通行可能マスの盤面を作る。
   * @param {Array} allGeo  そのエリア・日の全スペース
   * @param {object} size   minimapSizeSettings の該当行
   */
  function build(allGeo, size) {
    const sw = size?.SpaceWidth || 14;
    const sh = size?.SpaceHeight || 20;
    const W = Math.max(1, Math.ceil((size?.BigmapWidth || 3276) / sw));
    const H = Math.max(1, Math.ceil((size?.BigmapHeight || 1760) / sh));
    const blocked = new Uint8Array(W * H);

    for (const g of allGeo) {
      const r = g.space || g.cut;
      if (!r) continue;
      const x1 = Math.max(0, Math.floor(r[0]));
      const y1 = Math.max(0, Math.floor(r[1]));
      const x2 = Math.min(W, Math.ceil(r[2]));
      const y2 = Math.min(H, Math.ceil(r[3]));
      for (let y = y1; y < y2; y++) {
        for (let x = x1; x < x2; x++) blocked[y * W + x] = 1;
      }
    }
    return { W, H, sw, sh, blocked };
  }

  const idx = (grid, x, y) => y * grid.W + x;
  const free = (grid, x, y) =>
    x >= 0 && y >= 0 && x < grid.W && y < grid.H && !grid.blocked[y * grid.W + x];

  /**
   * ある矩形のそばで実際に立てるマス。
   * 机そのものは通れないので、隣接する通路のうち target に一番近いものを返す。
   */
  function accessCell(grid, rect, target) {
    if (!rect) return null;
    const x1 = Math.floor(rect[0]);
    const y1 = Math.floor(rect[1]);
    const x2 = Math.ceil(rect[2]);
    const y2 = Math.ceil(rect[3]);

    const cands = [];
    for (let x = x1 - 1; x <= x2; x++) {
      for (const y of [y1 - 1, y2]) if (free(grid, x, y)) cands.push([x, y]);
    }
    for (let y = y1 - 1; y <= y2; y++) {
      for (const x of [x1 - 1, x2]) if (free(grid, x, y)) cands.push([x, y]);
    }
    if (!cands.length) return nearestFree(grid, (x1 + x2) / 2, (y1 + y2) / 2);

    const t = target || { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    let best = cands[0];
    let bd = Infinity;
    for (const c of cands) {
      const d = (c[0] - t.x) ** 2 + (c[1] - t.y) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** 任意の点から一番近い通路マス。渦巻き状に探す。 */
  function nearestFree(grid, fx, fy) {
    const cx = Math.max(0, Math.min(grid.W - 1, Math.round(fx)));
    const cy = Math.max(0, Math.min(grid.H - 1, Math.round(fy)));
    if (free(grid, cx, cy)) return [cx, cy];
    for (let r = 1; r < Math.max(grid.W, grid.H); r++) {
      for (let d = -r; d <= r; d++) {
        const pts = [[cx + d, cy - r], [cx + d, cy + r], [cx - r, cy + d], [cx + r, cy + d]];
        for (const [x, y] of pts) if (free(grid, x, y)) return [x, y];
      }
    }
    return null;
  }

  /** コスト付き優先度つきキュー（小さい二分ヒープ）。 */
  function Heap() {
    const a = [];
    return {
      size: () => a.length,
      push(node, cost) {
        a.push({ node, cost });
        let i = a.length - 1;
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (a[p].cost <= a[i].cost) break;
          [a[p], a[i]] = [a[i], a[p]];
          i = p;
        }
      },
      pop() {
        const top = a[0];
        const last = a.pop();
        if (a.length) {
          a[0] = last;
          let i = 0;
          for (;;) {
            const l = i * 2 + 1;
            const r = l + 1;
            let m = i;
            if (l < a.length && a[l].cost < a[m].cost) m = l;
            if (r < a.length && a[r].cost < a[m].cost) m = r;
            if (m === i) break;
            [a[m], a[i]] = [a[i], a[m]];
            i = m;
          }
        }
        return top;
      }
    };
  }

  /**
   * 通路上のダイクストラ。始点から全マスへの距離と、経路復元用の親を返す。
   * 距離は「縦横1マス = 10」の整数。
   */
  function distances(grid, start) {
    const N = grid.W * grid.H;
    const dist = new Int32Array(N).fill(-1);
    const prev = new Int32Array(N).fill(-1);
    if (!start) return { dist, prev };

    const s = idx(grid, start[0], start[1]);
    if (grid.blocked[s]) return { dist, prev };

    dist[s] = 0;
    const heap = Heap();
    heap.push(s, 0);

    while (heap.size()) {
      const { node, cost } = heap.pop();
      if (cost > dist[node]) continue;
      const x = node % grid.W;
      const y = (node - x) / grid.W;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (!free(grid, nx, ny)) continue;
          // 机の角を斜めにすり抜けない
          if (dx && dy && (!free(grid, x + dx, y) || !free(grid, x, y + dy))) continue;

          const nc = cost + (dx && dy ? DIAG : ORTH);
          const ni = idx(grid, nx, ny);
          if (dist[ni] === -1 || nc < dist[ni]) {
            dist[ni] = nc;
            prev[ni] = node;
            heap.push(ni, nc);
          }
        }
      }
    }
    return { dist, prev };
  }

  /** distances() の prev を辿って、始点→終点のマス列を作る。 */
  function pathTo(grid, prev, goal) {
    if (!goal) return [];
    let i = idx(grid, goal[0], goal[1]);
    if (prev[i] === -1 && grid.blocked[i]) return [];
    const out = [];
    let guard = 0;
    while (i !== -1 && guard++ < grid.W * grid.H) {
      const x = i % grid.W;
      out.push([x, (i - x) / grid.W]);
      i = prev[i];
    }
    return out.reverse();
  }

  /** 曲がり角だけ残して点を減らす（SVG を軽くするため）。 */
  function simplify(cells) {
    if (cells.length < 3) return cells.slice();
    const out = [cells[0]];
    for (let i = 1; i < cells.length - 1; i++) {
      const a = out[out.length - 1];
      const b = cells[i];
      const c = cells[i + 1];
      const d1x = Math.sign(b[0] - a[0]);
      const d1y = Math.sign(b[1] - a[1]);
      const d2x = Math.sign(c[0] - b[0]);
      const d2y = Math.sign(c[1] - b[1]);
      if (d1x !== d2x || d1y !== d2y) out.push(b);
    }
    out.push(cells[cells.length - 1]);
    return out;
  }

  /** 距離の単位を「スペース何個ぶん」に戻す。 */
  const toSpaces = (cost) => cost / ORTH;

  root.WCH = root.WCH || {};
  root.WCH.grid = { ORTH, DIAG, build, free, accessCell, nearestFree, distances, pathTo, simplify, toSpaces };
})(window);
