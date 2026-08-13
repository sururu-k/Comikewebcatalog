/**
 * ページ側 DOM に依存する箇所をここに集約する。
 * サイト側の更新でカードの構造が変わったら、まずこのファイルだけ直せば済むようにしてある。
 *
 * 以下は 2026-08 時点の配信バンドル（Nuxt 3 / Vue 3 / Vuetify 3）を読んで確認した内容。
 * 該当コンポーネントは AtomsTextWithLabel / MoleculesMenuFavorite /
 * AtomsFavoriteColorPicker / MoleculesListCardCircleFavoriteMemo。
 *
 * ■ カード
 *
 *   <div class="circle-web-view …" data-webcatalog-wcid="23016323">
 *     <span class="circle-update-dot">                  更新あり（activityMode 時のみ）
 *     <div class="card-item el-hover" role="button">     ← クリックで詳細、右クリックでお気に入りメニュー
 *       <div class="circle-web-view-favorite"> <button class="… menu-favorite">
 *       <div class="circle-image-list"> <img class="circle-image native-cut-image">
 *     <div class="card-text information">                ← ここに列が並ぶ（下記）
 *
 * ■ card-text.information に並ぶ列（TextWithLabel の連なり）
 *
 * TextWithLabel はこう描画される:
 *   <div class="(circle-name など)"><div>
 *     <span class="font-weight-bold text-subtitle-1 mr-2 text-medium-emphasis">ラベル</span>
 *     <span class="text-on-surface single-line">本文</span>
 *   </div></div>
 *
 * 並ぶ順番は固定で、表示モード(viewMode)によって出る列が決まる:
 *
 *   web (既定)     … サークル名のみ
 *   detail         … サークル名 / 執筆者 / スペース / ジャンル
 *   favoriteMemo   … detail + メモ
 *   book           … 列なし（カットのみ）
 *
 * ラベルは既定でどのモードでも非表示（listColumnName_show=false）なので、
 * 列の判別はラベル文字列ではなく「並び順」で行う必要がある。
 *
 * ■ お気に入りの状態（重要）
 *
 * MenuFavorite はボタンの色とアイコンをこう出し分けている:
 *
 *   color = favorite.color が undefined なら "neutralBase"、あれば `favorite{N}`
 *   icon  = favorite.color が undefined なら輪郭ハート、あれば塗りハート
 *
 * つまり Vuetify のクラスとして
 *   登録済み … class="… text-favorite{N} …" かつ 塗りハート
 *   未登録   … class="… text-neutralBase …" かつ 輪郭ハート
 * となり、どちらの属性でも判定できる。
 *
 * ■ お気に入りメニュー（色とメモ）
 *
 * メニューは open-on-click=false で、**左クリックでは開かない**。
 * 左クリックはその場でお気に入りを付け外しするトグルなので注意
 * （未登録なら既定色で登録、登録済みで既定色と同じなら解除）。
 * 開くのは長押しか contextmenu（右クリック）。
 *
 * 開いたメニューの中身:
 *   .favorite-color-icon  … 色ごとのボタン。class の text-favorite{N} がその色番号。
 *                            押すと changeFavorite(N, いま同じ色か) が走るので、
 *                            すでにその色のカードを押すと「解除」になる。
 *   textarea (label=Memo) … メモ。blur で保存される。お気に入り登録済みのときだけ出る。
 *
 * ■ ページング
 *
 * ページャは無く、末尾の .reveal-sentinel が可視域に入ると次が継ぎ足される無限スクロール。
 */
(function (root) {
  'use strict';

  const SEL = {
    // 収集
    card: '[data-webcatalog-wcid]',
    cardId: 'data-webcatalog-wcid',
    info: '.card-text.information',
    name: '.circle-name',
    memo: '.memo-row',
    image: 'img.circle-image',
    updateDot: '.circle-update-dot',
    cardBody: '.card-item',

    // TextWithLabel の中身
    labelSpan: 'span.font-weight-bold',

    // お気に入り
    favButton: 'button.menu-favorite',
    favIconPath: 'svg path',
    favMenu: '.menu-favorite-card-root',
    favColorIcon: '.favorite-color-icon',
    favMemoInput: 'textarea',
    favOverlay: '.v-overlay--active',

    // ページング
    sentinel: '.reveal-sentinel',
    listContainer: '.page-content'
  };

  /** mdiHeart（塗り）＝登録済み / mdiHeartOutline（輪郭）＝未登録。 */
  const HEART_FILLED_PREFIX = 'M12,21.35';
  const HEART_OUTLINE_PREFIX = 'M12.1,18.55';

  /** 未登録のときにボタンへ付く色クラス。 */
  const NEUTRAL_COLOR_CLASS = 'text-neutralBase';

  /** 一覧ページかどうか。詳細ダイアログ等でも一覧 DOM は残るので緩めに見る。 */
  function isListPage() {
    return document.querySelector(SEL.card) !== null;
  }

  root.WCH = root.WCH || {};
  root.WCH.sel = SEL;
  root.WCH.HEART_FILLED_PREFIX = HEART_FILLED_PREFIX;
  root.WCH.HEART_OUTLINE_PREFIX = HEART_OUTLINE_PREFIX;
  root.WCH.NEUTRAL_COLOR_CLASS = NEUTRAL_COLOR_CLASS;
  root.WCH.isListPage = isListPage;
})(window);
