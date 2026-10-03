const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const fs = require('fs/promises')
const path = require('path')
const db = require(path.join(__dirname, 'database', 'database.js'))
const QRCode = require('qrcode')

let currentUser = null

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  win.loadFile(path.join(__dirname, 'src', 'index.html'))
}

// Enable live reload in development when electron-reload is available
try {
  // Watch source files without reloading when SQLite changes during form saves.
  require('electron-reload')(__dirname, {
    electron: require(path.join(__dirname, 'node_modules', 'electron')),
    ignored: /database[\\/]|school\.db/
  })
  console.log('[DEV] electron-reload enabled')
} catch (e) {
  // ignore if not installed in production
}

app.whenReady().then(async () => {
  await db.init()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// IPC handlers
ipcMain.handle('db-init', async () => {
  return db.init()
})

ipcMain.handle('auth-login', async (event, { username, password }) => {
  console.log('[AUTH] login attempt:', { username })
  const res = await db.verifyUser(username, password)
  console.log('[AUTH] verifyUser result:', res)
  if (res.success) {
    currentUser = res.user
    console.log('[AUTH] login success for', username)
    return { success: true, user: currentUser }
  }
  console.log('[AUTH] login failed for', username, 'error=', res.error)
  return { success: false, error: res.error }
})

ipcMain.handle('auth-logout', async () => {
  currentUser = null
  return { success: true }
})

ipcMain.handle('auth-change-password', async (event, passwords) => {
  if (!currentUser) return { success: false, error: 'You must be signed in.' }
  return db.changePassword(currentUser.id, passwords.currentPassword, passwords.newPassword)
})

ipcMain.handle('school-profile-get', async () => db.getSchoolProfile())
ipcMain.handle('school-profile-save', async (event, profile) => db.saveSchoolProfile(profile))

ipcMain.handle('auth-me', async () => {
  return { user: currentUser }
})

ipcMain.handle('generate-student-id', async (event, academicYear) => {
  return db.generateStudentId(academicYear)
})

ipcMain.handle('student-add', async (event, student) => {
  return db.addStudent(student)
})

ipcMain.handle('student-list', async (event, opts) => {
  return db.listStudents(opts)
})

ipcMain.handle('student-update', async (event, student) => {
  return db.updateStudent(student)
})

ipcMain.handle('student-delete', async (event, studentId) => {
  return db.deleteStudent(studentId)
})

ipcMain.handle('finance-setup-list', async () => {
  return db.listFinanceSetup()
})

ipcMain.handle('finance-fee-templates-list', async () => db.listFeeTemplates())
ipcMain.handle('finance-fee-template-save', async (event, template) => db.saveFeeTemplate(template))
ipcMain.handle('finance-fee-template-delete', async (event, templateId) => db.deleteFeeTemplate(templateId))

ipcMain.handle('finance-summary', async () => {
  return db.getFinanceSummary()
})

ipcMain.handle('finance-owing-students', async () => {
  return db.listOwingStudents()
})

ipcMain.handle('finance-status-report', async (event, filters) => {
  return db.listFinancialStatusReport(filters)
})

ipcMain.handle('finance-account-get', async (event, { studentId, academicYear }) => {
  return db.getStudentFinancialAccount(studentId, academicYear)
})

ipcMain.handle('finance-payment-record', async (event, payment) => {
  if (!currentUser) return { success: false, error: 'You must be signed in to record a payment.' }
  return db.recordPayment(payment, currentUser.id)
})

ipcMain.handle('finance-payment-correct', async (event, correction) => {
  if (!currentUser || String(currentUser.role || '').toLowerCase() !== 'admin') {
    return { success: false, error: 'Only an administrator can correct recorded payments.' }
  }
  return db.correctPayment(correction, currentUser.id)
})

ipcMain.handle('finance-expense-record', async (event, expense) => {
  if (!currentUser) return { success: false, error: 'You must be signed in to record an expenditure.' }
  return db.recordExpense(expense, currentUser.id)
})

ipcMain.handle('finance-expenses-list', async () => {
  return db.listExpenses()
})

ipcMain.handle('finance-receipt-save', async (event, receipt) => {
  const result = await dialog.showSaveDialog({
    title: 'Save Receipt',
    defaultPath: `${receipt.receipt_number || 'receipt'}.pdf`,
    filters: [{ name: 'PDF Documents', extensions: ['pdf'] }]
  })
  if (result.canceled || !result.filePath) return { success: false, canceled: true }
  try {
    const pdf = await event.sender.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { marginType: 'default' }
    })
    await fs.writeFile(result.filePath, pdf)
    return { success: true, filePath: result.filePath }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('finance-receipt-qr', async (event, payload) => {
  try { return { success: true, dataUrl: await QRCode.toDataURL(JSON.stringify(payload), { width: 180, margin: 1, errorCorrectionLevel: 'M' }) } } catch (error) { return { success: false, error: error.message } }
})

ipcMain.handle('dashboard-summary', async () => {
  return db.getDashboardSummary()
})

ipcMain.handle('database-backup', async () => {
  const result = await dialog.showSaveDialog({
    title: 'Backup School Records',
    defaultPath: `school-backup-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: 'School Database Backup', extensions: ['db'] }]
  })
  if (result.canceled || !result.filePath) return { success: false, canceled: true }
  try { return await db.backupDatabase(result.filePath) } catch (error) { return { success: false, error: error.message } }
})

ipcMain.handle('database-restore', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Restore School Records',
    properties: ['openFile'],
    filters: [{ name: 'School Database Backup', extensions: ['db'] }]
  })
  if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true }
  return db.restoreDatabase(result.filePaths[0])
})

ipcMain.handle('export-csv', async (event, students) => {
  const result = await dialog.showSaveDialog({
    title: 'Export Student Records',
    defaultPath: 'student-records.csv',
    filters: [{ name: 'CSV Files', extensions: ['csv'] }]
  })
  if (result.canceled || !result.filePath) return { success: false, canceled: true }

  const columns = [
    ['Student ID', 'student_id'], ['Student Name', 'full_name'], ['Gender', 'gender'],
    ['Class', 'class_name'], ['Type', 'student_type'], ['Year', 'academic_year'],
    ['Disability', 'has_disability'], ['Status', 'status']
  ]
  const csvValue = value => `"${String(value ?? '').replace(/"/g, '""')}"`
  const rows = [columns.map(column => csvValue(column[0])).join(',')]
  for (const student of students || []) {
    rows.push(columns.map(([, key]) => {
      const value = key === 'has_disability' ? (student[key] ? 'Yes' : 'No') : student[key]
      return csvValue(value)
    }).join(','))
  }

  try {
    await fs.writeFile(result.filePath, '\ufeff' + rows.join('\r\n'), 'utf8')
    return { success: true, filePath: result.filePath }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('export-pdf', async (event) => {
  const result = await dialog.showSaveDialog({
    title: 'Export Student Records as PDF',
    defaultPath: 'student-records.pdf',
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  })
  if (result.canceled || !result.filePath) return { success: false, canceled: true }

  try {
    const pdf = await event.sender.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { marginType: 'default' }
    })
    await fs.writeFile(result.filePath, pdf)
    return { success: true, filePath: result.filePath }
  } catch (error) {
    return { success: false, error: error.message }
  }
})
