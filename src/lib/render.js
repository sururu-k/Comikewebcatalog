/**
 * 巡回シートの描画。配置図の SVG と、島ごとのチェックリストを組み立てる。
 *
 * 配置図は画像タイルではなくスペースの矩形座標から描き起こしている。
 * ベクタなので拡大しても潰れず、紙に出しても細かいところが読める。
 */
(function (root) {
  'use strict';

  const detail = root.WCH.detail;

  // サイトのテーマ配色（配信バンドルの色定義から取った値）。
  const FAVORITE_COLORS = {
    1: '#FF944A', 2: '#FF00FF', 3: '#FFF700', 4: '#00B54A', 5: '#00B5FF',
    6: '#9C529C', 7: '#0000FF', 8: '#00FF00', 9: '#FF0000', 10: '#ff7f00',
    11: '#800080', 12: '#008080', 13: '#a52a2a', 14: '#6a5acd', 15: '#daa520',
    16: '#2e8b57', 17: '#dc143c', 18: '#ff1493'
  };

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const colorOf = (item) => FAVORITE_COLORS[item.color] || FAVORITE_COLORS[1];

  // --- 配置図 ------------------------------------------------------------

  function renderMap(group, allGeo, size, opts = {}) {
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

    const bg = allGeo.map((g) => rect(g, 'class="sp"')).join('');

    const marks = [];
    const badges = [];
    let n = 0;
    for (const island of group.islands) {
      n++;
      for (const it of island.items) {
        if (!it.geo) continue;
        // 1スペースは紙に出すと豆粒なので、外側に広げた枠を重ねて見つけやすくする。
        marks.push(rect(it.geo, `class="halo" stroke="${colorOf(it)}"`, sw * 0.9));
        marks.push(rect(it.geo, `fill="${colorOf(it)}" stroke="#111" stroke-width="1.5"`));
      }
      // 番号は経路が実際に来る場所（島の入口）に置く。無ければ重心で代用。
      const bx = island.badge ? (island.badge[0] + 0.5) * sw : island.pos.x * sw;
      const by = island.badge ? (island.badge[1] + 0.5) * sh : island.pos.y * sh;
      badges.push(
        `<g class="badge"><circle cx="${bx}" cy="${by}" r="${sh * 0.95}"/>` +
          `<text x="${bx}" y="${by}">${n}</text></g>`
      );
    }

    // 経路は通路のマスを辿った線。マスの中心を通す。
    // 配置図が無くて通路を計算できなかったときだけ、島どうしを直線で結ぶ。
    const pts = group.route && group.route.length
      ? group.route.map(([x, y]) => `${(x + 0.5) * sw},${(y + 0.5) * sh}`).join(' ')
      : group.islands.map((i) => `${i.pos.x * sw},${i.pos.y * sh}`).join(' ');
    // 公式の地図は色が多いので、経路の下に白い縁を敷いて見失わないようにする
    const line = pts
      ? `<polyline class="route-casing" points="${pts}"/><polyline class="route" points="${pts}"/>`
      : '';

    // 見る必要があるのはお気に入りと経路の周りだけなので、そこに寄せる。
    // 数件しか無いときにホール全体を出すと、ほとんど余白になって読めない。
    const box = (() => {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      const add = (px, py) => {
        if (px < x1) x1 = px;
        if (py < y1) y1 = py;
        if (px > x2) x2 = px;
        if (py > y2) y2 = py;
      };
      for (const island of group.islands) {
        for (const it of island.items) {
          const r = it.geo?.space || it.geo?.cut;
          if (!r) continue;
          add(r[0] * sw, r[1] * sh);
          add(r[2] * sw, r[3] * sh);
        }
      }
      for (const [x, y] of group.route || []) add((x + 0.5) * sw, (y + 0.5) * sh);
      for (const island of group.islands) {
        if (island.badge) add((island.badge[0] + 0.5) * sw, (island.badge[1] + 0.5) * sh);
      }
      if (!Number.isFinite(x1)) return { x: 0, y: 0, w: W, h: H };

      const pad = sw * 6;
      x1 = Math.max(0, x1 - pad);
      y1 = Math.max(0, y1 - pad);
      x2 = Math.min(W, x2 + pad);
      y2 = Math.min(H, y2 + pad);

      // 縦横比が極端になると読みにくいので、短い辺を広げて整える
      let w = x2 - x1;
      let h = y2 - y1;
      const ratio = W / H;
      if (w / h > ratio) {
        const nh = Math.min(H, w / ratio);
        y1 = Math.max(0, Math.min(H - nh, y1 - (nh - h) / 2));
        h = nh;
      } else {
        const nw = Math.min(W, h * ratio);
        x1 = Math.max(0, Math.min(W - nw, x1 - (nw - w) / 2));
        w = nw;
      }
      return { x: x1, y: y1, w, h };
    })();

    // 下敷きは、あとから公式の地図タイルで差し替える（maptiles.hydrate）。
    // 差し替えられなかったときは、その下の灰色の矩形がそのまま見える。
    const base = opts.officialMap
      ? `<image class="basemap" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"
          preserveAspectRatio="none" data-area="${esc(group.area)}" data-day="${esc(group.day)}"
          data-bx="${box.x}" data-by="${box.y}" data-bw="${box.w}" data-bh="${box.h}"/>`
      : '';

    return `<svg viewBox="${box.x} ${box.y} ${box.w} ${box.h}" preserveAspectRatio="xMidYMid meet" role="img">
  <rect class="paper" x="0" y="0" width="${W}" height="${H}"/>
  <g>${bg}</g>${base}${line}<g>${marks.join('')}</g><g>${badges.join('')}</g>
</svg>`;
  }

  // --- チェックリスト ----------------------------------------------------

  /**
   * お使いメモ欄。
   * 画面では書き換えられるようにし、書いていなければ紙に手書きできるよう罫線を引く。
   */
  function errandField(it, opts) {
    const text = it.errand || '';
    const lines = Math.max(1, opts.errandLines ?? 2);
    const ruled = text ? '' : `<span class="ruled" style="--lines:${lines}"></span>`;
    const editable = opts.editable ? ' contenteditable="plaintext-only" spellcheck="false"' : '';
    return `<div class="errand${text ? ' has' : ''}"><span class="tag">お使い</span>
      <span class="body"${editable} data-wcid="${esc(it.wcid)}">${esc(text)}</span>${ruled}</div>`;
  }

  const PRIORITIES = root.WCH.store.PRIORITIES;
  const yen = (n) => '¥' + Number(n || 0).toLocaleString('ja-JP');

  /**
   * そのサークルの詳細ページ。
   *
   * 新しい方のサイトは SPA で、詳細は一覧のカードを押すと出るドロワー。開いても
   * URL が変わらないので、リンクにはできない。一方 旧版(classic) にはサークル1件の
   * 実ページがあり、`/Circle/<wcid>` でそのまま開ける（title もサークル名になる）。
   * リンクとして貼れるならそのほうが素直なので、こちらを使う。
   */
  function siteUrl(it) {
    return `https://classic-webcatalog.circle.ms/Circle/${encodeURIComponent(it.wcid)}`;
  }

  /**
   * 優先度。画面では選べるようにし、紙では記号だけ出す。
   * 記号は 高=◎ 中=○ 低=△、未設定は空欄（手書きで丸を付けられる）。
   */
  function priorityField(it, opts) {
    const cur = it.priority || 0;
    const mark = (PRIORITIES.find((p) => p.value === cur) || {}).mark || '';
    if (!opts.editable) return `<span class="pri p${cur}">${mark}</span>`;
    const optionsHtml = PRIORITIES.map(
      (p) => `<option value="${p.value}"${p.value === cur ? ' selected' : ''}>${p.mark || '—'}</option>`
    ).join('');
    return (
      `<span class="pri p${cur}" data-mark="${mark}">` +
      `<select class="pri-sel" data-wcid="${esc(it.wcid)}">${optionsHtml}</select></span>`
    );
  }

  /**
   * 予算。自分で入れる欄だが、頒布物の価格が公開されていればそれを目安として置いておく
   * （プレースホルダに出すだけで、押して入れるまでは合計に入れない）。
   */
  function budgetField(it, opts) {
    const v = it.budget || 0;
    const hint = it.priceTotal > 0 ? String(it.priceTotal) : '';
    if (!opts.editable) return v ? `<span class="bg">${yen(v)}</span>` : '<span class="bg blank"></span>';
    return (
      `<span class="bg${v ? '' : ' blank'}">` +
      `<input class="bg-in" type="number" min="0" step="100" inputmode="numeric" ` +
      `value="${v || ''}" placeholder="${esc(hint || '¥')}" ` +
      `data-suggest="${it.priceTotal || 0}" data-wcid="${esc(it.wcid)}"></span>`
    );
  }

  function renderItem(it, opts) {
    const bookLine =
      opts.showBooks && it.books && it.books.length
        ? `<div class="bk">${it.books
            .map(
              (b) =>
                `<span class="b">${b.isNew ? '<i class="new">新</i>' : ''}${esc(b.name)}` +
                `${b.size || b.pages ? `<em>${esc(b.size || '')}${b.pages ? `${b.pages}p` : ''}</em>` : ''}` +
                `${b.priceShown && b.price != null ? `<i class="pz">${yen(b.price)}</i>` : ''}</span>`
            )
            .join('')}</div>`
        : '';

    const ext =
      opts.showExternals && it.externals && it.externals.length
        ? `<div class="ex">${[...new Set(it.externals.map((e) => e.service))].map(esc).join(' / ')}</div>`
        : '';

    const siteMemo = it.memo ? `<div class="sm">${esc(it.memo)}</div>` : '';

    return `<div class="ci" data-wcid="${esc(it.wcid)}" data-priority="${it.priority || 0}">
      <div class="head">
        <span class="chk"></span>
        <span class="sw" style="background:${colorOf(it)}"></span>
        ${priorityField(it, opts)}
        <a class="go" href="${esc(siteUrl(it))}" target="_blank" rel="noopener"
           title="このサークルの詳細ページを開く"><span class="sp">${esc(it.block)}${esc(it.space)}</span><span class="nm">${esc(it.name || '')}</span></a>
        ${it.writer ? `<span class="wr">${esc(it.writer)}</span>` : ''}
        ${it.hasNewBook ? '<span class="newbadge">新刊</span>' : ''}
        ${budgetField(it, opts)}
      </div>
      ${bookLine}${ext}${siteMemo}${errandField(it, opts)}
    </div>`;
  }

  function renderIsland(island, index, opts) {
    return `<section class="island">
      <h3><span class="no">${index + 1}</span>${esc(island.block)} ブロック <small>${island.items.length}</small></h3>
      ${island.items.map((it) => renderItem(it, opts)).join('')}
    </section>`;
  }

  /** 予算と優先度の集計。 */
  function summarize(items) {
    const budget = items.reduce((a, i) => a + (Number(i.budget) || 0), 0);
    const counts = { 1: 0, 2: 0, 3: 0, 0: 0 };
    for (const i of items) counts[i.priority || 0]++;
    return { budget, counts, withBudget: items.filter((i) => Number(i.budget) > 0).length };
  }

  function summaryText(sum) {
    const marks = [];
    for (const p of PRIORITIES) {
      if (p.value && sum.counts[p.value]) marks.push(`${p.mark}${sum.counts[p.value]}`);
    }
    const parts = [];
    if (marks.length) parts.push(`優先度 ${marks.join(' ')}`);
    if (sum.budget > 0) parts.push(`予算 ${yen(sum.budget)}`);
    return parts.join(' ・ ');
  }

  function renderGroup(group, allGeo, size, opts) {
    const s = group.stats;
    // 人混みの中を歩く速さを 時速 3km と置いた目安。買うのに並ぶ時間は含めない。
    const minutes = Math.max(1, Math.round(s.meters / (3000 / 60)));
    const note = s.walkable === false ? '<span class="warn">通路データ無し・直線概算</span>' : '';
    const items = group.islands.flatMap((i) => i.items);
    const sum = summarize(items);
    return `<article class="area" data-key="${esc(group.day)}|${esc(group.area)}">
      <header>
        <h2>${esc(group.day)}日目 ${esc(group.areaName)}</h2>
        <div class="meta">${s.circles} サークル / ${s.islands} 島 ・ 歩く距離 約 ${Math.round(s.meters)} m
          <span class="mins" title="人混みを時速3kmで歩いた場合の目安。並ぶ時間は含みません">（歩くだけで約 ${minutes} 分）</span> ${note}</div>
        <div class="sum" data-sum>${summaryText(sum)}</div>
      </header>
      ${opts.showMap ? `<div class="map">${renderMap(group, allGeo, size, opts)}</div>` : ''}
      <div class="islands">${group.islands.map((i, n) => renderIsland(i, n, opts)).join('')}</div>
    </article>`;
  }

  function renderLeftovers(leftovers, opts) {
    if (!leftovers.length) return '';
    return `<div class="leftover"><h2>配置が引けなかったサークル（${leftovers.length}）</h2>
      ${leftovers.map((it) => renderItem(it, opts)).join('')}</div>`;
  }

  /** シート本体（ヘッダを除く中身）。 */
  function renderBody(groups, geoByArea, sizeByArea, leftovers, opts = {}) {
    const o = {
      showMap: true,
      showBooks: true,
      showExternals: true,
      officialMap: true,
      editable: false,
      errandLines: 2,
      ...opts
    };
    return (
      groups
        .map((g) =>
          renderGroup(g, geoByArea.get(`${g.day}|${g.area}`) || [], sizeByArea.get(`${g.day}|${g.area}`), o)
        )
        .join('') + renderLeftovers(leftovers, o)
    );
  }

  root.WCH = root.WCH || {};
  root.WCH.render = {
    FAVORITE_COLORS,
    colorOf,
    esc,
    yen,
    renderMap,
    renderBody,
    renderGroup,
    renderItem,
    summarize,
    summaryText,
    siteUrl
  };
})(window);
