/**
 * スペース番号のパースと並べ替え。
 *
 * Webカタログのカード上では "東7 あ-01a" / "西1ホール ア01b" / "南3 A-12a" のような
 * 表記ゆれがあり、配置未公開のあいだは空文字になる。どの形でも壊れないよう
 * 「取れたところまで」を返し、取れなかった要素は undefined にしておく。
 */
(function (root) {
  'use strict';

  // 地区の並び順。カタログ・当日パンフの掲載順に合わせている。
  const AREA_ORDER = ['東', '西', '南', '北', '企業'];

  const HIRAGANA = 'あいうえおかがきぎくぐけげこごさざしじすずせぜそぞただちぢつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもやゆよらりるれろわをん';
  const KATAKANA = 'アイウエオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモヤユヨラリルレロワヲン';

  /**
   * 全角英数と全角ハイフン・全角空白を半角に寄せる。
   * 仮名は変換範囲(！-～)の外なので巻き込まれない。
   */
  function toHalfWidth(s) {
    return String(s)
      .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/　/g, ' ');
  }

  /**
   * ブロック記号を整列用の数値に変換する。
   * 同じ島がカタカナ表記で出てくることがあるので、カナは五十音の同じ位置に寄せる。
   * 仮名 < ラテン の順。
   */
  function blockRank(block) {
    if (!block) return Number.MAX_SAFE_INTEGER;
    const head = block[0];

    const hi = HIRAGANA.indexOf(head);
    if (hi >= 0) return hi;

    const ki = KATAKANA.indexOf(head);
    if (ki >= 0) return ki;

    if (/[A-Za-z]/.test(head)) return 2000 + head.toUpperCase().charCodeAt(0);

    return 3000 + head.charCodeAt(0);
  }

  function areaRank(area) {
    if (!area) return AREA_ORDER.length;
    const i = AREA_ORDER.indexOf(area);
    return i >= 0 ? i : AREA_ORDER.length;
  }

  /**
   * "東7 あ-01a" 等をゆるく分解する。
   * @returns {{raw:string, area?:string, hall?:number, block?:string, number?:number, sub?:string}}
   */
  function parse(text) {
    const raw = (text || '').trim();
    if (!raw) return { raw: '' };

    const s = toHalfWidth(raw).replace(/\s+/g, ' ');
    const out = { raw };

    const area = s.match(/[東西南北]|企業/);
    if (area) out.area = area[0];

    const hall = s.match(/(?:[東西南北]\s*)(\d+)/);
    if (hall) out.hall = Number(hall[1]);

    // ブロック記号 + 番号 + 枝番。ハイフン類・空白は任意。
    // 「東7」の 7 をブロックと誤読しないよう、地区表記はここまでで取り除いておく。
    const body = s
      .replace(/[東西南北]\s*\d*\s*(?:ホール)?/, ' ')
      .match(/([ぁ-んァ-ヶA-Za-z]{1,2})\s*[-‐‑–—ー－]?\s*(\d{1,3})\s*([abAB])?/);
    if (body) {
      out.block = body[1];
      out.number = Number(body[2]);
      if (body[3]) out.sub = body[3].toLowerCase();
    }

    return out;
  }

  /**
   * 巡回順の比較関数。配置未公開（パース不能）のものは末尾に寄せる。
   */
  function compare(a, b) {
    const pa = a && a.raw !== undefined ? a : parse(a);
    const pb = b && b.raw !== undefined ? b : parse(b);

    const emptyA = !pa.raw;
    const emptyB = !pb.raw;
    if (emptyA !== emptyB) return emptyA ? 1 : -1;
    if (emptyA && emptyB) return 0;

    return (
      areaRank(pa.area) - areaRank(pb.area) ||
      (pa.hall ?? 99) - (pb.hall ?? 99) ||
      blockRank(pa.block) - blockRank(pb.block) ||
      (pa.number ?? 9999) - (pb.number ?? 9999) ||
      (pa.sub || '').localeCompare(pb.sub || '') ||
      pa.raw.localeCompare(pb.raw, 'ja')
    );
  }

  /** 島（地区+ホール+ブロック）単位のグループキー。巡回リストの見出しに使う。 */
  function islandKey(parsed) {
    const p = parsed && parsed.raw !== undefined ? parsed : parse(parsed);
    if (!p.raw) return '配置未定・不明';
    const area = p.area || '';
    const hall = p.hall != null ? String(p.hall) : '';
    const block = p.block || '';
    const key = `${area}${hall} ${block}`.trim();
    return key || p.raw;
  }

  root.WCH = root.WCH || {};
  root.WCH.space = { parse, compare, islandKey, blockRank, areaRank, AREA_ORDER };
})(typeof window !== 'undefined' ? window : globalThis);
