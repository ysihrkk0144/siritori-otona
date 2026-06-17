/* =====================================================
   Service Worker — 大人のしりとり辞典
   バージョンを上げるたびに CACHE_NAME の番号を増やす
   （ASSETSを追加・削除した場合も必ず上げること）
   ===================================================== */
const CACHE_NAME = "adult-shiritori-v4";

/* キャッシュするファイル一覧
   ※ service-worker.js 自身はここに含めない */
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

/* ── install：個別キャッシュ（1ファイル失敗しても全滅しない） ── */
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        ASSETS.map((url) =>
          fetch(url)
            .then((res) => {
              if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
              return cache.put(url, res);
            })
            .catch((err) => {
              console.warn("[SW] キャッシュ失敗:", url, err);
              throw err;
            })
        )
      ).then((results) => {
        const ok = results.filter((r) => r.status === "fulfilled").length;
        const ng = results.filter((r) => r.status === "rejected").length;
        console.log(`[SW] install 完了 — 成功:${ok} 失敗:${ng}`);
        self.__installResult = { ok, ng };
      })
    )
  );
  /* 待機中の SW をすぐ有効化 */
  self.skipWaiting();
});

/* ── activate：古いキャッシュを削除 ── */
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => {
            console.log("[SW] 古いキャッシュ削除:", k);
            return caches.delete(k);
          })
      )
    ).then(() => {
      /* キャッシュ完了をページへ通知 */
      const result = self.__installResult || { ok: -1, ng: -1 };
      self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) =>
          client.postMessage({
            type: "SW_CACHED",
            cacheName: CACHE_NAME,
            ok: result.ok,
            ng: result.ng
          })
        );
      });
    })
  );
  self.clients.claim();
});

/* ── fetch：GETのみ処理、キャッシュ優先 ── */
self.addEventListener("fetch", (e) => {
  /* GET 以外はそのままスルー */
  if (e.request.method !== "GET") return;

  /* ページ遷移（HTMLナビゲーション）は index.html に正規化してキャッシュを見る。
     "./" と "./index.html" でキャッシュキーがズレてヒットしない問題を防ぐ。 */
  if (e.request.mode === "navigate") {
    e.respondWith(
      caches.match("./index.html").then((hit) => {
        if (hit) return hit;
        return fetch(e.request).catch(() => caches.match("./index.html"));
      })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      /* キャッシュになければネットワークから取得 */
      return fetch(e.request).catch(() => {
        /* オフラインかつキャッシュなし → index.html でフォールバック */
        return caches.match("./index.html");
      });
    })
  );
});
