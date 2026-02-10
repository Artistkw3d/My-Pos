#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
خادم API لنظام POS
Flask + SQLite
محسّن لأجهزة Synology DS120j
"""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import sqlite3
import os
from datetime import datetime
import json

app = Flask(__name__, static_folder='frontend')
CORS(app)

# إعدادات قاعدة البيانات
DB_PATH = 'database/pos.db'

def migrate_database():
    """ترقية قاعدة البيانات - إضافة أعمدة جديدة"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute("PRAGMA table_info(invoices)")
        columns = [col[1] for col in cursor.fetchall()]
        if 'order_status' not in columns:
            cursor.execute("ALTER TABLE invoices ADD COLUMN order_status TEXT DEFAULT 'قيد التنفيذ'")
            conn.commit()

        # جدول الموردين
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS suppliers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT,
                email TEXT,
                address TEXT,
                company TEXT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # جدول فواتير الموردين
        cursor.execute('''
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
            )
        ''')

        # جدول الكوبونات
        cursor.execute('''
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
            )
        ''')
        conn.commit()
    except Exception as e:
        print(f"Migration note: {e}")
    finally:
        conn.close()

migrate_database()

def get_db():
    """الاتصال بقاعدة البيانات"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def dict_from_row(row):
    """تحويل صف قاعدة البيانات إلى قاموس"""
    return dict(zip(row.keys(), row))

# ===== API المستخدمين =====

@app.route('/api/login', methods=['POST'])
def login():
    """تسجيل دخول المستخدم"""
    try:
        data = request.json
        username = data.get('username')
        password = data.get('password')
        
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT u.id, u.username, u.full_name, u.role, u.invoice_prefix, u.is_active, u.branch_id,
                   u.can_view_products, u.can_add_products, u.can_edit_products, u.can_delete_products,
                   u.can_view_inventory, u.can_add_inventory, u.can_edit_inventory, u.can_delete_inventory,
                   u.can_view_invoices, u.can_delete_invoices,
                   u.can_view_customers, u.can_add_customer, u.can_edit_customer, u.can_delete_customer,
                   u.can_view_reports, u.can_view_accounting, u.can_manage_users, u.can_access_settings,
                   b.name as branch_name
            FROM users u
            LEFT JOIN branches b ON u.branch_id = b.id
            WHERE u.username = ? AND u.password = ? AND u.is_active = 1
        ''', (username, password))
        
        user = cursor.fetchone()
        conn.close()
        
        if user:
            user_data = dict_from_row(user)
            return jsonify({'success': True, 'user': user_data})
        else:
            return jsonify({'success': False, 'error': 'اسم المستخدم أو كلمة المرور غير صحيحة'}), 401
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/users', methods=['GET'])
def get_users():
    """جلب جميع المستخدمين"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, username, full_name, role, invoice_prefix, branch_id, is_active, created_at FROM users ORDER BY created_at DESC')
        users = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({'success': True, 'users': users})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/users', methods=['POST'])
def add_user():
    """إضافة مستخدم جديد"""
    try:
        data = request.json
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO users (username, password, full_name, role, invoice_prefix, branch_id,
                             can_view_products, can_add_products, can_edit_products, can_delete_products,
                             can_view_inventory, can_add_inventory, can_edit_inventory, can_delete_inventory,
                             can_view_invoices, can_delete_invoices,
                             can_view_customers, can_add_customer, can_edit_customer, can_delete_customer,
                             can_view_reports, can_view_accounting, can_manage_users, can_access_settings)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            data.get('username'),
            data.get('password'),
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
            data.get('can_access_settings', 0)
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
        
        # بناء الاستعلام ديناميكياً
        updates = []
        params = []
        
        if 'password' in data and data['password']:
            updates.append('password = ?')
            params.append(data['password'])
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
        if branch_id == 'all':
            # جلب كل التوزيعات
            cursor.execute('''
                SELECT bs.id, bs.stock, bs.branch_id, 
                       i.name, i.barcode, i.category, i.price, i.cost, i.image_data
                FROM branch_stock bs
                JOIN inventory i ON bs.inventory_id = i.id
                ORDER BY bs.branch_id, i.name
            ''')
        elif branch_id:
            # جلب توزيعات فرع معين
            cursor.execute('''
                SELECT bs.id, bs.stock, bs.branch_id,
                       i.name, i.barcode, i.category, i.price, i.cost, i.image_data
                FROM branch_stock bs
                JOIN inventory i ON bs.inventory_id = i.id
                WHERE bs.branch_id = ?
                ORDER BY i.name
            ''', (branch_id,))
        else:
            # افتراضياً الفرع 1
            cursor.execute('''
                SELECT bs.id, bs.stock, bs.branch_id,
                       i.name, i.barcode, i.category, i.price, i.cost, i.image_data
                FROM branch_stock bs
                JOIN inventory i ON bs.inventory_id = i.id
                WHERE bs.branch_id = ?
                ORDER BY i.name
            ''', (1,))
        
        products = [dict_from_row(row) for row in cursor.fetchall()]
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
    """جلب جميع المنتجات الأساسية"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM inventory ORDER BY name')
        inventory = [dict_from_row(row) for row in cursor.fetchall()]
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
        # حذف التوزيعات أولاً
        cursor.execute('DELETE FROM branch_stock WHERE inventory_id=?', (inventory_id,))
        cursor.execute('DELETE FROM inventory WHERE id=?', (inventory_id,))
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

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
            SELECT bs.*, i.name, i.barcode, i.category, i.price, i.cost, i.image_data
            FROM branch_stock bs
            JOIN inventory i ON bs.inventory_id = i.id
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
        
        # التحقق من وجود التوزيع
        cursor.execute('''
            SELECT id, stock FROM branch_stock 
            WHERE inventory_id = ? AND branch_id = ?
        ''', (data.get('inventory_id'), data.get('branch_id')))
        
        existing = cursor.fetchone()
        
        if existing:
            # تحديث الكمية
            new_stock = existing['stock'] + data.get('stock', 0)
            cursor.execute('''
                UPDATE branch_stock SET stock = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            ''', (new_stock, existing['id']))
            stock_id = existing['id']
        else:
            # إضافة جديد
            cursor.execute('''
                INSERT INTO branch_stock (inventory_id, branch_id, stock)
                VALUES (?, ?, ?)
            ''', (
                data.get('inventory_id'),
                data.get('branch_id'),
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
    """البحث عن منتج بالاسم أو الباركود"""
    try:
        query = request.args.get('q', '')
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM products 
            WHERE name LIKE ? OR barcode LIKE ?
            LIMIT 20
        ''', (f'%{query}%', f'%{query}%'))
        
        products = [dict_from_row(row) for row in cursor.fetchall()]
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
             subtotal, discount, total, payment_method, employee_name, notes, transaction_number, branch_name, delivery_fee)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            data.get('delivery_fee', 0)
        ))
        
        invoice_id = cursor.lastrowid
        
        # إدراج عناصر الفاتورة وتحديث المخزون
        for item in data.get('items', []):
            # الحصول على branch_stock_id
            branch_stock_id = item.get('branch_stock_id') or item.get('product_id')
            
            cursor.execute('''
                INSERT INTO invoice_items 
                (invoice_id, product_id, product_name, quantity, price, total, branch_stock_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                invoice_id,
                item.get('product_id'),
                item.get('product_name'),
                item.get('quantity'),
                item.get('price'),
                item.get('total'),
                branch_stock_id
            ))
            
            # تحديث المخزون في branch_stock
            if branch_stock_id:
                cursor.execute('''
                    UPDATE branch_stock 
                    SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                ''', (item.get('quantity'), branch_stock_id))
        
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

if __name__ == '__main__':
    print("🚀 تشغيل خادم POS...")
    print("📍 العنوان: http://0.0.0.0:5000")
    print("💡 يمكنك الوصول من أي جهاز على الشبكة المحلية")
    print("⏹️  لإيقاف الخادم: اضغط Ctrl+C")
    
    app.run(host='0.0.0.0', port=5000, debug=False)
