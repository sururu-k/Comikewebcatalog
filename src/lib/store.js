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

  const DEFAULT_SETTINGS = {
    autoCollect: true,      // 表示されたカードを黙って拾い続ける
    scrollStepMs: 700,      // 自動スクロールの待ち時間
    scrollMaxIdle: 3,       // 新着0がこの回数続いたら終了
    bulkIntervalMs: 450,    // 一括操作の1件あたり待ち時間
    bulkMaxItems: 300       // 一括操作の安全上限
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
    DEFAULT_SETTINGS,
    loadAll,
    loadList,
    upsert,
    clear,
    loadSettings,
    saveSettings
  };
})(typeof window !== 'undefined' ? window : globalThis);
