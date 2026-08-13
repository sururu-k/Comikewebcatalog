/**
 * 巡回シートの生成。配置図（SVG）と巡回リストを1枚のページにまとめ、
 * 新しいタブで開く。そのタブでそのまま印刷 → PDF として保存できる。
 *
 * 配置図は画像タイルではなくスペースの矩形座標から SVG で描き起こしている。
 * ベクタなので拡大しても潰れず、PDF にしても軽い。
 */
(function (root) {
  'use strict';

  const { plan } = root.WCH;

  // サイトのテーマ配色（バンドルの色定義から取った値）。
  const FAVORITE_COLORS = {
    1: '#FF944A', 2: '#FF00FF', 3: '#FFF700', 4: '#00B54A', 5: '#00B5FF',
    6: '#9C529C', 7: '#0000FF', 8: '#00FF00', 9: '#FF0000', 10: '#ff7f00',
    11: '#800080', 12: '#008080', 13: '#a52a2a', 14: '#6a5acd', 15: '#daa520',
    16: '#2e8b57', 17: '#dc143c', 18: '#ff1493'
  };

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function colorOf(item) {
    return FAVORITE_COLORS[item.color] || FAVORITE_COLORS[1];
  }

  /**
   * 1エリア分の配置図を SVG で描く。
   *
   * @param {object} group     buildPlan の1要素
   * @param {Array}  allGeo    そのエリア・日の全スペース（背景用）
   * @param {object} size      minimapSizeSettings の該当行
   */
  function renderMap(group, allGeo, size) {
    const sw = size?.SpaceWidth || 14;
    const sh = size?.SpaceHeight || 20;
    const W = size?.BigmapWidth || 3276;
    const H = size?.BigmapHeight || 1760;

    const rect = (g, attrs, grow = 0) => {
      const r = g.space || g.cut;
      if (!r) return '';
      const x = r[0] * sw - grow;
      const y = r[1] * sh - grow;
      const w = Math.max((r[2] - r[0]) * sw, 1) + grow * 2;
      const h = Math.max((r[3] - r[1]) * sh, 1) + grow * 2;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${attrs}/>`;
    };

    // 背景：全スペースを薄く
    const bg = allGeo.map((g) => rect(g, 'class="sp"')).join('');

    // お気に入り：色付きで塗る
    const marks = [];
    const labels = [];
    let n = 0;
    for (const island of group.islands) {
      n++;
      for (const it of island.items) {
        if (!it.geo) continue;
        // 1スペースは印刷すると豆粒なので、外側に少し広げた枠を重ねて見つけやすくする。
        marks.push(rect(it.geo, `class="halo" stroke="${colorOf(it)}"`, sw * 0.9));
        marks.push(rect(it.geo, `fill="${colorOf(it)}" stroke="#111" stroke-width="1.5" class="fav"`));
      }
      // 島の番号（巡回順）
      const p = island.pos;
      labels.push(
        `<g class="badge"><circle cx="${p.x * sw}" cy="${p.y * sh}" r="${sh * 0.95}"/>` +
          `<text x="${p.x * sw}" y="${p.y * sh}">${n}</text></g>`
      );
    }

    // 巡回線
    const pts = group.islands.map((i) => `${i.pos.x * sw},${i.pos.y * sh}`).join(' ');
    const line = pts ? `<polyline class="route" points="${pts}"/>` : '';

    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
  <rect class="paper" x="0" y="0" width="${W}" height="${H}"/>
  <g>${bg}</g>
  ${line}
  <g>${marks.join('')}</g>
  <g>${labels.join('')}</g>
</svg>`;
  }

  function renderIslandTable(island, index) {
    const rows = island.items
      .map(
        (it) => `<tr>
        <td class="chk"></td>
        <td class="sw"><span style="background:${colorOf(it)}"></span></td>
        <td class="sp">${esc(it.block)}${esc(it.space)}</td>
        <td class="nm">${esc(it.name || '')}${it.writer ? `<span class="wr">${esc(it.writer)}</span>` : ''}</td>
        <td class="mm">${esc(it.memo || '')}</td>
      </tr>`
      )
      .join('');

    // 地図側のバッジは 1 始まりなので合わせる。
    return `<section class="island">
      <h3><span class="no">${index + 1}</span>${esc(island.block)} ブロック <small>${island.items.length}</small></h3>
      <table><tbody>${rows}</tbody></table>
    </section>`;
  }

  function renderGroup(group, allGeo, size) {
    const s = group.stats;
    const saved = s.savedRatio > 0 ? `（ブロック名順より ${Math.round(s.savedRatio * 100)}% 短い）` : '';
    return `<article class="area">
      <header>
        <h2>${esc(group.day)}日目 ${esc(group.areaName)}</h2>
        <div class="meta">
          ${s.circles} サークル / ${s.islands} 島 ・
          移動 約 ${Math.round(s.meters)} m ${saved}
        </div>
      </header>
      <div class="map">${renderMap(group, allGeo, size)}</div>
      <div class="islands">${group.islands.map(renderIslandTable).join('')}</div>
    </article>`;
  }

  const CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px; background: #fff; color: #111;
         font-family: "Yu Gothic UI","Hiragino Sans","Noto Sans JP",sans-serif; line-height: 1.5; }
  .top { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap;
         border-bottom: 3px solid #111; padding-bottom: 8px; margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0; }
  .top .sub { color: #666; font-size: 13px; }
  .print-btn { margin-left: auto; padding: 8px 18px; font: inherit; font-weight: 600; cursor: pointer;
               background: #2f5d9e; color: #fff; border: 0; border-radius: 6px; }
  .print-btn:hover { background: #3a6cb4; }

  article.area { break-before: page; margin-bottom: 26px; }
  article.area:first-of-type { break-before: auto; }
  article.area > header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
                          border-bottom: 2px solid #111; padding-bottom: 4px; margin-bottom: 10px; }
  h2 { font-size: 17px; margin: 0; }
  .meta { color: #555; font-size: 12px; }

  .map { border: 1px solid #bbb; margin-bottom: 14px; background: #fafafa; }
  .map svg { display: block; width: 100%; height: auto; max-height: 60vh; }
  .paper { fill: #fff; }
  .sp { fill: #e4e4e8; stroke: #fff; stroke-width: .5; }
  .halo { fill: none; stroke-width: 3; opacity: .55; }
  .route { fill: none; stroke: #2f5d9e; stroke-width: 5; stroke-dasharray: 14 10;
           stroke-linejoin: round; opacity: .85; }
  .badge circle { fill: #2f5d9e; }
  .badge text { fill: #fff; font-size: 22px; font-weight: 700; text-anchor: middle;
                dominant-baseline: central; }

  .islands { column-width: 330px; column-gap: 20px; }
  section.island { break-inside: avoid; margin-bottom: 12px; }
  h3 { font-size: 13px; margin: 0 0 4px; display: flex; align-items: center; gap: 7px;
       border-bottom: 1px solid #999; padding-bottom: 3px; }
  h3 .no { display: inline-flex; align-items: center; justify-content: center;
           width: 19px; height: 19px; border-radius: 50%; background: #2f5d9e; color: #fff;
           font-size: 11px; flex: none; }
  h3 small { font-weight: normal; color: #888; margin-left: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  td { padding: 2px 4px; border-bottom: 1px solid #e2e2e2; vertical-align: top; }
  td.chk { width: 14px; }
  td.chk::before { content: ""; display: inline-block; width: 11px; height: 11px;
                   border: 1px solid #777; margin-top: 2px; }
  td.sw { width: 12px; }
  td.sw span { display: inline-block; width: 9px; height: 9px; border: 1px solid #555; }
  td.sp { width: 62px; font-family: Consolas,monospace; white-space: nowrap; }
  td.nm .wr { display: block; color: #777; font-size: 10.5px; }
  td.mm { color: #555; font-size: 11px; }

  .leftover { margin-top: 20px; padding: 10px 12px; border: 1px dashed #b08; border-radius: 6px; }
  .leftover h2 { font-size: 14px; border: 0; }

  @page { size: A4 landscape; margin: 10mm; }
  @media print {
    body { padding: 0; }
    .print-btn { display: none; }
    .map svg { max-height: 118mm; }
  }`;

  /**
   * シートを組み立てて新しいタブで開く。
   *
   * @param {Array}  groups   buildPlan の結果
   * @param {Map}    geoByArea  "day|area" → そのエリアの全 geo（背景用）
   * @param {Map}    sizeByArea "day|area" → minimapSizeSettings の行
   * @param {Array}  leftovers  配置が引けなかったお気に入り
   * @param {object} meta       {title, eventName}
   */
  function open(groups, geoByArea, sizeByArea, leftovers, meta = {}) {
    const total = groups.reduce((a, g) => a + g.stats.circles, 0);

    const body = groups
      .map((g) => renderGroup(g, geoByArea.get(`${g.day}|${g.area}`) || [], sizeByArea.get(`${g.day}|${g.area}`)))
      .join('');

    const left = leftovers.length
      ? `<div class="leftover"><h2>配置が引けなかったサークル（${leftovers.length}）</h2>
         <table><tbody>${leftovers
           .map(
             (it) =>
               `<tr><td class="chk"></td><td class="sp">${esc(it.block || '')}${esc(it.space || '')}</td><td class="nm">${esc(it.name || '')}</td><td class="mm">${esc(it.memo || '')}</td></tr>`
           )
           .join('')}</tbody></table></div>`
      : '';

    const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>${esc(meta.title || '巡回シート')}</title><style>${CSS}</style></head><body>
<div class="top">
  <h1>${esc(meta.title || '巡回シート')}</h1>
  <div class="sub">${esc(meta.eventName || '')} ・ お気に入り ${total} 件 ・ ${groups.length} エリア</div>
  <button class="print-btn" onclick="window.print()">PDF で保存 / 印刷</button>
</div>
${body}
${left}
</body></html>`;

    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    return { total, areas: groups.length };
  }

  root.WCH.sheet = { open, renderMap, FAVORITE_COLORS, CSS };
})(window);
