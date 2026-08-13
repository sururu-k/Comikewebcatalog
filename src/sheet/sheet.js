/**
 * 巡回シートのページ。
 *
 * 拡張のページとして動くので、chrome.storage が使える＝お使いメモをその場で書いて
 * 保存できる。サイトの上に作った blob ページだとリロードで消えてしまうため、
 * ここに独立させている。
 *
 * データはページを開くたびに API から取り直す（PC で作って紙に出す使い方なので、
 * 手元に古い状態が残るより毎回新しい方が良い）。
 */
(function (root) {
  'use strict';

  const { store, api, build, plan, render } = root.WCH;
  const $ = (id) => document.getElementById(id);

  const state = { groups: [], leftovers: [], geoByArea: null, sizeByArea: null, eventInfo: null };

  function progress(msg, cls) {
    const el = $('progress');
    el.textContent = msg;
    el.className = 'progress' + (cls ? ' ' + cls : '');
  }

  function options() {
    return {
      showMap: $('optMap').checked,
      showBooks: $('optBooks').checked,
      showExternals: $('optExternals').checked,
      errandLines: Number($('optLines').value) || 0,
      editable: true
    };
  }

  function draw() {
    $('content').innerHTML = render.renderBody(
      state.groups,
      state.geoByArea,
      state.sizeByArea,
      state.leftovers,
      options()
    );
    bindInputs();
  }

  // --- 書き込みの保存（お使いメモ・優先度・予算） ------------------------

  let pending = {};
  let timer = null;

  function flush() {
    const batch = pending;
    pending = {};
    timer = null;
    if (Object.keys(batch).length) store.setNotes(batch);
  }

  function queue(wcid, patch) {
    pending[wcid] = { ...(pending[wcid] || {}), ...patch };
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 400);
  }

  /** 画面上の値から、そのエリアの合計を出し直す。 */
  function recalcTotals() {
    let grand = 0;
    const grandCounts = { 1: 0, 2: 0, 3: 0, 0: 0 };

    for (const area of document.querySelectorAll('article.area')) {
      const items = [...area.querySelectorAll('.ci')].map((ci) => ({
        priority: Number(ci.dataset.priority) || 0,
        budget: Number(ci.querySelector('.bg-in')?.value) || 0
      }));
      const sum = render.summarize(items);
      area.querySelector('[data-sum]').textContent = render.summaryText(sum);
      grand += sum.budget;
      for (const k of Object.keys(grandCounts)) grandCounts[k] += sum.counts[k];
    }

    const total = render.summaryText({ budget: grand, counts: grandCounts, withBudget: 0 });
    $('total').textContent = total ? `合計 ${total}` : '';
  }

  function bindInputs() {
    for (const el of document.querySelectorAll('.errand .body[contenteditable]')) {
      const wcid = el.dataset.wcid;
      el.addEventListener('input', () => {
        const text = el.textContent.trim();
        el.closest('.errand').classList.toggle('has', !!text);
        queue(wcid, { errand: text });
      });
      el.addEventListener('blur', flush);
    }

    for (const sel of document.querySelectorAll('.pri-sel')) {
      sel.addEventListener('change', () => {
        const v = Number(sel.value) || 0;
        const wrap = sel.closest('.pri');
        wrap.className = `pri p${v}`;
        wrap.dataset.mark = store.PRIORITIES.find((p) => p.value === v)?.mark || '';
        sel.closest('.ci').dataset.priority = v;
        queue(sel.dataset.wcid, { priority: v });
        flush();
        recalcTotals();
        applyFilter();
      });
    }

    for (const inp of document.querySelectorAll('.bg-in')) {
      inp.addEventListener('input', () => {
        const v = Number(inp.value) || 0;
        inp.closest('.bg').classList.toggle('blank', !v);
        queue(inp.dataset.wcid, { budget: v });
        recalcTotals();
      });
      inp.addEventListener('blur', flush);
    }

    recalcTotals();
    applyFilter();
  }

  /** 優先度での絞り込み。紙に出す前に「◎だけ」に減らせるようにする。 */
  function applyFilter() {
    const min = Number($('optFilter').value) || 0;
    for (const ci of document.querySelectorAll('.ci')) {
      const p = Number(ci.dataset.priority) || 0;
      // min=0 は全部、min=1 は◎のみ、2 は◎○、3 は◎○△（未設定を除く）
      ci.classList.toggle('hidden', min > 0 && (p === 0 || p > min));
    }
    // 中身が全部隠れた島とエリアも隠す
    for (const island of document.querySelectorAll('section.island')) {
      island.classList.toggle('hidden', !island.querySelector('.ci:not(.hidden)'));
    }
    for (const area of document.querySelectorAll('article.area')) {
      area.classList.toggle('hidden', !area.querySelector('.ci:not(.hidden)'));
    }
  }

  // 書きかけを取りこぼさないよう、閉じる前と印刷前に確実に書き出す。
  window.addEventListener('beforeunload', flush);
  window.addEventListener('beforeprint', flush);

  // --- 読み込み ----------------------------------------------------------

  async function load() {
    try {
      progress('お気に入りを取得中…');
      const settings = await store.loadSettings();
      api.setEventId(settings.eventId);
      $('optLines').value = settings.errandLines ?? 2;

      const { items, eventInfo, geoByArea, sizeByArea } = await build.collect((m) => progress(m));
      if (!items.length) {
        progress('お気に入りが1件もありません。', 'error');
        return;
      }

      progress('巡回順を計算中…');
      state.groups = plan.buildPlan(items);
      state.leftovers = plan.withoutGeo(items);
      state.geoByArea = geoByArea;
      state.sizeByArea = sizeByArea;
      state.eventInfo = eventInfo;

      const total = state.groups.reduce((a, g) => a + g.stats.circles, 0);
      const days = (eventInfo.days || []).map((d) => `${d.day}日目 ${d.date}(${d.dayOfWeek})`).join(' / ');
      $('sub').textContent =
        [eventInfo.nth ? `コミックマーケット${eventInfo.nth}` : '', days].filter(Boolean).join(' ・ ') +
        ` ・ お気に入り ${total} 件 ・ ${state.groups.length} エリア` +
        (state.leftovers.length ? `（配置不明 ${state.leftovers.length} 件）` : '');

      draw();
      progress('', 'done');
    } catch (e) {
      progress(`取得に失敗しました: ${e.message}　サイトにログインしているか確認してください。`, 'error');
    }
  }

  // --- 操作 --------------------------------------------------------------

  for (const id of ['optMap', 'optBooks', 'optExternals']) {
    $(id).addEventListener('change', () => state.groups.length && draw());
  }
  $('optFilter').addEventListener('change', applyFilter);
  $('optLines').addEventListener('change', async () => {
    await store.saveSettings({ errandLines: Number($('optLines').value) || 0 });
    if (state.groups.length) draw();
  });
  $('reload').addEventListener('click', () => {
    build.cache.circles = null;
    build.cache.eventInfo = null;
    build.cache.geo.clear();
    load();
  });
  $('print').addEventListener('click', () => {
    flush();
    window.print();
  });

  load();
})(window);
