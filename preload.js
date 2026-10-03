const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  initDb: () => ipcRenderer.invoke('db-init'),
  generateStudentId: (year) => ipcRenderer.invoke('generate-student-id', year),
  addStudent: (student) => ipcRenderer.invoke('student-add', student),
  listStudents: (opts) => ipcRenderer.invoke('student-list', opts),
  updateStudent: (student) => ipcRenderer.invoke('student-update', student),
  deleteStudent: (id) => ipcRenderer.invoke('student-delete', id)
  , listFinanceSetup: () => ipcRenderer.invoke('finance-setup-list')
  , listFeeTemplates: () => ipcRenderer.invoke('finance-fee-templates-list')
  , saveFeeTemplate: (template) => ipcRenderer.invoke('finance-fee-template-save', template)
  , deleteFeeTemplate: (templateId) => ipcRenderer.invoke('finance-fee-template-delete', templateId)
  , getFinanceSummary: () => ipcRenderer.invoke('finance-summary')
  , listOwingStudents: () => ipcRenderer.invoke('finance-owing-students')
  , listFinancialStatusReport: (filters) => ipcRenderer.invoke('finance-status-report', filters)
  , listExpenses: () => ipcRenderer.invoke('finance-expenses-list')
  , recordExpense: (expense) => ipcRenderer.invoke('finance-expense-record', expense)
  , getDashboardSummary: () => ipcRenderer.invoke('dashboard-summary')
  , getStudentFinancialAccount: (query) => ipcRenderer.invoke('finance-account-get', query)
  , recordPayment: (payment) => ipcRenderer.invoke('finance-payment-record', payment)
  , correctPayment: (correction) => ipcRenderer.invoke('finance-payment-correct', correction)
  , saveReceipt: (receipt) => ipcRenderer.invoke('finance-receipt-save', receipt)
  , generateReceiptQr: (payload) => ipcRenderer.invoke('finance-receipt-qr', payload)
  , backupDatabase: () => ipcRenderer.invoke('database-backup')
  , restoreDatabase: () => ipcRenderer.invoke('database-restore')
  , exportCsv: (students) => ipcRenderer.invoke('export-csv', students)
  , exportPdf: () => ipcRenderer.invoke('export-pdf')
  , login: (creds) => ipcRenderer.invoke('auth-login', creds)
  , logout: () => ipcRenderer.invoke('auth-logout')
  , changePassword: (passwords) => ipcRenderer.invoke('auth-change-password', passwords)
  , getSchoolProfile: () => ipcRenderer.invoke('school-profile-get')
  , saveSchoolProfile: (profile) => ipcRenderer.invoke('school-profile-save', profile)
  , me: () => ipcRenderer.invoke('auth-me')
})
