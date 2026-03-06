// ========================================
// Sync Manager v3 - مدير المزامنة الشامل
// مزامنة كاملة لجميع البيانات
// ========================================

class SyncManager {
    constructor() {
        this.isSyncing = false;
        this.lastSync = null;
        this.autoSyncInterval = null;
        this.syncProgress = { total: 0, done: 0, step: '' };
        this.serverUrl = null;
        this._loadSyncMode();
    }

    _loadSyncMode() {
        const mode = localStorage.getItem('pos_sync_mode') || 'local';
        if (mode === 'server') {
            this.serverUrl = localStorage.getItem('pos_sync_server_url') || null;
        } else {
            this.serverUrl = null;
        }
    }

    getApiUrl() {
        if (this.serverUrl) return this.serverUrl;
        return typeof API_URL !== 'undefined' ? API_URL : '';
    }

    isServerMode() {
        return !!this.serverUrl;
    }

    getAutoSyncMinutes() {
        const val = parseInt(localStorage.getItem('pos_auto_sync_minutes') || '5', 10);
        return (val >= 1 && val <= 60) ? val : 5;
    }

    start(intervalMinutes) {
        this.stop();
        const minutes = intervalMinutes || this.getAutoSyncMinutes();
        this.autoSyncInterval = setInterval(() => {
            const isOnline = typeof _realOnlineStatus !== 'undefined' ? _realOnlineStatus : navigator.onLine;
            if (isOnline && !this.isSyncing) this.sync();
        }, minutes * 60 * 1000);
        console.log(`[Sync] Auto-sync started (every ${minutes} min)`);
    }

    stop() {
        if (this.autoSyncInterval) {
            clearInterval(this.autoSyncInterval);
            this.autoSyncInterval = null;
        }
    }

    restart() {
        this.stop();
        this.start();
    }

    // الدالة المعدلة: إضافة الهيدرات المهمة في كل طلب
    async _fetch(url, options = {}) {
        const headers = {
            ... (options.headers || {}),
            'Authorization': 'Bearer ' + (localStorage.getItem('token') || ''),
            'X-Tenant-ID': localStorage.getItem('pos_tenant_slug') || ''
        };

        // إذا كان POST/PUT وفي body، نضيف Content-Type إذا ما كان موجود
        if (options.method && ['POST', 'PUT', 'PATCH'].includes(options.method.toUpperCase()) && options.body) {
            headers['Content-Type'] = 'application/json';
        }

        const fetchOptions = {
            ...options,
            headers
        };

        return fetch(url, fetchOptions);
    }

    async refreshLicenseToken() {
        try {
            const resp = await this._fetch(`${this.getApiUrl()}/api/license/refresh-token`);
            if (resp.ok) {
                const data = await resp.json();
                if (data.success && data.token) {
                    try {
                        const parts = data.token.split('.');
                        const payload = JSON.parse(atob(parts[1]));
                        localStorage.setItem('pos_license_exp', String(payload.exp || ''));
                        localStorage.setItem('pos_license_iat', String(payload.iat || ''));
                        localStorage.setItem('pos_license_active', String(payload.is_active));
                        localStorage.setItem('pos_license_max_users', String(payload.max_users || ''));
                        localStorage.setItem('pos_license_max_branches', String(payload.max_branches || ''));
                    } catch (_) {}
                    console.log('[Sync] License token refreshed');
                    return true;
                }
            }
        } catch (e) {
            console.warn('[Sync] License refresh failed:', e.message);
        }
        return false;
    }

    async sync() {
        if (this.isSyncing) return { success: false, reason: 'already_syncing' };

        this._loadSyncMode();

        const isOnline = typeof _realOnlineStatus !== 'undefined' ? _realOnlineStatus : navigator.onLine;
        if (!isOnline) return { success: false, reason: 'offline' };

        // باقي الكود كما هو (uploadPendingData, downloadBranches, إلخ)
        // ... (لا تغير شيء هنا، لأن الـ _fetch المعدلة راح تطبق الهيدرات تلقائيًا)
        // مثال: await this._fetch(`${this.getApiUrl()}/api/branches`);
    }

    // باقي الدوال (downloadBranches, downloadProducts, إلخ) ما تحتاج تعديل لأنها تستخدم this._fetch
    // فقط تأكد إن كل fetch داخل الكلاس يستخدم this._fetch بدل fetch مباشرة
}

// Instance
const syncManager = new SyncManager();

// ... باقي الكود (showStatus, updateSyncUI, إلخ) بدون تغيير
