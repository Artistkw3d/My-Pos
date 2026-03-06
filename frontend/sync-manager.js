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

    // الدالة المعدلة: تضيف Authorization + X-Tenant-ID تلقائياً
    async _fetch(url, options = {}) {
        const token = localStorage.getItem('token') || '';
        const tenantId = localStorage.getItem('pos_tenant_slug') || '';

        const headers = {
            ...(options.headers || {}),
            'Authorization': token ? `Bearer ${token}` : '',
            'X-Tenant-ID': tenantId
        };

        // إذا طلب POST/PUT/PATCH وفي body، نضيف Content-Type
        if (options.method && ['POST', 'PUT', 'PATCH'].includes(options.method.toUpperCase()) && options.body) {
            headers['Content-Type'] = 'application/json';
        }

        return fetch(url, { ...options, headers });
    }

    // باقي الدوال كما هي (refreshLicenseToken, sync, downloadBranches, إلخ)
    // لأنها تستخدم this._fetch اللي صارت تضيف الهيدرات تلقائياً

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

    // ========== MAIN SYNC ==========
    async sync() {
        if (this.isSyncing) {
            console.log('[Sync] Already syncing...');
            return { success: false, reason: 'already_syncing' };
        }

        this._loadSyncMode();

        const isOnline = typeof _realOnlineStatus !== 'undefined' ? _realOnlineStatus : navigator.onLine;
        if (!isOnline) {
            console.log('[Sync] Offline - skipped');
            return { success: false, reason: 'offline' };
        }

        // باقي الكود كما هو تماماً (uploadPendingData, downloadBranches, إلخ)
        // ... (لا تغيير هنا لأن this._fetch صارت محمية)
    }

    // ... باقي الدوال (downloadCategories, downloadReturns, إلخ) بدون تغيير

    // ========== UI ==========
    showStatus(message, type = 'info') {
        // ... كما هي
    }

    updateSyncUI(state) {
        // ... كما هي
    }

    updateProgressUI() {
        // ... كما هي
    }
}

// Instance
const syncManager = new SyncManager();

// CSS animation
const syncStyle = document.createElement('style');
syncStyle.textContent = `
@keyframes slideIn {
    from { transform: translateX(100px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
}
@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
.sync-spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid #fff;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    vertical-align: middle;
    margin-left: 5px;
}
`;
document.head.appendChild(syncStyle);

console.log('[Sync] Loaded v3');
