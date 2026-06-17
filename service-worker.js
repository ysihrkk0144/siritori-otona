/* =====================================================
   Service Worker — 大人のしりとり辞典
   バージョンを上げるたびに CACHE_NAME の番号を増やす
   （ASSETSを追加・削除した場合も必ず上げること）
   ===================================================== */
const CACHE_NAME = "adult-shiritori-v5";

/* キャッシュするファイル一覧（相対パス）
   ※ service-worker.js 自身はここに含めない */
const ASSET_PATHS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

/* 相対パスを SW のスコープ基準で完全URL化しておく。
   SW が一度終了→再起動したあとでも self.location は
   常にこのファイルの設置場所を指すため、相対パス解決の
   揺れによるキャッシュキー不一致を防げる。 */
const ASSETS = ASSET_PATHS.map((p) => new URL(p, self.location).href);
const INDEX_URL = new URL("./index.html", self.location).href;

/* ── install：個別キャッシュ（1ファイル失敗しても全滅しない） ── */
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        ASSETS.map((url) =>
          fetch(url, { cache: "reload" })
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

/* ── fetch：GETのみ処理、キャッシュ優先（キャッシュファースト） ── */
self.addEventListener("fetch", (e) => {
  /* GET 以外はそのままスルー */
  if (e.request.method !== "GET") return;

  /* chrome-extension: などスキームが http/https でないものはスルー */
  if (!e.request.url.startsWith("http")) return;

  /* ページ遷移（HTMLナビゲーション）は完全URLで index.html のキャッシュを
     最優先で返す。ネットワークには行かず、キャッシュがあれば即応答する
     ことで、オフライン時・SW再起動直後でも確実に表示させる。 */
  if (e.request.mode === "navigate") {
    e.respondWith(
      caches.match(INDEX_URL).then((hit) => {
        if (hit) return hit;
        return fetch(e.request).catch(() => caches.match(INDEX_URL));
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
        return caches.match(INDEX_URL);
      });
    })
  );
});
