/**
 * 巡回シートのページ。
 *
 * 拡張のページとして動くので chrome.storage が使える＝優先度・予算・お使いメモを
 * その場で書いて保存できる。サイトの上に作った blob ページだとリロードで消えてしまう。
 *
 * データはページを開くたびに取り直す。PC で作って紙に出す使い方なので、
 * 手元に古い状態が残るより毎回新しい方がよい。
 */
(function (root) {
  'use strict';

  const { store, api, build, plan, render } = root.WCH;
  const runtime = (root.browser?.runtime ? root.browser : root.chrome).runtime;
  const $ = (id) => document.getElementById(id);

  const state = {
    items: [],       // 取得した全お気に入り
    groups: [],      // いま表示している分の巡回計画
    leftovers: [],
    geoByArea: null,
    sizeByArea: null,
    eventInfo: null,
    mode: 'all'      // 'all' | 'errand'
  };

  // --- 画面の状態表示 ----------------------------------------------------

  function busy(msg) {
    $('progress').hidden = false;
    $('progress').classList.remove('error');
    $('progressText').textContent = msg;
  }

  function idle() {
    $('progress').hidden = true;
  }

  function fail(msg) {
    $('progress').hidden = false;
    $('progress').classList.add('error');
    $('progressText').textContent = msg;
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

  // --- 表示するぶんを選ぶ ------------------------------------------------

  function visibleItems() {
    let rows = state.items;
    if (state.mode === 'errand') rows = rows.filter((r) => (r.errand || '').trim());

    const min = Number($('optFilter').value) || 0;
    if (min > 0) rows = rows.filter((r) => r.priority > 0 && r.priority <= min);

    return rows;
  }

  /**
   * 表示対象が変わったら巡回順から作り直す。
   * 対象が減れば歩く順番も変わるので、絞ったあとの並びで計算し直さないと意味がない。
   */
  function rebuild() {
    const rows = visibleItems();
    state.groups = plan.buildPlan(rows, { geoByArea: state.geoByArea, sizeByArea: state.sizeByArea });
    state.leftovers = plan.withoutGeo(rows);
    draw();
    updateHeader(rows);
  }

  function draw() {
    const el = $('content');
    if (!state.groups.length && !state.leftovers.length) {
      el.innerHTML = `<div class="empty">${
        state.mode === 'errand'
          ? 'お使いメモを書いたサークルがまだありません。<br>「巡回シート」に戻って、頼まれたものを書き込んでください。'
          : '条件に合うサークルがありません。'
      }</div>`;
      return;
    }
    el.innerHTML = render.renderBody(
      state.groups, state.geoByArea, state.sizeByArea, state.leftovers, options()
    );
    bindInputs();
  }

  function updateHeader(rows) {
    const ev = state.eventInfo || {};
    const days = (ev.days || []).map((d) => `${d.day}日目 ${d.date}(${d.dayOfWeek})`).join(' / ');
    const name = ev.nth ? `コミックマーケット${ev.nth}` : '';

    $('title').textContent = state.mode === 'errand' ? 'お使いリスト' : '巡回シート';

    const n = rows ? rows.length : state.items.length;
    const label = state.mode === 'errand' ? 'お使い' : 'お気に入り';
    $('sub').textContent = [name, days].filter(Boolean).join(' ・ ') + ` ・ ${label} ${n} 件`;

    recalcTotals();
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
    // 手元の items にも反映しておく（絞り込みや再計算がすぐ効くように）
    const it = state.items.find((x) => String(x.wcid) === String(wcid));
    if (it) Object.assign(it, patch);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 400);
  }

  /** 画面上の値から小計と合計を出し直す。 */
  function recalcTotals() {
    let grand = 0;
    const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };

    for (const area of document.querySelectorAll('article.area')) {
      const items = [...area.querySelectorAll('.ci')].map((ci) => ({
        priority: Number(ci.dataset.priority) || 0,
        budget: Number(ci.querySelector('.bg-in')?.value) || 0
      }));
      const sum = render.summarize(items);
      const el = area.querySelector('[data-sum]');
      if (el) el.textContent = render.summaryText(sum);
      grand += sum.budget;
      for (const k of Object.keys(counts)) counts[k] += sum.counts[k];
    }

    const t = render.summaryText({ budget: grand, counts, withBudget: 0 });
    $('total').textContent = t ? `合計 ${t}` : '';

    // 価格が分かっていて、まだ予算を入れていないものが残っていれば埋めるボタンを出す
    const fillable = [...document.querySelectorAll('.bg-in')].filter(
      (i) => Number(i.dataset.suggest) > 0 && !Number(i.value)
    );
    const btn = $('fillBudget');
    btn.hidden = fillable.length === 0;
    if (fillable.length) {
      const sum = fillable.reduce((a, i) => a + Number(i.dataset.suggest), 0);
      btn.textContent = `価格が分かる ${fillable.length} 件の予算を入れる（+${render.yen(sum)}）`;
    }
  }

  /** 頒布物の公開価格を、まだ空の予算欄に入れる。 */
  function fillBudgets() {
    const patch = {};
    for (const inp of document.querySelectorAll('.bg-in')) {
      const s = Number(inp.dataset.suggest) || 0;
      if (!s || Number(inp.value)) continue;
      inp.value = String(s);
      inp.closest('.bg').classList.remove('blank');
      patch[inp.dataset.wcid] = { budget: s };
    }
    if (Object.keys(patch).length) {
      for (const [wcid, p] of Object.entries(patch)) queue(wcid, p);
      flush();
    }
    recalcTotals();
  }

  function bindInputs() {
    for (const el of document.querySelectorAll('.errand .body[contenteditable]')) {
      el.addEventListener('input', () => {
        const text = el.textContent.trim();
        el.closest('.errand').classList.toggle('has', !!text);
        queue(el.dataset.wcid, { errand: text });
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
        // 優先度で絞っている最中に変えたら、並びごと作り直す
        if (Number($('optFilter').value) > 0) rebuild();
        else recalcTotals();
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
  }

  // サークル名を押したら、サイトのそのサークルのところを開く。
  // タブが増え続けないよう、開く先は背景側で1枚に固定している。
  $('content').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-site-link]');
    if (!a) return;
    e.preventDefault();
    runtime.sendMessage({ type: 'open-site', url: a.href, wcid: a.dataset.wcid });
  });

  window.addEventListener('beforeunload', flush);
  window.addEventListener('beforeprint', flush);

  // --- 読み込み ----------------------------------------------------------

  async function load() {
    try {
      busy('お気に入りを読み込んでいます…');
      const settings = await store.loadSettings();
      api.setEventId(settings.eventId);
      $('optLines').value = settings.errandLines ?? 2;

      const { items, eventInfo, geoByArea, sizeByArea } = await build.collect((m) => busy(m));
      if (!items.length) {
        fail('お気に入りが1件もありません。サイトでお気に入りを登録してから開いてください。');
        return;
      }

      busy('通路をたどって巡回順を計算しています…');
      state.items = items;
      state.eventInfo = eventInfo;
      state.geoByArea = geoByArea;
      state.sizeByArea = sizeByArea;

      rebuild();
      idle();
    } catch (e) {
      fail(`読み込めませんでした（${e.message}）。サイトにログインしているか確認してください。`);
    }
  }

  // --- 操作 --------------------------------------------------------------

  for (const b of $('mode').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      if (b.classList.contains('on')) return;
      for (const x of $('mode').querySelectorAll('button')) x.classList.toggle('on', x === b);
      state.mode = b.dataset.mode;
      document.body.classList.toggle('errand-mode', state.mode === 'errand');
      if (state.items.length) rebuild();
    });
  }

  for (const id of ['optMap', 'optBooks', 'optExternals']) {
    $(id).addEventListener('change', () => state.items.length && draw());
  }
  $('optFilter').addEventListener('change', () => state.items.length && rebuild());
  $('optLines').addEventListener('change', async () => {
    await store.saveSettings({ errandLines: Number($('optLines').value) || 0 });
    if (state.items.length) draw();
  });

  $('optToggle').addEventListener('click', () => {
    const opts = $('opts');
    opts.hidden = !opts.hidden;
    $('optToggle').setAttribute('aria-expanded', String(!opts.hidden));
  });

  $('hintClose').addEventListener('click', () => {
    $('hint').hidden = true;
    store.saveSettings({ hintClosed: true });
  });

  $('fillBudget').addEventListener('click', fillBudgets);

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

  store.loadSettings().then((s) => {
    if (s.hintClosed) $('hint').hidden = true;
  });

  load();
})(window);
