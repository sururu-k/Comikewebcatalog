/**
 * カード DOM と API JSON の両方からサークルレコードを組み立てる。
 * どちらも取れた場合は store 側のマージで空でない値が勝つ。
 */
(function (root) {
  'use strict';

  const SEL = root.WCH.sel;
  const space = root.WCH.space;

  function text(el) {
    return el ? (el.textContent || '').trim() : '';
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function detailUrl(wcid) {
    return `https://webcatalog.circle.ms/circle/list?wcid=${encodeURIComponent(wcid)}`;
  }

  // --- お気に入り状態 ----------------------------------------------------

  /**
   * カードのお気に入り状態。
   * 色クラス（text-favorite{N} / text-neutralBase）とハートの形は同じ情報を表すので、
   * 取れた方を使う。どちらも読めなければ undefined。
   *
   * @returns {{favorited:(boolean|undefined), color:(number|undefined)}}
   */
  function favoriteState(card) {
    const btn = card.querySelector(SEL.favButton);
    if (!btn) return { favorited: undefined, color: undefined };

    const cls = btn.className || '';
    const m = cls.match(/text-favorite(\d+)/);
    if (m) return { favorited: true, color: Number(m[1]) };
    if (cls.includes(root.WCH.NEUTRAL_COLOR_CLASS)) return { favorited: false, color: undefined };

    const d = btn.querySelector(SEL.favIconPath)?.getAttribute('d') || '';
    if (d.startsWith(root.WCH.HEART_FILLED_PREFIX)) return { favorited: true, color: undefined };
    if (d.startsWith(root.WCH.HEART_OUTLINE_PREFIX)) return { favorited: false, color: undefined };

    return { favorited: undefined, color: undefined };
  }

  // --- 列の読み取り ------------------------------------------------------

  /**
   * TextWithLabel 1ブロックから本文を取り出す。
   * 構造は <div><div><span class="font-weight-bold">ラベル</span><span>本文</span></div></div>。
   */
  function readTextWithLabel(block) {
    const inner = block.firstElementChild;
    if (!inner) return null;
    const spans = inner.children;
    if (spans.length !== 2) return null;
    if (!spans[0].classList.contains('font-weight-bold')) return null;
    return { label: text(spans[0]), value: text(spans[1]) };
  }

  /**
   * card-text.information に並ぶ列を読む。
   *
   * 列はサイト側の表示モードで増減し、順番は
   * サークル名 → 執筆者 → スペース → ジャンル → メモ で固定。
   * ラベルは既定で非表示なので、まずラベルがあればそれで判別し、
   * 無ければスペースらしい書式の列を軸にして前後を執筆者・ジャンルに割り当てる。
   */
  function readColumns(card) {
    const info = card.querySelector(SEL.info);
    const out = {};
    if (!info) return out;

    out.memo = text(info.querySelector(SEL.memo));

    const blocks = [];
    for (const child of info.children) {
      const parsed = readTextWithLabel(child) || readTextWithLabel(child.firstElementChild || child);
      if (!parsed) continue;
      blocks.push({ el: child, isName: child.classList.contains('circle-name'), ...parsed });
    }

    const nameBlock = blocks.find((b) => b.isName);
    if (nameBlock) out.name = nameBlock.value;

    const rest = blocks.filter((b) => !b.isName);
    if (!rest.length) return out;

    // ラベルが出ている設定ならそれが一番確実。
    let labelled = false;
    for (const b of rest) {
      if (!b.label) continue;
      if (b.label.includes('執筆') || b.label.includes('作者')) { out.author = b.value; labelled = true; }
      else if (b.label.includes('スペース') || b.label.includes('配置')) { out.space = b.value; labelled = true; }
      else if (b.label.includes('ジャンル')) { out.genre = b.value; labelled = true; }
    }
    if (labelled) return out;

    // ラベルなし。スペース書式の列を探して基準にする。
    const looksLikeSpace = (v) => {
      if (!v) return false;
      const p = space.parse(v);
      return p.area !== undefined || (p.block !== undefined && p.number !== undefined);
    };

    const spaceIdx = rest.findIndex((b) => looksLikeSpace(b.value));
    if (spaceIdx >= 0) {
      out.space = rest[spaceIdx].value;
      if (spaceIdx > 0) out.author = rest[spaceIdx - 1].value;
      if (spaceIdx + 1 < rest.length) out.genre = rest[spaceIdx + 1].value;
      return out;
    }

    // スペースが未公開だと空文字で出るため書式では見つからない。
    // その場合は既定の並び（執筆者・スペース・ジャンル）にそのまま当てる。
    if (rest.length >= 3) {
      out.author = rest[0].value;
      out.space = rest[1].value;
      out.genre = rest[2].value;
    } else if (rest.length === 1) {
      out.author = rest[0].value;
    }
    return out;
  }

  /** カード1枚 → レコード。 */
  function fromCard(el) {
    const wcid = el.getAttribute(SEL.cardId);
    if (!wcid) return null;

    const cols = readColumns(el);
    const parsed = space.parse(cols.space || '');
    const fav = favoriteState(el);

    const img = el.querySelector(SEL.image);
    let cutUrl = img?.getAttribute('src') || '';
    if (cutUrl && !/^https?:/i.test(cutUrl)) {
      try {
        cutUrl = new URL(cutUrl, location.origin).href;
      } catch (_) {}
    }

    return {
      wcid: String(wcid),
      name: cols.name,
      author: cols.author,
      genre: cols.genre,
      space: cols.space || '',
      area: parsed.area,
      hall: parsed.hall,
      block: parsed.block,
      number: parsed.number,
      sub: parsed.sub,
      memo: cols.memo,
      // 未登録と判定できたときは 'なし' を入れる。判定不能なら空にして既存値を残す。
      favorite: fav.favorited === true ? 'あり' : fav.favorited === false ? 'なし' : '',
      favoriteColor: fav.color,
      hasUpdate: el.querySelector(SEL.updateDot) ? 'あり' : '',
      cutUrl,
      detailUrl: detailUrl(wcid),
      collectedAt: nowISO()
    };
  }

  /** 現在 DOM 上にあるカードを全部読む。 */
  function scrapeVisible() {
    return Array.from(document.querySelectorAll(SEL.card)).map(fromCard).filter(Boolean);
  }

  /**
   * 表示モードの推定。スペース等が取れる設定になっているかをパネルに出すため。
   * @returns {{columns:number, hasDetail:boolean, hasMemo:boolean}}
   */
  function viewModeInfo() {
    const card = document.querySelector(SEL.card);
    if (!card) return { columns: 0, hasDetail: false, hasMemo: false };
    const info = card.querySelector(SEL.info);
    if (!info) return { columns: 0, hasDetail: false, hasMemo: false };

    let columns = 0;
    for (const child of info.children) {
      if (readTextWithLabel(child) || readTextWithLabel(child.firstElementChild || child)) columns++;
    }
    return {
      columns,
      hasDetail: columns >= 4,
      hasMemo: !!info.querySelector(SEL.memo)
    };
  }

  // --- API JSON 側 -------------------------------------------------------

  const FIELD_ALIASES = {
    name: ['name', 'circleName'],
    author: ['writer', 'penName', 'author'],
    genre: ['genreName', 'genre'],
    space: ['spaceName', 'space', 'spaceNo'],
    memo: ['memo', 'favoriteMemo'],
    day: ['day', 'dayNo'],
    favoriteColor: ['favoriteColor', 'color']
  };

  function pick(obj, keys) {
    for (const k of keys) {
      const v = obj[k];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  }

  function collectCircleObjects(node, out, depth) {
    if (node === null || typeof node !== 'object' || depth > 8) return out;
    if (Array.isArray(node)) {
      for (const v of node) collectCircleObjects(v, out, depth + 1);
      return out;
    }
    if ('wcid' in node && (typeof node.wcid === 'number' || typeof node.wcid === 'string')) {
      out.push(node);
    }
    for (const v of Object.values(node)) collectCircleObjects(v, out, depth + 1);
    return out;
  }

  function fromApi(data) {
    const objs = collectCircleObjects(data, [], 0);
    const seen = new Set();
    const rows = [];

    for (const o of objs) {
      const wcid = String(o.wcid);
      if (!wcid || seen.has(wcid)) continue;
      seen.add(wcid);

      const spaceRaw = String(pick(o, FIELD_ALIASES.space) ?? '');
      const parsed = space.parse(spaceRaw);
      const color = pick(o, FIELD_ALIASES.favoriteColor);

      rows.push({
        wcid,
        name: pick(o, FIELD_ALIASES.name),
        author: pick(o, FIELD_ALIASES.author),
        genre: pick(o, FIELD_ALIASES.genre),
        space: spaceRaw,
        area: parsed.area,
        hall: parsed.hall,
        block: parsed.block,
        number: parsed.number,
        sub: parsed.sub,
        day: pick(o, FIELD_ALIASES.day),
        memo: pick(o, FIELD_ALIASES.memo),
        favoriteColor: typeof color === 'number' ? color : undefined,
        detailUrl: detailUrl(wcid),
        collectedAt: nowISO()
      });
    }
    return rows;
  }

  root.WCH.scrape = {
    scrapeVisible,
    fromCard,
    fromApi,
    detailUrl,
    favoriteState,
    readColumns,
    viewModeInfo
  };
})(window);
