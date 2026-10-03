function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark')
    const btn = document.getElementById('themeToggleBtn')
    if (btn) btn.innerHTML = '<i class="bi bi-sun"></i>'
  } else {
    document.documentElement.setAttribute('data-theme', 'light')
    const btn = document.getElementById('themeToggleBtn')
    if (btn) btn.innerHTML = '<i class="bi bi-moon"></i>'
  }
}

function toggleTheme() {
  const currentTheme = localStorage.getItem('appTheme') || 'light'
  const newTheme = currentTheme === 'light' ? 'dark' : 'light'
  localStorage.setItem('appTheme', newTheme)
  applyTheme(newTheme)
}

function getDefaultMarqueeText() {
  return 'CyberChris Offline School Management System • Simplifying School Administration • Managing Students, Academics, Fees & Financial Records with Ease. ✨'
}

function maybeGetSchoolMotto() {
  try {
    if (!window.api || typeof window.api.getSchoolProfile !== 'function') return getDefaultMarqueeText()
    return window.api.getSchoolProfile().then(result => {
      const profile = result && result.profile ? result.profile : {}
      const motto = (profile.motto || '').trim()
      return motto || getDefaultMarqueeText()
    }).catch(() => getDefaultMarqueeText())
  } catch (error) {
    return Promise.resolve(getDefaultMarqueeText())
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Load theme preference from localStorage
  const theme = localStorage.getItem('appTheme') || 'light'
  applyTheme(theme)
  
  // initialize DB and check authentication
  await window.api.initDb()
  const me = await window.api.me()
  if (!me || !me.user) {
    showLogin()
  } else {
    await renderShell()
    loadDashboard()
  }
})

async function renderSystemMarquee() {
  const app = document.getElementById('app')
  if (!app) return

  let marquee = document.getElementById('systemMarquee')
  const defaultText = getDefaultMarqueeText()

  let schoolMotto = defaultText
  try {
    const profileResult = await window.api.getSchoolProfile()
    const profile = profileResult && profileResult.profile ? profileResult.profile : {}
    const motto = (profile.motto || '').trim()
    if (motto) schoolMotto = motto
  } catch (error) {
    schoolMotto = defaultText
  }

  const marqueeMarkup = `
    <div class="marquee-banner">
      <div class="marquee-content">
        <span>${escapeHtml(schoolMotto)} ${escapeHtml(schoolMotto)} ${escapeHtml(schoolMotto)} ${escapeHtml(schoolMotto)}</span>
      </div>
    </div>
  `

  if (marquee) {
    marquee.innerHTML = marqueeMarkup
    return
  }

  marquee = document.createElement('div')
  marquee.id = 'systemMarquee'
  marquee.innerHTML = marqueeMarkup

  const main = document.getElementById('main')
  if (main) app.insertBefore(marquee, main)
  else app.appendChild(marquee)
}

async function renderShell() {
  // remove any existing sidebar to prevent duplicates
  const existing = document.getElementById('app-sidebar')
  if (existing) existing.remove()

  const sidebar = document.createElement('div')
  sidebar.id = 'app-sidebar'
  sidebar.innerHTML = `
    <div class="sidebar-container" style="padding:20px; width:240px; background:#14213D; color:#fff; position:fixed; left:0; top:0; height:100vh; box-sizing:border-box; padding-bottom:64px">
      <div>
        <div class="sidebar-brand mb-4"><h3>CyberChris</h3><small>Offline School</small></div>
        <nav class="nav flex-column">
          <a id="navDashboard" class="nav-link text-white" href="#/"><i class="bi bi-speedometer2" aria-hidden="true"></i><span>Dashboard</span></a>
          <a id="navAdmission" class="nav-link text-white" href="#/admission"><i class="bi bi-person-plus" aria-hidden="true"></i><span>Admission</span></a>
          <a id="navFinance" class="nav-link text-white" href="#/finance"><i class="bi bi-cash-stack" aria-hidden="true"></i><span>Finance</span></a>
          <a id="navSettings" class="nav-link text-white" href="#/settings"><i class="bi bi-gear" aria-hidden="true"></i><span>Settings</span></a>
          <a id="navAcademics" class="nav-link text-white" href="#/academics"><i class="bi bi-mortarboard" aria-hidden="true"></i><span>Academics</span></a>
        </nav>
      </div>
      <div class="sidebar-footer">
        <div style="margin-bottom:8px"><small>Logged in as admin</small></div>
        <div style="margin-bottom:12px"><button id="themeToggleBtn" class="btn-theme-toggle" title="Toggle dark/light mode"><i class="bi bi-moon"></i></button></div>
        <div><button id="changePasswordBtn" class="btn btn-link text-white sidebar-password-btn"><i class="bi bi-key"></i> Change Password</button><button id="logoutBtn" class="btn-logout-sidebar">Logout</button></div>
      </div>
    </div>
  `
  document.body.prepend(sidebar)
  // add body class so main content shifts to accommodate the sidebar
  document.body.classList.add('with-sidebar')
  await renderSystemMarquee()
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await window.api.logout()
    showLogin()
  })
  document.getElementById('changePasswordBtn').addEventListener('click', showChangePasswordDialog)
  document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme)
  // sidebar navigation handlers
  const navDashboard = document.getElementById('navDashboard')
  const navAdmission = document.getElementById('navAdmission')
  const navFinance = document.getElementById('navFinance')
  const navSettings = document.getElementById('navSettings')
  const navAcademics = document.getElementById('navAcademics')
  if (navDashboard) navDashboard.addEventListener('click', (e) => { e.preventDefault(); loadDashboard() })
  if (navAdmission) navAdmission.addEventListener('click', (e) => { e.preventDefault(); loadAdmissionRecords() })
  if (navFinance) navFinance.addEventListener('click', (e) => { e.preventDefault(); loadFinance() })
  if (navSettings) navSettings.addEventListener('click', (e) => { e.preventDefault(); loadSettings() })
  if (navAcademics) navAcademics.addEventListener('click', (e) => { e.preventDefault(); loadAcademics() })
}

function showChangePasswordDialog() {
  const existing = document.getElementById('changePasswordOverlay')
  if (existing) existing.remove()
  const overlay = document.createElement('div')
  overlay.id = 'changePasswordOverlay'
  overlay.className = 'print-preview-overlay'
  overlay.innerHTML = `<div class="change-password-dialog" role="dialog" aria-modal="true" aria-labelledby="changePasswordTitle"><div class="print-preview-toolbar"><h3 id="changePasswordTitle">Change Password</h3><button type="button" class="btn btn-outline-secondary" id="closeChangePassword">Close</button></div><form id="changePasswordForm" class="change-password-form"><label>Current password<input id="currentPassword" type="password" class="form-control" required></label><label>New password<input id="newPassword" type="password" class="form-control" minlength="8" required></label><label>Confirm new password<input id="confirmPassword" type="password" class="form-control" minlength="8" required></label><div id="changePasswordError" class="text-danger small"></div><div class="text-end"><button class="btn btn-new" type="submit"><i class="bi bi-check2"></i> Update Password</button></div></form></div>`
  document.body.appendChild(overlay)
  const close = () => overlay.remove()
  overlay.querySelector('#closeChangePassword').addEventListener('click', close)
  overlay.querySelector('#changePasswordForm').addEventListener('submit', async event => {
    event.preventDefault()
    const currentPassword = overlay.querySelector('#currentPassword').value
    const newPassword = overlay.querySelector('#newPassword').value
    const confirmPassword = overlay.querySelector('#confirmPassword').value
    const error = overlay.querySelector('#changePasswordError')
    if (newPassword.length < 8) { error.innerText = 'New password must be at least 8 characters.'; return }
    if (newPassword !== confirmPassword) { error.innerText = 'New passwords do not match.'; return }
    const result = await window.api.changePassword({ currentPassword, newPassword })
    if (result.success) { close(); showToast('Password changed successfully.', 'success') } else error.innerText = result.error || 'Unable to change password.'
  })
}

function showLogin() {
  const main = document.getElementById('main')
  // remove any dynamic sidebar (we removed the static `#sidebar` element)
  const existingSidebar = document.getElementById('app-sidebar')
  if (existingSidebar) existingSidebar.remove()
  // remove body class to allow full-width login
  document.body.classList.remove('with-sidebar')
  main.innerHTML = `
    <div class="split-login">
      <div class="split-left">
        <div style="max-width:420px;text-align:left">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">
            <div style="width:56px;height:56px;background:#fff;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#14213D;font-weight:800">SM</div>
            <div>
              <div class="brand-title">CYBERCHRIS OFFLINE SCHOOL</div>
                <div class="brand-sub">School Management System</div>
            </div>
          </div>
          <p style="color:rgba(255,255,255,0.9);line-height:1.5">A professional offline desktop application for managing admissions and student records. Fast, secure, and easy to use by non-technical staff.</p>
        </div>
        <svg class="brand-decor" width="220" height="120" viewBox="0 0 220 120" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="60" height="60" rx="8" fill="#E83E8C"/><circle cx="160" cy="40" r="30" fill="#FDE7F2"/></svg>
      </div>
      <div class="split-right">
        <div class="login-panel" id="loginPanel">
          <h3>Welcome Back</h3>
          <p>Sign in to access your school management system.</p>
          <form id="loginForm" novalidate>
            <div class="mb-3 input-with-icon">
              <span class="input-group-text"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="#6c757d" viewBox="0 0 16 16"><path d="M3 14s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3z"/><path fill-rule="evenodd" d="M8 8a3 3 0 100-6 3 3 0 000 6z"/></svg></span>
              <input id="login_username" class="form-control rounded-pill" placeholder="Username" required autocomplete="username">
            </div>
            <div class="mb-3 input-with-icon" style="margin-top:10px">
              <span class="input-group-text"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="#6c757d" viewBox="0 0 16 16"><path d="M8 1a4 4 0 00-4 4v2h8V5a4 4 0 00-4-4z"/><path d="M3 8v5a2 2 0 002 2h6a2 2 0 002-2V8H3z"/></svg></span>
              <input id="login_password" type="password" class="form-control rounded-pill" placeholder="Password" required autocomplete="current-password">
              <button type="button" id="togglePassword" class="btn btn-sm" style="margin-left:8px;background:transparent;border:none">Show</button>
            </div>

            <div class="remember-row">
              <div class="form-check">
                <input class="form-check-input" type="checkbox" value="" id="rememberMe">
                <label class="form-check-label" for="rememberMe">Remember me</label>
              </div>
              <div><small class="text-muted">Version 1.0.0</small></div>
            </div>

            <div class="inline-error" id="loginError">Invalid credentials. Please try again.</div>

            <div style="margin-top:18px">
              <button id="signInBtn" class="btn btn-accent w-100" type="submit">SIGN IN <span id="btnSpinner" style="display:none;margin-left:8px" class="loading-spinner"></span></button>
            </div>
          </form>
          <div style="margin-top:18px;font-size:0.85rem;color:#6c757d">CyberChris Offline School • christianpablahbaker@gmail.com • 0555637569 / 0776908238 • © 2026</div>
        </div>
      </div>
    </div>
  `
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    // prevent repeated submissions
    const signInBtn = document.getElementById('signInBtn')
    const btnSpinner = document.getElementById('btnSpinner')
    signInBtn.disabled = true
    btnSpinner.style.display = 'inline-block'
    document.getElementById('loginError').style.display = 'none'

    const username = document.getElementById('login_username').value.trim()
    const password = document.getElementById('login_password').value
    try {
      const res = await window.api.login({ username, password })
      if (res.success) {
        // transition out
        const panel = document.getElementById('loginPanel')
        panel.classList.add('fade-out')
        setTimeout(async () => {
          await renderShell()
          loadDashboard()
        }, 260)
      } else {
        document.getElementById('loginError').innerText = res.error || 'Invalid credentials. Please try again.'
        document.getElementById('loginError').style.display = 'block'
        signInBtn.disabled = false
        btnSpinner.style.display = 'none'
      }
    } catch (err) {
      document.getElementById('loginError').innerText = 'An error occurred. Please try again.'
      document.getElementById('loginError').style.display = 'block'
      signInBtn.disabled = false
      btnSpinner.style.display = 'none'
    }
  })

  // show/hide password
  const toggle = document.getElementById('togglePassword')
  const pwd = document.getElementById('login_password')
  toggle.addEventListener('click', () => {
    if (pwd.type === 'password') { pwd.type = 'text'; toggle.innerText = 'Hide' } else { pwd.type = 'password'; toggle.innerText = 'Show' }
  })

  // support pressing Enter when focusing inputs
  document.getElementById('login_username').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('loginForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })) })
  document.getElementById('login_password').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('loginForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })) })
}

async function loadDashboard() {
  const main = document.getElementById('main')
  await renderSystemMarquee()
  main.innerHTML = `
    <div class="container-fluid py-4">
      <div class="page-header d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 class="fw-800 mb-2">Dashboard</h2>
          <p class="text-muted small">School financial overview and student statistics.</p>
        </div>
        <div class="text-end">
          <p class="text-muted small mb-0">Last updated: <span id="updateTime">just now</span></p>
        </div>
      </div>

      <!-- Financial KPI Cards - 2 Rows × 3 Columns Grid -->
      <div class="row g-4 mb-4 kpi-cards-row">
        <!-- Row 1: Obligated, Collected, Outstanding -->
        <div class="col-4 dashboard-card-animate">
          <div class="dashboard-kpi-card" style="border-left: 4px solid #0D6EFD;">
            <div class="kpi-content">
              <span class="kpi-label">Total Obligated</span>
              <h3 class="kpi-value" id="totalObligated">L$0.00</h3>
              <small class="kpi-subtitle" id="totalObligatedPct">Current obligations</small>
            </div>
            <div class="kpi-icon">💰</div>
          </div>
        </div>
        <div class="col-4 dashboard-card-animate" style="animation-delay: 0.05s;">
          <div class="dashboard-kpi-card" style="border-left: 4px solid #20C997;">
            <div class="kpi-content">
              <span class="kpi-label">Total Collected</span>
              <h3 class="kpi-value" id="totalCollected">L$0.00</h3>
              <small class="kpi-subtitle" id="totalCollectedPct">0% of obligation</small>
            </div>
            <div class="kpi-icon">💵</div>
          </div>
        </div>
        <div class="col-4 dashboard-card-animate" style="animation-delay: 0.10s;">
          <div class="dashboard-kpi-card" style="border-left: 4px solid #DC3545;">
            <div class="kpi-content">
              <span class="kpi-label">Outstanding</span>
              <h3 class="kpi-value" id="outstandingBalance">L$0.00</h3>
              <small class="kpi-subtitle" id="outstandingPct">0% of obligation</small>
            </div>
            <div class="kpi-icon">⚠️</div>
          </div>
        </div>

        <!-- Row 2: Net Balance, Expenditure, Active Students -->
        <div class="col-4 dashboard-card-animate" style="animation-delay: 0.15s;">
          <div class="dashboard-kpi-card" style="border-left: 4px solid #6F42C1;">
            <div class="kpi-content">
              <span class="kpi-label">Net Balance</span>
              <h3 class="kpi-value" id="netBalance">L$0.00</h3>
              <small class="kpi-subtitle" id="netBalancePct">Collected − Expenses</small>
            </div>
            <div class="kpi-icon">💹</div>
          </div>
        </div>
        <div class="col-4 dashboard-card-animate" style="animation-delay: 0.20s;">
          <div class="dashboard-kpi-card" style="border-left: 4px solid #F59E0B;">
            <div class="kpi-content">
              <span class="kpi-label">Expenditure</span>
              <h3 class="kpi-value" id="totalExpenditure">L$0.00</h3>
              <small class="kpi-subtitle" id="totalExpenditurePct">0% of collected</small>
            </div>
            <div class="kpi-icon">📊</div>
          </div>
        </div>
        <div class="col-4 dashboard-card-animate" style="animation-delay: 0.25s;">
          <div class="dashboard-kpi-card" style="border-left: 4px solid #17A2B8;">
            <div class="kpi-content">
              <span class="kpi-label">Active Students</span>
              <h3 class="kpi-value" id="totalStudents">0</h3>
              <small class="kpi-subtitle">Currently enrolled</small>
            </div>
            <div class="kpi-icon">👥</div>
          </div>
        </div>
      </div>

      <!-- Charts Row: Compact Layout -->
      <div class="row g-3">
        <!-- Gender Distribution Chart -->
        <div class="col-lg-6 col-md-12 dashboard-card-animate">
          <div class="chart-card shadow-sm">
            <div class="chart-header">
              <h5 class="chart-title mb-0">Gender Distribution</h5>
              <span class="badge bg-light text-dark">Live</span>
            </div>
            <div class="chart-body">
              <canvas id="genderChart"></canvas>
            </div>
          </div>
        </div>

        <!-- Class Bar Chart -->
        <div class="col-lg-6 col-md-12 dashboard-card-animate" style="animation-delay: 0.05s;">
          <div class="chart-card shadow-sm">
            <div class="chart-header">
              <h5 class="chart-title mb-0">Students by Class</h5>
              <span class="badge bg-light text-dark">Live</span>
            </div>
            <div class="chart-body">
              <canvas id="classBarChart"></canvas>
            </div>
          </div>
        </div>
      </div>

      <!-- Class Distribution Pie Chart -->
      <div class="row g-3 mt-2">
        <div class="col-lg-6 dashboard-card-animate">
          <div class="chart-card shadow-sm">
            <div class="chart-header">
              <h5 class="chart-title mb-0">Class Distribution %</h5>
              <span class="badge bg-light text-dark">Analysis</span>
            </div>
            <div class="chart-body">
              <canvas id="classPieChart"></canvas>
            </div>
          </div>
        </div>
        <div class="col-lg-6">
          <!-- Reserved for future widgets -->
        </div>
      </div>
    </div>
  `

  // Fetch dashboard data
  const result = await window.api.getDashboardSummary()
  if (!result.success) {
    showToast('Error loading dashboard data', 'error')
    return
  }

  const money = cents => `L$${(Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const summary = result.summary || {}
  const genderData = result.genderDistribution || {}
  const classList = result.classList || []

  const totalStudents = Object.values(genderData).reduce((sum, count) => sum + count, 0)
  const totalObligation = Number(summary.total_obligated || 0)
  const totalCollectedAmount = Number(summary.total_collected || 0)
  const totalExpenditureAmount = Number(summary.total_expenditure || 0)
  const outstandingAmount = Math.max(0, totalObligation - totalCollectedAmount)
  const netBalanceAmount = Number(summary.net_balance || 0)
  const collectedPct = totalObligation > 0 ? ((totalCollectedAmount / totalObligation) * 100) : 0
  const expenditurePct = totalCollectedAmount > 0 ? ((totalExpenditureAmount / totalCollectedAmount) * 100) : 0
  const outstandingPct = totalObligation > 0 ? ((outstandingAmount / totalObligation) * 100) : 0
  const netBalancePct = totalCollectedAmount > 0 ? ((netBalanceAmount / totalCollectedAmount) * 100) : 0

  // Update stats with new KPI card structure
  const updateKPI = (valueId, pctId, value, pctLabel) => {
    const valueEl = document.getElementById(valueId)
    const pctEl = document.getElementById(pctId)
    if (valueEl) valueEl.textContent = value
    if (pctEl) pctEl.textContent = pctLabel
  }

  updateKPI('totalObligated', 'totalObligatedPct', money(totalObligation), 'If all Students pay all their money.')
  updateKPI('totalCollected', 'totalCollectedPct', money(totalCollectedAmount), `${collectedPct.toFixed(2)}% of obligation`)
  updateKPI('totalExpenditure', 'totalExpenditurePct', money(totalExpenditureAmount), `${expenditurePct.toFixed(2)}% of collected`)
  updateKPI('outstandingBalance', 'outstandingPct', money(outstandingAmount), `${outstandingPct.toFixed(2)}% of obligation`)
  updateKPI('netBalance', 'netBalancePct', money(netBalanceAmount), totalCollectedAmount > 0 ? `${netBalancePct.toFixed(2)}% of collections` : 'No collections yet')
  document.getElementById('totalStudents').innerText = totalStudents

  // Update timestamp
  const now = new Date()
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const updateTimeEl = document.getElementById('updateTime')
  if (updateTimeEl) updateTimeEl.textContent = timeStr

  const financeValues = [
    Number(summary.total_obligated || 0),
    Number(summary.total_collected || 0),
    Number(summary.total_expenditure || 0)
  ]

  // Gender Chart - Pie chart showing Male vs Female
  const maleCount = genderData['Male'] || 0
  const femaleCount = genderData['Female'] || 0
  const genderCanvasEl = document.getElementById('genderChart')
  if (genderCanvasEl) {
    try {
      const genderCtx = genderCanvasEl.getContext('2d')
      new Chart(genderCtx, {
        type: 'doughnut',
        data: {
          labels: ['Male', 'Female'],
          datasets: [{
            data: [maleCount, femaleCount],
            backgroundColor: ['#0D6EFD', '#FFC107'],
            borderColor: ['#fff', '#fff'],
            borderWidth: 3
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          cutout: '60%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                font: { size: 12, weight: '600' },
                padding: 12,
                generateLabels(chart) {
                  const data = chart.data
                  return data.labels.map((label, index) => {
                    const value = data.datasets[0].data[index] || 0
                    const percentage = totalStudents > 0 ? ((value / totalStudents) * 100) : 0
                    return {
                      text: `${label} (${percentage.toFixed(1)}%)`,
                      fillStyle: data.datasets[0].backgroundColor[index],
                      strokeStyle: data.datasets[0].borderColor[index],
                      lineWidth: 2,
                      hidden: false,
                      index
                    }
                  })
                }
              }
            },
            tooltip: {
              backgroundColor: 'rgba(20, 33, 61, 0.9)',
              padding: 12,
              titleFont: { size: 13, weight: 'bold' },
              bodyFont: { size: 12 },
              callbacks: {
                label(context) {
                  const total = context.dataset.data.reduce((sum, n) => sum + n, 0)
                  const value = context.parsed || 0
                  const pct = total > 0 ? ((value / total) * 100) : 0
                  return ` ${value} students (${pct.toFixed(1)}%)`
                }
              }
            }
          }
        }
      })
    } catch (err) {
      console.error('Error rendering Gender Distribution chart:', err)
      genderCanvasEl.parentElement.innerHTML = '<p class="text-muted text-center py-4">Unable to render chart</p>'
    }
  } else {
    console.warn('Gender chart canvas element not found')
  }

  // Class Distribution - Bar chart showing students per class
  const classLabels = classList.map(item => item.class)
  const classData = classList.map(item => item.students)
  const classBarCanvasEl = document.getElementById('classBarChart')
  if (classBarCanvasEl) {
    try {
      const classBarCtx = classBarCanvasEl.getContext('2d')
      new Chart(classBarCtx, {
        type: 'bar',
        data: {
          labels: classLabels.length > 0 ? classLabels : ['No Classes'],
          datasets: [{
            label: 'Number of Students',
            data: classData.length > 0 ? classData : [0],
            backgroundColor: '#0D6EFD',
            borderColor: '#0D6EFD',
            borderWidth: 2,
            borderRadius: 6,
            barPercentage: 0.7,
            categoryPercentage: 0.8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              backgroundColor: 'rgba(20, 33, 61, 0.9)',
              padding: 12,
              titleFont: { size: 13, weight: 'bold' },
              bodyFont: { size: 12 },
              displayColors: false
            }
          },
          scales: {
            x: {
              beginAtZero: true,
              ticks: {
                font: { size: 11, weight: '600' },
                color: '#7b8494'
              },
              grid: {
                display: false
              }
            },
            y: {
              beginAtZero: true,
              ticks: {
                stepSize: 1,
                font: { size: 11, weight: '600' },
                color: '#7b8494'
              },
              grid: {
                color: 'rgba(228, 232, 240, 0.5)'
              }
            }
          }
        }
      })
    } catch (err) {
      console.error('Error rendering Students by Class chart:', err)
      classBarCanvasEl.parentElement.innerHTML = '<p class="text-muted text-center py-4">Unable to render chart</p>'
    }
  } else {
    console.warn('Class bar chart canvas element not found')
  }

  // Class Distribution - Doughnut chart showing class percentages
  const classPieCanvasEl = document.getElementById('classPieChart')
  if (classPieCanvasEl) {
    try {
      const classPieCtx = classPieCanvasEl.getContext('2d')
      const colors = ['#0D6EFD', '#FFC107', '#28A745', '#E83E8C', '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F']
      new Chart(classPieCtx, {
        type: 'doughnut',
        data: {
          labels: classLabels.length > 0 ? classLabels : ['No Classes'],
          datasets: [{
            data: classData.length > 0 ? classData : [0],
            backgroundColor: colors.slice(0, classLabels.length),
            borderColor: ['#fff', '#fff', '#fff', '#fff', '#fff', '#fff', '#fff', '#fff', '#fff', '#fff'],
            borderWidth: 3
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          cutout: '65%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                font: {
                  size: 11
                }
              }
            }
          }
        }
      })
    } catch (err) {
      console.error('Error rendering Class Distribution chart:', err)
      classPieCanvasEl.parentElement.innerHTML = '<p class="text-muted text-center py-4">Unable to render chart</p>'
    }
  } else {
    console.warn('Class pie chart canvas element not found')
  }
}

async function loadAdmissionRecords() {
  // Admission Dashboard - fetch and render students, stats and recent admissions
  const main = document.getElementById('main')
  main.innerHTML = `
    <div class="container-fluid py-4">
      <div class="page-header">
        <div>
          <h2>Admission & Student Records</h2>
          <p class="small">Register students, manage records, and review recent admissions.</p>
        </div>
        <div class="page-actions">
          <button id="exportCsvBtn" class="btn btn-outline-secondary">Export CSV</button>
          <button id="exportPdfBtn" class="btn btn-outline-secondary">Export PDF</button>
          <button id="printRecordsBtn" class="btn btn-outline-secondary">Print Records</button>
          <button id="newAdmissionBtn" class="btn-new">+ New Admission</button>
        </div>
      </div>

      <div id="dashboardContent">
        <div class="stats-grid" id="statsGrid"></div>

        <div class="controls-row">
          <input id="globalSearch" class="form-control search-input" placeholder="Search by Student ID or Name">
          <div class="filters">
            <select id="filterClass" class="form-select">
              <option value="">All Classes</option>
            </select>
            <select id="filterGender" class="form-select">
              <option value="">Any Gender</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
            <select id="filterType" class="form-select">
              <option value="">Any Type</option>
              <option value="New Student">New Student</option>
              <option value="Returning">Returning</option>
            </select>
            <select id="filterStatus" class="form-select">
              <option value="">Any Status</option>
              <option value="Active">Active</option>
              <option value="Archived">Archived</option>
            </select>
          </div>
        </div>

        <div class="recent-card" id="recentCard">
          <h5>Recent Admissions</h5>
          <div id="recentContainer"></div>
        </div>
      </div>
    </div>
  `

  document.getElementById('newAdmissionBtn').addEventListener('click', () => {
    location.hash = '#/admission'
    loadAdmission()
  })
  document.getElementById('printRecordsBtn').addEventListener('click', showPrintPreview)
  document.getElementById('exportPdfBtn').addEventListener('click', showPrintPreview)
  document.getElementById('exportCsvBtn').addEventListener('click', exportStudentCsv)

  // fetch students and render
  await refreshStudentData()

  // attach search/filter handlers
  document.getElementById('globalSearch').addEventListener('input', debounce(async () => { await refreshStudentData() }, 300))
  document.getElementById('filterClass').addEventListener('change', () => refreshStudentData())
  document.getElementById('filterGender').addEventListener('change', () => refreshStudentData())
  document.getElementById('filterType').addEventListener('change', () => refreshStudentData())
  document.getElementById('filterStatus').addEventListener('change', () => refreshStudentData())
}

// Debounce helper
function debounce(fn, wait) {
  let t
  return function(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait) }
}

const studentPrintFields = [
  { id: 'student_id', label: 'Student ID', value: student => student.student_id || '' },
  { id: 'full_name', label: 'Full Name', value: student => student.full_name || '' },
  { id: 'gender', label: 'Gender', value: student => student.gender || '' },
  { id: 'date_of_birth', label: 'Date of Birth', value: student => student.date_of_birth || '' },
  { id: 'class_name', label: 'Class', value: student => student.class_name || '' },
  { id: 'student_status', label: 'Student Status', value: student => normalizeStudentType(student.student_type) === 'New Student' ? 'New' : 'Old' },
  { id: 'disability', label: 'Disability', value: student => student.has_disability ? 'Yes' : 'No' },
  { id: 'place_of_birth', label: 'Place of Birth', value: student => student.place_of_birth || '' },
  { id: 'emergency_contact', label: 'Emergency Contact', value: student => [
    student.emergency_contact_name,
    student.emergency_contact_relationship ? `(${student.emergency_contact_relationship})` : '',
    student.emergency_contact_phone,
    student.emergency_contact_address
  ].filter(Boolean).join(' · ') },
  { id: 'admission_date', label: 'Admission Date', value: student => student.registration_date || '' }
]

const studentPrintPresets = {
  'Student List': ['student_id', 'full_name', 'gender', 'class_name', 'student_status'],
  'Student Register': ['student_id', 'full_name', 'gender', 'date_of_birth', 'class_name', 'admission_date'],
  'Complete Student Records': studentPrintFields.map(field => field.id)
}

function showPrintPreview() {
  if (!document.getElementById('recentCard')) return

  const existing = document.querySelector('.print-preview-overlay')
  if (existing) existing.remove()

  const overlay = document.createElement('div')
  overlay.className = 'print-preview-overlay'
  overlay.innerHTML = `
    <div class="print-preview-dialog student-print-dialog" role="dialog" aria-modal="true" aria-labelledby="studentPrintTitle">
      <div class="print-preview-toolbar">
        <h3 id="studentPrintTitle">Select Information</h3>
        <div class="print-preview-actions">
          <button type="button" class="btn btn-outline-secondary" id="closeStudentPrint">Close</button>
          <button type="button" class="btn btn-outline-secondary" id="exportPreviewPdf" hidden>Export PDF</button>
          <button type="button" class="btn btn-new" id="studentPrintNext">Preview</button>
          <button type="button" class="btn btn-new" id="confirmPrintRecords" hidden>Print</button>
        </div>
      </div>
      <section class="student-print-selection" id="studentPrintSelection">
        <label class="student-print-preset-label" for="studentPrintPreset">Preset</label>
        <select class="form-select" id="studentPrintPreset">
          <option>Student List</option>
          <option>Student Register</option>
          <option>Complete Student Records</option>
          <option value="custom">Custom selection</option>
        </select>
        <div class="student-print-fields" id="studentPrintFields"></div>
        <p class="student-print-count">${_visibleStudents.length} students will be included based on the current list filters.</p>
      </section>
      <div class="print-preview-page student-list-print" id="printPreviewPage" hidden></div>
    </div>
  `
  document.body.appendChild(overlay)

  const presetSelect = overlay.querySelector('#studentPrintPreset')
  const fieldsContainer = overlay.querySelector('#studentPrintFields')
  const selection = overlay.querySelector('#studentPrintSelection')
  const previewPage = overlay.querySelector('#printPreviewPage')
  const title = overlay.querySelector('#studentPrintTitle')
  const nextButton = overlay.querySelector('#studentPrintNext')
  const printButton = overlay.querySelector('#confirmPrintRecords')
  const pdfButton = overlay.querySelector('#exportPreviewPdf')
  let selectedFieldIds = [...studentPrintPresets['Student List']]

  const renderFieldOptions = () => {
    fieldsContainer.innerHTML = studentPrintFields.map(field => `
      <label class="student-print-field">
        <input type="checkbox" value="${field.id}" ${selectedFieldIds.includes(field.id) ? 'checked' : ''}>
        <span>${field.label}</span>
      </label>
    `).join('')
  }

  const renderPreview = () => {
    const fields = studentPrintFields.filter(field => selectedFieldIds.includes(field.id))
    const rows = _visibleStudents.map(student => `<tr>${fields.map(field => `<td>${escapeHtml(field.value(student))}</td>`).join('')}</tr>`).join('')
    const headings = fields.map(field => `<th>${field.label}</th>`).join('')
    const listTitle = presetSelect.value === 'custom' ? 'Student Records' : presetSelect.value
    previewPage.innerHTML = `
      <header class="student-list-print-header">
        <h1>${escapeHtml(listTitle)}</h1>
        <p>Student Records</p>
        <small>Printed ${escapeHtml(new Date().toLocaleDateString())} · ${_visibleStudents.length} students</small>
      </header>
      <div class="records-table-wrap">
        <table class="table table-modern student-print-table">
          <thead><tr>${headings}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${fields.length}">No students match the current filters.</td></tr>`}</tbody>
        </table>
      </div>
    `
  }

  renderFieldOptions()
  presetSelect.addEventListener('change', () => {
    selectedFieldIds = studentPrintPresets[presetSelect.value] || [...selectedFieldIds]
    renderFieldOptions()
  })
  fieldsContainer.addEventListener('change', event => {
    if (!event.target.matches('input[type="checkbox"]')) return
    selectedFieldIds = Array.from(fieldsContainer.querySelectorAll('input:checked')).map(input => input.value)
    presetSelect.value = 'custom'
  })

  const closePreview = () => {
    overlay.remove()
    document.body.classList.remove('print-preview-active')
  }
  overlay.querySelector('#closeStudentPrint').addEventListener('click', closePreview)
  nextButton.addEventListener('click', () => {
    if (!selectedFieldIds.length) {
      showToast('Select at least one field to preview.', 'error')
      return
    }
    renderPreview()
    selection.hidden = true
    previewPage.hidden = false
    title.textContent = 'Print Preview'
    nextButton.hidden = true
    printButton.hidden = false
    pdfButton.hidden = false
    document.body.classList.add('print-preview-active')
  })
  overlay.querySelector('#confirmPrintRecords').addEventListener('click', () => window.print())
  pdfButton.addEventListener('click', async event => {
    const button = event.currentTarget
    button.disabled = true
    const result = await window.api.exportPdf()
    button.disabled = false
    if (result.success) showToast('PDF exported successfully', 'success')
    else if (!result.canceled) showToast('Unable to export PDF: ' + (result.error || ''), 'error')
  })
}

let _studentsCache = []
let _visibleStudents = []
let _studentRefreshRequest = 0

function normalizeStudentType(studentType) {
  return studentType === 'Returning/Old Student' ? 'Returning' : (studentType || 'Returning')
}

async function refreshStudentData() {
  const requestId = ++_studentRefreshRequest
  const query = document.getElementById('globalSearch') ? document.getElementById('globalSearch').value.trim() : ''
  const classFilter = document.getElementById('filterClass') ? document.getElementById('filterClass').value : ''
  const genderFilter = document.getElementById('filterGender') ? document.getElementById('filterGender').value : ''
  const typeFilter = document.getElementById('filterType') ? document.getElementById('filterType').value : ''
  const statusFilter = document.getElementById('filterStatus') ? document.getElementById('filterStatus').value : ''

  // server supports query and class_name/status filters; fetch broader set then filter client-side
  const serverOpts = {}
  if (query) serverOpts.query = query
  if (classFilter) serverOpts.class_name = classFilter
  if (statusFilter) serverOpts.status = statusFilter
  const rows = await window.api.listStudents(serverOpts)
  // Ignore an older response if the user changed filters while this request was in flight.
  if (requestId !== _studentRefreshRequest || !document.getElementById('recentContainer')) return
  _studentsCache = rows || []

  // apply client-side filters for gender and student type and name
  let filtered = _studentsCache.filter(s => {
    if (genderFilter && s.gender !== genderFilter) return false
    if (typeFilter && normalizeStudentType(s.student_type) !== typeFilter) return false
    return true
  })
  _visibleStudents = filtered

  renderStats(filtered)
  renderRecentTable(filtered)
  populateClassFilter(_studentsCache)
}

async function exportStudentCsv() {
  const result = await window.api.exportCsv(_visibleStudents)
  if (result.success) showToast('CSV exported successfully', 'success')
  else if (!result.canceled) showToast('Unable to export CSV: ' + (result.error || ''), 'error')
}

function populateClassFilter(all) {
  const select = document.getElementById('filterClass')
  if (!select) return
  const selectedClass = select.value
  const existingClasses = Array.from(select.options).slice(1).map(option => option.value)
  const classes = Array.from(new Set([...existingClasses, ...all.map(s => s.class_name).filter(Boolean)])).sort((a, b) => a.localeCompare(b))
  select.innerHTML = '<option value="">All Classes</option>' + classes.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')
  select.value = selectedClass
}

function renderStats(rows) {
  const total = rows.length
  const newStudents = rows.filter(s => normalizeStudentType(s.student_type) === 'New Student').length
  const returningCount = rows.filter(s => normalizeStudentType(s.student_type) === 'Returning').length
  const male = rows.filter(s => s.gender === 'Male').length
  const female = rows.filter(s => s.gender === 'Female').length
  const container = document.getElementById('statsGrid')
  container.innerHTML = `
    <div class="stat">
      <div class="icon">👥</div>
      <div>
        <div class="label">Total Students</div>
        <div class="value">${total}</div>
      </div>
    </div>
    <div class="stat">
      <div class="icon">✨</div>
      <div>
        <div class="label">New Students</div>
        <div class="value">${newStudents}</div>
      </div>
    </div>
    <div class="stat">
      <div class="icon">🔁</div>
      <div>
        <div class="label">Returning</div>
        <div class="value">${returningCount}</div>
      </div>
    </div>
    <div class="stat">
      <div class="icon">♂️</div>
      <div>
        <div class="label">Male</div>
        <div class="value">${male}</div>
      </div>
    </div>
    <div class="stat">
      <div class="icon">♀️</div>
      <div>
        <div class="label">Female</div>
        <div class="value">${female}</div>
      </div>
    </div>
  `
}

function renderRecentTable(rows) {
  const container = document.getElementById('recentContainer')
  if (!rows || rows.length === 0) {
    container.innerHTML = `<div class="empty-state">No admissions found. Click <strong>+ New Admission</strong> to add the first student.</div>`
    return
  }
  const tableRows = rows.slice(0, 50).map(s => `
    <tr>
      <td style="width:140px">${escapeHtml(s.student_id)}</td>
      <td>${escapeHtml(s.full_name)}</td>
      <td>${escapeHtml(s.gender)}</td>
      <td>${escapeHtml(s.class_name)}</td>
      <td>${escapeHtml(normalizeStudentType(s.student_type))}</td>
      <td>${escapeHtml(s.academic_year)}</td>
      <td>${s.has_disability ? 'Yes' : 'No'}</td>
      <td><span class="status-pill ${s.status === 'Archived' ? 'status-archived' : 'status-active'}">${escapeHtml(s.status)}</span></td>
      <td style="width:200px" class="action-buttons-cell">
        <button class="btn btn-sm btn-action btn-action-view" data-id="${escapeHtml(s.student_id)}" title="View details"><i class="bi bi-eye"></i></button>
        <button class="btn btn-sm btn-action btn-action-edit" data-id="${escapeHtml(s.student_id)}" title="Edit student"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-action btn-action-delete" data-id="${escapeHtml(s.student_id)}" title="Delete record"><i class="bi bi-trash"></i></button>
      </td>
    </tr>
  `).join('\n')

  container.innerHTML = `
    <div class="records-table-wrap">
      <table class="table table-modern">
        <thead><tr><th>Student ID</th><th>Student Name</th><th>Gender</th><th>Class</th><th>Type</th><th>Year</th><th>Disability</th><th>Status</th><th class="action-buttons-cell">Actions</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `

  // attach action handlers
  Array.from(document.querySelectorAll('.btn-action-view')).forEach(b => b.addEventListener('click', (e) => {
    const id = e.currentTarget.dataset.id
    showStudentProfile(id)
  }))
  Array.from(document.querySelectorAll('.btn-action-edit')).forEach(b => b.addEventListener('click', (e) => {
    const id = e.currentTarget.dataset.id
    const s = _studentsCache.find(x => x.student_id === id)
    if (s) showEditForm(s)
  }))
  Array.from(document.querySelectorAll('.btn-action-delete')).forEach(b => b.addEventListener('click', async (e) => {
    const id = e.currentTarget.dataset.id
    const confirmed = await window.customConfirm({
      title: 'Delete student?',
      message: 'Permanently delete this student? This cannot be undone.',
      okText: 'Delete'
    })
    if (!confirmed) return
    const res = await window.api.deleteStudent(id)
    if (res.success) {
      showToast('Student deleted', 'success')
      await refreshStudentData()
    } else {
      showToast('Unable to delete: ' + (res.error || ''), 'error')
    }
  }))
}

function escapeHtml(s) { if (s===null||s===undefined) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

function showToast(message, type='info') {
  let t = document.getElementById('appToast')
  if (!t) {
    t = document.createElement('div'); t.id = 'appToast'
    t.style.position = 'fixed'; t.style.right = '20px'; t.style.bottom = '20px'; t.style.zIndex = 9999
    document.body.appendChild(t)
  }
  const el = document.createElement('div')
  el.className = 'toast-item'
  el.style.background = type === 'success' ? '#E6F6F0' : '#fff'
  el.style.border = '1px solid rgba(20,33,61,0.06)'
  el.style.padding = '10px 14px'
  el.style.borderRadius = '8px'
  el.style.boxShadow = '0 6px 20px rgba(16,24,40,0.06)'
  el.innerText = message
  t.appendChild(el)
  setTimeout(() => { el.style.transition = 'opacity 300ms'; el.style.opacity = '0'; setTimeout(() => el.remove(), 320) }, 2800)
}

async function loadAdmission() {
  const main = document.getElementById('main')
  const year = new Date().getFullYear()
  const [newId, setup] = await Promise.all([window.api.generateStudentId(String(year)), window.api.listFinanceSetup()])
  const classOptions = (setup.classes || []).map(item => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join('')
  main.innerHTML = `
    <div class="container-fluid py-4">
      <div class="reg-workspace">
        <div class="reg-header d-flex align-items-center justify-content-between">
          <div>
            <h3 class="mb-1">Student Admission</h3>
            <div class="small text-muted">Create a student record — optimized for desktop data entry</div>
          </div>
          <div>
            <button id="backToRecords" class="btn btn-secondary-deep">&larr; Back to Records</button>
          </div>
        </div>

        <form id="admissionForm" novalidate>
          <div class="row g-3">
            <div class="col-lg-8">
              <div class="form-section">
                <div class="row g-2 admission-equal-row">
                  <div class="col-lg-4"><label class="form-label">Student ID</label><div class="id-input"><div class="id-lock" aria-hidden="true">🔒</div><input id="student_id" class="form-control-plaintext" readonly value="${newId}"></div></div>
                  <div class="col-lg-4"><label class="form-label">Full Name <span class="text-danger">*</span></label><input id="full_name" class="form-control form-control-sm" required autocomplete="name"><div class="invalid-feedback" id="err_full_name"></div></div>
                  <div class="col-lg-4"><label class="form-label">Student Type</label><div class="segmented" id="student_type_seg" role="tablist"><div class="seg-item" data-value="New Student">New Student</div><div class="seg-item active" data-value="Returning">Returning</div></div></div>
                </div>
                <div class="row g-2 mt-1 admission-equal-row">
                  <div class="col-lg-3"><label class="form-label">Date of Birth</label><input id="date_of_birth" type="date" class="form-control form-control-sm" required><div class="invalid-feedback" id="err_dob"></div></div>
                  <div class="col-lg-3"><label class="form-label">Place of Birth</label><input id="place_of_birth" class="form-control form-control-sm"></div>
                  <div class="col-lg-3"><label class="form-label">Gender</label><select id="gender" class="form-select form-select-sm"><option>Male</option><option>Female</option></select></div>
                  <div class="col-lg-3"><label class="form-label">Class <span class="text-danger">*</span></label><select id="class_name" class="form-select form-select-sm" required><option value="">Select class</option>${classOptions}</select><div class="invalid-feedback" id="err_class"></div></div>
                </div>
              </div>
            </div>

            <div class="col-lg-4">
              <div class="form-section">
                <h6 class="mb-2">Emergency Contact</h6>
                <div class="row gx-2 gy-2">
                  <div class="col-12">
                    <input id="emergency_contact_name" class="form-control form-control-sm" placeholder="Contact Name" required>
                    <div class="invalid-feedback" id="err_emergency_contact_name"></div>
                  </div>
                  <div class="col-6">
                    <input id="emergency_contact_relationship" class="form-control form-control-sm" placeholder="Relationship">
                  </div>
                  <div class="col-6">
                    <input id="emergency_contact_phone" class="form-control form-control-sm" placeholder="Phone" required>
                    <div class="invalid-feedback" id="err_emergency_contact_phone"></div>
                  </div>
                  <div class="col-12">
                    <input id="emergency_contact_address" class="form-control form-control-sm" placeholder="Address">
                  </div>
                </div>
              </div>

              <div class="form-section mt-2">
                <h6 class="mb-2">Disability & Support</h6>
                <div class="row gx-2 gy-2 align-items-center">
                  <div class="col-auto">
                    <div class="field-label">Disability?</div>
                    <div class="segmented" id="disabilitySegment" role="tablist">
                      <div class="seg-item active" data-value="no">No</div>
                      <div class="seg-item" data-value="yes">Yes</div>
                    </div>
                  </div>
                  <div class="col-12">
                    <div class="disclosure" id="disabilityArea">
                      <div class="mb-2">
                        <input id="disability_type" class="form-control form-control-sm" placeholder="Disability Type">
                      </div>
                      <div>
                        <input id="support_needed" class="form-control form-control-sm" placeholder="Support needed / notes">
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="col-12">
              <div class="sticky-actions desktop-sticky">
                <div class="text-muted">Status: <strong>Draft</strong></div>
                <div class="actions">
                  <button id="cancelBtn" class="btn btn-outline-secondary btn-sm">Cancel</button>
                  <button id="saveAddAnother" class="btn btn-outline-primary btn-sm" type="button">Save & Add Another</button>
                  <button id="saveRegister" class="btn btn-new btn-loading btn-sm" type="submit">Save Registration</button>
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  `

  document.getElementById('backToRecords').addEventListener('click', (e) => { loadAdmissionRecords() })
  document.getElementById('cancelBtn').addEventListener('click', (e) => { location.hash = '#/'; loadAdmissionRecords() })
  // segmented control for Student Type
  const segItems = Array.from(document.querySelectorAll('#student_type_seg .seg-item'))
  segItems.forEach(it => it.addEventListener('click', (e) => {
    segItems.forEach(x => x.classList.remove('active'))
    e.currentTarget.classList.add('active')
  }))

  // disability segmented control
  const disSeg = document.querySelectorAll('#disabilitySegment .seg-item')
  const disArea = document.getElementById('disabilityArea')
  disSeg.forEach(it => it.addEventListener('click', (e) => {
    disSeg.forEach(x => x.classList.remove('active'))
    e.currentTarget.classList.add('active')
    const val = e.currentTarget.dataset.value
    if (val === 'yes') { disArea.classList.add('open'); disArea.scrollIntoView({behavior:'smooth'}) } else { disArea.classList.remove('open'); ['disability_type','support_needed'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value = '' }) }
  }))

  // Save handlers
  async function collectForm() {
    return {
      student_id: document.getElementById('student_id').value,
      full_name: document.getElementById('full_name').value.trim(),
      date_of_birth: document.getElementById('date_of_birth').value,
      place_of_birth: document.getElementById('place_of_birth').value.trim(),
      gender: document.getElementById('gender').value,
      class_name: document.getElementById('class_name').value.trim(),
      student_type: (document.querySelector('#student_type_seg .seg-item.active') ? document.querySelector('#student_type_seg .seg-item.active').dataset.value : 'Returning'),
      emergency_contact_name: document.getElementById('emergency_contact_name').value.trim(),
      emergency_contact_relationship: document.getElementById('emergency_contact_relationship').value.trim(),
      emergency_contact_phone: document.getElementById('emergency_contact_phone').value.trim(),
      emergency_contact_address: document.getElementById('emergency_contact_address').value.trim(),
      has_disability: (document.querySelector('#disabilitySegment .seg-item.active') && document.querySelector('#disabilitySegment .seg-item.active').dataset.value === 'yes'),
      disability_type: document.getElementById('disability_type').value.trim(),
      support_needed: document.getElementById('support_needed').value.trim(),
      registration_date: new Date().toISOString().split('T')[0],
      academic_year: String(new Date().getFullYear()),
      status: 'Active'
    }
  }

  function resetAdmissionForm(nextId) {
    const form = document.getElementById('admissionForm')
    form.reset()
    document.getElementById('student_id').value = nextId
    document.querySelectorAll('#admissionForm .is-invalid').forEach(element => element.classList.remove('is-invalid'))
    document.querySelectorAll('#admissionForm .invalid-feedback').forEach(element => { element.innerText = '' })
    document.querySelectorAll('#disabilitySegment .seg-item').forEach(item => item.classList.toggle('active', item.dataset.value === 'no'))
    document.querySelectorAll('#student_type_seg .seg-item').forEach(item => item.classList.toggle('active', item.dataset.value === 'Returning'))
    document.getElementById('disabilityArea').classList.remove('open')
    document.getElementById('full_name').focus()
  }

  function clearValidation() {
    ['full_name','date_of_birth','class_name','emergency_contact_name','emergency_contact_phone'].forEach(id => {
      const el = document.getElementById(id)
      if (!el) return
      el.classList.remove('is-invalid')
      const err = document.getElementById('err_' + id)
      if (err) err.innerText = ''
    })
  }

  function validate(student) {
    clearValidation()
    let ok = true
    if (!student.full_name) { document.getElementById('full_name').classList.add('is-invalid'); document.getElementById('err_full_name').innerText = 'Full name is required'; ok = false }
    if (!student.date_of_birth) { document.getElementById('date_of_birth').classList.add('is-invalid'); document.getElementById('err_dob').innerText = 'Date of birth is required'; ok = false }
    if (!student.class_name) { document.getElementById('class_name').classList.add('is-invalid'); document.getElementById('err_class').innerText = 'Class is required'; ok = false }
    if (!student.emergency_contact_name) { document.getElementById('emergency_contact_name').classList.add('is-invalid'); document.getElementById('err_emergency_contact_name').innerText = 'Contact name required'; ok = false }
    if (!student.emergency_contact_phone) { document.getElementById('emergency_contact_phone').classList.add('is-invalid'); document.getElementById('err_emergency_contact_phone').innerText = 'Contact phone required'; ok = false }
    // if disability required fields
    if (student.has_disability && !student.disability_type) { document.getElementById('disability_type').classList.add('is-invalid'); ok = false }
    return ok
  }

  // Save single
  document.getElementById('admissionForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = document.getElementById('saveRegister')
    btn.disabled = true
    const originalLabel = btn.innerHTML
    btn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Saving...`
    const student = await collectForm()
    if (!validate(student)) { btn.disabled = false; btn.innerText = 'Save Registration'; return }

    // check duplicate by student_id
    const dup = await window.api.listStudents({ query: student.student_id })
    if (dup && dup.length > 0) { showToast('A student with this Student ID already exists', 'error'); btn.disabled = false; btn.innerText = 'Save Registration'; return }

    const res = await window.api.addStudent(student)
    if (res.success) {
      await refreshStudentData()
      // show success with actions
      showSaveResult(student.student_id)
      btn.disabled = false
      btn.innerHTML = originalLabel
    } else {
      showToast('Unable to register: ' + (res.error||''), 'error')
      btn.disabled = false; btn.innerHTML = originalLabel
    }
  })

  // Save & Add Another
  document.getElementById('saveAddAnother').addEventListener('click', async (e) => {
    e.preventDefault()
    const btn = document.getElementById('saveAddAnother')
    btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Saving...`
    const student = await collectForm()
    if (!validate(student)) { btn.disabled = false; btn.innerText = 'Save & Add Another'; return }
    const dup = await window.api.listStudents({ query: student.student_id })
    if (dup && dup.length > 0) { showToast('Duplicate student ID detected', 'error'); btn.disabled = false; btn.innerText = 'Save & Add Another'; return }
    const res = await window.api.addStudent(student)
    if (res.success) {
      showToast('Saved — add another', 'success')
      // generate next id and clear fields
      const newId = await window.api.generateStudentId(String(new Date().getFullYear()))
      resetAdmissionForm(newId)
      btn.disabled = false; btn.innerHTML = orig
    } else {
      showToast('Unable to save: ' + (res.error||''), 'error')
      btn.disabled = false; btn.innerHTML = orig
    }
  })

  // Post-save action sheet / toast
  function showSaveResult(studentId) {
    const container = document.createElement('div')
    container.style.position = 'fixed'
    container.style.left = '50%'
    container.style.transform = 'translateX(-50%)'
    container.style.bottom = '24px'
    container.style.zIndex = 9999
    container.style.minWidth = '360px'
    container.className = 'recent-card'
    container.innerHTML = `
      <div><strong>Student registered</strong> — <small>${escapeHtml(studentId)}</small></div>
      <div class="toast-actions">
        <button id="viewNew" class="btn btn-outline-primary">View Student</button>
        <button id="addAnother" class="btn btn-outline-secondary">Add Another Student</button>
        <button id="backRecords" class="btn btn-secondary-deep">Back to Records</button>
      </div>
    `
    document.body.appendChild(container)
    document.getElementById('viewNew').addEventListener('click', () => { container.remove(); showStudentProfile(studentId) })
    document.getElementById('addAnother').addEventListener('click', async () => {
      container.remove()
      const newId = await window.api.generateStudentId(String(new Date().getFullYear()))
      resetAdmissionForm(newId)
    })
    document.getElementById('backRecords').addEventListener('click', () => { container.remove(); loadAdmissionRecords() })
    setTimeout(() => { try { container.style.transition = 'opacity 300ms'; container.style.opacity = '0'; setTimeout(()=>container.remove(),320) } catch(e){} }, 9000)
  }
}

function renderOwingStudentsTable(students, money) {
  if (!students.length) return '<div class="finance-empty"><i class="bi bi-check-circle"></i><strong>No students are owing</strong></div>'
  return `<table class="table table-modern finance-table"><thead><tr><th>Student</th><th>Student ID</th><th>Class</th><th class="text-end">Amount Paid</th><th class="text-end">Balance</th><th></th></tr></thead><tbody>${students.map(student => `<tr><td><strong>${escapeHtml(student.full_name)}</strong></td><td>${escapeHtml(student.student_id)}</td><td>${escapeHtml(student.class_name)}</td><td class="text-end">${money(student.paid)}</td><td class="text-end"><strong>${money(student.balance)}</strong></td><td class="text-end"><button type="button" class="btn btn-sm btn-outline-primary owing-view-account" data-id="${escapeHtml(student.student_id)}" data-year="${escapeHtml(student.academic_year)}">View account</button></td></tr>`).join('')}</tbody></table>`
}

function renderFinancialStatusRows(students, money) {
  if (!students.length) return '<div class="finance-empty"><i class="bi bi-search"></i><strong>No matching student accounts</strong><span>Try changing the report filters.</span></div>'
  return `<div class="records-table-wrap"><table class="table table-modern finance-table"><thead><tr><th>Student ID</th><th>Student Name</th><th>Class</th><th class="text-end">Amount Obligated</th><th class="text-end">Amount Paid</th><th class="text-end">Outstanding Balance</th></tr></thead><tbody>${students.map(student => `<tr><td>${escapeHtml(student.student_id)}</td><td><strong>${escapeHtml(student.full_name)}</strong></td><td>${escapeHtml(student.class_name)}</td><td class="text-end">${money(student.obligated)}</td><td class="text-end">${money(student.paid)}</td><td class="text-end"><strong>${money(student.balance)}</strong></td></tr>`).join('')}</tbody></table></div>`
}

function showFinancialStatusPrint(students, filters) {
  const existing = document.querySelector('.print-preview-overlay')
  if (existing) existing.remove()
  const periodLabel = filters.phase === 'Full Year' ? 'Full Year' : filters.phase
  const classLabel = filters.class_name || 'All Classes'
  const overlay = document.createElement('div')
  overlay.className = 'print-preview-overlay'
  overlay.innerHTML = `<div class="print-preview-dialog" role="dialog" aria-modal="true"><div class="print-preview-toolbar"><h3>Financial Status Report</h3><div class="print-preview-actions"><button type="button" class="btn btn-outline-secondary" id="closeFinancialReportPrint">Close</button><button type="button" class="btn btn-new" id="printFinancialReport">Print</button></div></div><div class="print-preview-page financial-report-print"><header><h1>${escapeHtml(document.title.replace('CyberChris Offline School', ''))}Financial Status Report</h1><p>${escapeHtml(filters.academic_year)} · ${escapeHtml(periodLabel)} · ${escapeHtml(classLabel)} · ${escapeHtml(filters.payment_status)}</p><small>Generated ${escapeHtml(new Date().toLocaleString())}</small></header><div class="financial-report-print-table">${renderFinancialStatusRows(students, cents => `L$${(Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)}</div><p class="financial-report-count">${students.length} student${students.length === 1 ? '' : 's'}</p></div></div>`
  document.body.appendChild(overlay)
  document.body.classList.add('print-preview-active')
  const close = () => { overlay.remove(); document.body.classList.remove('print-preview-active') }
  overlay.querySelector('#closeFinancialReportPrint').addEventListener('click', close)
  overlay.querySelector('#printFinancialReport').addEventListener('click', () => window.print())
}

async function loadFinance() {
  const main = document.getElementById('main')
  main.innerHTML = '<div class="container-fluid py-4"><div class="finance-loading">Loading Finance...</div></div>'
  const [finance, setup, owing] = await Promise.all([window.api.getFinanceSummary(), window.api.listFinanceSetup(), window.api.listOwingStudents()])
  const summary = finance.summary || {}
  const money = cents => `L$${(Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const cards = [
    ['Total Obligations', summary.obligations, 'bi-receipt', 'finance-card-blue'],
    ['Total Collected', summary.collected, 'bi-cash-coin', 'finance-card-pink'],
    ['Total Expenditure', summary.expenses, 'bi-bag-dash', 'finance-card-warning'],
    ['Outstanding Balance', summary.outstanding, 'bi-wallet2', 'finance-card-warning'],
    ["Today's Collections", summary.today_collected, 'bi-calendar-check', 'finance-card-blue'],
    ['Monthly Collections', summary.month_collected, 'bi-bar-chart-line', 'finance-card-blue'],
    ['Net Position', summary.net_position, 'bi-graph-up-arrow', 'finance-card-pink']
  ]
  const owingStudents = owing.students || []
  const owingMoney = cents => `L$${(Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  main.innerHTML = `
    <div class="container-fluid py-4">
      <div class="finance-header page-header"><div><div class="finance-eyebrow"><i class="bi bi-wallet2"></i> Finance workspace</div><h2>Finance Dashboard</h2><p class="small text-muted">Monitor obligations, collections, balances, and the school’s financial position.</p></div><div class="finance-header-actions"><button class="btn btn-outline-secondary" id="openFinanceSetup"><i class="bi bi-sliders"></i> Finance Setup</button><button class="btn btn-outline-primary" id="openRecordExpense"><i class="bi bi-bag-dash"></i> Record Expenditure</button><button class="btn btn-new" id="openReceivePayment"><i class="bi bi-plus-lg"></i> Receive Payment</button></div></div>
      <div class="finance-summary-grid">${cards.map(([label, value, icon, tone]) => `<div class="finance-summary-card ${tone}"><div class="finance-summary-icon"><i class="bi ${icon}"></i></div><div><span>${label}</span><strong>${money(value)}</strong></div></div>`).join('')}</div>
      <section class="recent-card finance-panel owing-students-panel"><div class="finance-panel-heading"><div><h5>Students owing</h5><p>Students whose balance is greater than zero.</p></div><span class="finance-status">${owingStudents.length} owing</span></div><div class="owing-filter-row"><input id="owingStudentFilter" class="form-control form-control-sm" placeholder="Filter by student name or ID"><span class="small text-muted">Balance uses valid payments only.</span></div><div class="records-table-wrap owing-table-wrap" id="owingStudentsTable">${renderOwingStudentsTable(owingStudents, owingMoney)}</div></section>
      <section class="recent-card finance-panel financial-status-report"><div class="finance-panel-heading"><div><h5>Financial / Outstanding Student Report</h5><p>Filter by actual student obligations and valid recorded payments.</p></div><span class="finance-status" id="financialReportCount">Not generated</span></div><div class="financial-report-filters"><label>Academic year<select id="financialReportYear" class="form-select form-select-sm">${(setup.academicYears || []).map((year, index) => `<option value="${escapeHtml(year.name)}" ${year.is_current || (!setup.academicYears.some(item => item.is_current) && index === 0) ? 'selected' : ''}>${escapeHtml(year.name)}</option>`).join('')}</select></label><label>Financial period<select id="financialReportPhase" class="form-select form-select-sm"><option value="First Semester">Semester 1</option><option value="Second Semester">Semester 2</option><option value="Full Year" selected>Full Year</option></select></label><label>Class<select id="financialReportClass" class="form-select form-select-sm"><option value="">All Classes</option>${(setup.classes || []).map(item => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join('')}</select></label><label>Payment status<select id="financialReportStatus" class="form-select form-select-sm"><option>All</option><option>Owing</option><option>Fully Paid</option></select></label><div class="financial-report-actions"><button type="button" class="btn btn-outline-primary" id="generateFinancialReport"><i class="bi bi-funnel"></i> Apply Filters</button><button type="button" class="btn btn-new" id="printFinancialReportButton" disabled><i class="bi bi-printer"></i> Print Results</button></div></div><div id="financialReportResults"><div class="finance-empty"><i class="bi bi-funnel"></i><strong>Select filters and apply</strong></div></div></section>
      <div class="finance-content-grid"><section class="recent-card finance-panel"><div class="finance-panel-heading"><div><h5>Recent payments</h5><p>Valid transactions will appear here.</p></div><span class="finance-status">${(finance.recentPayments || []).length} transactions</span></div>${(finance.recentPayments || []).length ? `<div class="records-table-wrap"><table class="table table-modern finance-table"><thead><tr><th>Receipt</th><th>Student</th><th>Date</th><th>Method</th><th class="text-end">Amount</th></tr></thead><tbody>${finance.recentPayments.map(payment => `<tr><td>${escapeHtml(payment.receipt_number)}</td><td><strong>${escapeHtml(payment.full_name)}</strong><small>${escapeHtml(payment.student_id)} · ${escapeHtml(payment.class_name)}</small></td><td>${escapeHtml(payment.payment_date)}</td><td>${escapeHtml(payment.payment_method)}</td><td class="text-end">${money(payment.amount_cents)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="finance-empty"><i class="bi bi-receipt"></i><strong>No payments recorded yet</strong><span>Receive a payment to start building the collection history.</span></div>'}</section><section class="recent-card finance-panel"><div class="finance-panel-heading"><div><h5>Finance setup</h5><p>Editable configuration foundation</p></div><i class="bi bi-database-check finance-setup-icon"></i></div><div class="finance-setup-list"><div><span>Academic years</span><strong>${(setup.academicYears || []).length}</strong></div><div><span>Semesters</span><strong>${(setup.semesters || []).length}</strong></div><div><span>Classes</span><strong>${(setup.classes || []).length}</strong></div><div><span>Fee groups</span><strong>${(setup.feeGroups || []).length}</strong></div><div><span>Fee types</span><strong>${(setup.feeTypes || []).length}</strong></div><div><span>Fee structures</span><strong>${(setup.feeStructures || []).length}</strong></div><div><span>Installments</span><strong>${(setup.paymentSchedules || []).length}</strong></div><div><span>Expense categories</span><strong>${(setup.expenseCategories || []).length}</strong></div></div><div class="finance-note"><i class="bi bi-info-circle"></i><span>Fee structures and installment schedules will define obligations before payments are received.</span></div></section></div>
    </div>
  `
  document.getElementById('openFinanceSetup').addEventListener('click', loadFinanceSetup)
  document.getElementById('openRecordExpense').addEventListener('click', showRecordExpense)
  document.getElementById('openReceivePayment').addEventListener('click', () => showReceivePayment())
  const owingFilter = document.getElementById('owingStudentFilter')
  const owingTable = document.getElementById('owingStudentsTable')
  owingFilter.addEventListener('input', () => {
    const query = owingFilter.value.trim().toLowerCase()
    const filtered = owingStudents.filter(student => `${student.full_name} ${student.student_id}`.toLowerCase().includes(query))
    owingTable.innerHTML = renderOwingStudentsTable(filtered, owingMoney)
    bindOwingAccountLinks()
  })
  function bindOwingAccountLinks() {
    owingTable.querySelectorAll('.owing-view-account').forEach(button => button.addEventListener('click', async () => {
      const selected = await window.api.listStudents({ query: button.dataset.id, status: 'Active' })
      if (selected[0]) showReceivePayment(selected[0], button.dataset.year)
    }))
  }
  bindOwingAccountLinks()
  const generateFinancialReport = document.getElementById('generateFinancialReport')
  const reportResults = document.getElementById('financialReportResults')
  const reportCount = document.getElementById('financialReportCount')
  const printReportButton = document.getElementById('printFinancialReportButton')
  let currentReportStudents = []
  const reportFilters = () => ({
    academic_year: document.getElementById('financialReportYear').value,
    phase: document.getElementById('financialReportPhase').value,
    class_name: document.getElementById('financialReportClass').value,
    payment_status: document.getElementById('financialReportStatus').value
  })
  generateFinancialReport.addEventListener('click', async () => {
    const filters = reportFilters()
    if (!filters.academic_year) {
      reportResults.innerHTML = '<div class="finance-empty"><strong>No academic years are configured.</strong></div>'
      reportCount.innerText = 'Unavailable'
      printReportButton.disabled = true
      return
    }
    generateFinancialReport.disabled = true
    reportResults.innerHTML = '<div class="finance-loading">Preparing financial report...</div>'
    const result = await window.api.listFinancialStatusReport(filters)
    generateFinancialReport.disabled = false
    if (!result.success) {
      currentReportStudents = []
      reportResults.innerHTML = `<div class="finance-empty"><strong>${escapeHtml(result.error || 'Unable to prepare report.')}</strong></div>`
      reportCount.innerText = 'Error'
      printReportButton.disabled = true
      return
    }
    currentReportStudents = result.students || []
    reportResults.innerHTML = renderFinancialStatusRows(currentReportStudents, owingMoney)
    reportCount.innerText = `${currentReportStudents.length} student${currentReportStudents.length === 1 ? '' : 's'}`
    printReportButton.disabled = currentReportStudents.length === 0
  })
  printReportButton.addEventListener('click', () => {
    if (currentReportStudents.length) showFinancialStatusPrint(currentReportStudents, reportFilters())
  })
}

function renderFeeTemplateRows(items, phase) {
  const rows = items.length ? items : [{ fee_name: '', amount_cents: 0 }]
  return rows.map((item, index) => `<div class="fee-template-row" data-phase="${escapeHtml(phase)}" data-row="${index}"><input class="form-control form-control-sm template-fee-name" placeholder="Fee name" value="${escapeHtml(item.fee_name || '')}"><input class="form-control form-control-sm template-fee-amount" type="number" min="0" step="0.01" placeholder="Amount" value="${item.amount_cents ? (Number(item.amount_cents) / 100).toFixed(2) : ''}"><button type="button" class="btn btn-sm btn-outline-danger remove-template-fee" title="Remove fee"><i class="bi bi-trash"></i></button></div>`).join('')
}

async function loadLegacyFinanceSetup() {
  const main = document.getElementById('main')
  main.innerHTML = '<div class="container-fluid py-4"><div class="finance-loading">Loading Finance Setup...</div></div>'
  const [setup, templateResult] = await Promise.all([window.api.listFinanceSetup(), window.api.listFeeTemplates()])
  const templates = templateResult.templates || []
  const money = cents => `L$${(Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const groupedStructures = (setup.feeStructures || []).reduce((groups, row) => { const key = `${row.fee_group} · ${row.semester}`; (groups[key] ||= []).push(row); return groups }, {})
    const emptyPhase = phase => ({ phase, deadline: '', items: [] })
  main.innerHTML = `
    <div class="container-fluid py-4 finance-setup-screen"><div class="page-header"><div><div class="finance-eyebrow"><i class="bi bi-sliders"></i> Finance configuration</div><h2>Finance Setup</h2><p class="small text-muted">Review the academic structure, fee components, and payment schedule used for student obligations.</p></div><button id="backToFinance" class="btn btn-outline-secondary"><i class="bi bi-arrow-left"></i> Back to Finance</button></div>
      <div class="finance-setup-tabs"><span class="active"><i class="bi bi-cash-stack"></i> Fee structure</span><span><i class="bi bi-calendar2-week"></i> Payment schedule</span><span><i class="bi bi-mortarboard"></i> Classes &amp; groups</span></div>
      <section class="recent-card finance-setup-panel fee-template-workspace"><div class="finance-panel-heading"><div><h5>Fee Templates</h5><p>One fee template per class. Existing student obligations remain historical snapshots.</p></div><span class="finance-status">${templates.length} templates</span></div><div class="fee-template-layout"><div><div class="records-table-wrap fee-template-table-wrap"><table class="table table-modern finance-table"><thead><tr><th>Class</th><th>Fee items</th><th class="text-end">Total</th><th class="text-end">Action</th></tr></thead><tbody>${templates.length ? templates.map(template => `<tr><td><strong>${escapeHtml(template.class_name)}</strong></td><td>${template.items.length}</td><td class="text-end"><strong>${money(template.total_cents)}</strong></td><td class="text-end"><button type="button" class="btn btn-sm btn-outline-primary edit-fee-template" data-id="${template.id}">Edit</button> <button type="button" class="btn btn-sm btn-outline-danger delete-fee-template" data-id="${template.id}" data-class="${escapeHtml(template.class_name)}"><i class="bi bi-trash"></i></button></td></tr>`).join('') : '<tr><td colspan="4" class="text-center text-muted">No class fee templates created yet.</td></tr>'}</tbody></table></div></div><form id="feeTemplateForm" class="fee-template-editor"><h6 id="feeTemplateEditorTitle">Add Class Fee Template</h6><select id="feeTemplateClass" class="form-select form-select-sm" required><option value="">Select class</option>${(setup.classes || []).map(item => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join('')}</select><div id="feeTemplateRows" class="fee-template-rows">${renderFeeTemplateRows([])}</div><div class="fee-template-total"><span>Total</span><strong id="feeTemplateTotal">L$0.00</strong></div><div class="fee-template-editor-actions"><button type="button" id="addFeeTemplateRow" class="btn btn-sm btn-outline-secondary"><i class="bi bi-plus-lg"></i> Add Fee</button><button type="submit" class="btn btn-sm btn-new">Save Template</button><button type="button" id="cancelFeeTemplateEdit" class="btn btn-sm btn-link">Clear</button></div></form></div></section>
      <div class="finance-setup-reference"><section class="recent-card finance-setup-panel"><div class="finance-panel-heading"><div><h5>Actual school classes</h5><p>Students use these classes.</p></div></div><div class="finance-chip-list">${(setup.classes || []).map(item => `<span>${escapeHtml(item.name)}</span>`).join('')}</div></section><section class="recent-card finance-setup-panel"><div class="finance-panel-heading"><div><h5>Fee groups</h5><p>Fee groups determine applicable structures.</p></div></div><div class="finance-chip-list">${(setup.feeGroups || []).map(item => `<span>${escapeHtml(item.name)}</span>`).join('')}</div></section></div>
    </div>`
  document.getElementById('backToFinance').addEventListener('click', loadFinance)
  const templateForm = document.getElementById('feeTemplateForm')
  const templateRows = document.getElementById('feeTemplateRows')
  const templateTotal = document.getElementById('feeTemplateTotal')
  let editingTemplateId = null
  const updateTemplateTotal = () => {
    const total = [...templateRows.querySelectorAll('.template-fee-amount')].reduce((sum, input) => sum + Math.round(Math.max(0, Number(input.value) || 0) * 100), 0)
    templateTotal.innerText = money(total)
  }
  const clearTemplateEditor = () => { editingTemplateId = null; templateForm.reset(); document.getElementById('feeTemplateClass').disabled = false; templateRows.innerHTML = renderFeeTemplateRows([]); document.getElementById('feeTemplateEditorTitle').innerText = 'Add Class Fee Template'; updateTemplateTotal() }
  document.getElementById('addFeeTemplateRow').addEventListener('click', () => { templateRows.insertAdjacentHTML('beforeend', renderFeeTemplateRows([{ fee_name: '', amount_cents: 0 }])); updateTemplateTotal() })
  templateRows.addEventListener('input', updateTemplateTotal)
  templateRows.addEventListener('click', event => { if (event.target.closest('.remove-template-fee')) { const row = event.target.closest('.fee-template-row'); if (templateRows.children.length > 1) row.remove(); else row.querySelectorAll('input').forEach(input => { input.value = '' }); updateTemplateTotal() } })
  document.getElementById('cancelFeeTemplateEdit').addEventListener('click', clearTemplateEditor)
  templateForm.addEventListener('submit', async event => {
    event.preventDefault()
    const items = [...templateRows.querySelectorAll('.fee-template-row')].map(row => ({ fee_name: row.querySelector('.template-fee-name').value.trim(), amount_cents: Math.round((Number(row.querySelector('.template-fee-amount').value) || 0) * 100) })).filter(item => item.fee_name || item.amount_cents)
    const result = await window.api.saveFeeTemplate({ class_name: document.getElementById('feeTemplateClass').value, items })
    if (result.success) { showToast('Fee template saved.', 'success'); loadFinanceSetup() } else showToast(result.error || 'Unable to save fee template.', 'error')
  })
  document.querySelectorAll('.edit-fee-template').forEach(button => button.addEventListener('click', () => { const template = templates.find(item => String(item.id) === button.dataset.id); if (!template) return; editingTemplateId = template.id; document.getElementById('feeTemplateClass').value = template.class_name; document.getElementById('feeTemplateClass').disabled = true; templateRows.innerHTML = renderFeeTemplateRows(template.items); document.getElementById('feeTemplateEditorTitle').innerText = `Edit ${template.class_name} Fee Template`; updateTemplateTotal() }))
  document.querySelectorAll('.delete-fee-template').forEach(button => button.addEventListener('click', async () => {
    const confirmed = await window.customConfirm({
      title: 'Delete fee template?',
      message: `Delete the ${button.dataset.class} fee template? Existing student obligations will not be affected.`,
      okText: 'Delete'
    })
    if (!confirmed) return
    const result = await window.api.deleteFeeTemplate(button.dataset.id)
    if (result.success) { showToast('Fee template deleted.', 'success'); loadFinanceSetup() } else showToast(result.error || 'Unable to delete fee template.', 'error')
  }))
}

async function loadFinanceSetup() {
  const main = document.getElementById('main')
  main.innerHTML = '<div class="container-fluid py-4"><div class="finance-loading">Loading Finance Setup...</div></div>'
  const [setup, templateResult] = await Promise.all([window.api.listFinanceSetup(), window.api.listFeeTemplates()])
  const templates = templateResult.templates || []
  const phases = ['First Semester', 'Second Semester']
  const money = cents => `L$${(Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const phaseOf = (template, name) => template.phases?.find(item => item.phase === name) || { phase: name, deadline: '', items: [], total_cents: 0 }
  main.innerHTML = `<div class="container-fluid py-4 finance-setup-screen"><div class="page-header"><div><div class="finance-eyebrow"><i class="bi bi-sliders"></i> Finance configuration</div><h2>Finance Setup</h2><p class="small text-muted">Configure exactly two fee phases for each class.</p></div><button id="backToFinance" class="btn btn-outline-secondary"><i class="bi bi-arrow-left"></i> Back to Finance</button></div><section class="recent-card finance-setup-panel fee-template-workspace"><div class="finance-panel-heading"><div><h5>Fee Templates</h5><p>Each class has a First Semester and Second Semester template.</p></div><span class="finance-status">${templates.length} templates</span></div><div class="fee-template-layout"><div class="records-table-wrap fee-template-table-wrap"><table class="table table-modern finance-table"><thead><tr><th>Class</th><th>First Semester</th><th>Second Semester</th><th class="text-end">Year Total</th><th class="text-end">Action</th></tr></thead><tbody>${templates.length ? templates.map(template => { const first = phaseOf(template, phases[0]); const second = phaseOf(template, phases[1]); return `<tr><td><strong>${escapeHtml(template.class_name)}</strong></td><td>${money(first.total_cents)}<small>${escapeHtml(first.deadline || 'No deadline')}</small></td><td>${money(second.total_cents)}<small>${escapeHtml(second.deadline || 'No deadline')}</small></td><td class="text-end"><strong>${money(template.total_cents)}</strong></td><td class="text-end"><button type="button" class="btn btn-sm btn-outline-primary edit-fee-template" data-id="${template.id}">Edit</button> <button type="button" class="btn btn-sm btn-outline-danger delete-fee-template" data-id="${template.id}" data-class="${escapeHtml(template.class_name)}"><i class="bi bi-trash"></i></button></td></tr>` }).join('') : '<tr><td colspan="5" class="text-center text-muted">No class fee templates created yet.</td></tr>'}</tbody></table></div><form id="feeTemplateForm" class="fee-template-editor"><h6 id="feeTemplateEditorTitle">Add Class Fee Template</h6><select id="feeTemplateClass" class="form-select form-select-sm" required><option value="">Select class</option>${(setup.classes || []).map(item => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join('')}</select><div class="fee-template-phases">${phases.map(phase => `<div class="fee-template-phase" data-phase="${phase}"><h6>${phase}</h6><label class="small text-muted">Deadline<input class="form-control form-control-sm template-deadline" type="date"></label><div class="fee-template-rows">${renderFeeTemplateRows([], phase)}</div><div class="fee-template-phase-total">Total <strong class="template-phase-total">L$0.00</strong></div><button type="button" class="btn btn-sm btn-outline-secondary add-fee-template-row"><i class="bi bi-plus-lg"></i> Add Fee</button></div>`).join('')}</div><div class="fee-template-total"><span>Year Total</span><strong id="feeTemplateTotal">L$0.00</strong></div><div class="fee-template-editor-actions"><button type="submit" class="btn btn-sm btn-new">Save Template</button><button type="button" id="cancelFeeTemplateEdit" class="btn btn-sm btn-link">Clear</button></div></form></div></section></div>`
  document.getElementById('backToFinance').addEventListener('click', loadFinance)
  const form = document.getElementById('feeTemplateForm')
  const updateTotals = () => { let yearTotal = 0; document.querySelectorAll('.fee-template-phase').forEach(phaseElement => { const total = [...phaseElement.querySelectorAll('.template-fee-amount')].reduce((sum, input) => sum + Math.round(Math.max(0, Number(input.value) || 0) * 100), 0); yearTotal += total; phaseElement.querySelector('.template-phase-total').innerText = money(total) }); document.getElementById('feeTemplateTotal').innerText = money(yearTotal) }
  const clearEditor = () => { form.reset(); document.getElementById('feeTemplateClass').disabled = false; document.querySelectorAll('.fee-template-rows').forEach((rows, index) => { rows.innerHTML = renderFeeTemplateRows([], phases[index]) }); document.getElementById('feeTemplateEditorTitle').innerText = 'Add Class Fee Template'; updateTotals() }
  document.querySelectorAll('.add-fee-template-row').forEach(button => button.addEventListener('click', () => { const phase = button.closest('.fee-template-phase'); phase.querySelector('.fee-template-rows').insertAdjacentHTML('beforeend', renderFeeTemplateRows([{ fee_name: '', amount_cents: 0 }], phase.dataset.phase)); updateTotals() }))
  form.addEventListener('input', updateTotals)
  form.addEventListener('click', event => { if (!event.target.closest('.remove-template-fee')) return; const row = event.target.closest('.fee-template-row'); const rows = row.parentElement; if (rows.children.length > 1) row.remove(); else row.querySelectorAll('input').forEach(input => { input.value = '' }); updateTotals() })
  document.getElementById('cancelFeeTemplateEdit').addEventListener('click', clearEditor)
  form.addEventListener('submit', async event => { event.preventDefault(); const payload = { class_name: document.getElementById('feeTemplateClass').value, phases: [...document.querySelectorAll('.fee-template-phase')].map(phaseElement => ({ phase: phaseElement.dataset.phase, deadline: phaseElement.querySelector('.template-deadline').value || null, items: [...phaseElement.querySelectorAll('.fee-template-row')].map(row => ({ fee_name: row.querySelector('.template-fee-name').value.trim(), amount_cents: Math.round((Number(row.querySelector('.template-fee-amount').value) || 0) * 100) })).filter(item => item.fee_name) })) }; const result = await window.api.saveFeeTemplate(payload); if (result.success) { showToast('Fee template saved.', 'success'); loadFinanceSetup() } else showToast(result.error || 'Unable to save fee template.', 'error') })
  document.querySelectorAll('.edit-fee-template').forEach(button => button.addEventListener('click', () => { const template = templates.find(item => String(item.id) === button.dataset.id); if (!template) return; document.getElementById('feeTemplateClass').value = template.class_name; document.getElementById('feeTemplateClass').disabled = true; phases.forEach((name, index) => { const phase = phaseOf(template, name); const phaseElement = document.querySelectorAll('.fee-template-phase')[index]; phaseElement.querySelector('.template-deadline').value = phase.deadline || ''; phaseElement.querySelector('.fee-template-rows').innerHTML = renderFeeTemplateRows(phase.items, name) }); document.getElementById('feeTemplateEditorTitle').innerText = `Edit ${template.class_name} Fee Template`; updateTotals() }))
  document.querySelectorAll('.delete-fee-template').forEach(button => button.addEventListener('click', async () => {
    const confirmed = await window.customConfirm({
      title: 'Delete fee template?',
      message: `Delete the ${button.dataset.class} fee template? Existing student obligations will not be affected.`,
      okText: 'Delete'
    })
    if (!confirmed) return
    const result = await window.api.deleteFeeTemplate(button.dataset.id)
    if (result.success) { showToast('Fee template deleted.', 'success'); loadFinanceSetup() } else showToast(result.error || 'Unable to delete fee template.', 'error')
  }))
  updateTotals()
}

async function loadSettings() {
  const main = document.getElementById('main')
  const profileResult = await window.api.getSchoolProfile()
  const profile = profileResult.profile || { school_name: 'CyberChris Offline School', address: '', motto: '', logo_data: '' }
  main.innerHTML = `
    <div class="container-fluid py-4">
      <div class="page-header">
        <div>
          <h2>Settings</h2>
          <p class="small text-muted">System configuration, users and preferences will be available here.</p>
        </div>
        <div>
          <button class="btn btn-secondary-deep" onclick="loadDashboard()">&larr; Back</button>
        </div>
      </div>
      <section class="recent-card finance-panel school-profile-panel">
        <div class="finance-panel-heading"><div><h5>School letterhead</h5><p>This information will appear on receipts and printed documents.</p></div><i class="bi bi-building-check finance-setup-icon"></i></div>
        <form id="schoolProfileForm" class="school-profile-form"><div class="school-profile-fields"><label>School name<input id="schoolName" class="form-control form-control-sm" value="${escapeHtml(profile.school_name)}" required></label><label>School address / heading<textarea id="schoolAddress" class="form-control form-control-sm" rows="2" placeholder="Address, location, contact details">${escapeHtml(profile.address || '')}</textarea></label><label>School motto<input id="schoolMotto" class="form-control form-control-sm" value="${escapeHtml(profile.motto || '')}" placeholder="Your school motto"></label><label>Logo<input id="schoolLogo" type="file" class="form-control form-control-sm" accept="image/png,image/jpeg,image/webp"><small class="text-muted">PNG, JPG, or WebP</small></label></div><div class="school-logo-preview">${profile.logo_data ? `<img src="${profile.logo_data}" alt="School logo">` : '<span>No logo selected</span>'}</div><div class="text-end"><button class="btn btn-new btn-sm" type="submit"><i class="bi bi-check2"></i> Save Letterhead</button></div></form>
      </section>
      <section class="recent-card finance-panel data-safety-panel">
        <div class="finance-panel-heading"><div><h5>School records protection</h5><p>Move operational school records between installations without replacing local configuration.</p></div><i class="bi bi-shield-check finance-setup-icon"></i></div>
        <div class="data-safety-actions"><button id="backupDatabaseBtn" class="btn btn-new"><i class="bi bi-download"></i> Backup School Records</button><button id="restoreDatabaseBtn" class="btn btn-outline-primary"><i class="bi bi-upload"></i> Restore School Records</button></div>
        <div class="finance-note"><i class="bi bi-info-circle"></i><span>Backups include students, admissions, classes, academic records, attendance, and financial records only. This installation keeps its school name, logo, users, passwords, and application settings.</span></div>
      </section>
    </div>
  `
  let logoData = profile.logo_data || ''
  document.getElementById('schoolLogo').addEventListener('change', event => { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { logoData = reader.result; document.querySelector('.school-logo-preview').innerHTML = `<img src="${logoData}" alt="School logo">` }; reader.readAsDataURL(file) })
  document.getElementById('schoolProfileForm').addEventListener('submit', async event => { event.preventDefault(); const result = await window.api.saveSchoolProfile({ school_name: document.getElementById('schoolName').value, address: document.getElementById('schoolAddress').value, motto: document.getElementById('schoolMotto').value, logo_data: logoData }); if (result.success) { showToast('School letterhead saved.', 'success'); await renderSystemMarquee() } else showToast(result.error || 'Unable to save school letterhead.', 'error') })
  document.getElementById('backupDatabaseBtn').addEventListener('click', async () => {
    const result = await window.api.backupDatabase()
    if (result.success) showToast('School records backup saved successfully.', 'success')
    else if (!result.canceled) showToast(result.error || 'Unable to create school records backup.', 'error')
  })
  document.getElementById('restoreDatabaseBtn').addEventListener('click', async () => {
    const confirmed = await window.customConfirm({
      title: 'Restore school records?',
      message: 'Student, academic, attendance, and financial records will be imported.\n\nThis installation\'s school name, logo, users, passwords, and application settings will not change.\n\nAn automatic safety backup of the current school records will be created first.',
      okText: 'Restore'
    })
    if (!confirmed) return
    const result = await window.api.restoreDatabase()
    if (result.success) {
      showToast('School records restored. Local configuration was preserved. Reloading...', 'success')
      setTimeout(() => window.location.reload(), 700)
    } else if (!result.canceled) showToast(result.error || 'Unable to restore school records.', 'error')
  })
}

async function loadAcademics() {
  const main = document.getElementById('main')
  main.innerHTML = `
    <div class="container-fluid py-4">
      <div class="page-header">
        <div>
          <h2>Academics (Coming Soon)</h2>
          <p class="small text-muted">Academics will handle classes, subjects, results and promotion.</p>
        </div>
        <div>
          <button class="btn btn-secondary-deep" onclick="loadDashboard()">&larr; Back</button>
        </div>
      </div>
      <div class="placeholder-card">This module is under development.</div>
    </div>
  `
}

async function showStudentProfile(studentId) {
  const all = _studentsCache
  const s = all.find(x => x.student_id === studentId) || (await window.api.listStudents({ query: studentId }))[0]
  if (!s) { showToast('Student not found', 'error'); return }
  const main = document.getElementById('main')
  main.innerHTML = `
    <div class="container-fluid py-4">
      <div class="page-header">
        <div>
          <h2>Student Profile</h2>
          <p class="small text-muted">Profile and admission information for ${escapeHtml(s.full_name)}</p>
        </div>
        <div>
          <button id="backToList" class="btn btn-secondary-deep">&larr; Back</button>
          <button id="financialAccount" class="btn btn-outline-primary"><i class="bi bi-wallet2"></i> Financial Account</button>
          <button id="editStudent" class="btn btn-new">Edit</button>
        </div>
      </div>
      <div class="profile-card">
        <div class="profile-meta">
          <h4>${escapeHtml(s.full_name)}</h4>
          <div class="text-muted">${escapeHtml(s.student_id)}</div>
          <div style="margin-top:12px"><strong>Class:</strong> ${escapeHtml(s.class_name)}</div>
          <div><strong>Type:</strong> ${escapeHtml(normalizeStudentType(s.student_type))}</div>
          <div><strong>Status:</strong> ${escapeHtml(s.status)}</div>
        </div>
        <div class="profile-details">
          <h5>Admission Information</h5>
          <div><strong>Registration Date:</strong> ${escapeHtml(s.registration_date)}</div>
          <div><strong>Academic Year:</strong> ${escapeHtml(s.academic_year)}</div>
          <hr>
          <h5>Contact</h5>
          <div><strong>Emergency Contact:</strong> ${escapeHtml(s.emergency_contact_name)} (${escapeHtml(s.emergency_contact_relationship)})</div>
          <div><strong>Phone:</strong> ${escapeHtml(s.emergency_contact_phone)}</div>
          <div><strong>Address:</strong> ${escapeHtml(s.emergency_contact_address || '')}</div>
          <hr>
          <h5>Disability</h5>
          <div>${s.has_disability ? ('<strong>Type:</strong> '+escapeHtml(s.disability_type || '') + '<br><strong>Support:</strong> ' + escapeHtml(s.support_needed || '')) : 'No reported disability'}</div>
        </div>
      </div>
    </div>
  `
  document.getElementById('backToList').addEventListener('click', () => loadAdmissionRecords())
  document.getElementById('financialAccount').addEventListener('click', () => loadStudentFinancialAccount(s))
  document.getElementById('editStudent').addEventListener('click', () => showEditForm(s))
}

async function loadStudentFinancialAccount(student) {
  const main = document.getElementById('main')
  main.innerHTML = '<div class="container-fluid py-4"><div class="finance-loading">Loading student financial account...</div></div>'
  const result = await window.api.getStudentFinancialAccount({ studentId: student.student_id, academicYear: student.academic_year })
  if (!result.success) { showToast(result.error || 'Financial account not found', 'error'); showStudentProfile(student.student_id); return }
  const session = await window.api.me()
  const canCorrectPayments = String(session?.user?.role || '').toLowerCase() === 'admin'
  const money = cents => `L$${(Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const phaseBalances = ['First Semester', 'Second Semester'].map(name => result.phases?.find(phase => phase.phase === name) || { phase: name, obligation: 0, paid: 0, balance: 0 })
  main.innerHTML = `<div class="container-fluid py-4 finance-account-screen"><div class="page-header"><div><div class="finance-eyebrow"><i class="bi bi-wallet2"></i> Student finance</div><h2>${escapeHtml(result.account.full_name)}</h2><p class="small text-muted">${escapeHtml(result.account.student_id)} · ${escapeHtml(result.account.class_name)} · Academic Year ${escapeHtml(result.account.academic_year)}</p></div><button id="backToProfile" class="btn btn-outline-secondary"><i class="bi bi-arrow-left"></i> Back to profile</button></div><div class="finance-account-summary"><div><span>Year Obligation</span><strong>${money(result.totals.obligation)}</strong></div><div><span>Year Paid</span><strong>${money(result.totals.paid)}</strong></div><div><span>Year Balance</span><strong>${money(result.totals.balance)}</strong></div></div><div class="finance-phase-balances">${phaseBalances.map(phase => `<div><span>${phase.phase} Balance</span><strong>${money(phase.balance)}</strong><small>Obligation ${money(phase.obligation)} · Paid ${money(phase.paid)}</small></div>`).join('')}</div><section class="recent-card finance-panel"><div class="finance-panel-heading"><div><h5>Payment history</h5><p>Every valid, voided, and recalled transaction remains auditable. Corrections are logged with before-and-after values.</p></div><button class="btn btn-new" id="receiveFromAccount"><i class="bi bi-plus-lg"></i> Receive Payment</button></div>${result.payments.length ? `<div class="records-table-wrap"><table class="table table-modern finance-table"><thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th>Status</th><th class="text-end">Amount</th><th class="text-end">Action</th></tr></thead><tbody>${result.payments.map((payment, index) => `<tr><td>${escapeHtml(payment.receipt_number)}</td><td>${escapeHtml(payment.payment_date)}</td><td>${escapeHtml(payment.payment_method)}</td><td>${escapeHtml(payment.status)}</td><td class="text-end">${money(payment.amount_cents)}</td><td class="text-end">${canCorrectPayments && payment.status === 'VALID' ? `<button type="button" class="btn btn-sm btn-outline-warning correct-history-payment" data-index="${index}"><i class="bi bi-pencil-square"></i> Correct</button> ` : ''}<button type="button" class="btn btn-sm btn-outline-primary print-history-receipt" data-index="${index}"><i class="bi bi-printer"></i> Print</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="finance-empty"><i class="bi bi-clock-history"></i><strong>No payments recorded</strong><span>Payment history will appear here after the first receipt.</span></div>'}</section></div>`
  document.getElementById('backToProfile').addEventListener('click', () => showStudentProfile(student.student_id))
  document.getElementById('receiveFromAccount').addEventListener('click', () => showReceivePayment(student, result.account.academic_year))
  document.querySelectorAll('.print-history-receipt').forEach(button => button.addEventListener('click', () => printHistoricalReceipt(result.payments[Number(button.dataset.index)], result, money)))
  document.querySelectorAll('.correct-history-payment').forEach(button => button.addEventListener('click', () => showPaymentCorrectionDialog(result.payments[Number(button.dataset.index)], result, student)))
}

async function showPaymentCorrectionDialog(payment, accountResult, currentStudent) {
  const students = await window.api.listStudents({ status: 'Active' })
  const overlay = document.createElement('div')
  overlay.className = 'print-preview-overlay'
  const studentOptions = students.map(item => `<option value="${escapeHtml(item.student_id)}" data-year="${escapeHtml(item.academic_year)}" ${item.student_id === accountResult.account.student_id ? 'selected' : ''}>${escapeHtml(item.student_id)} · ${escapeHtml(item.full_name)} · ${escapeHtml(item.class_name)} (${escapeHtml(item.academic_year)})</option>`).join('')
  overlay.innerHTML = `<div class="print-preview-dialog payment-correction-dialog" role="dialog" aria-modal="true" aria-labelledby="paymentCorrectionTitle"><div class="print-preview-toolbar"><div><h3 id="paymentCorrectionTitle">Correct Recorded Payment</h3><small>Receipt ${escapeHtml(payment.receipt_number)} · original values will be retained in the audit log</small></div><button type="button" class="btn btn-outline-secondary" id="closePaymentCorrection">Close</button></div><form class="payment-correction-form" id="paymentCorrectionForm"><label>Correct student<select id="correctionStudent" class="form-select" required>${studentOptions}</select></label><label>Amount paid<input id="correctionAmount" class="form-control" type="number" min="0.01" step="0.01" value="${(Number(payment.amount_cents) / 100).toFixed(2)}" required></label><label>Payment date<input id="correctionDate" class="form-control" type="date" value="${escapeHtml(payment.payment_date)}" required></label><label>Payment method<select id="correctionMethod" class="form-select" required>${['Cash', 'Mobile Money', 'Bank', 'Check', 'Other'].map(method => `<option ${method === payment.payment_method ? 'selected' : ''}>${method}</option>`).join('')}</select></label><label>Reference number<input id="correctionReference" class="form-control" value="${escapeHtml(payment.reference_number || '')}"></label><label>Note<input id="correctionNote" class="form-control" value="${escapeHtml(payment.note || '')}"></label><label class="correction-reason-label">Reason for correction<textarea id="correctionReason" class="form-control" maxlength="500" rows="2" required placeholder="Explain what was entered incorrectly and the source of the correction"></textarea></label><div class="payment-correction-warning"><i class="bi bi-exclamation-triangle"></i> This changes which account receives the valid payment and will recalculate financial balances and totals. The original values and reason are recorded for audit.</div><div id="paymentCorrectionError" class="text-danger small"></div><div class="payment-correction-actions"><button type="button" class="btn btn-outline-secondary" id="cancelPaymentCorrection">Cancel</button><button type="submit" class="btn btn-new" id="confirmPaymentCorrection"><i class="bi bi-check2-circle"></i> Review &amp; Correct</button></div></form></div>`
  document.body.appendChild(overlay)
  const close = () => overlay.remove()
  overlay.querySelector('#closePaymentCorrection').addEventListener('click', close)
  overlay.querySelector('#cancelPaymentCorrection').addEventListener('click', close)
  overlay.querySelector('#paymentCorrectionForm').addEventListener('submit', async event => {
    event.preventDefault()
    const targetSelect = overlay.querySelector('#correctionStudent')
    const target = targetSelect.selectedOptions[0]
    const amountCents = Math.round(Number(overlay.querySelector('#correctionAmount').value) * 100)
    const reason = overlay.querySelector('#correctionReason').value.trim()
    const targetStudent = students.find(item => item.student_id === target.value)
    const money = cents => `L$${(Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    if (!targetStudent || !reason) return
    const confirmed = await window.customConfirm({
      title: 'Confirm payment correction?',
      message: `Receipt: ${payment.receipt_number}\nFrom: ${accountResult.account.full_name} (${accountResult.account.student_id})\nTo: ${targetStudent.full_name} (${targetStudent.student_id})\nAmount: ${money(payment.amount_cents)} → ${money(amountCents)}\nReason: ${reason}\n\nThis action will be recorded in the audit log.`,
      okText: 'Confirm correction'
    })
    if (!confirmed) return
    const submit = overlay.querySelector('#confirmPaymentCorrection')
    const error = overlay.querySelector('#paymentCorrectionError')
    submit.disabled = true
    submit.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Saving correction...'
    const correction = {
      payment_id: payment.id, student_id: targetStudent.student_id, academic_year: targetStudent.academic_year,
      amount_cents: amountCents, payment_method: overlay.querySelector('#correctionMethod').value,
      payment_date: overlay.querySelector('#correctionDate').value,
      reference_number: overlay.querySelector('#correctionReference').value,
      note: overlay.querySelector('#correctionNote').value, reason
    }
    const result = await window.api.correctPayment(correction)
    if (!result.success) {
      error.innerText = result.error || 'Unable to correct payment.'
      submit.disabled = false
      submit.innerHTML = '<i class="bi bi-check2-circle"></i> Review &amp; Correct'
      return
    }
    close()
    showToast(`Payment ${payment.receipt_number} corrected and audit logged.`, 'success')
    loadStudentFinancialAccount(currentStudent)
  })
}

async function printHistoricalReceipt(payment, accountResult, money) {
  const school = (await window.api.getSchoolProfile()).profile || { school_name: 'CyberChris Offline School', address: '', motto: '', logo_data: '' }
  const qr = await window.api.generateReceiptQr({ receipt: payment.receipt_number, student_id: accountResult.account.student_id, student_name: accountResult.account.full_name, school_name: school.school_name, amount_cents: payment.amount_cents, amount_display: money(payment.amount_cents), payment_date: payment.payment_date, status: payment.status })
  const paymentIndex = accountResult.payments.findIndex(item => item.receipt_number === payment.receipt_number)
  const earlierPayments = accountResult.payments.slice(paymentIndex + 1).filter(item => item.status === 'VALID').reduce((total, item) => total + Number(item.amount_cents || 0), 0)
  const previousBalance = Math.max(0, Number(accountResult.totals.obligation) - earlierPayments)
  showReceiptSuccess({ receiptText: `Receipt: ${payment.receipt_number}\nStudent: ${accountResult.account.full_name}\nAmount: ${money(payment.amount_cents)}\nMethod: ${payment.payment_method}\nPayment date: ${payment.payment_date}`, receiptNumber: payment.receipt_number, qrDataUrl: qr.success ? qr.dataUrl : '', student: accountResult.account, amount: payment.amount_cents, method: payment.payment_method, paymentDate: payment.payment_date, previousBalance, newBalance: Math.max(0, previousBalance - Number(payment.amount_cents || 0)), reference: payment.reference_number || '', school }, () => {})
}

async function showRecordExpense() {
  const main = document.getElementById('main')
  const [setup, expenseResult] = await Promise.all([window.api.listFinanceSetup(), window.api.listExpenses()])
  const categories = (setup.expenseCategories || []).length ? (setup.expenseCategories || []).map(item => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join('') : '<option value="Other">Other</option>'
  const money = cents => `L$${(Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const expenses = expenseResult.expenses || []
  main.innerHTML = `
    <div class="container-fluid py-4 finance-account-screen">
      <div class="page-header">
        <div>
          <div class="finance-eyebrow"><i class="bi bi-bag-dash"></i> Cash flow</div>
          <h2>Record Expenditure</h2>
          <p class="small text-muted">Log school spending and deduct it from total collections to compute net position.</p>
        </div>
        <button id="cancelExpense" class="btn btn-outline-secondary"><i class="bi bi-arrow-left"></i> Back</button>
      </div>

      <section class="recent-card finance-panel payment-details-panel mt-3">
        <div class="finance-panel-heading">
          <div><h5>Expenditure details</h5><p>Every recorded expense reduces the school's net balance.</p></div>
          <span class="finance-status">Net = collections - expenses</span>
        </div>
        <form id="recordExpenseForm" class="payment-details-form mt-2">
          <div class="payment-primary-fields">
            <label>Category
              <select id="expenseCategory" class="form-select form-select-sm" required>
                ${categories}
              </select>
            </label>
            <label>Amount<input id="expenseAmount" type="number" min="0.01" step="0.01" placeholder="0.00" required></label>
            <label>Expense date<input id="expenseDate" type="date" class="form-control form-control-sm" value="${new Date().toISOString().slice(0, 10)}" required></label>
          </div>
          <div class="payment-secondary-fields">
            <label>Description <span>(required)</span><input id="expenseDescription" class="form-control form-control-sm" placeholder="School supplies, utilities, salaries..." required></label>
            <label>Payment method<select id="expenseMethod" class="form-select form-select-sm"><option>Cash</option><option>Mobile Money</option><option>Bank</option><option>Check</option><option>Other</option></select></label>
            <label>Reference number <span>(optional)</span><input id="expenseReference" class="form-control form-control-sm" placeholder="Invoice, transfer or voucher reference"></label>
          </div>
          <label>Note <span>(optional)</span><textarea id="expenseNote" class="form-control form-control-sm" rows="2" placeholder="Short note about the expenditure"></textarea></label>
          <div class="d-flex justify-content-end gap-2 mt-3">
            <button type="button" id="cancelExpenseForm" class="btn btn-outline-secondary">Cancel</button>
            <button type="submit" class="btn btn-new"><i class="bi bi-check2"></i> Save Expenditure</button>
          </div>
        </form>
      </section>

      <section class="recent-card finance-panel mt-3">
        <div class="finance-panel-heading"><div><h5>Recent expenditures</h5><p>Latest valid school expenses.</p></div><span class="finance-status">${expenses.length} recorded</span></div>
        ${expenses.length ? `<div class="records-table-wrap"><table class="table table-modern finance-table"><thead><tr><th>Category</th><th>Description</th><th>Date</th><th>Method</th><th class="text-end">Amount</th></tr></thead><tbody>${expenses.map(item => `<tr><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.expense_date)}</td><td>${escapeHtml(item.payment_method)}</td><td class="text-end">${money(item.amount_cents)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="finance-empty"><i class="bi bi-bag-dash"></i><strong>No expenditures recorded yet</strong><span>Add the first expense to start tracking operating costs.</span></div>'}
      </section>
    </div>
  `

  document.getElementById('cancelExpense').addEventListener('click', loadFinance)
  document.getElementById('cancelExpenseForm').addEventListener('click', loadFinance)

  document.getElementById('recordExpenseForm').addEventListener('submit', async (event) => {
    event.preventDefault()
    const amount = Math.round(Number(document.getElementById('expenseAmount').value) * 100)
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      showToast('Expenditure amount must be greater than zero.', 'error')
      return
    }

    const payload = {
      category: document.getElementById('expenseCategory').value.trim(),
      description: document.getElementById('expenseDescription').value.trim(),
      amount_cents: amount,
      payment_method: document.getElementById('expenseMethod').value,
      reference_number: document.getElementById('expenseReference').value.trim(),
      expense_date: document.getElementById('expenseDate').value,
      note: document.getElementById('expenseNote').value.trim()
    }

    const result = await window.api.recordExpense(payload)
    if (!result.success) {
      showToast(result.error || 'Unable to record expenditure.', 'error')
      return
    }

    showToast('Expenditure recorded successfully.', 'success')
    await loadFinance()
  })
}

async function showReceivePayment(student, academicYear) {
  const main = document.getElementById('main')
  const setup = await window.api.listFinanceSetup()
  const schoolProfile = (await window.api.getSchoolProfile()).profile || { school_name: 'CyberChris Offline School', address: '', motto: '', logo_data: '' }
  const year = academicYear || setup.academicYears?.find(item => item.is_current)?.name || setup.academicYears?.[0]?.name || String(new Date().getFullYear())
  const money = cents => `L$${(Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  main.innerHTML = `<div class="container-fluid py-4 finance-account-screen"><div class="page-header"><div><div class="finance-eyebrow"><i class="bi bi-cash-coin"></i> Cashier workflow</div><h2>Receive Payment</h2><p class="small text-muted">Search student, review balance, record payment, issue receipt.</p></div><button id="cancelReceive" class="btn btn-outline-secondary"><i class="bi bi-arrow-left"></i> Back</button></div><section class="recent-card finance-panel"><div class="finance-panel-heading"><div><h5>1. Search student</h5><p>Payments apply to the student's overall obligation.</p></div><span class="finance-status">Academic Year ${escapeHtml(year)}</span></div><div class="row g-2 mt-1"><div class="col-md-8"><input id="paymentStudentSearch" class="form-control form-control-sm" placeholder="Search by student name or ID" value="${escapeHtml(student?.full_name || '')}"></div><div class="col-md-4"><select id="paymentYear" class="form-select form-select-sm">${(setup.academicYears || []).map(item => `<option value="${escapeHtml(item.name)}"${item.name === year ? ' selected' : ''}>Academic Year ${escapeHtml(item.name)}</option>`).join('')}</select></div></div><div id="paymentStudentResults" class="list-group mt-2"></div></section><div id="paymentAccountArea"></div></div>`
  document.getElementById('cancelReceive').addEventListener('click', () => student ? loadStudentFinancialAccount(student) : loadFinance())
  const search = document.getElementById('paymentStudentSearch')
  const results = document.getElementById('paymentStudentResults')
  const accountArea = document.getElementById('paymentAccountArea')
  async function searchStudents() {
    const rows = await window.api.listStudents({ query: search.value.trim(), status: 'Active' })
    results.innerHTML = rows.length ? `<div class="records-table-wrap payment-search-table"><table class="table table-modern"><thead><tr><th>Student</th><th>Student ID</th><th>Class</th><th>Academic Year</th><th></th></tr></thead><tbody>${rows.slice(0, 8).map(row => `<tr><td><strong>${escapeHtml(row.full_name)}</strong></td><td>${escapeHtml(row.student_id)}</td><td>${escapeHtml(row.class_name)}</td><td>${escapeHtml(row.academic_year)}</td><td class="text-end"><button type="button" class="btn btn-sm btn-outline-primary payment-student-option" data-id="${escapeHtml(row.student_id)}">Select</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="small text-muted p-2">No active students found.</div>'
    results.querySelectorAll('.payment-student-option').forEach(button => button.addEventListener('click', async () => {
      const selected = rows.find(row => row.student_id === button.dataset.id)
      search.value = `${selected.full_name} (${selected.student_id})`
      results.innerHTML = ''
      await renderPaymentAccount(selected, document.getElementById('paymentYear').value)
    }))
  }
  async function renderPaymentAccount(selected, selectedYear) {
    const result = await window.api.getStudentFinancialAccount({ studentId: selected.student_id, academicYear: selectedYear })
    if (!result.success) { accountArea.innerHTML = `<div class="alert alert-warning mt-3">${escapeHtml(result.error)}</div>`; return }
    const schedules = result.schedules || []
    accountArea.innerHTML = `<section class="finance-account-summary finance-receive-summary mt-3"><div><span>Student Name</span><strong class="fs-6">${escapeHtml(result.account.full_name)}<small class="d-block text-muted">${escapeHtml(result.account.student_id)}</small></strong></div><div><span>Class</span><strong class="fs-6">${escapeHtml(result.account.class_name)}<small class="d-block text-muted">Academic Year ${escapeHtml(result.account.academic_year)}</small></strong></div><div><span>Amount to be Paid</span><strong>${money(result.totals.obligation)}</strong></div><div><span>Amount Paid</span><strong>${money(result.totals.paid)}</strong></div><div class="balance-total"><span>Amount Left</span><strong>${money(result.totals.balance)}</strong></div></section><section class="recent-card finance-panel payment-details-panel mt-3"><div class="finance-panel-heading"><div><h5>Payment details</h5><p>Record a payment against the student's overall class-based obligation.</p></div><span class="finance-status">Balance ${money(result.totals.balance)}</span></div><form id="receivePaymentForm" class="payment-details-form mt-2"><div class="payment-primary-fields"><label class="payment-amount-field">Amount being paid<input id="paymentAmount" type="number" min="0.01" step="0.01" placeholder="0.00" required></label><label>Payment method<select id="paymentMethod" class="form-select form-select-sm"><option>Cash</option><option>Mobile Money</option><option>Bank</option><option>Check</option><option>Other</option></select></label><label>Payment date<input id="paymentDate" type="date" class="form-control form-control-sm" value="${new Date().toISOString().slice(0, 10)}" required></label></div><div class="payment-secondary-fields"><label>Reference number <span>(optional)</span><input id="paymentReference" class="form-control form-control-sm" placeholder="Receipt or transfer reference"></label><label>Note <span>(optional)</span><input id="paymentNote" class="form-control form-control-sm" placeholder="Additional note"></label></div><div class="payment-submit-row"><small><i class="bi bi-shield-check"></i> The balance will be recalculated from the database after saving.</small><button class="btn btn-new" type="submit"><i class="bi bi-check2-circle"></i> Confirm Payment</button></div></form></section><section class="recent-card finance-panel mt-3"><div class="finance-panel-heading"><div><h5>Payment schedule</h5><p>Configured installments for this student's fee group.</p></div></div>${schedules.length ? `<div class="records-table-wrap"><table class="table table-modern finance-table"><thead><tr><th>Installment</th><th>Label</th><th>Due date</th><th class="text-end">Amount</th></tr></thead><tbody>${schedules.map(item => `<tr><td>${item.installment_number}</td><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.due_date || 'Not configured')}</td><td class="text-end">${money(item.amount_cents)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="finance-empty"><strong>No payment schedule configured</strong></div>'}</section><section class="recent-card finance-panel mt-3"><div class="finance-panel-heading"><div><h5>Payment history</h5><p>Only VALID payments count toward the balance.</p></div></div>${result.payments.length ? `<div class="records-table-wrap"><table class="table table-modern finance-table"><thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th>Status</th><th class="text-end">Amount</th></tr></thead><tbody>${result.payments.map(item => `<tr><td>${escapeHtml(item.receipt_number)}</td><td>${escapeHtml(item.payment_date)}</td><td>${escapeHtml(item.payment_method)}</td><td>${escapeHtml(item.status)}</td><td class="text-end">${money(item.amount_cents)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="finance-empty"><strong>No payments recorded</strong></div>'}</section>`
    document.getElementById('receivePaymentForm').addEventListener('submit', async event => {
      event.preventDefault()
      const amount = Math.round(Number(document.getElementById('paymentAmount').value) * 100)
      if (!Number.isSafeInteger(amount) || amount <= 0) { showToast('Payment amount must be greater than zero.', 'error'); return }
      if (amount > result.totals.balance) { showToast(`Payment cannot exceed the outstanding balance of ${money(result.totals.balance)}.`, 'error'); return }
      const method = document.getElementById('paymentMethod').value
      const previousBalance = result.totals.balance
      const confirmed = await window.customConfirm({
        title: 'Confirm payment?',
        message: `Student: ${result.account.full_name} (${result.account.student_id})\nAmount: ${money(amount)}\nMethod: ${method}\nPrevious balance: ${money(previousBalance)}\nNew projected balance: ${money(previousBalance - amount)}`,
        okText: 'Record payment'
      })
      if (!confirmed) return
      const saved = await window.api.recordPayment({ student_id: selected.student_id, academic_year: selectedYear, amount_cents: amount, payment_method: method, payment_date: document.getElementById('paymentDate').value, reference_number: document.getElementById('paymentReference').value.trim(), note: document.getElementById('paymentNote').value.trim() })
      if (!saved.success) { showToast(saved.error || 'Unable to record payment.', 'error'); return }
      const receiptText = `CYBERCHRIS OFFLINE SCHOOL\nchristianpablahbaker@gmail.com\n0555637569 / 0776908238\n\nRECEIPT: ${saved.receipt_number}\nStudent: ${result.account.full_name}\nStudent ID: ${result.account.student_id}\nAcademic Year: ${selectedYear}\nAmount: ${money(amount)}\nMethod: ${method}\nPayment date: ${document.getElementById('paymentDate').value}\nPrevious balance: ${money(saved.previous_balance)}\nNew balance: ${money(saved.new_balance)}\nReference: ${document.getElementById('paymentReference').value.trim() || 'None'}\nNote: ${document.getElementById('paymentNote').value.trim() || 'None'}`
      await renderPaymentAccount(selected, selectedYear)
      const qr = await window.api.generateReceiptQr({ receipt: saved.receipt_number, student_id: result.account.student_id, student_name: result.account.full_name, school_name: schoolProfile.school_name, amount_cents: amount, amount_display: money(amount), payment_date: document.getElementById('paymentDate').value, status: 'VALID' })
      showReceiptSuccess({ receiptText, receiptNumber: saved.receipt_number, qrDataUrl: qr.success ? qr.dataUrl : '', student: result.account, amount, method, paymentDate: document.getElementById('paymentDate').value, previousBalance: saved.previous_balance, newBalance: saved.new_balance, reference: document.getElementById('paymentReference').value.trim(), school: schoolProfile }, () => renderPaymentAccount(selected, selectedYear))
    })
  }
  if (student) await renderPaymentAccount(student, year)
  else searchStudents()
  search.addEventListener('input', searchStudents)
}

function showReceiptSuccess(receipt, refreshAccount) {
  const overlay = document.createElement('div')
  overlay.className = 'print-preview-overlay'
  const money = cents => `L$${(Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const school = receipt.school || {}
  overlay.innerHTML = `<div class="print-preview-dialog receipt-dialog" role="dialog" aria-modal="true"><div class="print-preview-toolbar"><h3>Payment recorded</h3><button class="btn btn-outline-secondary" id="closeReceipt">Close</button></div><div class="print-preview-page receipt-paper"><header class="receipt-letterhead">${school.logo_data ? `<img src="${school.logo_data}" alt="School logo">` : ''}<div><div class="receipt-kicker">${escapeHtml(school.school_name || 'School')}</div><h1>Official Payment Receipt</h1>${school.address ? `<p>${escapeHtml(school.address)}</p>` : ''}${school.motto ? `<em>${escapeHtml(school.motto)}</em>` : ''}</div><div class="receipt-status">VALID</div></header><div class="receipt-meta"><div><span>Receipt Number</span><strong>${escapeHtml(receipt.receiptNumber)}</strong></div><div><span>Payment Date</span><strong>${escapeHtml(receipt.paymentDate)}</strong></div><div><span>Payment Method</span><strong>${escapeHtml(receipt.method)}</strong></div><div><span>Reference</span><strong>${escapeHtml(receipt.reference || 'None')}</strong></div></div><section class="receipt-student"><span>Received from</span><strong>${escapeHtml(receipt.student.full_name)}</strong><small>${escapeHtml(receipt.student.student_id)} · ${escapeHtml(receipt.student.class_name)} · Academic Year ${escapeHtml(receipt.student.academic_year)}</small></section><section class="receipt-amount"><span>Amount Paid</span><strong>${money(receipt.amount)}</strong></section><div class="receipt-balance"><div><span>Previous balance</span><strong>${money(receipt.previousBalance)}</strong></div><div><span>New balance</span><strong>${money(receipt.newBalance)}</strong></div></div><footer class="receipt-footer"><div><p>Keep this receipt for your records.</p><small>Scan the QR code to verify the receipt details.</small></div>${receipt.qrDataUrl ? `<img class="receipt-qr" src="${receipt.qrDataUrl}" alt="Receipt verification QR code">` : '<div class="receipt-qr-missing">QR unavailable</div>'}</footer><div class="toast-actions receipt-actions"><button class="btn btn-outline-primary" id="printReceipt"><i class="bi bi-printer"></i> Print Receipt</button><button class="btn btn-new" id="saveReceipt"><i class="bi bi-download"></i> Save Receipt</button></div></div></div>`
  document.body.appendChild(overlay)
  const close = () => { overlay.remove(); refreshAccount() }
  overlay.querySelector('#closeReceipt').addEventListener('click', close)
  overlay.querySelector('#printReceipt').addEventListener('click', () => { document.body.classList.add('print-preview-active'); window.print(); document.body.classList.remove('print-preview-active') })
  overlay.querySelector('#saveReceipt').addEventListener('click', async () => { document.body.classList.add('print-preview-active'); let saved; try { saved = await window.api.saveReceipt({ receipt_number: receipt.receiptNumber }) } finally { document.body.classList.remove('print-preview-active') } if (saved?.success) showToast('Receipt PDF saved.', 'success'); else if (!saved?.canceled) showToast(saved?.error || 'Unable to save receipt PDF.', 'error') })
}

async function showEditForm(s) {
  // render full editable registration form for the student
  const main = document.getElementById('main')
  const setup = await window.api.listFinanceSetup()
  const editClassOptions = (setup.classes || []).map(item => `<option value="${escapeHtml(item.name)}"${item.name === s.class_name ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')
  main.innerHTML = `
    <div class="container-fluid py-4">
      <div class="reg-workspace">
        <div class="reg-header d-flex align-items-center justify-content-between">
          <div>
            <h3 class="mb-1">Edit Student</h3>
            <div class="small text-muted">Modify student details</div>
          </div>
          <div><button id="backList" class="btn btn-secondary-deep">&larr; Back</button></div>
        </div>

        <form id="editForm" novalidate>
          <div class="row g-3">
            <div class="col-lg-8">
              <div class="form-section">
                <div class="row gx-3 gy-2 align-items-center">
                  <div class="col-lg-8">
                    <label class="field-label">Full Name <span class="text-danger">*</span></label>
                    <input id="e_full_name" class="form-control form-control-sm" required value="${escapeHtml(s.full_name)}">
                    <div class="invalid-feedback" id="err_e_full_name"></div>
                  </div>
                  <div class="col-lg-4">
                    <label class="field-label">Student ID</label>
                    <div class="id-input"><div class="id-lock">🔒</div><input id="e_student_id" class="form-control-plaintext" readonly value="${escapeHtml(s.student_id)}"></div>
                    <small class="text-muted">Read-only</small>
                  </div>

                  <div class="col-md-4">
                    <label class="field-label">Student Type</label>
                    <div class="segmented" id="e_student_type_seg">
                      <div class="seg-item" data-value="New Student">New Student</div>
                      <div class="seg-item" data-value="Returning">Returning</div>
                    </div>
                  </div>
                  <div class="col-md-4">
                    <label class="field-label">Date of Birth</label>
                    <input id="e_date_of_birth" type="date" class="form-control form-control-sm" value="${escapeHtml(s.date_of_birth || '')}">
                  </div>
                  <div class="col-md-4">
                    <label class="field-label">Place of Birth</label>
                    <input id="e_place_of_birth" class="form-control form-control-sm" value="${escapeHtml(s.place_of_birth || '')}">
                  </div>

                  <div class="col-md-4">
                    <label class="field-label">Gender</label>
                    <select id="e_gender" class="form-select form-select-sm"><option${s.gender==='Male'?' selected':''}>Male</option><option${s.gender==='Female'?' selected':''}>Female</option></select>
                  </div>
                  <div class="col-md-4">
                    <label class="field-label">Class</label>
                    <select id="e_class_name" class="form-select form-select-sm"><option value="">Select class</option>${editClassOptions}</select>
                  </div>
                </div>
              </div>
            </div>

            <div class="col-lg-4">
              <div class="form-section">
                <h6 class="mb-2">Emergency Contact</h6>
                <div class="row gx-2 gy-2">
                  <div class="col-12">
                    <input id="e_emergency_contact_name" class="form-control form-control-sm" placeholder="Contact Name" value="${escapeHtml(s.emergency_contact_name || '')}">
                  </div>
                  <div class="col-6">
                    <input id="e_emergency_contact_relationship" class="form-control form-control-sm" placeholder="Relationship" value="${escapeHtml(s.emergency_contact_relationship || '')}">
                  </div>
                  <div class="col-6">
                    <input id="e_emergency_contact_phone" class="form-control form-control-sm" placeholder="Phone" value="${escapeHtml(s.emergency_contact_phone || '')}">
                  </div>
                  <div class="col-12">
                    <input id="e_emergency_contact_address" class="form-control form-control-sm" placeholder="Address" value="${escapeHtml(s.emergency_contact_address || '')}">
                  </div>
                </div>
              </div>

              <div class="form-section mt-2">
                <h6 class="mb-2">Disability & Support</h6>
                <div class="row gx-2 gy-2 align-items-center">
                  <div class="col-auto">
                    <div class="field-label">Disability?</div>
                    <div class="segmented" id="e_disability_seg">
                      <div class="seg-item" data-value="no">No</div>
                      <div class="seg-item" data-value="yes">Yes</div>
                    </div>
                  </div>
                  <div class="col-12">
                    <div class="disclosure ${s.has_disability ? 'open' : ''}" id="e_disabilityArea">
                      <div class="mb-2">
                        <input id="e_disability_type" class="form-control form-control-sm" placeholder="Disability Type" value="${escapeHtml(s.disability_type || '')}">
                      </div>
                      <div>
                        <input id="e_support_needed" class="form-control form-control-sm" placeholder="Support needed / notes" value="${escapeHtml(s.support_needed || '')}">
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="col-12">
              <div class="sticky-actions desktop-sticky" style="justify-content:flex-end">
                <div class="actions">
                  <button id="saveEdit" class="btn btn-new btn-sm" type="submit">Save Changes</button>
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  `

  document.getElementById('backList').addEventListener('click', () => loadAdmissionRecords())

  // initialize segmented controls and disability area
  const eTypeSeg = Array.from(document.querySelectorAll('#e_student_type_seg .seg-item'))
  eTypeSeg.forEach(it => { if (it.dataset.value === normalizeStudentType(s.student_type)) it.classList.add('active'); it.addEventListener('click', (e) => { eTypeSeg.forEach(x=>x.classList.remove('active')); e.currentTarget.classList.add('active') }) })
  const eDisSeg = Array.from(document.querySelectorAll('#e_disability_seg .seg-item'))
  const eDisArea = document.getElementById('e_disabilityArea')
  eDisSeg.forEach(it => { if ((s.has_disability? 'yes':'no') === it.dataset.value) it.classList.add('active'); it.addEventListener('click', (e) => { eDisSeg.forEach(x=>x.classList.remove('active')); e.currentTarget.classList.add('active'); if (e.currentTarget.dataset.value === 'yes') eDisArea.classList.add('open'); else { eDisArea.classList.remove('open'); document.getElementById('e_disability_type').value=''; document.getElementById('e_support_needed').value=''; } }) })

  document.getElementById('editForm').addEventListener('submit', async (ev) => {
    ev.preventDefault()
    const student = {
      student_id: document.getElementById('e_student_id').value,
      full_name: document.getElementById('e_full_name').value.trim(),
      date_of_birth: document.getElementById('e_date_of_birth').value,
      place_of_birth: document.getElementById('e_place_of_birth').value.trim(),
      gender: document.getElementById('e_gender').value,
      class_name: document.getElementById('e_class_name').value.trim(),
      student_type: (document.querySelector('#e_student_type_seg .seg-item.active')||{}).dataset.value || 'Returning',
      emergency_contact_name: document.getElementById('e_emergency_contact_name').value.trim(),
      emergency_contact_relationship: document.getElementById('e_emergency_contact_relationship').value.trim(),
      emergency_contact_phone: document.getElementById('e_emergency_contact_phone').value.trim(),
      emergency_contact_address: document.getElementById('e_emergency_contact_address').value.trim(),
      has_disability: (document.querySelector('#e_disability_seg .seg-item.active')||{}).dataset.value === 'yes',
      disability_type: document.getElementById('e_disability_type').value.trim(),
      support_needed: document.getElementById('e_support_needed').value.trim(),
      status: s.status || 'Active'
    }
    const res = await window.api.updateStudent(student)
    if (res.success) { showToast('Student updated','success'); await refreshStudentData(); loadAdmissionRecords() }
    else showToast('Unable to update: '+(res.error||''),'error')
  })
}

