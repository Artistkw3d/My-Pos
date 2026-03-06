# -*- coding: utf-8 -*-
"""
Master database initialization for POS Offline multi-tenancy.
Contains the tenants, super_admins, and subscription_invoices tables.
"""

import sqlite3

# CREATE TABLE statements for the master database (multi-tenant management)
MASTER_TABLES_SQL = {
    'tenants': '''
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
            expires_at TEXT,
            mode TEXT DEFAULT 'online'
        )
    ''',
    'super_admins': '''
        CREATE TABLE IF NOT EXISTS super_admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            full_name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''',
    'subscription_invoices': '''
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
    ''',
}


def init_master_db(master_db_path, hash_password):
    """Create the master database with tenant management tables and default super admin.

    Args:
        master_db_path: Path to the master.db file
        hash_password: A callable that hashes a password string (SHA-256)
    """
    conn = sqlite3.connect(master_db_path)
    cursor = conn.cursor()

    # Create all master tables
    for table_sql in MASTER_TABLES_SQL.values():
        cursor.execute(table_sql)

    # Migration: add new columns if they don't exist yet
    try:
        cursor.execute("PRAGMA table_info(tenants)")
        cols = [col[1] for col in cursor.fetchall()]
        if 'subscription_amount' not in cols:
            cursor.execute("ALTER TABLE tenants ADD COLUMN subscription_amount REAL DEFAULT 0")
        if 'subscription_period' not in cols:
            cursor.execute("ALTER TABLE tenants ADD COLUMN subscription_period INTEGER DEFAULT 30")
        if 'mode' not in cols:
            cursor.execute("ALTER TABLE tenants ADD COLUMN mode TEXT DEFAULT 'online'")
    except:
        pass

    # Create default Super Admin account if none exists
    cursor.execute("SELECT COUNT(*) FROM super_admins")
    admin_count = cursor.fetchone()[0]
    if admin_count == 0:
        import os
        default_pw = os.environ.get('POS_SUPERADMIN_PASSWORD', 'admin123')
        cursor.execute(
            "INSERT OR IGNORE INTO super_admins (username, password, full_name) VALUES (?, ?, ?)",
            ('superadmin', hash_password(default_pw), '\u0645\u062f\u064a\u0631 \u0627\u0644\u0646\u0638\u0627\u0645')
        )
        if default_pw == 'admin123':
            print("[SECURITY WARNING] Super admin created with default password 'admin123'. Change it immediately!")
            print("[SECURITY WARNING] Set POS_SUPERADMIN_PASSWORD env var or change password after first login.")

    conn.commit()
    conn.close()
