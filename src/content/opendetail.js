/**
 * シートから飛んできたときに、そのサークルの詳細を開くところまでやる。
 *
 * サイトの詳細は右から出てくるドロワーで、カードのカット画像を押すと開く。
 * URL は変わらないので、リンクを踏ませるだけでは詳細までは行けない。
 *
 * URL に目印を載せる手も試したが、この SPA は読み込み時に自分でクエリを
 * 書き直すためハッシュが消えてしまう。そこで「どのサークルを開きたいか」は
 * バックグラウンドに預けてもらい、ここで取りに行く。
 *
 * 一覧は keyword・日・ブロックで数件まで絞った状態で開くので、
 * 目的のカードはたいてい最初の描画で出ている。
 */
(function (root) {
  'use strict';

  const SEL = root.WCH.sel;
  const runtime = (root.browser?.runtime ? root.browser : root.chrome).runtime;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function askPending() {
    return new Promise((resolve) => {
      try {
        runtime.sendMessage({ type: 'take-pending-detail' }, (res) => {
          void runtime.lastError;
          resolve(res && res.wcid ? String(res.wcid) : null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function isOpen() {
    return !!document.querySelector('.v-navigation-drawer--right.v-navigation-drawer--active');
  }

  async function waitCard(wcid, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const el = document.querySelector(`[${SEL.cardId}="${CSS.escape(wcid)}"]`);
      if (el) return el;
      await sleep(300);
    }
    return null;
  }

  /**
   * @param {string} [wcid] 指定が無ければバックグラウンドに預かりを聞く
   * @returns {Promise<'opened'|'not-found'|'no-target'|'failed'>}
   */
  async function run(wcid) {
    const target = wcid || (await askPending());
    if (!target) return 'no-target';

    const card = await waitCard(target);
    if (!card) return 'not-found';

    card.scrollIntoView({ block: 'center' });
    await sleep(400);

    // 詳細を開くのはカット画像。無ければカード本体で代用する。
    const hit = card.querySelector(SEL.image) || card.querySelector(SEL.cardBody);
    if (!hit) return 'failed';

    hit.click();

    for (let i = 0; i < 24; i++) {
      await sleep(250);
      if (isOpen()) return 'opened';
    }
    return 'failed';
  }

  root.WCH.openDetail = { run, isOpen };
})(window);
