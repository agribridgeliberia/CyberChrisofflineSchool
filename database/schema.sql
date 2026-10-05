PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  place_of_birth TEXT NOT NULL,
  gender TEXT NOT NULL,
  class_name TEXT NOT NULL,
  student_type TEXT NOT NULL,
  emergency_contact_name TEXT NOT NULL,
  emergency_contact_relationship TEXT NOT NULL,
  emergency_contact_phone TEXT NOT NULL,
  emergency_contact_address TEXT,
  has_disability INTEGER NOT NULL DEFAULT 0,
  disability_type TEXT,
  support_needed TEXT,
  registration_date TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_student_id ON students(student_id);
CREATE INDEX IF NOT EXISTS idx_full_name ON students(full_name);
CREATE INDEX IF NOT EXISTS idx_class_name ON students(class_name);
CREATE INDEX IF NOT EXISTS idx_academic_year ON students(academic_year);
CREATE INDEX IF NOT EXISTS idx_status ON students(status);

-- Users table for basic authentication (Phase 1)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS vouchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_code TEXT NOT NULL UNIQUE,
  license_type TEXT NOT NULL,
  duration_months INTEGER NOT NULL CHECK (duration_months > 0),
  is_used INTEGER NOT NULL DEFAULT 0 CHECK (is_used IN (0, 1)),
  used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'NOT_ACTIVATED', 'INVALID', 'SUSPENDED')),
  activated_at TEXT NOT NULL,
  last_checked_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS developer_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS license_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  license_type TEXT NOT NULL,
  voucher_code TEXT,
  activated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vouchers_code ON vouchers(voucher_code);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_license_history_activated ON license_history(activated_at);

CREATE TABLE IF NOT EXISTS school_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  school_name TEXT NOT NULL DEFAULT 'CyberChris Offline School',
  address TEXT,
  motto TEXT,
  logo_data TEXT,
  updated_at TEXT NOT NULL
);

-- Finance foundation. Obligations and payments are preserved as historical records.
CREATE TABLE IF NOT EXISTS academic_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS semesters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  academic_year_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  starts_on TEXT,
  ends_on TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (academic_year_id, name),
  FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fee_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS class_fee_groups (
  class_name TEXT PRIMARY KEY,
  fee_group_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (fee_group_id) REFERENCES fee_groups(id)
);

CREATE TABLE IF NOT EXISTS fee_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (class_name) REFERENCES classes(name)
);

CREATE TABLE IF NOT EXISTS fee_template_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  phase_id INTEGER NOT NULL,
  fee_name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (template_id, phase_id, fee_name),
  FOREIGN KEY (template_id) REFERENCES fee_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fee_template_phases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('First Semester', 'Second Semester')),
  deadline TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (template_id, phase),
  FOREIGN KEY (template_id) REFERENCES fee_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fee_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fee_structures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  academic_year_id INTEGER NOT NULL,
  semester_id INTEGER,
  fee_group_id INTEGER NOT NULL,
  fee_type_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (academic_year_id, semester_id, fee_group_id, fee_type_id),
  FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  FOREIGN KEY (semester_id) REFERENCES semesters(id),
  FOREIGN KEY (fee_group_id) REFERENCES fee_groups(id),
  FOREIGN KEY (fee_type_id) REFERENCES fee_types(id)
);

CREATE TABLE IF NOT EXISTS payment_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  academic_year_id INTEGER NOT NULL,
  fee_group_id INTEGER NOT NULL,
  installment_number INTEGER NOT NULL,
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  due_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (academic_year_id, fee_group_id, installment_number),
  FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  FOREIGN KEY (fee_group_id) REFERENCES fee_groups(id)
);

CREATE TABLE IF NOT EXISTS student_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL,
  academic_year_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (student_id, academic_year_id),
  FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
  FOREIGN KEY (academic_year_id) REFERENCES academic_years(id)
);

CREATE TABLE IF NOT EXISTS student_obligations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  phase TEXT NOT NULL DEFAULT 'First Semester' CHECK (phase IN ('First Semester', 'Second Semester')),
  fee_type_name TEXT NOT NULL,
  description TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES student_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  receipt_number TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  payment_method TEXT NOT NULL DEFAULT 'Cash',
  payment_date TEXT NOT NULL,
  reference_number TEXT,
  note TEXT,
  received_by INTEGER,
  status TEXT NOT NULL DEFAULT 'VALID' CHECK (status IN ('VALID', 'VOIDED', 'RECALLED')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES student_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (received_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  payment_method TEXT NOT NULL DEFAULT 'Cash',
  reference_number TEXT,
  expense_date TEXT NOT NULL,
  recorded_by INTEGER,
  status TEXT NOT NULL DEFAULT 'VALID' CHECK (status IN ('VALID', 'VOID')),
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (recorded_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_semesters_year ON semesters(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_fee_structures_year_group ON fee_structures(academic_year_id, fee_group_id);
CREATE INDEX IF NOT EXISTS idx_schedules_year_group ON payment_schedules(academic_year_id, fee_group_id);
CREATE INDEX IF NOT EXISTS idx_accounts_student ON student_accounts(student_id);
CREATE INDEX IF NOT EXISTS idx_obligations_account ON student_obligations(account_id);
CREATE INDEX IF NOT EXISTS idx_payments_account_date ON payments(account_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_status_date ON payments(status, payment_date);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);

-- Editable starter setup for the current school year.
INSERT OR IGNORE INTO academic_years (name, is_current, created_at) VALUES ('2026', 1, datetime('now'));
INSERT OR IGNORE INTO semesters (academic_year_id, name, created_at)
  SELECT id, 'First Semester', datetime('now') FROM academic_years WHERE name = '2026';
INSERT OR IGNORE INTO semesters (academic_year_id, name, created_at)
  SELECT id, 'Second Semester', datetime('now') FROM academic_years WHERE name = '2026';

INSERT OR IGNORE INTO classes (name, created_at) VALUES
  ('Nursery', datetime('now')), ('KG 1', datetime('now')), ('KG 2', datetime('now')),
  ('Gr. 1', datetime('now')), ('Gr. 2', datetime('now')), ('Gr. 3', datetime('now')),
  ('Gr. 4', datetime('now')), ('Gr. 5', datetime('now')), ('Gr. 6', datetime('now')),
  ('Gr. 7', datetime('now')), ('Gr. 8', datetime('now')), ('Gr. 9', datetime('now')),
  ('Gr. 10', datetime('now')), ('Gr. 11', datetime('now')), ('Gr. 12', datetime('now'));

CREATE INDEX IF NOT EXISTS idx_fee_template_items_template ON fee_template_items(template_id);
CREATE INDEX IF NOT EXISTS idx_fee_template_phases_template ON fee_template_phases(template_id);

INSERT OR IGNORE INTO expense_categories (name, created_at) VALUES
  ('Supplies', datetime('now')), ('Utilities', datetime('now')), ('Transport', datetime('now')),
  ('Maintenance', datetime('now')), ('Other', datetime('now'));

