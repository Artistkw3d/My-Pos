#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
سكريبت إنشاء قاعدة بيانات نظام POS
يقوم بإنشاء جميع الجداول المطلوبة
"""

import sqlite3
import os
from datetime import datetime

def create_database():
    """إنشاء قاعدة البيانات مع كل الجداول"""
    
    # إنشاء مجلد database إذا لم يكن موجود
    os.makedirs('database', exist_ok=True)
    
    # الاتصال بقاعدة البيانات (سيتم إنشاؤها إذا لم تكن موجودة)
    conn = sqlite3.connect('database/pos.db')
    cursor = conn.cursor()
    
    print("🔧 جاري إنشاء قاعدة البيانات...")
    
    # ===== جدول المنتجات =====
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        barcode TEXT UNIQUE,
        price REAL NOT NULL,
        cost REAL DEFAULT 0,
        stock INTEGER DEFAULT 0,
        category TEXT,
        image TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    print("✅ جدول المنتجات")
    
    # ===== جدول العملاء =====
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        address TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    print("✅ جدول العملاء")
    
    # ===== جدول الفواتير =====
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_number TEXT UNIQUE NOT NULL,
        customer_id INTEGER,
        customer_name TEXT,
        customer_phone TEXT,
        subtotal REAL NOT NULL,
        discount REAL DEFAULT 0,
        total REAL NOT NULL,
        payment_method TEXT NOT NULL,
        employee_name TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id)
    )
    ''')
    print("✅ جدول الفواتير")
    
    # ===== جدول عناصر الفاتورة =====
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS invoice_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL,
        product_id INTEGER,
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price REAL NOT NULL,
        total REAL NOT NULL,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
    )
    ''')
    print("✅ جدول عناصر الفاتورة")
    
    # ===== جدول الموظفين =====
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'cashier',
        invoice_prefix TEXT UNIQUE,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    print("✅ جدول الموظفين")
    
    # ===== جدول المرتجعات =====
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER,
        invoice_number TEXT,
        product_id INTEGER,
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price REAL NOT NULL,
        total REAL NOT NULL,
        reason TEXT,
        employee_name TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
    )
    ''')
    print("✅ جدول المرتجعات")
    
    # ===== جدول الإعدادات =====
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    print("✅ جدول الإعدادات")
    
    # ===== إضافة إعدادات افتراضية =====
    default_settings = [
        ('store_name', 'متجر العطور والبخور'),
        ('store_phone', ''),
        ('store_address', ''),
        ('tax_enabled', 'false'),
        ('tax_rate', '0'),
        ('currency', 'KD'),
        ('invoice_prefix', 'INV'),
        ('next_invoice_number', '1')
    ]
    
    cursor.executemany('''
        INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
    ''', default_settings)
    print("✅ الإعدادات الافتراضية")
    
    # ===== إنشاء فهارس لتحسين الأداء =====
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(created_at)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id)')
    print("✅ الفهارس")
    
    # حفظ التغييرات
    conn.commit()
    conn.close()
    
    print("\n✨ تم إنشاء قاعدة البيانات بنجاح!")
    print(f"📍 المسار: database/pos.db")
    print(f"📊 الجداول: 6 جداول")
    print(f"🕐 التاريخ: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == "__main__":
    create_database()
