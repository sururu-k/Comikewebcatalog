(function (root) {
  'use strict';

  const api = root.browser?.runtime ? root.browser : root.chrome;
  const { store, serialize } = root.WCH;

  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');

  function status(msg) {
    statusEl.textContent = msg;
  }

  function activeTab() {
    return new Promise((resolve) => {
      api.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
    });
  }

  /** content script への送信。一覧タブ以外なら null を返す。 */
  async function send(message) {
    const tab = await activeTab();
    if (!tab || !/^https:\/\/webcatalog\.circle\.ms\//.test(tab.url || '')) {
      $('offsite').classList.remove('hidden');
      return null;
    }
    return new Promise((resolve) => {
      api.tabs.sendMessage(tab.id, message, (res) => {
        if (api.runtime.lastError) {
          status('ページと通信できません。タブを再読み込みしてください');
          resolve(null);
          return;
        }
        resolve(res);
      });
    });
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function save(filename, content, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    api.runtime.sendMessage({ type: 'download', url, filename }, (res) => {
      setTimeout(() => URL.revokeObjectURL(url), 20000);
      status(res?.ok ? `${filename} を保存しました` : `保存に失敗: ${res?.error || '不明'}`);
    });
  }

  async function refresh() {
    const rows = await store.loadList();
    const res = await send({ type: 'stats' });
    $('count').textContent = res
      ? `保存済み ${rows.length} 件 / 画面上 ${res.cards} 枚`
      : `保存済み ${rows.length} 件`;
    return rows;
  }

  // --- 操作 --------------------------------------------------------------

  // 巡回シートは拡張のページなので、サイトのタブを開いていなくても出せる。
  $('sheet').addEventListener('click', () => {
    api.runtime.sendMessage({ type: 'open-sheet' }, () => window.close());
  });

  $('panel').addEventListener('click', async () => {
    await send({ type: 'toggle-panel' });
    window.close();
  });

  $('collect').addEventListener('click', async () => {
    status('取込中…');
    const res = await send({ type: 'collect-visible' });
    if (res?.ok) status(`新規 ${res.stats.added} / 更新 ${res.stats.updated}`);
    refresh();
  });

  $('auto').addEventListener('click', async () => {
    // ポップアップは閉じても収集は続く。パネル側に進捗が出る。
    send({ type: 'auto-collect' });
    status('最後まで収集を開始しました。進捗はページ上のパネルに出ます');
  });

  $('stop').addEventListener('click', async () => {
    await send({ type: 'stop' });
    status('停止を要求しました');
  });

  $('csv').addEventListener('click', async () => {
    const rows = await store.loadList();
    if (!rows.length) return status('保存済みデータがありません');
    save(`webcatalog-${stamp()}.csv`, serialize.toCSV(rows), 'text/csv');
  });

  $('json').addEventListener('click', async () => {
    const rows = await store.loadList();
    if (!rows.length) return status('保存済みデータがありません');
    save(`webcatalog-${stamp()}.json`, serialize.toJSON(rows), 'application/json');
  });

  // --- 設定 --------------------------------------------------------------

  const FIELDS = ['scrollStepMs', 'bulkIntervalMs', 'bulkMaxItems'];

  async function loadSettings() {
    const s = await store.loadSettings();
    $('autoCollect').checked = !!s.autoCollect;
    for (const f of FIELDS) $(f).value = s[f];
  }

  $('autoCollect').addEventListener('change', async (e) => {
    await store.saveSettings({ autoCollect: e.target.checked });
    status('設定を保存しました（反映はページ再読み込み後）');
  });

  for (const f of FIELDS) {
    $(f).addEventListener('change', async (e) => {
      const v = Number(e.target.value);
      if (!Number.isFinite(v)) return;
      await store.saveSettings({ [f]: v });
      status('設定を保存しました');
    });
  }

  loadSettings();
  refresh();
})(window);
