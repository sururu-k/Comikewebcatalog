/**
 * CSV / JSON への直列化。Excel で開くことを想定して UTF-8 BOM 付き・CRLF 改行にしている。
 */
(function (root) {
  'use strict';

  const COLUMNS = [
    { key: 'wcid', label: 'wcid' },
    { key: 'space', label: 'スペース' },
    { key: 'area', label: '地区' },
    { key: 'hall', label: 'ホール' },
    { key: 'block', label: 'ブロック' },
    { key: 'number', label: '番号' },
    { key: 'sub', label: '枝番' },
    { key: 'name', label: 'サークル名' },
    { key: 'author', label: '執筆者' },
    { key: 'genre', label: 'ジャンル' },
    { key: 'favorite', label: 'お気に入り' },
    { key: 'favoriteColor', label: '色番号' },
    { key: 'memo', label: 'メモ' },
    { key: 'cutUrl', label: 'カット画像URL' },
    { key: 'detailUrl', label: '詳細URL' },
    { key: 'collectedAt', label: '取得日時' }
  ];

  function escapeCell(v) {
    if (v === undefined || v === null) return '';
    const s = String(v);
    // 先頭が = + - @ のセルは表計算ソフトが数式として解釈するので無害化する。
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  }

  function toCSV(rows, columns) {
    const cols = columns || COLUMNS;
    const head = cols.map((c) => escapeCell(c.label)).join(',');
    const body = rows.map((r) => cols.map((c) => escapeCell(r[c.key])).join(','));
    return '﻿' + [head, ...body].join('\r\n') + '\r\n';
  }

  function toJSON(rows) {
    return JSON.stringify(rows, null, 2);
  }

  /** 巡回リストをそのまま印刷できるテキストにする。 */
  function toRouteText(groups) {
    const out = [];
    for (const g of groups) {
      out.push(`■ ${g.key}  (${g.items.length})`);
      for (const it of g.items) {
        const space = it.space || '（配置未定）';
        const memo = it.memo ? `  // ${it.memo}` : '';
        out.push(`  ${space.padEnd(12, ' ')} ${it.name || ''}${memo}`);
      }
      out.push('');
    }
    return out.join('\r\n');
  }

  root.WCH = root.WCH || {};
  root.WCH.serialize = { COLUMNS, toCSV, toJSON, toRouteText };
})(typeof window !== 'undefined' ? window : globalThis);
