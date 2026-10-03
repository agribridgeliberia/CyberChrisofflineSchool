const path = require('path')
const fs = require('fs')
const sqlite3 = require('sqlite3').verbose()
const bcrypt = require('bcryptjs')
const crypto = require('crypto')

const electron = process.versions.electron ? require('electron') : null
const SCHEMA_PATH = path.join(__dirname, 'schema.sql')
const OPERATIONAL_TABLES = ['students', 'academic_years', 'semesters', 'classes', 'student_accounts', 'student_obligations', 'payments', 'expenses', 'fee_templates', 'fee_template_phases', 'fee_template_items']
const CONFIGURATION_TABLES = ['users', 'school_profile', 'audit_logs', 'expense_categories', 'fee_types', 'fee_groups', 'class_fee_groups', 'fee_structures', 'payment_schedules']

function getDatabasePath() {
  if (electron && electron.app && electron.app.isPackaged) return path.join(electron.app.getPath('userData'), 'school.db')
  return path.join(__dirname, 'school.db')
}

function canonicalClassName(value) {
  const text = String(value || '').trim()
  const match = text.match(/^(?:grade|gr\.?)[\s.]*(\d+)$/i) || text.match(/^(\d+)$/)
  return match ? `Gr. ${match[1]}` : text
}

async function backupDatabase(destination) {
  if (path.resolve(destination) === path.resolve(getDatabasePath())) return { success: false, error: 'Choose a separate file for the school records backup.' }
  try { await fs.promises.unlink(destination) } catch (error) { if (error.code !== 'ENOENT') return { success: false, error: error.message } }
  const sourceDb = new sqlite3.Database(getDatabasePath())
  const backupDb = new sqlite3.Database(destination)
  try {
    await run(backupDb, 'PRAGMA foreign_keys = OFF')
    await run(backupDb, 'CREATE TABLE backup_manifest (table_name TEXT PRIMARY KEY, schema_sql TEXT NOT NULL, row_count INTEGER NOT NULL)')
    for (const table of OPERATIONAL_TABLES) {
      const schemaRows = await all(sourceDb, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [table])
      if (!schemaRows.length) continue
      await run(backupDb, schemaRows[0].sql.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '))
      const columns = await all(sourceDb, `PRAGMA table_info(${table})`)
      const rows = await all(sourceDb, `SELECT * FROM ${table}`)
      const names = columns.map(column => `"${column.name.replace(/"/g, '""')}"`).join(', ')
      const placeholders = columns.map(() => '?').join(', ')
      for (const row of rows) await run(backupDb, `INSERT INTO ${table} (${names}) VALUES (${placeholders})`, columns.map(column => row[column.name]))
    }
    await run(backupDb, 'DELETE FROM backup_manifest')
    for (const table of OPERATIONAL_TABLES) {
      const schemaRows = await all(sourceDb, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [table])
      if (schemaRows.length) await run(backupDb, `INSERT INTO backup_manifest VALUES (?, ?, (SELECT COUNT(*) FROM ${table}))`, [table, schemaRows[0].sql])
    }
    await closeDatabase(sourceDb); await closeDatabase(backupDb)
    return { success: true, filePath: destination, tables: OPERATIONAL_TABLES }
  } catch (err) {
    try { await closeDatabase(sourceDb) } catch (_) {}; try { await closeDatabase(backupDb) } catch (_) {}
    return { success: false, error: err.message }
  }
}

async function restoreDatabase(source) {
  const target = getDatabasePath()
  let backupDb
  const db = new sqlite3.Database(target)
  const safetyBackup = `${target}.pre-restore-${Date.now()}.db`
  try {
    if (path.resolve(source) === path.resolve(target)) throw new Error('Choose an operational records backup, not the currently open database.')
    backupDb = new sqlite3.Database(source)
    const manifest = await all(backupDb, 'SELECT table_name, schema_sql FROM backup_manifest')
    if (!manifest.length || manifest.some(row => !OPERATIONAL_TABLES.includes(row.table_name))) throw new Error('Invalid backup: operational table manifest is missing or contains unauthorized tables.')
    for (const table of OPERATIONAL_TABLES) {
      const exists = await all(backupDb, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table])
      if (!exists.length) throw new Error(`Invalid backup: required table ${table} is missing.`)
    }
    const integrity = await all(backupDb, 'PRAGMA integrity_check')
    if (!integrity.length || integrity[0].integrity_check !== 'ok') throw new Error('The selected backup failed SQLite integrity validation.')
    const safetyResult = await backupDatabase(safetyBackup)
    if (!safetyResult.success) throw new Error(`Could not create a safety backup before restoring: ${safetyResult.error || 'unknown backup error'}`)
    await closeDatabase(backupDb)
    backupDb = null
    await run(db, `ATTACH DATABASE ? AS backup`, [source])
    const sourceTables = new Set(manifest.map(row => row.table_name))
    const restoreColumns = new Map()
    for (const table of OPERATIONAL_TABLES) {
      const sourceColumns = await all(db, `PRAGMA backup.table_info(${table})`)
      const targetColumns = await all(db, `PRAGMA main.table_info(${table})`)
      if (!sourceTables.has(table)) throw new Error(`Invalid backup: required table ${table} is missing.`)
      const sourceNames = new Set(sourceColumns.map(column => column.name))
      const sharedColumns = targetColumns.filter(column => sourceNames.has(column.name))
      const missingRequired = targetColumns.find(column =>
        !sourceNames.has(column.name) && column.notnull && column.dflt_value === null && !column.pk
      )
      if (missingRequired) throw new Error(`Incompatible backup schema for table ${table}: required field ${missingRequired.name} is missing and has no default.`)
      if (!sharedColumns.length) throw new Error(`Incompatible backup schema for table ${table}: no compatible fields were found.`)
      // SQL constraints may evolve (for example, ON DELETE CASCADE) while the stored
      // columns and records remain compatible. Copy shared fields into the current schema.
      restoreColumns.set(table, sharedColumns.map(column => column.name))
    }
    await run(db, 'PRAGMA foreign_keys = OFF')
    await run(db, 'BEGIN IMMEDIATE TRANSACTION')
    for (const table of [...OPERATIONAL_TABLES].reverse()) await run(db, `DELETE FROM ${table}`)
    for (const table of OPERATIONAL_TABLES) {
      const names = restoreColumns.get(table).map(name => `"${name.replace(/"/g, '""')}"`).join(', ')
      await run(db, `INSERT INTO ${table} (${names}) SELECT ${names} FROM backup.${table}`)
    }
    await run(db, 'PRAGMA foreign_keys = ON')
    const currentIntegrity = await all(db, 'PRAGMA integrity_check')
    if (!currentIntegrity.length || currentIntegrity[0].integrity_check !== 'ok') throw new Error('Restored records failed integrity validation.')
    await run(db, 'COMMIT')
    await run(db, 'DETACH DATABASE backup')
    await closeDatabase(backupDb); await closeDatabase(db)
    return { success: true, safetyBackup }
  } catch (err) {
    try { await run(db, 'ROLLBACK') } catch (_) {}
    try { await run(db, 'DETACH DATABASE backup') } catch (_) {}
    if (backupDb) { try { await closeDatabase(backupDb) } catch (_) {} }; try { await closeDatabase(db) } catch (_) {}
    return { success: false, error: err.message }
  }
}

function run(db, sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) return reject(err)
      resolve(this)
    })
  })
}

function all(db, sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err)
      resolve(rows)
    })
  })
}

function closeDatabase(db) {
  return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()))
}

async function init() {
  const db = new sqlite3.Database(getDatabasePath())

  // Always run schema (CREATE TABLE IF NOT EXISTS ...) to ensure missing tables are created
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8')
  await new Promise((resolve, reject) => {
    db.exec(schema, (err) => err ? reject(err) : resolve())
  })
  const itemColumns = await all(db, 'PRAGMA table_info(fee_template_items)')
  if (!itemColumns.some(column => column.name === 'phase_id')) await run(db, 'ALTER TABLE fee_template_items ADD COLUMN phase_id INTEGER')
  const obligationColumns = await all(db, 'PRAGMA table_info(student_obligations)')
  if (!obligationColumns.some(column => column.name === 'phase')) await run(db, "ALTER TABLE student_obligations ADD COLUMN phase TEXT NOT NULL DEFAULT 'First Semester'")

  // Legacy fee structures are no longer used; student obligations remain preserved snapshots.
  await run(db, 'DELETE FROM fee_structures')
  await run(db, 'DELETE FROM payment_schedules')
  await run(db, 'DELETE FROM class_fee_groups')
  await run(db, 'DELETE FROM fee_groups')
  await run(db, 'DELETE FROM fee_types')
  const classRows = await all(db, 'SELECT name FROM classes')
  for (const row of classRows) {
    const canonical = canonicalClassName(row.name)
    if (canonical && canonical !== row.name) {
      const canonicalClass = await all(db, 'SELECT name FROM classes WHERE name = ?', [canonical])
      await run(db, 'UPDATE students SET class_name = ? WHERE class_name = ?', [canonical, row.name])
      const oldTemplates = await all(db, 'SELECT id FROM fee_templates WHERE class_name = ?', [row.name])
      const canonicalTemplates = await all(db, 'SELECT id FROM fee_templates WHERE class_name = ?', [canonical])
      if (!canonicalTemplates.length && oldTemplates.length) await run(db, 'UPDATE fee_templates SET class_name = ? WHERE class_name = ?', [canonical, row.name])
      else if (canonicalTemplates.length && oldTemplates.length) await run(db, 'DELETE FROM fee_templates WHERE class_name = ?', [row.name])
      if (canonicalClass.length) await run(db, 'DELETE FROM classes WHERE name = ?', [row.name])
      else await run(db, 'UPDATE classes SET name = ? WHERE name = ?', [canonical, row.name])
    }
  }
  const studentClassRows = await all(db, 'SELECT DISTINCT class_name FROM students')
  for (const row of studentClassRows) {
    const canonical = canonicalClassName(row.class_name)
    if (canonical && canonical !== row.class_name) await run(db, 'UPDATE students SET class_name = ? WHERE class_name = ?', [canonical, row.class_name])
  }
  const templateClassRows = await all(db, 'SELECT DISTINCT class_name FROM fee_templates')
  for (const row of templateClassRows) {
    const canonical = canonicalClassName(row.class_name)
    if (canonical && canonical !== row.class_name) await run(db, 'UPDATE fee_templates SET class_name = ? WHERE class_name = ?', [canonical, row.class_name])
  }
  const existingTemplates = await all(db, 'SELECT id FROM fee_templates')
  for (const template of existingTemplates) {
    await run(db, `INSERT OR IGNORE INTO fee_template_phases (template_id, phase, created_at, updated_at) VALUES (?, 'First Semester', ?, ?)`, [template.id, new Date().toISOString(), new Date().toISOString()])
    await run(db, `INSERT OR IGNORE INTO fee_template_phases (template_id, phase, created_at, updated_at) VALUES (?, 'Second Semester', ?, ?)`, [template.id, new Date().toISOString(), new Date().toISOString()])
    await run(db, `UPDATE fee_template_items SET phase_id = (SELECT id FROM fee_template_phases WHERE template_id = ? AND phase = 'First Semester') WHERE template_id = ? AND phase_id IS NULL`, [template.id, template.id])
  }
  const itemTable = await all(db, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'fee_template_items'")
  if (itemTable[0]?.sql?.includes('UNIQUE (template_id, fee_name)')) {
    await run(db, 'PRAGMA foreign_keys = OFF')
    await run(db, 'BEGIN TRANSACTION')
    try {
      await run(db, `CREATE TABLE fee_template_items_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL,
        phase_id INTEGER NOT NULL,
        fee_name TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (template_id, phase_id, fee_name),
        FOREIGN KEY (template_id) REFERENCES fee_templates(id) ON DELETE CASCADE
      )`)
      await run(db, `INSERT INTO fee_template_items_new (id, template_id, phase_id, fee_name, amount_cents, created_at, updated_at)
        SELECT id, template_id, phase_id, fee_name, amount_cents, created_at, updated_at FROM fee_template_items WHERE phase_id IS NOT NULL`)
      await run(db, 'DROP TABLE fee_template_items')
      await run(db, 'ALTER TABLE fee_template_items_new RENAME TO fee_template_items')
      await run(db, 'COMMIT')
      await run(db, 'PRAGMA foreign_keys = ON')
    } catch (error) {
      try { await run(db, 'ROLLBACK') } catch (_) {}
      await run(db, 'PRAGMA foreign_keys = ON')
      throw error
    }
  }

  // Ensure there's at least one user (default admin) if users table is empty
  try {
    const rows = await all(db, 'SELECT COUNT(*) as cnt FROM users', [])
    const count = (rows && rows[0] && rows[0].cnt) ? rows[0].cnt : 0
    if (count === 0) {
      const now = new Date().toISOString()
      const defaultUser = 'admin'
      const defaultPass = 'admin123'
      const hash = bcrypt.hashSync(defaultPass, 10)
      await run(db, 'INSERT OR IGNORE INTO users (username, password_hash, role, created_at) VALUES (?,?,?,?)', [defaultUser, hash, 'admin', now])
    }
  } catch (err) {
    // if the users table doesn't exist yet, ignore here because schema was just applied
  }

  await syncExistingStudentAccounts(db)

  db.close()
  return true
}

async function verifyUser(username, password) {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const rows = await all(db, 'SELECT id, username, password_hash, role, created_at FROM users WHERE username = ?', [username])
    db.close()
    if (!rows || rows.length === 0) return { success: false, error: 'User not found' }
    const u = rows[0]
    const ok = bcrypt.compareSync(password, u.password_hash)
    if (!ok) return { success: false, error: 'Invalid credentials' }
    return { success: true, user: { id: u.id, username: u.username, role: u.role, created_at: u.created_at } }
  } catch (err) {
    db.close()
    return { success: false, error: err.message }
  }
}

async function createUser(username, password, role='admin') {
  const db = new sqlite3.Database(getDatabasePath())
  const now = new Date().toISOString()
  const hash = bcrypt.hashSync(password, 10)
  try {
    const res = await run(db, 'INSERT INTO users (username, password_hash, role, created_at) VALUES (?,?,?,?)', [username, hash, role, now])
    db.close()
    return { success: true, lastID: res.lastID }
  } catch (err) {
    db.close()
    return { success: false, error: err.message }
  }
}

async function changePassword(userId, currentPassword, newPassword) {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    if (!currentPassword || !newPassword || newPassword.length < 8) return { success: false, error: 'New password must be at least 8 characters.' }
    const rows = await all(db, 'SELECT password_hash FROM users WHERE id = ?', [userId])
    if (!rows.length || !bcrypt.compareSync(currentPassword, rows[0].password_hash)) return { success: false, error: 'Current password is incorrect.' }
    const hash = bcrypt.hashSync(newPassword, 10)
    await run(db, 'UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId])
    db.close()
    return { success: true }
  } catch (err) {
    db.close()
    return { success: false, error: err.message }
  }
}

async function getSchoolProfile() {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const rows = await all(db, 'SELECT school_name, address, motto, logo_data FROM school_profile WHERE id = 1')
    db.close()
    return { success: true, profile: rows[0] || { school_name: 'CyberChris Offline School', address: '', motto: '', logo_data: '' } }
  } catch (err) {
    db.close()
    return { success: false, error: err.message }
  }
}

async function saveSchoolProfile(profile) {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const schoolName = String(profile.school_name || '').trim()
    if (!schoolName) return { success: false, error: 'School name is required.' }
    await run(db, `INSERT INTO school_profile (id, school_name, address, motto, logo_data, updated_at) VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET school_name = excluded.school_name, address = excluded.address, motto = excluded.motto, logo_data = excluded.logo_data, updated_at = excluded.updated_at`, [schoolName, String(profile.address || '').trim(), String(profile.motto || '').trim(), String(profile.logo_data || ''), new Date().toISOString()])
    db.close()
    return { success: true }
  } catch (err) {
    db.close()
    return { success: false, error: err.message }
  }
}

async function generateStudentId(academicYear) {
  const db = new sqlite3.Database(getDatabasePath())
  const row = await all(db, 'SELECT student_id FROM students WHERE academic_year = ? ORDER BY id DESC LIMIT 1', [academicYear])
  db.close()
  let next = 1
  if (row && row.length > 0) {
    const last = row[0].student_id
    const parts = last.split('-')
    const num = parseInt(parts[2], 10)
    if (!isNaN(num)) next = num + 1
  }
  const id = `STU-${academicYear}-${String(next).padStart(4, '0')}`
  return id
}

async function addStudent(student) {
  const db = new sqlite3.Database(getDatabasePath())
  const sql = `INSERT INTO students (
    student_id, full_name, date_of_birth, place_of_birth, gender, class_name, student_type,
    emergency_contact_name, emergency_contact_relationship, emergency_contact_phone, emergency_contact_address,
    has_disability, disability_type, support_needed, registration_date, academic_year, status, created_at, updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  const now = new Date().toISOString()
  const params = [
    student.student_id, student.full_name, student.date_of_birth, student.place_of_birth, student.gender, student.class_name, student.student_type,
    student.emergency_contact_name, student.emergency_contact_relationship, student.emergency_contact_phone, student.emergency_contact_address,
    student.has_disability ? 1 : 0, student.disability_type || null, student.support_needed || null, student.registration_date, student.academic_year, student.status || 'Active', now, now
  ]
  try {
    await run(db, 'BEGIN TRANSACTION')
    const res = await run(db, sql, params)
    const accountResult = await ensureStudentAccount(db, student)
    if (!accountResult.created) throw new Error('Create a fee template for this class before registering the student.')
    await run(db, 'COMMIT')
    db.close()
    return { success: true, lastID: res.lastID }
  } catch (err) {
    try { await run(db, 'ROLLBACK') } catch (_) {}
    db.close()
    return { success: false, error: err.message }
  }
}

async function ensureStudentAccount(db, student) {
  const yearRows = await all(db, 'SELECT id FROM academic_years WHERE name = ?', [student.academic_year])
  const templateRows = await all(db, `SELECT id FROM fee_templates
    WHERE lower(trim(class_name)) = lower(trim(?))
       OR replace(lower(trim(class_name)), 'grade ', '') = replace(lower(trim(?)), 'grade ', '')`, [student.class_name, student.class_name])
  if (!yearRows.length || !templateRows.length) return { created: false, reason: 'No configured academic year or class fee template' }
  const yearId = yearRows[0].id
  await run(db, 'INSERT OR IGNORE INTO student_accounts (student_id, academic_year_id, created_at) VALUES (?,?,?)', [student.student_id, yearId, new Date().toISOString()])
  const accounts = await all(db, 'SELECT id FROM student_accounts WHERE student_id = ? AND academic_year_id = ?', [student.student_id, yearId])
  if (!accounts.length) return { created: false, reason: 'Account could not be created' }
  const obligationCount = await all(db, 'SELECT COUNT(*) AS count FROM student_obligations WHERE account_id = ?', [accounts[0].id])
  if (obligationCount[0].count === 0) {
    const templateItems = await all(db, `SELECT fee_name, amount_cents, fee_template_phases.phase FROM fee_template_items
      JOIN fee_templates ON fee_templates.id = fee_template_items.template_id
      JOIN fee_template_phases ON fee_template_phases.id = fee_template_items.phase_id
      WHERE lower(trim(fee_templates.class_name)) = lower(trim(?))
         OR replace(lower(trim(fee_templates.class_name)), 'grade ', '') = replace(lower(trim(?)), 'grade ', '')
      ORDER BY fee_template_items.id`, [student.class_name, student.class_name])
    if (templateItems.length) {
      for (const item of templateItems) await run(db, 'INSERT INTO student_obligations (account_id, phase, fee_type_name, description, amount_cents, created_at) VALUES (?,?,?,?,?,?)', [accounts[0].id, item.phase, item.fee_name, 'Class fee template', item.amount_cents, new Date().toISOString()])
    }
  }
  return { created: true, accountId: accounts[0].id }
}

async function syncExistingStudentAccounts(db) {
  const students = await all(db, 'SELECT student_id, class_name, academic_year FROM students WHERE status != ? OR status IS NULL', ['Archived'])
  for (const student of students) await ensureStudentAccount(db, student)
}

async function getStudentFinancialAccount(studentId, academicYear) {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    let accountRows = await all(db, `SELECT student_accounts.id, student_accounts.student_id, student_accounts.academic_year_id, academic_years.name AS academic_year, students.full_name, students.class_name, students.gender, class_fee_groups.fee_group_id
      FROM student_accounts JOIN academic_years ON academic_years.id = student_accounts.academic_year_id JOIN students ON students.student_id = student_accounts.student_id
      LEFT JOIN class_fee_groups ON class_fee_groups.class_name = students.class_name
      WHERE student_accounts.student_id = ? AND academic_years.name = ?`, [studentId, academicYear])
    if (!accountRows.length) {
      const studentRows = await all(db, 'SELECT student_id, class_name, academic_year FROM students WHERE student_id = ?', [studentId])
      if (!studentRows.length) { db.close(); return { success: false, error: 'Student not found.' } }
      const student = studentRows[0]
      if (student.academic_year !== academicYear) { db.close(); return { success: false, error: `This student belongs to academic year ${student.academic_year}, not ${academicYear}.` } }
      const accountResult = await ensureStudentAccount(db, student)
      if (!accountResult.created) {
        db.close()
        return { success: false, error: `Financial account unavailable: ${accountResult.reason || `create a fee template for class ${student.class_name} first`}.` }
      }
      accountRows = await all(db, `SELECT student_accounts.id, student_accounts.student_id, student_accounts.academic_year_id, academic_years.name AS academic_year, students.full_name, students.class_name, students.gender, class_fee_groups.fee_group_id
        FROM student_accounts JOIN academic_years ON academic_years.id = student_accounts.academic_year_id JOIN students ON students.student_id = student_accounts.student_id
        LEFT JOIN class_fee_groups ON class_fee_groups.class_name = students.class_name
        WHERE student_accounts.student_id = ? AND academic_years.name = ?`, [studentId, academicYear])
    }
    const account = accountRows[0]
    const totals = await all(db, `SELECT COALESCE((SELECT SUM(amount_cents) FROM student_obligations WHERE account_id = ?), 0) AS obligation,
      COALESCE((SELECT SUM(amount_cents) FROM payments WHERE account_id = ? AND status = 'VALID'), 0) AS paid`, [account.id, account.id])
    const payments = await all(db, 'SELECT id, receipt_number, amount_cents, payment_method, payment_date, reference_number, note, status FROM payments WHERE account_id = ? ORDER BY id DESC', [account.id])
    const totalsRow = totals[0] || { obligation: 0, paid: 0 }
    const phaseRows = await all(db, `SELECT phase, SUM(amount_cents) AS obligation FROM student_obligations WHERE account_id = ? GROUP BY phase ORDER BY CASE phase WHEN 'First Semester' THEN 1 ELSE 2 END`, [account.id])
    let remainingPaid = Number(totalsRow.paid || 0)
    const phases = phaseRows.map(phase => { const paid = Math.min(Number(phase.obligation), remainingPaid); remainingPaid -= paid; return { ...phase, paid, balance: Number(phase.obligation) - paid } })
    const schedules = account.fee_group_id ? await all(db, `SELECT label, installment_number, amount_cents, due_date
      FROM payment_schedules WHERE academic_year_id = ? AND fee_group_id = ? ORDER BY installment_number`, [account.academic_year_id, account.fee_group_id]) : []
    db.close()
    return { success: true, account, totals: { ...totalsRow, balance: Math.max(0, totalsRow.obligation - totalsRow.paid) }, phases, schedules, payments }
  } catch (err) {
    db.close()
    return { success: false, error: err.message }
  }
}

async function recordPayment(payment, receivedBy) {
  const db = new sqlite3.Database(getDatabasePath())
  const methods = ['Cash', 'Mobile Money', 'Bank', 'Check', 'Other']
  const amountCents = Number(payment.amount_cents)
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return { success: false, error: 'Payment amount must be greater than zero.' }
  if (!methods.includes(payment.payment_method)) return { success: false, error: 'Select a valid payment method.' }
  if (!payment.payment_date) return { success: false, error: 'Payment date is required.' }

  try {
    await run(db, 'BEGIN IMMEDIATE TRANSACTION')
    const accountRows = await all(db, `SELECT student_accounts.id, COALESCE((SELECT SUM(amount_cents) FROM student_obligations WHERE account_id = student_accounts.id), 0) AS obligation,
      COALESCE((SELECT SUM(amount_cents) FROM payments WHERE account_id = student_accounts.id AND status = 'VALID'), 0) AS paid
      FROM student_accounts JOIN academic_years ON academic_years.id = student_accounts.academic_year_id
      WHERE student_accounts.student_id = ? AND academic_years.name = ?`, [payment.student_id, payment.academic_year])
    if (!accountRows.length) throw new Error('Financial account not found for the selected academic year.')
    const account = accountRows[0]
    const outstanding = Math.max(0, account.obligation - account.paid)
    if (amountCents > outstanding) throw new Error(`Payment exceeds the outstanding balance of ${outstanding} cents.`)

    const receiptNumber = `RCPT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`
    const now = new Date().toISOString()
    await run(db, `INSERT INTO payments (account_id, receipt_number, amount_cents, payment_method, payment_date, reference_number, note, received_by, status, created_at)
      VALUES (?,?,?,?,?,?,?,?, 'VALID', ?)`, [account.id, receiptNumber, amountCents, payment.payment_method, payment.payment_date, payment.reference_number || null, payment.note || null, receivedBy || null, now])
    await run(db, `INSERT INTO audit_logs (user_id, entity_type, entity_id, action, details, created_at)
      VALUES (?, 'PAYMENT', (SELECT id FROM payments WHERE receipt_number = ?), 'CREATE', ?, ?)`, [receivedBy || null, receiptNumber, JSON.stringify({ amount_cents: amountCents, payment_method: payment.payment_method }), now])
    await run(db, 'COMMIT')
    db.close()
    return { success: true, receipt_number: receiptNumber, previous_balance: outstanding, new_balance: outstanding - amountCents }
  } catch (err) {
    try { await run(db, 'ROLLBACK') } catch (_) {}
    db.close()
    return { success: false, error: err.message.includes('exceeds') ? err.message.replace(' cents.', '') : err.message }
  }
}

async function correctPayment(correction, correctedBy) {
  const db = new sqlite3.Database(getDatabasePath())
  const paymentId = Number(correction.payment_id)
  const amountCents = Number(correction.amount_cents)
  const methods = ['Cash', 'Mobile Money', 'Bank', 'Check', 'Other']
  const reason = String(correction.reason || '').trim()
  if (!Number.isSafeInteger(paymentId) || paymentId <= 0) return { success: false, error: 'Select a valid payment.' }
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return { success: false, error: 'Payment amount must be greater than zero.' }
  if (!methods.includes(correction.payment_method)) return { success: false, error: 'Select a valid payment method.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(correction.payment_date || ''))) return { success: false, error: 'Enter a valid payment date.' }
  if (!reason) return { success: false, error: 'A correction reason is required.' }
  if (reason.length > 500) return { success: false, error: 'Correction reason must be 500 characters or fewer.' }

  try {
    await run(db, 'BEGIN IMMEDIATE TRANSACTION')
    const paymentRows = await all(db, `SELECT payments.*, students.student_id AS old_student_id, students.full_name AS old_student_name,
        academic_years.name AS old_academic_year
      FROM payments
      JOIN student_accounts ON student_accounts.id = payments.account_id
      JOIN students ON students.student_id = student_accounts.student_id
      JOIN academic_years ON academic_years.id = student_accounts.academic_year_id
      WHERE payments.id = ?`, [paymentId])
    if (!paymentRows.length) throw new Error('Payment not found.')
    const oldPayment = paymentRows[0]
    if (oldPayment.status !== 'VALID') throw new Error('Only valid payments can be corrected.')

    const targetRows = await all(db, `SELECT student_accounts.id AS account_id, students.student_id, students.full_name,
        students.class_name, academic_years.name AS academic_year,
        COALESCE((SELECT SUM(amount_cents) FROM student_obligations WHERE account_id = student_accounts.id), 0) AS obligation,
        COALESCE((SELECT SUM(amount_cents) FROM payments WHERE account_id = student_accounts.id AND status = 'VALID' AND id != ?), 0) AS other_paid
      FROM student_accounts
      JOIN students ON students.student_id = student_accounts.student_id
      JOIN academic_years ON academic_years.id = student_accounts.academic_year_id
      WHERE students.student_id = ? AND academic_years.name = ?`, [paymentId, String(correction.student_id || '').trim(), String(correction.academic_year || '').trim()])
    if (!targetRows.length) throw new Error('The selected student has no financial account for that academic year.')
    const target = targetRows[0]
    const available = Math.max(0, Number(target.obligation || 0) - Number(target.other_paid || 0))
    if (amountCents > available) throw new Error(`Corrected amount exceeds this student's available balance of L$${(available / 100).toFixed(2)}.`)

    const now = new Date().toISOString()
    const before = {
      student_id: oldPayment.old_student_id, student_name: oldPayment.old_student_name,
      academic_year: oldPayment.old_academic_year, amount_cents: Number(oldPayment.amount_cents),
      payment_method: oldPayment.payment_method, payment_date: oldPayment.payment_date,
      reference_number: oldPayment.reference_number, note: oldPayment.note, status: oldPayment.status
    }
    const after = {
      student_id: target.student_id, student_name: target.full_name, academic_year: target.academic_year,
      amount_cents: amountCents, payment_method: correction.payment_method,
      payment_date: String(correction.payment_date), reference_number: String(correction.reference_number || '').trim() || null,
      note: String(correction.note || '').trim() || null, status: 'VALID'
    }
    await run(db, `UPDATE payments SET account_id = ?, amount_cents = ?, payment_method = ?, payment_date = ?, reference_number = ?, note = ? WHERE id = ?`,
      [target.account_id, amountCents, after.payment_method, after.payment_date, after.reference_number, after.note, paymentId])
    await run(db, `INSERT INTO audit_logs (user_id, entity_type, entity_id, action, details, created_at)
      VALUES (?, 'PAYMENT', ?, 'CORRECT', ?, ?)`, [correctedBy || null, paymentId, JSON.stringify({ reason, before, after }), now])
    await run(db, 'COMMIT')
    db.close()
    return { success: true, receipt_number: oldPayment.receipt_number, student: target, amount_cents: amountCents }
  } catch (err) {
    try { await run(db, 'ROLLBACK') } catch (_) {}
    db.close()
    return { success: false, error: err.message }
  }
}

async function listStudents(opts={}) {
  const db = new sqlite3.Database(getDatabasePath())
  let where = []
  let params = []
  if (opts.query) {
    where.push('(student_id LIKE ? OR full_name LIKE ?)')
    params.push(`%${opts.query}%`, `%${opts.query}%`)
  }
  if (opts.class_name) { where.push('class_name = ?'); params.push(opts.class_name) }
  if (opts.status) { where.push('status = ?'); params.push(opts.status) }
  const q = `SELECT * FROM students ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`
  const rows = await all(db, q, params)
  db.close()
  return rows
}

async function updateStudent(student) {
  const db = new sqlite3.Database(getDatabasePath())
  const sql = `UPDATE students SET
    full_name = ?, date_of_birth = ?, place_of_birth = ?, gender = ?, class_name = ?, student_type = ?,
    emergency_contact_name = ?, emergency_contact_relationship = ?, emergency_contact_phone = ?, emergency_contact_address = ?,
    has_disability = ?, disability_type = ?, support_needed = ?, status = ?, updated_at = ?
    WHERE student_id = ?`
  const now = new Date().toISOString()
  const params = [
    student.full_name, student.date_of_birth, student.place_of_birth, student.gender, student.class_name, student.student_type,
    student.emergency_contact_name, student.emergency_contact_relationship, student.emergency_contact_phone, student.emergency_contact_address,
    student.has_disability ? 1 : 0, student.disability_type || null, student.support_needed || null, student.status || 'Active', now,
    student.student_id
  ]
  try {
    await run(db, sql, params)
    db.close()
    return { success: true }
  } catch (err) {
    db.close()
    return { success: false, error: err.message }
  }
}

/**
 * DELETE STUDENT WITH CASCADING FINANCIAL RECORDS
 * 
 * When a student is permanently deleted, all associated financial records are also deleted:
 * 1. Student profile
 * 2. Student accounts (all years)
 * 3. Obligations (cascade from accounts)
 * 4. Payments (cascade from accounts)
 * 
 * This ensures no orphaned financial records remain in the database.
 * Dashboard calculations will automatically reflect the updated financial position.
 */
async function deleteStudent(studentId) {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    // Get all student_accounts for this student (in case multiple academic years)
    const accountsResult = await all(db, `
      SELECT id FROM student_accounts WHERE student_id = ?
    `, [studentId])
    
    const accountIds = accountsResult.map(row => row.id)
    
    // Manually cascade delete since SQLite constraints don't have ON DELETE CASCADE for all FKs
    // Delete in reverse dependency order
    
    // 1. Delete payments for this student's accounts
    if (accountIds.length > 0) {
      const placeholders = accountIds.map(() => '?').join(',')
      await run(db, `DELETE FROM payments WHERE account_id IN (${placeholders})`, accountIds)
    }
    
    // 2. Delete obligations for this student's accounts (also cascade, but be explicit)
    if (accountIds.length > 0) {
      const placeholders = accountIds.map(() => '?').join(',')
      await run(db, `DELETE FROM student_obligations WHERE account_id IN (${placeholders})`, accountIds)
    }
    
    // 3. Delete student accounts
    await run(db, `DELETE FROM student_accounts WHERE student_id = ?`, [studentId])
    
    // 4. Delete student profile
    await run(db, `DELETE FROM students WHERE student_id = ?`, [studentId])
    
    db.close()
    return { success: true, message: 'Student and all associated financial records permanently deleted.' }
  } catch (err) {
    db.close()
    return { success: false, error: err.message }
  }
}

async function listFinanceSetup() {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const [academicYears, semesters, classes, feeGroups, feeTypes, feeStructures, paymentSchedules, expenseCategories] = await Promise.all([
      all(db, 'SELECT * FROM academic_years ORDER BY name DESC'),
      all(db, 'SELECT semesters.*, academic_years.name AS academic_year FROM semesters JOIN academic_years ON academic_years.id = semesters.academic_year_id ORDER BY academic_years.name DESC, semesters.id'),
      all(db, 'SELECT * FROM classes WHERE is_active = 1 ORDER BY id'),
      all(db, 'SELECT * FROM fee_groups WHERE is_active = 1 ORDER BY id'),
      all(db, 'SELECT * FROM fee_types WHERE is_active = 1 ORDER BY id'),
      all(db, `SELECT fee_structures.*, academic_years.name AS academic_year, semesters.name AS semester, fee_groups.name AS fee_group, fee_types.name AS fee_type FROM fee_structures JOIN academic_years ON academic_years.id = fee_structures.academic_year_id LEFT JOIN semesters ON semesters.id = fee_structures.semester_id JOIN fee_groups ON fee_groups.id = fee_structures.fee_group_id JOIN fee_types ON fee_types.id = fee_structures.fee_type_id ORDER BY academic_years.name DESC, fee_groups.id, semesters.id, fee_types.id`),
      all(db, `SELECT payment_schedules.*, academic_years.name AS academic_year, fee_groups.name AS fee_group FROM payment_schedules JOIN academic_years ON academic_years.id = payment_schedules.academic_year_id JOIN fee_groups ON fee_groups.id = payment_schedules.fee_group_id ORDER BY academic_years.name DESC, fee_groups.id, installment_number`),
      all(db, 'SELECT * FROM expense_categories WHERE is_active = 1 ORDER BY name')
    ])
    db.close()
    const uniqueClasses = Array.from(new Map(classes.map(item => [canonicalClassName(item.name), { ...item, name: canonicalClassName(item.name) }])).values())
    return { academicYears, semesters, classes: uniqueClasses, feeGroups, feeTypes, feeStructures, paymentSchedules, expenseCategories }
  } catch (err) {
    db.close()
    return { academicYears: [], semesters: [], classes: [], feeGroups: [], feeTypes: [], feeStructures: [], paymentSchedules: [], expenseCategories: [], error: err.message }
  }
}

async function listFeeTemplates() {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const templates = await all(db, `SELECT fee_templates.id, fee_templates.class_name,
        COALESCE(SUM(fee_template_items.amount_cents), 0) AS total_cents
      FROM fee_templates LEFT JOIN fee_template_items ON fee_template_items.template_id = fee_templates.id
      GROUP BY fee_templates.id ORDER BY fee_templates.class_name COLLATE NOCASE`)
    for (const template of templates) {
      template.phases = await all(db, 'SELECT id, phase, deadline FROM fee_template_phases WHERE template_id = ? ORDER BY CASE phase WHEN \'First Semester\' THEN 1 ELSE 2 END', [template.id])
      for (const phase of template.phases) {
        phase.items = await all(db, 'SELECT id, fee_name, amount_cents FROM fee_template_items WHERE phase_id = ? ORDER BY id', [phase.id])
        phase.total_cents = phase.items.reduce((total, item) => total + Number(item.amount_cents || 0), 0)
      }
      template.items = template.phases.flatMap(phase => phase.items)
    }
    db.close()
    return { success: true, templates }
  } catch (err) {
    db.close()
    return { success: false, templates: [], error: err.message }
  }
}

async function saveFeeTemplate(template) {
  const db = new sqlite3.Database(getDatabasePath())
  const className = String(template.class_name || '').trim()
  const phases = Array.isArray(template.phases) ? template.phases : []
  const items = phases.flatMap(phase => (Array.isArray(phase.items) ? phase.items : []).map(item => ({ ...item, phase: phase.phase })))
  if (!className || !items.length) return { success: false, error: 'Select a class and add at least one fee item.' }
  if (phases.length !== 2 || !phases.some(phase => phase.phase === 'First Semester') || !phases.some(phase => phase.phase === 'Second Semester')) return { success: false, error: 'Both First Semester and Second Semester are required.' }
  const normalized = items.map(item => ({ fee_name: String(item.fee_name || '').trim(), amount_cents: Number(item.amount_cents), phase: item.phase }))
  if (normalized.some(item => !item.fee_name || !Number.isSafeInteger(item.amount_cents) || item.amount_cents < 0)) return { success: false, error: 'Each fee needs a name and a valid nonnegative amount.' }
  if (new Set(normalized.map(item => `${item.phase}:${item.fee_name.toLowerCase()}`)).size !== normalized.length) return { success: false, error: 'Fee names must be unique within each semester.' }
  try {
    const classRows = await all(db, 'SELECT name FROM classes WHERE name = ? AND is_active = 1', [className])
    if (!classRows.length) throw new Error('Select an active class from the school setup.')
    await run(db, 'BEGIN TRANSACTION')
    const now = new Date().toISOString()
    await run(db, `INSERT INTO fee_templates (class_name, created_at, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(class_name) DO UPDATE SET updated_at = excluded.updated_at`, [className, now, now])
    const templateRows = await all(db, 'SELECT id FROM fee_templates WHERE class_name = ?', [className])
    const templateId = templateRows[0].id
    for (const phase of phases) await run(db, `INSERT INTO fee_template_phases (template_id, phase, deadline, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(template_id, phase) DO UPDATE SET deadline = excluded.deadline, updated_at = excluded.updated_at`, [templateId, phase.phase, phase.deadline || null, now, now])
    const phaseRows = await all(db, 'SELECT id, phase FROM fee_template_phases WHERE template_id = ?', [templateId])
    await run(db, 'DELETE FROM fee_template_items WHERE template_id = ?', [templateId])
    for (const item of normalized) {
      const phase = phaseRows.find(row => row.phase === item.phase)
      await run(db, 'INSERT INTO fee_template_items (template_id, phase_id, fee_name, amount_cents, created_at, updated_at) VALUES (?,?,?,?,?,?)', [templateId, phase.id, item.fee_name, item.amount_cents, now, now])
    }
    await run(db, 'COMMIT')
    db.close()
    return { success: true, templateId }
  } catch (err) {
    try { await run(db, 'ROLLBACK') } catch (_) {}
    db.close()
    return { success: false, error: err.message }
  }
}

async function deleteFeeTemplate(templateId) {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    await run(db, 'DELETE FROM fee_templates WHERE id = ?', [templateId])
    db.close()
    return { success: true }
  } catch (err) {
    db.close()
    return { success: false, error: err.message }
  }
}

async function getFinanceSummary() {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    // Use centralized financial calculation for core stats
    const financials = await calculateFinancialStatistics(db)
    
    // Get additional time-based metrics
    const timeMetrics = await all(db, `
      SELECT
        COALESCE((SELECT SUM(amount_cents) FROM payments WHERE status = 'VALID' AND payment_date = date('now')), 0) AS today_collected,
        COALESCE((SELECT SUM(amount_cents) FROM payments WHERE status = 'VALID' AND strftime('%Y-%m', payment_date) = strftime('%Y-%m', 'now')), 0) AS month_collected
    `)
    
    const recentPayments = await all(db, `
      SELECT payments.receipt_number, payments.amount_cents, payments.payment_method, payments.payment_date,
             students.student_id, students.full_name, students.class_name
      FROM payments
      JOIN student_accounts ON student_accounts.id = payments.account_id
      JOIN students ON students.student_id = student_accounts.student_id
      WHERE payments.status = 'VALID'
      ORDER BY payments.id DESC LIMIT 10
    `)
    
    const time = timeMetrics[0] || { today_collected: 0, month_collected: 0 }
    
    db.close()
    return { 
      summary: { 
        obligations: financials.total_obligated,
        collected: financials.total_collected,
        today_collected: Number(time.today_collected || 0),
        month_collected: Number(time.month_collected || 0),
        expenses: financials.total_expenditure,
        outstanding: financials.outstanding, 
        net_position: financials.net_balance
      }, 
      recentPayments 
    }
  } catch (err) {
    db.close()
    return { 
      summary: { 
        obligations: 0, 
        collected: 0, 
        today_collected: 0, 
        month_collected: 0, 
        expenses: 0, 
        outstanding: 0, 
        net_position: 0 
      }, 
      recentPayments: [], 
      error: err.message 
    }
  }
}

async function listOwingStudents() {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    // Only include ACTIVE students in owing students list
    const rows = await all(db, `SELECT students.student_id, students.full_name, students.class_name, students.academic_year,
        COALESCE(SUM(student_obligations.amount_cents), 0) AS obligation,
        COALESCE((SELECT SUM(amount_cents) FROM payments WHERE payments.account_id = student_accounts.id AND payments.status = 'VALID'), 0) AS paid
      FROM students
      JOIN student_accounts ON student_accounts.student_id = students.student_id
      JOIN student_obligations ON student_obligations.account_id = student_accounts.id
      WHERE students.status = 'Active'
      GROUP BY student_accounts.id
      HAVING obligation - paid > 0
      ORDER BY students.full_name COLLATE NOCASE`)
    db.close()
    return { success: true, students: rows.map(row => ({ ...row, balance: row.obligation - row.paid })) }
  } catch (err) {
    db.close()
    return { success: false, students: [], error: err.message }
  }
}

async function listFinancialStatusReport(filters = {}) {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const academicYear = String(filters.academic_year || '').trim()
    const phase = String(filters.phase || 'Full Year')
    const className = String(filters.class_name || '').trim()
    const paymentStatus = String(filters.payment_status || 'All')
    if (!academicYear) throw new Error('Select an academic year.')
    if (!['First Semester', 'Second Semester', 'Full Year'].includes(phase)) throw new Error('Select a valid financial period.')
    if (!['All', 'Owing', 'Fully Paid'].includes(paymentStatus)) throw new Error('Select a valid payment status.')

    const rows = await all(db, `SELECT students.student_id, students.full_name, students.class_name,
        student_accounts.id AS account_id,
        student_obligations.phase,
        SUM(student_obligations.amount_cents) AS phase_obligation,
        COALESCE((SELECT SUM(amount_cents) FROM payments WHERE payments.account_id = student_accounts.id AND payments.status = 'VALID'), 0) AS total_paid
      FROM students
      JOIN student_accounts ON student_accounts.student_id = students.student_id
      JOIN academic_years ON academic_years.id = student_accounts.academic_year_id
      JOIN student_obligations ON student_obligations.account_id = student_accounts.id
      WHERE students.status = 'Active' AND academic_years.name = ?
        AND (? = '' OR students.class_name = ?)
      GROUP BY student_accounts.id, student_obligations.phase
      ORDER BY students.class_name COLLATE NOCASE, students.full_name COLLATE NOCASE`,
    [academicYear, className, className])

    const accounts = new Map()
    for (const row of rows) {
      if (!accounts.has(row.account_id)) accounts.set(row.account_id, {
        student_id: row.student_id, full_name: row.full_name, class_name: row.class_name,
        phases: { 'First Semester': 0, 'Second Semester': 0 }, total_paid: Number(row.total_paid || 0)
      })
      if (Object.prototype.hasOwnProperty.call(accounts.get(row.account_id).phases, row.phase)) {
        accounts.get(row.account_id).phases[row.phase] += Number(row.phase_obligation || 0)
      }
    }

    const reportRows = []
    for (const student of accounts.values()) {
      let remainingPaid = student.total_paid
      const phaseDetails = {}
      for (const name of ['First Semester', 'Second Semester']) {
        const obligated = student.phases[name]
        const paid = Math.min(obligated, remainingPaid)
        remainingPaid -= paid
        phaseDetails[name] = { obligated, paid, balance: Math.max(0, obligated - paid) }
      }
      const totals = phase === 'Full Year'
        ? { obligated: student.phases['First Semester'] + student.phases['Second Semester'], paid: student.total_paid, balance: Math.max(0, student.phases['First Semester'] + student.phases['Second Semester'] - student.total_paid) }
        : phaseDetails[phase]
      if (totals.obligated <= 0) continue
      if (paymentStatus === 'Owing' && totals.balance <= 0) continue
      if (paymentStatus === 'Fully Paid' && totals.balance > 0) continue
      reportRows.push({ student_id: student.student_id, full_name: student.full_name, class_name: student.class_name, ...totals })
    }
    db.close()
    return { success: true, students: reportRows }
  } catch (err) {
    db.close()
    return { success: false, students: [], error: err.message }
  }
}

async function listExpenses() {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const rows = await all(db, `SELECT id, category, description, amount_cents, payment_method, reference_number, expense_date, note, status, created_at
      FROM expenses
      WHERE status = 'VALID'
      ORDER BY expense_date DESC, id DESC`)
    db.close()
    return { success: true, expenses: rows }
  } catch (err) {
    db.close()
    return { success: false, expenses: [], error: err.message }
  }
}

async function recordExpense(expense, recordedBy) {
  const db = new sqlite3.Database(getDatabasePath())
  const methods = ['Cash', 'Mobile Money', 'Bank', 'Check', 'Other']
  const amountCents = Number(expense.amount_cents)
  const category = String(expense.category || '').trim()
  const description = String(expense.description || '').trim()
  const method = String(expense.payment_method || 'Cash').trim()
  const expenseDate = String(expense.expense_date || '').trim()

  if (!category) return { success: false, error: 'Expense category is required.' }
  if (!description) return { success: false, error: 'Expense description is required.' }
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return { success: false, error: 'Expense amount must be greater than zero.' }
  if (!methods.includes(method)) return { success: false, error: 'Select a valid payment method.' }
  if (!expenseDate) return { success: false, error: 'Expense date is required.' }

  try {
    await run(db, 'INSERT OR IGNORE INTO expense_categories (name, is_active, created_at) VALUES (?, 1, ?)', [category, new Date().toISOString()])
    const now = new Date().toISOString()
    const result = await run(db, `INSERT INTO expenses (category, description, amount_cents, payment_method, reference_number, expense_date, recorded_by, status, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'VALID', ?, ?)`, [category, description, amountCents, method, expense.reference_number || null, expenseDate, recordedBy || null, expense.note || null, now])
    db.close()
    return { success: true, id: result.lastID }
  } catch (err) {
    db.close()
    return { success: false, error: err.message }
  }
}

/**
 * ===== CENTRALIZED FINANCIAL STATISTICS CALCULATION =====
 * 
 * This is the SINGLE SOURCE OF TRUTH for all financial calculations.
 * Called by getDashboardSummary() and getFinanceSummary()
 * 
 * Key Rules:
 * - Obligated = SUM of obligations from ACTIVE students only
 * - Collected = SUM of VALID payments (all-time, independent of student status)
 * - Expenditure = SUM of VALID expenses
 * - Outstanding = Obligated - Collected (can be negative)
 * - Net Balance = Collected - Expenditure
 * 
 * Percentages:
 * - Collection Rate = (Collected ÷ Obligated) × 100; if Obligated=0, show 0%
 * - Outstanding Rate = (Outstanding ÷ Obligated) × 100; if Obligated=0, show 0%
 * - Expenditure Rate = (Expenditure ÷ Collected) × 100; if Collected=0, show 0%
 * - Net Balance Rate = (Net Balance ÷ Collected) × 100; if Collected=0, show 0%
 */
/**
 * CENTRALIZED FINANCIAL STATISTICS CALCULATION
 * 
 * ARCHITECTURAL PRINCIPLE:
 * No student account → no obligation → no collection → no balance
 * 
 * When students are permanently deleted:
 * - Their accounts cascade-delete (payments, obligations deleted with account)
 * - All associated financial records are removed
 * - Dashboard recalculates from remaining active students only
 * - No orphaned records exist
 * 
 * Financial Position:
 * - Obligated = SUM(obligations) from existing student accounts
 * - Collected = SUM(payments) from existing student accounts
 * - Outstanding = Obligated - Collected
 * - Expenditure = school-wide expenses (independent of students)
 * - Net Balance = Collected - Expenditure
 * 
 * Examples:
 * - 0 students → all financial metrics = 0
 * - 3 students with 15K obligated, 9K collected → Outstanding = 6K
 * - Delete 1 student (who paid fully) → Obligated drops by their fees, Collected drops by their payments
 */
async function calculateFinancialStatistics(db) {
  try {
    // Calculate Obligated from ALL existing student accounts
    // Obligation is owned by the student account; if account deleted, obligation gone
    const obligatedResult = await all(db, `
      SELECT COALESCE(SUM(so.amount_cents), 0) AS total_obligated
      FROM student_obligations so
      JOIN student_accounts sa ON so.account_id = sa.id
      WHERE 1=1
    `)
    
    const totalObligation = Number(obligatedResult[0]?.total_obligated || 0)
    
    // Calculate Collected from existing student accounts
    // Payments belong to student accounts; deleted accounts have no payments
    const collectedResult = await all(db, `
      SELECT COALESCE(SUM(p.amount_cents), 0) AS total_collected
      FROM payments p
      JOIN student_accounts sa ON p.account_id = sa.id
      WHERE p.status = 'VALID'
    `)
    
    const totalCollected = Number(collectedResult[0]?.total_collected || 0)
    
    // Expenses are INDEPENDENT school-wide costs
    // NOT tied to student accounts (separate financial stream)
    // Keep as-is regardless of student count
    const expenditureResult = await all(db, `
      SELECT COALESCE(SUM(amount_cents), 0) AS total_expenditure
      FROM expenses
      WHERE status = 'VALID'
    `)
    
    const totalExpenditure = Number(expenditureResult[0]?.total_expenditure || 0)
    
    // Calculate derived values
    const outstanding = totalObligation - totalCollected
    const netBalance = totalCollected - totalExpenditure
    
    // Calculate percentages with zero-division safety
    const collectionRate = totalObligation > 0 ? (totalCollected / totalObligation) * 100 : 0
    const outstandingRate = totalObligation > 0 ? (outstanding / totalObligation) * 100 : 0
    const expenditureRate = totalCollected > 0 ? (totalExpenditure / totalCollected) * 100 : 0
    const netBalanceRate = totalCollected > 0 ? (netBalance / totalCollected) * 100 : 0
    
    return {
      total_obligated: totalObligation,
      total_collected: totalCollected,
      total_expenditure: totalExpenditure,
      outstanding: outstanding,
      net_balance: netBalance,
      // Percentages
      collection_rate: collectionRate,
      outstanding_rate: outstandingRate,
      expenditure_rate: expenditureRate,
      net_balance_rate: netBalanceRate
    }
  } catch (err) {
    console.error('[ERROR] calculateFinancialStatistics:', err.message)
    return {
      total_obligated: 0,
      total_collected: 0,
      total_expenditure: 0,
      outstanding: 0,
      net_balance: 0,
      collection_rate: 0,
      outstanding_rate: 0,
      expenditure_rate: 0,
      net_balance_rate: 0
    }
  }
}

async function getDashboardSummary() {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    // Use centralized financial calculation
    const financials = await calculateFinancialStatistics(db)
    
    const genderRows = await all(db, `
      SELECT gender, COUNT(*) as count FROM students WHERE status = 'Active' GROUP BY gender
    `)
    
    const classRows = await all(db, `
      SELECT class_name, COUNT(*) as count FROM students WHERE status = 'Active' GROUP BY class_name ORDER BY class_name
    `)
    
    const genderDistribution = {}
    genderRows.forEach(row => {
      genderDistribution[row.gender] = row.count
    })
    
    const classList = classRows.map(row => ({ class: row.class_name, students: row.count }))
    
    db.close()
    return { 
      success: true, 
      summary: {
        total_obligated: financials.total_obligated,
        total_collected: financials.total_collected,
        total_expenditure: financials.total_expenditure,
        outstanding: financials.outstanding,
        net_balance: financials.net_balance,
        collection_rate: financials.collection_rate,
        outstanding_rate: financials.outstanding_rate,
        expenditure_rate: financials.expenditure_rate,
        net_balance_rate: financials.net_balance_rate,
        // Legacy field for backward compatibility
        balance: financials.net_balance
      },
      genderDistribution,
      classList
    }
  } catch (err) {
    db.close()
    return { 
      success: false, 
      summary: { 
        total_obligated: 0, 
        total_collected: 0, 
        total_expenditure: 0, 
        outstanding: 0,
        net_balance: 0,
        collection_rate: 0,
        outstanding_rate: 0,
        expenditure_rate: 0,
        net_balance_rate: 0,
        balance: 0 
      },
      genderDistribution: {},
      classList: [],
      error: err.message 
    }
  }
}

module.exports = {
  init,
  backupDatabase,
  restoreDatabase,
  generateStudentId,
  addStudent,
  listStudents,
  updateStudent,
  deleteStudent,
  verifyUser, createUser, changePassword, getSchoolProfile, saveSchoolProfile,
  listFinanceSetup,
  listFeeTemplates,
  saveFeeTemplate,
  deleteFeeTemplate,
  calculateFinancialStatistics,
  getFinanceSummary,
  listOwingStudents,
  listFinancialStatusReport,
  listExpenses,
  recordExpense,
  getDashboardSummary,
  getStudentFinancialAccount,
  recordPayment,
  correctPayment
}
