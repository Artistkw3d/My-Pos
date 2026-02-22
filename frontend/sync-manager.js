// ========================================
// 🔄 Sync Manager
// ========================================

class SyncManager {
    constructor() {
        this.isSyncing = false;
        this.lastSync = null;
        this.autoSyncInterval = null;
    }
    
    // بدء المزامنة التلقائية
    start(intervalMinutes = 5) {
        this.autoSyncInterval = setInterval(() => {
            if (typeof _realOnlineStatus !== 'undefined' ? _realOnlineStatus : navigator.onLine) {
                if (!this.isSyncing) this.sync();
            }
        }, intervalMinutes * 60 * 1000);
        
        console.log(`[Sync] Auto-sync started (every ${intervalMinutes} min)`);
    }
    
    // إيقاف المزامنة التلقائية
    stop() {
        if (this.autoSyncInterval) {
            clearInterval(this.autoSyncInterval);
            this.autoSyncInterval = null;
        }
    }
    
    // المزامنة
    async sync() {
        if (this.isSyncing) {
            console.log('[Sync] Already syncing...');
            return;
        }
        
        const isOnline = typeof _realOnlineStatus !== 'undefined' ? _realOnlineStatus : navigator.onLine;
        if (!isOnline) {
            console.log('[Sync] Offline - skipped');
            return;
        }
        
        this.isSyncing = true;
        this.showStatus('🔄 جاري المزامنة...');
        
        try {
            // 1. رفع الفواتير المعلقة
            await this.uploadPendingInvoices();

            // 2. رفع العملاء المعلقين
            await this.uploadPendingCustomers();

            // 3. تحديث المنتجات
            await this.downloadProducts();
            
            this.lastSync = new Date();
            this.showStatus('✅ تمت المزامنة', 'success');
            
            console.log('[Sync] Completed ✅');
            
        } catch (error) {
            console.error('[Sync] Error:', error);
            this.showStatus('⚠️ فشلت المزامنة', 'error');
        } finally {
            this.isSyncing = false;
        }
    }
    
    // رفع الفواتير المعلقة
    async uploadPendingInvoices() {
        try {
            const pending = await localDB.getAll('pending_invoices');
            
            if (pending.length === 0) {
                console.log('[Sync] No pending invoices');
                return;
            }
            
            console.log(`[Sync] Uploading ${pending.length} invoices...`);
            
            for (const invoice of pending) {
                try {
                    const response = await fetch(`${API_URL}/api/invoices`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(invoice.data)
                    });

                    if (!response.ok) {
                        console.error(`[Sync] Server returned ${response.status} for invoice ${invoice.local_id}`);
                        continue;
                    }

                    const result = await response.json();

                    if (result.success) {
                        // حذف من المعلقة (سواء كانت جديدة أو مكررة)
                        await localDB.delete('pending_invoices', invoice.local_id);

                        // حذف من local_invoices
                        if (invoice.data && invoice.data.id) {
                            await localDB.delete('local_invoices', invoice.data.id);
                        }

                        if (result.duplicate) {
                            console.log(`[Sync] Duplicate invoice removed: ${invoice.local_id}`);
                        } else {
                            console.log(`[Sync] Uploaded invoice ${invoice.local_id}`);
                        }
                    }
                } catch (error) {
                    console.error(`[Sync] Failed to upload invoice:`, error);
                }
            }
        } catch (error) {
            console.error('[Sync] Upload error:', error);
        }
    }
    
    // رفع العملاء المعلقين
    async uploadPendingCustomers() {
        try {
            const pending = await localDB.getAll('pending_customers');

            if (pending.length === 0) {
                console.log('[Sync] No pending customers');
                return;
            }

            console.log(`[Sync] Uploading ${pending.length} customers...`);

            for (const customer of pending) {
                try {
                    const response = await fetch(`${API_URL}/api/customers`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(customer)
                    });

                    if (!response.ok) {
                        console.error(`[Sync] Server returned ${response.status} for customer ${customer.name}`);
                        continue;
                    }

                    const result = await response.json();

                    if (result.success) {
                        await localDB.delete('pending_customers', customer.id);
                        console.log(`[Sync] Uploaded customer ${customer.name}`);
                    }
                } catch (error) {
                    console.error(`[Sync] Failed to upload customer:`, error);
                }
            }
        } catch (error) {
            console.error('[Sync] Customer upload error:', error);
        }
    }

    // تحديث المنتجات
    async downloadProducts() {
        try {
            const branchId = (typeof currentUser !== 'undefined' && currentUser?.branch_id) ? currentUser.branch_id : 1;
            const response = await fetch(`${API_URL}/api/products?branch_id=${branchId}`);
            if (!response.ok) {
                console.error(`[Sync] Products download failed: ${response.status}`);
                return;
            }
            const data = await response.json();
            
            if (data.success && data.products) {
                await localDB.clear('products');
                await localDB.saveAll('products', data.products);
                console.log(`[Sync] Downloaded ${data.products.length} products`);
                
                // تحديث العرض
                if (typeof allProducts !== 'undefined') {
                    allProducts = data.products;
                    if (typeof displayProducts === 'function') {
                        displayProducts(allProducts);
                    }
                }
            }
        } catch (error) {
            console.error('[Sync] Download error:', error);
        }
    }
    
    // عرض الحالة
    showStatus(message, type = 'info') {
        let indicator = document.getElementById('syncStatus');
        
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'syncStatus';
            indicator.style.cssText = `
                position: fixed;
                top: 70px;
                right: 20px;
                padding: 12px 20px;
                border-radius: 8px;
                color: white;
                font-weight: 600;
                z-index: 9999;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                animation: slideIn 0.3s ease;
            `;
            document.body.appendChild(indicator);
        }
        
        const colors = {
            info: '#667eea',
            success: '#28a745',
            error: '#dc3545'
        };
        
        indicator.style.background = colors[type] || colors.info;
        indicator.textContent = message;
        indicator.style.display = 'block';
        
        if (type !== 'info') {
            setTimeout(() => {
                indicator.style.display = 'none';
            }, 3000);
        }
    }
}

// Instance عام
const syncManager = new SyncManager();

// CSS للـ animation
const syncStyle = document.createElement('style');
syncStyle.textContent = `
@keyframes slideIn {
    from { transform: translateX(100px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
}
`;
document.head.appendChild(syncStyle);

console.log('[Sync] Loaded');
