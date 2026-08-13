/**
 * ページ上に出す操作パネル。
 * Vuetify のクラスと衝突しないよう、全要素に wch- 接頭辞を付けている。
 */
(function (root) {
  'use strict';

  const { store, collect, bulk, route, serialize, scrape, favorites } = root.WCH;

  let el = null;
  let statusEl = null;
  let countEl = null;

  function h(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) node.appendChild(c);
    return node;
  }

  function status(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  let hintEl = null;

  async function refreshCount() {
    const rows = await store.loadList();
    if (countEl) countEl.textContent = `保存済み ${rows.length} 件 / 画面上 ${collect.cardCount()} 枚`;

    // スペース・執筆者・ジャンル・メモはサイト側の表示モード次第でしか DOM に出ない。
    if (hintEl) {
      const vm = scrape.viewModeInfo();
      if (!vm.columns) {
        hintEl.textContent = '';
        hintEl.classList.add('wch-hidden');
      } else if (!vm.hasDetail) {
        hintEl.textContent =
          'いまはサークル名しか取れません。サイトの「表示設定 → 表示モード」を「詳細」にするとスペース・執筆者・ジャンルも、「メモ」にするとメモも取得できます。';
        hintEl.classList.remove('wch-hidden');
      } else if (!vm.hasMemo) {
        hintEl.textContent = '表示モードを「メモ」にするとメモも取得できます。';
        hintEl.classList.remove('wch-hidden');
      } else {
        hintEl.textContent = '';
        hintEl.classList.add('wch-hidden');
      }
    }
    return rows;
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function btn(label, handler, cls) {
    return h('button', { class: `wch-btn ${cls || ''}`, type: 'button', text: label, onclick: handler });
  }

  // --- 各操作 ------------------------------------------------------------

  async function doAutoCollect(button) {
    if (collect.state.running) {
      collect.stop();
      status('停止を要求しました…');
      return;
    }
    button.textContent = '停止';
    button.classList.add('wch-danger');
    status('自動スクロール収集中…');
    const res = await collect.autoScrollCollect();
    button.textContent = '一覧を最後まで収集';
    button.classList.remove('wch-danger');
    status(res.stopped ? `中断（${res.cards} 枚まで）` : `完了：${res.cards} 枚を走査`);
    refreshCount();
  }

  async function doExportCSV() {
    const rows = await refreshCount();
    if (!rows.length) return status('保存済みデータがありません');
    download(`webcatalog-${stamp()}.csv`, serialize.toCSV(rows), 'text/csv');
    status(`CSV を出力しました（${rows.length} 件）`);
  }

  async function doExportJSON() {
    const rows = await refreshCount();
    if (!rows.length) return status('保存済みデータがありません');
    download(`webcatalog-${stamp()}.json`, serialize.toJSON(rows), 'application/json');
    status(`JSON を出力しました（${rows.length} 件）`);
  }

  async function doRouteSheet(onlyFavorite) {
    const rows = await store.loadList();
    if (!rows.length) return status('保存済みデータがありません');
    const groups = route.buildGroups(rows, { onlyFavorite });
    const n = groups.reduce((a, g) => a + g.items.length, 0);
    if (!n) {
      return status(
        onlyFavorite
          ? 'お気に入りが確定していません。お気に入り一覧のページを開いて収集してください'
          : '条件に合うサークルがありません'
      );
    }
    route.openRouteSheet(groups, onlyFavorite ? '巡回リスト（お気に入り）' : '巡回リスト（全件）');
    status(`巡回リストを新しいタブで開きました（${n} 件）`);
  }

  /** API から取り直して、配置図つきの巡回シートを開く。 */
  async function doSheet(button) {
    const label = button.textContent;
    button.disabled = true;
    try {
      const res = await favorites.openSheet((m) => status(m));
      if (res.error) return status(res.error);
      status(
        `巡回シートを開きました：${res.total} 件 / ${res.areas} エリア` +
          (res.leftovers ? `（配置不明 ${res.leftovers} 件）` : '')
      );
    } catch (e) {
      status(`失敗: ${e.message}`);
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  /** API のお気に入り情報を保存データに取り込む。 */
  async function doSync(button) {
    button.disabled = true;
    try {
      const s = await favorites.syncToStore((m) => status(m));
      status(`API から取込：新規 ${s.added} / 更新 ${s.updated} / 合計 ${s.total}`);
      refreshCount();
    } catch (e) {
      status(`失敗: ${e.message}`);
    } finally {
      button.disabled = false;
    }
  }

  async function doRouteText() {
    const rows = await store.loadList();
    if (!rows.length) return status('保存済みデータがありません');
    const groups = route.buildGroups(rows, {});
    download(`route-${stamp()}.txt`, serialize.toRouteText(groups), 'text/plain');
    status('巡回リストをテキストで出力しました');
  }

  function warnIfUnfiltered(filtered) {
    return filtered
      ? ''
      : '\n\n※ この画面では登録済み／未登録を見分けられなかったため、\n' +
        '　 絞り込みは効かず表示中の全件が対象になります。';
  }

  async function runBulk(progressBtn, label, confirmMsg, fn, resultLabel) {
    if (bulk.state.running) {
      bulk.stop();
      return status('停止を要求しました…');
    }
    if (!window.confirm(confirmMsg)) return;

    progressBtn.textContent = '停止';
    progressBtn.classList.add('wch-danger');

    const res = await fn((p) =>
      status(`${resultLabel} ${p.done}/${p.total}（対象外 ${p.skipped ?? 0} / 失敗 ${p.failed}）`)
    );

    progressBtn.textContent = label;
    progressBtn.classList.remove('wch-danger');
    status(
      `${resultLabel} 完了：実行 ${res.done} / 対象外 ${res.skipped ?? 0} / 失敗 ${res.failed}` +
        (res.stopped ? '（中断）' : '')
    );
    setTimeout(() => collect.collectVisible().then(refreshCount), 800);
  }

  /** 既定色での一括登録・解除。クリック1回で済むので速い。 */
  async function doBulkToggle(scopeSelect, action, progressBtn, label) {
    const scope = scopeSelect.value;
    const { cards: targetCards, filtered } = bulk.targetsDetailed(scope);
    if (!targetCards.length) return status('対象のカードが画面上にありません');

    const verb = action === 'add' ? 'お気に入りに登録' : 'お気に入りから解除';
    await runBulk(
      progressBtn,
      label,
      `画面上の ${targetCards.length} 件を${verb}します。\n` +
        `すでにその状態のカードは触りません。\n` +
        `サイト側を1件ずつ操作するため、途中でページを触らないでください。${warnIfUnfiltered(filtered)}\n\n実行しますか？`,
      (onProgress) => bulk.toggleFavorite({ scope, action, onProgress }),
      verb
    );
  }

  async function doBulkFavoriteColor(scopeSelect, colorSelect, progressBtn) {
    const color = Number(colorSelect.value);
    if (!Number.isFinite(color) || color <= 0) {
      return status('先に「読込」で色を読み取ってください');
    }
    const scope = scopeSelect.value;
    const { cards: targetCards, filtered } = bulk.targetsDetailed(scope);
    if (!targetCards.length) return status('対象のカードが画面上にありません');

    await runBulk(
      progressBtn,
      '色を一括設定',
      `画面上の ${targetCards.length} 件を色 ${color} に設定します。\n` +
        `すでに色 ${color} のカードは触りません（押すと解除になるため）。${warnIfUnfiltered(filtered)}\n\n実行しますか？`,
      (onProgress) => bulk.setFavoriteColor({ scope, color, onProgress }),
      '色設定'
    );
  }

  async function doBulkMemo(scopeSelect, memoInput, modeSelect, progressBtn) {
    const text = memoInput.value.trim();
    const mode = modeSelect.value;
    if (mode !== 'dry' && !text) return status('メモ本文を入力してください');

    const scope = scopeSelect.value;
    const { cards: targetCards, filtered } = bulk.targetsDetailed(scope);
    if (!targetCards.length) return status('対象のカードが画面上にありません');

    const msg =
      mode === 'dry'
        ? `画面上の ${targetCards.length} 件でメモ欄を開けるか試すだけで、書き込みはしません。\n\n実行しますか？`
        : `画面上の ${targetCards.length} 件のメモを「${mode === 'replace' ? '置き換え' : '追記'}」します。\n` +
          `メモ欄はお気に入り登録済みのカードにしか無いため、未登録のカードは自動で飛ばされます。` +
          `${warnIfUnfiltered(filtered)}\n\n実行しますか？`;

    await runBulk(
      progressBtn,
      'メモ一括入力',
      msg,
      (onProgress) => bulk.setMemo({ scope, text, mode, onProgress }),
      mode === 'dry' ? 'メモ試行' : 'メモ入力'
    );
  }

  async function doClear() {
    const rows = await store.loadList();
    if (!rows.length) return status('保存済みデータはすでに空です');
    if (!window.confirm(`保存済み ${rows.length} 件を削除します。よろしいですか？`)) return;
    await store.clear();
    status('保存済みデータを削除しました');
    refreshCount();
  }

  async function fillColorOptions(select) {
    status('色の選択肢を読み取り中…');
    const colors = await bulk.readColorOptions();
    select.innerHTML = '';
    if (!colors.length) {
      select.appendChild(h('option', { value: '0', text: '（読み取れず）' }));
      status('色メニューを読み取れませんでした。カードが表示された状態で再試行してください');
      return;
    }
    for (const c of colors) {
      select.appendChild(h('option', { value: String(c), text: `色 ${c}` }));
    }
    status(`色の選択肢を ${colors.length} 件読み取りました`);
  }

  // --- 組み立て ----------------------------------------------------------

  function build() {
    const scopeSelect = h('select', { class: 'wch-select' }, [
      h('option', { value: 'all', text: '画面上の全件' }),
      h('option', { value: 'unfavorited', text: '未登録のみ' }),
      h('option', { value: 'favorited', text: '登録済みのみ' })
    ]);

    const colorSelect = h('select', { class: 'wch-select' }, [
      h('option', { value: '0', text: '（未読込）' })
    ]);

    const memoInput = h('input', { class: 'wch-input', type: 'text', placeholder: 'メモ本文' });
    const modeSelect = h('select', { class: 'wch-select' }, [
      h('option', { value: 'append', text: '追記' }),
      h('option', { value: 'replace', text: '置換' }),
      h('option', { value: 'dry', text: '試行のみ' })
    ]);

    const collectBtn = btn('一覧を最後まで収集', () => doAutoCollect(collectBtn), 'wch-primary');
    const sheetBtn = btn('配置図つき巡回シートを作る', () => doSheet(sheetBtn), 'wch-primary');
    const syncBtn = btn('お気に入りを API から取込', () => doSync(syncBtn));
    const addBtn = btn('登録', () => doBulkToggle(scopeSelect, 'add', addBtn, '登録'));
    const removeBtn = btn('解除', () => doBulkToggle(scopeSelect, 'remove', removeBtn, '解除'));
    const colorBtn = btn('色を一括設定', () => doBulkFavoriteColor(scopeSelect, colorSelect, colorBtn));
    const memoBtn = btn('メモ一括入力', () => doBulkMemo(scopeSelect, memoInput, modeSelect, memoBtn));

    countEl = h('div', { class: 'wch-count', text: '—' });
    hintEl = h('div', { class: 'wch-hint wch-hidden' });
    statusEl = h('div', { class: 'wch-status', text: '待機中' });

    const body = h('div', { class: 'wch-body' }, [
      countEl,
      hintEl,

      h('div', { class: 'wch-section-title', text: '収集' }),
      h('div', { class: 'wch-row' }, [
        collectBtn,
        btn('画面分だけ取込', async () => {
          const s = await collect.collectVisible();
          status(`取込：新規 ${s.added} / 更新 ${s.updated}`);
          refreshCount();
        })
      ]),

      h('div', { class: 'wch-section-title', text: '出力' }),
      h('div', { class: 'wch-row' }, [btn('CSV', doExportCSV), btn('JSON', doExportJSON)]),

      h('div', { class: 'wch-section-title', text: '巡回シート（配置図つき・PDF可）' }),
      h('div', { class: 'wch-row' }, [sheetBtn]),
      h('div', { class: 'wch-row' }, [syncBtn]),

      h('div', { class: 'wch-section-title', text: '巡回リスト（収集データから・スペース順）' }),
      h('div', { class: 'wch-row' }, [
        btn('お気に入りのみ', () => doRouteSheet(true)),
        btn('全件', () => doRouteSheet(false)),
        btn('テキスト', doRouteText)
      ]),

      h('div', { class: 'wch-section-title', text: '一括操作（画面上のカードが対象）' }),
      h('div', { class: 'wch-row' }, [h('span', { class: 'wch-label', text: '対象' }), scopeSelect]),
      h('div', { class: 'wch-row' }, [
        h('span', { class: 'wch-label', text: '既定色' }),
        addBtn,
        removeBtn
      ]),
      h('div', { class: 'wch-row' }, [
        h('span', { class: 'wch-label', text: '色' }),
        colorSelect,
        btn('読込', () => fillColorOptions(colorSelect), 'wch-mini')
      ]),
      h('div', { class: 'wch-row' }, [colorBtn]),
      h('div', { class: 'wch-row' }, [
        h('span', { class: 'wch-label', text: 'メモ' }),
        memoInput,
        modeSelect
      ]),
      h('div', { class: 'wch-row' }, [memoBtn]),

      h('div', { class: 'wch-section-title', text: '管理' }),
      h('div', { class: 'wch-row' }, [btn('保存データを削除', doClear, 'wch-danger-outline')]),

      statusEl
    ]);

    const header = h('div', { class: 'wch-header' }, [
      h('span', { class: 'wch-title', text: 'WebCatalog Helper' }),
      h('button', {
        class: 'wch-fold',
        type: 'button',
        text: '−',
        title: '折りたたむ',
        onclick: (e) => {
          const folded = el.classList.toggle('wch-folded');
          e.target.textContent = folded ? '+' : '−';
        }
      })
    ]);

    el = h('div', { class: 'wch-panel', id: 'wch-panel' }, [header, body]);
    document.body.appendChild(el);

    collect.onChange((evt) => {
      if (evt.type === 'stats') refreshCount();
    });

    refreshCount();
  }

  function toggle() {
    if (!el) return build();
    el.classList.toggle('wch-hidden');
  }

  function ensure() {
    if (!el) build();
    el.classList.remove('wch-hidden');
  }

  root.WCH.panel = { build, toggle, ensure, status, refreshCount };
})(window);
