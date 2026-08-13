/**
 * サークル一覧・詳細に出てくる情報の取り出し。
 *
 * 詳細ダイアログは別 API を呼んでおらず、/api/v3/Circle/Search が返す1レコードに
 * 表示に必要なものが全部入っている（実際に詳細を開いてネットワークを見て確認した）。
 * ここではその生レコードから、保存・印刷に使う形へ均す。
 *
 * 実データ 300 件での充足率:
 *   name / day / block / space / hallNumber / genre / circleImages / location  … 全件
 *   webCircleImages 299 ・ writer 294 ・ externalNewImages 266
 *   publishingBookInfos 94 ・ promotionalImages 45 ・ movies 0
 */
(function (root) {
  'use strict';

  const BASE = 'https://webcatalog.circle.ms';

  // externalNewImages の serviceId。バンドルの列挙と実データの linkUrl から対応させた。
  const SERVICES = {
    1: 'pixiv',
    2: 'ニコニコ',
    3: 'Clip Studio',
    5: 'とらのあな',
    6: 'メロンブックス',
    7: 'DLsite',
    8: '書店'
  };

  function abs(u) {
    if (!u) return '';
    return /^https?:/i.test(u) ? u : BASE + u;
  }

  function serviceName(id, linkUrl) {
    if (SERVICES[id]) return SERVICES[id];
    const host = (() => {
      try {
        return new URL(linkUrl).hostname;
      } catch (_) {
        return '';
      }
    })();
    if (/melonbooks/.test(host)) return 'メロンブックス';
    if (/dlsite/.test(host)) return 'DLsite';
    if (/pximg|pixiv/.test(host)) return 'pixiv';
    if (/toranoana/.test(host)) return 'とらのあな';
    return host || `service${id}`;
  }

  /** 頒布物（お品書き）。セット商品も個別本も同じ配列に入っている。 */
  function books(circle) {
    return (circle.publishingBookInfos || [])
      .slice()
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .map((b) => ({
        name: b.magazineName || '',
        genre: b.genre || '',
        size: b.size || '',
        pages: b.page ?? null,
        isNew: !!b.isNew,
        r18: !!(b.coverImage && b.coverImage.r18),
        description: b.description || '',
        tags: b.tags || []
      }));
  }

  /** 書店・pixiv などの外部の新着。 */
  function externals(circle) {
    return (circle.externalNewImages || []).map((e) => ({
      service: serviceName(e.serviceId, e.linkUrl),
      caption: e.caption || '',
      linkUrl: e.linkUrl || '',
      imageUrl: e.imageUrl || '',
      ageLimit: e.ageLimit ?? null
    }));
  }

  function cutUrls(circle) {
    return {
      cut: (circle.circleImages || []).map((i) => abs(i.image_url)).filter(Boolean),
      webCut: (circle.webCircleImages || []).map((i) => abs(i.image_url)).filter(Boolean)
    };
  }

  /**
   * 保存用のまとまった形にする。
   * @param {object} circle  Circle/Search の1レコード
   * @param {Map<string,string>} [genreNames]  ジャンルコード → 名前
   */
  function normalize(circle, genreNames) {
    const bs = books(circle);
    const ex = externals(circle);
    const imgs = cutUrls(circle);

    return {
      wcid: String(circle.wcid),
      circlemsId: circle.circlemsId,
      name: circle.name || '',
      writer: circle.writer || '',
      day: circle.day || '',
      block: circle.block || '',
      space: circle.space || '',
      hallNumber: circle.hallNumber || '',
      location: circle.location || '',
      genreCode: circle.genre || '',
      genreName: genreNames?.get(String(circle.genre)) || '',
      is2SP: !!circle.is2SP,
      isMain: !!circle.isMain,
      geoKeys: circle.geoKeys || [],
      rankingScore: circle.rankingScore ?? null,
      lastUpdateAt: circle.lastUpdateAt || '',
      books: bs,
      hasNewBook: bs.some((b) => b.isNew),
      tags: [...new Set(bs.flatMap((b) => b.tags))],
      externals: ex,
      cutUrl: imgs.cut[0] || '',
      cutUrls: imgs.cut,
      webCutUrls: imgs.webCut,
      promotionalCount: (circle.promotionalImages || []).length,
      movieCount: (circle.movies || []).length
    };
  }

  /** ジャンルコード → 名前 の表。eventInfo.genre から作る。 */
  function genreIndex(eventInfo) {
    const m = new Map();
    for (const g of eventInfo?.genre || []) m.set(String(g.code), g.name);
    return m;
  }

  // --- 表示・書き出し用の平たい文字列 ------------------------------------

  function booksText(d, sep = ' / ') {
    return (d.books || [])
      .map((b) => {
        const bits = [b.name];
        if (b.size || b.pages) bits.push(`${b.size || ''}${b.pages ? `${b.pages}p` : ''}`.trim());
        if (b.isNew) bits.push('新刊');
        return bits.filter(Boolean).join(' ');
      })
      .join(sep);
  }

  function externalsText(d, sep = ' / ') {
    return (d.externals || []).map((e) => `${e.service}:${e.caption || e.linkUrl}`).join(sep);
  }

  root.WCH = root.WCH || {};
  root.WCH.detail = {
    SERVICES,
    abs,
    books,
    externals,
    cutUrls,
    normalize,
    genreIndex,
    booksText,
    externalsText
  };
})(typeof window !== 'undefined' ? window : globalThis);
