# -*- coding: utf-8 -*-
"""
Database migration logic for POS Offline.
Runs ALTER TABLE ADD COLUMN migrations, creates newer tables,
and fixes old data inconsistencies.
"""

import sqlite3
from db_modules.schema import create_all_tables, DEFAULT_SETTINGS_MIGRATE


def migrate_database(db_path):
    """Upgrade a database - create base tables, add new columns and tables.

    Args:
        db_path: Path to the SQLite database file to migrate
    """
    conn = sqlite3.connect(db_path)
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
        # === Create all base tables if they don't exist ===
        create_all_tables(cursor)

        # Insert default branch if missing
        cursor.execute("INSERT OR IGNORE INTO branches (id, name, location, is_active) VALUES (1, '\u0627\u0644\u0641\u0631\u0639 \u0627\u0644\u0631\u0626\u064a\u0633\u064a', '', 1)")

        # Insert default settings if missing
        for key, value in DEFAULT_SETTINGS_MIGRATE:
            cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, value))
        conn.commit()

        # === New tables (safe_exec for backwards compatibility) ===
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

        # === XBRL / IFRS ===
        safe_exec('''CREATE TABLE IF NOT EXISTS xbrl_company_info (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_name_ar TEXT,
            company_name_en TEXT,
            commercial_registration TEXT,
            tax_number TEXT,
            reporting_currency TEXT DEFAULT 'SAR',
            industry_sector TEXT,
            country TEXT DEFAULT 'SA',
            fiscal_year_end TEXT DEFAULT '12-31',
            legal_form TEXT,
            contact_email TEXT,
            contact_phone TEXT,
            address TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )''', 'xbrl_company_info')

        safe_exec('''CREATE TABLE IF NOT EXISTS xbrl_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            report_type TEXT NOT NULL,
            period_start TEXT NOT NULL,
            period_end TEXT NOT NULL,
            report_data TEXT,
            xbrl_xml TEXT,
            created_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            notes TEXT
        )''', 'xbrl_reports')

        # === New columns in existing tables ===
        add_column('invoices', 'order_status', 'TEXT', "'\u0642\u064a\u062f \u0627\u0644\u062a\u0646\u0641\u064a\u0630'")
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

        # === New user permissions ===
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
        add_column('users', 'can_view_xbrl', 'INTEGER', 0)
        add_column('users', 'last_login', 'TIMESTAMP')

        add_column('invoice_items', 'variant_id', 'INTEGER')
        add_column('invoice_items', 'variant_name', 'TEXT')

        add_column('branch_stock', 'variant_id', 'INTEGER')
        add_column('branch_stock', 'notes', 'TEXT')

        add_column('subscription_plans', 'image', 'TEXT')

        # === Shifts system ===
        safe_exec('''CREATE TABLE IF NOT EXISTS shifts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            start_time TEXT,
            end_time TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )''', 'shifts')

        # === Invoice edit history ===
        safe_exec('''CREATE TABLE IF NOT EXISTS invoice_edit_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL,
            edited_by INTEGER,
            edited_by_name TEXT,
            changes TEXT,
            edited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
        )''', 'invoice_edit_history')

        # Shift columns
        add_column('users', 'shift_id', 'INTEGER')
        add_column('users', 'can_edit_completed_invoices', 'INTEGER', 0)
        add_column('invoices', 'shift_id', 'INTEGER')
        add_column('invoices', 'shift_name', 'TEXT')
        add_column('invoices', 'edited_at', 'TIMESTAMP')
        add_column('invoices', 'edited_by', 'TEXT')
        add_column('invoices', 'edit_count', 'INTEGER', 0)

        # Auto-lock shift
        add_column('shifts', 'auto_lock', 'INTEGER', 0)

        # === Stock transfer system ===
        safe_exec('''CREATE TABLE IF NOT EXISTS stock_transfers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transfer_number TEXT UNIQUE,
            from_branch_id INTEGER,
            from_branch_name TEXT,
            to_branch_id INTEGER,
            to_branch_name TEXT,
            status TEXT DEFAULT 'pending',
            requested_by INTEGER,
            requested_by_name TEXT,
            approved_by INTEGER,
            approved_by_name TEXT,
            driver_id INTEGER,
            driver_name TEXT,
            received_by INTEGER,
            received_by_name TEXT,
            notes TEXT,
            reject_reason TEXT,
            requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            approved_at TIMESTAMP,
            picked_up_at TIMESTAMP,
            delivered_at TIMESTAMP,
            completed_at TIMESTAMP
        )''', 'stock_transfers')

        safe_exec('''CREATE TABLE IF NOT EXISTS stock_transfer_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transfer_id INTEGER NOT NULL,
            inventory_id INTEGER,
            product_name TEXT,
            variant_id INTEGER,
            variant_name TEXT,
            quantity_requested INTEGER DEFAULT 0,
            quantity_approved INTEGER DEFAULT 0,
            quantity_received INTEGER DEFAULT 0,
            FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id) ON DELETE CASCADE
        )''', 'stock_transfer_items')

        # Stock transfer permissions
        add_column('users', 'can_create_transfer', 'INTEGER', 0)
        add_column('users', 'can_approve_transfer', 'INTEGER', 0)
        add_column('users', 'can_deliver_transfer', 'INTEGER', 0)
        add_column('users', 'can_view_transfers', 'INTEGER', 0)

        # Subscription permissions
        add_column('users', 'can_view_subscriptions', 'INTEGER', 0)
        add_column('users', 'can_manage_subscriptions', 'INTEGER', 0)

        # Subscription plans table
        safe_exec('''CREATE TABLE IF NOT EXISTS subscription_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            duration_days INTEGER NOT NULL DEFAULT 30,
            price REAL NOT NULL DEFAULT 0,
            discount_percent REAL DEFAULT 0,
            loyalty_multiplier REAL DEFAULT 1,
            description TEXT,
            image TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )''', 'subscription_plans')

        # Customer subscriptions table
        safe_exec('''CREATE TABLE IF NOT EXISTS customer_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            customer_name TEXT,
            customer_phone TEXT,
            plan_id INTEGER,
            plan_name TEXT,
            subscription_code TEXT UNIQUE,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            price_paid REAL DEFAULT 0,
            discount_percent REAL DEFAULT 0,
            loyalty_multiplier REAL DEFAULT 1,
            status TEXT DEFAULT 'active',
            notes TEXT,
            created_by INTEGER,
            created_by_name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (customer_id) REFERENCES customers(id),
            FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
        )''', 'customer_subscriptions')

        # Subscription plan items table
        safe_exec('''CREATE TABLE IF NOT EXISTS subscription_plan_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            product_name TEXT,
            variant_id INTEGER,
            variant_name TEXT,
            quantity INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id)
        )''', 'subscription_plan_items')

        # Subscription redemptions table
        safe_exec('''CREATE TABLE IF NOT EXISTS subscription_redemptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subscription_id INTEGER NOT NULL,
            customer_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            product_name TEXT,
            variant_id INTEGER,
            variant_name TEXT,
            quantity INTEGER NOT NULL DEFAULT 1,
            redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            redeemed_by INTEGER,
            redeemed_by_name TEXT,
            FOREIGN KEY (subscription_id) REFERENCES customer_subscriptions(id),
            FOREIGN KEY (product_id) REFERENCES products(id)
        )''', 'subscription_redemptions')

        # Default loyalty settings
        try:
            cursor.execute("SELECT COUNT(*) FROM settings WHERE key = 'loyalty_points_per_invoice'")
            if cursor.fetchone()[0] == 0:
                cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('loyalty_points_per_invoice', '10')")
                cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('loyalty_point_value', '0.1')")
                cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('loyalty_enabled', 'true')")
                conn.commit()
        except Exception as e:
            print(f"[Migration] loyalty settings: {e}")

        # Default low stock threshold setting
        try:
            cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('low_stock_threshold', '5')")
            conn.commit()
        except Exception as e:
            print(f"[Migration] low_stock_threshold setting: {e}")

        # Fix old invoices that don't have branch_id
        try:
            cursor.execute('''
                UPDATE invoices SET branch_id = (
                    SELECT b.id FROM branches b WHERE b.name = invoices.branch_name LIMIT 1
                )
                WHERE branch_id IS NULL AND branch_name IS NOT NULL AND branch_name != ''
            ''')
            # Invoices without branch_name either - assign to main branch
            cursor.execute('''
                UPDATE invoices SET branch_id = 1
                WHERE branch_id IS NULL
            ''')
            conn.commit()
        except Exception as e:
            print(f"[Migration] fix invoices branch_id: {e}")

        print(f"[Migration] Done: {db_path}")
    except Exception as e:
        print(f"[Migration] Error: {e}")
    finally:
        conn.close()
