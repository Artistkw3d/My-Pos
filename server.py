#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
خادم API لنظام POS
Flask + SQLite
محسّن لأجهزة Synology DS120j
نظام Multi-Tenancy بقواعد بيانات منفصلة
"""

from flask import Flask, request, jsonify, send_from_directory, g, send_file
from flask_cors import CORS
import sqlite3
import os
import shutil
import threading
import time
import urllib.request
import urllib.parse
from datetime import datetime, timedelta
import json
import re
import hashlib

app = Flask(__name__, static_folder='frontend')
CORS(app)

# إعدادات قواعد البيانات
DB_PATH = 'database/pos.db'  # قاعدة البيانات الافتراضية (للتوافق العكسي)
MASTER_DB_PATH = 'database/master.db'
TENANTS_DB_DIR = 'database/tenants'

# إنشاء المجلدات اللازمة
os.makedirs('database', exist_ok=True)
os.makedirs(TENANTS_DB_DIR, exist_ok=True)
BACKUPS_DIR = 'database/backups'
os.makedirs(BACKUPS_DIR, exist_ok=True)

# ===== نظام Multi-Tenancy =====

def hash_password(password):
    """تشفير كلمة المرور"""
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

def init_master_db():
    """إنشاء قاعدة البيانات الرئيسية للمستأجرين"""
    conn = sqlite3.connect(MASTER_DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tenants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            owner_name TEXT NOT NULL,
            owner_email TEXT,
            owner_phone TEXT,
            db_path TEXT NOT NULL,
            is_active INTEGER DEFAULT 1,
            plan TEXT DEFAULT 'basic',
            max_users INTEGER DEFAULT 5,
            max_branches INTEGER DEFAULT 3,
            subscription_amount REAL DEFAULT 0,
            subscription_period INTEGER DEFAULT 30,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TEXT
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS super_admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            full_name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS subscription_invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            period_days INTEGER NOT NULL DEFAULT 30,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            notes TEXT,
            payment_method TEXT DEFAULT 'cash',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        )
    ''')
    # ترقية: إضافة أعمدة جديدة إن لم تكن موجودة
    try:
        cursor.execute("PRAGMA table_info(tenants)")
        cols = [col[1] for col in cursor.fetchall()]
        if 'subscription_amount' not in cols:
            cursor.execute("ALTER TABLE tenants ADD COLUMN subscription_amount REAL DEFAULT 0")
        if 'subscription_period' not in cols:
            cursor.execute("ALTER TABLE tenants ADD COLUMN subscription_period INTEGER DEFAULT 30")
    except:
        pass
    # إنشاء حساب Super Admin افتراضي إن لم يكن موجوداً
    cursor.execute("SELECT COUNT(*) FROM super_admins")
    if cursor.fetchone()[0] == 0:
        cursor.execute(
            "INSERT INTO super_admins (username, password, full_name) VALUES (?, ?, ?)",
            ('superadmin', hash_password('admin123'), 'مدير النظام')
        )
    conn.commit()
    conn.close()

init_master_db()

def migrate_database(db_path=None):
    """ترقية قاعدة البيانات - إضافة أعمدة وجداول جديدة"""
    target_path = db_path or DB_PATH
    if not os.path.exists(target_path):
        return
    conn = sqlite3.connect(target_path)
    cursor = conn.cursor()

    def safe_exec(sql, msg=""):
        try:
            cursor.execute(sql)
            conn.commit()
        except Exception as e:
            if 'duplicate column' not in str(e).lower() and 'already exists' not in str(e).lower():
                print(f"[Migration] {msg}: {e}")

    def add_column(table, column, col_type, default=None):
        try:
            cursor.execute(f"PRAGMA table_info({table})")
            cols = [c[1] for c in cursor.fetchall()]
            if column not in cols:
                ddl = f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"
                if default is not None:
                    ddl += f" DEFAULT {default}"
                cursor.execute(ddl)
                conn.commit()
                print(f"[Migration] Added {table}.{column}")
        except Exception as e:
            print(f"[Migration] {table}.{column}: {e}")

    try:
        # === جداول جديدة ===
        safe_exec('''CREATE TABLE IF NOT EXISTS suppliers (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT,
            email TEXT, address TEXT, company TEXT, notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''', 'suppliers')

        safe_exec('''CREATE TABLE IF NOT EXISTS supplier_invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER NOT NULL,
            invoice_number TEXT, amount REAL DEFAULT 0, file_name TEXT, file_data TEXT,
            file_type TEXT, notes TEXT, invoice_date TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE)''', 'supplier_invoices')

        safe_exec('''CREATE TABLE IF NOT EXISTS coupons (
            id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL,
            discount_type TEXT NOT NULL DEFAULT 'amount', discount_value REAL NOT NULL DEFAULT 0,
            min_amount REAL DEFAULT 0, max_uses INTEGER DEFAULT 0, used_count INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1, expiry_date TEXT, notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''', 'coupons')

        safe_exec('''CREATE TABLE IF NOT EXISTS restaurant_tables (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, seats INTEGER DEFAULT 4,
            pos_x INTEGER DEFAULT 50, pos_y INTEGER DEFAULT 50, status TEXT DEFAULT 'available',
            current_invoice_id INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''', 'restaurant_tables')

        safe_exec('''CREATE TABLE IF NOT EXISTS product_variants (
            id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_id INTEGER NOT NULL,
            variant_name TEXT NOT NULL, price REAL DEFAULT 0, cost REAL DEFAULT 0, barcode TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE CASCADE)''', 'product_variants')

        safe_exec('''CREATE TABLE IF NOT EXISTS salary_details (
            id INTEGER PRIMARY KEY AUTOINCREMENT, expense_id INTEGER NOT NULL,
            employee_name TEXT NOT NULL, monthly_salary REAL DEFAULT 0,
            FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE)''', 'salary_details')

        # === أعمدة جديدة في الجداول الموجودة ===
        add_column('invoices', 'order_status', 'TEXT', "'قيد التنفيذ'")
        add_column('invoices', 'coupon_discount', 'REAL', 0)
        add_column('invoices', 'coupon_code', 'TEXT')
        add_column('invoices', 'loyalty_discount', 'REAL', 0)
        add_column('invoices', 'loyalty_points_earned', 'INTEGER', 0)
        add_column('invoices', 'loyalty_points_redeemed', 'INTEGER', 0)
        add_column('invoices', 'table_id', 'INTEGER')
        add_column('invoices', 'table_name', 'TEXT')
        add_column('invoices', 'cancelled', 'INTEGER', 0)
        add_column('invoices', 'cancel_reason', 'TEXT')
        add_column('invoices', 'cancelled_at', 'TIMESTAMP')
        add_column('invoices', 'stock_returned', 'INTEGER', 0)

        add_column('customers', 'loyalty_points', 'INTEGER', 0)

        # === صلاحيات جديدة ===
        add_column('users', 'can_view_returns', 'INTEGER', 0)
        add_column('users', 'can_view_expenses', 'INTEGER', 0)
        add_column('users', 'can_view_suppliers', 'INTEGER', 0)
        add_column('users', 'can_view_coupons', 'INTEGER', 0)
        add_column('users', 'can_view_tables', 'INTEGER', 0)
        add_column('users', 'can_view_attendance', 'INTEGER', 0)
        add_column('users', 'can_view_advanced_reports', 'INTEGER', 0)
        add_column('users', 'can_view_system_logs', 'INTEGER', 0)
        add_column('users', 'can_view_dcf', 'INTEGER', 0)
        add_column('users', 'can_cancel_invoices', 'INTEGER', 0)
        add_column('users', 'can_view_branches', 'INTEGER', 0)
        add_column('users', 'last_login', 'TIMESTAMP')

        add_column('invoice_items', 'variant_id', 'INTEGER')
        add_column('invoice_items', 'variant_name', 'TEXT')

        add_column('branch_stock', 'variant_id', 'INTEGER')

        # إعدادات الولاء الافتراضية
        try:
            cursor.execute("SELECT COUNT(*) FROM settings WHERE key = 'loyalty_points_per_invoice'")
            if cursor.fetchone()[0] == 0:
                cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('loyalty_points_per_invoice', '10')")
                cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('loyalty_point_value', '0.1')")
                cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('loyalty_enabled', 'true')")
                conn.commit()
        except Exception as e:
            print(f"[Migration] loyalty settings: {e}")

        print(f"[Migration] ✅ {target_path}")
    except Exception as e:
        print(f"[Migration] ❌ Error: {e}")
    finally:
        conn.close()

# ترقية قاعدة البيانات الافتراضية
migrate_database()

# ترقية جميع قواعد بيانات المستأجرين
if os.path.exists(TENANTS_DB_DIR):
    for f in os.listdir(TENANTS_DB_DIR):
        if f.endswith('.db'):
            migrate_database(os.path.join(TENANTS_DB_DIR, f))

def get_tenant_slug():
    """استخراج معرف المستأجر من الطلب"""
    return request.headers.get('X-Tenant-ID', '').strip()

def get_tenant_db_path(slug):
    """الحصول على مسار قاعدة بيانات المستأجر"""
    if not slug:
        return DB_PATH  # القاعدة الافتراضية
    # التحقق من صحة slug
    safe_slug = re.sub(r'[^a-zA-Z0-9_-]', '', slug)
    if not safe_slug:
        return DB_PATH
    return os.path.join(TENANTS_DB_DIR, f'{safe_slug}.db')

def get_db():
    """الاتصال بقاعدة البيانات - يدعم Multi-Tenancy"""
    tenant_slug = get_tenant_slug()
    db_path = get_tenant_db_path(tenant_slug)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

def get_master_db():
    """الاتصال بقاعدة البيانات الرئيسية"""
    conn = sqlite3.connect(MASTER_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def dict_from_row(row):
    """تحويل صف قاعدة البيانات إلى قاموس"""
    return dict(zip(row.keys(), row))

def create_tenant_database(slug):
    """إنشاء قاعدة بيانات كاملة لمستأجر جديد"""
    db_path = get_tenant_db_path(slug)
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # إنشاء جميع الجداول الأساسية
    cursor.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            full_name TEXT NOT NULL,
            role TEXT DEFAULT 'employee',
            invoice_prefix TEXT DEFAULT 'INV',
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            permissions TEXT,
            can_add_products INTEGER DEFAULT 0,
            can_edit_products INTEGER DEFAULT 0,
            can_delete_products INTEGER DEFAULT 0,
            can_view_invoices INTEGER DEFAULT 1,
            can_delete_invoices INTEGER DEFAULT 0,
            can_view_reports INTEGER DEFAULT 0,
            can_view_accounting INTEGER DEFAULT 0,
            can_manage_users INTEGER DEFAULT 0,
            can_access_settings INTEGER DEFAULT 0,
            branch_id INTEGER DEFAULT 1,
            can_view_inventory INTEGER DEFAULT 0,
            can_add_inventory INTEGER DEFAULT 0,
            can_edit_inventory INTEGER DEFAULT 0,
            can_delete_inventory INTEGER DEFAULT 0,
            can_view_products INTEGER DEFAULT 1,
            can_view_customers INTEGER DEFAULT 1,
            can_add_customer INTEGER DEFAULT 1,
            can_edit_customer INTEGER DEFAULT 0,
            can_delete_customer INTEGER DEFAULT 0,
            last_login TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS branches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            location TEXT,
            phone TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            branch_number TEXT
        );

        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            barcode TEXT,
            price REAL DEFAULT 0,
            cost REAL DEFAULT 0,
            stock INTEGER DEFAULT 0,
            category TEXT,
            image TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            image_data TEXT,
            branch_id INTEGER DEFAULT 1,
            is_master INTEGER DEFAULT 0,
            master_product_id INTEGER,
            inventory_id INTEGER
        );

        CREATE TABLE IF NOT EXISTS inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            barcode TEXT,
            category TEXT,
            price REAL DEFAULT 0,
            cost REAL DEFAULT 0,
            image_data TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS product_variants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inventory_id INTEGER NOT NULL,
            variant_name TEXT NOT NULL,
            price REAL DEFAULT 0,
            cost REAL DEFAULT 0,
            barcode TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS branch_stock (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inventory_id INTEGER,
            branch_id INTEGER,
            variant_id INTEGER,
            stock INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            sales_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_number TEXT,
            customer_id INTEGER,
            customer_name TEXT,
            customer_phone TEXT,
            subtotal REAL DEFAULT 0,
            discount REAL DEFAULT 0,
            total REAL DEFAULT 0,
            payment_method TEXT,
            employee_name TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            transaction_number TEXT,
            delivery_fee REAL DEFAULT 0,
            discount_type TEXT,
            branch_id INTEGER,
            branch_name TEXT,
            customer_address TEXT,
            order_status TEXT DEFAULT 'قيد التنفيذ',
            coupon_discount REAL DEFAULT 0,
            coupon_code TEXT,
            loyalty_discount REAL DEFAULT 0,
            loyalty_points_earned INTEGER DEFAULT 0,
            loyalty_points_redeemed INTEGER DEFAULT 0,
            table_id INTEGER,
            table_name TEXT,
            cancelled INTEGER DEFAULT 0,
            cancel_reason TEXT,
            cancelled_at TIMESTAMP,
            stock_returned INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS invoice_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER,
            product_id INTEGER,
            product_name TEXT,
            quantity INTEGER,
            price REAL,
            total REAL,
            branch_stock_id INTEGER,
            variant_id INTEGER,
            variant_name TEXT
        );

        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT,
            email TEXT,
            address TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            loyalty_points INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            expense_type TEXT,
            amount REAL,
            description TEXT,
            expense_date DATE,
            branch_id INTEGER,
            created_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS salary_details (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            expense_id INTEGER,
            employee_name TEXT NOT NULL,
            monthly_salary REAL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS system_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action_type TEXT,
            description TEXT,
            user_id INTEGER,
            user_name TEXT,
            branch_id INTEGER,
            target_id INTEGER,
            details TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS attendance_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            user_name TEXT,
            branch_id INTEGER,
            check_in TIMESTAMP,
            check_out TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS damaged_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inventory_id INTEGER,
            branch_id INTEGER,
            quantity INTEGER,
            reason TEXT,
            reported_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS damaged_stock (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inventory_id INTEGER,
            branch_id INTEGER,
            quantity INTEGER,
            reason TEXT,
            user_id INTEGER,
            user_name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS returns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER,
            invoice_number TEXT,
            product_id INTEGER,
            product_name TEXT,
            quantity INTEGER,
            price REAL,
            total REAL,
            reason TEXT,
            employee_name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS suppliers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT,
            email TEXT,
            address TEXT,
            company TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS supplier_invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            supplier_id INTEGER NOT NULL,
            invoice_number TEXT,
            amount REAL DEFAULT 0,
            file_name TEXT,
            file_data TEXT,
            file_type TEXT,
            notes TEXT,
            invoice_date TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS coupons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            discount_type TEXT NOT NULL DEFAULT 'amount',
            discount_value REAL NOT NULL DEFAULT 0,
            min_amount REAL DEFAULT 0,
            max_uses INTEGER DEFAULT 0,
            used_count INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            expiry_date TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS restaurant_tables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            seats INTEGER DEFAULT 4,
            pos_x INTEGER DEFAULT 50,
            pos_y INTEGER DEFAULT 50,
            status TEXT DEFAULT 'available',
            current_invoice_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS product_variants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inventory_id INTEGER NOT NULL,
            variant_name TEXT NOT NULL,
            price REAL DEFAULT 0,
            cost REAL DEFAULT 0,
            barcode TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE CASCADE
        );
    ''')

    # إضافة إعدادات افتراضية
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('loyalty_points_per_invoice', '10')")
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('loyalty_point_value', '0.1')")
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('loyalty_enabled', 'true')")

    # إضافة فرع افتراضي
    cursor.execute("INSERT OR IGNORE INTO branches (id, name, location, is_active) VALUES (1, 'الفرع الرئيسي', '', 1)")

    conn.commit()
    conn.close()
    return db_path

# ===== API المستخدمين =====

@app.route('/api/login', methods=['POST'])
def login():
    """تسجيل دخول المستخدم"""
    try:
        data = request.json
        username = data.get('username')
        password = data.get('password')

        # التحقق من اشتراك المستأجر
        tenant_slug = get_tenant_slug()
        if tenant_slug:
            m_conn = get_master_db()
            m_cursor = m_conn.cursor()
            m_cursor.execute('SELECT is_active, expires_at, name FROM tenants WHERE slug = ?', (tenant_slug,))
            tenant = m_cursor.fetchone()
            m_conn.close()
            if not tenant:
                return jsonify({'success': False, 'error': 'معرف المتجر غير صحيح'}), 404
            if not tenant['is_active']:
                return jsonify({'success': False, 'error': '⛔ هذا المتجر معطل. تواصل مع إدارة النظام'}), 403
            if tenant['expires_at']:
                from datetime import date
                expiry = date.fromisoformat(tenant['expires_at'][:10])
                if date.today() > expiry:
                    # تعطيل المتجر تلقائياً
                    m_conn2 = get_master_db()
                    m_cursor2 = m_conn2.cursor()
                    m_cursor2.execute('UPDATE tenants SET is_active = 0 WHERE slug = ?', (tenant_slug,))
                    m_conn2.commit()
                    m_conn2.close()
                    return jsonify({'success': False, 'error': f'⛔ انتهى اشتراك المتجر "{tenant["name"]}" بتاريخ {tenant["expires_at"][:10]}.\nتواصل مع إدارة النظام لتجديد الاشتراك.'}), 403

        conn = get_db()
        cursor = conn.cursor()

        # إضافة أعمدة الصلاحيات الجديدة تلقائياً عند تسجيل الدخول
        ensure_user_permission_columns(cursor)
        conn.commit()

        hashed_pw = hash_password(password)
        cursor.execute('''
            SELECT u.*, b.name as branch_name
            FROM users u
            LEFT JOIN branches b ON u.branch_id = b.id
            WHERE u.username = ? AND u.is_active = 1
        ''', (username,))

        user = cursor.fetchone()

        if user:
            stored_pw = user['password']
            # دعم كلمات المرور القديمة (نص عادي) والجديدة (مشفرة)
            if stored_pw == hashed_pw or stored_pw == password:
                # ترقية كلمة المرور القديمة إلى مشفرة تلقائياً
                if stored_pw == password and stored_pw != hashed_pw:
                    cursor.execute('UPDATE users SET password = ? WHERE id = ?', (hashed_pw, user['id']))
                # تحديث وقت آخر دخول
                cursor.execute('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', (user['id'],))
                conn.commit()
                conn.close()
                user_data = dict_from_row(user)
                user_data.pop('password', None)
                return jsonify({'success': True, 'user': user_data})

        conn.close()
        return jsonify({'success': False, 'error': 'اسم المستخدم أو كلمة المرور غير صحيحة'}), 401
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/users', methods=['GET'])
def get_users():
    """جلب جميع المستخدمين"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM users ORDER BY created_at DESC')
        users = [dict_from_row(row) for row in cursor.fetchall()]
        for u in users:
            u.pop('password', None)
        conn.close()
        return jsonify({'success': True, 'users': users})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

def ensure_user_permission_columns(cursor):
    """إضافة أعمدة الصلاحيات الجديدة إذا لم تكن موجودة"""
    new_cols = [
        'can_view_returns', 'can_view_expenses', 'can_view_suppliers', 'can_view_coupons',
        'can_view_tables', 'can_view_attendance', 'can_view_advanced_reports',
        'can_view_system_logs', 'can_view_dcf', 'can_cancel_invoices', 'can_view_branches',
        'can_view_cross_branch_stock'
    ]
    for col in new_cols:
        try:
            cursor.execute(f'ALTER TABLE users ADD COLUMN {col} INTEGER DEFAULT 0')
        except:
            pass

@app.route('/api/users', methods=['POST'])
def add_user():
    """إضافة مستخدم جديد"""
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()

        # إضافة الأعمدة الجديدة تلقائياً إذا لم تكن موجودة
        ensure_user_permission_columns(cursor)
        conn.commit()

        cursor.execute('''
            INSERT INTO users (username, password, full_name, role, invoice_prefix, branch_id,
                             can_view_products, can_add_products, can_edit_products, can_delete_products,
                             can_view_inventory, can_add_inventory, can_edit_inventory, can_delete_inventory,
                             can_view_invoices, can_delete_invoices,
                             can_view_customers, can_add_customer, can_edit_customer, can_delete_customer,
                             can_view_reports, can_view_accounting, can_manage_users, can_access_settings,
                             can_view_returns, can_view_expenses, can_view_suppliers, can_view_coupons,
                             can_view_tables, can_view_attendance, can_view_advanced_reports,
                             can_view_system_logs, can_view_dcf, can_cancel_invoices, can_view_branches,
                             can_view_cross_branch_stock)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            data.get('username'),
            hash_password(data.get('password')),
            data.get('full_name'),
            data.get('role', 'cashier'),
            data.get('invoice_prefix', ''),
            data.get('branch_id', 1),
            data.get('can_view_products', 0),
            data.get('can_add_products', 0),
            data.get('can_edit_products', 0),
            data.get('can_delete_products', 0),
            data.get('can_view_inventory', 0),
            data.get('can_add_inventory', 0),
            data.get('can_edit_inventory', 0),
            data.get('can_delete_inventory', 0),
            data.get('can_view_invoices', 1),
            data.get('can_delete_invoices', 0),
            data.get('can_view_customers', 0),
            data.get('can_add_customer', 0),
            data.get('can_edit_customer', 0),
            data.get('can_delete_customer', 0),
            data.get('can_view_reports', 0),
            data.get('can_view_accounting', 0),
            data.get('can_manage_users', 0),
            data.get('can_access_settings', 0),
            data.get('can_view_returns', 0),
            data.get('can_view_expenses', 0),
            data.get('can_view_suppliers', 0),
            data.get('can_view_coupons', 0),
            data.get('can_view_tables', 0),
            data.get('can_view_attendance', 0),
            data.get('can_view_advanced_reports', 0),
            data.get('can_view_system_logs', 0),
            data.get('can_view_dcf', 0),
            data.get('can_cancel_invoices', 0),
            data.get('can_view_branches', 0),
            data.get('can_view_cross_branch_stock', 0)
        ))
        
        user_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return jsonify({'success': True, 'id': user_id})
    except sqlite3.IntegrityError:
        return jsonify({'success': False, 'error': 'اسم المستخدم موجود مسبقاً'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/users/<int:user_id>', methods=['PUT'])
def update_user(user_id):
    """تحديث بيانات مستخدم"""
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()

        # إضافة الأعمدة الجديدة تلقائياً إذا لم تكن موجودة
        ensure_user_permission_columns(cursor)
        conn.commit()

        # بناء الاستعلام ديناميكياً
        updates = []
        params = []
        
        if 'password' in data and data['password']:
            updates.append('password = ?')
            params.append(hash_password(data['password']))
        if 'full_name' in data:
            updates.append('full_name = ?')
            params.append(data['full_name'])
        if 'role' in data:
            updates.append('role = ?')
            params.append(data['role'])
        if 'invoice_prefix' in data:
            updates.append('invoice_prefix = ?')
            params.append(data['invoice_prefix'])
        if 'branch_id' in data:
            updates.append('branch_id = ?')
            params.append(data['branch_id'])
        if 'can_view_products' in data:
            updates.append('can_view_products = ?')
            params.append(data['can_view_products'])
        if 'can_add_products' in data:
            updates.append('can_add_products = ?')
            params.append(data['can_add_products'])
        if 'can_edit_products' in data:
            updates.append('can_edit_products = ?')
            params.append(data['can_edit_products'])
        if 'can_delete_products' in data:
            updates.append('can_delete_products = ?')
            params.append(data['can_delete_products'])
        if 'can_view_inventory' in data:
            updates.append('can_view_inventory = ?')
            params.append(data['can_view_inventory'])
        if 'can_add_inventory' in data:
            updates.append('can_add_inventory = ?')
            params.append(data['can_add_inventory'])
        if 'can_edit_inventory' in data:
            updates.append('can_edit_inventory = ?')
            params.append(data['can_edit_inventory'])
        if 'can_delete_inventory' in data:
            updates.append('can_delete_inventory = ?')
            params.append(data['can_delete_inventory'])
        if 'can_view_invoices' in data:
            updates.append('can_view_invoices = ?')
            params.append(data['can_view_invoices'])
        if 'can_delete_invoices' in data:
            updates.append('can_delete_invoices = ?')
            params.append(data['can_delete_invoices'])
        if 'can_view_customers' in data:
            updates.append('can_view_customers = ?')
            params.append(data['can_view_customers'])
        if 'can_add_customer' in data:
            updates.append('can_add_customer = ?')
            params.append(data['can_add_customer'])
        if 'can_edit_customer' in data:
            updates.append('can_edit_customer = ?')
            params.append(data['can_edit_customer'])
        if 'can_delete_customer' in data:
            updates.append('can_delete_customer = ?')
            params.append(data['can_delete_customer'])
        if 'can_view_reports' in data:
            updates.append('can_view_reports = ?')
            params.append(data['can_view_reports'])
        if 'can_view_accounting' in data:
            updates.append('can_view_accounting = ?')
            params.append(data['can_view_accounting'])
        if 'can_manage_users' in data:
            updates.append('can_manage_users = ?')
            params.append(data['can_manage_users'])
        if 'can_access_settings' in data:
            updates.append('can_access_settings = ?')
            params.append(data['can_access_settings'])
        if 'can_view_returns' in data:
            updates.append('can_view_returns = ?')
            params.append(data['can_view_returns'])
        if 'can_view_expenses' in data:
            updates.append('can_view_expenses = ?')
            params.append(data['can_view_expenses'])
        if 'can_view_suppliers' in data:
            updates.append('can_view_suppliers = ?')
            params.append(data['can_view_suppliers'])
        if 'can_view_coupons' in data:
            updates.append('can_view_coupons = ?')
            params.append(data['can_view_coupons'])
        if 'can_view_tables' in data:
            updates.append('can_view_tables = ?')
            params.append(data['can_view_tables'])
        if 'can_view_attendance' in data:
            updates.append('can_view_attendance = ?')
            params.append(data['can_view_attendance'])
        if 'can_view_advanced_reports' in data:
            updates.append('can_view_advanced_reports = ?')
            params.append(data['can_view_advanced_reports'])
        if 'can_view_system_logs' in data:
            updates.append('can_view_system_logs = ?')
            params.append(data['can_view_system_logs'])
        if 'can_view_dcf' in data:
            updates.append('can_view_dcf = ?')
            params.append(data['can_view_dcf'])
        if 'can_cancel_invoices' in data:
            updates.append('can_cancel_invoices = ?')
            params.append(data['can_cancel_invoices'])
        if 'can_view_branches' in data:
            updates.append('can_view_branches = ?')
            params.append(data['can_view_branches'])
        if 'can_view_cross_branch_stock' in data:
            updates.append('can_view_cross_branch_stock = ?')
            params.append(data['can_view_cross_branch_stock'])
        if 'is_active' in data:
            updates.append('is_active = ?')
            params.append(data['is_active'])
        
        if updates:
            params.append(user_id)
            query = f"UPDATE users SET {', '.join(updates)} WHERE id = ?"
            cursor.execute(query, params)
            conn.commit()
        
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/users/<int:user_id>', methods=['DELETE'])
def delete_user(user_id):
    """حذف مستخدم"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # لا يمكن حذف المستخدم admin
        cursor.execute('SELECT role FROM users WHERE id = ?', (user_id,))
        user = cursor.fetchone()
        
        if user and dict_from_row(user)['role'] == 'admin':
            return jsonify({'success': False, 'error': 'لا يمكن حذف حساب المدير'}), 400
        
        cursor.execute('DELETE FROM users WHERE id = ?', (user_id,))
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== الصفحة الرئيسية =====
@app.route('/')
def index():
    return send_from_directory('frontend', 'index.html')

@app.route('/sw.js')
def service_worker():
    """SW يجب أن لا يُخزّن مؤقتاً أبداً"""
    response = send_from_directory('frontend', 'sw.js')
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.route('/clear-cache')
def clear_cache_page():
    """صفحة لمسح كاش المتصفح و Service Worker"""
    return '''<!DOCTYPE html>
<html dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>مسح الكاش</title>
<style>
body{font-family:Arial;background:#1a1a2e;color:white;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;}
.box{background:#16213e;padding:40px;border-radius:16px;text-align:center;max-width:500px;width:90%;box-shadow:0 10px 40px rgba(0,0,0,0.5);}
h1{color:#667eea;margin-bottom:20px;}
p{color:#aaa;margin-bottom:20px;line-height:1.8;}
.btn{padding:15px 40px;border:none;border-radius:10px;font-size:18px;font-weight:bold;cursor:pointer;margin:10px;display:inline-block;}
.btn-clear{background:#e74c3c;color:white;}
.btn-clear:hover{background:#c0392b;}
.btn-home{background:#28a745;color:white;}
.btn-home:hover{background:#218838;}
#status{margin-top:20px;padding:15px;border-radius:8px;display:none;font-size:14px;line-height:1.6;}
.success{background:#d4edda;color:#155724;display:block!important;}
.error{background:#f8d7da;color:#721c24;display:block!important;}
</style></head>
<body>
<div class="box">
<h1>🔄 مسح الكاش وتحديث النظام</h1>
<p>هذه الصفحة تمسح جميع ملفات الكاش القديمة وتحدّث النظام لآخر إصدار.</p>
<button class="btn btn-clear" onclick="clearAll()">🗑️ مسح الكاش وتحديث</button>
<div id="status"></div>
</div>
<script>
async function clearAll() {
    const status = document.getElementById('status');
    status.className = '';
    status.style.display = 'block';
    status.textContent = '⏳ جاري المسح...';
    try {
        // 1. إلغاء تسجيل جميع Service Workers
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) { await reg.unregister(); }
        status.textContent += '\\n✅ تم إلغاء Service Workers (' + regs.length + ')';
        // 2. حذف جميع الكاشات
        const keys = await caches.keys();
        for (const key of keys) { await caches.delete(key); }
        status.textContent += '\\n✅ تم حذف الكاشات (' + keys.length + ')';
        // 3. مسح localStorage
        const tenant = localStorage.getItem('pos_tenant_slug');
        const viewMode = localStorage.getItem('pos_view_mode');
        localStorage.clear();
        if (tenant) localStorage.setItem('pos_tenant_slug', tenant);
        if (viewMode) localStorage.setItem('pos_view_mode', viewMode);
        status.textContent += '\\n✅ تم مسح البيانات المؤقتة';
        status.className = 'success';
        status.textContent += '\\n\\n🎉 تم التحديث! سيتم إعادة التوجيه...';
        setTimeout(() => { window.location.href = '/'; }, 2000);
    } catch (err) {
        status.className = 'error';
        status.textContent = '❌ خطأ: ' + err.message;
    }
}
</script>
</body></html>'''

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('frontend', path)

# ===== API المنتجات =====

@app.route('/api/products', methods=['GET'])
def get_products():
    """جلب جميع المنتجات - من التوزيعات على الفروع"""
    try:
        branch_id = request.args.get('branch_id')
        conn = get_db()
        cursor = conn.cursor()

        # جلب المنتجات من branch_stock مع معلومات المنتج من inventory
        base_query = '''
            SELECT bs.id, bs.stock, bs.branch_id, bs.inventory_id, bs.variant_id,
                   i.name, i.barcode, i.category, i.price, i.cost, i.image_data,
                   pv.variant_name, pv.price as variant_price, pv.cost as variant_cost, pv.barcode as variant_barcode
            FROM branch_stock bs
            JOIN inventory i ON bs.inventory_id = i.id
            LEFT JOIN product_variants pv ON bs.variant_id = pv.id
        '''
        if branch_id == 'all':
            cursor.execute(base_query + ' ORDER BY bs.branch_id, i.name')
        elif branch_id:
            cursor.execute(base_query + ' WHERE bs.branch_id = ? ORDER BY i.name', (branch_id,))
        else:
            cursor.execute(base_query + ' WHERE bs.branch_id = ? ORDER BY i.name', (1,))

        products = []
        for row in cursor.fetchall():
            p = dict_from_row(row)
            # إذا التوزيع لخاصية معينة، استخدم اسمها وسعرها
            if p.get('variant_id') and p.get('variant_name'):
                p['display_name'] = f"{p['name']} ({p['variant_name']})"
                p['price'] = p.get('variant_price') or p['price']
                p['cost'] = p.get('variant_cost') or p['cost']
                if p.get('variant_barcode'):
                    p['barcode'] = p['variant_barcode']
            else:
                p['display_name'] = p['name']
            products.append(p)

        # جلب المتغيرات الكاملة لكل منتج (للـ POS)
        seen_inv = set()
        for p in products:
            inv_id = p.get('inventory_id')
            if inv_id and inv_id not in seen_inv:
                cursor.execute('SELECT * FROM product_variants WHERE inventory_id = ? ORDER BY id', (inv_id,))
                variants = [dict_from_row(row) for row in cursor.fetchall()]
                for pp in products:
                    if pp.get('inventory_id') == inv_id:
                        pp['variants'] = variants
                seen_inv.add(inv_id)
            elif inv_id not in seen_inv if inv_id else True:
                p['variants'] = p.get('variants', [])

        conn.close()
        return jsonify({'success': True, 'products': products})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/products', methods=['POST'])
def add_product():
    """إضافة منتج جديد"""
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO products (name, barcode, price, cost, stock, category, image_data, branch_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            data.get('name'),
            data.get('barcode'),
            data.get('price', 0),
            data.get('cost', 0),
            data.get('stock', 0),
            data.get('category', ''),
            data.get('image_data', ''),
            data.get('branch_id', 1)
        ))
        
        product_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return jsonify({'success': True, 'id': product_id})
    except sqlite3.IntegrityError:
        return jsonify({'success': False, 'error': 'الباركود موجود مسبقاً'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/products/<int:product_id>', methods=['PUT'])
def update_product(product_id):
    """تحديث منتج"""
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            UPDATE products 
            SET name=?, barcode=?, price=?, cost=?, stock=?, category=?, image_data=?, branch_id=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
        ''', (
            data.get('name'),
            data.get('barcode'),
            data.get('price'),
            data.get('cost'),
            data.get('stock'),
            data.get('category'),
            data.get('image_data'),
            data.get('branch_id', 1),
            product_id
        ))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/products/<int:product_id>', methods=['DELETE'])
def delete_product(product_id):
    """حذف منتج"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM products WHERE id=?', (product_id,))
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== API المخزون الأساسي =====

@app.route('/api/inventory', methods=['GET'])
def get_inventory():
    """جلب جميع المنتجات الأساسية مع متغيراتها"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM inventory ORDER BY name')
        inventory = [dict_from_row(row) for row in cursor.fetchall()]

        # جلب المتغيرات لكل منتج
        for item in inventory:
            cursor.execute('SELECT * FROM product_variants WHERE inventory_id = ? ORDER BY id', (item['id'],))
            item['variants'] = [dict_from_row(row) for row in cursor.fetchall()]

        conn.close()
        return jsonify({'success': True, 'inventory': inventory})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/inventory', methods=['POST'])
def add_inventory():
    """إضافة منتج أساسي للمخزون"""
    conn = None
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO inventory (name, barcode, category, price, cost, image_data)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (
            data.get('name'),
            data.get('barcode'),
            data.get('category', ''),
            data.get('price', 0),
            data.get('cost', 0),
            data.get('image_data', '')
        ))
        
        inventory_id = cursor.lastrowid
        conn.commit()
        
        return jsonify({'success': True, 'id': inventory_id})
    except sqlite3.IntegrityError:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'error': 'الباركود موجود مسبقاً'}), 400
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/inventory/<int:inventory_id>', methods=['PUT'])
def update_inventory(inventory_id):
    """تعديل منتج أساسي"""
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            UPDATE inventory 
            SET name=?, barcode=?, category=?, price=?, cost=?, image_data=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
        ''', (
            data.get('name'),
            data.get('barcode'),
            data.get('category'),
            data.get('price'),
            data.get('cost'),
            data.get('image_data'),
            inventory_id
        ))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/inventory/<int:inventory_id>', methods=['DELETE'])
def delete_inventory(inventory_id):
    """حذف منتج أساسي"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        # حذف المتغيرات والتوزيعات أولاً
        cursor.execute('DELETE FROM product_variants WHERE inventory_id=?', (inventory_id,))
        cursor.execute('DELETE FROM branch_stock WHERE inventory_id=?', (inventory_id,))
        cursor.execute('DELETE FROM inventory WHERE id=?', (inventory_id,))
        conn.commit()
        conn.close()

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== API خصائص/متغيرات المنتجات =====

@app.route('/api/inventory/<int:inventory_id>/variants', methods=['GET'])
def get_variants(inventory_id):
    """جلب متغيرات منتج"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM product_variants WHERE inventory_id = ? ORDER BY id', (inventory_id,))
        variants = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({'success': True, 'variants': variants})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/inventory/<int:inventory_id>/variants', methods=['POST'])
def save_variants(inventory_id):
    """حفظ متغيرات منتج (استبدال الكل)"""
    conn = None
    try:
        data = request.json
        variants = data.get('variants', [])
        conn = get_db()
        cursor = conn.cursor()

        # حذف المتغيرات القديمة
        cursor.execute('DELETE FROM product_variants WHERE inventory_id = ?', (inventory_id,))

        # إدراج الجديدة
        for v in variants:
            cursor.execute('''
                INSERT INTO product_variants (inventory_id, variant_name, price, cost, barcode)
                VALUES (?, ?, ?, ?, ?)
            ''', (
                inventory_id,
                v.get('variant_name', ''),
                v.get('price', 0),
                v.get('cost', 0),
                v.get('barcode', '')
            ))

        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if conn:
            conn.close()

# ===== API توزيع المخزون على الفروع =====

@app.route('/api/branch-stock', methods=['GET'])
def get_branch_stock():
    """جلب توزيع المخزون (حسب الفرع أو المنتج)"""
    try:
        branch_id = request.args.get('branch_id')
        inventory_id = request.args.get('inventory_id')
        
        conn = get_db()
        cursor = conn.cursor()
        
        query = '''
            SELECT bs.*, i.name, i.barcode, i.category, i.price, i.cost, i.image_data,
                   pv.variant_name, pv.price as variant_price, pv.cost as variant_cost, pv.barcode as variant_barcode,
                   b.name as branch_name
            FROM branch_stock bs
            JOIN inventory i ON bs.inventory_id = i.id
            LEFT JOIN product_variants pv ON bs.variant_id = pv.id
            LEFT JOIN branches b ON bs.branch_id = b.id
            WHERE 1=1
        '''
        params = []
        
        if branch_id:
            query += ' AND bs.branch_id = ?'
            params.append(branch_id)
        
        if inventory_id:
            query += ' AND bs.inventory_id = ?'
            params.append(inventory_id)
        
        query += ' ORDER BY i.name'
        
        cursor.execute(query, params)
        stock = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()
        
        return jsonify({'success': True, 'stock': stock})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/branch-stock', methods=['POST'])
def add_branch_stock():
    """توزيع منتج على فرع"""
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()

        variant_id = data.get('variant_id')

        # التحقق من وجود التوزيع (مع variant_id)
        if variant_id:
            cursor.execute('''
                SELECT id, stock FROM branch_stock
                WHERE inventory_id = ? AND branch_id = ? AND variant_id = ?
            ''', (data.get('inventory_id'), data.get('branch_id'), variant_id))
        else:
            cursor.execute('''
                SELECT id, stock FROM branch_stock
                WHERE inventory_id = ? AND branch_id = ? AND (variant_id IS NULL OR variant_id = 0)
            ''', (data.get('inventory_id'), data.get('branch_id')))

        existing = cursor.fetchone()

        if existing:
            new_stock = existing['stock'] + data.get('stock', 0)
            cursor.execute('''
                UPDATE branch_stock SET stock = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            ''', (new_stock, existing['id']))
            stock_id = existing['id']
        else:
            cursor.execute('''
                INSERT INTO branch_stock (inventory_id, branch_id, variant_id, stock)
                VALUES (?, ?, ?, ?)
            ''', (
                data.get('inventory_id'),
                data.get('branch_id'),
                variant_id,
                data.get('stock', 0)
            ))
            stock_id = cursor.lastrowid

        conn.commit()
        conn.close()

        return jsonify({'success': True, 'id': stock_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/branch-stock/<int:stock_id>', methods=['PUT'])
def update_branch_stock(stock_id):
    """تحديث كمية في فرع"""
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            UPDATE branch_stock 
            SET stock = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        ''', (data.get('stock', 0), stock_id))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/branch-stock/<int:stock_id>', methods=['DELETE'])
def delete_branch_stock(stock_id):
    """حذف توزيع من فرع"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM branch_stock WHERE id = ?', (stock_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/products/search', methods=['GET'])
def search_products():
    """البحث عن منتج بالاسم أو الباركود - من branch_stock مع فلترة بالفرع"""
    try:
        query = request.args.get('q', '')
        branch_id = request.args.get('branch_id')
        conn = get_db()
        cursor = conn.cursor()

        base_query = '''
            SELECT bs.id, bs.stock, bs.branch_id, bs.inventory_id, bs.variant_id,
                   i.name, i.barcode, i.category, i.price, i.cost, i.image_data,
                   pv.variant_name, pv.price as variant_price, pv.cost as variant_cost, pv.barcode as variant_barcode
            FROM branch_stock bs
            JOIN inventory i ON bs.inventory_id = i.id
            LEFT JOIN product_variants pv ON bs.variant_id = pv.id
            WHERE (i.name LIKE ? OR i.barcode LIKE ? OR pv.barcode LIKE ? OR pv.variant_name LIKE ?)
        '''
        params = [f'%{query}%', f'%{query}%', f'%{query}%', f'%{query}%']

        if branch_id and branch_id != 'all':
            base_query += ' AND bs.branch_id = ?'
            params.append(branch_id)

        base_query += ' ORDER BY i.name LIMIT 20'

        cursor.execute(base_query, params)

        products = []
        for row in cursor.fetchall():
            p = dict_from_row(row)
            if p.get('variant_id') and p.get('variant_name'):
                p['display_name'] = f"{p['name']} ({p['variant_name']})"
                p['price'] = p.get('variant_price') or p['price']
                p['cost'] = p.get('variant_cost') or p['cost']
                if p.get('variant_barcode'):
                    p['barcode'] = p['variant_barcode']
            else:
                p['display_name'] = p['name']
            products.append(p)

        conn.close()

        return jsonify({'success': True, 'products': products})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== API الفواتير =====

@app.route('/api/invoices', methods=['GET'])
def get_invoices():
    """جلب الفواتير مع إمكانية التصفية"""
    try:
        # معاملات البحث
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        limit = request.args.get('limit', 100, type=int)
        
        conn = get_db()
        cursor = conn.cursor()
        
        query = 'SELECT * FROM invoices WHERE 1=1'
        params = []
        
        if start_date:
            query += ' AND date(created_at) >= ?'
            params.append(start_date)
        
        if end_date:
            query += ' AND date(created_at) <= ?'
            params.append(end_date)
        
        query += ' ORDER BY created_at DESC LIMIT ?'
        params.append(limit)
        
        cursor.execute(query, params)
        invoices = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()
        
        return jsonify({'success': True, 'invoices': invoices})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/invoices/<int:invoice_id>', methods=['GET'])
def get_invoice(invoice_id):
    """جلب فاتورة محددة مع عناصرها"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # جلب الفاتورة
        cursor.execute('SELECT * FROM invoices WHERE id=?', (invoice_id,))
        invoice_row = cursor.fetchone()
        
        if not invoice_row:
            return jsonify({'success': False, 'error': 'الفاتورة غير موجودة'}), 404
        
        invoice = dict_from_row(invoice_row)
        
        # جلب عناصر الفاتورة
        cursor.execute('SELECT * FROM invoice_items WHERE invoice_id=?', (invoice_id,))
        items = [dict_from_row(row) for row in cursor.fetchall()]
        
        invoice['items'] = items
        conn.close()
        
        return jsonify({'success': True, 'invoice': invoice})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/invoices/clear-all', methods=['DELETE'])
def clear_all_invoices():
    """حذف جميع الفواتير (Admin فقط)"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # حذف عناصر الفواتير أولاً
        cursor.execute('DELETE FROM invoice_items')
        
        # حذف الفواتير
        cursor.execute('DELETE FROM invoices')
        
        conn.commit()
        deleted_count = cursor.rowcount
        conn.close()
        
        return jsonify({'success': True, 'deleted': deleted_count})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/invoices', methods=['POST'])
def create_invoice():
    """إنشاء فاتورة جديدة"""
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        
        # الحصول على اسم الفرع
        branch_id = data.get('branch_id', 1)
        cursor.execute('SELECT name FROM branches WHERE id = ?', (branch_id,))
        branch = cursor.fetchone()
        branch_name = branch['name'] if branch else 'الفرع الرئيسي'
        
        # تعديل رقم الفاتورة ليشمل رقم الفرع (مثل: AHM-001-B1)
        original_invoice_number = data.get('invoice_number', '')
        invoice_number_with_branch = f"{original_invoice_number}-B{branch_id}"
        
        # إدراج الفاتورة
        cursor.execute('''
            INSERT INTO invoices
            (invoice_number, customer_id, customer_name, customer_phone, customer_address,
             subtotal, discount, total, payment_method, employee_name, notes, transaction_number, branch_name, delivery_fee,
             coupon_discount, coupon_code, loyalty_discount, loyalty_points_earned, loyalty_points_redeemed,
             table_id, table_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            invoice_number_with_branch,
            data.get('customer_id'),
            data.get('customer_name', ''),
            data.get('customer_phone', ''),
            data.get('customer_address', ''),
            data.get('subtotal', 0),
            data.get('discount', 0),
            data.get('total', 0),
            data.get('payment_method', 'نقداً'),
            data.get('employee_name', ''),
            data.get('notes', ''),
            data.get('transaction_number', ''),
            branch_name,
            data.get('delivery_fee', 0),
            data.get('coupon_discount', 0),
            data.get('coupon_code', ''),
            data.get('loyalty_discount', 0),
            data.get('loyalty_points_earned', 0),
            data.get('loyalty_points_redeemed', 0),
            data.get('table_id'),
            data.get('table_name', '')
        ))

        invoice_id = cursor.lastrowid

        # ربط الطاولة بالفاتورة
        table_id = data.get('table_id')
        if table_id:
            cursor.execute('UPDATE restaurant_tables SET status = ?, current_invoice_id = ? WHERE id = ?',
                           ('occupied', invoice_id, table_id))

        # إدراج عناصر الفاتورة وتحديث المخزون
        for item in data.get('items', []):
            # الحصول على branch_stock_id
            branch_stock_id = item.get('branch_stock_id') or item.get('product_id')
            
            cursor.execute('''
                INSERT INTO invoice_items
                (invoice_id, product_id, product_name, quantity, price, total, branch_stock_id, variant_id, variant_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                invoice_id,
                item.get('product_id'),
                item.get('product_name'),
                item.get('quantity'),
                item.get('price'),
                item.get('total'),
                branch_stock_id,
                item.get('variant_id'),
                item.get('variant_name')
            ))
            
            # تحديث المخزون في branch_stock
            if branch_stock_id:
                cursor.execute('''
                    UPDATE branch_stock 
                    SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                ''', (item.get('quantity'), branch_stock_id))
        
        # حفظ عمليات الدفع المتعددة كـ JSON
        payments = data.get('payments', [])
        if payments:
            import json as json_mod
            payments_json = json_mod.dumps(payments, ensure_ascii=False)
            cursor.execute('UPDATE invoices SET transaction_number = ? WHERE id = ?', (payments_json, invoice_id))

        # تحديث نقاط الولاء للعميل
        customer_id = data.get('customer_id')
        if customer_id:
            points_earned = data.get('loyalty_points_earned', 0)
            points_redeemed = data.get('loyalty_points_redeemed', 0)
            net_points = points_earned - points_redeemed
            if net_points != 0:
                cursor.execute('''
                    UPDATE customers SET loyalty_points = MAX(0, COALESCE(loyalty_points, 0) + ?)
                    WHERE id = ?
                ''', (net_points, customer_id))

        conn.commit()
        conn.close()

        return jsonify({'success': True, 'id': invoice_id, 'invoice_number': invoice_number_with_branch})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/invoices/<int:invoice_id>/status', methods=['PUT'])
def update_invoice_status(invoice_id):
    """تحديث حالة الطلب"""
    try:
        data = request.json
        new_status = data.get('order_status')

        valid_statuses = ['قيد التنفيذ', 'قيد التوصيل', 'منجز']
        if new_status not in valid_statuses:
            return jsonify({'success': False, 'error': 'حالة غير صالحة'}), 400

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('UPDATE invoices SET order_status = ? WHERE id = ?', (new_status, invoice_id))
        conn.commit()
        conn.close()

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/invoices/<int:invoice_id>/cancel', methods=['PUT'])
def cancel_invoice(invoice_id):
    """إلغاء فاتورة مع إرجاع المخزون"""
    try:
        data = request.json
        cancel_reason = data.get('reason', '')
        return_stock = data.get('return_stock', False)

        if not cancel_reason:
            return jsonify({'success': False, 'error': 'يجب تحديد سبب الإلغاء'}), 400

        conn = get_db()
        cursor = conn.cursor()

        # إضافة الأعمدة إذا لم تكن موجودة
        for col_sql in [
            "ALTER TABLE invoices ADD COLUMN cancelled INTEGER DEFAULT 0",
            "ALTER TABLE invoices ADD COLUMN cancel_reason TEXT",
            "ALTER TABLE invoices ADD COLUMN cancelled_at TIMESTAMP",
            "ALTER TABLE invoices ADD COLUMN stock_returned INTEGER DEFAULT 0"
        ]:
            try:
                cursor.execute(col_sql)
                conn.commit()
            except:
                pass

        # التحقق من الفاتورة
        cursor.execute('SELECT * FROM invoices WHERE id = ?', (invoice_id,))
        invoice = cursor.fetchone()
        if not invoice:
            conn.close()
            return jsonify({'success': False, 'error': 'الفاتورة غير موجودة'}), 404

        inv = dict_from_row(invoice)
        if inv.get('cancelled'):
            conn.close()
            return jsonify({'success': False, 'error': 'الفاتورة ملغية مسبقاً'}), 400

        # إرجاع المخزون إذا مطلوب
        stock_returned = 0
        if return_stock:
            cursor.execute('SELECT * FROM invoice_items WHERE invoice_id = ?', (invoice_id,))
            items = cursor.fetchall()
            for item in items:
                bsid = item['branch_stock_id']
                qty = item['quantity']
                if bsid and qty:
                    cursor.execute('''
                        UPDATE branch_stock
                        SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    ''', (qty, bsid))
            stock_returned = 1

        # تحديث الفاتورة
        cursor.execute('''
            UPDATE invoices
            SET cancelled = 1, cancel_reason = ?, cancelled_at = CURRENT_TIMESTAMP,
                stock_returned = ?, order_status = 'ملغية'
            WHERE id = ?
        ''', (cancel_reason, stock_returned, invoice_id))

        # إرجاع نقاط الولاء للعميل
        customer_id = inv.get('customer_id')
        if customer_id:
            points_earned = inv.get('loyalty_points_earned') or 0
            points_redeemed = inv.get('loyalty_points_redeemed') or 0
            net_reverse = points_redeemed - points_earned
            if net_reverse != 0:
                cursor.execute('''
                    UPDATE customers SET loyalty_points = MAX(0, COALESCE(loyalty_points, 0) + ?)
                    WHERE id = ?
                ''', (net_reverse, customer_id))

        conn.commit()
        conn.close()

        return jsonify({'success': True, 'stock_returned': bool(stock_returned)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== API التالف =====

@app.route('/api/damaged-items', methods=['GET'])
def get_damaged_items():
    """جلب التالف"""
    try:
        branch_id = request.args.get('branch_id')
        conn = get_db()
        cursor = conn.cursor()
        
        query = '''
            SELECT d.*, i.name as product_name, b.name as branch_name
            FROM damaged_items d
            JOIN inventory i ON d.inventory_id = i.id
            LEFT JOIN branches b ON d.branch_id = b.id
            WHERE 1=1
        '''
        params = []
        
        if branch_id:
            query += ' AND d.branch_id = ?'
            params.append(branch_id)
        
        query += ' ORDER BY d.created_at DESC'
        
        cursor.execute(query, params)
        damaged = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()
        
        return jsonify({'success': True, 'damaged': damaged})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/damaged-items', methods=['POST'])
def add_damaged_item():
    """إضافة تالف"""
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        
        # إضافة التالف
        cursor.execute('''
            INSERT INTO damaged_items 
            (inventory_id, branch_id, quantity, reason, reported_by)
            VALUES (?, ?, ?, ?, ?)
        ''', (
            data.get('inventory_id'),
            data.get('branch_id'),
            data.get('quantity'),
            data.get('reason', ''),
            data.get('reported_by')
        ))
        
        # تحديث المخزون (خصم التالف)
        cursor.execute('''
            UPDATE branch_stock 
            SET stock = stock - ?
            WHERE inventory_id = ? AND branch_id = ?
        ''', (
            data.get('quantity'),
            data.get('inventory_id'),
            data.get('branch_id')
        ))
        
        damaged_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return jsonify({'success': True, 'id': damaged_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/damaged-items/<int:damaged_id>', methods=['DELETE'])
def delete_damaged_item(damaged_id):
    """حذف تالف"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM damaged_items WHERE id = ?', (damaged_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/system-logs', methods=['GET'])
def get_system_logs():
    """جلب سجل النظام"""
    try:
        limit = request.args.get('limit', 100)
        action_type = request.args.get('action_type')
        user_id = request.args.get('user_id')
        
        conn = get_db()
        cursor = conn.cursor()
        
        query = 'SELECT * FROM system_logs WHERE 1=1'
        params = []
        
        if action_type:
            query += ' AND action_type = ?'
            params.append(action_type)
        
        if user_id:
            query += ' AND user_id = ?'
            params.append(user_id)
        
        query += ' ORDER BY created_at DESC LIMIT ?'
        params.append(limit)
        
        cursor.execute(query, params)
        logs = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()
        
        return jsonify({'success': True, 'logs': logs})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/system-logs', methods=['POST'])
def add_system_log():
    """إضافة سجل"""
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO system_logs 
            (action_type, description, user_id, user_name, branch_id, target_id, details)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            data.get('action_type'),
            data.get('description'),
            data.get('user_id'),
            data.get('user_name'),
            data.get('branch_id'),
            data.get('target_id'),
            data.get('details')
        ))
        
        log_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return jsonify({'success': True, 'id': log_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== API التقارير =====

@app.route('/api/reports/sales', methods=['GET'])
def sales_report():
    """تقرير المبيعات خلال فترة"""
    try:
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        branch_id = request.args.get('branch_id')
        
        conn = get_db()
        cursor = conn.cursor()
        
        # الإحصائيات العامة
        query = '''
            SELECT 
                COUNT(*) as total_invoices,
                SUM(subtotal) as total_subtotal,
                SUM(discount) as total_discount,
                SUM(delivery_fee) as total_delivery,
                SUM(total) as total_sales,
                AVG(total) as average_sale
            FROM invoices
            WHERE 1=1
        '''
        params = []
        
        if start_date:
            query += ' AND date(created_at) >= ?'
            params.append(start_date)
        
        if end_date:
            query += ' AND date(created_at) <= ?'
            params.append(end_date)
        
        if branch_id:
            # البحث بـ branch_id أو branch_name
            try:
                # استخدام cursor منفصل للبحث عن الفرع
                temp_cursor = conn.cursor()
                temp_cursor.execute('SELECT name FROM branches WHERE id = ?', (branch_id,))
                branch = temp_cursor.fetchone()
                if branch:
                    query += ' AND branch_name = ?'
                    params.append(branch['name'])
                else:
                    query += ' AND branch_name LIKE ?'
                    params.append(f'%{branch_id}%')
            except:
                # إذا فشل، استخدم LIKE
                query += ' AND branch_name LIKE ?'
                params.append(f'%{branch_id}%')
        
        cursor.execute(query, params)
        report = dict_from_row(cursor.fetchone())
        
        # تقرير حسب طريقة الدفع
        query_payment = '''
            SELECT payment_method, COUNT(*) as count, SUM(total) as total
            FROM invoices
            WHERE 1=1
        '''
        
        if start_date:
            query_payment += ' AND date(created_at) >= ?'
        if end_date:
            query_payment += ' AND date(created_at) <= ?'
        if branch_id:
            query_payment += ' AND branch_name LIKE ?'
        
        query_payment += ' GROUP BY payment_method'
        
        cursor.execute(query_payment, params)
        payment_methods = [dict_from_row(row) for row in cursor.fetchall()]
        
        # تقرير حسب الفرع
        query_branch = '''
            SELECT branch_name, COUNT(*) as count, SUM(total) as total
            FROM invoices
            WHERE branch_name IS NOT NULL
        '''
        
        if start_date:
            query_branch += ' AND date(created_at) >= ?'
        if end_date:
            query_branch += ' AND date(created_at) <= ?'
        if branch_id:
            query_branch += ' AND branch_name LIKE ?'
        
        query_branch += ' GROUP BY branch_name'
        
        cursor.execute(query_branch, params)
        branches = [dict_from_row(row) for row in cursor.fetchall()]
        
        # جلب الفواتير
        query_invoices = '''
            SELECT * FROM invoices
            WHERE 1=1
        '''
        
        if start_date:
            query_invoices += ' AND date(created_at) >= ?'
        if end_date:
            query_invoices += ' AND date(created_at) <= ?'
        if branch_id:
            query_invoices += ' AND branch_name LIKE ?'
        
        query_invoices += ' ORDER BY created_at DESC'
        
        cursor.execute(query_invoices, params)
        invoices = [dict_from_row(row) for row in cursor.fetchall()]
        
        report['payment_methods'] = payment_methods
        report['branches'] = branches
        report['invoices'] = invoices
        
        conn.close()
        
        return jsonify({'success': True, 'report': report})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/reports/inventory', methods=['GET'])
def inventory_report():
    """تقرير المخزون"""
    try:
        branch_id = request.args.get('branch_id')
        
        conn = get_db()
        cursor = conn.cursor()
        
        # جلب المخزون مع الحسابات
        query = '''
            SELECT 
                i.id,
                i.name,
                i.barcode,
                i.category,
                i.price,
                i.cost,
                bs.branch_id,
                b.name as branch_name,
                bs.stock,
                (bs.stock * i.cost) as stock_value
            FROM inventory i
            LEFT JOIN branch_stock bs ON i.id = bs.inventory_id
            LEFT JOIN branches b ON bs.branch_id = b.id
            WHERE 1=1
        '''
        params = []
        
        if branch_id:
            query += ' AND bs.branch_id = ?'
            params.append(branch_id)
        
        query += ' ORDER BY i.name'
        
        cursor.execute(query, params)
        items = [dict_from_row(row) for row in cursor.fetchall()]
        
        # الإحصائيات
        total_items = len(items)
        total_stock = sum(item['stock'] or 0 for item in items)
        total_value = sum(item['stock_value'] or 0 for item in items)
        
        conn.close()
        
        return jsonify({
            'success': True,
            'report': {
                'total_items': total_items,
                'total_stock': total_stock,
                'total_value': total_value,
                'items': items
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/reports/damaged', methods=['GET'])
def damaged_report():
    """تقرير التالف خلال فترة"""
    try:
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        branch_id = request.args.get('branch_id')
        
        conn = get_db()
        cursor = conn.cursor()
        
        query = '''
            SELECT 
                d.*,
                i.name as product_name,
                i.cost,
                (d.quantity * i.cost) as damage_value,
                b.name as branch_name
            FROM damaged_items d
            JOIN inventory i ON d.inventory_id = i.id
            LEFT JOIN branches b ON d.branch_id = b.id
            WHERE 1=1
        '''
        params = []
        
        if start_date:
            query += ' AND date(d.created_at) >= ?'
            params.append(start_date)
        
        if end_date:
            query += ' AND date(d.created_at) <= ?'
            params.append(end_date)
        
        if branch_id:
            query += ' AND d.branch_id = ?'
            params.append(branch_id)
        
        query += ' ORDER BY d.created_at DESC'
        
        cursor.execute(query, params)
        damaged = [dict_from_row(row) for row in cursor.fetchall()]
        
        # الإحصائيات
        total_damaged = sum(item['quantity'] for item in damaged)
        total_value = sum(item['damage_value'] or 0 for item in damaged)
        
        conn.close()
        
        return jsonify({
            'success': True,
            'report': {
                'total_damaged': total_damaged,
                'total_value': total_value,
                'items': damaged
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
        conn.close()
        
        return jsonify({'success': True, 'report': report})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/reports/top-products', methods=['GET'])
def top_products_report():
    """تقرير المنتجات الأكثر مبيعاً"""
    try:
        limit = request.args.get('limit', 10, type=int)
        
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT 
                product_name,
                SUM(quantity) as total_quantity,
                SUM(total) as total_sales,
                COUNT(DISTINCT invoice_id) as times_sold
            FROM invoice_items
            GROUP BY product_name
            ORDER BY total_quantity DESC
            LIMIT ?
        ''', (limit,))
        
        products = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()
        
        return jsonify({'success': True, 'products': products})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/reports/low-stock', methods=['GET'])
def low_stock_report():
    """تقرير المنتجات منخفضة المخزون"""
    try:
        threshold = request.args.get('threshold', 10, type=int)
        
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM products 
            WHERE stock <= ?
            ORDER BY stock ASC
        ''', (threshold,))
        
        products = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()
        
        return jsonify({'success': True, 'products': products})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== API الإعدادات =====

@app.route('/api/settings', methods=['GET'])
def get_settings():
    """جلب جميع الإعدادات"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM settings')
        settings = {row['key']: row['value'] for row in cursor.fetchall()}
        conn.close()
        return jsonify({'success': True, 'settings': settings})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/settings', methods=['PUT'])
def update_settings():
    """تحديث الإعدادات"""
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        
        for key, value in data.items():
            cursor.execute('''
                INSERT OR REPLACE INTO settings (key, value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            ''', (key, value))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== API الفروع =====

@app.route('/api/branches', methods=['GET'])
def get_branches():
    """جلب كل الفروع"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM branches WHERE is_active = 1 ORDER BY name')
        branches = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({'success': True, 'branches': branches})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/branches', methods=['POST'])
def add_branch():
    """إضافة فرع جديد"""
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO branches (name, location, phone)
            VALUES (?, ?, ?)
        ''', (data.get('name'), data.get('location', ''), data.get('phone', '')))
        branch_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'id': branch_id})
    except sqlite3.IntegrityError:
        return jsonify({'success': False, 'error': 'اسم الفرع موجود مسبقاً'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/branches/<int:branch_id>', methods=['PUT'])
def update_branch(branch_id):
    """تحديث فرع"""
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        updates = []
        params = []
        
        if 'name' in data:
            updates.append('name = ?')
            params.append(data['name'])
        if 'location' in data:
            updates.append('location = ?')
            params.append(data['location'])
        if 'phone' in data:
            updates.append('phone = ?')
            params.append(data['phone'])
        if 'is_active' in data:
            updates.append('is_active = ?')
            params.append(data['is_active'])
        
        if updates:
            params.append(branch_id)
            query = f"UPDATE branches SET {', '.join(updates)} WHERE id = ?"
            cursor.execute(query, params)
            conn.commit()
        
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/branches/<int:branch_id>', methods=['DELETE'])
def delete_branch(branch_id):
    """حذف فرع (soft delete)"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('UPDATE branches SET is_active = 0 WHERE id = ?', (branch_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== API سجل الحضور =====

@app.route('/api/attendance/check-in', methods=['POST'])
def check_in():
    """تسجيل حضور"""
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO attendance_log (user_id, user_name, branch_id, check_in)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ''', (data.get('user_id'), data.get('user_name'), data.get('branch_id', 1)))
        attendance_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'id': attendance_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/attendance/check-out', methods=['POST'])
def check_out():
    """تسجيل انصراف"""
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        # البحث عن آخر سجل حضور بدون انصراف
        cursor.execute('''
            SELECT id FROM attendance_log
            WHERE user_id = ? AND check_out IS NULL
            ORDER BY check_in DESC LIMIT 1
        ''', (data.get('user_id'),))
        record = cursor.fetchone()
        
        if record:
            cursor.execute('''
                UPDATE attendance_log SET check_out = CURRENT_TIMESTAMP
                WHERE id = ?
            ''', (record['id'],))
            conn.commit()
            conn.close()
            return jsonify({'success': True})
        else:
            conn.close()
            return jsonify({'success': False, 'error': 'لا يوجد سجل حضور'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/attendance', methods=['GET'])
def get_attendance():
    """جلب سجل الحضور مع الفلترة"""
    try:
        user_id = request.args.get('user_id')
        date = request.args.get('date')
        branch_id = request.args.get('branch_id')
        
        conn = get_db()
        cursor = conn.cursor()
        
        query = 'SELECT * FROM attendance_log WHERE 1=1'
        params = []
        
        if user_id:
            query += ' AND user_id = ?'
            params.append(user_id)
        
        if date:
            query += ' AND DATE(check_in) = ?'
            params.append(date)
        
        if branch_id:
            query += ' AND branch_id = ?'
            params.append(branch_id)
        
        query += ' ORDER BY check_in DESC'
        
        cursor.execute(query, params)
        records = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({'success': True, 'records': records})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== API العملاء (CRM) =====

@app.route('/api/customers', methods=['GET'])
def get_customers():
    """جلب جميع العملاء"""
    try:
        search = request.args.get('search', '')
        conn = get_db()
        cursor = conn.cursor()
        
        if search:
            cursor.execute('''
                SELECT *, 
                       (SELECT COUNT(*) FROM invoices WHERE customer_id = customers.id) as total_orders,
                       (SELECT SUM(total) FROM invoices WHERE customer_id = customers.id) as total_spent
                FROM customers 
                WHERE name LIKE ? OR phone LIKE ? OR address LIKE ?
                ORDER BY created_at DESC
            ''', (f'%{search}%', f'%{search}%', f'%{search}%'))
        else:
            cursor.execute('''
                SELECT *, 
                       (SELECT COUNT(*) FROM invoices WHERE customer_id = customers.id) as total_orders,
                       (SELECT SUM(total) FROM invoices WHERE customer_id = customers.id) as total_spent
                FROM customers 
                ORDER BY created_at DESC
            ''')
        
        customers = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()
        
        return jsonify({'success': True, 'customers': customers})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/customers/<int:customer_id>', methods=['GET'])
def get_customer(customer_id):
    """جلب بيانات عميل محدد"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT *,
                   (SELECT COUNT(*) FROM invoices WHERE customer_id = customers.id) as total_orders,
                   (SELECT SUM(total) FROM invoices WHERE customer_id = customers.id) as total_spent
            FROM customers WHERE id = ?
        ''', (customer_id,))
        row = cursor.fetchone()
        conn.close()

        if row:
            return jsonify({'success': True, 'customer': dict_from_row(row)})
        else:
            return jsonify({'success': False, 'error': 'العميل غير موجود'}), 404
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/customers/search', methods=['GET'])
def search_customer():
    """البحث عن عميل بالهاتف"""
    try:
        phone = request.args.get('phone', '')
        if not phone:
            return jsonify({'success': False, 'error': 'رقم الهاتف مطلوب'}), 400
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT *,
                   COALESCE(loyalty_points, 0) as points,
                   (SELECT COUNT(*) FROM invoices WHERE customer_id = customers.id) as total_orders,
                   (SELECT SUM(total) FROM invoices WHERE customer_id = customers.id) as total_spent
            FROM customers WHERE phone = ?
        ''', (phone,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return jsonify({'success': True, 'customer': dict_from_row(row)})
        else:
            return jsonify({'success': False, 'error': 'العميل غير موجود'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/customers/<int:customer_id>/points/adjust', methods=['POST'])
def adjust_customer_points(customer_id):
    """تعديل نقاط الولاء للعميل"""
    try:
        data = request.json
        points = data.get('points', 0)
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE customers SET loyalty_points = MAX(0, COALESCE(loyalty_points, 0) + ?)
            WHERE id = ?
        ''', (points, customer_id))
        conn.commit()
        cursor.execute('SELECT COALESCE(loyalty_points, 0) as loyalty_points FROM customers WHERE id = ?', (customer_id,))
        row = cursor.fetchone()
        conn.close()
        return jsonify({'success': True, 'new_points': row['loyalty_points'] if row else 0})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/customers', methods=['POST'])
def add_customer():
    """إضافة أو تحديث عميل"""
    conn = None
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        
        # البحث عن عميل موجود بنفس الهاتف
        phone = data.get('phone', '')
        if phone:
            cursor.execute('SELECT id FROM customers WHERE phone = ?', (phone,))
            existing = cursor.fetchone()
            
            if existing:
                # تحديث العميل الموجود
                cursor.execute('''
                    UPDATE customers 
                    SET name = ?, address = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                ''', (
                    data.get('name', ''),
                    data.get('address', ''),
                    data.get('notes', ''),
                    existing['id']
                ))
                conn.commit()
                return jsonify({'success': True, 'id': existing['id'], 'updated': True})
        
        # إضافة عميل جديد
        cursor.execute('''
            INSERT INTO customers (name, phone, address, notes)
            VALUES (?, ?, ?, ?)
        ''', (
            data.get('name', ''),
            data.get('phone', ''),
            data.get('address', ''),
            data.get('notes', '')
        ))
        
        customer_id = cursor.lastrowid
        conn.commit()
        
        return jsonify({'success': True, 'id': customer_id})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/customers/<int:customer_id>', methods=['PUT'])
def update_customer(customer_id):
    """تحديث بيانات عميل"""
    conn = None
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            UPDATE customers 
            SET name = ?, phone = ?, address = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        ''', (
            data.get('name', ''),
            data.get('phone', ''),
            data.get('address', ''),
            data.get('notes', ''),
            customer_id
        ))
        
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/customers/<int:customer_id>', methods=['DELETE'])
def delete_customer(customer_id):
    """حذف عميل"""
    conn = None
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM customers WHERE id = ?', (customer_id,))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/customers/<int:customer_id>/invoices', methods=['GET'])
def get_customer_invoices(customer_id):
    """جلب فواتير عميل محدد"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM invoices 
            WHERE customer_id = ?
            ORDER BY created_at DESC
        ''', (customer_id,))
        
        invoices = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()
        
        return jsonify({'success': True, 'invoices': invoices})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== API التكاليف =====

@app.route('/api/expenses', methods=['GET'])
def get_expenses():
    """جلب التكاليف"""
    try:
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        branch_id = request.args.get('branch_id')

        conn = get_db()
        cursor = conn.cursor()

        query = 'SELECT * FROM expenses WHERE 1=1'
        params = []

        if start_date:
            query += ' AND date(expense_date) >= ?'
            params.append(start_date)
        if end_date:
            query += ' AND date(expense_date) <= ?'
            params.append(end_date)
        if branch_id:
            query += ' AND branch_id = ?'
            params.append(branch_id)

        query += ' ORDER BY expense_date DESC'

        cursor.execute(query, params)
        expenses = [dict_from_row(row) for row in cursor.fetchall()]

        # جلب تفاصيل الرواتب لكل تكلفة نوعها رواتب
        for exp in expenses:
            if exp['expense_type'] == 'رواتب':
                cursor.execute('SELECT * FROM salary_details WHERE expense_id = ? ORDER BY id', (exp['id'],))
                exp['salary_details'] = [dict_from_row(row) for row in cursor.fetchall()]
            else:
                exp['salary_details'] = []

        conn.close()

        return jsonify({'success': True, 'expenses': expenses})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/expenses', methods=['POST'])
def add_expense():
    """إضافة تكلفة"""
    conn = None
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()

        cursor.execute('''
            INSERT INTO expenses (expense_type, amount, description, expense_date, branch_id, created_by)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (
            data.get('expense_type'),
            data.get('amount'),
            data.get('description', ''),
            data.get('expense_date'),
            data.get('branch_id'),
            data.get('created_by')
        ))

        expense_id = cursor.lastrowid

        # حفظ تفاصيل الرواتب إذا كان النوع رواتب
        salary_details = data.get('salary_details', [])
        if data.get('expense_type') == 'رواتب' and salary_details:
            for emp in salary_details:
                cursor.execute('''
                    INSERT INTO salary_details (expense_id, employee_name, monthly_salary)
                    VALUES (?, ?, ?)
                ''', (expense_id, emp.get('employee_name', ''), emp.get('monthly_salary', 0)))

        conn.commit()

        return jsonify({'success': True, 'id': expense_id})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/expenses/<int:expense_id>', methods=['DELETE'])
def delete_expense(expense_id):
    """حذف تكلفة"""
    conn = None
    try:
        conn = get_db()
        cursor = conn.cursor()
        # حذف تفاصيل الرواتب المرتبطة
        cursor.execute('DELETE FROM salary_details WHERE expense_id = ?', (expense_id,))
        cursor.execute('DELETE FROM expenses WHERE id = ?', (expense_id,))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if conn:
            conn.close()

# ===== التقارير المتقدمة =====

@app.route('/api/reports/sales-by-product', methods=['GET'])
def sales_by_product():
    """تقرير المبيعات حسب المنتج"""
    try:
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        branch_id = request.args.get('branch_id')
        
        conn = get_db()
        cursor = conn.cursor()
        
        query = '''
            SELECT 
                ii.product_name,
                SUM(ii.quantity) as total_quantity,
                SUM(ii.total) as total_sales,
                COUNT(DISTINCT ii.invoice_id) as invoice_count,
                AVG(ii.price) as avg_price
            FROM invoice_items ii
            JOIN invoices i ON ii.invoice_id = i.id
            WHERE 1=1
        '''
        params = []
        
        if start_date:
            query += ' AND date(i.created_at) >= ?'
            params.append(start_date)
        if end_date:
            query += ' AND date(i.created_at) <= ?'
            params.append(end_date)
        if branch_id:
            cursor.execute('SELECT name FROM branches WHERE id = ?', (branch_id,))
            branch = cursor.fetchone()
            if branch:
                query += ' AND i.branch_name = ?'
                params.append(branch['name'])
        
        query += ' GROUP BY ii.product_name ORDER BY total_sales DESC'
        
        cursor.execute(query, params)
        products = [dict_from_row(row) for row in cursor.fetchall()]
        
        # إحصائيات إجمالية
        total_sales = sum(p['total_sales'] for p in products)
        total_quantity = sum(p['total_quantity'] for p in products)
        
        conn.close()
        
        return jsonify({
            'success': True,
            'products': products,
            'summary': {
                'total_sales': total_sales,
                'total_quantity': total_quantity,
                'products_count': len(products)
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/reports/sales-by-branch', methods=['GET'])
def sales_by_branch():
    """تقرير المبيعات حسب الفرع"""
    try:
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        conn = get_db()
        cursor = conn.cursor()
        
        query = '''
            SELECT 
                branch_name,
                COUNT(*) as invoice_count,
                SUM(subtotal) as total_subtotal,
                SUM(discount) as total_discount,
                SUM(delivery_fee) as total_delivery,
                SUM(total) as total_sales,
                AVG(total) as avg_sale
            FROM invoices
            WHERE 1=1
        '''
        params = []
        
        if start_date:
            query += ' AND date(created_at) >= ?'
            params.append(start_date)
        if end_date:
            query += ' AND date(created_at) <= ?'
            params.append(end_date)
        
        query += ' GROUP BY branch_name ORDER BY total_sales DESC'
        
        cursor.execute(query, params)
        branches = [dict_from_row(row) for row in cursor.fetchall()]
        
        # إحصائيات إجمالية
        total_sales = sum(b['total_sales'] for b in branches)
        total_invoices = sum(b['invoice_count'] for b in branches)
        
        conn.close()
        
        return jsonify({
            'success': True,
            'branches': branches,
            'summary': {
                'total_sales': total_sales,
                'total_invoices': total_invoices,
                'branches_count': len(branches)
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/reports/profit-loss', methods=['GET'])
def profit_loss():
    """تقرير الربح والخسارة"""
    try:
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        branch_id = request.args.get('branch_id')
        
        conn = get_db()
        cursor = conn.cursor()
        
        # حساب المبيعات
        sales_query = 'SELECT SUM(total) as total_sales, SUM(subtotal) as subtotal FROM invoices WHERE 1=1'
        sales_params = []
        
        if start_date:
            sales_query += ' AND date(created_at) >= ?'
            sales_params.append(start_date)
        if end_date:
            sales_query += ' AND date(created_at) <= ?'
            sales_params.append(end_date)
        if branch_id:
            cursor.execute('SELECT name FROM branches WHERE id = ?', (branch_id,))
            branch = cursor.fetchone()
            if branch:
                sales_query += ' AND branch_name = ?'
                sales_params.append(branch['name'])
        
        cursor.execute(sales_query, sales_params)
        sales_data = dict_from_row(cursor.fetchone())
        total_revenue = sales_data['total_sales'] or 0
        
        # حساب تكلفة البضاعة المباعة (COGS)
        cogs_query = '''
            SELECT SUM(ii.quantity * COALESCE(inv.cost, 0)) as total_cogs
            FROM invoice_items ii
            LEFT JOIN inventory inv ON ii.product_name = inv.name
            JOIN invoices i ON ii.invoice_id = i.id
            WHERE 1=1
        '''
        cogs_params = []
        
        if start_date:
            cogs_query += ' AND date(i.created_at) >= ?'
            cogs_params.append(start_date)
        if end_date:
            cogs_query += ' AND date(i.created_at) <= ?'
            cogs_params.append(end_date)
        if branch_id:
            cursor.execute('SELECT name FROM branches WHERE id = ?', (branch_id,))
            branch = cursor.fetchone()
            if branch:
                cogs_query += ' AND i.branch_name = ?'
                cogs_params.append(branch['name'])
        
        cursor.execute(cogs_query, cogs_params)
        cogs_data = dict_from_row(cursor.fetchone())
        total_cogs = cogs_data['total_cogs'] or 0
        
        # حساب التكاليف
        expenses_query = 'SELECT SUM(amount) as total_expenses FROM expenses WHERE 1=1'
        expenses_params = []
        
        if start_date:
            expenses_query += ' AND date(expense_date) >= ?'
            expenses_params.append(start_date)
        if end_date:
            expenses_query += ' AND date(expense_date) <= ?'
            expenses_params.append(end_date)
        if branch_id:
            expenses_query += ' AND branch_id = ?'
            expenses_params.append(branch_id)
        
        cursor.execute(expenses_query, expenses_params)
        expenses_data = dict_from_row(cursor.fetchone())
        total_expenses = expenses_data['total_expenses'] or 0
        
        # حساب الربح
        gross_profit = total_revenue - total_cogs
        net_profit = gross_profit - total_expenses
        profit_margin = (net_profit / total_revenue * 100) if total_revenue > 0 else 0
        
        conn.close()
        
        return jsonify({
            'success': True,
            'report': {
                'total_revenue': total_revenue,
                'total_cogs': total_cogs,
                'gross_profit': gross_profit,
                'total_expenses': total_expenses,
                'net_profit': net_profit,
                'profit_margin': profit_margin
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== نظام المرتجعات =====

@app.route('/api/returns', methods=['GET'])
def get_returns():
    """جلب جميع المرتجعات"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM returns 
            ORDER BY created_at DESC
        ''')
        
        returns = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()
        
        return jsonify({
            'success': True,
            'returns': returns
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/returns/<int:return_id>', methods=['GET'])
def get_return(return_id):
    """جلب تفاصيل مرتجع واحد"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM returns WHERE id = ?', (return_id,))
        return_data = cursor.fetchone()
        conn.close()
        
        if not return_data:
            return jsonify({'success': False, 'error': 'المرتجع غير موجود'}), 404
        
        return jsonify({
            'success': True,
            'return': dict_from_row(return_data)
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/returns', methods=['POST'])
def add_return():
    """إضافة مرتجع"""
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        
        # إضافة المرتجع
        cursor.execute('''
            INSERT INTO returns (
                invoice_id, invoice_number, product_id, product_name,
                quantity, price, total, reason, employee_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            data.get('invoice_id'),
            data.get('invoice_number'),
            data.get('product_id'),
            data.get('product_name'),
            data.get('quantity'),
            data.get('price'),
            data.get('total'),
            data.get('reason'),
            data.get('employee_name')
        ))
        
        # إعادة المنتج للمخزون
        if data.get('product_id'):
            cursor.execute('''
                UPDATE products 
                SET stock = stock + ? 
                WHERE id = ?
            ''', (data.get('quantity'), data.get('product_id')))
        
        conn.commit()
        return_id = cursor.lastrowid
        conn.close()
        
        return jsonify({
            'success': True,
            'return_id': return_id,
            'message': 'تم إضافة المرتجع وإعادة المنتج للمخزون'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/returns/<int:return_id>', methods=['DELETE'])
def delete_return(return_id):
    """حذف مرتجع"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # جلب بيانات المرتجع قبل الحذف
        cursor.execute('SELECT * FROM returns WHERE id = ?', (return_id,))
        return_data = dict_from_row(cursor.fetchone())
        
        if not return_data:
            return jsonify({'success': False, 'error': 'المرتجع غير موجود'}), 404
        
        # إعادة خصم المنتج من المخزون
        if return_data.get('product_id'):
            cursor.execute('''
                UPDATE products 
                SET stock = stock - ? 
                WHERE id = ?
            ''', (return_data['quantity'], return_data['product_id']))
        
        # حذف المرتجع
        cursor.execute('DELETE FROM returns WHERE id = ?', (return_id,))
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'success': True,
            'message': 'تم حذف المرتجع'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== تشغيل الخادم =====

# ===== API طاولات المطاعم =====

@app.route('/api/tables', methods=['GET'])
def get_tables():
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT rt.*, i.invoice_number, i.total as invoice_total, i.customer_name as invoice_customer
            FROM restaurant_tables rt
            LEFT JOIN invoices i ON rt.current_invoice_id = i.id
            ORDER BY rt.id
        ''')
        tables = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({'success': True, 'tables': tables})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tables', methods=['POST'])
def add_table():
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO restaurant_tables (name, seats, pos_x, pos_y)
            VALUES (?, ?, ?, ?)
        ''', (data.get('name', 'طاولة'), data.get('seats', 4), data.get('pos_x', 50), data.get('pos_y', 50)))
        conn.commit()
        table_id = cursor.lastrowid
        conn.close()
        return jsonify({'success': True, 'id': table_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tables/<int:table_id>', methods=['PUT'])
def update_table(table_id):
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        fields = []
        values = []
        for key in ['name', 'seats', 'pos_x', 'pos_y', 'status', 'current_invoice_id']:
            if key in data:
                fields.append(f'{key} = ?')
                values.append(data[key])
        if fields:
            values.append(table_id)
            cursor.execute(f'UPDATE restaurant_tables SET {", ".join(fields)} WHERE id = ?', values)
            conn.commit()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tables/<int:table_id>', methods=['DELETE'])
def delete_table(table_id):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM restaurant_tables WHERE id = ?', (table_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tables/<int:table_id>/assign', methods=['POST'])
def assign_table_invoice(table_id):
    """ربط فاتورة بطاولة"""
    try:
        data = request.json
        invoice_id = data.get('invoice_id')
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('UPDATE restaurant_tables SET status = ?, current_invoice_id = ? WHERE id = ?',
                       ('occupied', invoice_id, table_id))
        if invoice_id:
            cursor.execute('SELECT name FROM restaurant_tables WHERE id = ?', (table_id,))
            tbl = cursor.fetchone()
            table_name = tbl['name'] if tbl else ''
            cursor.execute('UPDATE invoices SET table_id = ?, table_name = ? WHERE id = ?',
                           (table_id, table_name, invoice_id))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tables/<int:table_id>/release', methods=['POST'])
def release_table(table_id):
    """تحرير طاولة"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('UPDATE restaurant_tables SET status = ?, current_invoice_id = NULL WHERE id = ?',
                       ('available', table_id))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tables/<int:table_id>/reserve', methods=['POST'])
def reserve_table(table_id):
    """حجز طاولة"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT status FROM restaurant_tables WHERE id = ?', (table_id,))
        table = cursor.fetchone()
        if not table:
            conn.close()
            return jsonify({'success': False, 'error': 'الطاولة غير موجودة'}), 404
        if table['status'] == 'occupied':
            conn.close()
            return jsonify({'success': False, 'error': 'لا يمكن حجز طاولة مشغولة'}), 400
        cursor.execute('UPDATE restaurant_tables SET status = ? WHERE id = ?',
                       ('reserved', table_id))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== API الكوبونات =====

@app.route('/api/coupons', methods=['GET'])
def get_coupons():
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM coupons ORDER BY created_at DESC')
        coupons = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({'success': True, 'coupons': coupons})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/coupons', methods=['POST'])
def add_coupon():
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO coupons (code, discount_type, discount_value, min_amount, max_uses, expiry_date, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (data.get('code', '').upper(), data.get('discount_type', 'amount'),
              data.get('discount_value', 0), data.get('min_amount', 0),
              data.get('max_uses', 0), data.get('expiry_date', ''), data.get('notes', '')))
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'id': cursor.lastrowid})
    except sqlite3.IntegrityError:
        return jsonify({'success': False, 'error': 'كود الكوبون موجود مسبقاً'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/coupons/<int:coupon_id>', methods=['PUT'])
def update_coupon(coupon_id):
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE coupons SET code=?, discount_type=?, discount_value=?, min_amount=?,
                   max_uses=?, is_active=?, expiry_date=?, notes=?
            WHERE id=?
        ''', (data.get('code', '').upper(), data.get('discount_type', 'amount'),
              data.get('discount_value', 0), data.get('min_amount', 0),
              data.get('max_uses', 0), data.get('is_active', 1),
              data.get('expiry_date', ''), data.get('notes', ''), coupon_id))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/coupons/<int:coupon_id>', methods=['DELETE'])
def delete_coupon(coupon_id):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM coupons WHERE id = ?', (coupon_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/coupons/validate', methods=['POST'])
def validate_coupon():
    """التحقق من صلاحية كوبون وحساب الخصم"""
    try:
        data = request.json
        code = data.get('code', '').upper()
        subtotal = data.get('subtotal', 0)

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM coupons WHERE code = ?', (code,))
        row = cursor.fetchone()

        if not row:
            conn.close()
            return jsonify({'success': False, 'error': 'كود الكوبون غير صحيح'})

        coupon = dict_from_row(row)

        if not coupon['is_active']:
            conn.close()
            return jsonify({'success': False, 'error': 'الكوبون غير مفعّل'})

        if coupon['expiry_date'] and coupon['expiry_date'] < datetime.now().strftime('%Y-%m-%d'):
            conn.close()
            return jsonify({'success': False, 'error': 'الكوبون منتهي الصلاحية'})

        if coupon['max_uses'] > 0 and coupon['used_count'] >= coupon['max_uses']:
            conn.close()
            return jsonify({'success': False, 'error': 'تم استخدام الكوبون الحد الأقصى من المرات'})

        if subtotal < coupon['min_amount']:
            conn.close()
            return jsonify({'success': False, 'error': f'الحد الأدنى للطلب {coupon["min_amount"]:.3f} د.ك'})

        # حساب الخصم
        if coupon['discount_type'] == 'percent':
            discount = subtotal * (coupon['discount_value'] / 100)
        else:
            discount = coupon['discount_value']

        conn.close()
        return jsonify({'success': True, 'discount': round(discount, 3), 'coupon': coupon})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/coupons/use', methods=['POST'])
def use_coupon():
    """تسجيل استخدام كوبون"""
    try:
        data = request.json
        code = data.get('code', '').upper()
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('UPDATE coupons SET used_count = used_count + 1 WHERE code = ?', (code,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== API الموردين =====

@app.route('/api/suppliers', methods=['GET'])
def get_suppliers():
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT s.*,
                   (SELECT COUNT(*) FROM supplier_invoices WHERE supplier_id = s.id) as invoice_count,
                   (SELECT SUM(amount) FROM supplier_invoices WHERE supplier_id = s.id) as total_amount
            FROM suppliers s ORDER BY s.created_at DESC
        ''')
        suppliers = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({'success': True, 'suppliers': suppliers})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/suppliers', methods=['POST'])
def add_supplier():
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO suppliers (name, phone, email, address, company, notes)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (data.get('name'), data.get('phone', ''), data.get('email', ''),
              data.get('address', ''), data.get('company', ''), data.get('notes', '')))
        conn.commit()
        supplier_id = cursor.lastrowid
        conn.close()
        return jsonify({'success': True, 'id': supplier_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/suppliers/<int:supplier_id>', methods=['PUT'])
def update_supplier(supplier_id):
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE suppliers SET name=?, phone=?, email=?, address=?, company=?, notes=?
            WHERE id=?
        ''', (data.get('name'), data.get('phone', ''), data.get('email', ''),
              data.get('address', ''), data.get('company', ''), data.get('notes', ''), supplier_id))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/suppliers/<int:supplier_id>', methods=['DELETE'])
def delete_supplier(supplier_id):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM supplier_invoices WHERE supplier_id = ?', (supplier_id,))
        cursor.execute('DELETE FROM suppliers WHERE id = ?', (supplier_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/suppliers/<int:supplier_id>/invoices', methods=['GET'])
def get_supplier_invoices(supplier_id):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, supplier_id, invoice_number, amount, file_name, file_type, notes, invoice_date, created_at FROM supplier_invoices WHERE supplier_id = ? ORDER BY created_at DESC', (supplier_id,))
        invoices = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({'success': True, 'invoices': invoices})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/suppliers/invoices', methods=['POST'])
def add_supplier_invoice():
    try:
        data = request.json
        file_data = data.get('file_data', '')

        # التحقق من حجم الملف (1 MB = ~1.37 MB base64)
        if file_data and len(file_data) > 1400000:
            return jsonify({'success': False, 'error': 'حجم الملف يتجاوز 1 ميجابايت'}), 400

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO supplier_invoices (supplier_id, invoice_number, amount, file_name, file_data, file_type, notes, invoice_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (data.get('supplier_id'), data.get('invoice_number', ''), data.get('amount', 0),
              data.get('file_name', ''), file_data, data.get('file_type', ''),
              data.get('notes', ''), data.get('invoice_date', '')))
        conn.commit()
        invoice_id = cursor.lastrowid
        conn.close()
        return jsonify({'success': True, 'id': invoice_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/suppliers/invoices/<int:invoice_id>', methods=['DELETE'])
def delete_supplier_invoice(invoice_id):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM supplier_invoices WHERE id = ?', (invoice_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/suppliers/invoices/<int:invoice_id>/file', methods=['GET'])
def get_supplier_invoice_file(invoice_id):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT file_data, file_name, file_type FROM supplier_invoices WHERE id = ?', (invoice_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return jsonify({'success': True, 'file_data': row['file_data'], 'file_name': row['file_name'], 'file_type': row['file_type']})
        return jsonify({'success': False, 'error': 'الملف غير موجود'}), 404
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== نظام Multi-Tenancy API =====

@app.route('/api/super-admin/login', methods=['POST'])
def super_admin_login():
    """تسجيل دخول المدير الأعلى"""
    try:
        data = request.json
        username = data.get('username', '')
        password = data.get('password', '')
        conn = get_master_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM super_admins WHERE username = ? AND password = ?',
                       (username, hash_password(password)))
        admin = cursor.fetchone()
        conn.close()
        if admin:
            return jsonify({
                'success': True,
                'admin': {
                    'id': admin['id'],
                    'username': admin['username'],
                    'full_name': admin['full_name'],
                    'role': 'super_admin'
                }
            })
        return jsonify({'success': False, 'error': 'بيانات الدخول غير صحيحة'}), 401
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/super-admin/tenants', methods=['GET'])
def get_tenants():
    """جلب قائمة المستأجرين"""
    try:
        conn = get_master_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM tenants ORDER BY created_at DESC')
        tenants = [dict_from_row(row) for row in cursor.fetchall()]
        # إضافة إحصائيات لكل مستأجر
        for tenant in tenants:
            try:
                t_conn = sqlite3.connect(tenant['db_path'])
                t_conn.row_factory = sqlite3.Row
                t_cursor = t_conn.cursor()
                t_cursor.execute("SELECT COUNT(*) as c FROM users")
                tenant['users_count'] = t_cursor.fetchone()['c']
                t_cursor.execute("SELECT COUNT(*) as c FROM invoices")
                tenant['invoices_count'] = t_cursor.fetchone()['c']
                t_cursor.execute("SELECT COUNT(*) as c FROM products")
                tenant['products_count'] = t_cursor.fetchone()['c']
                t_conn.close()
            except:
                tenant['users_count'] = 0
                tenant['invoices_count'] = 0
                tenant['products_count'] = 0
        conn.close()
        return jsonify({'success': True, 'tenants': tenants})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/super-admin/tenants', methods=['POST'])
def create_tenant():
    """إنشاء مستأجر جديد"""
    try:
        data = request.json
        name = data.get('name', '').strip()
        slug = data.get('slug', '').strip().lower()
        owner_name = data.get('owner_name', '').strip()
        owner_email = data.get('owner_email', '').strip()
        owner_phone = data.get('owner_phone', '').strip()
        admin_username = data.get('admin_username', 'admin').strip()
        admin_password = data.get('admin_password', 'admin123').strip()
        plan = data.get('plan', 'basic')
        max_users = data.get('max_users', 5)
        max_branches = data.get('max_branches', 3)
        subscription_amount = data.get('subscription_amount', 0)
        subscription_period = data.get('subscription_period', 30)

        if not name or not slug or not owner_name:
            return jsonify({'success': False, 'error': 'الاسم والمعرف واسم المالك مطلوبة'}), 400

        # تنظيف slug
        slug = re.sub(r'[^a-zA-Z0-9_-]', '', slug)
        if not slug:
            return jsonify({'success': False, 'error': 'المعرف (slug) غير صالح'}), 400

        db_path = get_tenant_db_path(slug)

        # التحقق من عدم وجود مستأجر بنفس المعرف
        conn = get_master_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM tenants WHERE slug = ?', (slug,))
        if cursor.fetchone():
            conn.close()
            return jsonify({'success': False, 'error': 'هذا المعرف مستخدم بالفعل'}), 400

        # إنشاء قاعدة بيانات المستأجر
        create_tenant_database(slug)

        # إضافة مستخدم أدمن للمستأجر
        t_conn = sqlite3.connect(db_path)
        t_cursor = t_conn.cursor()
        t_cursor.execute('''
            INSERT INTO users (username, password, full_name, role, invoice_prefix, is_active, branch_id)
            VALUES (?, ?, ?, 'admin', 'INV', 1, 1)
        ''', (admin_username, admin_password, owner_name))
        t_conn.commit()
        t_conn.close()

        # تسجيل المستأجر في القاعدة الرئيسية
        cursor.execute('''
            INSERT INTO tenants (name, slug, owner_name, owner_email, owner_phone, db_path, plan, max_users, max_branches, subscription_amount, subscription_period)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (name, slug, owner_name, owner_email, owner_phone, db_path, plan, max_users, max_branches, subscription_amount, subscription_period))
        conn.commit()
        tenant_id = cursor.lastrowid
        conn.close()

        return jsonify({'success': True, 'id': tenant_id, 'slug': slug})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/super-admin/tenants/<int:tenant_id>', methods=['PUT'])
def update_tenant(tenant_id):
    """تحديث بيانات مستأجر"""
    try:
        data = request.json
        conn = get_master_db()
        cursor = conn.cursor()
        fields = []
        values = []
        for key in ['name', 'owner_name', 'owner_email', 'owner_phone', 'is_active', 'plan', 'max_users', 'max_branches', 'expires_at', 'subscription_amount', 'subscription_period']:
            if key in data:
                fields.append(f'{key} = ?')
                values.append(data[key])
        if fields:
            values.append(tenant_id)
            cursor.execute(f'UPDATE tenants SET {", ".join(fields)} WHERE id = ?', values)
            conn.commit()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/super-admin/tenants/<int:tenant_id>', methods=['DELETE'])
def delete_tenant(tenant_id):
    """حذف مستأجر"""
    try:
        conn = get_master_db()
        cursor = conn.cursor()
        cursor.execute('SELECT db_path, slug FROM tenants WHERE id = ?', (tenant_id,))
        tenant = cursor.fetchone()
        if not tenant:
            conn.close()
            return jsonify({'success': False, 'error': 'المستأجر غير موجود'}), 404

        # حذف قاعدة بيانات المستأجر
        db_path = tenant['db_path']
        if os.path.exists(db_path):
            os.remove(db_path)

        cursor.execute('DELETE FROM tenants WHERE id = ?', (tenant_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/super-admin/tenants/<int:tenant_id>/stats', methods=['GET'])
def get_tenant_stats(tenant_id):
    """إحصائيات تفصيلية لمستأجر"""
    try:
        conn = get_master_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM tenants WHERE id = ?', (tenant_id,))
        tenant = cursor.fetchone()
        conn.close()
        if not tenant:
            return jsonify({'success': False, 'error': 'المستأجر غير موجود'}), 404

        t_conn = sqlite3.connect(tenant['db_path'])
        t_conn.row_factory = sqlite3.Row
        t_cursor = t_conn.cursor()

        stats = {}
        t_cursor.execute("SELECT COUNT(*) as c FROM users")
        stats['users_count'] = t_cursor.fetchone()['c']
        t_cursor.execute("SELECT COUNT(*) as c FROM invoices")
        stats['invoices_count'] = t_cursor.fetchone()['c']
        t_cursor.execute("SELECT COUNT(*) as c FROM products")
        stats['products_count'] = t_cursor.fetchone()['c']
        t_cursor.execute("SELECT COUNT(*) as c FROM customers")
        stats['customers_count'] = t_cursor.fetchone()['c']
        t_cursor.execute("SELECT COALESCE(SUM(total), 0) as t FROM invoices")
        stats['total_sales'] = t_cursor.fetchone()['t']
        t_cursor.execute("SELECT COUNT(*) as c FROM branches")
        stats['branches_count'] = t_cursor.fetchone()['c']
        t_conn.close()

        return jsonify({'success': True, 'stats': stats, 'tenant': dict_from_row(tenant)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/super-admin/subscriptions/<int:tenant_id>', methods=['GET'])
def get_subscription_invoices(tenant_id):
    """جلب فواتير اشتراك مستأجر"""
    try:
        conn = get_master_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM subscription_invoices WHERE tenant_id = ? ORDER BY created_at DESC', (tenant_id,))
        invoices = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({'success': True, 'invoices': invoices})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/super-admin/subscriptions', methods=['POST'])
def create_subscription_invoice():
    """إنشاء فاتورة اشتراك وتجديد المتجر"""
    try:
        data = request.json
        tenant_id = data.get('tenant_id')
        amount = float(data.get('amount', 0))
        period_days = int(data.get('period_days', 30))
        notes = data.get('notes', '')
        payment_method = data.get('payment_method', 'cash')

        if not tenant_id or amount <= 0 or period_days <= 0:
            return jsonify({'success': False, 'error': 'بيانات الفاتورة غير مكتملة'}), 400

        conn = get_master_db()
        cursor = conn.cursor()

        # جلب بيانات المستأجر
        cursor.execute('SELECT * FROM tenants WHERE id = ?', (tenant_id,))
        tenant = cursor.fetchone()
        if not tenant:
            conn.close()
            return jsonify({'success': False, 'error': 'المستأجر غير موجود'}), 404

        # حساب تاريخ البداية والنهاية
        from datetime import date, timedelta
        today = date.today()

        # إذا كان الاشتراك ساري، نضيف من تاريخ الانتهاء الحالي
        if tenant['expires_at']:
            try:
                current_expiry = date.fromisoformat(tenant['expires_at'][:10])
                if current_expiry > today:
                    start_date = current_expiry
                else:
                    start_date = today
            except:
                start_date = today
        else:
            start_date = today

        end_date = start_date + timedelta(days=period_days)

        # إنشاء فاتورة الاشتراك
        cursor.execute('''
            INSERT INTO subscription_invoices (tenant_id, amount, period_days, start_date, end_date, notes, payment_method)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (tenant_id, amount, period_days, start_date.isoformat(), end_date.isoformat(), notes, payment_method))

        # تحديث تاريخ الانتهاء وتفعيل المتجر
        cursor.execute('UPDATE tenants SET expires_at = ?, is_active = 1 WHERE id = ?',
                       (end_date.isoformat(), tenant_id))

        conn.commit()
        invoice_id = cursor.lastrowid
        conn.close()

        return jsonify({
            'success': True,
            'id': invoice_id,
            'start_date': start_date.isoformat(),
            'end_date': end_date.isoformat()
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/super-admin/subscriptions/<int:invoice_id>', methods=['DELETE'])
def delete_subscription_invoice(invoice_id):
    """حذف فاتورة اشتراك"""
    try:
        conn = get_master_db()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM subscription_invoices WHERE id = ?', (invoice_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/super-admin/change-password', methods=['POST'])
def super_admin_change_password():
    """تغيير اسم المستخدم وكلمة مرور المدير الأعلى"""
    try:
        data = request.json
        admin_id = data.get('admin_id')
        old_password = data.get('old_password', '')
        new_password = data.get('new_password', '')
        new_username = data.get('new_username', '').strip()
        new_full_name = data.get('new_full_name', '').strip()
        conn = get_master_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM super_admins WHERE id = ? AND password = ?',
                       (admin_id, hash_password(old_password)))
        admin = cursor.fetchone()
        if not admin:
            conn.close()
            return jsonify({'success': False, 'error': 'كلمة المرور القديمة غير صحيحة'}), 400

        # تحديث كلمة المرور
        if new_password:
            cursor.execute('UPDATE super_admins SET password = ? WHERE id = ?',
                           (hash_password(new_password), admin_id))

        # تحديث اسم المستخدم
        if new_username and new_username != admin['username']:
            cursor.execute('SELECT id FROM super_admins WHERE username = ? AND id != ?', (new_username, admin_id))
            if cursor.fetchone():
                conn.close()
                return jsonify({'success': False, 'error': 'اسم المستخدم مستخدم بالفعل'}), 400
            cursor.execute('UPDATE super_admins SET username = ? WHERE id = ?', (new_username, admin_id))

        # تحديث الاسم الكامل
        if new_full_name:
            cursor.execute('UPDATE super_admins SET full_name = ? WHERE id = ?', (new_full_name, admin_id))

        conn.commit()
        # إرجاع البيانات المحدّثة
        cursor.execute('SELECT id, username, full_name FROM super_admins WHERE id = ?', (admin_id,))
        updated = cursor.fetchone()
        conn.close()
        return jsonify({
            'success': True,
            'admin': {
                'id': updated['id'],
                'username': updated['username'],
                'full_name': updated['full_name'],
                'role': 'super_admin'
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/super-admin/backup/tenant/<int:tenant_id>', methods=['POST'])
def super_admin_backup_tenant(tenant_id):
    """إنشاء نسخة احتياطية لمتجر معين من السوبر أدمن"""
    try:
        conn = get_master_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM tenants WHERE id = ?', (tenant_id,))
        tenant = cursor.fetchone()
        conn.close()
        if not tenant:
            return jsonify({'success': False, 'error': 'المتجر غير موجود'}), 404
        slug = tenant['slug']
        backup_info, error = create_backup_file(slug)
        if error:
            return jsonify({'success': False, 'error': error}), 500
        backup_info['tenant_name'] = tenant['name']
        return jsonify({'success': True, 'backup': backup_info})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/super-admin/backup/all', methods=['POST'])
def super_admin_backup_all():
    """إنشاء نسخ احتياطية لجميع المتاجر"""
    try:
        conn = get_master_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM tenants WHERE is_active = 1 ORDER BY id')
        tenants = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()

        results = []
        errors = []

        # نسخة احتياطية للقاعدة الرئيسية (default)
        backup_info, error = create_backup_file(None)
        if error:
            errors.append({'tenant': 'default', 'error': error})
        else:
            backup_info['tenant_name'] = 'القاعدة الرئيسية'
            results.append(backup_info)

        # نسخ احتياطية لكل متجر
        for tenant in tenants:
            backup_info, error = create_backup_file(tenant['slug'])
            if error:
                errors.append({'tenant': tenant['name'], 'error': error})
            else:
                backup_info['tenant_name'] = tenant['name']
                results.append(backup_info)

        return jsonify({
            'success': True,
            'backups': results,
            'errors': errors,
            'total': len(results),
            'failed': len(errors)
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/super-admin/backup/list', methods=['GET'])
def super_admin_list_all_backups():
    """قائمة النسخ الاحتياطية لجميع المتاجر"""
    try:
        conn = get_master_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, name, slug FROM tenants ORDER BY id')
        tenants = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()

        all_backups = {}

        # نسخ القاعدة الرئيسية
        default_dir = get_backup_dir(None)
        default_backups = []
        if os.path.exists(default_dir):
            for f in sorted(os.listdir(default_dir), reverse=True):
                if f.endswith('.db'):
                    fp = os.path.join(default_dir, f)
                    default_backups.append({
                        'filename': f,
                        'size': os.path.getsize(fp),
                        'created_at': datetime.fromtimestamp(os.path.getmtime(fp)).isoformat()
                    })
        all_backups['default'] = {'name': 'القاعدة الرئيسية', 'backups': default_backups}

        # نسخ كل متجر
        for tenant in tenants:
            tenant_dir = get_backup_dir(tenant['slug'])
            tenant_backups = []
            if os.path.exists(tenant_dir):
                for f in sorted(os.listdir(tenant_dir), reverse=True):
                    if f.endswith('.db'):
                        fp = os.path.join(tenant_dir, f)
                        tenant_backups.append({
                            'filename': f,
                            'size': os.path.getsize(fp),
                            'created_at': datetime.fromtimestamp(os.path.getmtime(fp)).isoformat()
                        })
            all_backups[tenant['slug']] = {'name': tenant['name'], 'backups': tenant_backups}

        return jsonify({'success': True, 'all_backups': all_backups})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== نظام النسخ الاحتياطي =====

def get_backup_dir(tenant_slug=None):
    """الحصول على مجلد النسخ الاحتياطية للمستأجر"""
    if tenant_slug:
        safe_slug = re.sub(r'[^a-zA-Z0-9_-]', '', tenant_slug)
        backup_dir = os.path.join(BACKUPS_DIR, safe_slug)
    else:
        backup_dir = os.path.join(BACKUPS_DIR, 'default')
    os.makedirs(backup_dir, exist_ok=True)
    return backup_dir

def create_backup_file(tenant_slug=None):
    """إنشاء نسخة احتياطية من قاعدة البيانات"""
    db_path = get_tenant_db_path(tenant_slug) if tenant_slug else DB_PATH
    if not os.path.exists(db_path):
        return None, 'قاعدة البيانات غير موجودة'

    backup_dir = get_backup_dir(tenant_slug)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_filename = f'backup_{timestamp}.db'
    backup_path = os.path.join(backup_dir, backup_filename)

    try:
        # استخدام SQLite backup API للتأكد من سلامة النسخة
        source = sqlite3.connect(db_path)
        dest = sqlite3.connect(backup_path)
        source.backup(dest)
        dest.close()
        source.close()

        file_size = os.path.getsize(backup_path)
        return {
            'filename': backup_filename,
            'path': backup_path,
            'size': file_size,
            'created_at': datetime.now().isoformat(),
            'tenant': tenant_slug or 'default'
        }, None
    except Exception as e:
        return None, str(e)

@app.route('/api/backup/create', methods=['POST'])
def create_backup():
    """إنشاء نسخة احتياطية جديدة"""
    try:
        tenant_slug = get_tenant_slug()
        backup_info, error = create_backup_file(tenant_slug)
        if error:
            return jsonify({'success': False, 'error': error}), 500
        return jsonify({'success': True, 'backup': backup_info})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/backup/list', methods=['GET'])
def list_backups():
    """قائمة النسخ الاحتياطية"""
    try:
        tenant_slug = get_tenant_slug()
        backup_dir = get_backup_dir(tenant_slug)
        backups = []

        if os.path.exists(backup_dir):
            for f in sorted(os.listdir(backup_dir), reverse=True):
                if f.endswith('.db'):
                    fpath = os.path.join(backup_dir, f)
                    stat = os.stat(fpath)
                    backups.append({
                        'filename': f,
                        'size': stat.st_size,
                        'created_at': datetime.fromtimestamp(stat.st_mtime).isoformat()
                    })

        # جلب إعدادات الجدولة
        db_path = get_tenant_db_path(tenant_slug) if tenant_slug else DB_PATH
        schedule = {'enabled': False, 'time': '03:00', 'keep_days': 30, 'gdrive_auto': False}
        try:
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT key, value FROM settings WHERE key LIKE 'backup_%'")
            for row in cursor.fetchall():
                k = row['key'].replace('backup_', '')
                if k == 'schedule_enabled':
                    schedule['enabled'] = row['value'] == 'true'
                elif k == 'schedule_time':
                    schedule['time'] = row['value']
                elif k == 'keep_days':
                    schedule['keep_days'] = int(row['value'])
                elif k == 'gdrive_auto':
                    schedule['gdrive_auto'] = row['value'] == 'true'
            conn.close()
        except:
            pass

        return jsonify({'success': True, 'backups': backups, 'schedule': schedule})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/backup/download/<filename>', methods=['GET'])
def download_backup(filename):
    """تحميل نسخة احتياطية"""
    try:
        # التحقق من اسم الملف (منع path traversal)
        safe_filename = re.sub(r'[^a-zA-Z0-9_.\-]', '', filename)
        if safe_filename != filename or '..' in filename:
            return jsonify({'success': False, 'error': 'اسم ملف غير صالح'}), 400

        tenant_slug = get_tenant_slug()
        backup_dir = get_backup_dir(tenant_slug)
        filepath = os.path.join(backup_dir, safe_filename)

        if not os.path.exists(filepath):
            return jsonify({'success': False, 'error': 'الملف غير موجود'}), 404

        return send_file(filepath, as_attachment=True, download_name=safe_filename)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/backup/delete/<filename>', methods=['DELETE'])
def delete_backup(filename):
    """حذف نسخة احتياطية"""
    try:
        safe_filename = re.sub(r'[^a-zA-Z0-9_.\-]', '', filename)
        if safe_filename != filename or '..' in filename:
            return jsonify({'success': False, 'error': 'اسم ملف غير صالح'}), 400

        tenant_slug = get_tenant_slug()
        backup_dir = get_backup_dir(tenant_slug)
        filepath = os.path.join(backup_dir, safe_filename)

        if not os.path.exists(filepath):
            return jsonify({'success': False, 'error': 'الملف غير موجود'}), 404

        os.remove(filepath)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/backup/restore', methods=['POST'])
def restore_backup():
    """استعادة نسخة احتياطية"""
    try:
        tenant_slug = get_tenant_slug()
        db_path = get_tenant_db_path(tenant_slug) if tenant_slug else DB_PATH

        # التحقق من وجود ملف مرفوع أو اسم ملف
        if 'file' in request.files:
            file = request.files['file']
            if not file.filename.endswith('.db'):
                return jsonify({'success': False, 'error': 'يجب أن يكون الملف بصيغة .db'}), 400

            # إنشاء نسخة احتياطية قبل الاستعادة
            pre_restore_info, _ = create_backup_file(tenant_slug)

            # حفظ الملف المرفوع كنسخة مؤقتة والتحقق منه
            import tempfile
            with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as tmp:
                file.save(tmp.name)
                tmp_path = tmp.name

            # التحقق من صحة قاعدة البيانات
            try:
                test_conn = sqlite3.connect(tmp_path)
                test_conn.execute('SELECT count(*) FROM sqlite_master')
                test_conn.close()
            except:
                os.unlink(tmp_path)
                return jsonify({'success': False, 'error': 'الملف ليس قاعدة بيانات صالحة'}), 400

            # استعادة القاعدة
            source = sqlite3.connect(tmp_path)
            dest = sqlite3.connect(db_path)
            source.backup(dest)
            dest.close()
            source.close()
            os.unlink(tmp_path)

        elif request.json and request.json.get('filename'):
            filename = request.json['filename']
            safe_filename = re.sub(r'[^a-zA-Z0-9_.\-]', '', filename)
            backup_dir = get_backup_dir(tenant_slug)
            filepath = os.path.join(backup_dir, safe_filename)

            if not os.path.exists(filepath):
                return jsonify({'success': False, 'error': 'النسخة الاحتياطية غير موجودة'}), 404

            # إنشاء نسخة احتياطية قبل الاستعادة
            pre_restore_info, _ = create_backup_file(tenant_slug)

            source = sqlite3.connect(filepath)
            dest = sqlite3.connect(db_path)
            source.backup(dest)
            dest.close()
            source.close()
        else:
            return jsonify({'success': False, 'error': 'لم يتم تحديد ملف'}), 400

        return jsonify({'success': True, 'message': 'تمت الاستعادة بنجاح. تم إنشاء نسخة احتياطية تلقائية قبل الاستعادة.'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/backup/schedule', methods=['PUT'])
def update_backup_schedule():
    """تحديث جدولة النسخ الاحتياطي التلقائي"""
    try:
        data = request.json
        tenant_slug = get_tenant_slug()
        db_path = get_tenant_db_path(tenant_slug) if tenant_slug else DB_PATH

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        settings = {
            'backup_schedule_enabled': 'true' if data.get('enabled') else 'false',
            'backup_schedule_time': data.get('time', '03:00'),
            'backup_keep_days': str(data.get('keep_days', 30)),
            'backup_gdrive_auto': 'true' if data.get('gdrive_auto') else 'false'
        }

        for key, value in settings.items():
            cursor.execute('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
                           (key, value, datetime.now().isoformat()))

        conn.commit()
        conn.close()

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== Google Drive Integration =====

GOOGLE_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
GOOGLE_DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
GOOGLE_DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

@app.route('/api/backup/gdrive/save-credentials', methods=['POST'])
def gdrive_save_credentials():
    """حفظ بيانات اعتماد Google Drive"""
    try:
        data = request.json
        client_id = data.get('client_id', '').strip()
        client_secret = data.get('client_secret', '').strip()
        base_url = data.get('base_url', '').strip().rstrip('/')

        if not client_id or not client_secret:
            return jsonify({'success': False, 'error': 'يرجى إدخال Client ID و Client Secret'}), 400

        # بناء redirect_uri من عنوان التطبيق
        redirect_uri = f'{base_url}/api/backup/gdrive/callback' if base_url else f'{request.host_url.rstrip("/")}/api/backup/gdrive/callback'

        tenant_slug = get_tenant_slug()
        db_path = get_tenant_db_path(tenant_slug) if tenant_slug else DB_PATH

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
                       ('gdrive_client_id', client_id, datetime.now().isoformat()))
        cursor.execute('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
                       ('gdrive_client_secret', client_secret, datetime.now().isoformat()))
        cursor.execute('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
                       ('gdrive_redirect_uri', redirect_uri, datetime.now().isoformat()))
        conn.commit()
        conn.close()

        # إنشاء رابط التفويض مع تمرير tenant_slug في state
        params = urllib.parse.urlencode({
            'client_id': client_id,
            'redirect_uri': redirect_uri,
            'response_type': 'code',
            'scope': GOOGLE_DRIVE_SCOPE,
            'access_type': 'offline',
            'prompt': 'consent',
            'state': tenant_slug or ''
        })
        auth_url = f'{GOOGLE_OAUTH_AUTH_URL}?{params}'

        return jsonify({'success': True, 'auth_url': auth_url, 'redirect_uri': redirect_uri})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

def _gdrive_exchange_code(auth_code, tenant_slug=None):
    """تبادل كود التفويض بالتوكن - دالة مشتركة"""
    db_path = get_tenant_db_path(tenant_slug) if tenant_slug else DB_PATH

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = 'gdrive_client_id'")
    row = cursor.fetchone()
    client_id = row['value'] if row else None
    cursor.execute("SELECT value FROM settings WHERE key = 'gdrive_client_secret'")
    row = cursor.fetchone()
    client_secret = row['value'] if row else None
    cursor.execute("SELECT value FROM settings WHERE key = 'gdrive_redirect_uri'")
    row = cursor.fetchone()
    redirect_uri = row['value'] if row else None
    conn.close()

    if not client_id or not client_secret:
        raise ValueError('لم يتم العثور على بيانات الاعتماد')

    if not redirect_uri:
        raise ValueError('لم يتم العثور على redirect_uri - أعد إدخال بيانات الاعتماد')

    # تبادل الكود بالتوكن
    token_data = urllib.parse.urlencode({
        'code': auth_code,
        'client_id': client_id,
        'client_secret': client_secret,
        'redirect_uri': redirect_uri,
        'grant_type': 'authorization_code'
    }).encode()

    req = urllib.request.Request(GOOGLE_OAUTH_TOKEN_URL, data=token_data)
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    response = urllib.request.urlopen(req)
    tokens = json.loads(response.read().decode())

    if 'access_token' not in tokens:
        raise ValueError('فشل الحصول على التوكن')

    # حفظ التوكنات
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
                   ('gdrive_access_token', tokens['access_token'], datetime.now().isoformat()))
    cursor.execute('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
                   ('gdrive_refresh_token', tokens.get('refresh_token', ''), datetime.now().isoformat()))
    cursor.execute('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
                   ('gdrive_token_expiry', str(time.time() + tokens.get('expires_in', 3600)), datetime.now().isoformat()))
    conn.commit()
    conn.close()

    return tokens

@app.route('/api/backup/gdrive/callback')
def gdrive_callback():
    """صفحة استقبال كود التفويض من Google - يتم التوجيه إليها تلقائياً"""
    auth_code = request.args.get('code', '')
    error = request.args.get('error', '')

    if error:
        return f'''<!DOCTYPE html>
<html dir="rtl"><head><meta charset="utf-8"><title>خطأ في ربط Google Drive</title></head>
<body style="font-family:sans-serif;text-align:center;padding:50px;">
<h2 style="color:#ef4444;">❌ فشل ربط Google Drive</h2>
<p>الخطأ: {error}</p>
<p>يمكنك إغلاق هذه النافذة والمحاولة مرة أخرى.</p>
<script>setTimeout(function(){{ window.close(); }}, 5000);</script>
</body></html>''', 400

    if not auth_code:
        return '''<!DOCTYPE html>
<html dir="rtl"><head><meta charset="utf-8"><title>خطأ</title></head>
<body style="font-family:sans-serif;text-align:center;padding:50px;">
<h2 style="color:#ef4444;">❌ لم يتم استلام كود التفويض</h2>
<p>يمكنك إغلاق هذه النافذة والمحاولة مرة أخرى.</p>
</body></html>''', 400

    try:
        # استخراج tenant_slug من state parameter (لأن الـ callback redirect ما فيه X-Tenant-ID header)
        tenant_slug = request.args.get('state', '').strip()
        _gdrive_exchange_code(auth_code, tenant_slug)

        return '''<!DOCTYPE html>
<html dir="rtl"><head><meta charset="utf-8"><title>تم ربط Google Drive</title></head>
<body style="font-family:sans-serif;text-align:center;padding:50px;">
<h2 style="color:#22c55e;">✅ تم ربط Google Drive بنجاح!</h2>
<p>سيتم إغلاق هذه النافذة تلقائياً...</p>
<script>
if (window.opener) { window.opener.postMessage('gdrive_connected', '*'); }
setTimeout(function(){ window.close(); }, 2000);
</script>
</body></html>'''
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        return f'''<!DOCTYPE html>
<html dir="rtl"><head><meta charset="utf-8"><title>خطأ</title></head>
<body style="font-family:sans-serif;text-align:center;padding:50px;">
<h2 style="color:#ef4444;">❌ فشل ربط Google Drive</h2>
<p>خطأ من Google: {error_body}</p>
<script>setTimeout(function(){{ window.close(); }}, 8000);</script>
</body></html>''', 400
    except Exception as e:
        return f'''<!DOCTYPE html>
<html dir="rtl"><head><meta charset="utf-8"><title>خطأ</title></head>
<body style="font-family:sans-serif;text-align:center;padding:50px;">
<h2 style="color:#ef4444;">❌ فشل ربط Google Drive</h2>
<p>{str(e)}</p>
<script>setTimeout(function(){{ window.close(); }}, 8000);</script>
</body></html>''', 400

@app.route('/api/backup/gdrive/connect', methods=['POST'])
def gdrive_connect():
    """ربط Google Drive باستخدام كود التفويض - طريقة يدوية احتياطية"""
    try:
        data = request.json
        auth_code = data.get('code', '').strip()

        if not auth_code:
            return jsonify({'success': False, 'error': 'يرجى إدخال كود التفويض'}), 400

        tenant_slug = get_tenant_slug()
        _gdrive_exchange_code(auth_code, tenant_slug)

        return jsonify({'success': True, 'message': 'تم ربط Google Drive بنجاح'})
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        return jsonify({'success': False, 'error': f'خطأ من Google: {error_body}'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

def refresh_gdrive_token(db_path):
    """تجديد توكن Google Drive"""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("SELECT value FROM settings WHERE key = 'gdrive_client_id'")
    row = cursor.fetchone()
    client_id = row['value'] if row else None

    cursor.execute("SELECT value FROM settings WHERE key = 'gdrive_client_secret'")
    row = cursor.fetchone()
    client_secret = row['value'] if row else None

    cursor.execute("SELECT value FROM settings WHERE key = 'gdrive_refresh_token'")
    row = cursor.fetchone()
    refresh_token = row['value'] if row else None
    conn.close()

    if not all([client_id, client_secret, refresh_token]):
        return None

    token_data = urllib.parse.urlencode({
        'client_id': client_id,
        'client_secret': client_secret,
        'refresh_token': refresh_token,
        'grant_type': 'refresh_token'
    }).encode()

    try:
        req = urllib.request.Request(GOOGLE_OAUTH_TOKEN_URL, data=token_data)
        req.add_header('Content-Type', 'application/x-www-form-urlencoded')
        response = urllib.request.urlopen(req)
        tokens = json.loads(response.read().decode())

        new_token = tokens.get('access_token')
        if new_token:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
                           ('gdrive_access_token', new_token, datetime.now().isoformat()))
            cursor.execute('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
                           ('gdrive_token_expiry', str(time.time() + tokens.get('expires_in', 3600)), datetime.now().isoformat()))
            conn.commit()
            conn.close()
            return new_token
    except:
        pass
    return None

def get_gdrive_token(db_path):
    """الحصول على توكن Google Drive صالح"""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("SELECT value FROM settings WHERE key = 'gdrive_access_token'")
    row = cursor.fetchone()
    access_token = row['value'] if row else None

    cursor.execute("SELECT value FROM settings WHERE key = 'gdrive_token_expiry'")
    row = cursor.fetchone()
    expiry = float(row['value']) if row else 0
    conn.close()

    if not access_token:
        return None

    # تجديد التوكن إذا انتهت صلاحيته
    if time.time() >= expiry - 60:
        access_token = refresh_gdrive_token(db_path)

    return access_token

@app.route('/api/backup/gdrive/status', methods=['GET'])
def gdrive_status():
    """حالة اتصال Google Drive"""
    try:
        tenant_slug = get_tenant_slug()
        db_path = get_tenant_db_path(tenant_slug) if tenant_slug else DB_PATH

        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute("SELECT value FROM settings WHERE key = 'gdrive_refresh_token'")
        row = cursor.fetchone()
        has_token = bool(row and row['value'])

        cursor.execute("SELECT value FROM settings WHERE key = 'gdrive_client_id'")
        row = cursor.fetchone()
        has_credentials = bool(row and row['value'])
        conn.close()

        return jsonify({
            'success': True,
            'connected': has_token,
            'has_credentials': has_credentials
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/backup/gdrive/disconnect', methods=['POST'])
def gdrive_disconnect():
    """قطع اتصال Google Drive"""
    try:
        tenant_slug = get_tenant_slug()
        db_path = get_tenant_db_path(tenant_slug) if tenant_slug else DB_PATH

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        for key in ['gdrive_client_id', 'gdrive_client_secret', 'gdrive_access_token', 'gdrive_refresh_token', 'gdrive_token_expiry']:
            cursor.execute("DELETE FROM settings WHERE key = ?", (key,))
        conn.commit()
        conn.close()

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/backup/gdrive/upload', methods=['POST'])
def gdrive_upload():
    """رفع نسخة احتياطية إلى Google Drive"""
    try:
        tenant_slug = get_tenant_slug()
        db_path = get_tenant_db_path(tenant_slug) if tenant_slug else DB_PATH

        token = get_gdrive_token(db_path)
        if not token:
            return jsonify({'success': False, 'error': 'Google Drive غير متصل. يرجى الربط أولاً.'}), 400

        data = request.json or {}
        filename = data.get('filename')

        if filename:
            safe_filename = re.sub(r'[^a-zA-Z0-9_.\-]', '', filename)
            backup_dir = get_backup_dir(tenant_slug)
            filepath = os.path.join(backup_dir, safe_filename)
            if not os.path.exists(filepath):
                return jsonify({'success': False, 'error': 'الملف غير موجود'}), 404
        else:
            # إنشاء نسخة احتياطية جديدة ورفعها
            backup_info, error = create_backup_file(tenant_slug)
            if error:
                return jsonify({'success': False, 'error': error}), 500
            filepath = backup_info['path']
            safe_filename = backup_info['filename']

        # إنشاء/البحث عن مجلد POS-Backups في Google Drive
        folder_id = _gdrive_find_or_create_folder(token, tenant_slug)

        # رفع الملف
        store_name = tenant_slug or 'default'
        upload_name = f'POS_{store_name}_{safe_filename}'

        boundary = '----BackupBoundary'
        metadata = json.dumps({
            'name': upload_name,
            'parents': [folder_id] if folder_id else []
        })

        with open(filepath, 'rb') as f:
            file_data = f.read()

        body = (
            f'--{boundary}\r\n'
            f'Content-Type: application/json; charset=UTF-8\r\n\r\n'
            f'{metadata}\r\n'
            f'--{boundary}\r\n'
            f'Content-Type: application/x-sqlite3\r\n\r\n'
        ).encode() + file_data + f'\r\n--{boundary}--'.encode()

        req = urllib.request.Request(
            f'{GOOGLE_DRIVE_UPLOAD_URL}?uploadType=multipart',
            data=body,
            method='POST'
        )
        req.add_header('Authorization', f'Bearer {token}')
        req.add_header('Content-Type', f'multipart/related; boundary={boundary}')

        response = urllib.request.urlopen(req)
        result = json.loads(response.read().decode())

        return jsonify({
            'success': True,
            'message': f'تم رفع النسخة إلى Google Drive بنجاح',
            'file_id': result.get('id'),
            'file_name': upload_name
        })
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        if e.code == 401:
            return jsonify({'success': False, 'error': 'انتهت صلاحية التوكن. يرجى إعادة ربط Google Drive.'}), 401
        return jsonify({'success': False, 'error': f'خطأ في Google Drive: {error_body}'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

def _gdrive_find_or_create_folder(token, tenant_slug=None):
    """البحث عن مجلد POS-Backups أو إنشاؤه"""
    folder_name = f'POS-Backups-{tenant_slug}' if tenant_slug else 'POS-Backups'
    try:
        query = urllib.parse.quote(f"name='{folder_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false")
        req = urllib.request.Request(f'{GOOGLE_DRIVE_FILES_URL}?q={query}')
        req.add_header('Authorization', f'Bearer {token}')
        response = urllib.request.urlopen(req)
        result = json.loads(response.read().decode())

        if result.get('files'):
            return result['files'][0]['id']

        # إنشاء المجلد
        metadata = json.dumps({
            'name': folder_name,
            'mimeType': 'application/vnd.google-apps.folder'
        }).encode()

        req = urllib.request.Request(GOOGLE_DRIVE_FILES_URL, data=metadata, method='POST')
        req.add_header('Authorization', f'Bearer {token}')
        req.add_header('Content-Type', 'application/json')
        response = urllib.request.urlopen(req)
        result = json.loads(response.read().decode())
        return result.get('id')
    except:
        return None

@app.route('/api/backup/gdrive/files', methods=['GET'])
def gdrive_list_files():
    """قائمة النسخ الاحتياطية في Google Drive"""
    try:
        tenant_slug = get_tenant_slug()
        db_path = get_tenant_db_path(tenant_slug) if tenant_slug else DB_PATH

        token = get_gdrive_token(db_path)
        if not token:
            return jsonify({'success': False, 'error': 'Google Drive غير متصل'}), 400

        folder_name = f'POS-Backups-{tenant_slug}' if tenant_slug else 'POS-Backups'
        query = urllib.parse.quote(f"name contains 'POS_' and trashed=false")
        req = urllib.request.Request(
            f'{GOOGLE_DRIVE_FILES_URL}?q={query}&orderBy=createdTime desc&fields=files(id,name,size,createdTime)'
        )
        req.add_header('Authorization', f'Bearer {token}')
        response = urllib.request.urlopen(req)
        result = json.loads(response.read().decode())

        files = []
        for f in result.get('files', []):
            files.append({
                'id': f['id'],
                'name': f['name'],
                'size': int(f.get('size', 0)),
                'created_at': f.get('createdTime', '')
            })

        return jsonify({'success': True, 'files': files})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== مجدول النسخ الاحتياطي التلقائي =====

_backup_scheduler_running = False

def backup_scheduler_loop():
    """حلقة المجدول - تعمل في خيط منفصل"""
    global _backup_scheduler_running
    _backup_scheduler_running = True
    print("[Backup Scheduler] تم بدء مجدول النسخ الاحتياطي التلقائي")

    while _backup_scheduler_running:
        try:
            now = datetime.now()
            current_time = now.strftime('%H:%M')

            # فحص كل قواعد البيانات (الافتراضية + المستأجرين)
            db_paths = [('', DB_PATH)]
            if os.path.exists(TENANTS_DB_DIR):
                for f in os.listdir(TENANTS_DB_DIR):
                    if f.endswith('.db'):
                        slug = f[:-3]
                        db_paths.append((slug, os.path.join(TENANTS_DB_DIR, f)))

            for tenant_slug, db_path in db_paths:
                try:
                    conn = sqlite3.connect(db_path)
                    conn.row_factory = sqlite3.Row
                    cursor = conn.cursor()

                    cursor.execute("SELECT value FROM settings WHERE key = 'backup_schedule_enabled'")
                    row = cursor.fetchone()
                    enabled = row and row['value'] == 'true'

                    if not enabled:
                        conn.close()
                        continue

                    cursor.execute("SELECT value FROM settings WHERE key = 'backup_schedule_time'")
                    row = cursor.fetchone()
                    schedule_time = row['value'] if row else '03:00'

                    cursor.execute("SELECT value FROM settings WHERE key = 'backup_keep_days'")
                    row = cursor.fetchone()
                    keep_days = int(row['value']) if row else 30

                    cursor.execute("SELECT value FROM settings WHERE key = 'backup_gdrive_auto'")
                    row = cursor.fetchone()
                    gdrive_auto = row and row['value'] == 'true'
                    conn.close()

                    # التحقق من الوقت (مع هامش دقيقة واحدة)
                    if current_time == schedule_time:
                        slug_label = tenant_slug or 'default'
                        print(f"[Backup Scheduler] بدء نسخ احتياطي تلقائي لـ {slug_label}")

                        backup_info, error = create_backup_file(tenant_slug if tenant_slug else None)
                        if error:
                            print(f"[Backup Scheduler] خطأ: {error}")
                        else:
                            print(f"[Backup Scheduler] تم إنشاء نسخة: {backup_info['filename']}")

                            # رفع تلقائي إلى Google Drive
                            if gdrive_auto:
                                try:
                                    token = get_gdrive_token(db_path)
                                    if token:
                                        folder_id = _gdrive_find_or_create_folder(token, tenant_slug if tenant_slug else None)
                                        store_name = tenant_slug or 'default'
                                        upload_name = f'POS_{store_name}_{backup_info["filename"]}'

                                        boundary = '----BackupBoundary'
                                        metadata = json.dumps({
                                            'name': upload_name,
                                            'parents': [folder_id] if folder_id else []
                                        })

                                        with open(backup_info['path'], 'rb') as bf:
                                            file_data = bf.read()

                                        body = (
                                            f'--{boundary}\r\n'
                                            f'Content-Type: application/json; charset=UTF-8\r\n\r\n'
                                            f'{metadata}\r\n'
                                            f'--{boundary}\r\n'
                                            f'Content-Type: application/x-sqlite3\r\n\r\n'
                                        ).encode() + file_data + f'\r\n--{boundary}--'.encode()

                                        req = urllib.request.Request(
                                            f'{GOOGLE_DRIVE_UPLOAD_URL}?uploadType=multipart',
                                            data=body, method='POST'
                                        )
                                        req.add_header('Authorization', f'Bearer {token}')
                                        req.add_header('Content-Type', f'multipart/related; boundary={boundary}')
                                        urllib.request.urlopen(req)
                                        print(f"[Backup Scheduler] تم رفع النسخة إلى Google Drive")
                                except Exception as ge:
                                    print(f"[Backup Scheduler] خطأ في رفع Google Drive: {ge}")

                        # حذف النسخ القديمة
                        _cleanup_old_backups(tenant_slug if tenant_slug else None, keep_days)

                except Exception as te:
                    print(f"[Backup Scheduler] خطأ للمستأجر: {te}")

        except Exception as e:
            print(f"[Backup Scheduler] خطأ عام: {e}")

        # الانتظار 60 ثانية قبل الفحص التالي
        time.sleep(60)

def _cleanup_old_backups(tenant_slug, keep_days):
    """حذف النسخ الاحتياطية الأقدم من عدد الأيام المحدد"""
    backup_dir = get_backup_dir(tenant_slug)
    cutoff = time.time() - (keep_days * 86400)

    for f in os.listdir(backup_dir):
        if f.endswith('.db'):
            fpath = os.path.join(backup_dir, f)
            if os.path.getmtime(fpath) < cutoff:
                os.remove(fpath)
                print(f"[Backup Cleanup] تم حذف نسخة قديمة: {f}")

if __name__ == '__main__':
    print("🚀 تشغيل خادم POS (Multi-Tenancy)...")
    print("📍 العنوان: http://0.0.0.0:5000")
    print("💡 يمكنك الوصول من أي جهاز على الشبكة المحلية")
    print("🏢 نظام تعدد المستأجرين مفعل")
    print("💾 نظام النسخ الاحتياطي مفعل")
    print("⏹️  لإيقاف الخادم: اضغط Ctrl+C")

    # بدء مجدول النسخ الاحتياطي
    scheduler_thread = threading.Thread(target=backup_scheduler_loop, daemon=True)
    scheduler_thread.start()

    app.run(host='0.0.0.0', port=5000, debug=False)
