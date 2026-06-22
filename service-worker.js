/* =====================================================
   Service Worker — 大人のしりとり辞典
   方針：Cache Only（完全オフライン優先）+ 手動更新のみ

   ★ 重要な約束（このファイルを編集する人へ）
   - install時に skipWaiting() は絶対に呼ばない
   - fetchで自動的にネットワークへ取りに行く積極動作はしない
   - ASSETSを追加・削除したら CACHE_NAME を必ず上げる
   - './' と './index.html' は両方入れない（index.htmlに一本化）
   ===================================================== */

const CACHE_NAME = "adult-shiritori-v7";

/* キャッシュするファイル一覧（相対パス）
   ※ service-worker.js 自身はここに含めない
   ※ './' は入れない。navigate は index.html に一本化する */
const ASSET_PATHS = [
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

/* 相対パスを SW のスコープ基準で完全URL化する。
   SW が一度終了→再起動したあとでも self.location は
   常にこのファイルの設置場所を指すため、相対パス解決の
   揺れによるキャッシュキー不一致を防げる。 */
const ASSETS = ASSET_PATHS.map((p) => new URL(p, self.location).href);
const INDEX_URL = new URL("./index.html", self.location).href;
const EXPECTED_COUNT = ASSETS.length;

/* ───────────────────────────────────────
   ユーティリティ：リトライ付きfetch
   モバイル回線の不安定さに対応するため最大3回試行する。
   cacheオプションは "no-store" を使う。
   （"reload" はモバイル端末で不安定動作することが判明している）
   ─────────────────────────────────────── */
async function fetchWithRetry(url, maxRetry = 3) {
  let lastErr = null;
  for (let i = 0; i < maxRetry; i++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      if (i < maxRetry - 1) {
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

/* 全クライアントへ通知 */
async function notifyClients(payload) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach((c) => c.postMessage(payload));
}

/* ───────────────────────────────────────
   install：個別キャッシュ（リトライ付き・1件失敗で全滅させない）
   ★ skipWaiting() はここで呼ばない（手動更新方式のため）
   ─────────────────────────────────────── */
self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      const results = await Promise.allSettled(
        ASSETS.map(async (url) => {
          const res = await fetchWithRetry(url, 3);
          await cache.put(url, res);
          return url;
        })
      );

      const ok = results.filter((r) => r.status === "fulfilled").length;
      const ngList = results
        .filter((r) => r.status === "rejected")
        .map((r, i) => ASSETS[i])
        .filter(Boolean);
      const ng = results.length - ok;

      console.log(`[SW] install 完了 — 成功:${ok} 失敗:${ng}`);
      if (ng > 0) console.warn("[SW] キャッシュ失敗ファイル:", ngList);

      await notifyClients({
        type: "SW_INSTALL_DONE",
        cacheName: CACHE_NAME,
        ok,
        ng,
        total: EXPECTED_COUNT,
        failedUrls: ngList
      });
      /* skipWaiting() はここでは呼ばない */
    })()
  );
});

/* ───────────────────────────────────────
   activate：古いキャッシュを削除
   ─────────────────────────────────────── */
self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => {
            console.log("[SW] 古いキャッシュ削除:", k);
            return caches.delete(k);
          })
      );
      await self.clients.claim();
      await notifyClients({ type: "SW_ACTIVATED", cacheName: CACHE_NAME });
    })()
  );
});

/* ───────────────────────────────────────
   fetch：Cache Only方式
   - GET以外・http以外はスルー
   - navigate は index.html キャッシュを最優先
   - その他はキャッシュにあれば返す。無ければネットワークを
     試すが、失敗時は何も返さず warn のみ（積極的な自動取得はしない）
   ─────────────────────────────────────── */
self.addEventListener("fetch", (e) => {
  const req = e.request;

  if (req.method !== "GET") return;
  if (!req.url.startsWith("http")) return;

  if (req.mode === "navigate") {
    e.respondWith(
      caches.match(INDEX_URL).then((hit) => {
        if (hit) return hit;
        return fetch(req).catch(() => {
          console.warn("[SW] navigate キャッシュ無し・ネットワーク失敗:", req.url);
          return new Response("オフラインのため表示できません", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          });
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).catch(() => {
        console.warn("[SW] キャッシュ無し・ネットワーク失敗:", req.url);
        /* 何も返さない（積極的な自動取得・代替表示はしない） */
        return new Response("", { status: 504 });
      });
    })
  );
});

/* ───────────────────────────────────────
   message：診断要求・手動更新の受付
   ─────────────────────────────────────── */
self.addEventListener("message", (e) => {
  const data = e.data || {};

  if (data.type === "GET_DIAGNOSTIC") {
    e.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const reqs = await cache.keys();
        const urls = reqs.map((r) => r.url);
        await notifyClients({
          type: "SW_DIAGNOSTIC",
          cacheName: CACHE_NAME,
          count: urls.length,
          expected: EXPECTED_COUNT,
          urls
        });
      })()
    );
    return;
  }

  /* 「更新する」ボタンが押された時だけ呼ばれる */
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
