// ========================================
// 📱 Service Worker - PWA
// ========================================

const CACHE_NAME = 'pos-cache-v1';
const STATIC_CACHE = 'pos-static-v1';

// الملفات الأساسية
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/app.js',
    '/style.css',
    '/products-search.js'
];

// التثبيت
self.addEventListener('install', (event) => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// التفعيل
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.map(key => {
                    if (key !== STATIC_CACHE && key !== CACHE_NAME) {
                        console.log('[SW] Deleting old cache:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch Strategy
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // API Requests - Network First
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    // حفظ النسخة في cache
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(request, responseClone);
                    });
                    return response;
                })
                .catch(() => {
                    // Offline: جرب من cache
                    return caches.match(request);
                })
        );
    } 
    // Static Files - Cache First
    else {
        event.respondWith(
            caches.match(request)
                .then(cached => cached || fetch(request))
        );
    }
});

console.log('[SW] Service Worker loaded');
