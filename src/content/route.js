/**
 * 巡回ルート補助。収集済みレコードをスペース順に並べ、島ごとにまとめる。
 */
(function (root) {
  'use strict';

  const space = root.WCH.space;

  /**
   * @param {Array} records
   * @param {{onlyFavorite?:boolean, onlyPlaced?:boolean}} opts
   * @returns {Array<{key:string, items:Array}>}
   */
  function buildGroups(records, opts = {}) {
    let rows = records.slice();

    // favoriteColor は未登録のカードにも付いている可能性があるため条件に使わない。
    // 確定した favorite だけで絞る（お気に入り一覧を開いて収集すると確定する）。
    if (opts.onlyFavorite) rows = rows.filter((r) => r.favorite);
    if (opts.onlyPlaced) rows = rows.filter((r) => (r.space || '').trim() !== '');

    rows.sort((a, b) => space.compare(a.space || '', b.space || ''));

    const groups = [];
    let cur = null;
    for (const r of rows) {
      const key = space.islandKey(r.space || '');
      if (!cur || cur.key !== key) {
        cur = { key, items: [] };
        groups.push(cur);
      }
      cur.items.push(r);
    }
    return groups;
  }

  /** 印刷しやすい HTML を組み立てて、新しいタブで開く。 */
  function openRouteSheet(groups, title) {
    const esc = (s) =>
      String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const total = groups.reduce((n, g) => n + g.items.length, 0);

    const body = groups
      .map(
        (g) => `
      <section>
        <h2>${esc(g.key)} <small>${g.items.length}</small></h2>
        <table>
          <tbody>
            ${g.items
              .map(
                (it) => `<tr>
                  <td class="chk"></td>
                  <td class="sp">${esc(it.space || '—')}</td>
                  <td class="nm">${esc(it.name || '')}</td>
                  <td class="mm">${esc(it.memo || '')}</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </section>`
      )
      .join('');

    const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: "Yu Gothic UI", "Hiragino Sans", sans-serif; margin: 24px; line-height: 1.5; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
  section { break-inside: avoid; margin-bottom: 18px; }
  h2 { font-size: 14px; border-bottom: 2px solid currentColor; padding-bottom: 3px; margin: 0 0 6px; }
  h2 small { font-weight: normal; color: #888; margin-left: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 3px 6px; border-bottom: 1px solid rgba(128,128,128,.3); vertical-align: top; }
  td.chk { width: 18px; }
  td.chk::before { content: ""; display: inline-block; width: 12px; height: 12px; border: 1px solid #888; }
  td.sp { width: 110px; font-family: Consolas, monospace; white-space: nowrap; }
  td.mm { color: #666; font-size: 12px; }
  @media print { body { margin: 10mm; } .noprint { display: none; } }
</style></head>
<body>
  <h1>${esc(title)}</h1>
  <div class="meta">${total} 件 / ${groups.length} 島 &middot; スペース順</div>
  ${body}
</body></html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  root.WCH.route = { buildGroups, openRouteSheet };
})(window);
