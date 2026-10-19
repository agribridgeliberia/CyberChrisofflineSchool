const path = require('path')
const fs = require('fs')
const sqlite3 = require('sqlite3').verbose()
const bcrypt = require('bcryptjs')
const DEVELOPER_MASTER_PASSWORD = 'P@$$w0rd'
const crypto = require('crypto')
const PORTABLE_VOUCHER_SECRET = 'offline-school-voucher-signing-key-v1'

const electron = process.versions.electron ? require('electron') : null
const SCHEMA_PATH = path.join(__dirname, 'schema.sql')
const OPERATIONAL_TABLES = ['students', 'academic_years', 'classes', 'semesters', 'teachers', 'subjects', 'teacher_subjects', 'student_enrollments', 'promotion_history', 'timetable_entries', 'calendar_events', 'student_accounts', 'student_obligations', 'payments', 'expenses', 'fee_templates', 'fee_template_phases', 'fee_template_items']
const CONFIGURATION_TABLES = ['users', 'school_profile', 'audit_logs', 'expense_categories', 'fee_types', 'fee_groups', 'class_fee_groups', 'fee_structures', 'payment_schedules']

function getDatabasePath() {
  if (process.env.SCHOOL_DB_PATH) return process.env.SCHOOL_DB_PATH
  if (electron && electron.app && electron.app.isPackaged) return path.join(electron.app.getPath('userData'), 'school.db')
  return path.join(__dirname, 'school.db')
}

function toDateInputString(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addMonths(date, monthsToAdd) {
  const result = new Date(date.getTime())
  const targetMonth = result.getMonth() + monthsToAdd
  result.setMonth(targetMonth)
  return result
}

function normalizeVoucherCode(voucherCode) {
  return String(voucherCode || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '')
}

function createPortableVoucherCode(durationMonths) {
  const durationCode = { 1: '1', 6: '6', 10: 'A', 12: 'C' }[durationMonths]
  const payload = `V1${durationCode}${crypto.randomBytes(10).toString('hex').toUpperCase()}`
  const signature = crypto.createHmac('sha256', PORTABLE_VOUCHER_SECRET).update(payload).digest('hex').slice(0, 16).toUpperCase()
  return `${payload}${signature}`
}

function readPortableVoucherCode(code) {
  const match = code.match(/^V1([16AC])([A-F0-9]{20})([A-F0-9]{16})$/)
  if (!match) return null
  const payload = code.slice(0, -16)
  const expectedSignature = crypto.createHmac('sha256', PORTABLE_VOUCHER_SECRET).update(payload).digest('hex').slice(0, 16).toUpperCase()
  const suppliedSignature = Buffer.from(match[3], 'hex')
  const expected = Buffer.from(expectedSignature, 'hex')
  if (!crypto.timingSafeEqual(suppliedSignature, expected)) return null
  return { durationMonths: { 1: 1, 6: 6, A: 10, C: 12 }[match[1]], licenseType: 'Standard' }
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
    const sourceTables = new Set(manifest.map(row => row.table_name))
    if (!manifest.length || !sourceTables.has('students') || manifest.some(row => !OPERATIONAL_TABLES.includes(row.table_name))) throw new Error('Invalid backup: operational table manifest is missing, incomplete, or contains unauthorized tables.')
    for (const table of sourceTables) {
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
    const restoreColumns = new Map()
    for (const table of OPERATIONAL_TABLES) {
      if (!sourceTables.has(table)) continue
      const sourceColumns = await all(db, `PRAGMA backup.table_info(${table})`)
      const targetColumns = await all(db, `PRAGMA main.table_info(${table})`)
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
      if (!sourceTables.has(table)) continue
      const names = restoreColumns.get(table).map(name => `"${name.replace(/"/g, '""')}"`).join(', ')
      await run(db, `INSERT INTO ${table} (${names}) SELECT ${names} FROM backup.${table}`)
    }
    await run(db, 'PRAGMA foreign_keys = ON')
    const currentIntegrity = await all(db, 'PRAGMA integrity_check')
    if (!currentIntegrity.length || currentIntegrity[0].integrity_check !== 'ok') throw new Error('Restored records failed integrity validation.')
    await run(db, 'COMMIT')
    await run(db, 'DETACH DATABASE backup')
    await closeDatabase(db)
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
  const academicYearColumns = await all(db, 'PRAGMA table_info(academic_years)')
  if (!academicYearColumns.some(column => column.name === 'starts_on')) await run(db, 'ALTER TABLE academic_years ADD COLUMN starts_on TEXT')
  if (!academicYearColumns.some(column => column.name === 'ends_on')) await run(db, 'ALTER TABLE academic_years ADD COLUMN ends_on TEXT')
  if (!academicYearColumns.some(column => column.name === 'status')) await run(db, "ALTER TABLE academic_years ADD COLUMN status TEXT NOT NULL DEFAULT 'UPCOMING'")
  if (!academicYearColumns.some(column => column.name === 'updated_at')) await run(db, "ALTER TABLE academic_years ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''")
  const classColumns = await all(db, 'PRAGMA table_info(classes)')
  if (!classColumns.some(column => column.name === 'sort_order')) await run(db, 'ALTER TABLE classes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0')
  if (!classColumns.some(column => column.name === 'next_class_name')) await run(db, 'ALTER TABLE classes ADD COLUMN next_class_name TEXT')
  if (!classColumns.some(column => column.name === 'updated_at')) await run(db, "ALTER TABLE classes ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''")
  const accountColumns = await all(db, 'PRAGMA table_info(student_accounts)')
  if (!accountColumns.some(column => column.name === 'class_name')) await run(db, "ALTER TABLE student_accounts ADD COLUMN class_name TEXT NOT NULL DEFAULT ''")
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
  const now = new Date().toISOString()
  await run(db, `INSERT OR IGNORE INTO academic_years (name, is_current, status, created_at, updated_at)
    SELECT DISTINCT academic_year, 0, 'UPCOMING', ?, ? FROM students WHERE trim(academic_year) != ''`, [now, now])
  await run(db, `INSERT OR IGNORE INTO classes (name, is_active, created_at, updated_at)
    SELECT DISTINCT class_name, 1, ?, ? FROM students WHERE trim(class_name) != ''`, [now, now])
  const currentYears = await all(db, 'SELECT id FROM academic_years WHERE is_current = 1 ORDER BY id DESC')
  for (const year of currentYears.slice(1)) await run(db, 'UPDATE academic_years SET is_current = 0 WHERE id = ?', [year.id])
  await run(db, `UPDATE academic_years SET
    status = CASE WHEN is_current = 1 THEN 'CURRENT' WHEN status = 'CLOSED' THEN 'CLOSED' ELSE 'UPCOMING' END,
    updated_at = CASE WHEN updated_at = '' THEN created_at ELSE updated_at END`)
  await run(db, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_year_one_current ON academic_years(is_current) WHERE is_current = 1')
  await run(db, 'UPDATE classes SET sort_order = id WHERE sort_order = 0')
  await run(db, "UPDATE classes SET updated_at = created_at WHERE updated_at = ''")
  const classesWithProgression = await all(db, 'SELECT COUNT(*) AS count FROM classes WHERE next_class_name IS NOT NULL')
  if (classesWithProgression[0].count === 0) {
    const orderedClasses = await all(db, 'SELECT name FROM classes ORDER BY sort_order, id')
    for (let index = 0; index < orderedClasses.length; index += 1) {
      await run(db, 'UPDATE classes SET next_class_name = ? WHERE name = ?', [orderedClasses[index + 1]?.name || null, orderedClasses[index].name])
    }
  }
  await run(db, `UPDATE student_accounts SET class_name = (
    SELECT students.class_name FROM students WHERE students.student_id = student_accounts.student_id
  ) WHERE class_name = ''`)
  await run(db, `INSERT OR IGNORE INTO student_enrollments
    (student_id, academic_year_id, class_name, status, decision, created_at, updated_at)
    SELECT student_accounts.student_id, student_accounts.academic_year_id, student_accounts.class_name,
      'ACTIVE', 'ENROLLED', student_accounts.created_at, student_accounts.created_at
    FROM student_accounts WHERE student_accounts.class_name != ''`)
  await run(db, `INSERT OR IGNORE INTO student_enrollments
    (student_id, academic_year_id, class_name, status, decision, created_at, updated_at)
    SELECT students.student_id, academic_years.id, students.class_name, 'ACTIVE', 'ENROLLED',
      students.created_at, students.updated_at
    FROM students JOIN academic_years ON academic_years.name = students.academic_year`)
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

async function getDeveloperCredentialStatus() {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const rows = await all(db, 'SELECT id FROM developer_credentials WHERE id = 1')
    return { success: true, configured: true }
  } catch (error) {
    return { success: false, configured: false, error: error.message }
  } finally {
    db.close()
  }
}

async function setupDeveloperCredential(username, adminPassword, developerPassword) {
  const normalizedUsername = String(username || '').trim()
  if (!normalizedUsername || !adminPassword) return { success: false, error: 'Enter the administrator username and password.' }
  if (!developerPassword || developerPassword.length < 8) return { success: false, error: 'Developer Screen password must be at least 8 characters.' }

  const db = new sqlite3.Database(getDatabasePath())
  try {
    const selectedAdmin = await all(db, "SELECT password_hash FROM users WHERE username = ? AND lower(role) = 'admin'", [normalizedUsername])
    if (!selectedAdmin.length || !bcrypt.compareSync(adminPassword, selectedAdmin[0].password_hash)) {
      return { success: false, error: 'Administrator credentials are invalid.' }
    }
    const admins = await all(db, "SELECT password_hash FROM users WHERE lower(role) = 'admin'")
    if (admins.some(admin => bcrypt.compareSync(developerPassword, admin.password_hash))) {
      return { success: false, error: 'Choose a Developer Screen password different from the administrator password.' }
    }
    const existing = await all(db, 'SELECT id FROM developer_credentials WHERE id = 1')
    if (existing.length) return { success: false, error: 'Developer Screen password is already configured.' }
    const now = new Date().toISOString()
    await run(db, 'INSERT INTO developer_credentials (id, password_hash, updated_at) VALUES (1, ?, ?)', [bcrypt.hashSync(developerPassword, 10), now])
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  } finally {
    db.close()
  }
}

async function verifyDeveloperCredential(password) {
  if (String(password || '') === DEVELOPER_MASTER_PASSWORD) return { success: true }
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const rows = await all(db, 'SELECT password_hash FROM developer_credentials WHERE id = 1')
    if (!rows.length || !bcrypt.compareSync(String(password || ''), rows[0].password_hash)) {
      return { success: false, error: 'Developer Screen password is incorrect.' }
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  } finally {
    db.close()
  }
}

async function changeDeveloperCredential(currentPassword, newPassword) {
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return { success: false, error: 'New Developer Screen password must be at least 8 characters.' }
  }
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const current = await all(db, 'SELECT password_hash FROM developer_credentials WHERE id = 1')
    if (!current.length || !bcrypt.compareSync(currentPassword, current[0].password_hash)) {
      return { success: false, error: 'Current Developer Screen password is incorrect.' }
    }
    const admins = await all(db, "SELECT password_hash FROM users WHERE lower(role) = 'admin'")
    if (admins.some(admin => bcrypt.compareSync(newPassword, admin.password_hash))) {
      return { success: false, error: 'Choose a Developer Screen password different from every administrator password.' }
    }
    await run(db, 'UPDATE developer_credentials SET password_hash = ?, updated_at = ? WHERE id = 1', [bcrypt.hashSync(newPassword, 10), new Date().toISOString()])
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  } finally {
    db.close()
  }
}

async function createUser(username, password, role='admin') {
  const db = new sqlite3.Database(getDatabasePath())
  const now = new Date().toISOString()
  const hash = bcrypt.hashSync(password, 10)
  try {
    if (String(role).toLowerCase() === 'admin') {
      const developer = await all(db, 'SELECT password_hash FROM developer_credentials WHERE id = 1')
      if (developer.length && bcrypt.compareSync(password, developer[0].password_hash)) {
        db.close()
        return { success: false, error: 'Administrator password must differ from the Developer Screen password.' }
      }
    }
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
    const rows = await all(db, 'SELECT password_hash, role FROM users WHERE id = ?', [userId])
    if (!rows.length || !bcrypt.compareSync(currentPassword, rows[0].password_hash)) return { success: false, error: 'Current password is incorrect.' }
    if (String(rows[0].role).toLowerCase() === 'admin') {
      const developer = await all(db, 'SELECT password_hash FROM developer_credentials WHERE id = 1')
      if (developer.length && bcrypt.compareSync(newPassword, developer[0].password_hash)) {
        db.close()
        return { success: false, error: 'Administrator password must differ from the Developer Screen password.' }
      }
    }
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
    const yearRows = await all(db, 'SELECT id FROM academic_years WHERE name = ?', [student.academic_year])
    await run(db, `INSERT OR IGNORE INTO student_enrollments
      (student_id, academic_year_id, class_name, status, decision, created_at, updated_at)
      VALUES (?, ?, ?, 'ACTIVE', 'ENROLLED', ?, ?)`, [student.student_id, yearRows[0].id, student.class_name, now, now])
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
  await run(db, 'INSERT OR IGNORE INTO student_accounts (student_id, academic_year_id, class_name, created_at) VALUES (?,?,?,?)', [student.student_id, yearId, student.class_name, new Date().toISOString()])
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
    let accountRows = await all(db, `SELECT student_accounts.id, student_accounts.student_id, student_accounts.academic_year_id, academic_years.name AS academic_year, students.full_name, student_accounts.class_name, students.gender, class_fee_groups.fee_group_id
      FROM student_accounts JOIN academic_years ON academic_years.id = student_accounts.academic_year_id JOIN students ON students.student_id = student_accounts.student_id
      LEFT JOIN class_fee_groups ON class_fee_groups.class_name = student_accounts.class_name
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
      accountRows = await all(db, `SELECT student_accounts.id, student_accounts.student_id, student_accounts.academic_year_id, academic_years.name AS academic_year, students.full_name, student_accounts.class_name, students.gender, class_fee_groups.fee_group_id
        FROM student_accounts JOIN academic_years ON academic_years.id = student_accounts.academic_year_id JOIN students ON students.student_id = student_accounts.student_id
        LEFT JOIN class_fee_groups ON class_fee_groups.class_name = student_accounts.class_name
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

async function listAcademicYears() {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    return await all(db, `SELECT academic_years.*,
      (SELECT COUNT(*) FROM student_enrollments WHERE academic_year_id = academic_years.id) AS enrollment_count
      FROM academic_years ORDER BY COALESCE(starts_on, name) DESC, id DESC`)
  } finally {
    db.close()
  }
}

async function saveAcademicYear(year = {}) {
  const id = Number(year.id) || null
  const name = String(year.name || '').trim()
  const startsOn = String(year.starts_on || '').trim() || null
  const endsOn = String(year.ends_on || '').trim() || null
  if (!name || name.length > 40) return { success: false, error: 'Enter an academic year label of 40 characters or fewer.' }
  if ((startsOn && !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) || (endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(endsOn))) return { success: false, error: 'Enter valid academic year dates.' }
  if (startsOn && endsOn && startsOn > endsOn) return { success: false, error: 'The end date must be on or after the start date.' }
  const db = new sqlite3.Database(getDatabasePath())
  const now = new Date().toISOString()
  try {
    if (id) {
      const existing = await all(db, 'SELECT id, is_current, status FROM academic_years WHERE id = ?', [id])
      if (!existing.length) throw new Error('Academic year not found.')
      await run(db, `UPDATE academic_years SET name = ?, starts_on = ?, ends_on = ?, updated_at = ? WHERE id = ?`, [name, startsOn, endsOn, now, id])
      if (existing[0].is_current) await run(db, "UPDATE academic_years SET status = 'CURRENT' WHERE id = ?", [id])
    } else {
      await run(db, `INSERT INTO academic_years (name, is_current, starts_on, ends_on, status, created_at, updated_at)
        VALUES (?, 0, ?, ?, 'UPCOMING', ?, ?)`, [name, startsOn, endsOn, now, now])
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message.includes('UNIQUE') ? 'That academic year already exists.' : error.message }
  } finally {
    db.close()
  }
}

async function setAcademicYearStatus(yearId, status) {
  const id = Number(yearId)
  const nextStatus = String(status || '').toUpperCase()
  if (!Number.isInteger(id) || id < 1 || !['CURRENT', 'UPCOMING', 'CLOSED'].includes(nextStatus)) return { success: false, error: 'Select a valid academic year status.' }
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const years = await all(db, 'SELECT id, status FROM academic_years WHERE id = ?', [id])
    if (!years.length) throw new Error('Academic year not found.')
    if (years[0].status === 'CLOSED' && nextStatus !== 'CLOSED') throw new Error('A closed academic year cannot be reopened.')
    await run(db, 'BEGIN IMMEDIATE TRANSACTION')
    const now = new Date().toISOString()
    if (nextStatus === 'CURRENT') {
      await run(db, "UPDATE academic_years SET is_current = 0, status = 'UPCOMING', updated_at = ? WHERE is_current = 1", [now])
      await run(db, "UPDATE academic_years SET is_current = 1, status = 'CURRENT', updated_at = ? WHERE id = ?", [now, id])
    } else {
      await run(db, 'UPDATE academic_years SET is_current = 0, status = ?, updated_at = ? WHERE id = ?', [nextStatus, now, id])
    }
    await run(db, 'COMMIT')
    return { success: true }
  } catch (error) {
    try { await run(db, 'ROLLBACK') } catch (_) {}
    return { success: false, error: error.message }
  } finally {
    db.close()
  }
}

async function listAcademicClasses(includeInactive = false) {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    return await all(db, `SELECT classes.*,
      (SELECT COUNT(*) FROM student_enrollments WHERE class_name = classes.name) AS enrollment_count
      FROM classes ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY sort_order, name COLLATE NOCASE`)
  } finally {
    db.close()
  }
}

async function saveAcademicClass(classData = {}) {
  const id = Number(classData.id) || null
  const name = String(classData.name || '').trim()
  const sortOrder = Number(classData.sort_order)
  const nextClass = String(classData.next_class_name || '').trim() || null
  if (!name || name.length > 60 || !Number.isInteger(sortOrder) || sortOrder < 0) return { success: false, error: 'Enter a class name and a nonnegative order.' }
  const db = new sqlite3.Database(getDatabasePath())
  try {
    if (nextClass === name) throw new Error('A class cannot promote to itself.')
    if (nextClass && !(await all(db, 'SELECT id FROM classes WHERE name = ? AND is_active = 1', [nextClass])).length) throw new Error('Choose an active next class.')
    const now = new Date().toISOString()
    if (id) {
      const existing = await all(db, 'SELECT name FROM classes WHERE id = ?', [id])
      if (!existing.length) throw new Error('Class not found.')
      if (existing[0].name !== name) {
        const counts = await all(db, `SELECT
          (SELECT COUNT(*) FROM students WHERE class_name = ?) +
          (SELECT COUNT(*) FROM student_accounts WHERE class_name = ?) +
          (SELECT COUNT(*) FROM student_enrollments WHERE class_name = ?) +
          (SELECT COUNT(*) FROM fee_templates WHERE class_name = ?) +
          (SELECT COUNT(*) FROM timetable_entries WHERE class_name = ?) +
          (SELECT COUNT(*) FROM promotion_history WHERE from_class_name = ? OR to_class_name = ?) AS total`,
        [existing[0].name, existing[0].name, existing[0].name, existing[0].name, existing[0].name, existing[0].name, existing[0].name])
        if (counts[0].total) throw new Error('This class has linked records. Deactivate it and create a replacement class instead of renaming it.')
      }
      await run(db, `UPDATE classes SET name = ?, is_active = ?, sort_order = ?, next_class_name = ?, updated_at = ? WHERE id = ?`, [name, classData.is_active === false ? 0 : 1, sortOrder, nextClass, now, id])
      if (existing[0].name !== name) await run(db, 'UPDATE classes SET next_class_name = ? WHERE next_class_name = ? AND id != ?', [name, existing[0].name, id])
    } else {
      await run(db, `INSERT INTO classes (name, is_active, sort_order, next_class_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`, [name, classData.is_active === false ? 0 : 1, sortOrder, nextClass, now, now])
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message.includes('UNIQUE') ? 'That class name already exists.' : error.message }
  } finally {
    db.close()
  }
}

async function deleteAcademicClass(classId) {
  const id = Number(classId)
  if (!Number.isInteger(id) || id < 1) return { success: false, error: 'Select a valid class.' }
  const db = new sqlite3.Database(getDatabasePath())
  try {
    await run(db, 'BEGIN IMMEDIATE TRANSACTION')
    const classes = await all(db, 'SELECT name FROM classes WHERE id = ?', [id])
    if (!classes.length) throw new Error('Class not found.')
    const name = classes[0].name
    const references = await all(db, `SELECT
      (SELECT COUNT(*) FROM students WHERE class_name = ?) +
      (SELECT COUNT(*) FROM student_accounts WHERE class_name = ?) +
      (SELECT COUNT(*) FROM student_enrollments WHERE class_name = ?) +
      (SELECT COUNT(*) FROM fee_templates WHERE class_name = ?) +
      (SELECT COUNT(*) FROM timetable_entries WHERE class_name = ?) +
      (SELECT COUNT(*) FROM promotion_history WHERE from_class_name = ? OR to_class_name = ?) AS total`,
    [name, name, name, name, name, name, name])
    if (references[0].total) throw new Error('This class has linked records and cannot be deleted. Deactivate it instead.')
    await run(db, 'UPDATE classes SET next_class_name = NULL WHERE next_class_name = ?', [name])
    await run(db, 'DELETE FROM classes WHERE id = ?', [id])
    await run(db, 'COMMIT')
    return { success: true }
  } catch (error) {
    try { await run(db, 'ROLLBACK') } catch (_) {}
    return { success: false, error: error.message }
  } finally {
    db.close()
  }
}

async function getEnrollmentRoster(academicYearId, className = '') {
  const id = Number(academicYearId)
  if (!Number.isInteger(id) || id < 1) return { success: false, error: 'Select an academic year.', students: [] }
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const students = await all(db, `SELECT student_enrollments.id AS enrollment_id, student_enrollments.student_id,
      student_enrollments.class_name, student_enrollments.status AS enrollment_status, student_enrollments.decision,
      students.full_name, students.gender, students.status AS student_status
      FROM student_enrollments JOIN students ON students.student_id = student_enrollments.student_id
      WHERE student_enrollments.academic_year_id = ? AND (? = '' OR student_enrollments.class_name = ?)
      ORDER BY student_enrollments.class_name COLLATE NOCASE, students.full_name COLLATE NOCASE`, [id, className, className])
    return { success: true, students }
  } catch (error) {
    return { success: false, error: error.message, students: [] }
  } finally {
    db.close()
  }
}

async function promoteStudents(request = {}) {
  const sourceYearId = Number(request.from_academic_year_id)
  const targetYearId = Number(request.to_academic_year_id)
  const decisions = Array.isArray(request.decisions) ? request.decisions : []
  if (!Number.isInteger(sourceYearId) || !Number.isInteger(targetYearId) || sourceYearId === targetYearId) return { success: false, error: 'Choose two different academic years.' }
  if (!decisions.length || decisions.length > 500) return { success: false, error: 'Select between 1 and 500 students to process.' }
  if (new Set(decisions.map(decision => String(decision.student_id || ''))).size !== decisions.length) return { success: false, error: 'A student can only appear once in a promotion batch.' }
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const years = await all(db, 'SELECT id, name, status FROM academic_years WHERE id IN (?, ?)', [sourceYearId, targetYearId])
    const sourceYear = years.find(year => year.id === sourceYearId)
    const targetYear = years.find(year => year.id === targetYearId)
    if (!sourceYear || !targetYear) throw new Error('Academic year not found.')
    if (targetYear.status === 'CLOSED') throw new Error('Cannot enroll students into a closed academic year.')
    const allowedOutcomes = ['PROMOTED', 'RETAINED', 'FAILED', 'TRANSFERRED', 'WITHDRAWN']
    await run(db, 'BEGIN IMMEDIATE TRANSACTION')
    const now = new Date().toISOString()
    for (const decision of decisions) {
      const studentId = String(decision.student_id || '').trim()
      const outcome = String(decision.outcome || 'PROMOTED').toUpperCase()
      const className = String(decision.class_name || '').trim()
      if (!studentId || !allowedOutcomes.includes(outcome)) throw new Error('Each student needs a valid promotion outcome.')
      const source = await all(db, `SELECT student_enrollments.*, students.full_name, students.status AS student_status
        FROM student_enrollments JOIN students ON students.student_id = student_enrollments.student_id
        WHERE student_enrollments.student_id = ? AND student_enrollments.academic_year_id = ?`, [studentId, sourceYearId])
      if (!source.length) throw new Error(`No source-year enrollment found for ${studentId}.`)
      const sourceEnrollment = source[0]
      if (['TRANSFERRED', 'WITHDRAWN'].includes(outcome)) {
        await run(db, 'UPDATE student_enrollments SET status = ?, decision = ?, updated_at = ? WHERE id = ?', [outcome, outcome, now, sourceEnrollment.id])
        await run(db, `INSERT INTO promotion_history (student_id, from_academic_year_id, to_academic_year_id, from_class_name, to_class_name, outcome, notes, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [studentId, sourceYearId, targetYearId, sourceEnrollment.class_name, className || sourceEnrollment.class_name, outcome, String(decision.notes || '').trim() || null, now])
        await run(db, 'UPDATE students SET status = ?, updated_at = ? WHERE student_id = ?', [outcome === 'WITHDRAWN' ? 'Withdrawn' : 'Transferred', now, studentId])
        continue
      }
      if (!className) throw new Error(`Choose a destination class for ${studentId}.`)
      const targetClass = await all(db, 'SELECT name FROM classes WHERE name = ? AND is_active = 1', [className])
      if (!targetClass.length) throw new Error(`Destination class ${className} is not active.`)
      const existingTarget = await all(db, 'SELECT id FROM student_enrollments WHERE student_id = ? AND academic_year_id = ?', [studentId, targetYearId])
      if (existingTarget.length) throw new Error(`${studentId} already has an enrollment in ${targetYear.name}.`)
      const studentForAccount = { student_id: studentId, class_name: className, academic_year: targetYear.name }
      const accountResult = await ensureStudentAccount(db, studentForAccount)
      if (!accountResult.created) throw new Error(`Cannot enroll ${studentId}: add a fee template for ${className} first.`)
      await run(db, `INSERT INTO student_enrollments
        (student_id, academic_year_id, class_name, status, decision, notes, created_at, updated_at)
        VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`, [studentId, targetYearId, className, outcome, String(decision.notes || '').trim() || null, now, now])
      await run(db, 'UPDATE student_enrollments SET status = ?, decision = ?, updated_at = ? WHERE id = ?', [outcome, outcome, now, sourceEnrollment.id])
      await run(db, `INSERT INTO promotion_history (student_id, from_academic_year_id, to_academic_year_id, from_class_name, to_class_name, outcome, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [studentId, sourceYearId, targetYearId, sourceEnrollment.class_name, className, outcome, String(decision.notes || '').trim() || null, now])
      await run(db, 'UPDATE students SET class_name = ?, academic_year = ?, status = \'Active\', updated_at = ? WHERE student_id = ?', [className, targetYear.name, now, studentId])
    }
    await run(db, 'COMMIT')
    return { success: true, processed: decisions.length }
  } catch (error) {
    try { await run(db, 'ROLLBACK') } catch (_) {}
    return { success: false, error: error.message }
  } finally {
    db.close()
  }
}

async function listPromotionHistory(filters = {}) {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const yearId = Number(filters.academic_year_id) || 0
    return await all(db, `SELECT promotion_history.*, students.full_name,
      from_year.name AS from_academic_year, to_year.name AS to_academic_year
      FROM promotion_history JOIN students ON students.student_id = promotion_history.student_id
      JOIN academic_years AS from_year ON from_year.id = promotion_history.from_academic_year_id
      JOIN academic_years AS to_year ON to_year.id = promotion_history.to_academic_year_id
      WHERE (? = 0 OR promotion_history.from_academic_year_id = ? OR promotion_history.to_academic_year_id = ?)
      ORDER BY promotion_history.created_at DESC, promotion_history.id DESC`, [yearId, yearId, yearId])
  } finally {
    db.close()
  }
}

async function listTeachers(query = '') {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const search = String(query || '').trim()
    return await all(db, `SELECT teachers.*,
      GROUP_CONCAT(subjects.name, ', ') AS subjects, GROUP_CONCAT(subjects.id, ',') AS subject_ids
      FROM teachers LEFT JOIN teacher_subjects ON teacher_subjects.teacher_id = teachers.teacher_id
      LEFT JOIN subjects ON subjects.id = teacher_subjects.subject_id
      WHERE (? = '' OR teachers.teacher_id LIKE ? OR teachers.full_name LIKE ? OR teachers.specialization LIKE ?)
      GROUP BY teachers.id ORDER BY teachers.full_name COLLATE NOCASE LIMIT 500`, [search, `%${search}%`, `%${search}%`, `%${search}%`])
  } finally {
    db.close()
  }
}

async function saveTeacher(teacher = {}) {
  const id = Number(teacher.id) || null
  const teacherId = String(teacher.teacher_id || '').trim().toUpperCase()
  const fullName = String(teacher.full_name || '').trim()
  const photoData = String(teacher.photo_data || '').trim() || null
  const subjectIds = Array.isArray(teacher.subject_ids) ? [...new Set(teacher.subject_ids.map(Number).filter(Number.isInteger))] : []
  if (!teacherId || !/^[A-Z0-9-]{2,30}$/.test(teacherId) || !fullName) return { success: false, error: 'Enter a valid teacher ID and full name.' }
  if (photoData && (!/^data:image\/(png|jpeg|webp);base64,/.test(photoData) || photoData.length > 4_000_000)) return { success: false, error: 'Teacher photos must be PNG, JPG, or WebP and under 3 MB.' }
  if (teacher.email && String(teacher.email).length > 254) return { success: false, error: 'Email address is too long.' }
  const db = new sqlite3.Database(getDatabasePath())
  const now = new Date().toISOString()
  try {
    await run(db, 'BEGIN IMMEDIATE TRANSACTION')
    const existingTeacher = await all(db, 'SELECT id, teacher_id FROM teachers WHERE teacher_id = ?', [teacherId])
    if (id) {
      const record = await all(db, 'SELECT id, teacher_id FROM teachers WHERE id = ?', [id])
      if (!record.length) throw new Error('Teacher not found.')
      if (record[0].teacher_id !== teacherId) throw new Error('Teacher ID cannot be changed.')
    } else if (existingTeacher.length) {
      throw new Error('That teacher ID already exists.')
    }
    const subjects = subjectIds.length ? await all(db, `SELECT id FROM subjects WHERE id IN (${subjectIds.map(() => '?').join(',')})`, subjectIds) : []
    if (subjects.length !== subjectIds.length) throw new Error('One or more selected subjects are unavailable.')
    await run(db, `INSERT INTO teachers (teacher_id, full_name, photo_data, gender, phone, email, address, qualification, specialization, employment_status, date_employed, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(teacher_id) DO UPDATE SET full_name = excluded.full_name, photo_data = excluded.photo_data,
      gender = excluded.gender, phone = excluded.phone, email = excluded.email, address = excluded.address,
      qualification = excluded.qualification, specialization = excluded.specialization,
      employment_status = excluded.employment_status, date_employed = excluded.date_employed,
      notes = excluded.notes, updated_at = excluded.updated_at`,
    [teacherId, fullName, photoData, teacher.gender || null, String(teacher.phone || '').trim() || null,
      String(teacher.email || '').trim() || null, String(teacher.address || '').trim() || null,
      String(teacher.qualification || '').trim() || null, String(teacher.specialization || '').trim() || null,
      teacher.employment_status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE', teacher.date_employed || null,
      String(teacher.notes || '').trim() || null, now, now])
    await run(db, 'DELETE FROM teacher_subjects WHERE teacher_id = ?', [teacherId])
    for (const subjectId of subjectIds) await run(db, 'INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)', [teacherId, subjectId])
    await run(db, 'COMMIT')
    return { success: true }
  } catch (error) {
    try { await run(db, 'ROLLBACK') } catch (_) {}
    return { success: false, error: error.message }
  } finally {
    db.close()
  }
}

async function deleteTeacher(teacherId) {
  const id = String(teacherId || '').trim().toUpperCase()
  if (!id) return { success: false, error: 'Select a valid teacher.' }
  const db = new sqlite3.Database(getDatabasePath())
  try {
    await run(db, 'BEGIN IMMEDIATE TRANSACTION')
    const teachers = await all(db, 'SELECT teacher_id FROM teachers WHERE teacher_id = ?', [id])
    if (!teachers.length) throw new Error('Teacher not found.')
    const timetableRows = await all(db, 'SELECT COUNT(*) AS total FROM timetable_entries WHERE teacher_id = ?', [id])
    if (timetableRows[0].total) throw new Error('This teacher has timetable entries and cannot be deleted. Mark the teacher inactive instead.')
    await run(db, 'DELETE FROM teacher_subjects WHERE teacher_id = ?', [id])
    await run(db, 'DELETE FROM teachers WHERE teacher_id = ?', [id])
    await run(db, 'COMMIT')
    return { success: true }
  } catch (error) {
    try { await run(db, 'ROLLBACK') } catch (_) {}
    return { success: false, error: error.message }
  } finally {
    db.close()
  }
}

async function listSubjects(includeInactive = false) {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    return await all(db, `SELECT subjects.*, COUNT(teacher_subjects.teacher_id) AS teacher_count,
      (SELECT COUNT(*) FROM timetable_entries WHERE timetable_entries.subject_id = subjects.id) AS timetable_count
      FROM subjects LEFT JOIN teacher_subjects ON teacher_subjects.subject_id = subjects.id
      ${includeInactive ? '' : 'WHERE subjects.is_active = 1'} GROUP BY subjects.id ORDER BY subjects.name COLLATE NOCASE`)
  } finally {
    db.close()
  }
}

async function saveSubject(subject = {}) {
  const id = Number(subject.id) || null
  const name = String(subject.name || '').trim()
  const shortCode = String(subject.short_code || '').trim().toUpperCase()
  if (!name || name.length > 100 || !/^[A-Z0-9-]{2,12}$/.test(shortCode)) return { success: false, error: 'Enter a subject name and a 2–12 character code.' }
  const db = new sqlite3.Database(getDatabasePath())
  const now = new Date().toISOString()
  try {
    if (id) {
      const existing = await all(db, 'SELECT id FROM subjects WHERE id = ?', [id])
      if (!existing.length) throw new Error('Subject not found.')
      await run(db, 'UPDATE subjects SET name = ?, short_code = ?, description = ?, is_active = ?, updated_at = ? WHERE id = ?', [name, shortCode, String(subject.description || '').trim() || null, subject.is_active === false ? 0 : 1, now, id])
    } else {
      await run(db, 'INSERT INTO subjects (name, short_code, description, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [name, shortCode, String(subject.description || '').trim() || null, subject.is_active === false ? 0 : 1, now, now])
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message.includes('UNIQUE') ? 'Subject name or short code already exists.' : error.message }
  } finally {
    db.close()
  }
}

async function deleteSubject(subjectId) {
  const id = Number(subjectId)
  if (!Number.isInteger(id) || id < 1) return { success: false, error: 'Select a valid subject.' }
  const db = new sqlite3.Database(getDatabasePath())
  try {
    await run(db, 'BEGIN IMMEDIATE TRANSACTION')
    const subjects = await all(db, 'SELECT id FROM subjects WHERE id = ?', [id])
    if (!subjects.length) throw new Error('Subject not found.')
    const references = await all(db, `SELECT
      (SELECT COUNT(*) FROM teacher_subjects WHERE subject_id = ?) +
      (SELECT COUNT(*) FROM timetable_entries WHERE subject_id = ?) AS total`, [id, id])
    if (references[0].total) throw new Error('This subject is assigned to teachers or timetables and cannot be deleted. Deactivate it instead.')
    await run(db, 'DELETE FROM subjects WHERE id = ?', [id])
    await run(db, 'COMMIT')
    return { success: true }
  } catch (error) {
    try { await run(db, 'ROLLBACK') } catch (_) {}
    return { success: false, error: error.message }
  } finally {
    db.close()
  }
}

async function listTimetableEntries(filters = {}) {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    return await all(db, `SELECT timetable_entries.*, academic_years.name AS academic_year,
      teachers.full_name AS teacher_name, teachers.photo_data AS teacher_photo,
      subjects.name AS subject_name, subjects.short_code AS subject_code
      FROM timetable_entries JOIN academic_years ON academic_years.id = timetable_entries.academic_year_id
      JOIN teachers ON teachers.teacher_id = timetable_entries.teacher_id
      JOIN subjects ON subjects.id = timetable_entries.subject_id
      WHERE (? = 0 OR timetable_entries.academic_year_id = ?)
        AND (? = 0 OR timetable_entries.day_of_week = ?)
        AND (? = '' OR timetable_entries.class_name = ?)
        AND (? = '' OR timetable_entries.teacher_id = ?)
        AND (? = 0 OR timetable_entries.subject_id = ?)
      ORDER BY timetable_entries.day_of_week, timetable_entries.start_time, timetable_entries.class_name`,
    [Number(filters.academic_year_id) || 0, Number(filters.academic_year_id) || 0,
      Number(filters.day_of_week) || 0, Number(filters.day_of_week) || 0,
      filters.class_name || '', filters.class_name || '', filters.teacher_id || '', filters.teacher_id || '',
      Number(filters.subject_id) || 0, Number(filters.subject_id) || 0])
  } finally {
    db.close()
  }
}

async function saveTimetableEntry(entry = {}) {
  const id = Number(entry.id) || 0
  const yearId = Number(entry.academic_year_id)
  const day = Number(entry.day_of_week)
  const period = Number(entry.period_number)
  const className = String(entry.class_name || '').trim()
  const teacherId = String(entry.teacher_id || '').trim()
  const subjectId = Number(entry.subject_id)
  const startTime = String(entry.start_time || '').trim()
  const endTime = String(entry.end_time || '').trim()
  const room = String(entry.room || '').trim() || null
  if (!Number.isInteger(yearId) || yearId < 1 || !Number.isInteger(day) || day < 1 || day > 5 || !Number.isInteger(period) || period < 1 || !className || !teacherId || !Number.isInteger(subjectId)) return { success: false, error: 'Complete all required timetable fields.' }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) || startTime >= endTime) return { success: false, error: 'Enter a valid period time range.' }
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const conflicts = await all(db, `SELECT timetable_entries.id, timetable_entries.class_name, timetable_entries.teacher_id,
      timetable_entries.room, teachers.full_name AS teacher_name
      FROM timetable_entries JOIN teachers ON teachers.teacher_id = timetable_entries.teacher_id
      WHERE timetable_entries.academic_year_id = ? AND timetable_entries.day_of_week = ?
        AND (? = 0 OR timetable_entries.id != ?) AND timetable_entries.start_time < ? AND timetable_entries.end_time > ?
        AND (timetable_entries.class_name = ? OR timetable_entries.teacher_id = ? OR (? != '' AND timetable_entries.room = ?))`,
    [yearId, day, id, id, endTime, startTime, className, teacherId, room || '', room || ''])
    if (conflicts.length) {
      const conflict = conflicts[0]
      if (conflict.class_name === className) throw new Error(`${className} already has a class during this time.`)
      if (conflict.teacher_id === teacherId) throw new Error(`${conflict.teacher_name} is already assigned during this time.`)
      throw new Error(`Room ${room} is already assigned during this time.`)
    }
    const now = new Date().toISOString()
    if (id) await run(db, `UPDATE timetable_entries SET academic_year_id = ?, class_name = ?, day_of_week = ?, period_number = ?, start_time = ?, end_time = ?, subject_id = ?, teacher_id = ?, room = ?, updated_at = ? WHERE id = ?`, [yearId, className, day, period, startTime, endTime, subjectId, teacherId, room, now, id])
    else await run(db, `INSERT INTO timetable_entries (academic_year_id, class_name, day_of_week, period_number, start_time, end_time, subject_id, teacher_id, room, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [yearId, className, day, period, startTime, endTime, subjectId, teacherId, room, now, now])
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  } finally {
    db.close()
  }
}

async function deleteTimetableEntry(id) {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const result = await run(db, 'DELETE FROM timetable_entries WHERE id = ?', [Number(id)])
    return result.changes ? { success: true } : { success: false, error: 'Timetable entry not found.' }
  } finally {
    db.close()
  }
}

async function listCalendarEvents(filters = {}) {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    return await all(db, `SELECT calendar_events.*, academic_years.name AS academic_year
      FROM calendar_events LEFT JOIN academic_years ON academic_years.id = calendar_events.academic_year_id
      WHERE (? = 0 OR calendar_events.academic_year_id = ?) AND (? = '' OR calendar_events.category = ?)
        AND (? = '' OR calendar_events.starts_on <= ? AND calendar_events.ends_on >= ?)
        AND (? = 1 OR calendar_events.status = 'SCHEDULED')
      ORDER BY calendar_events.starts_on, calendar_events.start_time, calendar_events.title COLLATE NOCASE`,
    [Number(filters.academic_year_id) || 0, Number(filters.academic_year_id) || 0,
      filters.category || '', filters.category || '', filters.month_end || '', filters.month_end || '',
      filters.month_start || '', filters.include_cancelled ? 1 : 0])
  } finally {
    db.close()
  }
}

async function saveCalendarEvent(event = {}) {
  const id = Number(event.id) || null
  const title = String(event.title || '').trim()
  const startsOn = String(event.starts_on || '').trim()
  const endsOn = String(event.ends_on || '').trim()
  if (!title || title.length > 160 || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn) || startsOn > endsOn) return { success: false, error: 'Enter an event title and a valid date range.' }
  const academicYearId = Number(event.academic_year_id) || null
  const db = new sqlite3.Database(getDatabasePath())
  const now = new Date().toISOString()
  try {
    if (id) await run(db, `UPDATE calendar_events SET academic_year_id = ?, title = ?, category = ?, starts_on = ?, ends_on = ?, start_time = ?, end_time = ?, location = ?, description = ?, status = ?, updated_at = ? WHERE id = ?`, [academicYearId, title, event.category || 'Other', startsOn, endsOn, event.start_time || null, event.end_time || null, String(event.location || '').trim() || null, String(event.description || '').trim() || null, event.status === 'CANCELLED' ? 'CANCELLED' : 'SCHEDULED', now, id])
    else await run(db, `INSERT INTO calendar_events (academic_year_id, title, category, starts_on, ends_on, start_time, end_time, location, description, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [academicYearId, title, event.category || 'Other', startsOn, endsOn, event.start_time || null, event.end_time || null, String(event.location || '').trim() || null, String(event.description || '').trim() || null, event.status === 'CANCELLED' ? 'CANCELLED' : 'SCHEDULED', now, now])
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  } finally {
    db.close()
  }
}

async function deleteCalendarEvent(id) {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const result = await run(db, 'DELETE FROM calendar_events WHERE id = ?', [Number(id)])
    return result.changes ? { success: true } : { success: false, error: 'Calendar event not found.' }
  } finally {
    db.close()
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
              students.student_id, students.full_name, student_accounts.class_name, academic_years.name AS academic_year
      FROM payments
      JOIN student_accounts ON student_accounts.id = payments.account_id
      JOIN students ON students.student_id = student_accounts.student_id
            JOIN academic_years ON academic_years.id = student_accounts.academic_year_id
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
    const rows = await all(db, `SELECT students.student_id, students.full_name, student_accounts.class_name, academic_years.name AS academic_year,
        COALESCE(SUM(student_obligations.amount_cents), 0) AS obligation,
        COALESCE((SELECT SUM(amount_cents) FROM payments WHERE payments.account_id = student_accounts.id AND payments.status = 'VALID'), 0) AS paid
      FROM students
      JOIN student_accounts ON student_accounts.student_id = students.student_id
      JOIN academic_years ON academic_years.id = student_accounts.academic_year_id
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

    const rows = await all(db, `SELECT students.student_id, students.full_name, student_accounts.class_name,
        student_accounts.id AS account_id,
        student_obligations.phase,
        SUM(student_obligations.amount_cents) AS phase_obligation,
        COALESCE((SELECT SUM(amount_cents) FROM payments WHERE payments.account_id = student_accounts.id AND payments.status = 'VALID'), 0) AS total_paid
      FROM students
      JOIN student_accounts ON student_accounts.student_id = students.student_id
      JOIN academic_years ON academic_years.id = student_accounts.academic_year_id
      JOIN student_obligations ON student_obligations.account_id = student_accounts.id
      WHERE students.status = 'Active' AND academic_years.name = ?
        AND (? = '' OR student_accounts.class_name = ?)
      GROUP BY student_accounts.id, student_obligations.phase
      ORDER BY student_accounts.class_name COLLATE NOCASE, students.full_name COLLATE NOCASE`,
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

async function getLicenseState() {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const latest = await all(db, 'SELECT * FROM licenses ORDER BY id DESC LIMIT 1')
    const license = latest && latest[0] ? latest[0] : null
    const nowDate = new Date()
    const today = toDateInputString(nowDate)

    if (!license) {
      return {
        success: true,
        status: 'NOT_ACTIVATED',
        canUseApp: false,
        license_type: null,
        duration_months: null,
        start_date: null,
        end_date: null,
        activated_at: null,
        last_checked_date: today,
        days_remaining: 0,
        message: 'No active license is installed on this computer.'
      }
    }

    const currentDate = new Date(`${today}T00:00:00`)
    const planRows = await all(db, `SELECT license_history.license_type, vouchers.duration_months
      FROM license_history LEFT JOIN vouchers ON vouchers.voucher_code = license_history.voucher_code
      WHERE license_history.activated_at = ? ORDER BY license_history.id DESC LIMIT 1`, [license.activated_at])
    const plan = planRows[0] || {}
    const priorCheck = license.last_checked_date ? new Date(`${license.last_checked_date}T00:00:00`) : null
    const clockRollback = !!(priorCheck && currentDate.getTime() < priorCheck.getTime())
    const endDate = new Date(`${license.end_date}T23:59:59.999`)
    const suspended = String(license.status || '').toUpperCase() === 'SUSPENDED'
    const expired = !suspended && nowDate.getTime() >= endDate.getTime()
    const status = suspended ? 'SUSPENDED' : expired ? 'EXPIRED' : 'ACTIVE'

    await run(db, 'UPDATE licenses SET last_checked_date = ?, updated_at = ? WHERE id = ?', [today, new Date().toISOString(), license.id])

    return {
      success: true,
      status,
      canUseApp: !expired && !suspended,
      license_type: plan.license_type || null,
      duration_months: Number(plan.duration_months) || null,
      start_date: license.start_date,
      end_date: license.end_date,
      activated_at: license.activated_at,
      last_checked_date: today,
      days_remaining: expired || suspended ? 0 : Math.max(0, Math.ceil((endDate.getTime() - nowDate.getTime()) / 86400000)),
      hasClockRollback: clockRollback,
      clockRollbackNotice: clockRollback ? 'Possible date rollback detected. Please verify the computer clock before continuing.' : '',
      message: suspended ? 'This installation license has been deactivated.' : expired ? 'The application license has expired.' : 'License is active and the application remains unlocked.'
    }
  } catch (error) {
    return { success: false, error: error.message, status: 'INVALID', canUseApp: false }
  } finally {
    db.close()
  }
}

async function activateLicense(voucherCode) {
  const normalized = normalizeVoucherCode(voucherCode)
  if (!normalized) return { success: false, error: 'Voucher code is required.' }

  const db = new sqlite3.Database(getDatabasePath())
  try {
    let voucherRows = await all(db, 'SELECT * FROM vouchers WHERE voucher_code = ?', [normalized])
    let voucher = voucherRows && voucherRows[0] ? voucherRows[0] : null
    if (!voucher) {
      const portableVoucher = readPortableVoucherCode(normalized)
      if (!portableVoucher) return { success: false, error: 'Invalid or already-used activation voucher.' }
      const nowIso = new Date().toISOString()
      await run(db, `INSERT OR IGNORE INTO vouchers
        (voucher_code, license_type, duration_months, is_used, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?)`, [normalized, portableVoucher.licenseType, portableVoucher.durationMonths, nowIso, nowIso])
      voucherRows = await all(db, 'SELECT * FROM vouchers WHERE voucher_code = ?', [normalized])
      voucher = voucherRows[0] || null
    }
    if (!voucher) {
      return { success: false, error: 'Invalid or already-used activation voucher.' }
    }
    if (Number(voucher.is_used) === 1) {
      return { success: false, error: 'Invalid or already-used activation voucher.' }
    }

    const now = new Date()
    const startDate = toDateInputString(now)
    const endDate = toDateInputString(addMonths(now, Number(voucher.duration_months) || 1))
    const nowIso = now.toISOString()

    await run(db, `INSERT INTO licenses (start_date, end_date, status, activated_at, last_checked_date, created_at, updated_at)
      VALUES (?, ?, 'ACTIVE', ?, ?, ?, ?)`, [startDate, endDate, nowIso, startDate, nowIso, nowIso])

    await run(db, `INSERT INTO license_history (start_date, end_date, license_type, voucher_code, activated_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`, [startDate, endDate, String(voucher.license_type || 'Standard'), normalized, nowIso, nowIso])

    await run(db, 'UPDATE vouchers SET is_used = 1, used_at = ?, updated_at = ? WHERE id = ?', [nowIso, nowIso, voucher.id])

    return {
      success: true,
      status: 'ACTIVE',
      canUseApp: true,
      start_date: startDate,
      end_date: endDate,
      voucher_code: normalized,
      license_type: voucher.license_type,
      days_remaining: Number(voucher.duration_months) * 30,
      message: `License activated successfully for ${voucher.license_type || 'Standard'} access.`
    }
  } catch (error) {
    return { success: false, error: error.message }
  } finally {
    db.close()
  }
}

async function listVouchers() {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const vouchers = await all(db, `SELECT id, voucher_code, license_type, duration_months, is_used, used_at, created_at
      FROM vouchers ORDER BY created_at DESC, id DESC`)
    return { success: true, vouchers }
  } catch (error) {
    return { success: false, error: error.message }
  } finally {
    db.close()
  }
}

async function createVoucherBatch(options = {}) {
  const durationMonths = Number(options.duration_months)
  const quantity = Number(options.quantity)
  const allowedDurations = [1, 6, 10, 12]
  if (!allowedDurations.includes(durationMonths)) return { success: false, error: 'Choose a supported voucher duration.' }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return { success: false, error: 'Generate between 1 and 100 vouchers at a time.' }

  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const createCode = () => {
    const bytes = crypto.randomBytes(16)
    const characters = Array.from(bytes, byte => alphabet[byte % alphabet.length])
    return characters.join('').match(/.{4}/g).join('-')
  }
  const licenseType = String(options.license_type || 'Standard').trim().slice(0, 40) || 'Standard'
  const db = new sqlite3.Database(getDatabasePath())
  const codes = []
  const now = new Date().toISOString()

  try {
    await run(db, 'BEGIN IMMEDIATE TRANSACTION')
    for (let index = 0; index < quantity; index += 1) {
      let inserted = false
      for (let attempt = 0; attempt < 10 && !inserted; attempt += 1) {
        const code = createPortableVoucherCode(durationMonths)
        const result = await run(db, `INSERT OR IGNORE INTO vouchers
          (voucher_code, license_type, duration_months, is_used, created_at, updated_at)
          VALUES (?, ?, ?, 0, ?, ?)`, [code, licenseType, durationMonths, now, now])
        if (result.changes) {
          codes.push(code)
          inserted = true
        }
      }
      if (!inserted) throw new Error('Unable to generate a unique voucher code. Please try again.')
    }
    await run(db, 'COMMIT')
    return { success: true, codes }
  } catch (error) {
    try { await run(db, 'ROLLBACK') } catch (_) {}
    return { success: false, error: error.message }
  } finally {
    db.close()
  }
}

async function deactivateLicense() {
  const db = new sqlite3.Database(getDatabasePath())
  try {
    const result = await run(db, `UPDATE licenses SET status = 'SUSPENDED', updated_at = ?
      WHERE id = (SELECT id FROM licenses ORDER BY id DESC LIMIT 1) AND status != 'SUSPENDED'`, [new Date().toISOString()])
    if (!result.changes) return { success: false, error: 'There is no active license to deactivate.' }
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  } finally {
    db.close()
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
  listAcademicYears, saveAcademicYear, setAcademicYearStatus, listAcademicClasses, saveAcademicClass, deleteAcademicClass,
  getEnrollmentRoster, promoteStudents, listPromotionHistory,
  listTeachers, saveTeacher, deleteTeacher, listSubjects, saveSubject, deleteSubject, listTimetableEntries, saveTimetableEntry, deleteTimetableEntry,
  listCalendarEvents, saveCalendarEvent, deleteCalendarEvent,
  verifyUser, getDeveloperCredentialStatus, setupDeveloperCredential, verifyDeveloperCredential, changeDeveloperCredential,
  createUser, changePassword, getSchoolProfile, saveSchoolProfile,
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
  correctPayment,
  getLicenseState,
  activateLicense,
  deactivateLicense,
  listVouchers,
  createVoucherBatch,
  normalizeVoucherCode
}
