const API_URL = window.location.origin;
let currentUser = null;
let cart = [];
let allProducts = [];
let allInvoices = [];
let allCustomers = [];
let currentInvoice = null;
let categories = new Set();
let storeLogo = null;

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
        const response = await fetch(`${API_URL}/api/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                username: document.getElementById('loginUsername').value,
                password: document.getElementById('loginPassword').value
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

async function logout() {
    // منع تسجيل الخروج في وضع offline
    if (!navigator.onLine) {
        alert('📴 لا يمكن تسجيل الخروج في وضع offline!\n\nالرجاء الاتصال بالإنترنت أولاً.');
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
        
        // البحث عن المنتج في السلة
        const cartItem = cart.find(item => item.id === p.id);
        const inCart = cartItem ? cartItem.quantity : 0;
        
        let counterHTML = '';
        if (inCart > 0) {
            // العداد إذا موجود في السلة
            counterHTML = `
                <div class="product-counter">
                    <button class="counter-btn" onclick="event.stopPropagation(); updateQuantity(${p.id}, -1)" title="تقليل">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                    </button>
                    <span class="counter-value">${inCart}</span>
                    <button class="counter-btn" onclick="event.stopPropagation(); updateQuantity(${p.id}, 1)" title="زيادة">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                    </button>
                </div>
            `;
        } else {
            // زر إضافة إذا مش موجود
            counterHTML = `
                <button class="add-to-cart-btn" onclick="event.stopPropagation(); addToCart(${p.id})">
                    إضافة للسلة
                </button>
            `;
        }
        
        return `
        <div class="product-card">
            ${imgDisplay}
            <div class="product-card-name">${p.name}</div>
            <div class="product-card-price">${p.price.toFixed(3)} د.ك</div>
            <div class="product-card-stock">المخزون: ${p.stock}</div>
            ${counterHTML}
        </div>
        `;
    }).join('');
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
function addToCart(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product || product.stock <= 0) {
        alert('المنتج غير متوفر');
        return;
    }
    const existingItem = cart.find(item => item.id === productId);
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
            name: product.name,
            price: product.price,
            quantity: 1,
            stock: product.stock
        });
    }
    updateCart();
}

function updateCart() {
    const cartItems = document.getElementById('cartItems');
    if (cart.length === 0) {
        cartItems.innerHTML = '<div class="empty-cart"><div class="empty-cart-icon">🛒</div><p>السلة فارغة</p></div>';
    } else {
        cartItems.innerHTML = cart.map(item => `
            <div class="cart-item-simple">
                <div class="cart-item-name">${item.name}</div>
                <div class="cart-item-price">${item.price.toFixed(3)} × ${item.quantity} = ${(item.price * item.quantity).toFixed(3)} د.ك</div>
            </div>
        `).join('');
    }
    updateTotals();
    // تحديث عرض المنتجات لتحديث العدادات
    displayProducts(allProducts);
}

function updateQuantity(productId, change) {
    const item = cart.find(i => i.id === productId);
    if (!item) return;
    const newQty = item.quantity + change;
    if (newQty <= 0) {
        removeFromCart(productId);
        return;
    }
    if (newQty > item.stock) {
        alert('الكمية أكبر من المخزون');
        return;
    }
    item.quantity = newQty;
    updateCart();
}

function removeFromCart(productId) {
    cart = cart.filter(item => item.id !== productId);
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
    toggleTransactionNumber();
    
    // مسح بيانات الولاء
    document.getElementById('selectedCustomerId').value = '';
    document.getElementById('pointsToRedeem').value = '';
    document.getElementById('loyaltySection').style.display = 'none';
    document.getElementById('loyaltyDiscountRow').style.display = 'none';
    currentCustomerData = null;
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
    const deliveryFee = parseFloat(document.getElementById('deliveryFee').value) || 0;
    const total = subtotal - discount + deliveryFee;
    document.getElementById('subtotal').textContent = `${subtotal.toFixed(3)} د.ك`;
    document.getElementById('total').textContent = `${total.toFixed(3)} د.ك`;
    saveUserCart(); // حفظ السلة
}

function toggleTransactionNumber() {
    const method = document.getElementById('paymentMethod').value;
    const transInput = document.getElementById('transactionNumber');
    if (method === 'knet' || method === 'visa') {
        transInput.style.display = 'block';
        transInput.required = true;
    } else {
        transInput.style.display = 'none';
        transInput.required = false;
        transInput.value = '';
    }
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
    const deliveryFee = parseFloat(document.getElementById('deliveryFee').value) || 0;
    const total = subtotal - discount + deliveryFee;
    
    if (total <= 0) {
        alert('الإجمالي يجب أن يكون أكبر من صفر');
        return;
    }
    
    const paymentMethod = document.getElementById('paymentMethod').value;
    const transactionNumber = document.getElementById('transactionNumber').value;
    if ((paymentMethod === 'knet' || paymentMethod === 'visa') && !transactionNumber) {
        alert('الرجاء إدخال رقم العملية');
        return;
    }
    
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
    const loyaltyDiscount = pointsToRedeem / 100;
    const pointsEarned = customerId ? Math.floor(total) : 0;
    
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
        items: cart.map(item => ({
            product_id: item.id,
            product_name: item.name,
            quantity: item.quantity,
            price: item.price,
            total: item.price * item.quantity,
            branch_stock_id: item.id
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
    const content = document.getElementById('invoiceViewContent');
    content.innerHTML = `
        <div style="padding: 20px;">
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
                <div><strong>الدفع:</strong> ${paymentMethods[inv.payment_method]}</div>
                ${inv.transaction_number ? `<div style="grid-column: 1/-1;"><strong>رقم العملية:</strong> ${inv.transaction_number}</div>` : ''}
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

function generateCompactInvoiceHTML(inv) {
    const paymentMethods = {'cash':'💵 نقداً','knet':'💳 كي نت','visa':'💳 فيزا','other':'💰 أخرى'};
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
<div><b>طريقة الدفع:</b> ${paymentMethods[inv.payment_method]}</div>
${inv.transaction_number ? `<div style="grid-column:1/-1;"><b>رقم العملية:</b> ${inv.transaction_number}</div>` : ''}
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
    
    const product = allProducts.find(p => p.id === id);
    if (!product) return;
    updateCategoryDropdown();
    loadBranchesDropdowns();
    document.getElementById('productModalTitle').textContent = '✏️ تعديل منتج';
    document.getElementById('productId').value = product.id;
    document.getElementById('productName').value = product.name;
    document.getElementById('productBarcode').value = product.barcode || '';
    document.getElementById('productPrice').value = product.price;
    document.getElementById('productCost').value = product.cost || 0;
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
                        const status = inv.order_status || 'قيد التنفيذ';
                        return `
                        <tr>
                            <td>
                                <strong>${inv.invoice_number}</strong>
                                ${isOffline ? ' <span style="background:#dc3545; color:white; padding:2px 6px; border-radius:4px; font-size:10px;">📴 معلقة</span>' : ''}
                            </td>
                            <td>${inv.customer_name || 'عميل'}</td>
                            <td>${inv.employee_name}</td>
                            <td style="color:#28a745; font-weight:bold;">${inv.total.toFixed(3)} د.ك</td>
                            <td>
                                <select class="order-status-select status-${status === 'قيد التنفيذ' ? 'processing' : status === 'قيد التوصيل' ? 'delivering' : 'completed'}"
                                        onchange="updateOrderStatus(${inv.id}, this.value)" ${isOffline ? 'disabled' : ''}>
                                    <option value="قيد التنفيذ" ${status === 'قيد التنفيذ' ? 'selected' : ''}>⏳ قيد التنفيذ</option>
                                    <option value="قيد التوصيل" ${status === 'قيد التوصيل' ? 'selected' : ''}>🚚 قيد التوصيل</option>
                                    <option value="منجز" ${status === 'منجز' ? 'selected' : ''}>✅ منجز</option>
                                </select>
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

// تحديث حالة الطلب
async function updateOrderStatus(invoiceId, newStatus) {
    try {
        const response = await fetch(`${API_URL}/api/invoices/${invoiceId}/status`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ order_status: newStatus })
        });
        const data = await response.json();
        if (data.success) {
            // تحديث لون القائمة المنسدلة
            const select = event.target;
            select.className = 'order-status-select ' +
                (newStatus === 'قيد التنفيذ' ? 'status-processing' :
                 newStatus === 'قيد التوصيل' ? 'status-delivering' : 'status-completed');
        } else {
            alert('خطأ في تحديث الحالة: ' + data.error);
            loadInvoicesTable();
        }
    } catch (error) {
        console.error('خطأ:', error);
        alert('فشل تحديث حالة الطلب');
        loadInvoicesTable();
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
        
        html += `
            <tr>
                <td style="text-align: center;">${imgDisplay}</td>
                <td><strong>${item.name}</strong></td>
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
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
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
            // تسجيل في السجل
            try {
                const action = inventoryId ? 'edit_inventory' : 'add_inventory';
                const description = inventoryId ? `تعديل منتج: ${inventoryData.name}` : `إضافة منتج: ${inventoryData.name}`;
                await logAction(action, description, data.id || inventoryId);
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
    document.getElementById('distributionProductInfo').innerHTML = `
        <div style="display: flex; align-items: center; gap: 15px;">
            <div style="font-size: 50px;">🛍️</div>
            <div>
                <h3 style="margin: 0;">${product.name}</h3>
                <p style="margin: 5px 0 0; color: #666;">السعر: ${product.price.toFixed(3)} د.ك | التكلفة: ${(product.cost || 0).toFixed(3)} د.ك</p>
            </div>
        </div>
    `;
    
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
            
            let html = '<table class="data-table"><thead><tr><th>الفرع</th><th>الكمية</th><th>إجراءات</th></tr></thead><tbody>';
            
            data.stock.forEach(s => {
                const branchName = branches[s.branch_id] || 'غير محدد';
                html += `
                    <tr>
                        <td>🏢 ${branchName}</td>
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
    
    const distributionData = {
        inventory_id: currentDistributionProduct.id,
        branch_id: parseInt(document.getElementById('distributionBranch').value),
        stock: parseInt(document.getElementById('distributionStock').value)
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
            await logAction('distribute', `توزيع ${distributionData.stock} من ${currentDistributionProduct.name}`, data.id);
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
                ${expenses.map(e => `
                    <tr>
                        <td>${new Date(e.expense_date).toLocaleDateString('ar')}</td>
                        <td><strong>${e.expense_type}</strong></td>
                        <td style="color: #dc3545; font-weight: bold;">${e.amount.toFixed(3)} د.ك</td>
                        <td>${e.description || '-'}</td>
                        <td>${e.branch_id || 'عام'}</td>
                        <td>
                            <button onclick="deleteExpense(${e.id})" class="btn-sm btn-danger">🗑️</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = html;
}

function showAddExpense() {
    document.getElementById('expenseModalTitle').textContent = '➕ إضافة تكلفة';
    document.getElementById('expenseForm').reset();
    document.getElementById('expenseDate').valueAsDate = new Date();
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
    
    const expenseData = {
        expense_type: document.getElementById('expenseType').value,
        amount: parseFloat(document.getElementById('expenseAmount').value),
        description: document.getElementById('expenseDescription').value,
        expense_date: document.getElementById('expenseDate').value,
        branch_id: parseInt(document.getElementById('expenseBranch').value) || null,
        created_by: currentUser.id
    };
    
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
    const select = document.getElementById('customerSelect');
    if (!select) return;
    
    // مسح الخيارات القديمة (ماعدا الأولين)
    while (select.options.length > 2) {
        select.remove(2);
    }
    
    // إضافة العملاء
    allCustomersDropdown.forEach(customer => {
        const option = document.createElement('option');
        option.value = customer.id;
        option.textContent = `${customer.name}${customer.phone ? ' (' + customer.phone + ')' : ''}`;
        select.appendChild(option);
    });
}

function selectCustomer() {
    const selectValue = document.getElementById('customerSelect').value;
    
    if (selectValue === 'new') {
        showAddCustomer();
        document.getElementById('customerSelect').value = '';
        return;
    }
    
    if (!selectValue) {
        clearCustomerSelection();
        return;
    }
    
    const customer = allCustomersDropdown.find(c => c.id == selectValue);
    if (customer) {
        document.getElementById('selectedCustomerId').value = customer.id;
        document.getElementById('customerName').value = customer.name;
        document.getElementById('customerPhone').value = customer.phone || '';
        document.getElementById('customerAddress').value = customer.address || '';
        
        document.getElementById('displayCustomerName').textContent = customer.name;
        document.getElementById('displayCustomerPhone').textContent = customer.phone || '-';
        document.getElementById('displayCustomerAddress').textContent = customer.address || '-';
        document.getElementById('customerDetails').style.display = 'block';
    }
}

function clearCustomerSelection() {
    document.getElementById('customerSelect').value = '';
    document.getElementById('selectedCustomerId').value = '';
    document.getElementById('customerName').value = '';
    document.getElementById('customerPhone').value = '';
    document.getElementById('customerAddress').value = '';
    document.getElementById('customerDetails').style.display = 'none';
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
        html += `
            <tr>
                <td>${c.name}</td>
                <td>${c.phone}</td>
                <td><span style="font-weight: bold; color: #0ea5e9;">${c.points || 0}</span></td>
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
    
    try {
        const url = customerId ? `${API_URL}/api/customers/${customerId}` : `${API_URL}/api/customers`;
        const method = customerId ? 'PUT' : 'POST';
        
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
        } else {
            alert('❌ خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل الحفظ');
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

// حذف عميل
async function deleteCustomer(id) {
    if (!confirm('هل أنت متأكد من حذف هذا العميل؟')) return;
    
    try {
        const response = await fetch(`${API_URL}/api/customers/${id}`, {method: 'DELETE'});
        const data = await response.json();
        
        if (data.success) {
            alert('✅ تم حذف العميل');
            loadCustomers();
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
    const total = calculateSubtotal();
    const pointsToEarn = Math.floor(total); // 1 دينار = 1 نقطة
    document.getElementById('pointsToEarn').textContent = pointsToEarn;
}

// حساب خصم الولاء
function calculateLoyaltyDiscount() {
    const pointsToRedeem = parseInt(document.getElementById('pointsToRedeem').value) || 0;
    const availablePoints = currentCustomerData ? (currentCustomerData.points || 0) : 0;
    
    if (pointsToRedeem > availablePoints) {
        alert('⚠️ النقاط المطلوبة أكبر من النقاط المتاحة');
        document.getElementById('pointsToRedeem').value = availablePoints;
        return;
    }
    
    // 100 نقطة = 1 دينار
    const discount = pointsToRedeem / 100;
    
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
    
    const availablePoints = currentCustomerData.points || 0;
    const total = calculateSubtotal();
    const maxDiscount = total;
    const maxPointsToUse = Math.min(availablePoints, Math.floor(maxDiscount * 100));
    
    // تقريب لأقرب 100
    const roundedPoints = Math.floor(maxPointsToUse / 100) * 100;
    
    document.getElementById('pointsToRedeem').value = roundedPoints;
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
async function checkConnection() {
    try {
        const response = await fetch(`${API_URL}/api/ping`, {
            method: 'GET',
            cache: 'no-cache'
        });
        return response.ok;
    } catch {
        return false;
    }
}

// تسجيل الخروج المحدث
async function logout() {
    try {
        // التحقق من الاتصال أولاً
        const isOnline = await checkConnection();
        
        if (!isOnline) {
            alert('⚠️ لا يمكن تسجيل الخروج بدون اتصال بالإنترنت\n' +
                  'الرجاء التحقق من الاتصال والمحاولة مرة أخرى');
            return;
        }
        
        // تسجيل الخروج من الخادم
        const response = await fetch(`${API_URL}/api/logout`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'}
        });
        
        if (response.ok) {
            // مسح البيانات المحلية
            localStorage.removeItem('pos_current_user');
            window.location.href = '/login.html';
        }
    } catch (error) {
        console.error('Logout error:', error);
        alert('⚠️ خطأ في تسجيل الخروج. تحقق من الاتصال.');
    }
}

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

async function updateOrderStatus(invoiceId, newStatus, notes = '') {
    try {
        const response = await fetch(`${API_URL}/api/invoices/${invoiceId}/status`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                status: newStatus,
                changed_by: currentUser.id,
                notes: notes
            })
        });
        
        const data = await response.json();
        if (data.success) {
            alert('✅ تم تحديث حالة الطلب');
            loadInvoicesTable();
        } else {
            alert('❌ خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل التحديث');
    }
}

async function filterOrdersByStatus(status) {
    try {
        const response = await fetch(`${API_URL}/api/orders/by-status?status=${status}`);
        const data = await response.json();
        
        if (data.success) {
            displayOrdersTable(data.orders);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

console.log('[Order Status] Loaded ✅');

// ===============================================
// 🏭 نظام الموردين (Suppliers)
// ===============================================

let allSuppliers = [];

async function loadSuppliers() {
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
    // TODO: عرض جدول الموردين
    console.log('Suppliers:', suppliers);
}

async function addSupplier(supplierData) {
    try {
        const response = await fetch(`${API_URL}/api/suppliers`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(supplierData)
        });
        
        const data = await response.json();
        if (data.success) {
            alert('✅ تم إضافة المورد');
            loadSuppliers();
        } else {
            alert('❌ خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل الإضافة');
    }
}

async function createPurchaseOrder(poData) {
    try {
        const response = await fetch(`${API_URL}/api/purchase-orders`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(poData)
        });
        
        const data = await response.json();
        if (data.success) {
            alert('✅ تم إنشاء طلب الشراء');
        } else {
            alert('❌ خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل الإنشاء');
    }
}

console.log('[Suppliers System] Loaded ✅');

// ===============================================
// 🎟️ نظام الكوبونات (Coupons)
// ===============================================

let allCoupons = [];
let currentCoupon = null;

async function loadCoupons() {
    try {
        const response = await fetch(`${API_URL}/api/coupons`);
        const data = await response.json();
        
        if (data.success) {
            allCoupons = data.coupons;
            displayCouponsTable(allCoupons);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

function displayCouponsTable(coupons) {
    // TODO: عرض جدول الكوبونات
    console.log('Coupons:', coupons);
}

async function validateCoupon(code, customerId, total) {
    try {
        const response = await fetch(`${API_URL}/api/coupons/validate`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                code: code,
                customer_id: customerId,
                total: total
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentCoupon = data.coupon;
            return data.discount;
        } else {
            alert('❌ ' + data.error);
            return 0;
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل التحقق من الكوبون');
        return 0;
    }
}

async function applyCouponCode() {
    const code = document.getElementById('couponCodeInput')?.value;
    if (!code) {
        alert('⚠️ الرجاء إدخال كود الكوبون');
        return;
    }
    
    const customerId = document.getElementById('selectedCustomerId')?.value;
    const total = calculateSubtotal();
    
    const discount = await validateCoupon(code, customerId, total);
    
    if (discount > 0) {
        // تطبيق الخصم
        document.getElementById('couponDiscountDisplay').textContent = discount.toFixed(3) + ' د.ك';
        document.getElementById('couponDiscountRow').style.display = 'flex';
        updateTotals();
        
        alert(`✅ تم تطبيق الكوبون!\nالخصم: ${discount.toFixed(3)} د.ك`);
    }
}

async function createCoupon(couponData) {
    try {
        const response = await fetch(`${API_URL}/api/coupons`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(couponData)
        });
        
        const data = await response.json();
        if (data.success) {
            alert('✅ تم إنشاء الكوبون');
            loadCoupons();
        } else {
            alert('❌ خطأ: ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ فشل الإنشاء');
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

// تحميل العملاء في dropdown عند بدء التشغيل
setTimeout(() => {
    if (document.getElementById('customerSelect')) {
        loadCustomersDropdown();
        console.log('[Customers Dropdown] Loaded ✅');
    }
}, 1000);

console.log('🎉 All Systems Loaded!');

