const API_URL = window.location.origin;
// حماية من عدم تحميل localDB في وضع أوفلاين
if (typeof localDB === 'undefined') {
    window.localDB = { isReady: false, init: async()=>{}, save:async()=>{}, saveAll:async()=>{}, getAll:async()=>[], get:async()=>null, add:async()=>{}, delete:async()=>{} };
}

// === فحص الاتصال الحقيقي (بدلاً من navigator.onLine غير الموثوق) ===
let _realOnlineStatus = navigator.onLine;
async function checkRealConnection() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const resp = await fetch(`${API_URL}/api/settings?_ping=1`, {
            method: 'GET',
            cache: 'no-store',
            signal: controller.signal
        });
        clearTimeout(timeout);
        _realOnlineStatus = resp.ok || resp.status < 500;
        return _realOnlineStatus;
    } catch (e) {
        _realOnlineStatus = false;
        return false;
    }
}
// فحص دوري كل 5 ثواني
setInterval(async () => {
    const wasOnline = _realOnlineStatus;
    await checkRealConnection();
    // عند تغيير الحالة
    if (wasOnline !== _realOnlineStatus) {
        if (typeof _lockLogout === 'function') _lockLogout(!_realOnlineStatus);
        if (typeof updateLogoutButton === 'function') updateLogoutButton();
        // عند العودة أونلاين - مزامنة فورية!
        if (_realOnlineStatus && !wasOnline) {
            console.log('[Connection] Back online - syncing immediately...');
            if (typeof syncManager !== 'undefined') {
                try { syncManager.sync(); } catch(e) {}
            }
            if (typeof syncOfflineCustomers === 'function') {
                try { syncOfflineCustomers(); } catch(e) {}
            }
            if (typeof loadCustomersDropdown === 'function') {
                try { loadCustomersDropdown(); } catch(e) {}
            }
        }
    }
}, 5000);

let currentUser = null;
let cart = [];
let allProducts = [];
let allProductsTable = [];
let allInvoices = [];
let allCustomers = [];
let currentInvoice = null;
let categories = new Set();
let storeLogo = null;

// ===== نظام Multi-Tenancy =====
let currentTenantSlug = localStorage.getItem('pos_tenant_slug') || '';
let currentSuperAdmin = null;

// إعادة تعريف fetch لإضافة هيدر المستأجر تلقائياً
const originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
    if (currentTenantSlug && typeof url === 'string' && url.includes('/api/')) {
        options.headers = options.headers || {};
        if (options.headers instanceof Headers) {
            options.headers.set('X-Tenant-ID', currentTenantSlug);
        } else {
            options.headers['X-Tenant-ID'] = currentTenantSlug;
        }
    }
    return originalFetch.call(this, url, options);
};

// استعادة معرف المتجر في حقل الإدخال عند فتح الصفحة
(function() {
    const input = document.getElementById('loginTenantSlug');
    if (input && currentTenantSlug) {
        input.value = currentTenantSlug;
    }
})();

// ===== وضع العرض (كمبيوتر / موبايل) =====
function selectViewMode(mode) {
    localStorage.setItem('pos_view_mode', mode);
    applyViewMode(mode);
    // تحديث الأزرار
    document.getElementById('desktopModeBtn')?.classList.toggle('active', mode === 'desktop');
    document.getElementById('mobileModeBtn')?.classList.toggle('active', mode === 'mobile');
}

function applyViewMode(mode) {
    if (mode === 'mobile') {
        document.body.classList.add('mobile-mode');
        // تحديث viewport للموبايل
        let viewport = document.querySelector('meta[name="viewport"]');
        if (viewport) {
            viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes');
        }
    } else {
        document.body.classList.remove('mobile-mode');
        let viewport = document.querySelector('meta[name="viewport"]');
        if (viewport) {
            viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
        }
    }
}

// استعادة وضع العرض المحفوظ
(function() {
    const savedMode = localStorage.getItem('pos_view_mode') || 'desktop';
    applyViewMode(savedMode);
    // تحديث الأزرار عند تحميل الصفحة
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('desktopModeBtn')?.classList.toggle('active', savedMode === 'desktop');
        document.getElementById('mobileModeBtn')?.classList.toggle('active', savedMode === 'mobile');
    });
})();

// استعادة المستخدم من localStorage
function restoreUser() {
    const savedUser = localStorage.getItem('pos_current_user');
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            return true;
        } catch (e) {
            console.error('[App] Failed to restore user:', e);
            localStorage.removeItem('pos_current_user');
            return false;
        }
    }
    return false;
}

// تهيئة الواجهة بعد استعادة المستخدم
async function initializeUI() {
    if (!currentUser) return;
    
    // إخفاء شاشة Login وإظهار النظام
    document.getElementById('loginOverlay').classList.add('hidden');
    document.getElementById('mainContainer').style.display = 'block';

    // تحديث حالة زر الخروج
    updateLogoutButton();
    
    // عرض اسم المستخدم
    const branchText = currentUser.branch_name ? ` - ${currentUser.branch_name}` : '';
    document.getElementById('userInfo').textContent = `${currentUser.full_name} (${currentUser.invoice_prefix || 'INV'})${branchText}`;
    
    // نظام الصلاحيات
    const isAdmin = currentUser.role === 'admin';
    const hasPerm = (perm) => isAdmin || currentUser[perm] === 1;
    
    window.userPermissions = {
        isAdmin: isAdmin,
        canViewProducts: hasPerm('can_view_products'),
        canAddProducts: hasPerm('can_add_products'),
        canEditProducts: hasPerm('can_edit_products'),
        canDeleteProducts: hasPerm('can_delete_products'),
        canViewInventory: hasPerm('can_view_inventory'),
        canAddInventory: hasPerm('can_add_inventory'),
        canEditInventory: hasPerm('can_edit_inventory'),
        canDeleteInventory: hasPerm('can_delete_inventory'),
        canViewInvoices: hasPerm('can_view_invoices'),
        canDeleteInvoices: hasPerm('can_delete_invoices'),
        canViewCustomers: hasPerm('can_view_customers'),
        canAddCustomer: hasPerm('can_add_customer'),
        canEditCustomer: hasPerm('can_edit_customer'),
        canDeleteCustomer: hasPerm('can_delete_customer'),
        canViewReports: hasPerm('can_view_reports'),
        canViewAccounting: hasPerm('can_view_accounting'),
        canManageUsers: hasPerm('can_manage_users'),
        canAccessSettings: hasPerm('can_access_settings')
    };
    
    // إخفاء/إظهار الأزرار والتبويبات
    document.getElementById('settingsBtn').style.display = window.userPermissions.canAccessSettings ? 'inline-block' : 'none';
    document.getElementById('usersBtn').style.display = window.userPermissions.canManageUsers ? 'inline-block' : 'none';
    document.getElementById('branchesBtn').style.display = isAdmin ? 'inline-block' : 'none';
    document.getElementById('systemLogsBtn').style.display = isAdmin ? 'inline-block' : 'none';
    document.getElementById('clearInvoicesBtn').style.display = window.userPermissions.canDeleteInvoices ? 'inline-block' : 'none';
    document.getElementById('expensesBtn').style.display = isAdmin ? 'inline-block' : 'none';
    document.getElementById('dcfBtn').style.display = isAdmin ? 'inline-block' : 'none';
    document.getElementById('advancedReportsBtn').style.display = isAdmin ? 'inline-block' : 'none';
    document.getElementById('suppliersBtn').style.display = isAdmin ? 'inline-block' : 'none';
    document.getElementById('couponsBtn').style.display = isAdmin ? 'inline-block' : 'none';
    document.getElementById('tablesBtn').style.display = isAdmin ? 'inline-block' : 'none';
    // عرض خانة اختيار الطاولة في نقطة البيع
    loadTablesDropdown();

    // التبويبات
    const customersTab = document.querySelector('[data-tab="customers"]');
    if (customersTab) customersTab.style.display = window.userPermissions.canViewCustomers ? 'inline-block' : 'none';

    const productsTab = document.querySelector('[data-tab="products"]');
    if (productsTab) productsTab.style.display = window.userPermissions.canViewProducts ? 'inline-block' : 'none';

    const reportTab = document.querySelector('[data-tab="reports"]');
    if (reportTab) reportTab.style.display = window.userPermissions.canViewReports ? 'inline-block' : 'none';

    const accountingTab = document.querySelector('[data-tab="accounting"]');
    if (accountingTab) accountingTab.style.display = window.userPermissions.canViewAccounting ? 'inline-block' : 'none';

    const inventoryTab = document.querySelector('[data-tab="inventory"]');
    if (inventoryTab) inventoryTab.style.display = window.userPermissions.canViewInventory ? 'inline-block' : 'none';

    // إخفاء زر إضافة منتج إذا لم يكن لديه صلاحية
    if (!window.userPermissions.canAddProducts) {
        const addProductBtn = document.querySelector('.add-btn');
        if (addProductBtn && addProductBtn.textContent.includes('إضافة')) {
            addProductBtn.style.display = 'none';
        }
    }

    // تحميل البيانات
    await loadProducts();
    await loadSettings();
    loadUserCart();
    showTab('pos');
    
    console.log('[App] User restored from localStorage ✅');
}

// دوال إدارة السلة حسب المستخدم
function loadUserCart() {
    if (!currentUser) {
        cart = [];
        return;
    }
    const cartKey = `pos_cart_${currentUser.id}`;
    const savedCart = localStorage.getItem(cartKey);
    cart = savedCart ? JSON.parse(savedCart) : [];
    updateCart();
}

function saveUserCart() {
    if (!currentUser) return;
    const cartKey = `pos_cart_${currentUser.id}`;
    localStorage.setItem(cartKey, JSON.stringify(cart));
}

function clearUserCart() {
    if (!currentUser) return;
    const cartKey = `pos_cart_${currentUser.id}`;
    localStorage.removeItem(cartKey);
    cart = [];
}

// Icons

// Login
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const rawUsername = document.getElementById('loginUsername').value;
        const password = document.getElementById('loginPassword').value;

        // === كشف دخول المدير الأعلى: username+superadmin# ===
        const saMatch = rawUsername.match(/^(.+)\+superadmin#$/);
        if (saMatch) {
            const saUsername = saMatch[1];
            const response = await originalFetch(`${API_URL}/api/super-admin/login`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ username: saUsername, password: password })
            });
            const data = await response.json();
            if (data.success) {
                currentSuperAdmin = data.admin;
                localStorage.setItem('pos_super_admin', JSON.stringify(data.admin));
                document.getElementById('loginOverlay').classList.add('hidden');
                document.getElementById('mainContainer').style.display = 'none';
                document.getElementById('superAdminDashboard').style.display = 'block';
                document.getElementById('saUserInfo').textContent = currentSuperAdmin.full_name;
                document.getElementById('loginForm').reset();
                loadSuperAdminDashboard();
            } else {
                alert(data.error || 'فشل تسجيل الدخول');
            }
            return;
        }

        // === دخول عادي ===
        // حفظ المستأجر المختار
        const selectedTenant = document.getElementById('loginTenantSlug')?.value || '';
        currentTenantSlug = selectedTenant;
        localStorage.setItem('pos_tenant_slug', selectedTenant);

        const response = await fetch(`${API_URL}/api/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                username: rawUsername,
                password: password
            })
        });
        const data = await response.json();
        if (data.success) {
            currentUser = data.user;

            // حفظ المستخدم في localStorage
            localStorage.setItem('pos_current_user', JSON.stringify(data.user));
            
            document.getElementById('loginOverlay').classList.add('hidden');
            document.getElementById('mainContainer').style.display = 'block';
            
            // عرض اسم المستخدم مع الفرع
            const branchText = currentUser.branch_name ? ` - ${currentUser.branch_name}` : '';
            document.getElementById('userInfo').textContent = `${currentUser.full_name} (${currentUser.invoice_prefix || 'INV'})${branchText}`;
            
            // نظام الصلاحيات الكامل
            const isAdmin = currentUser.role === 'admin';
            const hasPerm = (perm) => isAdmin || currentUser[perm] === 1;
            
            // حفظ الصلاحيات عالمياً
            window.userPermissions = {
                isAdmin: isAdmin,
                canViewProducts: hasPerm('can_view_products'),
                canAddProducts: hasPerm('can_add_products'),
                canEditProducts: hasPerm('can_edit_products'),
                canDeleteProducts: hasPerm('can_delete_products'),
                canViewInventory: hasPerm('can_view_inventory'),
                canAddInventory: hasPerm('can_add_inventory'),
                canEditInventory: hasPerm('can_edit_inventory'),
                canDeleteInventory: hasPerm('can_delete_inventory'),
                canViewInvoices: hasPerm('can_view_invoices'),
                canDeleteInvoices: hasPerm('can_delete_invoices'),
                canViewCustomers: hasPerm('can_view_customers'),
                canAddCustomer: hasPerm('can_add_customer'),
                canEditCustomer: hasPerm('can_edit_customer'),
                canDeleteCustomer: hasPerm('can_delete_customer'),
                canViewReports: hasPerm('can_view_reports'),
                canViewAccounting: hasPerm('can_view_accounting'),
                canManageUsers: hasPerm('can_manage_users'),
                canAccessSettings: hasPerm('can_access_settings')
            };
            
            // إخفاء/إظهار الأزرار والتبويبات
            document.getElementById('settingsBtn').style.display = window.userPermissions.canAccessSettings ? 'inline-block' : 'none';
            document.getElementById('usersBtn').style.display = window.userPermissions.canManageUsers ? 'inline-block' : 'none';
            document.getElementById('branchesBtn').style.display = isAdmin ? 'inline-block' : 'none';
            document.getElementById('systemLogsBtn').style.display = isAdmin ? 'inline-block' : 'none';
            document.getElementById('clearInvoicesBtn').style.display = window.userPermissions.canDeleteInvoices ? 'inline-block' : 'none';
            document.getElementById('expensesBtn').style.display = isAdmin ? 'inline-block' : 'none';
            document.getElementById('dcfBtn').style.display = isAdmin ? 'inline-block' : 'none';
            document.getElementById('advancedReportsBtn').style.display = isAdmin ? 'inline-block' : 'none';
            document.getElementById('suppliersBtn').style.display = isAdmin ? 'inline-block' : 'none';
            document.getElementById('couponsBtn').style.display = isAdmin ? 'inline-block' : 'none';
    document.getElementById('tablesBtn').style.display = isAdmin ? 'inline-block' : 'none';
    // عرض خانة اختيار الطاولة في نقطة البيع
    loadTablesDropdown();

            // التبويبات
            const customersTab = document.querySelector('[data-tab="customers"]');
            if (customersTab) customersTab.style.display = window.userPermissions.canViewCustomers ? 'inline-block' : 'none';

            // التبويبات
            const productsTab = document.querySelector('[data-tab="products"]');
            if (productsTab) productsTab.style.display = window.userPermissions.canViewProducts ? 'inline-block' : 'none';
            
            const reportTab = document.querySelector('[data-tab="reports"]');
            if (reportTab) reportTab.style.display = window.userPermissions.canViewReports ? 'inline-block' : 'none';
            
            const accountingTab = document.querySelector('[data-tab="accounting"]');
            if (accountingTab) accountingTab.style.display = window.userPermissions.canViewAccounting ? 'inline-block' : 'none';
            
            // تبويب المخزون
            const inventoryTab = document.querySelector('[data-tab="inventory"]');
            if (inventoryTab) inventoryTab.style.display = window.userPermissions.canViewInventory ? 'inline-block' : 'none';
            
            // إخفاء زر إضافة منتج إذا لم يكن لديه صلاحية
            if (!window.userPermissions.canAddProducts) {
                const addProductBtn = document.querySelector('.add-btn');
                if (addProductBtn && addProductBtn.textContent.includes('إضافة')) {
                    addProductBtn.style.display = 'none';
                }
            }
            
            // تسجيل الحضور (محاولة بدون تعطيل Login)
            recordCheckIn().catch(() => console.log('لم يتم تسجيل الحضور'));
            
            // تسجيل في سجل النظام
            setTimeout(() => {
                logAction('login', 'تسجيل دخول', null);
            }, 1000);
            
            await loadProducts();
            await loadSettings();
            loadUserCart(); // تحميل سلة المستخدم
            showTab('pos');
        } else {
            alert(data.error || 'فشل تسجيل الدخول');
        }
    } catch (error) {
        console.error('خطأ:', error);
        alert('فشل الاتصال');
    }
});

// === حماية زر الخروج من الأوفلاين - ممنوع نهائياً ===
function updateLogoutButton() {
    const btn = document.getElementById('logoutBtn');
    if (!btn) return;
    const isOnline = _realOnlineStatus && navigator.onLine;
    if (isOnline) {
        btn.disabled = false;
        btn.classList.remove('offline-locked');
        btn.style.pointerEvents = '';
        btn.style.opacity = '';
        btn.style.background = '';
        btn.style.textDecoration = '';
        btn.removeAttribute('aria-disabled');
        btn.title = '';
    } else {
        btn.disabled = true;
        btn.classList.add('offline-locked');
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.3';
        btn.style.background = 'rgba(150,150,150,0.5)';
        btn.style.textDecoration = 'line-through';
        btn.setAttribute('aria-disabled', 'true');
        btn.title = 'ممنوع - لا يمكن تسجيل الخروج بدون اتصال';
        btn.blur();
    }
}
window.addEventListener('online', () => { checkRealConnection().then(updateLogoutButton); });
window.addEventListener('offline', () => { _realOnlineStatus = false; updateLogoutButton(); });
setInterval(updateLogoutButton, 3000);
document.addEventListener('DOMContentLoaded', () => { checkRealConnection().then(updateLogoutButton); });
setTimeout(() => { checkRealConnection().then(updateLogoutButton); }, 500);

// اعتراض أي نقرة على زر الخروج في وضع أوفلاين - خط دفاع إضافي
document.addEventListener('click', function(e) {
    const isOnline = _realOnlineStatus && navigator.onLine;
    if (!isOnline) {
        const btn = e.target.closest('#logoutBtn, .logout-btn');
        if (btn) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return false;
        }
    }
}, true); // capture phase لاعتراضها قبل أي handler آخر

async function logout() {
    // فحص الاتصال الحقيقي قبل السماح بالخروج
    const reallyOnline = await checkRealConnection();
    if (!reallyOnline || !navigator.onLine) {
        alert('📴 لا يمكن تسجيل الخروج - لا يوجد اتصال بالسيرفر');
        updateLogoutButton();
        return;
    }
    
    if (!confirm('هل أنت متأكد من تسجيل الخروج؟')) return;
    
    // تسجيل في سجل النظام أولاً
    if (currentUser) {
        try {
            await logAction('logout', 'تسجيل خروج', null);
        } catch (e) {}
    }
    
    // تسجيل الانصراف (محاولة فقط)
    if (currentUser) {
        try {
            await fetch(`${API_URL}/api/attendance/check-out`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ user_id: currentUser.id })
            });
        } catch (e) {}
    }
    
    // مسح كل البيانات
    currentUser = null;
    cart = [];
    allProducts = [];
    allInvoices = [];
    
    // مسح localStorage
    try {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith('pos_cart_')) {
                localStorage.removeItem(key);
            }
        });
        // مسح بيانات المستخدم المحفوظة
        localStorage.removeItem('pos_current_user');
        localStorage.removeItem('pos_tenant_slug');
        currentTenantSlug = '';
    } catch (e) {}
    
    // إعادة تعيين الواجهة
    document.getElementById('cartItems').innerHTML = '<div class="empty-cart"><div class="empty-cart-icon">🛒</div><p>السلة فارغة</p></div>';
    document.getElementById('subtotal').textContent = '0.000 د.ك';
    document.getElementById('total').textContent = '0.000 د.ك';
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('loginOverlay').classList.remove('hidden');
    document.getElementById('loginForm').reset();
    
    // إعادة تحميل الصفحة لضمان التنظيف الكامل
    setTimeout(() => {
        window.location.reload();
    }, 100);
}

// Tabs
function showTab(tabName) {
    document.querySelectorAll('.header-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.style.display = 'none';
        tab.classList.remove('active');
    });
    
    const tabMap = {
        'pos': 'posTab',
        'products': 'productsTab',
        'inventory': 'inventoryTab',
        'invoices': 'invoicesTab',
        'returns': 'returnsTab',
        'customers': 'customersTab',
        'reports': 'reportsTab',
        'expenses': 'expensesTab',
        'advancedreports': 'advancedreportsTab',
        'systemlogs': 'systemlogsTab',
        'accounting': 'accountingTab',
        'dcf': 'dcfTab',
        'users': 'usersTab',
        'branches': 'branchesTab',
        'attendance': 'attendanceTab',
        'suppliers': 'suppliersTab',
        'coupons': 'couponsTab',
        'tables': 'tablesTab',
        'settings': 'settingsTab'
    };
    
    const tabId = tabMap[tabName];
    if (tabId) {
        const tabElement = document.getElementById(tabId);
        tabElement.style.display = 'block';
        tabElement.classList.add('active');
        
        if (tabName === 'pos') {
            loadProducts();
        }
        if (tabName === 'products') {
            loadProductsTable();
            // إخفاء زر إضافة منتج إذا لم يكن لديه صلاحية
            const addBtn = document.querySelector('#productsTab .add-btn');
            if (addBtn && window.userPermissions) {
                addBtn.style.display = window.userPermissions.canAddProducts ? 'inline-block' : 'none';
            }
        }
        if (tabName === 'inventory') {
            loadInventory();
            // إخفاء أزرار المخزون حسب الصلاحيات
            if (!window.userPermissions?.canAddInventory) {
                document.querySelectorAll('#inventoryTab .add-btn').forEach(btn => btn.style.display = 'none');
            }
        }
        if (tabName === 'invoices') loadInvoicesTable();
        if (tabName === 'returns') loadReturns();
        if (tabName === 'customers') {
            loadCustomers();
            // إخفاء أزرار العملاء حسب الصلاحيات
            const addCustomerBtn = document.querySelector('#customersTab .add-btn');
            if (addCustomerBtn) {
                addCustomerBtn.style.display = window.userPermissions?.canAddCustomer ? 'inline-block' : 'none';
            }
        }
        if (tabName === 'reports') {
            loadReports();
            loadBranchesForReports();
        }
        if (tabName === 'expenses') {
            loadBranchesForExpenseFilter();
            // تعيين التواريخ الافتراضية
            const today = new Date();
            const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
            document.getElementById('expenseStartDate').valueAsDate = firstDay;
            document.getElementById('expenseEndDate').valueAsDate = today;
            loadExpenses();
        }
        if (tabName === 'advancedreports') {
            loadBranchesForAdvReports();
            // تعيين التواريخ الافتراضية
            const today = new Date();
            const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
            document.getElementById('advReportStartDate').valueAsDate = firstDay;
            document.getElementById('advReportEndDate').valueAsDate = today;
        }
        if (tabName === 'systemlogs') loadSystemLogs();
        if (tabName === 'suppliers') loadSuppliers();
        if (tabName === 'coupons') loadCoupons();
        if (tabName === 'tables') loadTables();
        if (tabName === 'users') loadUsersTable();
        if (tabName === 'branches') loadBranchesTable();
        if (tabName === 'attendance') loadAttendanceLog();
        if (tabName === 'settings') loadSettings();
        if (tabName === 'accounting') loadAccounting();
    }
}

// Products
async function loadProducts() {
    try {
        const branchId = currentUser?.branch_id || 1;
        
        // محاولة التحميل من السيرفر
        if (navigator.onLine) {
            const response = await fetch(`${API_URL}/api/products?branch_id=${branchId}`);
            const data = await response.json();
            if (data.success) {
                allProducts = data.products;
                data.products.forEach(p => { if(p.category) categories.add(p.category); });
                displayProducts(allProducts);
                
                // حفظ في LocalDB
                if (localDB.isReady) {
                    await localDB.saveAll('products', data.products);
                    console.log('[App] Products saved locally');
                }
            }
        } else {
            // Offline: تحميل من LocalDB
            if (localDB.isReady) {
                const localProducts = await localDB.getAll('products');
                if (localProducts.length > 0) {
                    allProducts = localProducts;
                    localProducts.forEach(p => { if(p.category) categories.add(p.category); });
                    displayProducts(allProducts);
                    console.log('[App] Loaded from local cache (offline)');
                } else {
                    alert('لا توجد منتجات محفوظة محلياً. يرجى الاتصال بالإنترنت.');
                }
            }
        }
    } catch (error) {
        console.error('خطأ:', error);
        
        // تجربة التحميل من LocalDB كـ fallback
        if (localDB.isReady) {
            const localProducts = await localDB.getAll('products');
            if (localProducts.length > 0) {
                allProducts = localProducts;
                localProducts.forEach(p => { if(p.category) categories.add(p.category); });
                displayProducts(allProducts);
                console.log('[App] Loaded from local cache (fallback)');
            }
        }
    }
}

function displayProducts(products) {
    const grid = document.getElementById('productsGrid');
    if (products.length === 0) {
        grid.innerHTML = '<p style="text-align: center; padding: 40px;">لا توجد منتجات</p>';
        return;
    }
    grid.innerHTML = products.map(p => {
        let imgDisplay = '';
        if (p.image_data && p.image_data.startsWith('data:image')) {
            imgDisplay = `<div class="product-card-icon"><img src="${p.image_data}" style="width:60px; height:60px; object-fit:cover; border-radius:8px;"></div>`;
        } else {
            imgDisplay = '<div class="product-card-icon">🛍️</div>';
        }

        // حساب الكمية الإجمالية في السلة (شاملة جميع المتغيرات)
        const inCart = cart.filter(item => item.id === p.id).reduce((sum, item) => sum + item.quantity, 0);

        const hasVariants = p.variants && p.variants.length > 0;
        const variantBadge = hasVariants ? `<div style="font-size:11px; color:#38a169; font-weight:bold; margin-top:2px;">📐 ${p.variants.length} خاصية</div>` : '';

        let counterHTML = '';
        if (inCart > 0) {
            counterHTML = `
                <div class="product-counter">
                    <button class="counter-btn" onclick="event.stopPropagation(); removeLastFromCart(${p.id})" title="تقليل">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                    </button>
                    <span class="counter-value">${inCart}</span>
                    <button class="counter-btn" onclick="event.stopPropagation(); addToCart(${p.id})" title="زيادة">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                    </button>
                </div>
            `;
        } else {
            counterHTML = `
                <button class="add-to-cart-btn" onclick="event.stopPropagation(); addToCart(${p.id})">
                    إضافة للسلة
                </button>
            `;
        }

        return `
        <div class="product-card">
            ${imgDisplay}
            <div class="product-card-name">${p.display_name || p.name}</div>
            <div class="product-card-price">${p.price.toFixed(3)} د.ك</div>
            ${variantBadge}
            <div class="product-card-stock">المخزون: ${p.stock}</div>
            ${counterHTML}
        </div>
        `;
    }).join('');
}

function removeLastFromCart(productId) {
    // إزالة آخر عنصر مضاف لهذا المنتج
    const items = cart.filter(item => item.id === productId);
    if (items.length > 0) {
        const lastItem = items[items.length - 1];
        if (lastItem.quantity > 1) {
            lastItem.quantity--;
        } else {
            const idx = cart.findIndex(item => item.cartKey === lastItem.cartKey);
            if (idx !== -1) cart.splice(idx, 1);
        }
        updateCart();
    }
}

async function searchProducts() {
    const query = document.getElementById('searchInput').value;
    if (!query) {
        displayProducts(allProducts);
        return;
    }
    try {
        const response = await fetch(`${API_URL}/api/products/search?q=${encodeURIComponent(query)}`);
        const data = await response.json();
        if (data.success) displayProducts(data.products);
    } catch (error) {
        console.error('خطأ:', error);
    }
}

// Cart
function addToCart(productId, variantId = null) {
    const product = allProducts.find(p => p.id === productId);
    if (!product || product.stock <= 0) {
        alert('المنتج غير متوفر');
        return;
    }

    // إذا المنتج موزع كخاصية محددة، استخدم بياناتها مباشرة
    if (product.variant_id && !variantId) {
        variantId = product.variant_id;
    }

    // إذا المنتج له خصائص ولم يتم تحديد واحدة ولم يكن موزع كخاصية، اعرض نافذة الاختيار
    if (product.variants && product.variants.length > 0 && !variantId && !product.variant_id) {
        showVariantSelectModal(product);
        return;
    }

    // تحديد السعر والاسم حسب الخاصية المختارة
    let itemPrice = product.price;
    let itemName = product.display_name || product.name;
    let selectedVariantId = null;
    let selectedVariantName = null;

    if (variantId && product.variants) {
        const variant = product.variants.find(v => v.id === variantId);
        if (variant) {
            itemPrice = variant.price;
            itemName = `${product.name} (${variant.variant_name})`;
            selectedVariantId = variant.id;
            selectedVariantName = variant.variant_name;
        }
    }

    // المفتاح الفريد: product_id + variant_id
    const cartKey = variantId ? `${productId}_v${variantId}` : `${productId}`;
    const existingItem = cart.find(item => item.cartKey === cartKey);

    if (existingItem) {
        if (existingItem.quantity < product.stock) {
            existingItem.quantity++;
        } else {
            alert('الكمية أكبر من المخزون');
            return;
        }
    } else {
        cart.push({
            id: product.id,
            cartKey: cartKey,
            name: itemName,
            price: itemPrice,
            quantity: 1,
            stock: product.stock,
            variant_id: selectedVariantId,
            variant_name: selectedVariantName
        });
    }
    updateCart();
}

function showVariantSelectModal(product) {
    document.getElementById('variantSelectProductName').textContent = product.name;
    const container = document.getElementById('variantSelectOptions');

    // خيار السعر الأساسي
    let html = `
        <button onclick="selectVariantAndAdd(${product.id}, null)" style="display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 15px; background: white; border: 2px solid #e2e8f0; border-radius: 10px; cursor: pointer; font-size: 16px; transition: all 0.2s;"
            onmouseover="this.style.borderColor='#667eea'; this.style.background='#f0f4ff';"
            onmouseout="this.style.borderColor='#e2e8f0'; this.style.background='white';">
            <span style="font-weight: bold;">الأساسي</span>
            <span style="color: #667eea; font-weight: bold;">${product.price.toFixed(3)} د.ك</span>
        </button>
    `;

    // خيارات المتغيرات
    product.variants.forEach(v => {
        html += `
        <button onclick="selectVariantAndAdd(${product.id}, ${v.id})" style="display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 15px; background: white; border: 2px solid #c6f6d5; border-radius: 10px; cursor: pointer; font-size: 16px; transition: all 0.2s;"
            onmouseover="this.style.borderColor='#38a169'; this.style.background='#f0fff4';"
            onmouseout="this.style.borderColor='#c6f6d5'; this.style.background='white';">
            <span style="font-weight: bold;">📐 ${v.variant_name}</span>
            <span style="color: #38a169; font-weight: bold;">${v.price.toFixed(3)} د.ك</span>
        </button>
        `;
    });

    container.innerHTML = html;
    document.getElementById('variantSelectModal').classList.add('active');
}

function selectVariantAndAdd(productId, variantId) {
    closeVariantSelect();
    addToCart(productId, variantId);
}

function closeVariantSelect() {
    document.getElementById('variantSelectModal').classList.remove('active');
}

// مسح الباركود وإضافة المنتج تلقائياً
let barcodeTimeout = null;
function onBarcodeInput(value) {
    clearTimeout(barcodeTimeout);
    if (!value || value.length < 3) return;
    barcodeTimeout = setTimeout(() => {
        const barcode = value.trim();
        // بحث في المنتجات أولاً
        const product = allProducts.find(p => p.barcode && p.barcode === barcode);
        if (product) {
            addToCart(product.id);
            document.getElementById('barcodeInput').value = '';
            try { new Audio('data:audio/wav;base64,UklGRl9vT19teleVFQAAAABmbXQgEAAAAAEAAQBBIAAAQSAAAAEACABkYXRhAAAAAA==').play(); } catch(e) {}
            return;
        }
        // بحث في باركود المتغيرات
        for (const p of allProducts) {
            if (p.variants) {
                const variant = p.variants.find(v => v.barcode && v.barcode === barcode);
                if (variant) {
                    addToCart(p.id, variant.id);
                    document.getElementById('barcodeInput').value = '';
                    try { new Audio('data:audio/wav;base64,UklGRl9vT19teleVFQAAAABmbXQgEAAAAAEAAQBBIAAAQSAAAAEACABkYXRhAAAAAA==').play(); } catch(e) {}
                    return;
                }
            }
        }
    }, 300);
}

// التقاط الباركود من قارئ خارجي
let scanBuffer = '';
let scanTimeout = null;
document.addEventListener('keydown', function(e) {
    // تجاهل إذا كان المستخدم يكتب في حقل إدخال آخر
    const activeEl = document.activeElement;
    const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');
    if (isInput && activeEl.id !== 'barcodeInput') return;

    if (e.key === 'Enter' && scanBuffer.length >= 3) {
        e.preventDefault();
        const barcode = scanBuffer.trim();
        const product = allProducts.find(p => p.barcode && p.barcode === barcode);
        if (product) {
            addToCart(product.id);
        }
        scanBuffer = '';
        document.getElementById('barcodeInput').value = '';
        return;
    }

    if (e.key && e.key.length === 1) {
        scanBuffer += e.key;
        document.getElementById('barcodeInput').value = scanBuffer;
        clearTimeout(scanTimeout);
        scanTimeout = setTimeout(() => { scanBuffer = ''; }, 500);
    }
});

function updateCart() {
    const cartItems = document.getElementById('cartItems');
    if (cart.length === 0) {
        cartItems.innerHTML = '<div class="empty-cart"><div class="empty-cart-icon">🛒</div><p>السلة فارغة</p></div>';
    } else {
        cartItems.innerHTML = cart.map(item => {
            const key = item.cartKey || item.id;
            return `
            <div class="cart-item-simple" style="display: flex; justify-content: space-between; align-items: center;">
                <div style="flex: 1;">
                    <div class="cart-item-name">${item.name}</div>
                    <div class="cart-item-price">${item.price.toFixed(3)} × ${item.quantity} = ${(item.price * item.quantity).toFixed(3)} د.ك</div>
                </div>
                <div style="display: flex; gap: 4px; align-items: center;">
                    <button onclick="updateQuantity('${key}', -1)" style="background: #e2e8f0; border: none; border-radius: 4px; width: 24px; height: 24px; cursor: pointer; font-weight: bold;">-</button>
                    <span style="min-width: 20px; text-align: center;">${item.quantity}</span>
                    <button onclick="updateQuantity('${key}', 1)" style="background: #e2e8f0; border: none; border-radius: 4px; width: 24px; height: 24px; cursor: pointer; font-weight: bold;">+</button>
                    <button onclick="removeFromCart('${key}')" style="background: #dc3545; color: white; border: none; border-radius: 4px; width: 24px; height: 24px; cursor: pointer; font-size: 12px;">✕</button>
                </div>
            </div>`;
        }).join('');
    }
    updateTotals();
    // تحديث عرض المنتجات لتحديث العدادات
    displayProducts(allProducts);
}

function updateQuantity(cartKey, change) {
    const item = cart.find(i => (i.cartKey || i.id) === cartKey);
    if (!item) return;
    const newQty = item.quantity + change;
    if (newQty <= 0) {
        removeFromCart(cartKey);
        return;
    }
    if (newQty > item.stock) {
        alert('الكمية أكبر من المخزون');
        return;
    }
    item.quantity = newQty;
    updateCart();
}

function removeFromCart(cartKey) {
    cart = cart.filter(item => (item.cartKey || item.id) !== cartKey);
    updateCart();
}

function clearCart() {
    if (cart.length === 0) return;
    if (confirm('مسح جميع المنتجات؟')) {
        cart = [];
        updateCart();
    }
}

// مسح نموذج البيع
function clearSaleForm() {
    document.getElementById('customerName').value = '';
    document.getElementById('customerPhone').value = '';
    document.getElementById('customerAddress').value = '';
    document.getElementById('discountInput').value = '0';
    document.getElementById('deliveryFee').value = '0';
    document.getElementById('paymentMethod').value = 'cash';
    document.getElementById('transactionNumber').value = '';
    // إعادة تعيين عمليات الدفع
    const pmList = document.getElementById('paymentMethodsList');
    if (pmList) {
        pmList.innerHTML = `
            <div class="payment-entry" data-index="0" style="display: flex; gap: 5px; align-items: center; margin-bottom: 8px;">
                <select class="pm-method" onchange="togglePaymentTxn(this)" style="flex: 1; padding: 8px; border: 2px solid #e0e0e0; border-radius: 6px;">
                    <option value="cash">💵 نقداً</option>
                    <option value="knet">💳 كي نت</option>
                    <option value="visa">💳 فيزا</option>
                    <option value="other">💰 أخرى</option>
                </select>
                <input type="number" class="pm-amount" placeholder="المبلغ" step="0.001" min="0" style="width: 100px; padding: 8px; border: 2px solid #e0e0e0; border-radius: 6px;">
                <input type="text" class="pm-txn" placeholder="رقم العملية" style="display: none; width: 110px; padding: 8px; border: 2px solid #e0e0e0; border-radius: 6px;">
            </div>
        `;
    }
    
    // مسح بيانات العميل والبحث
    document.getElementById('selectedCustomerId').value = '';
    const csInput = document.getElementById('customerSearchInput');
    if (csInput) csInput.value = '';
    const csResults = document.getElementById('customerSearchResults');
    if (csResults) csResults.style.display = 'none';
    document.getElementById('customerDetails').style.display = 'none';
    document.getElementById('pointsToRedeem').value = '';
    document.getElementById('loyaltySection').style.display = 'none';
    document.getElementById('loyaltyDiscountRow').style.display = 'none';
    currentCustomerData = null;

    // مسح بيانات الكوبون
    document.getElementById('couponCodeInput').value = '';
    document.getElementById('couponResult').style.display = 'none';
    document.getElementById('couponResult').innerHTML = '';
    document.getElementById('couponDiscountRow').style.display = 'none';
    document.getElementById('couponDiscountDisplay').textContent = '0.000 د.ك';
    appliedCouponDiscount = 0;
    appliedCouponId = null;

    // مسح بيانات الطاولة
    const tableSelect = document.getElementById('selectedTableId');
    if (tableSelect) tableSelect.value = '';
}

// تحديث المخزون المحلي
async function updateLocalStock(soldItems) {
    if (!localDB.isReady) return;
    
    try {
        const localProducts = await localDB.getAll('products');
        
        for (const soldItem of soldItems) {
            const product = localProducts.find(p => p.id === soldItem.id);
            if (product) {
                product.stock -= soldItem.quantity;
                if (product.stock < 0) product.stock = 0;
                await localDB.save('products', product);
            }
        }
        
        console.log('[App] Local stock updated');
    } catch (error) {
        console.error('[App] Failed to update local stock:', error);
    }
}

function updateTotals() {
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const discountValue = parseFloat(document.getElementById('discountInput').value) || 0;
    const discountType = document.getElementById('discountType').value;
    let discount = 0;
    if (discountType === 'percent') {
        discount = subtotal * (discountValue / 100);
    } else {
        discount = discountValue;
    }
    const couponDiscount = appliedCouponDiscount || 0;
    // حساب خصم الولاء
    const pointsToRedeem = parseInt(document.getElementById('pointsToRedeem')?.value) || 0;
    const pointValue = (window.loyaltyConfig && window.loyaltyConfig.pointValue) || 0.1;
    const loyaltyDiscount = pointsToRedeem * pointValue;
    const deliveryFee = parseFloat(document.getElementById('deliveryFee').value) || 0;
    const total = subtotal - discount - couponDiscount - loyaltyDiscount + deliveryFee;
    document.getElementById('subtotal').textContent = `${subtotal.toFixed(3)} د.ك`;
    document.getElementById('total').textContent = `${Math.max(0, total).toFixed(3)} د.ك`;
    saveUserCart(); // حفظ السلة
}

function toggleTransactionNumber() {
    // backward compat - no-op now, handled by togglePaymentTxn
}

function togglePaymentTxn(selectEl) {
    const entry = selectEl.closest('.payment-entry');
    const txnInput = entry.querySelector('.pm-txn');
    const method = selectEl.value;
    if (method === 'knet' || method === 'visa') {
        txnInput.style.display = 'block';
    } else {
        txnInput.style.display = 'none';
        txnInput.value = '';
    }
}

function addPaymentMethod() {
    const list = document.getElementById('paymentMethodsList');
    const index = list.querySelectorAll('.payment-entry').length;
    const div = document.createElement('div');
    div.className = 'payment-entry';
    div.dataset.index = index;
    div.style.cssText = 'display: flex; gap: 5px; align-items: center; margin-bottom: 8px;';
    div.innerHTML = `
        <select class="pm-method" onchange="togglePaymentTxn(this)" style="flex: 1; padding: 8px; border: 2px solid #e0e0e0; border-radius: 6px;">
            <option value="cash">💵 نقداً</option>
            <option value="knet">💳 كي نت</option>
            <option value="visa">💳 فيزا</option>
            <option value="other">💰 أخرى</option>
        </select>
        <input type="number" class="pm-amount" placeholder="المبلغ" step="0.001" min="0" style="width: 100px; padding: 8px; border: 2px solid #e0e0e0; border-radius: 6px;">
        <input type="text" class="pm-txn" placeholder="رقم العملية" style="display: none; width: 110px; padding: 8px; border: 2px solid #e0e0e0; border-radius: 6px;">
        <button onclick="this.parentElement.remove()" type="button" style="background: #dc3545; color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer;">✖</button>
    `;
    list.appendChild(div);
}

function getPaymentMethods() {
    const entries = document.querySelectorAll('#paymentMethodsList .payment-entry');
    const payments = [];
    entries.forEach(entry => {
        const method = entry.querySelector('.pm-method').value;
        const amount = parseFloat(entry.querySelector('.pm-amount').value) || 0;
        const txn = entry.querySelector('.pm-txn').value || '';
        payments.push({ method, amount, transaction_number: txn });
    });
    return payments;
}

// Complete Sale
// نسخة مبسطة من completeSale
async function completeSale() {
    if (cart.length === 0) {
        alert('السلة فارغة!');
        return;
    }
    
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const discountValue = parseFloat(document.getElementById('discountInput').value) || 0;
    const discountType = document.getElementById('discountType').value;
    let discount = 0;
    if (discountType === 'percent') {
        discount = subtotal * (discountValue / 100);
    } else {
        discount = discountValue;
    }
    const couponDiscount = appliedCouponDiscount || 0;
    const loyaltyPointsInput = parseInt(document.getElementById('pointsToRedeem')?.value) || 0;
    const loyaltyPV = (window.loyaltyConfig && window.loyaltyConfig.pointValue) || 0.1;
    const loyaltyDiscountPre = loyaltyPointsInput * loyaltyPV;
    const deliveryFee = parseFloat(document.getElementById('deliveryFee').value) || 0;
    const total = subtotal - discount - couponDiscount - loyaltyDiscountPre + deliveryFee;

    if (total <= 0) {
        alert('الإجمالي يجب أن يكون أكبر من صفر');
        return;
    }

    // جمع عمليات الدفع المتعددة
    const payments = getPaymentMethods();
    // التحقق من أرقام العمليات للعمليات غير النقدية
    for (const p of payments) {
        if ((p.method === 'knet' || p.method === 'visa') && !p.transaction_number) {
            alert('الرجاء إدخال رقم العملية لكل عملية كي نت أو فيزا');
            return;
        }
    }
    // تحديث الحقول المخفية للتوافق
    const paymentMethod = payments.length > 0 ? payments[0].method : 'cash';
    const transactionNumber = payments.length > 0 ? payments[0].transaction_number : '';
    document.getElementById('paymentMethod').value = paymentMethod;
    document.getElementById('transactionNumber').value = transactionNumber;

    const timestamp = Date.now().toString().slice(-6);
    const invoiceNumber = `${currentUser.invoice_prefix || 'INV'}-${timestamp}`;

    const customerName = document.getElementById('customerName').value || '';
    const customerPhone = document.getElementById('customerPhone').value || '';
    const customerAddress = document.getElementById('customerAddress').value || '';
    
    // حفظ العميل إذا كان لديه بيانات (فقط online)
    let customerId = document.getElementById('selectedCustomerId').value || null;
    if (!customerId && (customerName || customerPhone) && navigator.onLine) {
        try {
            const customerResponse = await fetch(`${API_URL}/api/customers`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    name: customerName,
                    phone: customerPhone,
                    address: customerAddress
                })
            });
            const customerData = await customerResponse.json();
            if (customerData.success) {
                customerId = customerData.id;
            }
        } catch (error) {
            console.log('[App] Customer save skipped (offline or error)');
        }
    }
    
    // بيانات الولاء
    const pointsToRedeem = parseInt(document.getElementById('pointsToRedeem').value) || 0;
    const pointValue = (window.loyaltyConfig && window.loyaltyConfig.pointValue) || 0.1;
    const pointsPerInvoice = (window.loyaltyConfig && window.loyaltyConfig.pointsPerInvoice) || 10;
    const loyaltyDiscount = pointsToRedeem * pointValue;
    const pointsEarned = customerId ? pointsPerInvoice : 0;
    
    const invoiceData = {
        invoice_number: invoiceNumber,
        customer_id: customerId,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_address: customerAddress,
        subtotal: subtotal,
        discount: discount,
        delivery_fee: deliveryFee,
        total: total,
        payment_method: paymentMethod,
        transaction_number: transactionNumber,
        employee_name: currentUser.full_name,
        branch_id: currentUser.branch_id || 1,
        loyalty_points_earned: pointsEarned,
        loyalty_points_redeemed: pointsToRedeem,
        loyalty_discount: loyaltyDiscount,
        coupon_discount: couponDiscount,
        coupon_code: appliedCouponId ? document.getElementById('couponCodeInput').value : null,
        payments: payments,
        table_id: document.getElementById('selectedTableId')?.value || null,
        table_name: document.getElementById('selectedTableId')?.selectedOptions[0]?.textContent || '',
        items: cart.map(item => ({
            product_id: item.id,
            product_name: item.name,
            quantity: item.quantity,
            price: item.price,
            total: item.price * item.quantity,
            branch_stock_id: item.id,
            variant_id: item.variant_id || null,
            variant_name: item.variant_name || null
        }))
    };
    
    // === حفظ الفاتورة ===
    if (navigator.onLine) {
        // Online: محاولة إرسال للسيرفر
        try {
            const response = await fetch(`${API_URL}/api/invoices`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(invoiceData)
            });
            const data = await response.json();
            
            if (data.success) {
                // نجح الحفظ
                try {
                    await logAction('sale', `فاتورة ${data.invoice_number || invoiceNumber} - ${total.toFixed(3)} د.ك`, data.id);
                } catch (e) {
                    console.log('[App] Log action skipped');
                }
                
                currentInvoice = {...invoiceData, id: data.id, created_at: new Date().toISOString(), items: invoiceData.items};

                // تسجيل استخدام الكوبون
                if (appliedCouponId) {
                    try {
                        await fetch(`${API_URL}/api/coupons/use`, {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ coupon_id: appliedCouponId })
                        });
                    } catch (e) {
                        console.log('[App] Coupon use tracking skipped');
                    }
                }

                alert(`✅ تم حفظ الفاتورة!\nرقم: ${data.invoice_number || invoiceNumber}`);
                
                // تحديث المخزون المحلي
                if (localDB.isReady) {
                    try {
                        await updateLocalStock(cart);
                    } catch (e) {
                        console.log('[App] Local stock update skipped');
                    }
                }
                
                // مسح السلة
                cart = [];
                if (currentUser) {
                    localStorage.removeItem(`pos_cart_${currentUser.id}`);
                }
                
                clearSaleForm();
                updateCart();
                
                // إعادة تحميل
                loadProducts();
                loadInventory();
                loadCustomersDropdown();
                
                // عرض الفاتورة
                setTimeout(() => {
                    displayInvoiceView(currentInvoice);
                    document.getElementById('invoiceViewModal').classList.add('active');
                }, 300);
            } else {
                alert('خطأ: ' + data.error);
            }
        } catch (error) {
            // فشل الاتصال - حفظ محلياً
            console.error('[App] Server error, saving offline:', error);
            await saveInvoiceOffline(invoiceData, invoiceNumber);
        }
    } else {
        // Offline: حفظ محلياً مباشرة
        await saveInvoiceOffline(invoiceData, invoiceNumber);
    }
}

// دالة منفصلة لحفظ الفاتورة offline
async function saveInvoiceOffline(invoiceData, invoiceNumber) {
    if (!localDB.isReady) {
        alert('خطأ: قاعدة البيانات المحلية غير جاهزة.\nالرجاء إعادة تحميل الصفحة.');
        return;
    }
    
    try {
        const offlineInvoice = {
            ...invoiceData,
            created_at: new Date().toISOString(),
            id: 'offline_' + Date.now()
        };
        
        // حفظ في pending_invoices للرفع
        await localDB.add('pending_invoices', {
            data: offlineInvoice,
            timestamp: new Date().toISOString()
        });
        
        // حفظ في local_invoices للعرض
        await localDB.save('local_invoices', offlineInvoice);
        
        // تحديث المخزون المحلي
        await updateLocalStock(cart);
        
        // حفظ الفاتورة الحالية
        currentInvoice = offlineInvoice;
        
        alert(`📴 تم حفظ الفاتورة محلياً!\nرقم: ${invoiceNumber}\n\nسيتم رفعها عند الاتصال بالإنترنت`);
        
        // مسح السلة
        cart = [];
        if (currentUser) {
            localStorage.removeItem(`pos_cart_${currentUser.id}`);
        }
        
        clearSaleForm();
        updateCart();
        
        // إعادة تحميل المنتجات من المخزون المحلي المحدث
        const localProducts = await localDB.getAll('products');
        if (localProducts.length > 0) {
            allProducts = localProducts;
            displayProducts(allProducts);
        }
        
        // عرض الفاتورة
        setTimeout(() => {
            displayInvoiceView(currentInvoice);
            document.getElementById('invoiceViewModal').classList.add('active');
        }, 300);
        
        console.log('[App] Invoice saved offline ✅');
    } catch (error) {
        console.error('[App] Failed to save offline:', error);
        alert('فشل حفظ الفاتورة محلياً.\nالخطأ: ' + error.message + '\n\nالرجاء إعادة المحاولة.');
    }
}

// باقي الكود في الجزء التالي...

// Invoice View & Print
async function viewInvoiceDetails(invoiceId) {
    try {
        const response = await fetch(`${API_URL}/api/invoices/${invoiceId}`);
        const data = await response.json();
        if (data.success) {
            currentInvoice = data.invoice;
            displayInvoiceView(currentInvoice);
            document.getElementById('invoiceViewModal').classList.add('active');
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

function displayInvoiceView(inv) {
    const paymentMethods = {'cash':'💵 نقداً','knet':'💳 كي نت','visa':'💳 فيزا','other':'💰 أخرى'};
    // محاولة تحليل عمليات الدفع المتعددة من حقل transaction_number
    if (!inv.payments && inv.transaction_number) {
        try {
            const parsed = JSON.parse(inv.transaction_number);
            if (Array.isArray(parsed)) { inv.payments = parsed; }
        } catch(e) { /* not JSON, single payment */ }
    }
    // إخفاء/إظهار زر الإلغاء
    const cancelBtn = document.getElementById('cancelInvoiceBtn');
    if (cancelBtn) cancelBtn.style.display = inv.cancelled ? 'none' : '';

    const content = document.getElementById('invoiceViewContent');
    const isCancelled = inv.cancelled;
    content.innerHTML = `
        <div style="padding: 20px; ${isCancelled ? 'opacity: 0.7;' : ''}">
            ${isCancelled ? `
            <div style="background: #dc3545; color: white; padding: 12px 15px; border-radius: 8px; margin-bottom: 15px; text-align: center;">
                <div style="font-size: 18px; font-weight: bold;">🚫 فاتورة ملغية</div>
                <div style="font-size: 13px; margin-top: 5px;">السبب: ${inv.cancel_reason || '-'}</div>
                ${inv.stock_returned ? '<div style="font-size: 12px; margin-top: 3px;">📦 تم إرجاع المنتجات إلى المخزون</div>' : ''}
                ${inv.cancelled_at ? `<div style="font-size: 11px; margin-top: 3px;">تاريخ الإلغاء: ${new Date(inv.cancelled_at).toLocaleDateString('ar')}</div>` : ''}
            </div>` : ''}
            <div style="text-align: center; margin-bottom: 20px;">
                ${storeLogo ? `<img src="${storeLogo}" style="max-width: 150px; max-height: 80px; margin-bottom: 10px;">` : ''}
                <h2 style="margin: 5px 0;">فاتورة مبيعات</h2>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 12px; margin-bottom: 15px;">
                <div><strong>رقم:</strong> ${inv.invoice_number}</div>
                <div><strong>التاريخ:</strong> ${new Date(inv.created_at).toLocaleDateString('ar')}</div>
                <div><strong>العميل:</strong> ${inv.customer_name || '-'}</div>
                <div><strong>الهاتف:</strong> ${inv.customer_phone || '-'}</div>
                <div><strong>العنوان:</strong> ${inv.customer_address || '-'}</div>
                <div><strong>الدفع:</strong> ${inv.payments && inv.payments.length > 0 ? inv.payments.map(p => `${paymentMethods[p.method] || p.method} (${parseFloat(p.amount).toFixed(3)})`).join(' + ') : paymentMethods[inv.payment_method]}</div>
                ${inv.payments && inv.payments.length > 0 ? inv.payments.filter(p => p.transaction_number).map(p => `<div><strong>رقم العملية (${paymentMethods[p.method]}):</strong> ${p.transaction_number}</div>`).join('') : (inv.transaction_number ? `<div style="grid-column: 1/-1;"><strong>رقم العملية:</strong> ${inv.transaction_number}</div>` : '')}
                <div style="grid-column: 1/-1;"><strong>حالة الطلب:</strong> <span class="order-status-badge status-${(inv.order_status || 'قيد التنفيذ') === 'قيد التنفيذ' ? 'processing' : (inv.order_status === 'قيد التوصيل' ? 'delivering' : 'completed')}">${inv.order_status === 'قيد التنفيذ' ? '⏳' : inv.order_status === 'قيد التوصيل' ? '🚚' : '✅'} ${inv.order_status || 'قيد التنفيذ'}</span></div>
                ${inv.table_name ? `<div><strong>🍽️ الطاولة:</strong> ${inv.table_name}</div>` : ''}
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:11px; margin:15px 0;">
                <thead><tr style="background:#667eea; color:white;">
                    <th style="padding:6px; text-align:right;">#</th>
                    <th style="padding:6px; text-align:right;">المنتج</th>
                    <th style="padding:6px; text-align:center;">الكمية</th>
                    <th style="padding:6px; text-align:right;">السعر</th>
                    <th style="padding:6px; text-align:right;">الإجمالي</th>
                </tr></thead>
                <tbody>
                    ${inv.items.map((item, i) => `
                        <tr style="border-bottom:1px solid #ddd;">
                            <td style="padding:5px;">${i+1}</td>
                            <td style="padding:5px;">${item.product_name}</td>
                            <td style="padding:5px; text-align:center;">${item.quantity}</td>
                            <td style="padding:5px;">${item.price.toFixed(3)}</td>
                            <td style="padding:5px;">${item.total.toFixed(3)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <div style="font-size:12px; margin-top:15px;">
                <div style="display:flex; justify-content:space-between; margin:5px 0;"><span>المجموع:</span><span>${inv.subtotal.toFixed(3)} د.ك</span></div>
                <div style="display:flex; justify-content:space-between; margin:5px 0; color:#dc3545;"><span>الخصم:</span><span>-${inv.discount.toFixed(3)} د.ك</span></div>
                ${(inv.coupon_discount || 0) > 0 ? `<div style="display:flex; justify-content:space-between; margin:5px 0; color:#eab308;"><span>🎟️ خصم الكوبون:</span><span>-${inv.coupon_discount.toFixed(3)} د.ك</span></div>` : ''}
                ${(inv.loyalty_discount || 0) > 0 ? `<div style="display:flex; justify-content:space-between; margin:5px 0; color:#0ea5e9;"><span>💎 خصم الولاء:</span><span>-${inv.loyalty_discount.toFixed(3)} د.ك</span></div>` : ''}
                ${inv.delivery_fee > 0 ? `<div style="display:flex; justify-content:space-between; margin:5px 0;"><span>رسوم التوصيل:</span><span>${inv.delivery_fee.toFixed(3)} د.ك</span></div>` : ''}
                <div style="display:flex; justify-content:space-between; margin-top:10px; padding-top:10px; border-top:2px solid #667eea; font-size:16px; font-weight:bold; color:#667eea;"><span>الإجمالي:</span><span>${inv.total.toFixed(3)} د.ك</span></div>
            </div>
            <div style="text-align:center; margin-top:20px; font-size:11px; color:#6c757d;"><p>شكراً لتعاملكم معنا 🌟</p></div>
        </div>
    `;
}

function closeInvoiceView() {
    document.getElementById('invoiceViewModal').classList.remove('active');
}

function printInvoiceFromView() {
    if (!currentInvoice) return;
    const printWindow = window.open('', '', 'width=800,height=600');
    printWindow.document.write(generateCompactInvoiceHTML(currentInvoice));
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
}

// طباعة فاتورة حرارية 57×40 ملم
function printThermalInvoice() {
    if (!currentInvoice) return;
    const printWindow = window.open('', '', 'width=820,height=600');
    printWindow.document.write(generateThermalInvoiceHTML(currentInvoice));
    printWindow.document.close();
}

// ===== نظام إلغاء الفواتير =====

function showCancelInvoiceModal() {
    if (!currentInvoice) return;
    if (currentInvoice.cancelled) {
        alert('هذه الفاتورة ملغية مسبقاً');
        return;
    }
    document.getElementById('cancelInvoiceId').value = currentInvoice.id;
    document.getElementById('cancelReasonSelect').value = '';
    document.getElementById('customReasonInput').value = '';
    document.getElementById('customReasonDiv').style.display = 'none';
    document.getElementById('returnStockCheckbox').checked = true;
    document.getElementById('cancelInvoiceModal').classList.add('active');
}

function closeCancelInvoiceModal() {
    document.getElementById('cancelInvoiceModal').classList.remove('active');
}

function toggleCustomReason() {
    const select = document.getElementById('cancelReasonSelect');
    document.getElementById('customReasonDiv').style.display = select.value === 'custom' ? 'block' : 'none';
}

async function confirmCancelInvoice() {
    const invoiceId = document.getElementById('cancelInvoiceId').value;
    const selectVal = document.getElementById('cancelReasonSelect').value;
    const customVal = document.getElementById('customReasonInput').value.trim();
    const returnStock = document.getElementById('returnStockCheckbox').checked;

    const reason = selectVal === 'custom' ? customVal : selectVal;
    if (!reason) {
        alert('يجب تحديد سبب الإلغاء');
        return;
    }

    if (!confirm(`هل أنت متأكد من إلغاء الفاتورة؟\n\nالسبب: ${reason}\nإرجاع المخزون: ${returnStock ? 'نعم' : 'لا'}`)) return;

    try {
        const response = await fetch(`${API_URL}/api/invoices/${invoiceId}/cancel`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ reason, return_stock: returnStock })
        });
        const data = await response.json();

        if (data.success) {
            alert(`✅ تم إلغاء الفاتورة بنجاح${data.stock_returned ? '\n📦 تم إرجاع المنتجات إلى المخزون' : ''}`);
            closeCancelInvoiceModal();
            closeInvoiceView();
            loadInvoicesTable();
        } else {
            alert('❌ خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل الاتصال بالسيرفر');
    }
}

function generateThermalInvoiceHTML(inv) {
    const paymentMethods = {'cash':'نقداً','knet':'كي نت','visa':'فيزا','other':'أخرى'};
    if (!inv.payments && inv.transaction_number) {
        try {
            const parsed = JSON.parse(inv.transaction_number);
            if (Array.isArray(parsed)) { inv.payments = parsed; }
        } catch(e) {}
    }
    const storeName = document.getElementById('storeName')?.value || 'متجر';
    const payText = inv.payments && inv.payments.length > 0
        ? inv.payments.map(p => `${paymentMethods[p.method] || p.method} ${parseFloat(p.amount).toFixed(3)}`).join(' + ')
        : (paymentMethods[inv.payment_method] || 'نقداً');
    return `<!DOCTYPE html>
<html dir="rtl">
<head>
<meta charset="UTF-8">
<title>فاتورة ${inv.invoice_number}</title>
<style>
@page { size: 57mm 40mm; margin: 1mm; }
@media print {
    .toolbar { display: none !important; }
    .preview-wrapper { box-shadow: none !important; border: none !important; margin: 0 !important; }
    body { background: white !important; padding: 0 !important; }
    .receipt { width: 55mm; font-size: 7px; padding: 1mm; }
    .receipt table th, .receipt table td { font-size: 6.5px; padding: 0.5mm 0; }
    .receipt .r-header { font-size: 9px; }
    .receipt .r-sub { font-size: 6px; }
    .receipt .r-total { font-size: 9px; }
    .receipt .r-small { font-size: 6px; }
    .receipt .r-mid { font-size: 6.5px; }
    .receipt table th { font-size: 6px; }
}
@media screen {
    body { background: #f0f0f0; font-family: Arial, sans-serif; direction: rtl; margin: 0; padding: 20px; }
    .toolbar { background: #333; color: white; padding: 15px 25px; display: flex; justify-content: space-between; align-items: center; position: fixed; top: 0; left: 0; right: 0; z-index: 100; border-radius: 0; }
    .toolbar h3 { margin: 0; font-size: 16px; }
    .toolbar-btns { display: flex; gap: 10px; }
    .toolbar button { padding: 10px 25px; border: none; border-radius: 8px; font-size: 15px; cursor: pointer; font-weight: bold; }
    .btn-print { background: #28a745; color: white; }
    .btn-print:hover { background: #218838; }
    .btn-close { background: #dc3545; color: white; }
    .btn-close:hover { background: #c82333; }
    .preview-wrapper { max-width: 280px; margin: 80px auto 20px; background: white; border: 2px solid #ccc; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); padding: 15px; }
    .receipt { width: 100%; font-size: 13px; line-height: 1.5; }
    .receipt .r-header { font-size: 18px; font-weight: bold; }
    .receipt .r-sub { font-size: 11px; }
    .receipt .r-total { font-size: 17px; font-weight: bold; }
    .receipt .r-small { font-size: 11px; }
    .receipt .r-mid { font-size: 12px; }
    .receipt table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    .receipt table th, .receipt table td { padding: 4px 2px; text-align: right; font-size: 12px; }
    .receipt table th { border-bottom: 2px solid #000; font-size: 11px; font-weight: bold; }
    .receipt table td { border-bottom: 1px solid #eee; }
}
.receipt .center { text-align: center; }
.receipt .bold { font-weight: bold; }
.receipt .sep { border-top: 1px dashed #000; margin: 6px 0; }
.receipt .row { display: flex; justify-content: space-between; }
</style>
</head>
<body>
<div class="toolbar">
    <h3>معاينة الفاتورة الحرارية (57×40 ملم)</h3>
    <div class="toolbar-btns">
        <button class="btn-print" onclick="window.print()">🖨️ طباعة</button>
        <button class="btn-close" onclick="window.close()">✖ إغلاق</button>
    </div>
</div>
<div class="preview-wrapper">
<div class="receipt">
<div class="center r-header">${storeName}</div>
<div class="center r-sub">فاتورة مبيعات</div>
<div class="sep"></div>
<div class="row r-mid"><span>${inv.invoice_number}</span><span>${typeof formatKuwaitTime === 'function' ? formatKuwaitTime(inv.created_at) : new Date(inv.created_at).toLocaleDateString('ar')}</span></div>
${inv.customer_name ? `<div class="r-small">العميل: ${inv.customer_name}</div>` : ''}
<div class="sep"></div>
<table>
<thead><tr><th>المنتج</th><th>ك</th><th>السعر</th><th>المجموع</th></tr></thead>
<tbody>
${inv.items.map(item => `<tr><td>${item.product_name}</td><td style="text-align:center;">${item.quantity}</td><td>${item.price.toFixed(3)}</td><td>${item.total.toFixed(3)}</td></tr>`).join('')}
</tbody>
</table>
<div class="sep"></div>
${inv.discount > 0 ? `<div class="row r-small"><span>الخصم:</span><span>-${inv.discount.toFixed(3)}</span></div>` : ''}
${(inv.coupon_discount || 0) > 0 ? `<div class="row r-small"><span>كوبون:</span><span>-${inv.coupon_discount.toFixed(3)}</span></div>` : ''}
${(inv.loyalty_discount || 0) > 0 ? `<div class="row r-small"><span>ولاء:</span><span>-${inv.loyalty_discount.toFixed(3)}</span></div>` : ''}
${inv.delivery_fee > 0 ? `<div class="row r-small"><span>توصيل:</span><span>+${inv.delivery_fee.toFixed(3)}</span></div>` : ''}
<div class="row r-total"><span>الإجمالي:</span><span>${inv.total.toFixed(3)} د.ك</span></div>
<div class="r-small" style="margin-top:4px;">الدفع: ${payText}</div>
<div class="sep"></div>
<div class="center r-small">شكراً لتعاملكم معنا</div>
</div>
</div>
</body>
</html>`;
}

function generateCompactInvoiceHTML(inv) {
    const paymentMethods = {'cash':'💵 نقداً','knet':'💳 كي نت','visa':'💳 فيزا','other':'💰 أخرى'};
    if (!inv.payments && inv.transaction_number) {
        try {
            const parsed = JSON.parse(inv.transaction_number);
            if (Array.isArray(parsed)) { inv.payments = parsed; }
        } catch(e) {}
    }
    return `
<!DOCTYPE html>
<html dir="rtl">
<head>
<meta charset="UTF-8">
<title>فاتورة ${inv.invoice_number}</title>
<style>
@page{size:A4;margin:15mm;}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:Arial;padding:20px;font-size:13px;}
.header{text-align:center;margin-bottom:20px;padding-bottom:15px;border-bottom:2px solid #667eea;}
.header img{max-width:150px;max-height:80px;margin-bottom:8px;}
.header h1{font-size:24px;margin:8px 0;color:#2d3748;}
.header p{font-size:15px;color:#667eea;margin:5px 0;}
.info{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:15px 0;font-size:13px;}
.info div{padding:8px;background:#f8f9fa;border-radius:6px;}
table{width:100%;border-collapse:collapse;margin:15px 0;}
th,td{border:1px solid #ddd;padding:10px;text-align:right;font-size:13px;}
th{background:#667eea;color:white;font-weight:bold;}
tbody tr:nth-child(even){background:#f8f9fa;}
.totals{margin-top:15px;font-size:14px;}
.totals div{display:flex;justify-content:space-between;margin:8px 0;padding:5px 0;}
.total-final{font-size:18px;font-weight:bold;border-top:3px solid #667eea;padding-top:10px;margin-top:10px;color:#667eea;}
.footer{text-align:center;margin-top:25px;font-size:12px;color:#6c757d;border-top:2px solid #dee2e6;padding-top:15px;}
</style>
</head>
<body>
<div class="header">
${storeLogo ? `<img src="${storeLogo}">` : ''}
<h1>${document.getElementById('storeName')?.value || 'متجر العطور والبخور'}</h1>
<p>فاتورة مبيعات</p>
</div>
<div class="info">
<div><b>رقم الفاتورة:</b> ${inv.invoice_number}</div>
<div><b>التاريخ:</b> ${formatKuwaitTime(inv.created_at)}</div>
<div><b>العميل:</b> ${inv.customer_name || '-'}</div>
<div><b>الهاتف:</b> ${inv.customer_phone || '-'}</div>
<div><b>العنوان:</b> ${inv.customer_address || '-'}</div>
<div><b>طريقة الدفع:</b> ${inv.payments && inv.payments.length > 0 ? inv.payments.map(p => `${paymentMethods[p.method] || p.method} (${parseFloat(p.amount).toFixed(3)})`).join(' + ') : paymentMethods[inv.payment_method]}</div>
${inv.payments && inv.payments.length > 0 ? inv.payments.filter(p => p.transaction_number).map(p => `<div><b>رقم العملية (${paymentMethods[p.method]}):</b> ${p.transaction_number}</div>`).join('') : (inv.transaction_number ? `<div style="grid-column:1/-1;"><b>رقم العملية:</b> ${inv.transaction_number}</div>` : '')}
<div style="grid-column:1/-1;"><b>حالة الطلب:</b> <span style="padding:4px 12px; border-radius:12px; font-weight:bold; ${(inv.order_status || 'قيد التنفيذ') === 'قيد التنفيذ' ? 'background:#fff3cd; color:#856404;' : inv.order_status === 'قيد التوصيل' ? 'background:#cce5ff; color:#004085;' : 'background:#d4edda; color:#155724;'}">${inv.order_status === 'قيد التنفيذ' ? '⏳' : inv.order_status === 'قيد التوصيل' ? '🚚' : '✅'} ${inv.order_status || 'قيد التنفيذ'}</span></div>
${inv.table_name ? `<div><b>🍽️ الطاولة:</b> ${inv.table_name}</div>` : ''}
</div>
<table>
<thead><tr><th style="width:40px;">#</th><th>المنتج</th><th style="width:80px;">الكمية</th><th style="width:100px;">السعر</th><th style="width:100px;">الإجمالي</th></tr></thead>
<tbody>
${inv.items.map((item, i) => `<tr><td>${i+1}</td><td>${item.product_name}</td><td style="text-align:center;">${item.quantity}</td><td>${item.price.toFixed(3)} د.ك</td><td>${item.total.toFixed(3)} د.ك</td></tr>`).join('')}
</tbody>
</table>
<div class="totals">
<div><span>المجموع الفرعي:</span><span>${inv.subtotal.toFixed(3)} د.ك</span></div>
<div style="color:#dc3545;"><span>الخصم:</span><span>-${inv.discount.toFixed(3)} د.ك</span></div>
${(inv.coupon_discount || 0) > 0 ? `<div style="color:#b45309;"><span>🎟️ خصم الكوبون:</span><span>-${inv.coupon_discount.toFixed(3)} د.ك</span></div>` : ''}
${(inv.loyalty_discount || 0) > 0 ? `<div style="color:#0284c7;"><span>💎 خصم الولاء:</span><span>-${inv.loyalty_discount.toFixed(3)} د.ك</span></div>` : ''}
${inv.delivery_fee > 0 ? `<div><span>رسوم التوصيل:</span><span>+${inv.delivery_fee.toFixed(3)} د.ك</span></div>` : ''}
<div class="total-final"><span>الإجمالي النهائي:</span><span>${inv.total.toFixed(3)} د.ك</span></div>
</div>
<div class="footer">
<p style="font-size:16px;margin-bottom:8px;">شكراً لتعاملكم معنا 🌟</p>
<p>نتمنى لكم يوماً سعيداً</p>
</div>
</body>
</html>`;
}

// Products Management
async function loadProductsTable() {
    try {
        // الأدمن يشوف كل المنتجات، الكاشير يشوف منتجات فرعه فقط
        const branchParam = window.userPermissions?.isAdmin ? 'all' : (currentUser?.branch_id || 1);
        const response = await fetch(`${API_URL}/api/products?branch_id=${branchParam}`);
        const data = await response.json();
        if (data.success) {
            // حفظ المنتجات للتعديل
            allProductsTable = data.products;

            // تجميع حسب الفئة
            const byCategory = {};
            data.products.forEach(p => {
                const cat = p.category || 'بدون فئة';
                if (!byCategory[cat]) byCategory[cat] = [];
                byCategory[cat].push(p);
            });
            
            const container = document.getElementById('productsTableContainer');
            let html = '';
            
            Object.keys(byCategory).sort().forEach(category => {
                html += `
                    <div style="margin-bottom: 30px;">
                        <h3 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 20px; border-radius: 10px; margin-bottom: 20px; font-size: 18px;">
                            📁 ${category}
                        </h3>
                        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px;">
                            ${byCategory[category].map(p => {
                                let imgDisplay = '🛍️';
                                if (p.image_data) {
                                    if (p.image_data.startsWith('data:image')) {
                                        imgDisplay = `<img src="${p.image_data}" style="width:60px; height:60px; object-fit:cover; border-radius:8px;">`;
                                    } else {
                                        imgDisplay = `<div style="font-size:50px;">${p.image_data}</div>`;
                                    }
                                }
                                return `
                                    <div style="border:2px solid #e2e8f0; padding:15px; border-radius:12px; background:white; text-align:center; transition:all 0.3s; cursor:pointer;" 
                                         onmouseover="this.style.boxShadow='0 4px 12px rgba(102,126,234,0.3)'; this.style.transform='translateY(-2px)';"
                                         onmouseout="this.style.boxShadow='none'; this.style.transform='translateY(0)';">
                                        <div style="margin-bottom:10px;">${imgDisplay}</div>
                                        <div style="font-weight:bold; margin-bottom:5px; color:#2d3748;">${p.name}</div>
                                        <div style="color:#667eea; font-size:18px; font-weight:bold; margin:8px 0;">${p.price.toFixed(3)} د.ك</div>
                                        <div style="color:#6c757d; font-size:13px; margin-bottom:10px;">المخزون: ${p.stock}</div>
                                        ${p.barcode ? `<div style="color:#6c757d; font-size:11px; margin-bottom:10px;">📊 ${p.barcode}</div>` : ''}
                                        
                                        <!-- عرض إجمالي التكلفة فقط -->
                                        ${p.cost && p.cost > 0 ? `
                                            <div style="background:#f0f9ff; padding:10px; border-radius:6px; margin:10px 0; border:1px solid #bae6fd;">
                                                <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px;">
                                                    <span style="color:#0369a1; font-weight:600;">💰 التكلفة:</span>
                                                    <span style="color:#0c4a6e; font-weight:700;">${p.cost.toFixed(3)} د.ك</span>
                                                </div>
                                                <div style="margin-top:5px; font-size:11px; color:#0284c7;">
                                                    📊 الربح: ${(p.price - p.cost).toFixed(3)} د.ك (${((p.price - p.cost) / p.price * 100).toFixed(1)}%)
                                                </div>
                                            </div>
                                        ` : ''}

                                        ${p.variants && p.variants.length > 0 ? `
                                            <div style="background:#f0fff4; padding:8px; border-radius:6px; margin:8px 0; border:1px solid #c6f6d5;">
                                                <div style="font-size:12px; color:#38a169; font-weight:bold; margin-bottom:5px;">📐 ${p.variants.length} خاصية</div>
                                                ${p.variants.map(v => `
                                                    <div style="display:flex; justify-content:space-between; font-size:11px; padding:2px 0; border-bottom:1px solid #e8f5e9;">
                                                        <span>${v.variant_name}</span>
                                                        <span style="font-weight:bold;">${v.price.toFixed(3)} د.ك</span>
                                                    </div>
                                                `).join('')}
                                            </div>
                                        ` : ''}

                                        <div style="display:flex; gap:5px; justify-content:center; margin-top:10px;">
                                            <button onclick="editProduct(${p.id})" class="btn-sm" style="flex:1;">✏️ تعديل</button>
                                            <button onclick="deleteProduct(${p.id})" class="btn-sm btn-danger" style="flex:1;">🗑️</button>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            });
            
            container.innerHTML = html;
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

function showAddProduct() {
    // التحقق من الصلاحية
    if (!window.userPermissions?.canAddProducts) {
        alert('❌ ليس لديك صلاحية إضافة المنتجات');
        return;
    }
    
    updateCategoryDropdown();
    loadBranchesDropdowns(); // تحميل الفروع
    document.getElementById('productModalTitle').textContent = '➕ إضافة منتج';
    document.getElementById('productForm').reset();
    document.getElementById('productId').value = '';
    document.getElementById('productImageData').value = '';
    document.getElementById('productImagePreview').style.display = 'none';
    
    // تعيين الفرع الافتراضي للمستخدم
    if (currentUser && document.getElementById('productBranch')) {
        document.getElementById('productBranch').value = currentUser.branch_id || 1;
    }
    
    document.getElementById('addProductModal').classList.add('active');
}

function closeAddProduct() {
    document.getElementById('addProductModal').classList.remove('active');
}

function updateCategoryDropdown() {
    // تحديث select المنتجات
    const productSelect = document.getElementById('productCategory');
    if (productSelect) {
        productSelect.innerHTML = '<option value="">-- اختر فئة --</option>' + 
            Array.from(categories).map(cat => `<option value="${cat}">${cat}</option>`).join('');
    }
    
    // تحديث select المخزون
    const inventorySelect = document.getElementById('inventoryCategory');
    if (inventorySelect) {
        inventorySelect.innerHTML = '<option value="">-- اختر فئة --</option>' + 
            Array.from(categories).map(cat => `<option value="${cat}">${cat}</option>`).join('');
    }
}

document.getElementById('productForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const productId = document.getElementById('productId').value;
    const newCat = document.getElementById('newCategory').value.trim();
    const category = newCat || document.getElementById('productCategory').value;
    if (newCat) categories.add(newCat);
    
    const productData = {
        name: document.getElementById('productName').value,
        barcode: document.getElementById('productBarcode').value,
        price: parseFloat(document.getElementById('productPrice').value),
        stock: parseInt(document.getElementById('productStock').value) || 0,
        category: category,
        image_data: document.getElementById('productImageData').value,
        branch_id: parseInt(document.getElementById('productBranch')?.value || currentUser?.branch_id || 1)
    };
    
    try {
        const url = productId ? `${API_URL}/api/products/${productId}` : `${API_URL}/api/products`;
        const method = productId ? 'PUT' : 'POST';
        const response = await fetch(url, {
            method: method,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(productData)
        });
        const data = await response.json();
        if (data.success) {
            alert('✅ تم الحفظ');
            closeAddProduct();
            await loadProducts();
            await loadProductsTable();
        } else {
            alert('خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('خطأ:', error);
        alert('فشل الحفظ');
    }
});

async function editProduct(id) {
    // التحقق من الصلاحية
    if (!window.userPermissions?.canEditProducts) {
        alert('❌ ليس لديك صلاحية تعديل المنتجات');
        return;
    }
    
    const product = allProductsTable.find(p => p.id === id) || allProducts.find(p => p.id === id);
    if (!product) return;
    updateCategoryDropdown();
    loadBranchesDropdowns();
    document.getElementById('productModalTitle').textContent = '✏️ تعديل منتج';
    document.getElementById('productId').value = product.id;
    document.getElementById('productName').value = product.name;
    document.getElementById('productBarcode').value = product.barcode || '';
    document.getElementById('productPrice').value = product.price;
    document.getElementById('productStock').value = product.stock;
    document.getElementById('productCategory').value = product.category || '';
    document.getElementById('productImageData').value = product.image_data || '';
    
    // تعيين الفرع
    if (document.getElementById('productBranch')) {
        document.getElementById('productBranch').value = product.branch_id || 1;
    }
    
    if (product.image_data && product.image_data.startsWith('data:image')) {
        document.getElementById('productImageDisplay').innerHTML = `<img src="${product.image_data}" style="max-width:80px; max-height:80px; border-radius:8px;">`;
        document.getElementById('productImagePreview').style.display = 'block';
    } else {
        document.getElementById('productImagePreview').style.display = 'none';
    }
    
    document.getElementById('addProductModal').classList.add('active');
}

async function deleteProduct(id) {
    // التحقق من الصلاحية
    if (!window.userPermissions?.canDeleteProducts) {
        alert('❌ ليس لديك صلاحية حذف المنتجات');
        return;
    }
    
    if (!confirm('حذف المنتج؟')) return;
    try {
        const response = await fetch(`${API_URL}/api/products/${id}`, {method: 'DELETE'});
        const data = await response.json();
        if (data.success) {
            alert('✅ تم الحذف');
            await loadProducts();
            await loadProductsTable();
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

// Product Image Upload
function handleProductImage(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        if (file.size > 500000) {
            if (confirm('الصورة كبيرة. تصغير أم قص؟\nOK = تصغير\nCancel = قص')) {
                resizeImage(file, 100, 100, false);
            } else {
                resizeImage(file, 100, 100, true);
            }
        } else {
            resizeImage(file, 100, 100, false);
        }
    }
}

function resizeImage(file, maxW, maxH, crop) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            let w = img.width, h = img.height;
            if (crop) {
                const size = Math.min(w, h);
                canvas.width = maxW;
                canvas.height = maxH;
                ctx.drawImage(img, (w-size)/2, (h-size)/2, size, size, 0, 0, maxW, maxH);
            } else {
                const ratio = Math.min(maxW/w, maxH/h);
                canvas.width = w * ratio;
                canvas.height = h * ratio;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            }
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            document.getElementById('productImageData').value = dataUrl;
            document.getElementById('productImageDisplay').innerHTML = `<img src="${dataUrl}" style="max-width:80px; max-height:80px; border-radius:8px;">`;
            document.getElementById('productImagePreview').style.display = 'block';
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function removeProductImage() {
    document.getElementById('productImageData').value = '';
    document.getElementById('productImagePreview').style.display = 'none';
    document.getElementById('productImageInput').value = '';
}

// المزيد في الجزء التالي...

// Invoices
async function loadInvoicesTable() {
    try {
        let invoices = [];
        
        // Online: جلب من السيرفر
        if (navigator.onLine) {
            const response = await fetch(`${API_URL}/api/invoices?limit=200`);
            const data = await response.json();
            if (data.success) {
                invoices = data.invoices;
            }
        }
        
        // Offline أو Fallback: جلب من المحلي
        if (!navigator.onLine || invoices.length === 0) {
            if (localDB.isReady) {
                const localInvoices = await localDB.getAll('local_invoices');
                if (localInvoices.length > 0) {
                    invoices = localInvoices.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                    console.log('[App] Loaded invoices from local cache');
                }
            }
        }
        
        allInvoices = invoices;
        const container = document.getElementById('invoicesListContainer');
        
        if (invoices.length === 0) {
            container.innerHTML = '<p style="text-align:center; padding:40px;">لا توجد فواتير</p>';
            return;
        }
        
        // إضافة badge للفواتير offline
        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>رقم الفاتورة</th><th>العميل</th><th>الموظف</th><th>الإجمالي</th><th>حالة الطلب</th><th>التاريخ</th><th>عرض</th></tr></thead>
                <tbody>
                    ${invoices.map(inv => {
                        const isOffline = inv.id && inv.id.toString().startsWith('offline_');
                        const isCancelled = inv.cancelled;
                        const status = inv.order_status || 'قيد التنفيذ';
                        return `
                        <tr style="${isCancelled ? 'opacity:0.5; background:#fff5f5;' : ''}">
                            <td>
                                <strong${isCancelled ? ' style="text-decoration:line-through;"' : ''}>${inv.invoice_number}</strong>
                                ${isCancelled ? ' <span style="background:#dc3545; color:white; padding:2px 6px; border-radius:4px; font-size:10px;">🚫 ملغية</span>' : ''}
                                ${isOffline ? ' <span style="background:#dc3545; color:white; padding:2px 6px; border-radius:4px; font-size:10px;">📴 معلقة</span>' : ''}
                            </td>
                            <td>${inv.customer_name || 'عميل'}</td>
                            <td>${inv.employee_name}</td>
                            <td style="color:${isCancelled ? '#dc3545' : '#28a745'}; font-weight:bold;${isCancelled ? ' text-decoration:line-through;' : ''}">${inv.total.toFixed(3)} د.ك</td>
                            <td>
                                ${isCancelled ? '<span style="color:#dc3545; font-weight:bold; font-size:12px;">🚫 ملغية</span>' : `
                                <select class="order-status-select status-${status === 'قيد التنفيذ' ? 'processing' : status === 'قيد التوصيل' ? 'delivering' : 'completed'}"
                                        onchange="updateOrderStatus(${inv.id}, this.value)" ${isOffline ? 'disabled' : ''}>
                                    <option value="قيد التنفيذ" ${status === 'قيد التنفيذ' ? 'selected' : ''}>⏳ قيد التنفيذ</option>
                                    <option value="قيد التوصيل" ${status === 'قيد التوصيل' ? 'selected' : ''}>🚚 قيد التوصيل</option>
                                    <option value="منجز" ${status === 'منجز' ? 'selected' : ''}>✅ منجز</option>
                                </select>`}
                            </td>
                            <td>${formatKuwaitTime(inv.created_at)}</td>
                            <td><button onclick="viewLocalInvoice('${inv.id}')" class="btn-sm">👁️</button></td>
                        </tr>
                    `;
                    }).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error('خطأ:', error);
        
        // Fallback للمحلي
        if (localDB.isReady) {
            const localInvoices = await localDB.getAll('local_invoices');
            if (localInvoices.length > 0) {
                allInvoices = localInvoices.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                const container = document.getElementById('invoicesListContainer');
                container.innerHTML = `
                    <table class="data-table">
                        <thead><tr><th>رقم الفاتورة</th><th>العميل</th><th>الموظف</th><th>الإجمالي</th><th>حالة الطلب</th><th>التاريخ</th><th>عرض</th></tr></thead>
                        <tbody>
                            ${allInvoices.map(inv => {
                                const status = inv.order_status || 'قيد التنفيذ';
                                return `
                                <tr>
                                    <td><strong>${inv.invoice_number}</strong> <span style="background:#dc3545; color:white; padding:2px 6px; border-radius:4px; font-size:10px;">📴 معلقة</span></td>
                                    <td>${inv.customer_name || 'عميل'}</td>
                                    <td>${inv.employee_name}</td>
                                    <td style="color:#28a745; font-weight:bold;">${inv.total.toFixed(3)} د.ك</td>
                                    <td>
                                        <span class="order-status-badge status-processing">⏳ ${status}</span>
                                    </td>
                                    <td>${formatKuwaitTime(inv.created_at)}</td>
                                    <td><button onclick="viewLocalInvoice('${inv.id}')" class="btn-sm">👁️</button></td>
                                </tr>
                            `;
                            }).join('')}
                        </tbody>
                    </table>
                `;
            }
        }
    }
}

// عرض فاتورة محلية
async function viewLocalInvoice(invoiceId) {
    try {
        // محاولة من السيرفر أولاً (إذا online ورقم عادي)
        if (navigator.onLine && !invoiceId.toString().startsWith('offline_')) {
            const response = await fetch(`${API_URL}/api/invoices/${invoiceId}`);
            const data = await response.json();
            if (data.success) {
                currentInvoice = data.invoice;
                displayInvoiceView(currentInvoice);
                document.getElementById('invoiceViewModal').classList.add('active');
                return;
            }
        }
        
        // من المحلي
        if (localDB.isReady) {
            const invoice = await localDB.get('local_invoices', invoiceId);
            if (invoice) {
                currentInvoice = invoice;
                displayInvoiceView(currentInvoice);
                document.getElementById('invoiceViewModal').classList.add('active');
            } else {
                alert('لم يتم العثور على الفاتورة');
            }
        }
    } catch (error) {
        console.error('خطأ:', error);
        
        // Fallback للمحلي
        if (localDB.isReady) {
            const invoice = await localDB.get('local_invoices', invoiceId);
            if (invoice) {
                currentInvoice = invoice;
                displayInvoiceView(currentInvoice);
                document.getElementById('invoiceViewModal').classList.add('active');
            } else {
                alert('لم يتم العثور على الفاتورة');
            }
        }
    }
}

async function exportInvoicesExcel() {
    if (allInvoices.length === 0) {
        alert('لا توجد فواتير للتصدير');
        return;
    }
    const data = allInvoices.map(inv => ({
        'رقم الفاتورة': inv.invoice_number,
        'العميل': inv.customer_name || '',
        'الهاتف': inv.customer_phone || '',
        'الموظف': inv.employee_name,
        'المجموع الفرعي': inv.subtotal,
        'الخصم': inv.discount,
        'رسوم التوصيل': inv.delivery_fee || 0,
        'الإجمالي': inv.total,
        'طريقة الدفع': inv.payment_method,
        'حالة الطلب': inv.order_status || 'قيد التنفيذ',
        'رقم العملية': inv.transaction_number || '',
        'التاريخ': formatKuwaitTime(inv.created_at)
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الفواتير');
    XLSX.writeFile(wb, `invoices_${Date.now()}.xlsx`);
    alert('✅ تم تصدير الفواتير');
}

async function clearAllInvoices() {
    if (!confirm('⚠️ حذف جميع الفواتير؟\nلا يمكن التراجع!')) return;
    if (!confirm('تأكيد نهائي؟')) return;
    try {
        const response = await fetch(`${API_URL}/api/invoices/clear-all`, {method: 'DELETE'});
        const data = await response.json();
        if (data.success) {
            alert('✅ تم الحذف');
            await loadInvoicesTable();
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

// Reports
async function loadReports() {
    const startDate = document.getElementById('reportStartDate').value;
    const endDate = document.getElementById('reportEndDate').value;
    let url = `${API_URL}/api/reports/sales`;
    const params = [];
    if (startDate) params.push(`start_date=${startDate}`);
    if (endDate) params.push(`end_date=${endDate}`);
    if (params.length > 0) url += '?' + params.join('&');
    
    try {
        const [salesResponse, topProductsResponse] = await Promise.all([
            fetch(url),
            fetch(`${API_URL}/api/reports/top-products?limit=10`)
        ]);
        const salesData = await salesResponse.json();
        const topProductsData = await topProductsResponse.json();
        if (salesData.success && topProductsData.success) {
            displayReports(salesData.report, topProductsData.products);
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

function displayReports(report, topProducts) {
    const content = document.getElementById('reportsContent');
    content.innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:15px; margin:20px 0;">
            <div class="stat-card"><div class="stat-icon">🧾</div><div class="stat-value">${report.total_invoices || 0}</div><div class="stat-label">الفواتير</div></div>
            <div class="stat-card"><div class="stat-icon">💰</div><div class="stat-value">${(report.total_sales || 0).toFixed(3)}</div><div class="stat-label">المبيعات (د.ك)</div></div>
            <div class="stat-card"><div class="stat-icon">🎁</div><div class="stat-value">${(report.total_discount || 0).toFixed(3)}</div><div class="stat-label">الخصومات (د.ك)</div></div>
            <div class="stat-card"><div class="stat-icon">📊</div><div class="stat-value">${(report.average_sale || 0).toFixed(3)}</div><div class="stat-label">متوسط الفاتورة (د.ك)</div></div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
            <div class="report-card">
                <h3>💳 طرق الدفع</h3>
                ${report.payment_methods && report.payment_methods.length > 0 ? `
                    <div style="display:flex; flex-direction:column; gap:10px; margin-top:15px;">
                        ${report.payment_methods.map(pm => {
                            const pct = report.total_invoices > 0 ? ((pm.count / report.total_invoices) * 100).toFixed(1) : 0;
                            return `
                                <div>
                                    <div style="display:flex; justify-content:space-between; margin-bottom:5px;"><span>${getPaymentMethodName(pm.payment_method)}</span><span style="color:#28a745; font-weight:bold;">${pm.total.toFixed(3)} د.ك</span></div>
                                    <div style="display:flex; align-items:center; gap:10px;">
                                        <div style="flex:1; height:8px; background:#e2e8f0; border-radius:4px; overflow:hidden;"><div style="width:${pct}%; height:100%; background:linear-gradient(90deg, #667eea, #764ba2);"></div></div>
                                        <span style="font-size:11px; color:#6c757d;">${pm.count} (${pct}%)</span>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                ` : '<p style="text-align:center; color:#6c757d;">لا توجد بيانات</p>'}
            </div>
            <div class="report-card">
                <h3>🏆 أفضل المنتجات</h3>
                ${topProducts && topProducts.length > 0 ? `
                    <div style="margin-top:15px;">
                        ${topProducts.map((p, i) => `
                            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; margin-bottom:5px; background:#f8f9fa; border-radius:6px;">
                                <div style="display:flex; align-items:center; gap:8px;"><span style="font-weight:bold; color:#667eea; font-size:16px;">#${i+1}</span><span style="font-size:13px;">${p.product_name}</span></div>
                                <div style="text-align:left;"><div style="font-weight:bold; color:#28a745; font-size:13px;">${p.total_sales.toFixed(3)} د.ك</div><div style="font-size:10px; color:#6c757d;">${p.total_quantity} قطعة</div></div>
                            </div>
                        `).join('')}
                    </div>
                ` : '<p style="text-align:center; color:#6c757d;">لا توجد بيانات</p>'}
            </div>
        </div>
    `;
}

function getPaymentMethodName(m) {
    const names = {'cash':'💵 نقداً','knet':'💳 كي نت','visa':'💳 فيزا','other':'💰 أخرى'};
    return names[m] || m;
}

// Accounting - Load as iframe
function loadAccounting() {
    const iframe = document.getElementById('accountingFrame');
    if (!iframe) {
        document.getElementById('accountingContent').innerHTML = `
            <iframe src="accounting.html" style="width:100%; height:calc(100vh - 150px); border:none; border-radius:10px;"></iframe>
        `;
    } else {
        iframe.src = 'accounting.html';
    }
}

// Users
async function loadUsersTable() {
    if (currentUser.role !== 'admin') return;
    try {
        // تحميل المستخدمين
        const usersResponse = await fetch(`${API_URL}/api/users`);
        const usersData = await usersResponse.json();
        
        // تحميل الفروع
        const branchesResponse = await fetch(`${API_URL}/api/branches`);
        const branchesData = await branchesResponse.json();
        
        if (usersData.success && branchesData.success) {
            // إنشاء map للفروع
            const branchesMap = {};
            branchesData.branches.forEach(b => {
                branchesMap[b.id] = b.name;
            });
            
            const container = document.getElementById('usersTableContainer');
            container.innerHTML = `
                <table class="data-table">
                    <thead><tr><th>المستخدم</th><th>الاسم</th><th>الصلاحية</th><th>الفرع</th><th>البادئة</th><th>الحالة</th><th>إجراءات</th></tr></thead>
                    <tbody>
                        ${usersData.users.map(u => `
                            <tr>
                                <td><strong>${u.username}</strong></td>
                                <td>${u.full_name}</td>
                                <td>${u.role === 'admin' ? '👑 مدير' : '💼 كاشير'}</td>
                                <td><span style="background:#38a169; color:white; padding:4px 8px; border-radius:4px;">${branchesMap[u.branch_id] || 'الفرع الرئيسي'}</span></td>
                                <td><span style="background:#667eea; color:white; padding:4px 8px; border-radius:4px; font-weight:bold;">${u.invoice_prefix || '-'}</span></td>
                                <td>${u.is_active ? '✅' : '❌'}</td>
                                <td>
                                    <button onclick="editUser(${u.id})" class="btn-sm">✏️</button>
                                    ${u.role !== 'admin' ? `<button onclick="deleteUser(${u.id})" class="btn-sm btn-danger">🗑️</button>` : ''}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

function showAddUser() {
    loadBranchesForUserForm(); // تحميل الفروع
    document.getElementById('userModalTitle').textContent = '➕ إضافة مستخدم';
    document.getElementById('userForm').reset();
    document.getElementById('userId').value = '';
    document.getElementById('username').disabled = false;
    document.getElementById('userPassword').required = true;
    document.getElementById('addUserModal').classList.add('active');
}

function closeAddUser() {
    document.getElementById('addUserModal').classList.remove('active');
}

document.getElementById('userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = document.getElementById('userId').value;
    const role = document.getElementById('userRole').value;
    
    const userData = {
        username: document.getElementById('username').value,
        password: document.getElementById('userPassword').value,
        full_name: document.getElementById('fullName').value,
        role: role,
        invoice_prefix: document.getElementById('invoicePrefix').value,
        branch_id: parseInt(document.getElementById('userBranch').value) || 1
    };
    
    // إضافة الصلاحيات إذا كان كاشير
    if (role === 'cashier') {
        const permCheckboxes = document.querySelectorAll('#permissionsSection input[type="checkbox"]');
        permCheckboxes.forEach(cb => {
            const permName = cb.getAttribute('name');
            userData[permName] = cb.checked ? 1 : 0;
        });
    } else {
        // المدير - كل الصلاحيات = 1
        userData.can_view_products = 1;
        userData.can_add_products = 1;
        userData.can_edit_products = 1;
        userData.can_delete_products = 1;
        userData.can_view_inventory = 1;
        userData.can_add_inventory = 1;
        userData.can_edit_inventory = 1;
        userData.can_delete_inventory = 1;
        userData.can_view_invoices = 1;
        userData.can_delete_invoices = 1;
        userData.can_view_customers = 1;
        userData.can_add_customer = 1;
        userData.can_edit_customer = 1;
        userData.can_delete_customer = 1;
        userData.can_view_reports = 1;
        userData.can_view_accounting = 1;
        userData.can_manage_users = 1;
        userData.can_access_settings = 1;
    }
    
    if (userId && !userData.password) delete userData.password;
    
    try {
        const url = userId ? `${API_URL}/api/users/${userId}` : `${API_URL}/api/users`;
        const method = userId ? 'PUT' : 'POST';
        const response = await fetch(url, {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(userData)});
        const data = await response.json();
        if (data.success) {
            alert('✅ تم الحفظ');
            closeAddUser();
            await loadUsersTable();
            
            // إذا تم تعديل المستخدم الحالي، حدّث userInfo
            if (userId && parseInt(userId) === currentUser.id) {
                // تحديث بيانات المستخدم الحالي
                const updatedResponse = await fetch(`${API_URL}/api/users`);
                const updatedData = await updatedResponse.json();
                if (updatedData.success) {
                    const updatedUser = updatedData.users.find(u => u.id === currentUser.id);
                    if (updatedUser) {
                        // تحديث currentUser
                        Object.assign(currentUser, updatedUser);
                        
                        // جلب اسم الفرع
                        const branchResponse = await fetch(`${API_URL}/api/branches`);
                        const branchData = await branchResponse.json();
                        if (branchData.success) {
                            const branch = branchData.branches.find(b => b.id === currentUser.branch_id);
                            currentUser.branch_name = branch ? branch.name : '';
                            
                            // تحديث العرض
                            const branchText = currentUser.branch_name ? ` - ${currentUser.branch_name}` : '';
                            document.getElementById('userInfo').textContent = `${currentUser.full_name} (${currentUser.invoice_prefix || 'INV'})${branchText}`;
                        }
                    }
                }
            }
        } else {
            alert('خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
});

async function editUser(id) {
    try {
        // تحميل الفروع أولاً
        await loadBranchesForUserForm();
        
        const response = await fetch(`${API_URL}/api/users`);
        const data = await response.json();
        if (data.success) {
            const user = data.users.find(u => u.id === id);
            if (!user) return;
            document.getElementById('userModalTitle').textContent = '✏️ تعديل مستخدم';
            document.getElementById('userId').value = user.id;
            document.getElementById('username').value = user.username;
            document.getElementById('username').disabled = true;
            document.getElementById('userPassword').required = false;
            document.getElementById('userPassword').placeholder = 'اتركها فارغة إذا لم تريد تغييرها';
            document.getElementById('fullName').value = user.full_name;
            document.getElementById('userRole').value = user.role;
            document.getElementById('invoicePrefix').value = user.invoice_prefix || '';
            document.getElementById('userBranch').value = user.branch_id || 1;
            
            // إظهار/إخفاء قسم الصلاحيات
            const permSection = document.getElementById('permissionsSection');
            if (user.role === 'cashier') {
                permSection.style.display = 'block';
                
                // تحديد الصلاحيات الحالية
                const permCheckboxes = document.querySelectorAll('#permissionsSection input[type="checkbox"]');
                permCheckboxes.forEach(cb => {
                    const permName = cb.getAttribute('name');
                    cb.checked = user[permName] === 1;
                });
            } else {
                permSection.style.display = 'none';
            }
            
            document.getElementById('addUserModal').classList.add('active');
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

async function deleteUser(id) {
    if (!confirm('حذف المستخدم؟')) return;
    try {
        const response = await fetch(`${API_URL}/api/users/${id}`, {method: 'DELETE'});
        const data = await response.json();
        if (data.success) {
            alert('✅ تم الحذف');
            await loadUsersTable();
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

// Settings
async function loadSettings() {
    try {
        const response = await fetch(`${API_URL}/api/settings`);
        const data = await response.json();
        if (data.success) {
            document.getElementById('storeName').value = data.settings.store_name || '';
            document.getElementById('storePhone').value = data.settings.store_phone || '';
            document.getElementById('storeAddress').value = data.settings.store_address || '';
            
            // العملة
            if (document.getElementById('storeCurrency')) {
                document.getElementById('storeCurrency').value = data.settings.store_currency || 'KWD';
            }
            
            // شعار المتجر
            if (data.settings.store_logo) {
                storeLogo = data.settings.store_logo;
                document.getElementById('logoPreviewImg').src = storeLogo;
                document.getElementById('logoPreview').style.display = 'block';
            }
            
            // أيقونة Login
            if (data.settings.login_icon) {
                document.querySelector('.login-logo').innerHTML = `<img src="${data.settings.login_icon}" style="width: 100px; height: 100px; border-radius: 50%; object-fit: cover;">`;
                if (document.getElementById('loginIconPreviewImg')) {
                    document.getElementById('loginIconPreviewImg').src = data.settings.login_icon;
                    document.getElementById('loginIconPreview').style.display = 'block';
                }
            }

            // إعدادات الولاء
            window.loyaltyConfig = {
                enabled: data.settings.loyalty_enabled !== 'false',
                pointsPerInvoice: parseInt(data.settings.loyalty_points_per_invoice) || 10,
                pointValue: parseFloat(data.settings.loyalty_point_value) || 0.1
            };
            if (document.getElementById('loyaltyEnabled')) {
                document.getElementById('loyaltyEnabled').value = data.settings.loyalty_enabled || 'true';
            }
            if (document.getElementById('loyaltyPointsPerInvoice')) {
                document.getElementById('loyaltyPointsPerInvoice').value = window.loyaltyConfig.pointsPerInvoice;
            }
            if (document.getElementById('loyaltyPointValue')) {
                document.getElementById('loyaltyPointValue').value = window.loyaltyConfig.pointValue.toFixed(3);
            }
            if (document.getElementById('pointValueHint')) {
                document.getElementById('pointValueHint').textContent = window.loyaltyConfig.pointValue.toFixed(3);
            }
            updateLoyaltyPreview();
        }
        
    } catch (error) {
        console.error('خطأ:', error);
    }
}

function previewLogo(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('logoPreviewImg').src = e.target.result;
            document.getElementById('logoPreview').style.display = 'block';
        };
        reader.readAsDataURL(input.files[0]);
    }
}

function removeLogo() {
    document.getElementById('storeLogo').value = '';
    document.getElementById('logoPreview').style.display = 'none';
    storeLogo = null;
}

function previewLoginIcon(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('loginIconPreviewImg').src = e.target.result;
            document.getElementById('loginIconPreview').style.display = 'block';
            // تحديث الأيقونة في شاشة Login مباشرة
            document.querySelector('.login-logo').innerHTML = `<img src="${e.target.result}" style="width: 100px; height: 100px; border-radius: 50%; object-fit: cover;">`;
        };
        reader.readAsDataURL(input.files[0]);
    }
}

function removeLoginIcon() {
    document.getElementById('loginIcon').value = '';
    document.getElementById('loginIconPreview').style.display = 'none';
    // استعادة الأيقونة الافتراضية
    document.querySelector('.login-logo').textContent = '🛍️';
}

async function saveSettings() {
    const logoInput = document.getElementById('storeLogo');
    let logoData = storeLogo;
    if (logoInput.files && logoInput.files[0]) {
        logoData = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(logoInput.files[0]);
        });
    }
    
    // أيقونة Login
    const loginIconInput = document.getElementById('loginIcon');
    let loginIconData = null;
    if (loginIconInput && loginIconInput.files && loginIconInput.files[0]) {
        loginIconData = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(loginIconInput.files[0]);
        });
    }
    
    const settings = {
        store_name: document.getElementById('storeName').value,
        store_phone: document.getElementById('storePhone').value,
        store_address: document.getElementById('storeAddress').value,
        store_currency: document.getElementById('storeCurrency')?.value || 'KWD',
        store_logo: logoData || '',
        login_icon: loginIconData
    };
    
    try {
        const response = await fetch(`${API_URL}/api/settings`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(settings)
        });
        const data = await response.json();
        if (data.success) {
            storeLogo = logoData;
            alert('✅ تم الحفظ');
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

async function saveLoyaltySettings() {
    const settings = {
        loyalty_enabled: document.getElementById('loyaltyEnabled').value,
        loyalty_points_per_invoice: document.getElementById('loyaltyPointsPerInvoice').value,
        loyalty_point_value: document.getElementById('loyaltyPointValue').value
    };
    try {
        const response = await fetch(`${API_URL}/api/settings`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(settings)
        });
        const data = await response.json();
        if (data.success) {
            window.loyaltyConfig = {
                enabled: settings.loyalty_enabled !== 'false',
                pointsPerInvoice: parseInt(settings.loyalty_points_per_invoice) || 10,
                pointValue: parseFloat(settings.loyalty_point_value) || 0.1
            };
            if (document.getElementById('pointValueHint')) {
                document.getElementById('pointValueHint').textContent = window.loyaltyConfig.pointValue.toFixed(3);
            }
            alert('✅ تم حفظ إعدادات الولاء');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل الحفظ');
    }
}

function updateLoyaltyPreview() {
    const el = document.getElementById('loyaltyPreviewText');
    if (!el) return;
    const cfg = window.loyaltyConfig || { pointsPerInvoice: 10, pointValue: 0.1 };
    el.innerHTML = `
        <div>🎯 كل فاتورة يحصل العميل على: <strong style="color: #0ea5e9;">${cfg.pointsPerInvoice} نقطة</strong></div>
        <div>💰 قيمة كل نقطة: <strong style="color: #38a169;">${cfg.pointValue.toFixed(3)} د.ك</strong></div>
        <div>📊 يعني كل فاتورة قيمة النقاط: <strong style="color: #667eea;">${(cfg.pointsPerInvoice * cfg.pointValue).toFixed(3)} د.ك</strong></div>
        <div>📌 مثال: عميل عنده ${cfg.pointsPerInvoice * 5} نقطة = <strong style="color: #e53e3e;">${(cfg.pointsPerInvoice * 5 * cfg.pointValue).toFixed(3)} د.ك</strong> خصم</div>
    `;
}

// ===== نظام الفروع =====

async function loadBranchesDropdowns() {
    try {
        const response = await fetch(`${API_URL}/api/branches`);
        const data = await response.json();
        if (data.success) {
            // تحديث dropdown المستخدمين
            const userBranchSelect = document.getElementById('userBranch');
            if (userBranchSelect) {
                userBranchSelect.innerHTML = data.branches.map(b => 
                    `<option value="${b.id}">${b.name}</option>`
                ).join('');
            }
            
            // تحديث dropdown المنتجات
            const productBranchSelect = document.getElementById('productBranch');
            if (productBranchSelect) {
                productBranchSelect.innerHTML = data.branches.map(b => 
                    `<option value="${b.id}">${b.name}</option>`
                ).join('');
            }
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

async function loadBranchesTable() {
    try {
        const response = await fetch(`${API_URL}/api/branches`);
        const data = await response.json();
        if (data.success) {
            const container = document.getElementById('branchesTableContainer');
            let html = '<table class="data-table"><thead><tr><th>رقم الفرع</th><th>الاسم</th><th>الموقع</th><th>الهاتف</th><th>إجراءات</th></tr></thead><tbody>';
            
            data.branches.forEach(b => {
                html += `
                    <tr>
                        <td><strong style="background: #667eea; color: white; padding: 5px 10px; border-radius: 5px;">B${b.id}</strong></td>
                        <td>${b.name}</td>
                        <td>${b.location || '-'}</td>
                        <td>${b.phone || '-'}</td>
                        <td>
                            <button onclick="editBranch(${b.id})" class="btn-sm">✏️</button>
                            <button onclick="deleteBranch(${b.id})" class="btn-sm btn-danger">🗑️</button>
                        </td>
                    </tr>
                `;
            });
            
            html += '</tbody></table>';
            container.innerHTML = html;
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

function showAddBranch() {
    document.getElementById('branchModalTitle').textContent = '➕ إضافة فرع';
    document.getElementById('branchForm').reset();
    document.getElementById('branchId').value = '';
    document.getElementById('addBranchModal').classList.add('active');
}

function closeAddBranch() {
    document.getElementById('addBranchModal').classList.remove('active');
}

document.getElementById('branchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const branchId = document.getElementById('branchId').value;
    const branchData = {
        name: document.getElementById('branchName').value,
        location: document.getElementById('branchLocation').value,
        phone: document.getElementById('branchPhone').value
    };
    
    try {
        const url = branchId ? `${API_URL}/api/branches/${branchId}` : `${API_URL}/api/branches`;
        const method = branchId ? 'PUT' : 'POST';
        const response = await fetch(url, {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(branchData)});
        const data = await response.json();
        if (data.success) {
            alert('✅ تم الحفظ');
            closeAddBranch();
            await loadBranchesTable();
        } else {
            alert('خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
});

async function editBranch(id) {
    try {
        const response = await fetch(`${API_URL}/api/branches`);
        const data = await response.json();
        if (data.success) {
            const branch = data.branches.find(b => b.id === id);
            if (!branch) return;
            
            document.getElementById('branchModalTitle').textContent = '✏️ تعديل فرع';
            document.getElementById('branchId').value = branch.id;
            document.getElementById('branchName').value = branch.name;
            document.getElementById('branchLocation').value = branch.location || '';
            document.getElementById('branchPhone').value = branch.phone || '';
            document.getElementById('addBranchModal').classList.add('active');
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

async function deleteBranch(id) {
    if (!confirm('حذف الفرع؟ (سيتم إخفاؤه فقط)')) return;
    try {
        const response = await fetch(`${API_URL}/api/branches/${id}`, {method: 'DELETE'});
        const data = await response.json();
        if (data.success) {
            alert('✅ تم الحذف');
            await loadBranchesTable();
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

// ===== سجل الحضور والانصراف =====

let currentAttendanceId = null;

async function recordCheckIn() {
    if (!currentUser) return;
    
    try {
        const response = await fetch(`${API_URL}/api/attendance/check-in`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                user_id: currentUser.id,
                user_name: currentUser.full_name,
                branch_id: currentUser.branch_id || 1
            })
        });
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                console.log('✅ تم تسجيل الحضور');
            }
        }
    } catch (error) {
        // لا نعطل Login إذا فشل تسجيل الحضور
        console.log('تحذير: لم يتم تسجيل الحضور');
    }
}

async function checkOut() {
    if (!currentUser) return;
    
    if (!confirm('هل تريد تسجيل الخروج من النظام؟')) return;
    
    try {
        const response = await fetch(`${API_URL}/api/attendance/check-out`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                user_id: currentUser.id
            })
        });
        const data = await response.json();
        if (data.success) {
            alert('✅ تم تسجيل الخروج');
            logout();
        } else {
            alert('⚠️ ' + (data.error || 'حدث خطأ'));
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

async function loadAttendanceLog() {
    try {
        const userId = document.getElementById('filterAttendanceUser').value;
        const date = document.getElementById('filterAttendanceDate').value;
        
        let url = `${API_URL}/api/attendance?`;
        if (userId) url += `user_id=${userId}&`;
        if (date) url += `date=${date}&`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            // تحميل الفروع لعرض الأسماء
            const branchesResponse = await fetch(`${API_URL}/api/branches`);
            const branchesData = await branchesResponse.json();
            const branches = {};
            if (branchesData.success) {
                branchesData.branches.forEach(b => branches[b.id] = b.name);
            }
            
            const container = document.getElementById('attendanceTableContainer');
            let html = '<table class="data-table" style="font-size: 14px;"><thead><tr><th>الموظف</th><th>الفرع</th><th>تاريخ الحضور</th><th>وقت الدخول</th><th>وقت الخروج</th><th>المدة</th></tr></thead><tbody>';
            
            data.records.forEach(r => {
                const checkIn = new Date(r.check_in);
                const checkOut = r.check_out ? new Date(r.check_out) : null;
                
                const dateStr = checkIn.toLocaleDateString('ar-EG');
                const checkInTime = checkIn.toLocaleTimeString('ar-EG', {hour: '2-digit', minute: '2-digit'});
                const checkOutTime = checkOut ? checkOut.toLocaleTimeString('ar-EG', {hour: '2-digit', minute: '2-digit'}) : '-';
                
                let duration = '-';
                if (checkOut) {
                    const diff = checkOut - checkIn;
                    const hours = Math.floor(diff / 3600000);
                    const minutes = Math.floor((diff % 3600000) / 60000);
                    duration = `${hours}س ${minutes}د`;
                }
                
                const statusColor = checkOut ? '#38a169' : '#e53e3e';
                const statusIcon = checkOut ? '✅' : '⏳';
                const branchName = branches[r.branch_id] || 'غير محدد';
                
                html += `
                    <tr style="background: ${checkOut ? '#f0fff4' : '#fff5f5'};">
                        <td><strong>${r.user_name}</strong></td>
                        <td>🏢 ${branchName}</td>
                        <td>${dateStr}</td>
                        <td>${statusIcon} ${checkInTime}</td>
                        <td style="color: ${statusColor};">${checkOutTime}</td>
                        <td><strong>${duration}</strong></td>
                    </tr>
                `;
            });
            
            html += '</tbody></table>';
            
            if (data.records.length === 0) {
                html = '<p style="text-align: center; padding: 40px; color: #6c757d;">لا توجد سجلات</p>';
            }
            
            container.innerHTML = html;
            
            // تحديث قائمة الموظفين في الفلتر
            await updateAttendanceUserFilter();
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

async function updateAttendanceUserFilter() {
    try {
        const response = await fetch(`${API_URL}/api/users`);
        const data = await response.json();
        if (data.success) {
            const select = document.getElementById('filterAttendanceUser');
            const currentValue = select.value;
            select.innerHTML = '<option value="">كل الموظفين</option>';
            data.users.forEach(u => {
                select.innerHTML += `<option value="${u.id}">${u.full_name}</option>`;
            });
            select.value = currentValue;
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

function clearAttendanceFilters() {
    document.getElementById('filterAttendanceUser').value = '';
    document.getElementById('filterAttendanceDate').value = '';
    loadAttendanceLog();
}


// ===== نظام المخزون الجديد =====

let allInventory = [];

async function loadInventory() {
    try {
        const response = await fetch(`${API_URL}/api/inventory`);
        const data = await response.json();
        if (data.success) {
            allInventory = data.inventory;
            // تحديث الفئات من المخزون
            data.inventory.forEach(item => {
                if (item.category) categories.add(item.category);
            });
            updateCategoryDropdown();
            await displayInventory();
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

async function displayInventory() {
    const container = document.getElementById('inventoryTableContainer');
    if (allInventory.length === 0) {
        container.innerHTML = '<p style="text-align: center; padding: 40px; color: #6c757d;">لا توجد منتجات في المخزون</p>';
        return;
    }
    
    // جلب كل التوزيعات والمبيعات والتالف
    let allDistributions = {};
    let allSold = {};
    let allDamaged = {};
    
    try {
        // جلب التوزيعات الحالية
        const stockResponse = await fetch(`${API_URL}/api/branch-stock`);
        const stockData = await stockResponse.json();
        if (stockData.success) {
            stockData.stock.forEach(s => {
                if (!allDistributions[s.inventory_id]) {
                    allDistributions[s.inventory_id] = 0;
                }
                allDistributions[s.inventory_id] += s.stock;
            });
        }
        
        // جلب المبيعات
        const invoicesResponse = await fetch(`${API_URL}/api/invoices`);
        const invoicesData = await invoicesResponse.json();
        if (invoicesData.success) {
            invoicesData.invoices.forEach(inv => {
                if (inv.items) {
                    inv.items.forEach(item => {
                        // نحتاج inventory_id من branch_stock
                        // سنحسب من اسم المنتج (مؤقتاً)
                        const product = allInventory.find(p => p.name === item.product_name);
                        if (product) {
                            if (!allSold[product.id]) {
                                allSold[product.id] = 0;
                            }
                            allSold[product.id] += item.quantity;
                        }
                    });
                }
            });
        }
        
        // جلب التالف
        const damagedResponse = await fetch(`${API_URL}/api/damaged-items`);
        const damagedData = await damagedResponse.json();
        if (damagedData.success) {
            damagedData.damaged.forEach(d => {
                if (!allDamaged[d.inventory_id]) {
                    allDamaged[d.inventory_id] = 0;
                }
                allDamaged[d.inventory_id] += d.quantity;
            });
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
    
    let html = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>الصورة</th>
                    <th>اسم المنتج</th>
                    <th>الباركود</th>
                    <th>الفئة</th>
                    <th>السعر</th>
                    <th>التكلفة</th>
                    <th>الموزع</th>
                    <th>المباع</th>
                    <th>التالف</th>
                    <th>إجراءات</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    allInventory.forEach(item => {
        let imgDisplay = '🛍️';
        if (item.image_data && item.image_data.startsWith('data:image')) {
            imgDisplay = `<img src="${item.image_data}" style="width:40px; height:40px; object-fit:cover; border-radius:5px;">`;
        }
        
        const distributed = allDistributions[item.id] || 0;
        const sold = allSold[item.id] || 0;
        const damaged = allDamaged[item.id] || 0;
        
        const distributedDisplay = distributed > 0 
            ? `<span style="background: #d4edda; padding: 5px 10px; border-radius: 5px; font-weight: bold;">${distributed}</span>` 
            : `<span style="color: #999;">0</span>`;
        
        const soldDisplay = sold > 0
            ? `<span style="background: #fff3cd; padding: 5px 10px; border-radius: 5px; font-weight: bold;">${sold}</span>`
            : `<span style="color: #999;">0</span>`;
        
        const damagedDisplay = damaged > 0
            ? `<span style="background: #f8d7da; padding: 5px 10px; border-radius: 5px; font-weight: bold;">${damaged}</span>`
            : `<span style="color: #999;">0</span>`;
        
        const hasVariants = item.variants && item.variants.length > 0;
        const variantBadge = hasVariants
            ? ` <button onclick="toggleInventoryVariants(${item.id})" class="btn-sm" style="background:#38a169;color:white;padding:2px 8px;font-size:11px;border-radius:6px;cursor:pointer;">📐 ${item.variants.length} خاصية</button>`
            : '';

        html += `
            <tr>
                <td style="text-align: center;">${imgDisplay}</td>
                <td><strong>${item.name}</strong>${variantBadge}</td>
                <td>${item.barcode || '-'}</td>
                <td>${item.category || '-'}</td>
                <td>${item.price.toFixed(3)} د.ك</td>
                <td>${(item.cost || 0).toFixed(3)} د.ك</td>
                <td style="text-align: center;">${distributedDisplay}</td>
                <td style="text-align: center;">${soldDisplay}</td>
                <td style="text-align: center;">${damagedDisplay}</td>
                <td>
                    <button onclick="editInventory(${item.id})" class="btn-sm">✏️</button>
                    <button onclick="deleteInventory(${item.id})" class="btn-sm btn-danger">🗑️</button>
                    <button onclick="distributeToBranch(${item.id})" class="btn-sm" style="background: #3182ce;">📤</button>
                    <button onclick="reportDamage(${item.id})" class="btn-sm" style="background: #e53e3e;">💔</button>
                </td>
            </tr>
        `;

        if (hasVariants) {
            html += `
            <tr id="invVariants_${item.id}" style="display: none;">
                <td colspan="10" style="padding: 0;">
                    <div style="background: #f0fff4; padding: 12px; border-radius: 8px; margin: 5px;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr style="background: #38a169; color: white;">
                                    <th style="padding: 8px; border-radius: 0 6px 0 0;">الخاصية</th>
                                    <th style="padding: 8px;">السعر</th>
                                    <th style="padding: 8px;">التكلفة</th>
                                    <th style="padding: 8px; border-radius: 6px 0 0 0;">الباركود</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${item.variants.map(v => `
                                <tr style="border-bottom: 1px solid #c6f6d5;">
                                    <td style="padding: 8px; text-align: center; font-weight: bold;">${v.variant_name}</td>
                                    <td style="padding: 8px; text-align: center; color: #38a169; font-weight: bold;">${v.price.toFixed(3)} د.ك</td>
                                    <td style="padding: 8px; text-align: center; color: #e53e3e;">${(v.cost || 0).toFixed(3)} د.ك</td>
                                    <td style="padding: 8px; text-align: center; color: #666;">${v.barcode || '-'}</td>
                                </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                </td>
            </tr>`;
        }
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function toggleInventoryVariants(inventoryId) {
    const row = document.getElementById('invVariants_' + inventoryId);
    if (row) {
        row.style.display = row.style.display === 'none' ? '' : 'none';
    }
}

// ===== نظام خصائص/متغيرات المنتجات =====
let variantRowCounter = 0;

function addVariantRow(data = {}) {
    variantRowCounter++;
    const container = document.getElementById('variantsContainer');
    const emptyMsg = document.getElementById('variantsEmptyMsg');
    if (emptyMsg) emptyMsg.style.display = 'none';

    const row = document.createElement('div');
    row.id = `variantRow_${variantRowCounter}`;
    row.style.cssText = 'display: grid; grid-template-columns: 2fr 1fr 1fr 1fr auto; gap: 8px; align-items: center; margin-bottom: 8px; background: white; padding: 10px; border-radius: 8px; border: 1px solid #c6f6d5;';
    row.innerHTML = `
        <input type="text" placeholder="الاسم (مثل: صغير، وسط، كبير، 500مل)" value="${data.variant_name || ''}" class="variant-name" style="padding: 8px; border: 1px solid #ddd; border-radius: 6px; text-align: right;">
        <input type="number" placeholder="السعر" step="0.001" value="${data.price || ''}" class="variant-price" style="padding: 8px; border: 1px solid #ddd; border-radius: 6px; text-align: right;">
        <input type="number" placeholder="التكلفة" step="0.001" value="${data.cost || ''}" class="variant-cost" style="padding: 8px; border: 1px solid #ddd; border-radius: 6px; text-align: right;">
        <input type="text" placeholder="باركود" value="${data.barcode || ''}" class="variant-barcode" style="padding: 8px; border: 1px solid #ddd; border-radius: 6px; text-align: right;">
        <button type="button" onclick="removeVariantRow('variantRow_${variantRowCounter}')" style="background: #dc3545; color: white; border: none; border-radius: 6px; padding: 8px 12px; cursor: pointer;">🗑️</button>
    `;
    container.appendChild(row);
}

function removeVariantRow(rowId) {
    document.getElementById(rowId)?.remove();
    const container = document.getElementById('variantsContainer');
    const emptyMsg = document.getElementById('variantsEmptyMsg');
    if (container.children.length === 0 && emptyMsg) {
        emptyMsg.style.display = 'block';
    }
}

function getVariantsData() {
    const rows = document.querySelectorAll('#variantsContainer > div');
    const variants = [];
    rows.forEach(row => {
        const name = row.querySelector('.variant-name')?.value?.trim();
        const price = parseFloat(row.querySelector('.variant-price')?.value) || 0;
        const cost = parseFloat(row.querySelector('.variant-cost')?.value) || 0;
        const barcode = row.querySelector('.variant-barcode')?.value?.trim() || '';
        if (name) {
            variants.push({ variant_name: name, price, cost, barcode });
        }
    });
    return variants;
}

function loadVariantsToForm(variants) {
    const container = document.getElementById('variantsContainer');
    const emptyMsg = document.getElementById('variantsEmptyMsg');
    container.innerHTML = '';
    variantRowCounter = 0;

    if (variants && variants.length > 0) {
        if (emptyMsg) emptyMsg.style.display = 'none';
        variants.forEach(v => addVariantRow(v));
    } else {
        if (emptyMsg) emptyMsg.style.display = 'block';
    }
}

function showAddInventory() {
    updateCategoryDropdown();
    document.getElementById('inventoryModalTitle').textContent = '➕ إضافة منتج للمخزون';
    document.getElementById('inventoryForm').reset();
    document.getElementById('inventoryId').value = '';
    document.getElementById('inventoryImageData').value = '';
    document.getElementById('inventoryImagePreview').style.display = 'none';

    // تهيئة نظام التكاليف
    initializeInventoryCosts();

    // تهيئة المتغيرات
    loadVariantsToForm([]);

    document.getElementById('addInventoryModal').classList.add('active');
}

function closeAddInventory() {
    document.getElementById('addInventoryModal').classList.remove('active');
}

// حفظ منتج المخزون
document.getElementById('inventoryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inventoryId = document.getElementById('inventoryId').value;
    const newCat = document.getElementById('inventoryNewCategory').value.trim();
    const category = newCat || document.getElementById('inventoryCategory').value;
    
    const inventoryData = {
        name: document.getElementById('inventoryName').value,
        barcode: document.getElementById('inventoryBarcode').value,
        category: category,
        price: parseFloat(document.getElementById('inventoryPrice').value),
        cost: parseFloat(document.getElementById('inventoryCost').value) || 0,
        costs: JSON.stringify(getInventoryCostsData()),
        image_data: document.getElementById('inventoryImageData').value
    };
    
    // زر الحفظ
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : '';
    
    try {
        // تعطيل الزر
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = '🔄 جاري الحفظ...';
        }
        
        const url = inventoryId ? `${API_URL}/api/inventory/${inventoryId}` : `${API_URL}/api/inventory`;
        const method = inventoryId ? 'PUT' : 'POST';
        
        // بدون AbortController - فقط fetch عادي
        const response = await fetch(url, {
            method: method,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(inventoryData)
        });
        
        if (!response.ok) {
            throw new Error(`خطأ في الاتصال: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            // حفظ المتغيرات
            const savedId = data.id || inventoryId;
            const variants = getVariantsData();
            try {
                await fetch(`${API_URL}/api/inventory/${savedId}/variants`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ variants })
                });
            } catch (e) {
                console.error('خطأ حفظ المتغيرات:', e);
            }

            // تسجيل في السجل
            try {
                const action = inventoryId ? 'edit_inventory' : 'add_inventory';
                const description = inventoryId ? `تعديل منتج: ${inventoryData.name}` : `إضافة منتج: ${inventoryData.name}`;
                await logAction(action, description, savedId);
            } catch (e) {
                // تجاهل خطأ السجل
            }

            // رسالة نجاح
            if (typeof showSuccess === 'function') {
                showSuccess('✅ تم حفظ المنتج بنجاح');
            } else {
                alert('✅ تم الحفظ');
            }

            closeAddInventory();
            await loadInventory();
        } else {
            throw new Error(data.error || 'فشل الحفظ');
        }
        
    } catch (error) {
        // تجاهل الأخطاء المتعلقة بـ runtime
        if (error && error.message && error.message.includes('runtime')) {
            return;
        }
        
        console.error('خطأ في حفظ المخزون:', error);
        
        // رسالة خطأ بسيطة
        let errorMessage = '⚠️ حدث خطأ أثناء الحفظ';
        
        if (error.message && error.message.includes('Failed to fetch')) {
            errorMessage = '🌐 لا يوجد اتصال بالسيرفر\n\nتحقق من:\n• الاتصال بالإنترنت\n• في البيت؟ استخدم: 192.168.8.21:8080';
        } else if (error.message && !error.message.includes('AbortError')) {
            errorMessage = `⚠️ ${error.message}`;
        }
        
        // عرض الخطأ
        if (typeof showError === 'function') {
            showError(errorMessage, 6000);
        } else {
            alert(errorMessage);
        }
        
    } finally {
        // إعادة تفعيل الزر دائماً
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    }
});

async function editInventory(id) {
    const item = allInventory.find(i => i.id === id);
    if (!item) return;
    
    updateCategoryDropdown();
    document.getElementById('inventoryModalTitle').textContent = '✏️ تعديل منتج';
    document.getElementById('inventoryId').value = item.id;
    document.getElementById('inventoryName').value = item.name;
    document.getElementById('inventoryBarcode').value = item.barcode || '';
    document.getElementById('inventoryPrice').value = item.price;
    document.getElementById('inventoryCost').value = item.cost || 0;
    document.getElementById('inventoryCategory').value = item.category || '';
    document.getElementById('inventoryImageData').value = item.image_data || '';
    
    // تحميل التكاليف التفصيلية
    let costs = [];
    if (item.costs) {
        try {
            costs = JSON.parse(item.costs);
        } catch (e) {
            console.error('Error parsing costs:', e);
        }
    }
    loadInventoryCosts(costs);
    
    if (item.image_data && item.image_data.startsWith('data:image')) {
        document.getElementById('inventoryImageDisplay').innerHTML = `<img src="${item.image_data}" style="max-width:80px; max-height:80px; border-radius:8px;">`;
        document.getElementById('inventoryImagePreview').style.display = 'block';
    } else {
        document.getElementById('inventoryImagePreview').style.display = 'none';
    }

    // تحميل المتغيرات
    loadVariantsToForm(item.variants || []);

    document.getElementById('addInventoryModal').classList.add('active');
}

async function deleteInventory(id) {
    if (!confirm('حذف هذا المنتج من المخزون؟\n(سيتم حذف جميع التوزيعات على الفروع)')) return;
    try {
        const response = await fetch(`${API_URL}/api/inventory/${id}`, {method: 'DELETE'});
        const data = await response.json();
        if (data.success) {
            alert('✅ تم الحذف');
            await loadInventory();
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

let currentDistributionProduct = null;

async function distributeToBranch(inventoryId) {
    const product = allInventory.find(p => p.id === inventoryId);
    if (!product) return;

    currentDistributionProduct = product;

    // عرض معلومات المنتج
    let variantsInfo = '';
    if (product.variants && product.variants.length > 0) {
        variantsInfo = `
            <div style="margin-top: 10px; background: #f0fff4; padding: 10px; border-radius: 8px; border: 1px solid #c6f6d5;">
                <strong style="color: #38a169;">📐 الخصائص:</strong>
                <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;">
                    ${product.variants.map(v => `<span style="background: #38a169; color: white; padding: 4px 10px; border-radius: 20px; font-size: 12px;">${v.variant_name} - ${v.price.toFixed(3)} د.ك</span>`).join('')}
                </div>
            </div>
        `;
    }

    document.getElementById('distributionProductInfo').innerHTML = `
        <div style="display: flex; align-items: center; gap: 15px;">
            <div style="font-size: 50px;">🛍️</div>
            <div style="flex: 1;">
                <h3 style="margin: 0;">${product.name}</h3>
                <p style="margin: 5px 0 0; color: #666;">السعر: ${product.price.toFixed(3)} د.ك | التكلفة: ${(product.cost || 0).toFixed(3)} د.ك</p>
                ${variantsInfo}
            </div>
        </div>
    `;

    // تحميل قائمة الخصائص في التوزيع
    const variantGroup = document.getElementById('distributionVariantGroup');
    const variantSelect = document.getElementById('distributionVariant');
    if (product.variants && product.variants.length > 0) {
        variantGroup.style.display = 'block';
        variantSelect.innerHTML = '<option value="">المنتج الأساسي</option>' +
            product.variants.map(v => `<option value="${v.id}">${v.variant_name} (${v.price.toFixed(3)} د.ك)</option>`).join('');
    } else {
        variantGroup.style.display = 'none';
        variantSelect.innerHTML = '<option value="">المنتج الأساسي</option>';
    }

    // تحميل الفروع
    await loadBranchesForDistribution();

    // تحميل التوزيعات الحالية
    await loadCurrentDistributions(inventoryId);

    // فتح modal
    document.getElementById('distributionModal').classList.add('active');
}

async function loadBranchesForDistribution() {
    try {
        const response = await fetch(`${API_URL}/api/branches`);
        const data = await response.json();
        if (data.success) {
            const select = document.getElementById('distributionBranch');
            select.innerHTML = data.branches.map(b => 
                `<option value="${b.id}">${b.name}</option>`
            ).join('');
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

async function loadCurrentDistributions(inventoryId) {
    try {
        const response = await fetch(`${API_URL}/api/branch-stock?inventory_id=${inventoryId}`);
        const data = await response.json();
        
        const container = document.getElementById('currentDistributions');
        
        if (data.success && data.stock.length > 0) {
            // تحميل أسماء الفروع
            const branchesResponse = await fetch(`${API_URL}/api/branches`);
            const branchesData = await branchesResponse.json();
            const branches = {};
            if (branchesData.success) {
                branchesData.branches.forEach(b => branches[b.id] = b.name);
            }
            
            let html = '<table class="data-table"><thead><tr><th>الفرع</th><th>الخاصية</th><th>الكمية</th><th>إجراءات</th></tr></thead><tbody>';

            data.stock.forEach(s => {
                const branchName = branches[s.branch_id] || 'غير محدد';
                const variantLabel = s.variant_name
                    ? `<span style="background:#38a169; color:white; padding:2px 8px; border-radius:12px; font-size:12px;">📐 ${s.variant_name}</span>`
                    : '<span style="color:#999;">الأساسي</span>';
                html += `
                    <tr>
                        <td>🏢 ${branchName}</td>
                        <td>${variantLabel}</td>
                        <td><strong>${s.stock}</strong></td>
                        <td>
                            <button onclick="editDistribution(${s.id}, ${s.stock})" class="btn-sm">✏️ تعديل</button>
                            <button onclick="deleteDistribution(${s.id})" class="btn-sm btn-danger">🗑️ حذف</button>
                        </td>
                    </tr>
                `;
            });
            
            html += '</tbody></table>';
            container.innerHTML = html;
        } else {
            container.innerHTML = '<p style="text-align: center; padding: 20px; color: #999;">لا توجد توزيعات حالياً</p>';
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

function closeDistribution() {
    document.getElementById('distributionModal').classList.remove('active');
    currentDistributionProduct = null;
}

// حفظ توزيع جديد
document.getElementById('distributionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!currentDistributionProduct) return;
    
    const variantVal = document.getElementById('distributionVariant')?.value;
    const distributionData = {
        inventory_id: currentDistributionProduct.id,
        branch_id: parseInt(document.getElementById('distributionBranch').value),
        stock: parseInt(document.getElementById('distributionStock').value),
        variant_id: variantVal ? parseInt(variantVal) : null
    };
    
    try {
        const response = await fetch(`${API_URL}/api/branch-stock`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(distributionData)
        });
        const data = await response.json();
        if (data.success) {
            // تسجيل في السجل
            const variantName = document.getElementById('distributionVariant')?.selectedOptions[0]?.textContent || '';
            await logAction('distribute', `توزيع ${distributionData.stock} من ${currentDistributionProduct.name} ${variantName}`, data.id);
            alert('✅ تم التوزيع');
            document.getElementById('distributionForm').reset();
            await loadCurrentDistributions(currentDistributionProduct.id);
            // تحديث المخزون
            await loadInventory();
        } else {
            alert('خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('خطأ:', error);
        alert('حدث خطأ');
    }
});

async function editDistribution(stockId, currentStock) {
    const newStock = prompt('الكمية الجديدة:', currentStock);
    if (newStock === null) return;
    
    const stock = parseInt(newStock);
    if (isNaN(stock) || stock < 0) {
        alert('الرجاء إدخال رقم صحيح');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/branch-stock/${stockId}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ stock })
        });
        const data = await response.json();
        if (data.success) {
            alert('✅ تم التحديث');
            await loadCurrentDistributions(currentDistributionProduct.id);
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

async function deleteDistribution(stockId) {
    if (!confirm('حذف هذا التوزيع؟')) return;
    
    try {
        const response = await fetch(`${API_URL}/api/branch-stock/${stockId}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (data.success) {
            alert('✅ تم الحذف');
            await loadCurrentDistributions(currentDistributionProduct.id);
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

// معالجة صورة المخزون
function handleInventoryImage(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        if (file.size > 500000) {
            if (confirm('الصورة كبيرة. تصغير؟')) {
                resizeInventoryImage(file, 100, 100);
            } else {
                return;
            }
        } else {
            resizeInventoryImage(file, 100, 100);
        }
    }
}

function resizeInventoryImage(file, maxW, maxH) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const ratio = Math.min(maxW/img.width, maxH/img.height);
            canvas.width = img.width * ratio;
            canvas.height = img.height * ratio;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            document.getElementById('inventoryImageData').value = dataUrl;
            document.getElementById('inventoryImageDisplay').innerHTML = `<img src="${dataUrl}" style="max-width:80px; max-height:80px; border-radius:8px;">`;
            document.getElementById('inventoryImagePreview').style.display = 'block';
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function removeInventoryImage() {
    document.getElementById('inventoryImageData').value = '';
    document.getElementById('inventoryImagePreview').style.display = 'none';
}

// ===== نظام التالف =====

let currentDamageProduct = null;
let branchStockData = {};

async function reportDamage(inventoryId) {
    const product = allInventory.find(p => p.id === inventoryId);
    if (!product) return;
    
    currentDamageProduct = product;
    
    // عرض معلومات المنتج
    document.getElementById('damageProductInfo').innerHTML = `
        <div style="display: flex; align-items: center; gap: 15px;">
            <div style="font-size: 40px;">⚠️</div>
            <div>
                <h3 style="margin: 0;">${product.name}</h3>
                <p style="margin: 5px 0 0; color: #666;">سعر القطعة: ${product.price.toFixed(3)} د.ك</p>
            </div>
        </div>
    `;
    
    // تحميل الفروع
    await loadBranchesForDamage();
    
    // فتح modal
    document.getElementById('damageModal').classList.add('active');
}

async function loadBranchesForDamage() {
    try {
        // جلب الفروع
        const branchesResponse = await fetch(`${API_URL}/api/branches`);
        const branchesData = await branchesResponse.json();
        
        // جلب التوزيعات
        const stockResponse = await fetch(`${API_URL}/api/branch-stock?inventory_id=${currentDamageProduct.id}`);
        const stockData = await stockResponse.json();
        
        branchStockData = {};
        if (stockData.success) {
            stockData.stock.forEach(s => {
                branchStockData[s.branch_id] = s.stock;
            });
        }
        
        // تعبئة select
        if (branchesData.success) {
            const select = document.getElementById('damageBranch');
            select.innerHTML = branchesData.branches
                .filter(b => branchStockData[b.id] > 0)
                .map(b => `<option value="${b.id}">${b.name} (متاح: ${branchStockData[b.id]})</option>`)
                .join('');
            
            if (select.options.length === 0) {
                select.innerHTML = '<option value="">لا توجد توزيعات متاحة</option>';
            } else {
                updateDamageStock();
            }
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

function updateDamageStock() {
    const branchId = document.getElementById('damageBranch').value;
    const available = branchStockData[branchId] || 0;
    document.getElementById('availableStock').textContent = `${available} قطعة`;
}

function closeDamageModal() {
    document.getElementById('damageModal').classList.remove('active');
    currentDamageProduct = null;
}

// حفظ التالف
document.getElementById('damageForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!currentDamageProduct) return;
    
    const branchId = parseInt(document.getElementById('damageBranch').value);
    const quantity = parseInt(document.getElementById('damageQuantity').value);
    const reason = document.getElementById('damageReason').value;
    
    // التحقق من الكمية
    const available = branchStockData[branchId] || 0;
    if (quantity > available) {
        alert(`الكمية المتاحة: ${available} فقط`);
        return;
    }
    
    const damageData = {
        inventory_id: currentDamageProduct.id,
        branch_id: branchId,
        quantity: quantity,
        reason: reason,
        reported_by: currentUser.id
    };
    
    try {
        const response = await fetch(`${API_URL}/api/damaged-items`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(damageData)
        });
        const data = await response.json();
        if (data.success) {
            // تسجيل في السجل
            await logAction('damage', `تالف: ${quantity} من ${currentDamageProduct.name} (${reason || 'بدون سبب'})`, data.id);
            alert('✅ تم تسجيل التالف وخصمه من المخزون');
            closeDamageModal();
            await loadInventory();
        } else {
            alert('خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('خطأ:', error);
        alert('حدث خطأ');
    }
});

// ===== دوال التقارير =====

async function loadBranchesForReports() {
    try {
        const response = await fetch(`${API_URL}/api/branches`);
        const data = await response.json();
        if (data.success) {
            const select = document.getElementById('reportBranch');
            if (select) {
                select.innerHTML = '<option value="">كل الفروع</option>';
                data.branches.forEach(b => {
                    select.innerHTML += `<option value="${b.id}">${b.name}</option>`;
                });
            }
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

async function loadSalesReport() {
    const startDate = document.getElementById('reportStartDate').value;
    const endDate = document.getElementById('reportEndDate').value;
    const branchId = document.getElementById('reportBranch').value;
    
    try {
        let url = `${API_URL}/api/reports/sales?`;
        if (startDate) url += `start_date=${startDate}&`;
        if (endDate) url += `end_date=${endDate}&`;
        if (branchId) url += `branch_id=${branchId}&`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            const report = data.report;
            window.currentSalesReport = report; // حفظ للتصدير
            let html = `
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; border-radius: 10px; margin-bottom: 20px;">
                    <h2 style="margin: 0 0 20px;">📊 تقرير المبيعات</h2>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px;">
                        <div>
                            <div style="font-size: 14px; opacity: 0.9;">عدد الفواتير</div>
                            <div style="font-size: 32px; font-weight: bold;">${report.total_invoices || 0}</div>
                        </div>
                        <div>
                            <div style="font-size: 14px; opacity: 0.9;">إجمالي المبيعات</div>
                            <div style="font-size: 32px; font-weight: bold;">${(report.total_sales || 0).toFixed(3)} د.ك</div>
                        </div>
                        <div>
                            <div style="font-size: 14px; opacity: 0.9;">متوسط الفاتورة</div>
                            <div style="font-size: 32px; font-weight: bold;">${(report.average_sale || 0).toFixed(3)} د.ك</div>
                        </div>
                        <div>
                            <div style="font-size: 14px; opacity: 0.9;">الخصومات</div>
                            <div style="font-size: 32px; font-weight: bold;">${(report.total_discount || 0).toFixed(3)} د.ك</div>
                        </div>
                    </div>
                </div>
                
                <div style="margin-bottom: 20px;">
                    <h3>طرق الدفع:</h3>
                    <table class="data-table">
                        <thead><tr><th>الطريقة</th><th>العدد</th><th>الإجمالي</th></tr></thead>
                        <tbody>
            `;
            
            (report.payment_methods || []).forEach(pm => {
                html += `<tr><td>${pm.payment_method}</td><td>${pm.count}</td><td>${pm.total.toFixed(3)} د.ك</td></tr>`;
            });
            
            html += `</tbody></table></div>`;
            
            if (report.branches && report.branches.length > 0) {
                html += `
                    <div style="margin-bottom: 20px;">
                        <h3>حسب الفرع:</h3>
                        <table class="data-table">
                            <thead><tr><th>الفرع</th><th>العدد</th><th>الإجمالي</th></tr></thead>
                            <tbody>
                `;
                
                report.branches.forEach(b => {
                    html += `<tr><td>${b.branch_name}</td><td>${b.count}</td><td>${b.total.toFixed(3)} د.ك</td></tr>`;
                });
                
                html += `</tbody></table></div>`;
            }
            
            html += `<button onclick="exportSalesReport()" class="btn" style="background: #38a169;">📊 تصدير Excel</button>`;
            
            document.getElementById('reportsContent').innerHTML = html;
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

async function loadInventoryReport() {
    const branchId = document.getElementById('reportBranch').value;
    
    try {
        let url = `${API_URL}/api/reports/inventory?`;
        if (branchId) url += `branch_id=${branchId}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            const report = data.report;
            window.currentInventoryReport = report; // حفظ للتصدير
            let html = `
                <div style="background: linear-gradient(135deg, #38a169 0%, #2c7a7b 100%); color: white; padding: 25px; border-radius: 10px; margin-bottom: 20px;">
                    <h2 style="margin: 0 0 20px;">📦 تقرير المخزون</h2>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px;">
                        <div>
                            <div style="font-size: 14px; opacity: 0.9;">عدد المنتجات</div>
                            <div style="font-size: 32px; font-weight: bold;">${report.total_items || 0}</div>
                        </div>
                        <div>
                            <div style="font-size: 14px; opacity: 0.9;">إجمالي الكميات</div>
                            <div style="font-size: 32px; font-weight: bold;">${report.total_stock || 0}</div>
                        </div>
                        <div>
                            <div style="font-size: 14px; opacity: 0.9;">قيمة المخزون</div>
                            <div style="font-size: 32px; font-weight: bold;">${(report.total_value || 0).toFixed(3)} د.ك</div>
                        </div>
                    </div>
                </div>
                
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>المنتج</th>
                            <th>الفرع</th>
                            <th>الكمية</th>
                            <th>التكلفة</th>
                            <th>القيمة</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            (report.items || []).forEach(item => {
                if (item.stock > 0) {
                    html += `
                        <tr>
                            <td>${item.name}</td>
                            <td>${item.branch_name || '-'}</td>
                            <td>${item.stock}</td>
                            <td>${(item.cost || 0).toFixed(3)} د.ك</td>
                            <td><strong>${(item.stock_value || 0).toFixed(3)} د.ك</strong></td>
                        </tr>
                    `;
                }
            });
            
            html += `</tbody></table>`;
            html += `<button onclick="exportInventoryReport()" class="btn" style="background: #38a169; margin-top: 20px;">📊 تصدير Excel</button>`;
            
            document.getElementById('reportsContent').innerHTML = html;
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

async function loadDamagedReport() {
    const startDate = document.getElementById('reportStartDate').value;
    const endDate = document.getElementById('reportEndDate').value;
    const branchId = document.getElementById('reportBranch').value;
    
    try {
        let url = `${API_URL}/api/reports/damaged?`;
        if (startDate) url += `start_date=${startDate}&`;
        if (endDate) url += `end_date=${endDate}&`;
        if (branchId) url += `branch_id=${branchId}&`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            const report = data.report;
            window.currentDamagedReport = report; // حفظ للتصدير
            let html = `
                <div style="background: linear-gradient(135deg, #e53e3e 0%, #c53030 100%); color: white; padding: 25px; border-radius: 10px; margin-bottom: 20px;">
                    <h2 style="margin: 0 0 20px;">💔 تقرير التالف</h2>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px;">
                        <div>
                            <div style="font-size: 14px; opacity: 0.9;">إجمالي الكميات</div>
                            <div style="font-size: 32px; font-weight: bold;">${report.total_damaged || 0}</div>
                        </div>
                        <div>
                            <div style="font-size: 14px; opacity: 0.9;">قيمة التالف</div>
                            <div style="font-size: 32px; font-weight: bold;">${(report.total_value || 0).toFixed(3)} د.ك</div>
                        </div>
                    </div>
                </div>
                
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>التاريخ</th>
                            <th>المنتج</th>
                            <th>الفرع</th>
                            <th>الكمية</th>
                            <th>السبب</th>
                            <th>القيمة</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            (report.items || []).forEach(item => {
                const date = new Date(item.created_at).toLocaleDateString('ar-EG');
                html += `
                    <tr>
                        <td>${date}</td>
                        <td>${item.product_name}</td>
                        <td>${item.branch_name || '-'}</td>
                        <td>${item.quantity}</td>
                        <td>${item.reason || '-'}</td>
                        <td><strong>${(item.damage_value || 0).toFixed(3)} د.ك</strong></td>
                    </tr>
                `;
            });
            
            html += `</tbody></table>`;
            html += `<button onclick="exportDamagedReport()" class="btn" style="background: #e53e3e; margin-top: 20px;">📊 تصدير Excel</button>`;
            
            document.getElementById('reportsContent').innerHTML = html;
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

// دوال تصدير التقارير (مبسطة - CSV)
function exportSalesReport() {
    alert('سيتم تصدير تقرير المبيعات قريباً');
}

function exportInventoryReport() {
    alert('سيتم تصدير تقرير المخزون قريباً');
}

function exportDamagedReport() {
    alert('سيتم تصدير تقرير التالف قريباً');
}

// ===== سجل النظام =====

async function loadSystemLogs() {
    try {
        const response = await fetch(`${API_URL}/api/system-logs?limit=100`);
        const data = await response.json();
        
        if (data.success) {
            const container = document.getElementById('systemLogsContent');
            let html = `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>التاريخ</th>
                            <th>نوع العملية</th>
                            <th>الوصف</th>
                            <th>المستخدم</th>
                            <th>الفرع</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            data.logs.forEach(log => {
                const date = new Date(log.created_at).toLocaleString('ar-EG');
                const actionIcons = {
                    'add_product': '➕',
                    'edit_product': '✏️',
                    'delete_product': '🗑️',
                    'distribute': '📤',
                    'damage': '💔',
                    'sale': '💰',
                    'login': '🔐',
                    'logout': '🚪'
                };
                const icon = actionIcons[log.action_type] || '📝';
                
                html += `
                    <tr>
                        <td style="font-size: 12px;">${date}</td>
                        <td>${icon} ${log.action_type}</td>
                        <td>${log.description || '-'}</td>
                        <td>${log.user_name || '-'}</td>
                        <td>${log.branch_id ? `B${log.branch_id}` : '-'}</td>
                    </tr>
                `;
            });
            
            html += '</tbody></table>';
            
            if (data.logs.length === 0) {
                html = '<p style="text-align: center; padding: 40px; color: #999;">لا توجد سجلات</p>';
            }
            
            container.innerHTML = html;
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

// دالة تسجيل العمليات
async function logAction(actionType, description, targetId = null) {
    if (!currentUser) return;
    
    try {
        await fetch(`${API_URL}/api/system-logs`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                action_type: actionType,
                description: description,
                user_id: currentUser.id,
                user_name: currentUser.full_name,
                branch_id: currentUser.branch_id,
                target_id: targetId
            })
        });
    } catch (error) {
        console.log('لم يتم تسجيل العملية');
    }
}

// ===== دوال تصدير التقارير CSV =====

function exportSalesReport() {
    if (!window.currentSalesReport) {
        alert('الرجاء تحميل التقرير أولاً');
        return;
    }
    
    const report = window.currentSalesReport;
    let csv = '\ufeffرقم الفاتورة,التاريخ,العميل,الهاتف,الفرع,الإجمالي,طريقة الدفع\n';
    
    (report.invoices || []).forEach(inv => {
        const date = new Date(inv.created_at).toLocaleDateString('ar-EG');
        csv += `"${inv.invoice_number}","${date}","${inv.customer_name || '-'}","${inv.customer_phone || '-'}","${inv.branch_name || '-'}",${inv.total.toFixed(3)},"${inv.payment_method}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sales_report_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

function exportInventoryReport() {
    if (!window.currentInventoryReport) {
        alert('الرجاء تحميل التقرير أولاً');
        return;
    }
    
    const report = window.currentInventoryReport;
    let csv = '\ufeffالمنتج,الفرع,الكمية,التكلفة,القيمة\n';
    
    (report.items || []).forEach(item => {
        if (item.stock > 0) {
            csv += `"${item.name}","${item.branch_name || '-'}",${item.stock},${(item.cost || 0).toFixed(3)},${(item.stock_value || 0).toFixed(3)}\n`;
        }
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `inventory_report_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

function exportDamagedReport() {
    if (!window.currentDamagedReport) {
        alert('الرجاء تحميل التقرير أولاً');
        return;
    }
    
    const report = window.currentDamagedReport;
    let csv = '\ufeffالتاريخ,المنتج,الفرع,الكمية,السبب,القيمة\n';
    
    (report.items || []).forEach(item => {
        const date = new Date(item.created_at).toLocaleDateString('ar-EG');
        csv += `"${date}","${item.product_name}","${item.branch_name || '-'}",${item.quantity},"${item.reason || '-'}",${(item.damage_value || 0).toFixed(3)}\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `damaged_report_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

// ===== دالة تحميل الفروع في المستخدمين =====

async function loadBranchesForUserForm() {
    try {
        const response = await fetch(`${API_URL}/api/branches`);
        const data = await response.json();
        if (data.success) {
            const select = document.getElementById('userBranch');
            if (select) {
                select.innerHTML = data.branches.map(b => 
                    `<option value="${b.id}">${b.name}</option>`
                ).join('');
            }
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

// ===== التكاليف (Expenses) =====

async function loadExpenses() {
    try {
        const startDate = document.getElementById('expenseStartDate').value;
        const endDate = document.getElementById('expenseEndDate').value;
        const branchId = document.getElementById('expenseBranchFilter').value;
        
        let url = `${API_URL}/api/expenses?`;
        if (startDate) url += `start_date=${startDate}&`;
        if (endDate) url += `end_date=${endDate}&`;
        if (branchId) url += `branch_id=${branchId}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            displayExpenses(data.expenses);
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

function displayExpenses(expenses) {
    const container = document.getElementById('expensesContainer');

    if (expenses.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: #6c757d;">لا توجد تكاليف</div>';
        return;
    }

    // حساب الإجمالي
    const total = expenses.reduce((sum, e) => sum + e.amount, 0);

    let html = `
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 12px; margin-bottom: 20px;">
            <h3 style="margin: 0 0 10px 0;">📊 إجمالي التكاليف</h3>
            <div style="font-size: 32px; font-weight: bold;">${total.toFixed(3)} د.ك</div>
            <div style="opacity: 0.9; margin-top: 5px;">${expenses.length} تكلفة</div>
        </div>

        <table class="data-table">
            <thead>
                <tr>
                    <th>التاريخ</th>
                    <th>النوع</th>
                    <th>المبلغ</th>
                    <th>الوصف</th>
                    <th>الفرع</th>
                    <th>إجراءات</th>
                </tr>
            </thead>
            <tbody>
                ${expenses.map(e => {
                    const hasSalary = e.expense_type === 'رواتب' && e.salary_details && e.salary_details.length > 0;
                    let row = `
                    <tr>
                        <td>${new Date(e.expense_date).toLocaleDateString('ar')}</td>
                        <td><strong>${e.expense_type}</strong>${hasSalary ? ` <button onclick="toggleSalaryExpand(${e.id})" class="btn-sm" style="background:#667eea;color:white;padding:2px 8px;font-size:11px;border-radius:6px;cursor:pointer;">👥 ${e.salary_details.length} موظف</button>` : ''}</td>
                        <td style="color: #dc3545; font-weight: bold;">${e.amount.toFixed(3)} د.ك</td>
                        <td>${e.description || '-'}</td>
                        <td>${e.branch_id || 'عام'}</td>
                        <td>
                            <button onclick="deleteExpense(${e.id})" class="btn-sm btn-danger">🗑️</button>
                        </td>
                    </tr>`;
                    if (hasSalary) {
                        row += `
                    <tr id="salaryExpand_${e.id}" style="display: none;">
                        <td colspan="6" style="padding: 0;">
                            <div style="background: #f0f4ff; padding: 12px; border-radius: 8px; margin: 5px;">
                                <table style="width: 100%; border-collapse: collapse;">
                                    <thead>
                                        <tr style="background: #667eea; color: white;">
                                            <th style="padding: 8px; border-radius: 0 6px 0 0;">اسم الموظف</th>
                                            <th style="padding: 8px; border-radius: 6px 0 0 0;">الراتب الشهري</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${e.salary_details.map(s => `
                                        <tr style="border-bottom: 1px solid #e2e8f0;">
                                            <td style="padding: 8px; text-align: center;">${s.employee_name}</td>
                                            <td style="padding: 8px; text-align: center; color: #dc3545; font-weight: bold;">${s.monthly_salary.toFixed(3)} د.ك</td>
                                        </tr>`).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </td>
                    </tr>`;
                    }
                    return row;
                }).join('')}
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function toggleSalaryExpand(expenseId) {
    const row = document.getElementById('salaryExpand_' + expenseId);
    if (row) {
        row.style.display = row.style.display === 'none' ? '' : 'none';
    }
}

// ===== نظام تفاصيل الرواتب =====
let salaryRowCounter = 0;

function toggleSalaryDetails() {
    const type = document.getElementById('expenseType').value;
    const section = document.getElementById('salaryDetailsSection');
    const amountInput = document.getElementById('expenseAmount');

    if (type === 'رواتب') {
        section.style.display = 'block';
        amountInput.readOnly = true;
        amountInput.style.background = '#e9ecef';
        // إضافة صف أول تلقائياً إذا فارغ
        if (document.getElementById('salaryRowsContainer').children.length === 0) {
            addSalaryRow();
        }
    } else {
        section.style.display = 'none';
        amountInput.readOnly = false;
        amountInput.style.background = '';
    }
}

function addSalaryRow() {
    salaryRowCounter++;
    const container = document.getElementById('salaryRowsContainer');
    const row = document.createElement('div');
    row.id = `salaryRow_${salaryRowCounter}`;
    row.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-bottom: 8px; background: white; padding: 10px; border-radius: 8px; border: 1px solid #e2e8f0;';
    row.innerHTML = `
        <div style="flex: 1;">
            <input type="text" placeholder="اسم الموظف" class="salary-emp-name" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px; text-align: right;">
        </div>
        <div style="flex: 1;">
            <input type="number" placeholder="الراتب الشهري" step="0.001" class="salary-emp-amount" oninput="calcSalaryTotal()" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px; text-align: right;">
        </div>
        <button type="button" onclick="removeSalaryRow('salaryRow_${salaryRowCounter}')" style="background: #dc3545; color: white; border: none; border-radius: 6px; padding: 8px 12px; cursor: pointer;">🗑️</button>
    `;
    container.appendChild(row);
}

function removeSalaryRow(rowId) {
    document.getElementById(rowId)?.remove();
    calcSalaryTotal();
}

function calcSalaryTotal() {
    const amounts = document.querySelectorAll('#salaryRowsContainer .salary-emp-amount');
    let total = 0;
    amounts.forEach(inp => {
        total += parseFloat(inp.value) || 0;
    });
    document.getElementById('salaryTotalDisplay').textContent = total.toFixed(3) + ' د.ك';
    document.getElementById('expenseAmount').value = total.toFixed(3);
}

function getSalaryDetails() {
    const rows = document.querySelectorAll('#salaryRowsContainer > div');
    const details = [];
    rows.forEach(row => {
        const name = row.querySelector('.salary-emp-name')?.value?.trim();
        const salary = parseFloat(row.querySelector('.salary-emp-amount')?.value) || 0;
        if (name && salary > 0) {
            details.push({ employee_name: name, monthly_salary: salary });
        }
    });
    return details;
}

function showAddExpense() {
    document.getElementById('expenseModalTitle').textContent = '➕ إضافة تكلفة';
    document.getElementById('expenseForm').reset();
    document.getElementById('expenseDate').valueAsDate = new Date();
    // إعادة تعيين قسم الرواتب
    document.getElementById('salaryDetailsSection').style.display = 'none';
    document.getElementById('salaryRowsContainer').innerHTML = '';
    document.getElementById('salaryTotalDisplay').textContent = '0.000 د.ك';
    document.getElementById('expenseAmount').readOnly = false;
    document.getElementById('expenseAmount').style.background = '';
    salaryRowCounter = 0;
    loadBranchesForExpense();
    document.getElementById('addExpenseModal').classList.add('active');
}

function closeAddExpense() {
    document.getElementById('addExpenseModal').classList.remove('active');
}

async function loadBranchesForExpense() {
    try {
        const response = await fetch(`${API_URL}/api/branches`);
        const data = await response.json();
        if (data.success) {
            const select = document.getElementById('expenseBranch');
            select.innerHTML = '<option value="">عام</option>' + 
                data.branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

async function loadBranchesForExpenseFilter() {
    try {
        const response = await fetch(`${API_URL}/api/branches`);
        const data = await response.json();
        if (data.success) {
            const select = document.getElementById('expenseBranchFilter');
            select.innerHTML = '<option value="">كل الفروع</option>' + 
                data.branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

document.getElementById('expenseForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const expenseType = document.getElementById('expenseType').value;
    const expenseData = {
        expense_type: expenseType,
        amount: parseFloat(document.getElementById('expenseAmount').value),
        description: document.getElementById('expenseDescription').value,
        expense_date: document.getElementById('expenseDate').value,
        branch_id: parseInt(document.getElementById('expenseBranch').value) || null,
        created_by: currentUser.id
    };

    // إضافة تفاصيل الرواتب إذا كان النوع رواتب
    if (expenseType === 'رواتب') {
        const salaryDetails = getSalaryDetails();
        if (salaryDetails.length === 0) {
            alert('يرجى إضافة موظف واحد على الأقل مع الراتب');
            return;
        }
        expenseData.salary_details = salaryDetails;
    }

    try {
        const response = await fetch(`${API_URL}/api/expenses`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(expenseData)
        });

        const data = await response.json();
        if (data.success) {
            alert('✅ تم الحفظ');
            closeAddExpense();
            await loadExpenses();
        } else {
            alert('خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
});

async function deleteExpense(id) {
    if (!confirm('هل أنت متأكد من حذف هذه التكلفة؟')) return;
    
    try {
        const response = await fetch(`${API_URL}/api/expenses/${id}`, {method: 'DELETE'});
        const data = await response.json();
        if (data.success) {
            alert('✅ تم الحذف');
            await loadExpenses();
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

// ===== التقارير المتقدمة (Advanced Reports) =====

async function loadProductReport() {
    try {
        const startDate = document.getElementById('advReportStartDate').value;
        const endDate = document.getElementById('advReportEndDate').value;
        const branchId = document.getElementById('advReportBranchFilter').value;
        
        let url = `${API_URL}/api/reports/sales-by-product?`;
        if (startDate) url += `start_date=${startDate}&`;
        if (endDate) url += `end_date=${endDate}&`;
        if (branchId) url += `branch_id=${branchId}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            displayProductReport(data);
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

function displayProductReport(data) {
    const container = document.getElementById('advancedReportContent');
    
    let html = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 15px rgba(102,126,234,0.3);">
                <div style="opacity: 0.9; margin-bottom: 5px;">إجمالي المبيعات</div>
                <div style="font-size: 32px; font-weight: bold;">${data.summary.total_sales.toFixed(3)} د.ك</div>
            </div>
            <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 15px rgba(240,147,251,0.3);">
                <div style="opacity: 0.9; margin-bottom: 5px;">الكمية المباعة</div>
                <div style="font-size: 32px; font-weight: bold;">${data.summary.total_quantity}</div>
            </div>
            <div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 15px rgba(79,172,254,0.3);">
                <div style="opacity: 0.9; margin-bottom: 5px;">عدد المنتجات</div>
                <div style="font-size: 32px; font-weight: bold;">${data.summary.products_count}</div>
            </div>
        </div>
        
        <div style="background: white; padding: 20px; border-radius: 12px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
            <canvas id="productChart" style="max-height: 400px;"></canvas>
        </div>
        
        <table class="data-table">
            <thead>
                <tr>
                    <th>المنتج</th>
                    <th>الكمية</th>
                    <th>المبيعات</th>
                    <th>عدد الفواتير</th>
                    <th>متوسط السعر</th>
                </tr>
            </thead>
            <tbody>
                ${data.products.map(p => `
                    <tr>
                        <td><strong>${p.product_name}</strong></td>
                        <td>${p.total_quantity}</td>
                        <td style="color: #28a745; font-weight: bold;">${p.total_sales.toFixed(3)} د.ك</td>
                        <td>${p.invoice_count}</td>
                        <td>${p.avg_price.toFixed(3)} د.ك</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = html;
    
    // رسم Chart
    setTimeout(() => {
        const ctx = document.getElementById('productChart').getContext('2d');
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.products.map(p => p.product_name),
                datasets: [{
                    label: 'المبيعات (د.ك)',
                    data: data.products.map(p => p.total_sales),
                    backgroundColor: 'rgba(102, 126, 234, 0.8)',
                    borderColor: 'rgba(102, 126, 234, 1)',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {display: true, position: 'top'}
                },
                scales: {
                    y: {beginAtZero: true}
                }
            }
        });
    }, 100);
}

async function loadBranchReport() {
    try {
        const startDate = document.getElementById('advReportStartDate').value;
        const endDate = document.getElementById('advReportEndDate').value;
        
        let url = `${API_URL}/api/reports/sales-by-branch?`;
        if (startDate) url += `start_date=${startDate}&`;
        if (endDate) url += `end_date=${endDate}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            displayBranchReport(data);
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

function displayBranchReport(data) {
    const container = document.getElementById('advancedReportContent');
    
    let html = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px;">
            <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 15px rgba(240,147,251,0.3);">
                <div style="opacity: 0.9; margin-bottom: 5px;">إجمالي المبيعات</div>
                <div style="font-size: 32px; font-weight: bold;">${data.summary.total_sales.toFixed(3)} د.ك</div>
            </div>
            <div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 15px rgba(79,172,254,0.3);">
                <div style="opacity: 0.9; margin-bottom: 5px;">عدد الفواتير</div>
                <div style="font-size: 32px; font-weight: bold;">${data.summary.total_invoices}</div>
            </div>
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 15px rgba(102,126,234,0.3);">
                <div style="opacity: 0.9; margin-bottom: 5px;">عدد الفروع</div>
                <div style="font-size: 32px; font-weight: bold;">${data.summary.branches_count}</div>
            </div>
        </div>
        
        <div style="background: white; padding: 20px; border-radius: 12px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
            <canvas id="branchChart" style="max-height: 400px;"></canvas>
        </div>
        
        <table class="data-table">
            <thead>
                <tr>
                    <th>الفرع</th>
                    <th>عدد الفواتير</th>
                    <th>المبيعات</th>
                    <th>الخصم</th>
                    <th>متوسط الفاتورة</th>
                </tr>
            </thead>
            <tbody>
                ${data.branches.map(b => `
                    <tr>
                        <td><strong>${b.branch_name}</strong></td>
                        <td>${b.invoice_count}</td>
                        <td style="color: #28a745; font-weight: bold;">${b.total_sales.toFixed(3)} د.ك</td>
                        <td style="color: #dc3545;">${b.total_discount.toFixed(3)} د.ك</td>
                        <td>${b.avg_sale.toFixed(3)} د.ك</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = html;
    
    // رسم Chart
    setTimeout(() => {
        const ctx = document.getElementById('branchChart').getContext('2d');
        new Chart(ctx, {
            type: 'pie',
            data: {
                labels: data.branches.map(b => b.branch_name),
                datasets: [{
                    label: 'المبيعات',
                    data: data.branches.map(b => b.total_sales),
                    backgroundColor: [
                        'rgba(102, 126, 234, 0.8)',
                        'rgba(240, 147, 251, 0.8)',
                        'rgba(79, 172, 254, 0.8)',
                        'rgba(245, 87, 108, 0.8)',
                        'rgba(118, 75, 162, 0.8)'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {display: true, position: 'right'}
                }
            }
        });
    }, 100);
}

async function loadProfitLossReport() {
    try {
        const startDate = document.getElementById('advReportStartDate').value;
        const endDate = document.getElementById('advReportEndDate').value;
        const branchId = document.getElementById('advReportBranchFilter').value;
        
        let url = `${API_URL}/api/reports/profit-loss?`;
        if (startDate) url += `start_date=${startDate}&`;
        if (endDate) url += `end_date=${endDate}&`;
        if (branchId) url += `branch_id=${branchId}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            displayProfitLossReport(data.report);
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

function displayProfitLossReport(report) {
    const container = document.getElementById('advancedReportContent');
    
    let html = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px;">
            <div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 15px rgba(79,172,254,0.3);">
                <div style="opacity: 0.9; font-size: 14px; margin-bottom: 5px;">إجمالي المبيعات</div>
                <div style="font-size: 28px; font-weight: bold;">${report.total_revenue.toFixed(3)}</div>
                <div style="opacity: 0.9; font-size: 12px;">د.ك</div>
            </div>
            <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 15px rgba(240,147,251,0.3);">
                <div style="opacity: 0.9; font-size: 14px; margin-bottom: 5px;">تكلفة البضاعة</div>
                <div style="font-size: 28px; font-weight: bold;">${report.total_cogs.toFixed(3)}</div>
                <div style="opacity: 0.9; font-size: 12px;">د.ك</div>
            </div>
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 15px rgba(102,126,234,0.3);">
                <div style="opacity: 0.9; font-size: 14px; margin-bottom: 5px;">الربح الإجمالي</div>
                <div style="font-size: 28px; font-weight: bold;">${report.gross_profit.toFixed(3)}</div>
                <div style="opacity: 0.9; font-size: 12px;">د.ك</div>
            </div>
            <div style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); color: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 15px rgba(250,112,154,0.3);">
                <div style="opacity: 0.9; font-size: 14px; margin-bottom: 5px;">التكاليف</div>
                <div style="font-size: 28px; font-weight: bold;">${report.total_expenses.toFixed(3)}</div>
                <div style="opacity: 0.9; font-size: 12px;">د.ك</div>
            </div>
            <div style="background: linear-gradient(135deg, #30cfd0 0%, #330867 100%); color: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 15px rgba(48,207,208,0.3);">
                <div style="opacity: 0.9; font-size: 14px; margin-bottom: 5px;">الربح الصافي</div>
                <div style="font-size: 28px; font-weight: bold;">${report.net_profit.toFixed(3)}</div>
                <div style="opacity: 0.9; font-size: 12px;">د.ك</div>
            </div>
            <div style="background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%); color: #2d3748; padding: 20px; border-radius: 12px; box-shadow: 0 4px 15px rgba(168,237,234,0.3);">
                <div style="opacity: 0.8; font-size: 14px; margin-bottom: 5px;">هامش الربح</div>
                <div style="font-size: 28px; font-weight: bold;">${report.profit_margin.toFixed(2)}%</div>
            </div>
        </div>
        
        <div style="background: white; padding: 30px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
            <canvas id="profitChart" style="max-height: 400px;"></canvas>
        </div>
    `;
    
    container.innerHTML = html;
    
    // رسم Chart
    setTimeout(() => {
        const ctx = document.getElementById('profitChart').getContext('2d');
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['المبيعات', 'تكلفة البضاعة', 'الربح الإجمالي', 'التكاليف', 'الربح الصافي'],
                datasets: [{
                    label: 'المبالغ (د.ك)',
                    data: [
                        report.total_revenue,
                        report.total_cogs,
                        report.gross_profit,
                        report.total_expenses,
                        report.net_profit
                    ],
                    backgroundColor: [
                        'rgba(79, 172, 254, 0.8)',
                        'rgba(245, 87, 108, 0.8)',
                        'rgba(102, 126, 234, 0.8)',
                        'rgba(250, 112, 154, 0.8)',
                        'rgba(48, 207, 208, 0.8)'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {display: false}
                },
                scales: {
                    y: {beginAtZero: true}
                }
            }
        });
    }, 100);
}

async function loadBranchesForAdvReports() {
    try {
        const response = await fetch(`${API_URL}/api/branches`);
        const data = await response.json();
        if (data.success) {
            const select = document.getElementById('advReportBranchFilter');
            select.innerHTML = '<option value="">كل الفروع</option>' + 
                data.branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}


// ===== العملاء (CRM) - عرض فواتير عميل =====

async function viewCustomerInvoices(customerId) {
    try {
        const response = await fetch(`${API_URL}/api/customers/${customerId}/invoices`);
        const data = await response.json();
        
        if (data.success) {
            // عرض الفواتير في modal
            let html = `
                <div style="max-height: 500px; overflow-y: auto;">
                    <h3 style="margin-bottom: 20px;">📋 فواتير العميل</h3>
                    ${data.invoices.length === 0 ? '<p>لا توجد فواتير</p>' : `
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>رقم الفاتورة</th>
                                    <th>التاريخ</th>
                                    <th>الإجمالي</th>
                                    <th>إجراءات</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${data.invoices.map(inv => `
                                    <tr>
                                        <td><strong>${inv.invoice_number}</strong></td>
                                        <td>${new Date(inv.created_at).toLocaleDateString('ar')}</td>
                                        <td style="color: #28a745; font-weight: bold;">${inv.total.toFixed(3)} د.ك</td>
                                        <td>
                                            <button onclick="viewInvoice(${inv.id})" class="btn-sm">👁️</button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    `}
                </div>
            `;
            
            document.getElementById('invoiceViewContent').innerHTML = html;
            document.getElementById('invoiceViewModal').classList.add('active');
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

async function exportCustomersExcel() {
    try {
        const response = await fetch(`${API_URL}/api/customers`);
        const data = await response.json();
        
        if (data.success) {
            const customers = data.customers.map(c => ({
                'الاسم': c.name || '-',
                'الهاتف': c.phone || '-',
                'العنوان': c.address || '-',
                'عدد الطلبات': c.total_orders || 0,
                'إجمالي الإنفاق': (c.total_spent || 0).toFixed(3),
                'تاريخ الإنشاء': new Date(c.created_at).toLocaleDateString('ar')
            }));
            
            const ws = XLSX.utils.json_to_sheet(customers);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'العملاء');
            XLSX.writeFile(wb, `customers_${Date.now()}.xlsx`);
        }
    } catch (error) {
        console.error('خطأ:', error);
    }
}

// ===== Dropdown العملاء في الفاتورة =====
let allCustomersDropdown = [];

async function loadCustomersDropdown() {
    try {
        const response = await fetch(`${API_URL}/api/customers`);
        const data = await response.json();
        
        if (data.success) {
            allCustomersDropdown = data.customers || [];
            updateCustomerSelect();
        }
    } catch (error) {
        console.error('[Customers] خطأ في تحميل العملاء:', error);
    }
}

function updateCustomerSelect() {
    // التوافق - لم نعد نستخدم select بل حقل بحث
}

// بحث العميل في نقطة البيع
function searchCustomerInPOS(query) {
    const container = document.getElementById('customerSearchResults');
    if (!container) return;

    const q = (query || '').trim().toLowerCase();
    if (!q) {
        // عرض آخر 10 عملاء
        const recent = allCustomersDropdown.slice(0, 10);
        if (recent.length === 0) {
            container.style.display = 'none';
            return;
        }
        container.innerHTML = recent.map(c => customerResultItem(c)).join('');
        container.style.display = 'block';
        return;
    }

    const filtered = allCustomersDropdown.filter(c => {
        const name = (c.name || '').toLowerCase();
        const phone = (c.phone || '').toLowerCase();
        return name.includes(q) || phone.includes(q);
    }).slice(0, 15);

    if (filtered.length === 0) {
        container.innerHTML = '<div style="padding:10px; text-align:center; color:#6c757d; font-size:13px;">لا توجد نتائج</div>';
        container.style.display = 'block';
        return;
    }

    container.innerHTML = filtered.map(c => customerResultItem(c)).join('');
    container.style.display = 'block';
}

function customerResultItem(c) {
    return `<div onclick="pickCustomerFromSearch('${c.id}')" style="padding:10px 12px; cursor:pointer; border-bottom:1px solid #eee; font-size:13px; display:flex; justify-content:space-between; align-items:center;"
        onmouseover="this.style.background='#f0f0ff'" onmouseout="this.style.background='white'">
        <span><strong>${c.name}</strong></span>
        <span style="color:#667eea; font-size:12px; direction:ltr;">${c.phone || ''}</span>
    </div>`;
}

function pickCustomerFromSearch(id) {
    const customer = allCustomersDropdown.find(c => c.id == id);
    if (!customer) return;

    document.getElementById('selectedCustomerId').value = customer.id;
    document.getElementById('customerName').value = customer.name;
    document.getElementById('customerPhone').value = customer.phone || '';
    document.getElementById('customerAddress').value = customer.address || '';

    document.getElementById('displayCustomerName').textContent = customer.name;
    document.getElementById('displayCustomerPhone').textContent = customer.phone || '-';
    document.getElementById('displayCustomerAddress').textContent = customer.address || '-';
    document.getElementById('customerDetails').style.display = 'block';

    // تحديث حقل البحث
    document.getElementById('customerSearchInput').value = customer.name;
    document.getElementById('customerSearchResults').style.display = 'none';

    // عرض قسم الولاء
    currentCustomerData = customer;
    document.getElementById('loyaltySection').style.display = 'block';
    document.getElementById('customerLoyaltyPoints').textContent = customer.loyalty_points || customer.points || 0;
    updatePointsToEarn();
}

// إغلاق نتائج البحث عند الضغط خارجها
document.addEventListener('click', (e) => {
    const input = document.getElementById('customerSearchInput');
    const results = document.getElementById('customerSearchResults');
    if (input && results && !input.contains(e.target) && !results.contains(e.target)) {
        results.style.display = 'none';
    }
});

function showAddCustomerFromPOS() {
    showAddCustomer();
}

function clearCustomerSelection() {
    document.getElementById('customerSearchInput').value = '';
    document.getElementById('customerSearchResults').style.display = 'none';
    document.getElementById('selectedCustomerId').value = '';
    document.getElementById('customerName').value = '';
    document.getElementById('customerPhone').value = '';
    document.getElementById('customerAddress').value = '';
    document.getElementById('customerDetails').style.display = 'none';
    document.getElementById('loyaltySection').style.display = 'none';
    document.getElementById('loyaltyDiscountRow').style.display = 'none';
    document.getElementById('pointsToRedeem').value = '';
    currentCustomerData = null;
}



// ========================================
// 🔔 Helper Functions للإشعارات
// ========================================

/**
 * عرض رسالة خطأ
 */
function showError(message, duration = 5000) {
    const oldNotif = document.getElementById('errorNotification');
    if (oldNotif) oldNotif.remove();
    
    const notification = document.createElement('div');
    notification.id = 'errorNotification';
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        left: 20px;
        max-width: 500px;
        margin: 0 auto;
        padding: 16px 24px;
        background: #dc3545;
        color: white;
        border-radius: 12px;
        font-weight: bold;
        z-index: 10001;
        box-shadow: 0 4px 20px rgba(220, 53, 69, 0.4);
        animation: slideInDown 0.3s ease;
        text-align: center;
    `;
    
    notification.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
            <span style="font-size: 24px;">⚠️</span>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOutUp 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, duration);
}

/**
 * عرض رسالة نجاح
 */
function showSuccess(message, duration = 3000) {
    const oldNotif = document.getElementById('successNotification');
    if (oldNotif) oldNotif.remove();
    
    const notification = document.createElement('div');
    notification.id = 'successNotification';
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        left: 20px;
        max-width: 500px;
        margin: 0 auto;
        padding: 16px 24px;
        background: #28a745;
        color: white;
        border-radius: 12px;
        font-weight: bold;
        z-index: 10001;
        box-shadow: 0 4px 20px rgba(40, 167, 69, 0.4);
        animation: slideInDown 0.3s ease;
        text-align: center;
    `;
    
    notification.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
            <span style="font-size: 24px;">✅</span>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOutUp 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, duration);
}

// CSS للـ animations
const notifStyle = document.createElement('style');
notifStyle.textContent = `
@keyframes slideInDown {
    from {
        transform: translateY(-100px);
        opacity: 0;
    }
    to {
        transform: translateY(0);
        opacity: 1;
    }
}

@keyframes slideOutUp {
    from {
        transform: translateY(0);
        opacity: 1;
    }
    to {
        transform: translateY(-100px);
        opacity: 0;
    }
}
`;
document.head.appendChild(notifStyle);

console.log('✅ Notification helpers جاهزة');

// ===== استعادة المستخدم عند تحميل الصفحة =====
document.addEventListener('DOMContentLoaded', () => {
    console.log('[App] DOMContentLoaded - checking for saved user...');

    // إذا كان المدير الأعلى مسجل دخوله، لا نستعيد جلسة المستخدم العادي
    const savedSA = localStorage.getItem('pos_super_admin');
    if (savedSA) {
        console.log('[App] Super Admin session found, skipping regular user restore');
        return;
    }

    if (restoreUser()) {
        console.log('[App] User found in localStorage, restoring session...');
        initializeUI();
    } else {
        console.log('[App] No saved user, showing login screen');
    }
});

// ===== منع التحديث العرضي =====
// تحذير المستخدم إذا فيه فواتير معلقة أو سلة
window.addEventListener('beforeunload', (e) => {
    // لا نمنع التحديث، فقط نحذر إذا فيه بيانات مهمة
    if (cart.length > 0) {
        e.preventDefault();
        e.returnValue = 'لديك منتجات في السلة. هل تريد المتابعة؟';
        return e.returnValue;
    }
});

console.log('[App] Page refresh protection enabled ✅');

// ========================================
// 📈 DCF Valuation (التدفقات النقدية المخصومة)
// ========================================

let dcfChart = null; // لحفظ مرجع الرسم البياني

function calculateDCF() {
    // قراءة المدخلات
    const initialCF = parseFloat(document.getElementById('dcf_initial_cf').value) || 0;
    const growthRate = parseFloat(document.getElementById('dcf_growth_rate').value) / 100 || 0;
    const discountRate = parseFloat(document.getElementById('dcf_discount_rate').value) / 100 || 0;
    const years = parseInt(document.getElementById('dcf_years').value) || 5;
    const terminalGrowth = parseFloat(document.getElementById('dcf_terminal_growth').value) / 100 || 0;
    
    // التحقق
    if (initialCF <= 0) {
        alert('الرجاء إدخال تدفق نقدي موجب');
        return;
    }
    
    if (discountRate <= terminalGrowth) {
        alert('⚠️ معدل الخصم يجب أن يكون أكبر من معدل النمو الدائم');
        return;
    }
    
    // حساب التدفقات السنوية
    const cashFlows = [];
    let totalPVCashFlows = 0;
    
    for (let year = 1; year <= years; year++) {
        const cf = initialCF * Math.pow(1 + growthRate, year);
        const pv = cf / Math.pow(1 + discountRate, year);
        totalPVCashFlows += pv;
        
        cashFlows.push({
            year: year,
            cashFlow: cf,
            presentValue: pv,
            discountFactor: 1 / Math.pow(1 + discountRate, year)
        });
    }
    
    // حساب القيمة المتبقية (Terminal Value)
    const lastCF = initialCF * Math.pow(1 + growthRate, years);
    const terminalCF = lastCF * (1 + terminalGrowth);
    const terminalValue = terminalCF / (discountRate - terminalGrowth);
    const pvTerminalValue = terminalValue / Math.pow(1 + discountRate, years);
    
    // القيمة الإجمالية
    const totalValue = totalPVCashFlows + pvTerminalValue;
    
    // عرض النتائج
    displayDCFResults(totalValue, totalPVCashFlows, pvTerminalValue, cashFlows, terminalValue);
}

function displayDCFResults(totalValue, pvCashFlows, pvTerminalValue, cashFlows, terminalValue) {
    // إظهار قسم النتائج
    document.getElementById('dcfResults').style.display = 'block';
    
    // الحصول على العملة
    const currency = document.getElementById('storeCurrency')?.value || 'KWD';
    const currencySymbol = getCurrencySymbol(currency);
    
    // القيمة الإجمالية
    document.getElementById('dcfTotalValue').textContent = `${totalValue.toLocaleString('ar', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${currencySymbol}`;
    
    // التدفقات المخصومة
    document.getElementById('dcfPVCashFlows').textContent = `${pvCashFlows.toLocaleString('ar', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${currencySymbol}`;
    
    // القيمة المتبقية
    document.getElementById('dcfTerminalValue').textContent = `${pvTerminalValue.toLocaleString('ar', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${currencySymbol}`;
    
    // جدول التفاصيل
    let tableHTML = `
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr style="background: #667eea; color: white;">
                    <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">السنة</th>
                    <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">التدفق النقدي</th>
                    <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">معامل الخصم</th>
                    <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">القيمة الحالية</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    cashFlows.forEach(cf => {
        tableHTML += `
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 10px; text-align: center;">${cf.year}</td>
                <td style="padding: 10px; text-align: center;">${cf.cashFlow.toLocaleString('ar', {minimumFractionDigits: 2})}</td>
                <td style="padding: 10px; text-align: center;">${cf.discountFactor.toFixed(4)}</td>
                <td style="padding: 10px; text-align: center; font-weight: bold; color: #667eea;">${cf.presentValue.toLocaleString('ar', {minimumFractionDigits: 2})}</td>
            </tr>
        `;
    });
    
    // إضافة القيمة المتبقية
    const years = cashFlows.length;
    tableHTML += `
        <tr style="background: #f7fafc; font-weight: bold;">
            <td style="padding: 10px; text-align: center;">${years}+</td>
            <td style="padding: 10px; text-align: center;">${terminalValue.toLocaleString('ar', {minimumFractionDigits: 2})}</td>
            <td style="padding: 10px; text-align: center;">${(1 / Math.pow(1 + parseFloat(document.getElementById('dcf_discount_rate').value) / 100, years)).toFixed(4)}</td>
            <td style="padding: 10px; text-align: center; font-weight: bold; color: #764ba2;">${pvTerminalValue.toLocaleString('ar', {minimumFractionDigits: 2})}</td>
        </tr>
        <tr style="background: #667eea; color: white; font-weight: bold; font-size: 16px;">
            <td colspan="3" style="padding: 12px; text-align: center;">الإجمالي</td>
            <td style="padding: 12px; text-align: center;">${totalValue.toLocaleString('ar', {minimumFractionDigits: 2})}</td>
        </tr>
    `;
    
    tableHTML += '</tbody></table>';
    document.getElementById('dcfTable').innerHTML = tableHTML;
    
    // الرسم البياني
    drawDCFChart(cashFlows, pvTerminalValue);
}

function drawDCFChart(cashFlows, terminalValue) {
    const ctx = document.getElementById('dcfChart').getContext('2d');
    
    // حذف الرسم القديم
    if (dcfChart) {
        dcfChart.destroy();
    }
    
    const labels = cashFlows.map(cf => `السنة ${cf.year}`);
    labels.push('القيمة المتبقية');
    
    const data = cashFlows.map(cf => cf.presentValue);
    data.push(terminalValue);
    
    dcfChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'القيمة الحالية',
                data: data,
                backgroundColor: cashFlows.map((_, i) => i < cashFlows.length ? 'rgba(102, 126, 234, 0.7)' : 'rgba(118, 75, 162, 0.7)'),
                borderColor: cashFlows.map((_, i) => i < cashFlows.length ? 'rgba(102, 126, 234, 1)' : 'rgba(118, 75, 162, 1)'),
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return 'القيمة: ' + context.parsed.y.toLocaleString('ar', {minimumFractionDigits: 2});
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return value.toLocaleString('ar');
                        }
                    }
                }
            }
        }
    });
}

function getCurrencySymbol(code) {
    const currencies = {
        'KWD': 'د.ك',
        'USD': '$',
        'EUR': '€',
        'GBP': '£',
        'SAR': 'ر.س',
        'AED': 'د.إ',
        'QAR': 'ر.ق',
        'OMR': 'ر.ع',
        'BHD': 'د.ب',
        'EGP': 'ج.م',
        'JOD': 'د.أ',
        'IQD': 'د.ع',
        'LBP': 'ل.ل',
        'TRY': '₺'
    };
    return currencies[code] || code;
}

console.log('[DCF] Module loaded ✅');

// ========================================
// ⏰ عرض الوقت والتاريخ الحالي
// ========================================

function updateDateTime() {
    const now = new Date();
    const dateTimeElement = document.getElementById('datetime');
    if (dateTimeElement) {
        const options = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        };
        const formatted = now.toLocaleDateString('ar-SA', options);
        dateTimeElement.textContent = formatted;
    }
}

// تحديث الوقت كل ثانية
setInterval(updateDateTime, 1000);

// تحديث أولي
updateDateTime();

console.log('[DateTime] Clock started ✅');

// ========================================
// ⏰ تحويل الوقت لتوقيت الكويت (UTC+3)
// ========================================

function formatKuwaitTime(dateString) {
    if (!dateString) return '-';
    
    try {
        // إنشاء التاريخ من النص
        const date = new Date(dateString);
        
        // السيرفر يحفظ بـ UTC، نحتاج نضيف 3 ساعات (الكويت = UTC+3)
        const kuwaitOffset = 3 * 60 * 60 * 1000; // 3 ساعات بالميلي ثانية
        const kuwaitTime = new Date(date.getTime() + kuwaitOffset);
        
        // تنسيق عربي
        const options = {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        };
        
        return kuwaitTime.toLocaleString('ar-SA', options);
    } catch (e) {
        console.error('Error formatting date:', e);
        return new Date(dateString).toLocaleString('ar');
    }
}

console.log('[Timezone] Kuwait time formatter loaded ✅');

// ========================================
// 💰 نظام التكاليف الديناميكي المرن
// ========================================

let costRowCounter = 0;

// إضافة صف تكلفة جديد
function addCostRow(name = '', value = 0) {
    costRowCounter++;
    const container = document.getElementById('costsContainer');
    
    const rowDiv = document.createElement('div');
    rowDiv.className = 'cost-row';
    rowDiv.id = `costRow${costRowCounter}`;
    rowDiv.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr auto; gap: 10px; margin-bottom: 10px; padding: 12px; background: white; border-radius: 8px; border: 1px solid #e2e8f0;';
    
    rowDiv.innerHTML = `
        <div class="form-group" style="margin: 0;">
            <input type="text" 
                   class="cost-name" 
                   placeholder="اسم التكلفة (مثال: الباكج)"
                   value="${name}"
                   style="padding: 10px; border: 2px solid #cbd5e0; border-radius: 6px; width: 100%; font-size: 14px;">
        </div>
        <div class="form-group" style="margin: 0;">
            <input type="number" 
                   class="cost-value" 
                   placeholder="0.000"
                   value="${value}"
                   step="0.001"
                   oninput="calculateTotalCost()"
                   style="padding: 10px; border: 2px solid #cbd5e0; border-radius: 6px; width: 100%; font-size: 14px;">
        </div>
        <button type="button" 
                onclick="removeCostRow('costRow${costRowCounter}')" 
                class="btn-sm btn-danger"
                title="حذف"
                style="padding: 10px 15px; height: 42px;">
            🗑️
        </button>
    `;
    
    container.appendChild(rowDiv);
    calculateTotalCost();
    
    return rowDiv;
}

// حذف صف تكلفة
function removeCostRow(rowId) {
    const row = document.getElementById(rowId);
    if (row) {
        row.remove();
        calculateTotalCost();
    }
}

// حساب إجمالي التكلفة
function calculateTotalCost() {
    const costInputs = document.querySelectorAll('.cost-value');
    let total = 0;
    
    costInputs.forEach(input => {
        const value = parseFloat(input.value) || 0;
        total += value;
    });
    
    // تحديث العرض
    const display = document.getElementById('totalCostDisplay');
    if (display) {
        display.textContent = `${total.toFixed(3)} د.ك`;
    }
    
    // تحديث الحقل المخفي
    const costField = document.getElementById('productCost');
    if (costField) {
        costField.value = total.toFixed(3);
    }
    
    return total;
}

// جمع بيانات التكاليف
function getCostsData() {
    const costRows = document.querySelectorAll('.cost-row');
    const costs = [];
    
    costRows.forEach(row => {
        const nameInput = row.querySelector('.cost-name');
        const valueInput = row.querySelector('.cost-value');
        
        const name = nameInput?.value?.trim() || '';
        const value = parseFloat(valueInput?.value) || 0;
        
        if (name && value > 0) {
            costs.push({ name, value });
        }
    });
    
    return costs;
}

// تحميل بيانات التكاليف
function loadCostsData(costs) {
    // مسح الصفوف القديمة
    const container = document.getElementById('costsContainer');
    if (container) {
        container.innerHTML = '';
        costRowCounter = 0;
    }
    
    // إضافة التكاليف
    if (costs && Array.isArray(costs) && costs.length > 0) {
        costs.forEach(cost => {
            addCostRow(cost.name, cost.value);
        });
    } else {
        // إضافة صف واحد فارغ كبداية
        addCostRow('', 0);
    }
    
    calculateTotalCost();
}

// تهيئة نظام التكاليف
function initializeCostSystem() {
    const container = document.getElementById('costsContainer');
    if (container && container.children.length === 0) {
        // إضافة صف واحد افتراضي
        addCostRow('', 0);
    }
    calculateTotalCost();
}

console.log('[Costs] Dynamic flexible cost system loaded ✅');

// ========================================
// 📋 نظام التكاليف في المخزون (مدمج)
// ========================================

let inventoryCostCounter = 0;

// إضافة صف تكلفة في نموذج المخزون
function addInventoryCostRow(name = '', value = 0) {
    inventoryCostCounter++;
    const container = document.getElementById('inventoryCostsContainer');
    if (!container) return;
    
    const rowDiv = document.createElement('div');
    rowDiv.className = 'inventory-cost-row';
    rowDiv.id = `inventoryCostRow${inventoryCostCounter}`;
    rowDiv.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr auto; gap: 10px; margin-bottom: 10px; padding: 12px; background: white; border-radius: 8px; border: 1px solid #e2e8f0;';
    
    rowDiv.innerHTML = `
        <div class="form-group" style="margin: 0;">
            <input type="text" 
                   class="inventory-cost-name" 
                   placeholder="اسم التكلفة (مثال: الباكج)"
                   value="${name}"
                   style="padding: 10px; border: 2px solid #cbd5e0; border-radius: 6px; width: 100%; font-size: 14px;">
        </div>
        <div class="form-group" style="margin: 0;">
            <input type="number" 
                   class="inventory-cost-value" 
                   placeholder="0.000"
                   value="${value}"
                   step="0.001"
                   oninput="calculateInventoryTotalCost()"
                   style="padding: 10px; border: 2px solid #cbd5e0; border-radius: 6px; width: 100%; font-size: 14px;">
        </div>
        <button type="button" 
                onclick="removeInventoryCostRow('inventoryCostRow${inventoryCostCounter}')" 
                class="btn-sm btn-danger"
                title="حذف"
                style="padding: 10px 15px; height: 42px;">
            🗑️
        </button>
    `;
    
    container.appendChild(rowDiv);
    calculateInventoryTotalCost();
    
    return rowDiv;
}

// حذف صف تكلفة
function removeInventoryCostRow(rowId) {
    const row = document.getElementById(rowId);
    if (row) {
        row.remove();
        calculateInventoryTotalCost();
    }
}

// حساب إجمالي التكلفة
function calculateInventoryTotalCost() {
    const costInputs = document.querySelectorAll('.inventory-cost-value');
    let total = 0;
    
    costInputs.forEach(input => {
        const value = parseFloat(input.value) || 0;
        total += value;
    });
    
    const display = document.getElementById('inventoryTotalCostDisplay');
    if (display) {
        display.textContent = `${total.toFixed(3)} د.ك`;
    }
    
    // تحديث حقل التكلفة المخفي
    const costField = document.getElementById('inventoryCost');
    if (costField) {
        costField.value = total.toFixed(3);
    }
    
    // حساب هامش الربح (تمرير القيمة بدلاً من الاستدعاء)
    const priceInput = document.getElementById('inventoryPrice');
    const price = parseFloat(priceInput?.value) || 0;
    updateInventoryProfitDisplay(price, total);
    
    return total;
}

// تحديث عرض هامش الربح
function updateInventoryProfitDisplay(price, cost) {
    const profit = price - cost;
    const profitPercent = price > 0 ? ((profit / price) * 100).toFixed(1) : 0;
    
    const display = document.getElementById('inventoryProfitDisplay');
    if (display) {
        const color = profit > 0 ? '#38a169' : '#f56565';
        display.style.color = color;
        display.innerHTML = `${profit.toFixed(3)} د.ك (<span style="font-size: 16px;">${profitPercent}%</span>)`;
    }
}

// حساب هامش الربح (عند تغيير السعر)
function calculateInventoryProfit() {
    const costInputs = document.querySelectorAll('.inventory-cost-value');
    let totalCost = 0;
    
    costInputs.forEach(input => {
        const value = parseFloat(input.value) || 0;
        totalCost += value;
    });
    
    const priceInput = document.getElementById('inventoryPrice');
    const price = parseFloat(priceInput?.value) || 0;
    
    updateInventoryProfitDisplay(price, totalCost);
}

// جمع بيانات التكاليف
function getInventoryCostsData() {
    const costRows = document.querySelectorAll('.inventory-cost-row');
    const costs = [];
    
    costRows.forEach(row => {
        const nameInput = row.querySelector('.inventory-cost-name');
        const valueInput = row.querySelector('.inventory-cost-value');
        
        const name = nameInput?.value?.trim() || '';
        const value = parseFloat(valueInput?.value) || 0;
        
        if (name && value > 0) {
            costs.push({ name, value });
        }
    });
    
    return costs;
}

// تحميل بيانات التكاليف
function loadInventoryCosts(costs) {
    const container = document.getElementById('inventoryCostsContainer');
    if (container) {
        container.innerHTML = '';
        inventoryCostCounter = 0;
    }
    
    if (costs && Array.isArray(costs) && costs.length > 0) {
        costs.forEach(cost => {
            addInventoryCostRow(cost.name, cost.value);
        });
    } else {
        addInventoryCostRow('', 0);
    }
    
    calculateInventoryTotalCost();
}

// تهيئة نظام التكاليف في المخزون
function initializeInventoryCosts() {
    const container = document.getElementById('inventoryCostsContainer');
    if (container && container.children.length === 0) {
        addInventoryCostRow('', 0);
    }
    calculateInventoryTotalCost();
}

console.log('[Inventory Costs] System loaded ✅');

// ===============================================
// 🎯 نظام الولاء (Loyalty System)
// ===============================================

let currentCustomerData = null;

// تحميل جميع العملاء
async function loadCustomers() {
    try {
        const response = await fetch(`${API_URL}/api/customers`);
        const data = await response.json();
        
        if (data.success) {
            allCustomers = data.customers;
            displayCustomersTable(allCustomers);
        }
    } catch (error) {
        console.error('Error loading customers:', error);
    }
}

// عرض جدول العملاء
function displayCustomersTable(customers) {
    const container = document.getElementById('customersContainer');
    if (!container) return;
    
    if (!customers || customers.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">لا يوجد عملاء</div>';
        return;
    }
    
    let html = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>الاسم</th>
                    <th>الهاتف</th>
                    <th>💎 النقاط</th>
                    <th>💰 إجمالي المشتريات</th>
                    <th>📅 آخر زيارة</th>
                    <th>إجراءات</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    customers.forEach(c => {
        const lastVisit = c.last_visit ? new Date(c.last_visit).toLocaleDateString('ar-EG') : 'لا يوجد';
        const points = c.loyalty_points || c.points || 0;
        const pointValue = (window.loyaltyConfig && window.loyaltyConfig.pointValue) || 0.1;
        const pointsValueKd = (points * pointValue).toFixed(3);
        html += `
            <tr>
                <td>${c.name}</td>
                <td>${c.phone}</td>
                <td>
                    <span style="font-weight: bold; color: #0ea5e9; font-size: 16px;">${points}</span>
                    <div style="font-size: 10px; color: #64748b;">= ${pointsValueKd} د.ك</div>
                </td>
                <td>${(c.total_spent || 0).toFixed(3)} د.ك</td>
                <td>${lastVisit}</td>
                <td>
                    <button onclick="editCustomer(${c.id})" class="btn-sm">✏️</button>
                    <button onclick="viewCustomerDetails(${c.id})" class="btn-sm" style="background: #0ea5e9;">👁️</button>
                    <button onclick="deleteCustomer(${c.id})" class="btn-sm btn-danger">🗑️</button>
                </td>
            </tr>
        `;
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
}

// البحث عن عملاء
function searchCustomers() {
    const searchTerm = document.getElementById('customerSearch').value.toLowerCase();
    if (!searchTerm) {
        displayCustomersTable(allCustomers);
        return;
    }
    
    const filtered = allCustomers.filter(c => 
        c.name.toLowerCase().includes(searchTerm) ||
        c.phone.includes(searchTerm) ||
        (c.email && c.email.toLowerCase().includes(searchTerm))
    );
    
    displayCustomersTable(filtered);
}

// إظهار نموذج إضافة عميل
function showAddCustomer() {
    document.getElementById('customerModalTitle').textContent = '➕ إضافة عميل';
    document.getElementById('customerForm').reset();
    document.getElementById('customerId').value = '';
    document.getElementById('loyaltyPointsSection').style.display = 'none';
    document.getElementById('addCustomerModal').classList.add('active');
}

// إغلاق نموذج العميل
function closeAddCustomer() {
    document.getElementById('addCustomerModal').classList.remove('active');
}

// حفظ العميل
document.getElementById('customerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const customerId = document.getElementById('customerId').value;
    const customerData = {
        name: document.getElementById('customerNameField').value,
        phone: document.getElementById('customerPhoneField').value,
        email: document.getElementById('customerEmailField').value,
        notes: document.getElementById('customerNotes').value
    };
    
    // دالة مساعدة لحفظ العميل محلياً
    async function _saveCustomerLocally() {
        const offlineCustomer = {
            id: 'offline_' + Date.now(),
            ...customerData,
            loyalty_points: 0,
            created_at: new Date().toISOString(),
            _offline: true
        };
        allCustomersDropdown.push(offlineCustomer);
        try { await localDB.save('pending_customers', offlineCustomer); } catch(e) {}
        alert('✅ تم حفظ العميل محلياً (سيتم مزامنته عند الاتصال)');
        closeAddCustomer();
    }

    try {
        const url = customerId ? `${API_URL}/api/customers/${customerId}` : `${API_URL}/api/customers`;
        const method = customerId ? 'PUT' : 'POST';

        // فحص الاتصال الفعلي (ليس فقط navigator.onLine)
        const reallyOnline = await checkRealConnection();
        if (!reallyOnline) {
            await _saveCustomerLocally();
            return;
        }

        const response = await fetch(url, {
            method: method,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(customerData)
        });

        const data = await response.json();

        if (data.success) {
            alert('✅ تم حفظ العميل بنجاح');
            closeAddCustomer();
            loadCustomers();
            await loadCustomersDropdown();
        } else {
            alert('❌ خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        // حفظ محلي كـ fallback عند فشل الشبكة
        await _saveCustomerLocally();
    }
});

// تعديل عميل
async function editCustomer(id) {
    try {
        const response = await fetch(`${API_URL}/api/customers/${id}`);
        const data = await response.json();
        
        if (data.success) {
            const c = data.customer;
            document.getElementById('customerModalTitle').textContent = '✏️ تعديل عميل';
            document.getElementById('customerId').value = c.id;
            document.getElementById('customerNameField').value = c.name;
            document.getElementById('customerPhoneField').value = c.phone;
            document.getElementById('customerEmailField').value = c.email || '';
            document.getElementById('customerNotes').value = c.notes || '';
            
            // عرض النقاط
            document.getElementById('loyaltyPointsSection').style.display = 'block';
            document.getElementById('customerCurrentPoints').textContent = c.points || 0;
            document.getElementById('customerTotalSpent').textContent = (c.total_spent || 0).toFixed(3);
            
            currentCustomerData = c;
            document.getElementById('addCustomerModal').classList.add('active');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل تحميل بيانات العميل');
    }
}

// عرض تفاصيل عميل
async function viewCustomerDetails(id) {
    try {
        const response = await fetch(`${API_URL}/api/customers/${id}`);
        const data = await response.json();

        if (data.success) {
            const c = data.customer;
            const html = `
                <div style="padding: 20px;">
                    <h3 style="margin-bottom: 20px;">👤 تفاصيل العميل</h3>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 14px;">
                        <div><strong>الاسم:</strong> ${c.name || '-'}</div>
                        <div><strong>الهاتف:</strong> ${c.phone || '-'}</div>
                        <div><strong>البريد:</strong> ${c.email || '-'}</div>
                        <div><strong>العنوان:</strong> ${c.address || '-'}</div>
                        <div><strong>النقاط:</strong> <span style="color: #0ea5e9; font-weight: bold;">${c.points || 0}</span></div>
                        <div><strong>إجمالي المشتريات:</strong> <span style="color: #28a745; font-weight: bold;">${(c.total_spent || 0).toFixed(3)} د.ك</span></div>
                        <div><strong>عدد الطلبات:</strong> ${c.total_orders || 0}</div>
                        <div><strong>تاريخ التسجيل:</strong> ${c.created_at ? new Date(c.created_at).toLocaleDateString('ar') : '-'}</div>
                    </div>
                    ${c.notes ? `<div style="margin-top: 15px; padding: 10px; background: #f8f9fa; border-radius: 8px;"><strong>ملاحظات:</strong> ${c.notes}</div>` : ''}
                </div>
            `;
            document.getElementById('invoiceViewContent').innerHTML = html;
            document.getElementById('invoiceViewModal').classList.add('active');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل تحميل بيانات العميل');
    }
}

// حذف عميل
async function deleteCustomer(id) {
    if (!confirm('هل أنت متأكد من حذف هذا العميل؟')) return;
    
    try {
        const response = await fetch(`${API_URL}/api/customers/${id}`, {method: 'DELETE'});
        const data = await response.json();
        
        if (data.success) {
            alert('✅ تم حذف العميل');
            loadCustomers();
            loadCustomersDropdown();
        } else {
            alert('❌ خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل الحذف');
    }
}

// إظهار نموذج تعديل النقاط
function showAdjustPoints() {
    if (!currentCustomerData) return;
    
    document.getElementById('adjustCurrentPoints').textContent = currentCustomerData.points || 0;
    document.getElementById('pointsAdjustment').value = '';
    document.getElementById('adjustReason').value = '';
    document.getElementById('adjustPointsModal').classList.add('active');
}

// إغلاق نموذج تعديل النقاط
function closeAdjustPoints() {
    document.getElementById('adjustPointsModal').classList.remove('active');
}

// حفظ تعديل النقاط
document.getElementById('adjustPointsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!currentCustomerData) return;
    
    const points = parseInt(document.getElementById('pointsAdjustment').value);
    const reason = document.getElementById('adjustReason').value;
    
    try {
        const response = await fetch(`${API_URL}/api/customers/${currentCustomerData.id}/points/adjust`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({points, reason})
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('✅ تم تعديل النقاط بنجاح');
            closeAdjustPoints();
            
            // تحديث النقاط المعروضة
            const newPoints = (currentCustomerData.points || 0) + points;
            document.getElementById('customerCurrentPoints').textContent = newPoints;
            currentCustomerData.points = newPoints;
            
            loadCustomers();
        } else {
            alert('❌ خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل التعديل');
    }
});

// البحث عن عميل بالهاتف (في الفاتورة)
async function searchCustomerByPhone() {
    const phone = document.getElementById('customerPhone').value.trim();
    if (!phone || phone.length < 8) {
        document.getElementById('loyaltySection').style.display = 'none';
        document.getElementById('selectedCustomerId').value = '';
        currentCustomerData = null;
        return;
    }

    if (!navigator.onLine) {
        // أوفلاين: البحث في القائمة المحملة مسبقاً
        const found = allCustomersDropdown.find(c => c.phone === phone);
        if (found) {
            currentCustomerData = found;
            document.getElementById('customerName').value = found.name;
            document.getElementById('selectedCustomerId').value = found.id;
            document.getElementById('loyaltySection').style.display = 'block';
            document.getElementById('customerLoyaltyPoints').textContent = found.loyalty_points || found.points || 0;
            updatePointsToEarn();
        }
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/customers/search?phone=${encodeURIComponent(phone)}`);
        const data = await response.json();
        
        if (data.success && data.customer) {
            const c = data.customer;
            currentCustomerData = c;
            
            // ملء البيانات
            document.getElementById('customerName').value = c.name;
            document.getElementById('selectedCustomerId').value = c.id;
            
            // عرض قسم الولاء
            document.getElementById('loyaltySection').style.display = 'block';
            document.getElementById('customerLoyaltyPoints').textContent = c.points || 0;
            
            // حساب النقاط التي سيربحها
            updatePointsToEarn();
        } else {
            document.getElementById('loyaltySection').style.display = 'none';
            document.getElementById('selectedCustomerId').value = '';
            currentCustomerData = null;
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// تحديث النقاط التي سيربحها العميل
function updatePointsToEarn() {
    const pointsPerInvoice = (window.loyaltyConfig && window.loyaltyConfig.pointsPerInvoice) || 10;
    document.getElementById('pointsToEarn').textContent = pointsPerInvoice;
}

// حساب خصم الولاء
function calculateLoyaltyDiscount() {
    const pointsToRedeem = parseInt(document.getElementById('pointsToRedeem').value) || 0;
    const availablePoints = currentCustomerData ? (currentCustomerData.loyalty_points || currentCustomerData.points || 0) : 0;

    if (pointsToRedeem > availablePoints) {
        alert('⚠️ النقاط المطلوبة أكبر من النقاط المتاحة');
        document.getElementById('pointsToRedeem').value = availablePoints;
        return;
    }

    const pointValue = (window.loyaltyConfig && window.loyaltyConfig.pointValue) || 0.1;
    const discount = pointsToRedeem * pointValue;

    // عرض الخصم
    if (discount > 0) {
        document.getElementById('loyaltyDiscountRow').style.display = 'flex';
        document.getElementById('loyaltyDiscountAmount').textContent = discount.toFixed(3) + ' د.ك';
    } else {
        document.getElementById('loyaltyDiscountRow').style.display = 'none';
    }

    updateTotals();
}

// استخدام كل النقاط
function applyMaxPoints() {
    if (!currentCustomerData) return;

    const availablePoints = currentCustomerData.loyalty_points || currentCustomerData.points || 0;
    const subtotal = calculateSubtotal();
    const pointValue = (window.loyaltyConfig && window.loyaltyConfig.pointValue) || 0.1;
    // أقصى نقاط = أقل من (نقاطه المتاحة، نقاط تعادل المجموع)
    const maxPointsForTotal = Math.floor(subtotal / pointValue);
    const maxPointsToUse = Math.min(availablePoints, maxPointsForTotal);

    document.getElementById('pointsToRedeem').value = maxPointsToUse;
    calculateLoyaltyDiscount();
}

// تحديث دالة updateTotals لدعم خصم الولاء
const originalUpdateTotals = updateTotals;
updateTotals = function() {
    originalUpdateTotals();
    
    // إضافة خصم الولاء
    const pointsToRedeem = parseInt(document.getElementById('pointsToRedeem').value) || 0;
    const loyaltyDiscount = pointsToRedeem / 100;
    
    if (loyaltyDiscount > 0) {
        const currentTotal = parseFloat(document.getElementById('total').textContent.replace(/[^\d.]/g, ''));
        const newTotal = Math.max(0, currentTotal - loyaltyDiscount);
        document.getElementById('total').textContent = newTotal.toFixed(3) + ' د.ك';
    }
    
    // تحديث النقاط التي سيربحها
    if (currentCustomerData) {
        updatePointsToEarn();
    }
};

// تحديث دالة completeSale لدعم الولاء
const originalCompleteSale = completeSale;
completeSale = async function() {
    // جمع بيانات الولاء
    const customerId = document.getElementById('selectedCustomerId').value;
    const pointsToRedeem = parseInt(document.getElementById('pointsToRedeem').value) || 0;
    const loyaltyDiscount = pointsToRedeem / 100;
    
    // حساب النقاط المكتسبة
    const finalTotal = parseFloat(document.getElementById('total').textContent.replace(/[^\d.]/g, ''));
    const pointsEarned = Math.floor(finalTotal);
    
    // إضافة البيانات للفاتورة
    if (customerId) {
        // تعديل invoiceData في الدالة الأصلية
        window.loyaltyData = {
            customer_id: parseInt(customerId),
            loyalty_points_earned: pointsEarned,
            loyalty_points_redeemed: pointsToRedeem,
            loyalty_discount: loyaltyDiscount
        };
    }
    
    // استدعاء الدالة الأصلية
    await originalCompleteSale();
    
    // مسح بيانات الولاء بعد الحفظ
    document.getElementById('loyaltySection').style.display = 'none';
    document.getElementById('selectedCustomerId').value = '';
    document.getElementById('pointsToRedeem').value = '';
    document.getElementById('loyaltyDiscountRow').style.display = 'none';
    currentCustomerData = null;
};

console.log('[Loyalty System] Loaded ✅');


// ===============================================
// 🔐 إصلاح تسجيل الخروج (Offline Protection)
// ===============================================

// التحقق من الاتصال
console.log('[Logout Protection] Loaded ✅');


// ===============================================
// 🔄 نظام المسترجع (Returns System)
// ===============================================

let allReturns = [];

// تحميل المرتجعات
async function loadReturns(status = '') {
    try {
        let url = `${API_URL}/api/returns`;
        if (status) url += `?status=${status}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            allReturns = data.returns;
            displayReturnsTable(allReturns);
        }
    } catch (error) {
        console.error('Error loading returns:', error);
    }
}

// عرض جدول المرتجعات
function displayReturnsTable(returns) {
    const container = document.getElementById('returnsTableContainer');
    if (!container) return;
    
    if (!returns || returns.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">لا توجد مرتجعات</div>';
        return;
    }
    
    let html = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>رقم المرتجع</th>
                    <th>رقم الفاتورة</th>
                    <th>المنتج</th>
                    <th>الكمية</th>
                    <th>السعر</th>
                    <th>الإجمالي</th>
                    <th>السبب</th>
                    <th>الموظف</th>
                    <th>التاريخ</th>
                    <th>إجراءات</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    returns.forEach(r => {
        const date = r.created_at ? new Date(r.created_at).toLocaleString('ar-EG', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }) : '-';
        
        html += `
            <tr>
                <td><strong>#${r.id}</strong></td>
                <td>${r.invoice_number || '-'}</td>
                <td><strong>${r.product_name}</strong></td>
                <td>${r.quantity}</td>
                <td>${(r.price || 0).toFixed(3)} د.ك</td>
                <td><strong style="color: #dc3545;">${(r.total || 0).toFixed(3)} د.ك</strong></td>
                <td style="max-width: 200px; white-space: normal;">${r.reason || '-'}</td>
                <td>${r.employee_name || '-'}</td>
                <td style="font-size: 12px;">${date}</td>
                <td>
                    <button onclick="viewReturnDetails(${r.id})" class="btn-sm" style="background: #0ea5e9;" title="عرض التفاصيل">👁️</button>
                    <button onclick="printReturn(${r.id})" class="btn-sm" style="background: #667eea;" title="طباعة">🖨️</button>
                    <button onclick="printThermalReturn(${r.id})" class="btn-sm" style="background: #e67e22; font-size:10px;" title="طباعة 57×40">🧾</button>
                    <button onclick="deleteReturnConfirm(${r.id})" class="btn-sm btn-danger" title="حذف">🗑️</button>
                </td>
            </tr>
        `;
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
}

// فلترة المرتجعات (تبسيط)
function filterReturns(status) {
    // حالياً كل المرتجعات بنفس الحالة
    displayReturnsTable(allReturns);
}

// إضافة مرتجع
function showAddReturn() {
    const modal = document.getElementById('returnModal');
    if (!modal) {
        // إنشاء Modal إذا لم يكن موجود
        createReturnModal();
    }
    
    // مسح الحقول
    document.getElementById('returnInvoiceNumber').value = '';
    document.getElementById('returnProductName').value = '';
    document.getElementById('returnQuantity').value = '1';
    document.getElementById('returnPrice').value = '';
    document.getElementById('returnEmployeeName').value = currentUser?.name || '';
    document.getElementById('returnReason').value = '';
    
    // فتح Modal
    document.getElementById('returnModal').classList.add('active');
}

// إنشاء Modal المرتجعات
function createReturnModal() {
    const modalHTML = `
        <div id="returnModal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>🔄 إضافة مرتجع</h2>
                    <button class="close-btn" onclick="closeReturnModal()">✖️</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>رقم الفاتورة:</label>
                        <input type="text" id="returnInvoiceNumber" placeholder="اختياري">
                    </div>
                    <div class="form-group">
                        <label>المنتج:</label>
                        <input type="text" id="returnProductName" placeholder="اسم المنتج" required>
                    </div>
                    <div class="form-group">
                        <label>الكمية:</label>
                        <input type="number" id="returnQuantity" min="1" value="1" required>
                    </div>
                    <div class="form-group">
                        <label>السعر:</label>
                        <input type="number" id="returnPrice" step="0.001" placeholder="0.000" required>
                    </div>
                    <div class="form-group">
                        <label>الموظف:</label>
                        <input type="text" id="returnEmployeeName" placeholder="اسم الموظف" value="${currentUser?.name || ''}" required>
                    </div>
                    <div class="form-group">
                        <label>سبب الإرجاع:</label>
                        <textarea id="returnReason" placeholder="سبب الإرجاع..."></textarea>
                    </div>
                    <button class="btn" style="width: 100%; margin-top: 15px;" onclick="submitReturn()">
                        💾 حفظ المرتجع
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

// إغلاق Modal المرتجعات
function closeReturnModal() {
    document.getElementById('returnModal').classList.remove('active');
}

// حفظ المرتجع
async function submitReturn() {
    try {
        const invoiceNumber = document.getElementById('returnInvoiceNumber').value;
        const productName = document.getElementById('returnProductName').value.trim();
        const quantity = parseInt(document.getElementById('returnQuantity').value);
        const price = parseFloat(document.getElementById('returnPrice').value);
        const employeeName = document.getElementById('returnEmployeeName').value.trim();
        const reason = document.getElementById('returnReason').value.trim();
        
        if (!productName) {
            alert('⚠️ يرجى إدخال اسم المنتج');
            return;
        }
        
        if (!price || price <= 0) {
            alert('⚠️ يرجى إدخال سعر صحيح');
            return;
        }
        
        if (!employeeName) {
            alert('⚠️ يرجى إدخال اسم الموظف');
            return;
        }
        
        const total = quantity * price;
        
        const returnData = {
            invoice_number: invoiceNumber || null,
            product_name: productName,
            quantity: quantity,
            price: price,
            total: total,
            reason: reason,
            employee_name: employeeName
        };
        
        const response = await fetch(`${API_URL}/api/returns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(returnData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('✅ ' + data.message);
            closeReturnModal();
            loadReturns();
        } else {
            alert('❌ خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ حدث خطأ في حفظ المرتجع');
    }
}

// عرض تفاصيل مرتجع
// عرض تفاصيل المرتجع
async function viewReturnDetails(id) {
    try {
        const response = await fetch(`${API_URL}/api/returns/${id}`);
        const data = await response.json();
        
        if (data.success) {
            const r = data.return;
            const date = new Date(r.created_at).toLocaleString('ar-EG');
            
            const details = `
━━━━━━━━━━━━━━━━━━━━━━━
🔄 تفاصيل المرتجع #${r.id}
━━━━━━━━━━━━━━━━━━━━━━━

📋 رقم الفاتورة: ${r.invoice_number || '-'}
📦 المنتج: ${r.product_name}
🔢 الكمية: ${r.quantity}
💰 السعر: ${(r.price || 0).toFixed(3)} د.ك
💵 الإجمالي: ${(r.total || 0).toFixed(3)} د.ك

📝 السبب: ${r.reason || '-'}
👤 الموظف: ${r.employee_name || '-'}
📅 التاريخ: ${date}

━━━━━━━━━━━━━━━━━━━━━━━
            `.trim();
            
            alert(details);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل جلب التفاصيل');
    }
}

// طباعة المرتجع
async function printReturn(id) {
    try {
        const response = await fetch(`${API_URL}/api/returns/${id}`);
        const data = await response.json();
        
        if (data.success) {
            const r = data.return;
            const date = new Date(r.created_at).toLocaleString('ar-EG');
            
            const printContent = `
                <html dir="rtl">
                <head>
                    <title>مرتجع #${r.id}</title>
                    <style>
                        body { font-family: Arial; padding: 20px; }
                        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #000; padding-bottom: 20px; }
                        .header h1 { margin: 0; color: #dc3545; }
                        .info { margin: 20px 0; }
                        .info-row { display: flex; justify-content: space-between; margin: 10px 0; padding: 8px; background: #f5f5f5; }
                        .label { font-weight: bold; }
                        .product-box { border: 2px solid #000; padding: 15px; margin: 20px 0; }
                        .total { font-size: 24px; font-weight: bold; text-align: center; margin: 20px 0; color: #dc3545; }
                        .footer { margin-top: 40px; border-top: 2px solid #000; padding-top: 20px; text-align: center; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>🔄 إيصال مرتجع</h1>
                        <p>رقم المرتجع: <strong>#${r.id}</strong></p>
                        <p>${date}</p>
                    </div>
                    
                    <div class="info">
                        <div class="info-row">
                            <span class="label">رقم الفاتورة:</span>
                            <span>${r.invoice_number || '-'}</span>
                        </div>
                        <div class="info-row">
                            <span class="label">الموظف:</span>
                            <span>${r.employee_name || '-'}</span>
                        </div>
                    </div>
                    
                    <div class="product-box">
                        <h3>تفاصيل المرتجع:</h3>
                        <div class="info-row">
                            <span class="label">المنتج:</span>
                            <span>${r.product_name}</span>
                        </div>
                        <div class="info-row">
                            <span class="label">الكمية:</span>
                            <span>${r.quantity}</span>
                        </div>
                        <div class="info-row">
                            <span class="label">السعر:</span>
                            <span>${(r.price || 0).toFixed(3)} د.ك</span>
                        </div>
                        ${r.reason ? `
                        <div class="info-row">
                            <span class="label">سبب الإرجاع:</span>
                            <span>${r.reason}</span>
                        </div>
                        ` : ''}
                    </div>
                    
                    <div class="total">
                        المبلغ المسترجع: ${(r.total || 0).toFixed(3)} د.ك
                    </div>
                    
                    <div class="footer">
                        <p>تم إعادة المنتج للمخزون</p>
                        <p>شكراً لتعاملكم معنا</p>
                    </div>
                </body>
                </html>
            `;
            
            const printWindow = window.open('', '_blank');
            printWindow.document.write(printContent);
            printWindow.document.close();
            printWindow.print();
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل الطباعة');
    }
}

// طباعة مرتجع حراري 57×40 ملم
async function printThermalReturn(id) {
    try {
        const response = await fetch(`${API_URL}/api/returns/${id}`);
        const data = await response.json();
        if (data.success) {
            const r = data.return;
            const date = new Date(r.created_at).toLocaleString('ar-EG');
            const storeName = document.getElementById('storeName')?.value || 'متجر';
            const printContent = `<!DOCTYPE html>
<html dir="rtl">
<head>
<meta charset="UTF-8">
<title>مرتجع #${r.id}</title>
<style>
@page { size: 57mm 40mm; margin: 1mm; }
@media print {
    .toolbar { display: none !important; }
    .preview-wrapper { box-shadow: none !important; border: none !important; margin: 0 !important; }
    body { background: white !important; padding: 0 !important; }
    .receipt { width: 55mm; font-size: 7px; padding: 1mm; }
    .receipt .r-header { font-size: 9px; }
    .receipt .r-sub { font-size: 7px; }
    .receipt .r-total { font-size: 9px; }
    .receipt .r-small { font-size: 6px; }
    .receipt .r-mid { font-size: 7px; }
}
@media screen {
    body { background: #f0f0f0; font-family: Arial, sans-serif; direction: rtl; margin: 0; padding: 20px; }
    .toolbar { background: #333; color: white; padding: 15px 25px; display: flex; justify-content: space-between; align-items: center; position: fixed; top: 0; left: 0; right: 0; z-index: 100; }
    .toolbar h3 { margin: 0; font-size: 16px; }
    .toolbar-btns { display: flex; gap: 10px; }
    .toolbar button { padding: 10px 25px; border: none; border-radius: 8px; font-size: 15px; cursor: pointer; font-weight: bold; }
    .btn-print { background: #28a745; color: white; }
    .btn-print:hover { background: #218838; }
    .btn-close { background: #dc3545; color: white; }
    .btn-close:hover { background: #c82333; }
    .preview-wrapper { max-width: 280px; margin: 80px auto 20px; background: white; border: 2px solid #ccc; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); padding: 15px; }
    .receipt { width: 100%; font-size: 14px; line-height: 1.5; }
    .receipt .r-header { font-size: 18px; font-weight: bold; }
    .receipt .r-sub { font-size: 14px; }
    .receipt .r-total { font-size: 17px; font-weight: bold; }
    .receipt .r-small { font-size: 12px; }
    .receipt .r-mid { font-size: 13px; }
}
.receipt .center { text-align: center; }
.receipt .bold { font-weight: bold; }
.receipt .sep { border-top: 1px dashed #000; margin: 6px 0; }
.receipt .row { display: flex; justify-content: space-between; }
</style>
</head>
<body>
<div class="toolbar">
    <h3>معاينة إيصال المرتجع (57×40 ملم)</h3>
    <div class="toolbar-btns">
        <button class="btn-print" onclick="window.print()">🖨️ طباعة</button>
        <button class="btn-close" onclick="window.close()">✖ إغلاق</button>
    </div>
</div>
<div class="preview-wrapper">
<div class="receipt">
<div class="center r-header">${storeName}</div>
<div class="center r-sub" style="color:#dc3545;">إيصال مرتجع</div>
<div class="sep"></div>
<div class="row r-mid"><span>رقم: #${r.id}</span><span>${date}</span></div>
${r.invoice_number ? `<div class="r-small">الفاتورة: ${r.invoice_number}</div>` : ''}
${r.employee_name ? `<div class="r-small">الموظف: ${r.employee_name}</div>` : ''}
<div class="sep"></div>
<div class="bold">${r.product_name}</div>
<div class="row r-mid"><span>الكمية: ${r.quantity}</span><span>السعر: ${(r.price || 0).toFixed(3)}</span></div>
${r.reason ? `<div class="r-small">السبب: ${r.reason}</div>` : ''}
<div class="sep"></div>
<div class="row r-total"><span>المسترجع:</span><span>${(r.total || 0).toFixed(3)} د.ك</span></div>
<div class="sep"></div>
<div class="center r-small">شكراً لتعاملكم معنا</div>
</div>
</div>
</body>
</html>`;
            const printWindow = window.open('', '_blank', 'width=820,height=600');
            printWindow.document.write(printContent);
            printWindow.document.close();
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل الطباعة');
    }
}

// حذف المرتجع مع تأكيد
async function deleteReturnConfirm(id) {
    if (!confirm('⚠️ هل أنت متأكد من حذف هذا المرتجع؟\n\n⚠️ تحذير: سيتم خصم الكمية من المخزون!')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/returns/${id}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('✅ تم حذف المرتجع');
            loadReturns();
        } else {
            alert('❌ خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل الحذف');
    }
}

console.log('[Returns System] Loaded ✅');


// ===============================================
// 📦 حالات الطلب (Order Status)
// ===============================================

async function updateOrderStatus(invoiceId, newStatus) {
    try {
        const response = await fetch(`${API_URL}/api/invoices/${invoiceId}/status`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ order_status: newStatus })
        });

        const data = await response.json();
        if (data.success) {
            // تحديث لون القائمة المنسدلة بدون إعادة تحميل
            if (event && event.target) {
                event.target.className = 'order-status-select ' +
                    (newStatus === 'قيد التنفيذ' ? 'status-processing' :
                     newStatus === 'قيد التوصيل' ? 'status-delivering' : 'status-completed');
            }
        } else {
            alert('❌ خطأ: ' + data.error);
            loadInvoicesTable();
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل التحديث');
        loadInvoicesTable();
    }
}

function filterInvoicesByStatus() {
    const status = document.getElementById('orderStatusFilter').value;
    if (!allInvoices) return;

    if (!status) {
        loadInvoicesTable();
        return;
    }

    const filtered = status === 'ملغية'
        ? allInvoices.filter(inv => inv.cancelled)
        : allInvoices.filter(inv => !inv.cancelled && (inv.order_status || 'قيد التنفيذ') === status);
    const container = document.getElementById('invoicesListContainer');

    if (filtered.length === 0) {
        container.innerHTML = '<p style="text-align:center; padding:40px;">لا توجد فواتير بهذه الحالة</p>';
        return;
    }

    container.innerHTML = `
        <table class="data-table">
            <thead><tr><th>رقم الفاتورة</th><th>العميل</th><th>الموظف</th><th>الإجمالي</th><th>حالة الطلب</th><th>التاريخ</th><th>عرض</th></tr></thead>
            <tbody>
                ${filtered.map(inv => {
                    const isOffline = inv.id && inv.id.toString().startsWith('offline_');
                    const isCancelled = inv.cancelled;
                    const st = inv.order_status || 'قيد التنفيذ';
                    return `
                    <tr style="${isCancelled ? 'opacity:0.5; background:#fff5f5;' : ''}">
                        <td>
                            <strong${isCancelled ? ' style="text-decoration:line-through;"' : ''}>${inv.invoice_number}</strong>
                            ${isCancelled ? ' <span style="background:#dc3545; color:white; padding:2px 6px; border-radius:4px; font-size:10px;">🚫 ملغية</span>' : ''}
                            ${isOffline ? ' <span style="background:#dc3545; color:white; padding:2px 6px; border-radius:4px; font-size:10px;">📴 معلقة</span>' : ''}
                        </td>
                        <td>${inv.customer_name || 'عميل'}</td>
                        <td>${inv.employee_name}</td>
                        <td style="color:${isCancelled ? '#dc3545' : '#28a745'}; font-weight:bold;${isCancelled ? ' text-decoration:line-through;' : ''}">${inv.total.toFixed(3)} د.ك</td>
                        <td>
                            ${isCancelled ? '<span style="color:#dc3545; font-weight:bold; font-size:12px;">🚫 ملغية</span>' : `
                            <select class="order-status-select status-${st === 'قيد التنفيذ' ? 'processing' : st === 'قيد التوصيل' ? 'delivering' : 'completed'}"
                                    onchange="updateOrderStatus(${inv.id}, this.value)" ${isOffline ? 'disabled' : ''}>
                                <option value="قيد التنفيذ" ${st === 'قيد التنفيذ' ? 'selected' : ''}>⏳ قيد التنفيذ</option>
                                <option value="قيد التوصيل" ${st === 'قيد التوصيل' ? 'selected' : ''}>🚚 قيد التوصيل</option>
                                <option value="منجز" ${st === 'منجز' ? 'selected' : ''}>✅ منجز</option>
                            </select>`}
                        </td>
                        <td>${formatKuwaitTime(inv.created_at)}</td>
                        <td><button onclick="viewLocalInvoice('${inv.id}')" class="btn-sm">👁️</button></td>
                    </tr>
                `;
                }).join('')}
            </tbody>
        </table>
    `;
}

console.log('[Order Status] Loaded ✅');

// ===============================================
// 🏭 نظام الموردين (Suppliers)
// ===============================================

let allSuppliers = [];
let currentSupplierId = null;

async function loadSuppliers() {
    if (!navigator.onLine) {
        const container = document.getElementById('suppliersContainer');
        if (container) container.innerHTML = '<div style="text-align:center; padding:40px; color:#92400e;"><div style="font-size:48px; margin-bottom:10px;">📴</div><p>غير متصل - لا يمكن تحميل الموردين</p></div>';
        return;
    }
    try {
        const response = await fetch(`${API_URL}/api/suppliers`);
        const data = await response.json();
        if (data.success) {
            allSuppliers = data.suppliers;
            displaySuppliersTable(allSuppliers);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

function displaySuppliersTable(suppliers) {
    const container = document.getElementById('suppliersContainer');
    if (!container) return;

    if (!suppliers || suppliers.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">لا يوجد موردين</div>';
        return;
    }

    const totalSuppliers = suppliers.length;
    const totalAmount = suppliers.reduce((sum, s) => sum + (s.total_amount || 0), 0);
    const totalInvoices = suppliers.reduce((sum, s) => sum + (s.invoice_count || 0), 0);

    container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 15px; margin-bottom: 25px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 12px;">
                <div style="opacity: 0.9; font-size: 13px;">إجمالي الموردين</div>
                <div style="font-size: 28px; font-weight: bold;">${totalSuppliers}</div>
            </div>
            <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 20px; border-radius: 12px;">
                <div style="opacity: 0.9; font-size: 13px;">إجمالي الفواتير</div>
                <div style="font-size: 28px; font-weight: bold;">${totalInvoices}</div>
            </div>
            <div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white; padding: 20px; border-radius: 12px;">
                <div style="opacity: 0.9; font-size: 13px;">إجمالي المبالغ</div>
                <div style="font-size: 28px; font-weight: bold;">${totalAmount.toFixed(3)} د.ك</div>
            </div>
        </div>
        <table class="data-table">
            <thead>
                <tr>
                    <th>المورد</th>
                    <th>الشركة</th>
                    <th>الهاتف</th>
                    <th>عدد الفواتير</th>
                    <th>إجمالي المبالغ</th>
                    <th>إجراءات</th>
                </tr>
            </thead>
            <tbody>
                ${suppliers.map(s => `
                    <tr>
                        <td><strong>${s.name}</strong></td>
                        <td>${s.company || '-'}</td>
                        <td>${s.phone || '-'}</td>
                        <td><span style="background: #667eea; color: white; padding: 3px 10px; border-radius: 12px; font-weight: bold;">${s.invoice_count || 0}</span></td>
                        <td style="color: #e53e3e; font-weight: bold;">${(s.total_amount || 0).toFixed(3)} د.ك</td>
                        <td>
                            <button onclick="viewSupplierInvoices(${s.id}, '${(s.name || '').replace(/'/g, "\\'")}')" class="btn-sm" style="background: #667eea;">📄</button>
                            <button onclick="editSupplier(${s.id})" class="btn-sm">✏️</button>
                            <button onclick="deleteSupplier(${s.id})" class="btn-sm btn-danger">🗑️</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function showAddSupplier() {
    document.getElementById('supplierModalTitle').textContent = '➕ إضافة مورد';
    document.getElementById('supplierForm').reset();
    document.getElementById('supplierId').value = '';
    document.getElementById('addSupplierModal').classList.add('active');
}

function closeAddSupplier() {
    document.getElementById('addSupplierModal').classList.remove('active');
}

async function editSupplier(id) {
    const s = allSuppliers.find(s => s.id === id);
    if (!s) return;
    document.getElementById('supplierModalTitle').textContent = '✏️ تعديل مورد';
    document.getElementById('supplierId').value = s.id;
    document.getElementById('supplierName').value = s.name || '';
    document.getElementById('supplierCompany').value = s.company || '';
    document.getElementById('supplierPhone').value = s.phone || '';
    document.getElementById('supplierEmail').value = s.email || '';
    document.getElementById('supplierAddress').value = s.address || '';
    document.getElementById('supplierNotes').value = s.notes || '';
    document.getElementById('addSupplierModal').classList.add('active');
}

document.getElementById('supplierForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const supplierId = document.getElementById('supplierId').value;
    const supplierData = {
        name: document.getElementById('supplierName').value,
        company: document.getElementById('supplierCompany').value,
        phone: document.getElementById('supplierPhone').value,
        email: document.getElementById('supplierEmail').value,
        address: document.getElementById('supplierAddress').value,
        notes: document.getElementById('supplierNotes').value
    };
    try {
        const url = supplierId ? `${API_URL}/api/suppliers/${supplierId}` : `${API_URL}/api/suppliers`;
        const method = supplierId ? 'PUT' : 'POST';
        const response = await fetch(url, { method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(supplierData) });
        const data = await response.json();
        if (data.success) {
            alert('✅ تم الحفظ');
            closeAddSupplier();
            loadSuppliers();
        } else {
            alert('❌ خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل الحفظ');
    }
});

async function deleteSupplier(id) {
    if (!confirm('هل أنت متأكد من حذف هذا المورد وجميع فواتيره؟')) return;
    try {
        const response = await fetch(`${API_URL}/api/suppliers/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            alert('✅ تم الحذف');
            loadSuppliers();
        } else {
            alert('❌ خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// ===== فواتير الموردين =====

async function viewSupplierInvoices(supplierId, supplierName) {
    currentSupplierId = supplierId;
    document.getElementById('supplierInvoicesTitle').textContent = `📄 فواتير: ${supplierName}`;
    document.getElementById('supplierInvoiceSupplierId').value = supplierId;

    try {
        const response = await fetch(`${API_URL}/api/suppliers/${supplierId}/invoices`);
        const data = await response.json();
        const container = document.getElementById('supplierInvoicesList');

        if (data.success && data.invoices.length > 0) {
            container.innerHTML = `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>رقم الفاتورة</th>
                            <th>المبلغ</th>
                            <th>التاريخ</th>
                            <th>الملف</th>
                            <th>ملاحظات</th>
                            <th>إجراءات</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.invoices.map(inv => `
                            <tr>
                                <td><strong>${inv.invoice_number || '-'}</strong></td>
                                <td style="color: #e53e3e; font-weight: bold;">${(inv.amount || 0).toFixed(3)} د.ك</td>
                                <td>${inv.invoice_date || new Date(inv.created_at).toLocaleDateString('ar')}</td>
                                <td>
                                    ${inv.file_name ? `<button onclick="viewSupplierFile(${inv.id})" class="btn-sm" style="background: #0ea5e9;">👁️ ${inv.file_type === 'application/pdf' ? 'PDF' : 'صورة'}</button>` : '<span style="color:#999;">لا يوجد</span>'}
                                </td>
                                <td>${inv.notes || '-'}</td>
                                <td><button onclick="deleteSupplierInvoice(${inv.id})" class="btn-sm btn-danger">🗑️</button></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } else {
            container.innerHTML = '<div style="text-align: center; padding: 30px; color: #666;">لا توجد فواتير لهذا المورد</div>';
        }
    } catch (error) {
        console.error('Error:', error);
    }

    document.getElementById('supplierInvoicesModal').classList.add('active');
}

function closeSupplierInvoices() {
    document.getElementById('supplierInvoicesModal').classList.remove('active');
}

function showAddSupplierInvoice() {
    document.getElementById('supplierInvoiceForm').reset();
    document.getElementById('supplierInvoiceSupplierId').value = currentSupplierId;
    document.getElementById('supplierFileInfo').textContent = '';
    document.getElementById('addSupplierInvoiceModal').classList.add('active');
}

function closeAddSupplierInvoice() {
    document.getElementById('addSupplierInvoiceModal').classList.remove('active');
}

function validateSupplierFile(input) {
    const file = input.files[0];
    const info = document.getElementById('supplierFileInfo');
    if (!file) { info.textContent = ''; return; }

    const maxSize = 1 * 1024 * 1024; // 1 MB
    if (file.size > maxSize) {
        info.innerHTML = '<span style="color: #dc3545;">❌ حجم الملف يتجاوز 1 MB! الحد الأقصى 1 ميجابايت</span>';
        input.value = '';
        return;
    }

    const sizeMB = (file.size / 1024 / 1024).toFixed(2);
    info.innerHTML = `<span style="color: #28a745;">✅ ${file.name} (${sizeMB} MB)</span>`;
}

document.getElementById('supplierInvoiceForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const fileInput = document.getElementById('supplierInvoiceFile');
    const file = fileInput.files[0];

    // التحقق من الحجم
    if (file && file.size > 1 * 1024 * 1024) {
        alert('❌ حجم الملف يتجاوز 1 ميجابايت');
        return;
    }

    let fileData = '';
    let fileName = '';
    let fileType = '';

    if (file) {
        fileData = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(file);
        });
        fileName = file.name;
        fileType = file.type;
    }

    const invoiceData = {
        supplier_id: document.getElementById('supplierInvoiceSupplierId').value,
        invoice_number: document.getElementById('supplierInvoiceNumber').value,
        amount: parseFloat(document.getElementById('supplierInvoiceAmount').value) || 0,
        invoice_date: document.getElementById('supplierInvoiceDate').value,
        notes: document.getElementById('supplierInvoiceNotes').value,
        file_data: fileData,
        file_name: fileName,
        file_type: fileType
    };

    try {
        const response = await fetch(`${API_URL}/api/suppliers/invoices`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(invoiceData)
        });
        const data = await response.json();
        if (data.success) {
            alert('✅ تم حفظ الفاتورة');
            closeAddSupplierInvoice();
            viewSupplierInvoices(currentSupplierId, document.getElementById('supplierInvoicesTitle').textContent.replace('📄 فواتير: ', ''));
            loadSuppliers();
        } else {
            alert('❌ خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل الحفظ');
    }
});

async function viewSupplierFile(invoiceId) {
    try {
        const response = await fetch(`${API_URL}/api/suppliers/invoices/${invoiceId}/file`);
        const data = await response.json();
        if (data.success && data.file_data) {
            const viewer = document.getElementById('supplierFileViewer');
            if (data.file_type === 'application/pdf') {
                viewer.innerHTML = `<iframe src="${data.file_data}" style="width:100%; height:600px; border:none; border-radius:8px;"></iframe>`;
            } else {
                viewer.innerHTML = `<img src="${data.file_data}" style="max-width:100%; max-height:600px; border-radius:8px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">`;
            }
            document.getElementById('viewSupplierFileModal').classList.add('active');
        } else {
            alert('❌ الملف غير موجود');
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function deleteSupplierInvoice(invoiceId) {
    if (!confirm('هل أنت متأكد من حذف هذه الفاتورة؟')) return;
    try {
        const response = await fetch(`${API_URL}/api/suppliers/invoices/${invoiceId}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            alert('✅ تم الحذف');
            viewSupplierInvoices(currentSupplierId, document.getElementById('supplierInvoicesTitle').textContent.replace('📄 فواتير: ', ''));
            loadSuppliers();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

console.log('[Suppliers System] Loaded ✅');

// ===============================================
// 🎟️ نظام الكوبونات (Coupons)
// ===============================================

let allCoupons = [];
let appliedCouponDiscount = 0;
let appliedCouponId = null;

async function loadCoupons() {
    if (!navigator.onLine) {
        const container = document.getElementById('couponsContainer');
        if (container) container.innerHTML = '<div style="text-align:center; padding:40px; color:#92400e;"><div style="font-size:48px; margin-bottom:10px;">📴</div><p>غير متصل - لا يمكن تحميل الكوبونات</p></div>';
        return;
    }
    try {
        const response = await fetch(`${API_URL}/api/coupons`);
        const data = await response.json();

        if (data.success) {
            allCoupons = data.coupons;
            displayCouponsStats(allCoupons);
            displayCouponsTable(allCoupons);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

function displayCouponsStats(coupons) {
    const container = document.getElementById('couponsStatsContainer');
    if (!container) return;
    const active = coupons.filter(c => c.is_active);
    const expired = coupons.filter(c => c.expiry_date && new Date(c.expiry_date) < new Date());
    const totalUsed = coupons.reduce((s, c) => s + (c.used_count || 0), 0);
    container.innerHTML = `
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
            <div style="font-size: 28px; font-weight: bold;">${coupons.length}</div>
            <div style="font-size: 13px; opacity: 0.9;">إجمالي الكوبونات</div>
        </div>
        <div style="background: linear-gradient(135deg, #38a169 0%, #2f855a 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
            <div style="font-size: 28px; font-weight: bold;">${active.length}</div>
            <div style="font-size: 13px; opacity: 0.9;">كوبونات فعالة</div>
        </div>
        <div style="background: linear-gradient(135deg, #eab308 0%, #ca8a04 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
            <div style="font-size: 28px; font-weight: bold;">${totalUsed}</div>
            <div style="font-size: 13px; opacity: 0.9;">مرات الاستخدام</div>
        </div>
        <div style="background: linear-gradient(135deg, #e53e3e 0%, #c53030 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
            <div style="font-size: 28px; font-weight: bold;">${expired.length}</div>
            <div style="font-size: 13px; opacity: 0.9;">منتهية الصلاحية</div>
        </div>
    `;
}

function displayCouponsTable(coupons) {
    const container = document.getElementById('couponsContainer');
    if (!container) return;

    if (coupons.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:40px; color:#6c757d;"><div style="font-size:48px; margin-bottom:10px;">🎟️</div><p>لا توجد كوبونات بعد</p></div>';
        return;
    }

    let html = '<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; background:white; border-radius:12px; overflow:hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">';
    html += `<thead><tr style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
        <th style="padding:12px; text-align:right;">الكود</th>
        <th style="padding:12px; text-align:center;">نوع الخصم</th>
        <th style="padding:12px; text-align:center;">القيمة</th>
        <th style="padding:12px; text-align:center;">الحد الأدنى</th>
        <th style="padding:12px; text-align:center;">الاستخدام</th>
        <th style="padding:12px; text-align:center;">الانتهاء</th>
        <th style="padding:12px; text-align:center;">الحالة</th>
        <th style="padding:12px; text-align:center;">إجراءات</th>
    </tr></thead><tbody>`;

    coupons.forEach(c => {
        const isExpired = c.expiry_date && new Date(c.expiry_date) < new Date();
        const isMaxed = c.max_uses > 0 && c.used_count >= c.max_uses;
        let statusBadge = '';
        if (!c.is_active) {
            statusBadge = '<span style="background:#dc3545; color:white; padding:4px 10px; border-radius:20px; font-size:12px;">معطل</span>';
        } else if (isExpired) {
            statusBadge = '<span style="background:#6c757d; color:white; padding:4px 10px; border-radius:20px; font-size:12px;">منتهي</span>';
        } else if (isMaxed) {
            statusBadge = '<span style="background:#fd7e14; color:white; padding:4px 10px; border-radius:20px; font-size:12px;">مستنفد</span>';
        } else {
            statusBadge = '<span style="background:#38a169; color:white; padding:4px 10px; border-radius:20px; font-size:12px;">فعال</span>';
        }

        html += `<tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:12px; font-weight:bold; color:#667eea; font-family:monospace; font-size:16px;">${c.code}</td>
            <td style="padding:12px; text-align:center;">${c.discount_type === 'percent' ? '📊 نسبة' : '💵 مبلغ'}</td>
            <td style="padding:12px; text-align:center; font-weight:bold;">${c.discount_type === 'percent' ? c.discount_value + '%' : c.discount_value.toFixed(3) + ' د.ك'}</td>
            <td style="padding:12px; text-align:center;">${c.min_amount > 0 ? c.min_amount.toFixed(3) + ' د.ك' : '-'}</td>
            <td style="padding:12px; text-align:center;">${c.used_count}${c.max_uses > 0 ? ' / ' + c.max_uses : ' / ∞'}</td>
            <td style="padding:12px; text-align:center;">${c.expiry_date || 'بدون حد'}</td>
            <td style="padding:12px; text-align:center;">${statusBadge}</td>
            <td style="padding:12px; text-align:center;">
                <button onclick="editCoupon(${c.id})" class="btn-sm" style="margin:2px;">✏️</button>
                <button onclick="toggleCoupon(${c.id}, ${c.is_active ? 0 : 1})" class="btn-sm" style="margin:2px; background:${c.is_active ? '#dc3545' : '#38a169'}; color:white;">${c.is_active ? '⏸️' : '▶️'}</button>
                <button onclick="deleteCoupon(${c.id})" class="btn-sm btn-danger" style="margin:2px;">🗑️</button>
            </td>
        </tr>`;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

function showAddCoupon() {
    document.getElementById('couponModalTitle').textContent = '➕ إضافة كوبون';
    document.getElementById('couponId').value = '';
    document.getElementById('couponCode').value = '';
    document.getElementById('couponDiscountType').value = 'percent';
    document.getElementById('couponDiscountValue').value = '';
    document.getElementById('couponMinAmount').value = '0';
    document.getElementById('couponMaxUses').value = '0';
    document.getElementById('couponExpiryDate').value = '';
    document.getElementById('addCouponModal').classList.add('active');
}

function closeAddCoupon() {
    document.getElementById('addCouponModal').classList.remove('active');
}

async function editCoupon(id) {
    const coupon = allCoupons.find(c => c.id === id);
    if (!coupon) return;
    document.getElementById('couponModalTitle').textContent = '✏️ تعديل كوبون';
    document.getElementById('couponId').value = coupon.id;
    document.getElementById('couponCode').value = coupon.code;
    document.getElementById('couponDiscountType').value = coupon.discount_type;
    document.getElementById('couponDiscountValue').value = coupon.discount_value;
    document.getElementById('couponMinAmount').value = coupon.min_amount || 0;
    document.getElementById('couponMaxUses').value = coupon.max_uses || 0;
    document.getElementById('couponExpiryDate').value = coupon.expiry_date || '';
    document.getElementById('addCouponModal').classList.add('active');
}

document.getElementById('couponForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    const id = document.getElementById('couponId').value;
    const couponData = {
        code: document.getElementById('couponCode').value.toUpperCase(),
        discount_type: document.getElementById('couponDiscountType').value,
        discount_value: parseFloat(document.getElementById('couponDiscountValue').value) || 0,
        min_amount: parseFloat(document.getElementById('couponMinAmount').value) || 0,
        max_uses: parseInt(document.getElementById('couponMaxUses').value) || 0,
        expiry_date: document.getElementById('couponExpiryDate').value || null
    };

    try {
        const url = id ? `${API_URL}/api/coupons/${id}` : `${API_URL}/api/coupons`;
        const method = id ? 'PUT' : 'POST';
        const response = await fetch(url, {
            method: method,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(couponData)
        });
        const data = await response.json();
        if (data.success) {
            alert(id ? '✅ تم تعديل الكوبون' : '✅ تم إنشاء الكوبون');
            closeAddCoupon();
            loadCoupons();
        } else {
            alert('❌ ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل الحفظ');
    }
});

async function toggleCoupon(id, newState) {
    try {
        const response = await fetch(`${API_URL}/api/coupons/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ is_active: newState })
        });
        const data = await response.json();
        if (data.success) {
            loadCoupons();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function deleteCoupon(id) {
    if (!confirm('هل أنت متأكد من حذف هذا الكوبون؟')) return;
    try {
        const response = await fetch(`${API_URL}/api/coupons/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            alert('✅ تم الحذف');
            loadCoupons();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// تطبيق الكوبون في نقطة البيع
async function applyCouponCode() {
    const codeInput = document.getElementById('couponCodeInput');
    const resultDiv = document.getElementById('couponResult');
    const code = codeInput?.value?.trim().toUpperCase();

    if (!code) {
        resultDiv.style.display = 'block';
        resultDiv.style.background = '#fee2e2';
        resultDiv.style.color = '#991b1b';
        resultDiv.innerHTML = '⚠️ الرجاء إدخال كود الكوبون';
        return;
    }

    if (!navigator.onLine) {
        resultDiv.style.display = 'block';
        resultDiv.style.background = '#fef3c7';
        resultDiv.style.color = '#92400e';
        resultDiv.innerHTML = '📴 لا يمكن التحقق من الكوبون بدون إنترنت';
        return;
    }

    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    try {
        const response = await fetch(`${API_URL}/api/coupons/validate`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ code: code, subtotal: subtotal })
        });
        const data = await response.json();

        if (data.success) {
            appliedCouponDiscount = data.discount;
            appliedCouponId = data.coupon.id;

            resultDiv.style.display = 'block';
            resultDiv.style.background = '#dcfce7';
            resultDiv.style.color = '#166534';
            resultDiv.innerHTML = `✅ تم تطبيق الكوبون! الخصم: ${data.discount.toFixed(3)} د.ك`;

            document.getElementById('couponDiscountDisplay').textContent = data.discount.toFixed(3) + ' د.ك';
            document.getElementById('couponDiscountRow').style.display = 'flex';
            updateTotals();
        } else {
            appliedCouponDiscount = 0;
            appliedCouponId = null;
            document.getElementById('couponDiscountRow').style.display = 'none';

            resultDiv.style.display = 'block';
            resultDiv.style.background = '#fee2e2';
            resultDiv.style.color = '#991b1b';
            resultDiv.innerHTML = '❌ ' + data.error;
            updateTotals();
        }
    } catch (error) {
        console.error('Error:', error);
        resultDiv.style.display = 'block';
        resultDiv.style.background = '#fee2e2';
        resultDiv.style.color = '#991b1b';
        resultDiv.innerHTML = '❌ فشل التحقق من الكوبون';
    }
}

console.log('[Coupons System] Loaded ✅');

// ===============================================
// ➕ العمليات الإضافية (Additional Operations)
// ===============================================

let operationTemplates = [];
let additionalOperations = [];

async function loadOperationTemplates() {
    try {
        const response = await fetch(`${API_URL}/api/operation-templates`);
        const data = await response.json();
        
        if (data.success) {
            operationTemplates = data.templates;
            displayOperationTemplates();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

function displayOperationTemplates() {
    // TODO: عرض قوالب العمليات
    console.log('Templates:', operationTemplates);
}

function addAdditionalOperation(name, amount, taxable = false) {
    additionalOperations.push({
        id: Date.now(),
        name: name,
        amount: amount,
        taxable: taxable
    });
    
    displayAdditionalOperations();
    updateTotals();
}

function removeAdditionalOperation(id) {
    additionalOperations = additionalOperations.filter(op => op.id !== id);
    displayAdditionalOperations();
    updateTotals();
}

function displayAdditionalOperations() {
    const container = document.getElementById('additionalOperationsContainer');
    if (!container) return;
    
    if (additionalOperations.length === 0) {
        container.innerHTML = '<div style="color: #999; font-size: 12px;">لا توجد عمليات إضافية</div>';
        return;
    }
    
    let html = '';
    additionalOperations.forEach(op => {
        html += `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 5px; background: #f8f9fa; border-radius: 4px; margin-bottom: 5px;">
                <span style="font-size: 12px;">${op.name}</span>
                <div>
                    <span style="font-weight: bold; margin-right: 10px;">${op.amount.toFixed(3)} د.ك</span>
                    <button onclick="removeAdditionalOperation(${op.id})" style="background: #ef4444; color: white; border: none; padding: 2px 6px; border-radius: 3px; cursor: pointer;">✖</button>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function calculateAdditionalOperationsTotal() {
    return additionalOperations.reduce((sum, op) => sum + op.amount, 0);
}

console.log('[Additional Operations] Loaded ✅');

// مزامنة العملاء المحفوظين محلياً عند العودة أونلاين
async function syncOfflineCustomers() {
    try {
        const pending = await localDB.getAll('pending_customers');
        if (!pending || pending.length === 0) return;
        console.log(`[Sync] Uploading ${pending.length} offline customers...`);
        for (const customer of pending) {
            try {
                const { id, _offline, ...data } = customer;
                const response = await fetch(`${API_URL}/api/customers`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(data)
                });
                const result = await response.json();
                if (result.success) {
                    await localDB.delete('pending_customers', customer.id);
                    console.log(`[Sync] Customer synced: ${data.name}`);
                }
            } catch (e) {
                console.error('[Sync] Failed to sync customer:', e);
            }
        }
        // إعادة تحميل قائمة العملاء بعد المزامنة
        await loadCustomersDropdown();
        if (typeof loadCustomers === 'function') loadCustomers();
    } catch (e) {
        console.error('[Sync] Customer sync error:', e);
    }
}

// تحميل العملاء في dropdown عند بدء التشغيل
setTimeout(() => {
    if (document.getElementById('customerSearchInput')) {
        loadCustomersDropdown();
        // مزامنة العملاء المعلقين إذا أونلاين
        if (navigator.onLine) setTimeout(syncOfflineCustomers, 2000);
        console.log('[Customers Search] Loaded ✅');
    }
}, 1000);

// ===== نظام طاولات المطعم =====

let allTables = [];
let editingTableId = null;
let dragState = null;

// تحميل الطاولات في dropdown نقطة البيع
async function loadTablesDropdown() {
    const select = document.getElementById('selectedTableId');
    const section = document.getElementById('tableSelectionSection');
    if (!select || !section) return;

    try {
        if (!navigator.onLine) {
            // في وضع أوفلاين: إخفاء اختيار الطاولة
            section.style.display = 'none';
            return;
        }
        const response = await fetch(`${API_URL}/api/tables`);
        const data = await response.json();
        if (data.success && data.tables && data.tables.length > 0) {
            allTables = data.tables;
            select.innerHTML = '<option value="">-- بدون طاولة --</option>';
            data.tables.forEach(t => {
                const statusText = t.status === 'occupied' ? ' (مشغولة)' : '';
                select.innerHTML += `<option value="${t.id}" ${t.status === 'occupied' ? 'disabled' : ''}>${t.name}${statusText}</option>`;
            });
            section.style.display = 'block';
        } else {
            section.style.display = 'none';
        }
    } catch (e) {
        console.log('[Tables] Could not load tables dropdown:', e);
        section.style.display = 'none';
    }
}

// تحميل الطاولات لتبويب الطاولات
async function loadTables() {
    if (!navigator.onLine) {
        alert('لا يوجد اتصال بالإنترنت', 'warning');
        return;
    }
    try {
        const response = await fetch(`${API_URL}/api/tables`);
        const data = await response.json();
        if (data.success) {
            allTables = data.tables || [];
            displayTablesStats();
            displayTablesFloorPlan();
        }
    } catch (e) {
        console.error('[Tables] Failed to load:', e);
        alert('فشل تحميل الطاولات', 'error');
    }
}

// عرض إحصائيات الطاولات
function displayTablesStats() {
    const container = document.getElementById('tablesStatsContainer');
    if (!container) return;

    const total = allTables.length;
    const available = allTables.filter(t => t.status === 'available').length;
    const occupied = allTables.filter(t => t.status === 'occupied').length;
    const totalSeats = allTables.reduce((sum, t) => sum + (t.seats || 0), 0);

    container.innerHTML = `
        <div style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 16px; border-radius: 12px; text-align: center;">
            <div style="font-size: 28px; font-weight: bold;">${total}</div>
            <div style="font-size: 13px; opacity: 0.9;">إجمالي الطاولات</div>
        </div>
        <div style="background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 16px; border-radius: 12px; text-align: center;">
            <div style="font-size: 28px; font-weight: bold;">${available}</div>
            <div style="font-size: 13px; opacity: 0.9;">متاحة</div>
        </div>
        <div style="background: linear-gradient(135deg, #ef4444, #dc2626); color: white; padding: 16px; border-radius: 12px; text-align: center;">
            <div style="font-size: 28px; font-weight: bold;">${occupied}</div>
            <div style="font-size: 13px; opacity: 0.9;">مشغولة</div>
        </div>
        <div style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 16px; border-radius: 12px; text-align: center;">
            <div style="font-size: 28px; font-weight: bold;">${totalSeats}</div>
            <div style="font-size: 13px; opacity: 0.9;">إجمالي المقاعد</div>
        </div>
    `;
}

// عرض مخطط الطاولات مع السحب والإفلات
function displayTablesFloorPlan() {
    const container = document.getElementById('tablesFloorPlan');
    if (!container) return;

    if (allTables.length === 0) {
        container.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 300px; color: #94a3b8; font-size: 18px;">لا توجد طاولات - اضغط ➕ إضافة طاولة للبدء</div>';
        return;
    }

    container.innerHTML = '';

    allTables.forEach(table => {
        const isOccupied = table.status === 'occupied';
        const tableEl = document.createElement('div');
        tableEl.className = 'table-card';
        tableEl.dataset.id = table.id;
        tableEl.style.cssText = `
            position: absolute;
            left: ${table.pos_x || 50}px;
            top: ${table.pos_y || 50}px;
            width: 130px;
            min-height: 120px;
            background: ${isOccupied ? 'linear-gradient(135deg, #fecaca, #fca5a5)' : 'linear-gradient(135deg, #d1fae5, #a7f3d0)'};
            border: 3px solid ${isOccupied ? '#ef4444' : '#10b981'};
            border-radius: 16px;
            padding: 12px;
            cursor: grab;
            user-select: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            z-index: 10;
            transition: box-shadow 0.2s;
        `;

        tableEl.innerHTML = `
            <div style="font-size: 24px; margin-bottom: 6px;">${isOccupied ? '🔴' : '🟢'}</div>
            <div style="font-weight: bold; font-size: 14px; color: #1e293b;">${table.name}</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">🪑 ${table.seats} مقاعد</div>
            <div style="font-size: 11px; color: ${isOccupied ? '#dc2626' : '#059669'}; margin-top: 4px; font-weight: bold;">
                ${isOccupied ? '🍽️ مشغولة' : '✅ متاحة'}
            </div>
            ${isOccupied && table.invoice_number ? `
                <div style="background: rgba(255,255,255,0.8); border: 1px solid #e5e7eb; border-radius: 8px; padding: 5px 8px; margin-top: 6px; font-size: 10px; width: 100%;">
                    <div style="color: #3b82f6; font-weight: bold;">📄 ${table.invoice_number}</div>
                    ${table.invoice_customer ? `<div style="color: #64748b;">👤 ${table.invoice_customer}</div>` : ''}
                    ${table.invoice_total ? `<div style="color: #059669; font-weight: bold;">${parseFloat(table.invoice_total).toFixed(3)} د.ك</div>` : ''}
                </div>
            ` : ''}
            <div style="display: flex; gap: 4px; margin-top: 8px;">
                ${isOccupied ?
                    `<button onclick="event.stopPropagation(); viewTableInvoice(${table.id})" style="background: #3b82f6; color: white; border: none; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 11px;">📄 الفاتورة</button>
                     <button onclick="event.stopPropagation(); releaseTableAction(${table.id})" style="background: #10b981; color: white; border: none; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 11px;">🔓 تحرير</button>`
                    :
                    `<button onclick="event.stopPropagation(); showAssignInvoice(${table.id})" style="background: #8b5cf6; color: white; border: none; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 11px;">📎 ربط</button>`
                }
                <button onclick="event.stopPropagation(); editTable(${table.id})" style="background: #f59e0b; color: white; border: none; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 11px;">✏️</button>
                <button onclick="event.stopPropagation(); deleteTable(${table.id})" style="background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 11px;">🗑️</button>
            </div>
        `;

        // سحب وإفلات - Mouse Events
        tableEl.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            e.preventDefault();
            const rect = container.getBoundingClientRect();
            dragState = {
                tableId: table.id,
                el: tableEl,
                offsetX: e.clientX - tableEl.offsetLeft,
                offsetY: e.clientY - tableEl.offsetTop,
                containerRect: rect
            };
            tableEl.style.cursor = 'grabbing';
            tableEl.style.zIndex = '100';
            tableEl.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
        });

        // سحب وإفلات - Touch Events
        tableEl.addEventListener('touchstart', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            const touch = e.touches[0];
            const rect = container.getBoundingClientRect();
            dragState = {
                tableId: table.id,
                el: tableEl,
                offsetX: touch.clientX - tableEl.offsetLeft,
                offsetY: touch.clientY - tableEl.offsetTop,
                containerRect: rect
            };
            tableEl.style.cursor = 'grabbing';
            tableEl.style.zIndex = '100';
            tableEl.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
        }, { passive: true });

        container.appendChild(tableEl);
    });
}

// أحداث السحب على مستوى المستند
document.addEventListener('mousemove', (e) => {
    if (!dragState) return;
    e.preventDefault();
    const newX = e.clientX - dragState.offsetX;
    const newY = e.clientY - dragState.offsetY;
    // ضمان البقاء داخل الحاوية
    const maxX = dragState.containerRect.width - 140;
    const maxY = dragState.containerRect.height - 130;
    dragState.el.style.left = Math.max(0, Math.min(newX, maxX)) + 'px';
    dragState.el.style.top = Math.max(0, Math.min(newY, maxY)) + 'px';
});

document.addEventListener('mouseup', async () => {
    if (!dragState) return;
    const tableId = dragState.tableId;
    const newX = parseInt(dragState.el.style.left);
    const newY = parseInt(dragState.el.style.top);
    dragState.el.style.cursor = 'grab';
    dragState.el.style.zIndex = '10';
    dragState.el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
    dragState = null;

    // حفظ الموضع الجديد
    try {
        await fetch(`${API_URL}/api/tables/${tableId}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ pos_x: newX, pos_y: newY })
        });
        // تحديث البيانات المحلية
        const t = allTables.find(tb => tb.id === tableId);
        if (t) { t.pos_x = newX; t.pos_y = newY; }
    } catch (e) {
        console.log('[Tables] Failed to save position:', e);
    }
});

document.addEventListener('touchmove', (e) => {
    if (!dragState) return;
    const touch = e.touches[0];
    const newX = touch.clientX - dragState.offsetX;
    const newY = touch.clientY - dragState.offsetY;
    const maxX = dragState.containerRect.width - 140;
    const maxY = dragState.containerRect.height - 130;
    dragState.el.style.left = Math.max(0, Math.min(newX, maxX)) + 'px';
    dragState.el.style.top = Math.max(0, Math.min(newY, maxY)) + 'px';
}, { passive: true });

document.addEventListener('touchend', async () => {
    if (!dragState) return;
    const tableId = dragState.tableId;
    const newX = parseInt(dragState.el.style.left);
    const newY = parseInt(dragState.el.style.top);
    dragState.el.style.cursor = 'grab';
    dragState.el.style.zIndex = '10';
    dragState.el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
    dragState = null;

    try {
        await fetch(`${API_URL}/api/tables/${tableId}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ pos_x: newX, pos_y: newY })
        });
        const t = allTables.find(tb => tb.id === tableId);
        if (t) { t.pos_x = newX; t.pos_y = newY; }
    } catch (e) {
        console.log('[Tables] Failed to save position:', e);
    }
});

// إضافة طاولة
function showAddTable() {
    editingTableId = null;
    document.getElementById('tableId').value = '';
    document.getElementById('tableName').value = '';
    document.getElementById('tableSeats').value = '4';
    document.getElementById('tableModalTitle').textContent = '➕ إضافة طاولة';
    document.getElementById('addTableModal').classList.add('active');
}

function closeAddTable() {
    document.getElementById('addTableModal').classList.remove('active');
}

// تعديل طاولة
function editTable(id) {
    const table = allTables.find(t => t.id === id);
    if (!table) return;
    editingTableId = id;
    document.getElementById('tableId').value = id;
    document.getElementById('tableName').value = table.name;
    document.getElementById('tableSeats').value = table.seats || 4;
    document.getElementById('tableModalTitle').textContent = '✏️ تعديل طاولة';
    document.getElementById('addTableModal').classList.add('active');
}

// معالج نموذج الطاولة
document.getElementById('tableForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();

    const name = document.getElementById('tableName').value.trim();
    const seats = parseInt(document.getElementById('tableSeats').value) || 4;

    if (!name) {
        alert('يرجى إدخال اسم الطاولة', 'error');
        return;
    }

    try {
        if (editingTableId) {
            // تحديث طاولة
            const response = await fetch(`${API_URL}/api/tables/${editingTableId}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ name, seats })
            });
            const data = await response.json();
            if (data.success) {
                alert('تم تحديث الطاولة بنجاح', 'success');
            } else {
                alert('فشل تحديث الطاولة', 'error');
                return;
            }
        } else {
            // إضافة طاولة جديدة
            const response = await fetch(`${API_URL}/api/tables`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ name, seats })
            });
            const data = await response.json();
            if (data.success) {
                alert('تمت إضافة الطاولة بنجاح', 'success');
            } else {
                alert('فشل إضافة الطاولة', 'error');
                return;
            }
        }

        closeAddTable();
        loadTables();
        loadTablesDropdown();
    } catch (e) {
        console.error('[Tables] Save error:', e);
        alert('خطأ في حفظ الطاولة', 'error');
    }
});

// حذف طاولة
async function deleteTable(id) {
    if (!confirm('هل أنت متأكد من حذف هذه الطاولة؟')) return;

    try {
        const response = await fetch(`${API_URL}/api/tables/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            alert('تم حذف الطاولة', 'success');
            loadTables();
            loadTablesDropdown();
        } else {
            alert('فشل حذف الطاولة', 'error');
        }
    } catch (e) {
        console.error('[Tables] Delete error:', e);
        alert('خطأ في حذف الطاولة', 'error');
    }
}

// عرض فاتورة الطاولة
async function viewTableInvoice(tableId) {
    const table = allTables.find(t => t.id === tableId);
    if (!table || !table.current_invoice_id) {
        alert('لا توجد فاتورة مرتبطة بهذه الطاولة', 'warning');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/invoices/${table.current_invoice_id}`);
        const data = await response.json();
        if (data.success && data.invoice) {
            const inv = data.invoice;
            const content = document.getElementById('tableInvoiceContent');
            const paymentMethods = {'cash':'💵 نقداً','knet':'💳 كي نت','visa':'💳 فيزا','other':'💰 أخرى'};

            // تحليل عمليات الدفع المتعددة
            if (!inv.payments && inv.transaction_number) {
                try {
                    const parsed = JSON.parse(inv.transaction_number);
                    if (Array.isArray(parsed)) inv.payments = parsed;
                } catch(e) {}
            }

            content.innerHTML = `
                <div style="padding: 15px;">
                    <div style="background: #f0fdf4; padding: 12px; border-radius: 8px; margin-bottom: 15px; border: 1px solid #86efac;">
                        <strong>🍽️ ${table.name}</strong> | <strong>📄 فاتورة: ${inv.invoice_number}</strong>
                    </div>
                    <div style="font-size: 13px; margin-bottom: 10px;">
                        <div><strong>العميل:</strong> ${inv.customer_name || '-'}</div>
                        <div><strong>التاريخ:</strong> ${new Date(inv.created_at).toLocaleDateString('ar')}</div>
                        <div><strong>الدفع:</strong> ${inv.payments && inv.payments.length > 0 ? inv.payments.map(p => `${paymentMethods[p.method] || p.method} (${parseFloat(p.amount).toFixed(3)})`).join(' + ') : paymentMethods[inv.payment_method]}</div>
                    </div>
                    <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                        <thead><tr style="background: #667eea; color: white;">
                            <th style="padding: 6px; text-align: right;">المنتج</th>
                            <th style="padding: 6px; text-align: center;">الكمية</th>
                            <th style="padding: 6px; text-align: right;">السعر</th>
                            <th style="padding: 6px; text-align: right;">الإجمالي</th>
                        </tr></thead>
                        <tbody>
                            ${(inv.items || []).map(item => `
                                <tr style="border-bottom: 1px solid #e5e7eb;">
                                    <td style="padding: 5px;">${item.product_name}</td>
                                    <td style="padding: 5px; text-align: center;">${item.quantity}</td>
                                    <td style="padding: 5px;">${parseFloat(item.price).toFixed(3)}</td>
                                    <td style="padding: 5px;">${parseFloat(item.total).toFixed(3)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <div style="margin-top: 12px; padding-top: 10px; border-top: 2px solid #667eea; font-size: 16px; font-weight: bold; color: #667eea; display: flex; justify-content: space-between;">
                        <span>الإجمالي:</span>
                        <span>${parseFloat(inv.total).toFixed(3)} د.ك</span>
                    </div>
                    <div style="display: flex; gap: 8px; margin-top: 15px;">
                        <button onclick="releaseTableAction(${tableId}); document.getElementById('tableInvoiceModal').classList.remove('active');" style="flex: 1; background: #10b981; color: white; border: none; padding: 10px; border-radius: 8px; cursor: pointer; font-size: 14px;">🔓 تحرير الطاولة</button>
                    </div>
                </div>
            `;

            document.getElementById('tableInvoiceTitle').textContent = `🍽️ فاتورة ${table.name}`;
            document.getElementById('tableInvoiceModal').classList.add('active');
        } else {
            alert('فشل تحميل الفاتورة', 'error');
        }
    } catch (e) {
        console.error('[Tables] View invoice error:', e);
        alert('خطأ في تحميل فاتورة الطاولة', 'error');
    }
}

// تحرير طاولة (إزالة الفاتورة)
async function releaseTableAction(tableId) {
    if (!confirm('هل تريد تحرير هذه الطاولة؟')) return;

    try {
        const response = await fetch(`${API_URL}/api/tables/${tableId}/release`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            alert('تم تحرير الطاولة', 'success');
            loadTables();
            loadTablesDropdown();
        } else {
            alert('فشل تحرير الطاولة', 'error');
        }
    } catch (e) {
        console.error('[Tables] Release error:', e);
        alert('خطأ في تحرير الطاولة', 'error');
    }
}

// ربط فاتورة بطاولة من تبويب الطاولات
async function showAssignInvoice(tableId) {
    const table = allTables.find(t => t.id === tableId);
    if (!table) return;

    // عرض نافذة لإدخال رقم الفاتورة
    const invoiceNum = prompt('أدخل رقم الفاتورة لربطها بـ ' + table.name + ':');
    if (!invoiceNum || !invoiceNum.trim()) return;

    try {
        // البحث عن الفاتورة بالرقم
        const response = await fetch(`${API_URL}/api/invoices`);
        const data = await response.json();
        if (data.success && data.invoices) {
            const invoice = data.invoices.find(inv => inv.invoice_number === invoiceNum.trim());
            if (invoice) {
                const assignResponse = await fetch(`${API_URL}/api/tables/${tableId}/assign`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ invoice_id: invoice.id })
                });
                const assignData = await assignResponse.json();
                if (assignData.success) {
                    alert(`تم ربط الفاتورة ${invoiceNum} بـ ${table.name}`, 'success');
                    loadTables();
                    loadTablesDropdown();
                } else {
                    alert('فشل ربط الفاتورة', 'error');
                }
            } else {
                alert('لم يتم العثور على الفاتورة', 'error');
            }
        }
    } catch (e) {
        console.error('[Tables] Assign error:', e);
        alert('خطأ في ربط الفاتورة', 'error');
    }
}

console.log('[Tables] Restaurant Tables System Loaded ✅');

// ===== نظام المدير الأعلى (Super Admin) =====


function logoutSuperAdmin() {
    currentSuperAdmin = null;
    localStorage.removeItem('pos_super_admin');
    document.getElementById('superAdminDashboard').style.display = 'none';
    document.getElementById('loginOverlay').classList.remove('hidden');
}

function showSuperAdminSettings() {
    if (!currentSuperAdmin) return;
    document.getElementById('saSettingsFullName').value = currentSuperAdmin.full_name || '';
    document.getElementById('saSettingsUsername').value = currentSuperAdmin.username || '';
    document.getElementById('saSettingsOldPassword').value = '';
    document.getElementById('saSettingsNewPassword').value = '';
    document.getElementById('saSettingsConfirmPassword').value = '';
    document.getElementById('superAdminSettingsModal').classList.add('active');
}

document.getElementById('superAdminSettingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullName = document.getElementById('saSettingsFullName').value.trim();
    const newUsername = document.getElementById('saSettingsUsername').value.trim();
    const oldPassword = document.getElementById('saSettingsOldPassword').value;
    const newPassword = document.getElementById('saSettingsNewPassword').value;
    const confirmPassword = document.getElementById('saSettingsConfirmPassword').value;

    if (!oldPassword) {
        alert('يرجى إدخال كلمة المرور الحالية للتأكيد');
        return;
    }
    if (!newUsername) {
        alert('يرجى إدخال اسم المستخدم');
        return;
    }
    if (newPassword && newPassword !== confirmPassword) {
        alert('كلمة المرور الجديدة وتأكيدها غير متطابقتين');
        return;
    }

    try {
        const response = await originalFetch(`${API_URL}/api/super-admin/change-password`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                admin_id: currentSuperAdmin.id,
                old_password: oldPassword,
                new_password: newPassword || '',
                new_username: newUsername,
                new_full_name: fullName
            })
        });
        const data = await response.json();
        if (data.success) {
            currentSuperAdmin = data.admin;
            localStorage.setItem('pos_super_admin', JSON.stringify(data.admin));
            document.getElementById('saUserInfo').textContent = data.admin.full_name;
            document.getElementById('superAdminSettingsModal').classList.remove('active');
            alert('تم حفظ التغييرات بنجاح');
        } else {
            alert(data.error || 'فشل حفظ التغييرات');
        }
    } catch (e) {
        console.error('[SuperAdmin] Settings error:', e);
        alert('خطأ في حفظ الإعدادات');
    }
});

async function loadSuperAdminDashboard() {
    try {
        const response = await originalFetch(`${API_URL}/api/super-admin/tenants`);
        const data = await response.json();
        if (!data.success) return;

        const tenants = data.tenants || [];

        // إحصائيات عامة
        const totalTenants = tenants.length;
        const activeTenants = tenants.filter(t => t.is_active).length;
        const totalUsers = tenants.reduce((sum, t) => sum + (t.users_count || 0), 0);
        const totalInvoices = tenants.reduce((sum, t) => sum + (t.invoices_count || 0), 0);

        document.getElementById('saStatsContainer').innerHTML = `
            <div style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 20px; border-radius: 12px; text-align: center;">
                <div style="font-size: 32px; font-weight: bold;">${totalTenants}</div>
                <div style="font-size: 13px; opacity: 0.9;">إجمالي المتاجر</div>
            </div>
            <div style="background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 20px; border-radius: 12px; text-align: center;">
                <div style="font-size: 32px; font-weight: bold;">${activeTenants}</div>
                <div style="font-size: 13px; opacity: 0.9;">متاجر نشطة</div>
            </div>
            <div style="background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; padding: 20px; border-radius: 12px; text-align: center;">
                <div style="font-size: 32px; font-weight: bold;">${totalUsers}</div>
                <div style="font-size: 13px; opacity: 0.9;">إجمالي المستخدمين</div>
            </div>
            <div style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 20px; border-radius: 12px; text-align: center;">
                <div style="font-size: 32px; font-weight: bold;">${totalInvoices}</div>
                <div style="font-size: 13px; opacity: 0.9;">إجمالي الفواتير</div>
            </div>
        `;

        // جدول المستأجرين
        const thStyle = 'padding: 12px; text-align: right; border-bottom: 2px solid #e2e8f0; white-space: nowrap;';
        let tableHTML = `
            <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <thead>
                    <tr style="background: #f1f5f9;">
                        <th style="${thStyle}">#</th>
                        <th style="${thStyle}">المتجر</th>
                        <th style="${thStyle}">المعرف</th>
                        <th style="${thStyle}">المالك</th>
                        <th style="${thStyle}">الخطة</th>
                        <th style="${thStyle} text-align: center;">الحالة</th>
                        <th style="${thStyle} text-align: center;">الاشتراك</th>
                        <th style="${thStyle} text-align: center;">المستخدمين</th>
                        <th style="${thStyle} text-align: center;">الإجراءات</th>
                    </tr>
                </thead>
                <tbody>
        `;

        if (tenants.length === 0) {
            tableHTML += '<tr><td colspan="9" style="padding: 30px; text-align: center; color: #94a3b8;">لا توجد متاجر - اضغط "إضافة متجر جديد" للبدء</td></tr>';
        } else {
            tenants.forEach((t, i) => {
                const planNames = {'basic': 'أساسية', 'premium': 'متقدمة', 'enterprise': 'مؤسسات'};
                // حالة الاشتراك
                let subStatus = '';
                if (t.expires_at) {
                    const expiry = new Date(t.expires_at);
                    const today = new Date();
                    today.setHours(0,0,0,0);
                    const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
                    if (daysLeft < 0) {
                        subStatus = `<span style="color: #ef4444; font-weight: bold;">⛔ منتهي</span><br><span style="font-size: 10px; color: #94a3b8;">${t.expires_at.substring(0,10)}</span>`;
                    } else if (daysLeft <= 7) {
                        subStatus = `<span style="color: #f59e0b; font-weight: bold;">⚠️ ${daysLeft} يوم</span><br><span style="font-size: 10px; color: #94a3b8;">${t.expires_at.substring(0,10)}</span>`;
                    } else {
                        subStatus = `<span style="color: #10b981; font-weight: bold;">✅ ${daysLeft} يوم</span><br><span style="font-size: 10px; color: #94a3b8;">${t.expires_at.substring(0,10)}</span>`;
                    }
                } else {
                    subStatus = '<span style="color: #94a3b8;">غير محدد</span>';
                }

                tableHTML += `
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                        <td style="padding: 10px;">${i + 1}</td>
                        <td style="padding: 10px; font-weight: bold;">${t.name}</td>
                        <td style="padding: 10px; direction: ltr; color: #64748b;">${t.slug}</td>
                        <td style="padding: 10px;">${t.owner_name}</td>
                        <td style="padding: 10px;"><span style="background: ${t.plan === 'enterprise' ? '#fef3c7' : t.plan === 'premium' ? '#dbeafe' : '#f1f5f9'}; padding: 3px 8px; border-radius: 6px; font-size: 11px;">${planNames[t.plan] || t.plan}</span></td>
                        <td style="padding: 10px; text-align: center;">${t.is_active ? '<span style="color: #10b981; font-weight: bold;">✅ نشط</span>' : '<span style="color: #ef4444;">❌ معطل</span>'}</td>
                        <td style="padding: 10px; text-align: center; font-size: 12px;">${subStatus}</td>
                        <td style="padding: 10px; text-align: center;">${t.users_count || 0}</td>
                        <td style="padding: 10px; text-align: center;">
                            <div style="display: flex; gap: 4px; justify-content: center; flex-wrap: wrap;">
                                <button onclick="openSubscriptionModal(${t.id})" style="background: #8b5cf6; color: white; border: none; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 11px;" title="الاشتراك">💳</button>
                                <button onclick="viewTenantStats(${t.id})" style="background: #3b82f6; color: white; border: none; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 11px;" title="إحصائيات">📊</button>
                                <button onclick="editTenant(${t.id})" style="background: #f59e0b; color: white; border: none; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 11px;" title="تعديل">✏️</button>
                                <button onclick="toggleTenant(${t.id}, ${t.is_active ? 0 : 1})" style="background: ${t.is_active ? '#ef4444' : '#10b981'}; color: white; border: none; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 11px;" title="${t.is_active ? 'تعطيل' : 'تفعيل'}">${t.is_active ? '🚫' : '✅'}</button>
                                <button onclick="deleteTenantAction(${t.id}, '${t.name}')" style="background: #dc2626; color: white; border: none; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 11px;" title="حذف">🗑️</button>
                            </div>
                        </td>
                    </tr>
                `;
            });
        }

        tableHTML += '</tbody></table></div>';
        document.getElementById('tenantsTableContainer').innerHTML = tableHTML;

    } catch (e) {
        console.error('[SuperAdmin] Load dashboard error:', e);
    }
}

let editingTenantId = null;

function showAddTenant() {
    editingTenantId = null;
    document.getElementById('tenantEditId').value = '';
    document.getElementById('tenantName').value = '';
    document.getElementById('tenantSlug').value = '';
    document.getElementById('tenantOwnerName').value = '';
    document.getElementById('tenantOwnerEmail').value = '';
    document.getElementById('tenantOwnerPhone').value = '';
    document.getElementById('tenantAdminUsername').value = 'admin';
    document.getElementById('tenantAdminPassword').value = 'admin123';
    document.getElementById('tenantPlan').value = 'basic';
    document.getElementById('tenantMaxUsers').value = '5';
    document.getElementById('tenantMaxBranches').value = '3';
    document.getElementById('tenantSubAmount').value = '0';
    document.getElementById('tenantSubPeriod').value = '30';
    document.getElementById('tenantSlugGroup').style.display = 'block';
    document.getElementById('tenantAdminFields').style.display = 'grid';
    document.getElementById('tenantModalTitle').textContent = '➕ إضافة متجر جديد';
    document.getElementById('addTenantModal').classList.add('active');
}

async function editTenant(tenantId) {
    try {
        const response = await originalFetch(`${API_URL}/api/super-admin/tenants/${tenantId}/stats`);
        const data = await response.json();
        if (!data.success) return;
        const t = data.tenant;
        editingTenantId = tenantId;
        document.getElementById('tenantEditId').value = tenantId;
        document.getElementById('tenantName').value = t.name;
        document.getElementById('tenantSlug').value = t.slug;
        document.getElementById('tenantOwnerName').value = t.owner_name;
        document.getElementById('tenantOwnerEmail').value = t.owner_email || '';
        document.getElementById('tenantOwnerPhone').value = t.owner_phone || '';
        document.getElementById('tenantPlan').value = t.plan || 'basic';
        document.getElementById('tenantMaxUsers').value = t.max_users || 5;
        document.getElementById('tenantMaxBranches').value = t.max_branches || 3;
        document.getElementById('tenantSubAmount').value = t.subscription_amount || 0;
        document.getElementById('tenantSubPeriod').value = t.subscription_period || 30;
        document.getElementById('tenantSlugGroup').style.display = 'none'; // لا يمكن تغيير slug
        document.getElementById('tenantAdminFields').style.display = 'none'; // لا يمكن تغيير أدمن من هنا
        document.getElementById('tenantModalTitle').textContent = '✏️ تعديل متجر';
        document.getElementById('addTenantModal').classList.add('active');
    } catch (e) {
        console.error('[SuperAdmin] Edit tenant error:', e);
    }
}

document.getElementById('tenantForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        if (editingTenantId) {
            // تحديث
            const response = await originalFetch(`${API_URL}/api/super-admin/tenants/${editingTenantId}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    name: document.getElementById('tenantName').value,
                    owner_name: document.getElementById('tenantOwnerName').value,
                    owner_email: document.getElementById('tenantOwnerEmail').value,
                    owner_phone: document.getElementById('tenantOwnerPhone').value,
                    plan: document.getElementById('tenantPlan').value,
                    max_users: parseInt(document.getElementById('tenantMaxUsers').value),
                    max_branches: parseInt(document.getElementById('tenantMaxBranches').value),
                    subscription_amount: parseFloat(document.getElementById('tenantSubAmount').value) || 0,
                    subscription_period: parseInt(document.getElementById('tenantSubPeriod').value) || 30
                })
            });
            const data = await response.json();
            if (data.success) {
                alert('تم تحديث المتجر بنجاح');
            } else {
                alert(data.error || 'فشل التحديث');
                return;
            }
        } else {
            // إنشاء جديد
            const response = await originalFetch(`${API_URL}/api/super-admin/tenants`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    name: document.getElementById('tenantName').value,
                    slug: document.getElementById('tenantSlug').value,
                    owner_name: document.getElementById('tenantOwnerName').value,
                    owner_email: document.getElementById('tenantOwnerEmail').value,
                    owner_phone: document.getElementById('tenantOwnerPhone').value,
                    admin_username: document.getElementById('tenantAdminUsername').value,
                    admin_password: document.getElementById('tenantAdminPassword').value,
                    plan: document.getElementById('tenantPlan').value,
                    max_users: parseInt(document.getElementById('tenantMaxUsers').value),
                    max_branches: parseInt(document.getElementById('tenantMaxBranches').value),
                    subscription_amount: parseFloat(document.getElementById('tenantSubAmount').value) || 0,
                    subscription_period: parseInt(document.getElementById('tenantSubPeriod').value) || 30
                })
            });
            const data = await response.json();
            if (data.success) {
                alert('تم إنشاء المتجر بنجاح');
            } else {
                alert(data.error || 'فشل الإنشاء');
                return;
            }
        }
        document.getElementById('addTenantModal').classList.remove('active');
        loadSuperAdminDashboard();
    } catch (e) {
        console.error('[SuperAdmin] Save tenant error:', e);
        alert('خطأ في حفظ المتجر');
    }
});

async function toggleTenant(tenantId, newState) {
    try {
        const response = await originalFetch(`${API_URL}/api/super-admin/tenants/${tenantId}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ is_active: newState })
        });
        const data = await response.json();
        if (data.success) {
            loadSuperAdminDashboard();
        }
    } catch (e) {
        console.error('[SuperAdmin] Toggle error:', e);
    }
}

async function deleteTenantAction(tenantId, tenantName) {
    if (!confirm(`⚠️ هل أنت متأكد من حذف المتجر "${tenantName}"؟\n\nسيتم حذف جميع البيانات نهائياً!`)) return;
    if (!confirm('تأكيد نهائي: هذا الإجراء لا يمكن التراجع عنه!')) return;

    try {
        const response = await originalFetch(`${API_URL}/api/super-admin/tenants/${tenantId}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            alert('تم حذف المتجر');
            loadSuperAdminDashboard();
        } else {
            alert(data.error || 'فشل الحذف');
        }
    } catch (e) {
        console.error('[SuperAdmin] Delete error:', e);
    }
}

async function viewTenantStats(tenantId) {
    try {
        const response = await originalFetch(`${API_URL}/api/super-admin/tenants/${tenantId}/stats`);
        const data = await response.json();
        if (!data.success) return;

        const t = data.tenant;
        const s = data.stats;
        const planNames = {'basic': 'أساسية', 'premium': 'متقدمة', 'enterprise': 'مؤسسات'};

        document.getElementById('tenantStatsTitle').textContent = `📊 إحصائيات: ${t.name}`;
        document.getElementById('tenantStatsContent').innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px;">
                <div style="background: #f8fafc; padding: 12px; border-radius: 8px;">
                    <div style="color: #64748b; font-size: 12px;">المعرف</div>
                    <div style="font-weight: bold; direction: ltr;">${t.slug}</div>
                </div>
                <div style="background: #f8fafc; padding: 12px; border-radius: 8px;">
                    <div style="color: #64748b; font-size: 12px;">الخطة</div>
                    <div style="font-weight: bold;">${planNames[t.plan] || t.plan}</div>
                </div>
                <div style="background: #f8fafc; padding: 12px; border-radius: 8px;">
                    <div style="color: #64748b; font-size: 12px;">المالك</div>
                    <div style="font-weight: bold;">${t.owner_name}</div>
                </div>
                <div style="background: #f8fafc; padding: 12px; border-radius: 8px;">
                    <div style="color: #64748b; font-size: 12px;">تاريخ الإنشاء</div>
                    <div style="font-weight: bold;">${new Date(t.created_at).toLocaleDateString('ar')}</div>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                <div style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 15px; border-radius: 10px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold;">${s.users_count}</div>
                    <div style="font-size: 11px; opacity: 0.9;">مستخدمين (حد: ${t.max_users})</div>
                </div>
                <div style="background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 15px; border-radius: 10px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold;">${s.branches_count}</div>
                    <div style="font-size: 11px; opacity: 0.9;">فروع (حد: ${t.max_branches})</div>
                </div>
                <div style="background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; padding: 15px; border-radius: 10px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold;">${s.products_count}</div>
                    <div style="font-size: 11px; opacity: 0.9;">منتجات</div>
                </div>
                <div style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 15px; border-radius: 10px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold;">${s.invoices_count}</div>
                    <div style="font-size: 11px; opacity: 0.9;">فواتير</div>
                </div>
                <div style="background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: white; padding: 15px; border-radius: 10px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold;">${s.customers_count}</div>
                    <div style="font-size: 11px; opacity: 0.9;">عملاء</div>
                </div>
                <div style="background: linear-gradient(135deg, #ec4899, #db2777); color: white; padding: 15px; border-radius: 10px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold;">${parseFloat(s.total_sales || 0).toFixed(3)}</div>
                    <div style="font-size: 11px; opacity: 0.9;">إجمالي المبيعات (د.ك)</div>
                </div>
            </div>
        `;
        document.getElementById('tenantStatsModal').classList.add('active');
    } catch (e) {
        console.error('[SuperAdmin] Stats error:', e);
    }
}

// ===== إدارة الاشتراكات =====

async function openSubscriptionModal(tenantId) {
    document.getElementById('subTenantId').value = tenantId;

    try {
        // جلب بيانات المستأجر
        const statsRes = await originalFetch(`${API_URL}/api/super-admin/tenants/${tenantId}/stats`);
        const statsData = await statsRes.json();

        if (!statsData.success) return;
        const t = statsData.tenant;

        // معلومات الاشتراك الحالي
        let infoHTML = '';
        const subAmount = t.subscription_amount || 0;
        const subPeriod = t.subscription_period || 30;

        if (t.expires_at) {
            const expiry = new Date(t.expires_at);
            const today = new Date();
            today.setHours(0,0,0,0);
            const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
            const isExpired = daysLeft < 0;
            infoHTML = `
                <div style="background: ${isExpired ? '#fef2f2' : daysLeft <= 7 ? '#fffbeb' : '#f0fdf4'}; padding: 15px; border-radius: 10px; border: 2px solid ${isExpired ? '#fca5a5' : daysLeft <= 7 ? '#fcd34d' : '#86efac'};">
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; text-align: center;">
                        <div>
                            <div style="font-size: 12px; color: #64748b;">المتجر</div>
                            <div style="font-weight: bold;">${t.name}</div>
                        </div>
                        <div>
                            <div style="font-size: 12px; color: #64748b;">ينتهي في</div>
                            <div style="font-weight: bold; color: ${isExpired ? '#ef4444' : '#059669'};">${t.expires_at.substring(0,10)}</div>
                        </div>
                        <div>
                            <div style="font-size: 12px; color: #64748b;">الأيام المتبقية</div>
                            <div style="font-weight: bold; font-size: 20px; color: ${isExpired ? '#ef4444' : daysLeft <= 7 ? '#f59e0b' : '#059669'};">${isExpired ? 'منتهي ⛔' : daysLeft + ' يوم'}</div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            infoHTML = `
                <div style="background: #f1f5f9; padding: 15px; border-radius: 10px; text-align: center; color: #64748b;">
                    <strong>${t.name}</strong> - لم يتم تحديد فترة اشتراك بعد
                </div>
            `;
        }
        document.getElementById('subscriptionInfo').innerHTML = infoHTML;

        // تعبئة القيم الافتراضية
        document.getElementById('subAmount').value = subAmount > 0 ? subAmount : '';
        document.getElementById('subPeriodDays').value = subPeriod;
        document.getElementById('subNotes').value = '';

        document.getElementById('subscriptionModalTitle').textContent = `💳 اشتراك: ${t.name}`;

        // جلب فواتير الاشتراك
        const invRes = await originalFetch(`${API_URL}/api/super-admin/subscriptions/${tenantId}`);
        const invData = await invRes.json();

        let invHTML = '';
        if (invData.success && invData.invoices && invData.invoices.length > 0) {
            const payNames = {'cash': '💵 نقداً', 'knet': '💳 كي نت', 'bank': '🏦 تحويل بنكي'};
            invHTML = `<table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                <thead><tr style="background: #f1f5f9;">
                    <th style="padding: 8px; text-align: right;">#</th>
                    <th style="padding: 8px; text-align: right;">المبلغ</th>
                    <th style="padding: 8px; text-align: right;">المدة</th>
                    <th style="padding: 8px; text-align: right;">من</th>
                    <th style="padding: 8px; text-align: right;">إلى</th>
                    <th style="padding: 8px; text-align: right;">الدفع</th>
                    <th style="padding: 8px; text-align: center;">حذف</th>
                </tr></thead><tbody>`;
            invData.invoices.forEach((inv, i) => {
                invHTML += `<tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 6px;">${i+1}</td>
                    <td style="padding: 6px; font-weight: bold;">${parseFloat(inv.amount).toFixed(3)} د.ك</td>
                    <td style="padding: 6px;">${inv.period_days} يوم</td>
                    <td style="padding: 6px;">${inv.start_date}</td>
                    <td style="padding: 6px;">${inv.end_date}</td>
                    <td style="padding: 6px;">${payNames[inv.payment_method] || inv.payment_method}</td>
                    <td style="padding: 6px; text-align: center;">
                        <button onclick="deleteSubInvoice(${inv.id}, ${tenantId})" style="background: #ef4444; color: white; border: none; padding: 3px 6px; border-radius: 4px; cursor: pointer; font-size: 10px;">🗑️</button>
                    </td>
                </tr>`;
            });
            invHTML += '</tbody></table>';
        } else {
            invHTML = '<div style="text-align: center; color: #94a3b8; padding: 20px;">لا توجد فواتير اشتراك</div>';
        }
        document.getElementById('subscriptionInvoicesList').innerHTML = invHTML;

        document.getElementById('subscriptionModal').classList.add('active');
    } catch (e) {
        console.error('[SuperAdmin] Open subscription error:', e);
    }
}

document.getElementById('subscriptionForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tenantId = document.getElementById('subTenantId').value;
    const amount = parseFloat(document.getElementById('subAmount').value);
    const periodDays = parseInt(document.getElementById('subPeriodDays').value);
    const paymentMethod = document.getElementById('subPaymentMethod').value;
    const notes = document.getElementById('subNotes').value;

    if (!amount || amount <= 0) {
        alert('يرجى إدخال مبلغ صحيح');
        return;
    }

    try {
        const response = await originalFetch(`${API_URL}/api/super-admin/subscriptions`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ tenant_id: tenantId, amount, period_days: periodDays, payment_method: paymentMethod, notes })
        });
        const data = await response.json();
        if (data.success) {
            alert(`تم تجديد الاشتراك بنجاح!\nمن: ${data.start_date}\nإلى: ${data.end_date}`);
            openSubscriptionModal(tenantId); // إعادة تحميل
            loadSuperAdminDashboard(); // تحديث الجدول
        } else {
            alert(data.error || 'فشل إنشاء الفاتورة');
        }
    } catch (e) {
        console.error('[SuperAdmin] Create subscription error:', e);
        alert('خطأ في إنشاء فاتورة الاشتراك');
    }
});

async function deleteSubInvoice(invoiceId, tenantId) {
    if (!confirm('هل تريد حذف هذه الفاتورة؟')) return;
    try {
        const response = await originalFetch(`${API_URL}/api/super-admin/subscriptions/${invoiceId}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            openSubscriptionModal(tenantId);
        }
    } catch (e) {
        console.error('[SuperAdmin] Delete sub invoice error:', e);
    }
}

// استعادة جلسة Super Admin
(function restoreSuperAdmin() {
    const savedSA = localStorage.getItem('pos_super_admin');
    if (savedSA) {
        try {
            currentSuperAdmin = JSON.parse(savedSA);
            document.getElementById('loginOverlay').classList.add('hidden');
            document.getElementById('mainContainer').style.display = 'none';
            document.getElementById('superAdminDashboard').style.display = 'block';
            document.getElementById('saUserInfo').textContent = currentSuperAdmin.full_name;
            loadSuperAdminDashboard();
        } catch (e) {
            localStorage.removeItem('pos_super_admin');
        }
    }
})();

console.log('[Multi-Tenancy] System Loaded ✅');

console.log('🎉 All Systems Loaded!');

