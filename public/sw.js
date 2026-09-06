/**
 * Production Service Worker
 *
 * Uses:
 *   - Workbox v7 (self-hosted) for precaching and routing strategies
 *   - IDB (custom wrapper) for reading progress and metadata caching
 *
 * Strategies:
 *   - Precached assets:     Cache-first (managed by Workbox)
 *   - HTML navigation:      Network-first (3s timeout), falls back to network cache
 *   - CSS / JS:             Stale-while-revalidate
 *   - JSON data:            Stale-while-revalidate (except index.json, handled manually)
 *   - Images:               Cache-first with expiration
 *
 * Messaging:
 *   - SAVE_PROGRESS:      Stores reading position in IndexedDB
 *   - GET_PROGRESS:       Retrieves reading position from IndexedDB
 *   - SKIP_WAITING:        Activates new SW immediately
 */

// ── Import Workbox and IDB ─────────────────────────────────────────
//
// importScripts loads classic scripts (not ES modules).
// This avoids the "Unexpected keyword export" error on iOS Safari
// that occurs when using ES module imports in service workers.

importScripts('/lib/workbox/workbox-sw.js');
importScripts('/lib/idb.js');

// Tell Workbox where to find its module files (self-hosted)
workbox.setConfig({
  modulePathPrefix: '/lib/workbox/',
});

// Debug logging is disabled by default in production workbox-sw builds.
// If using a dev build where you need to silence it, guard the call so a
// missing API never kills the whole worker:
if (typeof workbox.core.setLogLevel === 'function') {
  workbox.core.setLogLevel(workbox.core.LogLevel.warn);
}

// Destructure Workbox modules (auto-loaded by workbox-sw)
var precacheAndRoute = workbox.precaching.precacheAndRoute;
var registerRoute = workbox.routing.registerRoute;
var NavigationRoute = workbox.routing.NavigationRoute;
var NetworkFirst = workbox.strategies.NetworkFirst;
var StaleWhileRevalidate = workbox.strategies.StaleWhileRevalidate;
var CacheFirst = workbox.strategies.CacheFirst;
var ExpirationPlugin = workbox.expiration.ExpirationPlugin;
var CacheableResponsePlugin = workbox.cacheableResponse.CacheableResponsePlugin;

// ── Navigation Route (HTML pages) ───────────────────────────────────
//
// Registered BEFORE precacheAndRoute (which is called asynchronously in
// the install handler below). Workbox matches routes in registration
// order, so this route takes priority over the precache route for
// navigation requests. Keeping this file's structure intact matters:
// if you ever move precacheAndRoute above this block, precaching
// (cache-first) would start intercepting page navigations instead.
//
// NetworkFirst for HTML so users get fresh content when online.
// Falls back to the previously cached copy when offline.

var navigationRoute = new NavigationRoute(
  new NetworkFirst({
    cacheName: 'pages-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
    ],
    networkTimeoutSeconds: 3,
  }),
  {
    // Don't intercept non-HTML requests
    denylist: [
      /^\/lib\//,
      /^\/css\//,
      /^\/js\//,
      /^\/images\//,
      /^\/precache-manifest\.json$/,
      /\.css$/,
      /\.js$/,
      /\.json$/,
      /\.png$/,
      /\.jpg$/,
      /\.svg$/,
      /\.ico$/,
      /\.webmanifest$/,
    ],
  }
);

// Register navigation route immediately (order matters — see comment above)
registerRoute(navigationRoute);

// ── Runtime Caching Routes ─────────────────────────────────────────

// CSS and JS: stale-while-revalidate for instant loads with background updates
registerRoute(
  function (args) {
    return args.request.destination === 'style' ||
           args.request.destination === 'script';
  },
  new StaleWhileRevalidate({
    cacheName: 'static-resources',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
    ],
  })
);

// JSON data: stale-while-revalidate.
// NOTE: /literature/index.json is handled by the manual fetch listener
// below, which calls respondWith first — so this SWR route never fires
// for it. This route covers all OTHER JSON endpoints.
registerRoute(
  function (args) {
    return args.url.pathname.endsWith('.json');
  },
  new StaleWhileRevalidate({
    cacheName: 'data-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
    ],
  })
);

// Images: cache-first with expiration (max 60 entries, 30 days)
registerRoute(
  function (args) {
    return args.request.destination === 'image';
  },
  new CacheFirst({
    cacheName: 'image-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
      }),
    ],
  })
);

// ── Precaching ─────────────────────────────────────────────────────

/**
 * Fetch the precache manifest and hand it to Workbox.
 * Workbox stores each entry keyed by revision hash, so
 * updated files are automatically cache-busted. Registered
 * last so the navigation route above retains priority.
 */
async function setupPrecaching() {
  try {
    var response = await fetch('/precache-manifest.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Manifest fetch failed: ' + response.status);
    }
    var manifest = await response.json();

    // Map our { url, revision } format to Workbox's expected format
    var entries = manifest.map(function (entry) {
      return {
        url: entry.url,
        revision: entry.revision || null,
      };
    });

    precacheAndRoute(entries);
    console.log('[SW] Precached ' + entries.length + ' entries');
  } catch (err) {
    console.error('[SW] Precache setup failed:', err);
    // SW still functions — runtime caching will work,
    // and assets will be cached on first fetch
  }
}

// ── IDB: Metadata Caching ───────────────────────────────────────────
//
// When the book index is fetched, also store it in IDB.
// This allows the landing page to display the catalogue
// even when fully offline (first load was online).
//
// This manual fetch listener runs alongside the Workbox routes above.
// For /literature/index.json it calls respondWith before Workbox can,
// so this listener fully controls that request (network-first with an
// IDB fallback) — the SWR JSON route does not apply to it.

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);

  // Intercept index.json requests and cache in IDB
  if (url.pathname === '/literature/index.json' && event.request.method === 'GET') {
    event.respondWith(
      (async function () {
        try {
          var response = await fetch(event.request);
          if (response.ok) {
            var clone = response.clone();
            var data = await clone.json();

            // Store each book's metadata in IDB
            if (Array.isArray(data)) {
              for (var i = 0; i < data.length; i++) {
                try {
                  await IDB.put(IDB.STORES.METADATA, data[i]);
                } catch (e) {
                  // Non-fatal — IDB might be full or blocked
                }
              }
            }
          }
          return response;
        } catch (err) {
          // Network failed — try to reconstruct from IDB
          var allMeta = await IDB.getAll(IDB.STORES.METADATA);
          if (allMeta && allMeta.length > 0) {
            return new Response(JSON.stringify(allMeta), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          throw err;
        }
      })()
    );
  }
});

// ── Message Handler ─────────────────────────────────────────────────
//
// The page communicates with the SW via postMessage.
// Used for: reading progress save/load, SW updates.

self.addEventListener('message', function (event) {
  var data = event.data || {};

  // Activate new SW immediately
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // Save reading progress to IDB
  if (data.type === 'SAVE_PROGRESS') {
    IDB.put(IDB.STORES.PROGRESS, {
      bookSlug: data.bookSlug,
      chapterId: data.chapterId,
      scrollOffset: data.scrollOffset,
      timestamp: Date.now(),
    })
      .then(function () {
        if (event.source) {
          event.source.postMessage({ type: 'PROGRESS_SAVED', success: true });
        }
      })
      .catch(function (err) {
        if (event.source) {
          event.source.postMessage({
            type: 'PROGRESS_SAVED',
            success: false,
            error: err.message,
          });
        }
      });
    return;
  }

  // Retrieve reading progress from IDB
  if (data.type === 'GET_PROGRESS') {
    IDB.get(IDB.STORES.PROGRESS, data.bookSlug)
      .then(function (progress) {
        if (event.source) {
          event.source.postMessage({
            type: 'PROGRESS_DATA',
            progress: progress || null,
          });
        }
      })
      .catch(function (err) {
        if (event.source) {
          event.source.postMessage({
            type: 'PROGRESS_DATA',
            progress: null,
            error: err.message,
          });
        }
      });
    return;
  }

  // Get all stored book metadata (for offline catalogue)
  if (data.type === 'GET_ALL_METADATA') {
    IDB.getAll(IDB.STORES.METADATA)
      .then(function (metadata) {
        if (event.source) {
          event.source.postMessage({
            type: 'ALL_METADATA',
            metadata: metadata || [],
          });
        }
      })
      .catch(function (err) {
        if (event.source) {
          event.source.postMessage({
            type: 'ALL_METADATA',
            metadata: [],
            error: err.message,
          });
        }
      });
    return;
  }
});

// ── Lifecycle Events ───────────────────────────────────────────────

self.addEventListener('install', function (event) {
  console.log('[SW] Installing...');
  event.waitUntil(
    setupPrecaching().then(function () {
      self.skipWaiting();
      console.log('[SW] Install complete');
    })
  );
});

self.addEventListener('activate', function (event) {
  console.log('[SW] Activating...');
  event.waitUntil(
    (async function () {
      // Clean up old caches that aren't managed by Workbox
      var keys = await caches.keys();
      await Promise.all(
        keys
          .filter(function (key) {
            // Keep Workbox-managed caches and our custom ones
            return !key.startsWith('workbox-') &&
                   key !== 'pages-cache' &&
                   key !== 'static-resources' &&
                   key !== 'data-cache' &&
                   key !== 'image-cache';
          })
          .map(function (key) {
            return caches.delete(key);
          })
      );

      await self.clients.claim();
      console.log('[SW] Activation complete');
    })()
  );
});
