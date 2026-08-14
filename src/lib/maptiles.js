/**
 * 公式の会場地図タイルを貼り合わせて、シートの配置図の下敷きにする。
 *
 * 自前で矩形を描いた図はスペースの位置しか分からないが、公式の地図には
 * ブロック記号・スペース番号・ジャンル名・ホール表記・入口・トイレまで入っている。
 * 座標系は配置ジオメトリと同じ（スペース1つ = SpaceWidth × SpaceHeight）なので、
 * そのまま重ねられる。
 *
 * タイル: /MapTiles/tile256/{tableSize}/{kind}Day{n}-{area}/{x}-{y}.png?t={lastModified}
 *   kind は "" が下地、"overlay-" が文字や記号の層。両方重ねて1枚にする。
 *   print- という種類も URL の組み立てには存在するが、実際に叩くと 404 だった。
 *
 * タイルはログインしていないと画像ではなく HTML が返るので、
 * 拡張のページからは credentials を付けて取る必要がある。
 */
(function (root) {
  'use strict';

  const BASE = 'https://webcatalog.circle.ms';
  const TILE = 256;
  const TABLE_SIZE = 40;

  // 貼り合わせたあとの最大の幅。紙に出すぶんにはこれで十分で、
  // これ以上大きくしても PDF が重くなるだけ。
  const MAX_W = 2600;

  const cache = new Map();

  function tileUrl(area, day, x, y, kind, lastModified) {
    const t = lastModified ? `?t=${encodeURIComponent(lastModified)}` : '';
    return `${BASE}/MapTiles/tile256/${TABLE_SIZE}/${kind}Day${day}-${area}/${x}-${y}.png${t}`;
  }

  /** タイル1枚を読む。取れなければ null（範囲外のタイルは存在しない）。 */
  async function loadTile(url) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) return null; // 未ログイン時は HTML が返る
      return await createImageBitmap(blob);
    } catch (_) {
      return null;
    }
  }

  /**
   * 指定した範囲を1枚の画像にして返す。
   * @param {{area:string, day:string|number, lastModified:string|number}} src
   * @param {{x:number, y:number, w:number, h:number}} box 地図のピクセル座標
   * @returns {Promise<{href:string, ok:boolean}>}
   */
  async function region(src, box) {
    const key = `${src.area}|${src.day}|${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.w)},${Math.round(box.h)}`;
    if (cache.has(key)) return cache.get(key);

    const scale = Math.min(1, MAX_W / Math.max(1, box.w));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(box.w * scale));
    cv.height = Math.max(1, Math.round(box.h * scale));
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, cv.width, cv.height);

    const x0 = Math.floor(box.x / TILE);
    const x1 = Math.ceil((box.x + box.w) / TILE);
    const y0 = Math.floor(box.y / TILE);
    const y1 = Math.ceil((box.y + box.h) / TILE);

    let got = 0;
    for (const kind of ['', 'overlay-']) {
      const jobs = [];
      for (let x = x0; x < x1; x++) {
        for (let y = y0; y < y1; y++) {
          jobs.push(
            loadTile(tileUrl(src.area, src.day, x, y, kind, src.lastModified)).then((bmp) => ({ x, y, bmp }))
          );
        }
      }
      for (const { x, y, bmp } of await Promise.all(jobs)) {
        if (!bmp) continue;
        got++;
        g.drawImage(
          bmp,
          (x * TILE - box.x) * scale,
          (y * TILE - box.y) * scale,
          TILE * scale,
          TILE * scale
        );
        bmp.close?.();
      }
    }

    const out = got
      ? { href: cv.toDataURL('image/jpeg', 0.72), ok: true }
      : { href: '', ok: false };
    cache.set(key, out);
    return out;
  }

  /**
   * 描き終わった SVG の中の下敷き画像を、実際のタイルで埋める。
   * 取れなければ何もしない（自前で描いた矩形がそのまま見える）。
   */
  async function hydrate(rootEl, lastModified) {
    const targets = [...rootEl.querySelectorAll('image.basemap[data-area]')];
    for (const im of targets) {
      const box = {
        x: Number(im.dataset.bx),
        y: Number(im.dataset.by),
        w: Number(im.dataset.bw),
        h: Number(im.dataset.bh)
      };
      const res = await region(
        { area: im.dataset.area, day: im.dataset.day, lastModified },
        box
      );
      if (!res.ok) continue;
      im.setAttribute('href', res.href);
      // 公式の地図が乗ったので、自前で描いた灰色の矩形は消す
      const svg = im.closest('svg');
      svg?.querySelectorAll('rect.sp').forEach((r) => r.remove());
      svg?.classList.add('has-basemap');
    }
  }

  root.WCH = root.WCH || {};
  root.WCH.maptiles = { BASE, TILE, TABLE_SIZE, tileUrl, region, hydrate, cache };
})(window);
