/**
 * 収集済みサークルの保管。chrome.storage.local に wcid をキーとした辞書で持つ。
 *
 * ページを跨いでも積み上がるようにマージ方式。あとから取れた項目
 * （配置公開後のスペース番号など）は上書きし、空値では既存を消さない。
 */
(function (root) {
  'use strict';

  const api = root.browser?.storage ? root.browser : root.chrome;
  const KEY = 'wch.circles';
  const SETTINGS_KEY = 'wch.settings';
  const ERRAND_KEY = 'wch.errands';

  const DEFAULT_SETTINGS = {
    autoCollect: true,      // 表示されたカードを黙って拾い続ける
    scrollStepMs: 700,      // 自動スクロールの待ち時間
    scrollMaxIdle: 3,       // 新着0がこの回数続いたら終了
    bulkIntervalMs: 450,    // 一括操作の1件あたり待ち時間
    bulkMaxItems: 300,      // 一括操作の安全上限
    eventId: '230',         // サイトから拾えたら上書きされる
    errandLines: 2          // お使いメモが空のとき、手書き用に引く罫線の本数
  };

  function get(key, fallback) {
    return new Promise((resolve) => {
      api.storage.local.get({ [key]: fallback }, (o) => resolve(o[key]));
    });
  }

  function set(key, value) {
    return new Promise((resolve) => {
      api.storage.local.set({ [key]: value }, () => resolve());
    });
  }

  async function loadAll() {
    return await get(KEY, {});
  }

  async function loadList() {
    const map = await loadAll();
    return Object.values(map);
  }

  /** 空文字・undefined で既存値を潰さないマージ。 */
  function mergeRecord(prev, next) {
    const out = { ...prev };
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === null || v === '') continue;
      out[k] = v;
    }
    return out;
  }

  /**
   * @returns {{added:number, updated:number, total:number}}
   */
  async function upsert(records) {
    if (!records.length) {
      const map = await loadAll();
      return { added: 0, updated: 0, total: Object.keys(map).length };
    }
    const map = await loadAll();
    let added = 0;
    let updated = 0;
    for (const rec of records) {
      if (!rec || !rec.wcid) continue;
      const id = String(rec.wcid);
      if (map[id]) {
        const merged = mergeRecord(map[id], rec);
        if (JSON.stringify(merged) !== JSON.stringify(map[id])) updated++;
        map[id] = merged;
      } else {
        map[id] = rec;
        added++;
      }
    }
    await set(KEY, map);
    return { added, updated, total: Object.keys(map).length };
  }

  async function clear() {
    await set(KEY, {});
  }

  // --- 自分用のメモ（お使い・優先度・予算） -------------------------------
  //
  // サイト側のお気に入りメモとは別に、拡張の中だけで持つ欄。
  // 「誰に頼まれた」「何を何冊」を書くお使いメモ、回る順を決めるための優先度、
  // いくら使う見込みかの予算を、wcid をキーにまとめて持つ。
  //
  // 頒布物の価格はサイトが公開していない（API の priceDisplay が false）ので、
  // 金額は自分で入れる前提。
  //
  //   { "23004131": { errand: "○○さんに2冊", priority: 1, budget: 3000 } }

  const PRIORITIES = [
    { value: 0, label: '—', mark: '' },
    { value: 1, label: '高', mark: '◎' },
    { value: 2, label: '中', mark: '○' },
    { value: 3, label: '低', mark: '△' }
  ];

  function cleanNote(n) {
    const out = {};
    const errand = (n.errand || '').trim();
    const priority = Number(n.priority) || 0;
    const budget = Number(n.budget) || 0;
    if (errand) out.errand = errand;
    if (priority) out.priority = priority;
    if (budget > 0) out.budget = budget;
    return out;
  }

  async function loadNotes() {
    return await get(ERRAND_KEY, {});
  }

  async function getNote(wcid) {
    const all = await loadNotes();
    return all[String(wcid)] || {};
  }

  /** 渡した項目だけを差し替える。空になった項目は消す。 */
  async function setNotes(map) {
    const all = await loadNotes();
    for (const [wcid, patch] of Object.entries(map)) {
      const id = String(wcid);
      const merged = cleanNote({ ...(all[id] || {}), ...patch });
      if (Object.keys(merged).length) all[id] = merged;
      else delete all[id];
    }
    await set(ERRAND_KEY, all);
    return all;
  }

  async function setNote(wcid, patch) {
    return await setNotes({ [wcid]: patch });
  }

  async function clearNotes() {
    await set(ERRAND_KEY, {});
  }

  async function loadSettings() {
    const s = await get(SETTINGS_KEY, {});
    return { ...DEFAULT_SETTINGS, ...s };
  }

  async function saveSettings(patch) {
    const cur = await loadSettings();
    const next = { ...cur, ...patch };
    await set(SETTINGS_KEY, next);
    return next;
  }

  root.WCH = root.WCH || {};
  root.WCH.store = {
    KEY,
    ERRAND_KEY,
    DEFAULT_SETTINGS,
    loadAll,
    loadList,
    upsert,
    clear,
    PRIORITIES,
    loadNotes,
    getNote,
    setNote,
    setNotes,
    clearNotes,
    loadSettings,
    saveSettings
  };
})(typeof window !== 'undefined' ? window : globalThis);
