// ============================================================
//  HygieNet Cloud Edition — Clean Dashboard & Portals JS (v3.0)
// ============================================================

const STORAGE_KEY = 'hygienet_auth_session';
let pollInterval = null;
let cachedUsers = [];
let cachedTransactions = [];
let cachedHopper = { current_stock: 50, capacity: 60, status: 'READY' };

// Refill form photo storage (base64)
let refillPhoto1Base64 = '';
let refillPhoto2Base64 = '';

// Active registration request ID
let tempRegistrationId = null;

// ------------------------------------------------------------
//  VERHOEFF ALGORITHM (UIDAI Standard Mathematical Checksum)
// ------------------------------------------------------------

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
];

const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
];

function validateVerhoeff(numStr) {
  if (!numStr) return false;
  const clean = String(numStr).replace(/\D/g, '');
  if (clean.length !== 12) return false;
  let c = 0;
  const digits = clean.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digits[i]]];
  }
  return c === 0;
}

function formatAndValidateAadhaar(inputEl, feedbackElId = 'aadhaar-feedback') {
  const raw = inputEl.value.replace(/\D/g, '').slice(0, 12);
  let formatted = '';
  for (let i = 0; i < raw.length; i += 4) {
    formatted += (i > 0 ? ' ' : '') + raw.slice(i, i + 4);
  }
  inputEl.value = formatted;

  const feedback = document.getElementById(feedbackElId);
  if (!feedback) return;

  if (raw.length === 0) {
    feedback.className = 'aadhaar-feedback';
    feedback.innerHTML = '<span class="indicator-icon">ℹ️</span><span class="indicator-text">Enter 12 digits to verify checksum</span>';
  } else if (raw.length < 12) {
    feedback.className = 'aadhaar-feedback';
    feedback.innerHTML = `<span class="indicator-icon">ℹ️</span><span class="indicator-text">${raw.length}/12 digits entered</span>`;
  } else {
    const isValid = validateVerhoeff(raw);
    if (isValid) {
      feedback.className = 'aadhaar-feedback valid';
      feedback.innerHTML = '<span class="indicator-icon">✅</span><span class="indicator-text">Valid Aadhaar (Verhoeff Checksum Passed)</span>';
    } else {
      feedback.className = 'aadhaar-feedback invalid';
      feedback.innerHTML = '<span class="indicator-icon">⚠️</span><span class="indicator-text">Invalid Aadhaar (Checksum failed - check digits)</span>';
    }
  }
}

// ------------------------------------------------------------
//  THEME SWITCHER (DARK MODE & LIGHT MODE)
// ------------------------------------------------------------

const THEME_STORAGE_KEY = 'hygienet_theme';

function initTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'dark';
  applyTheme(savedTheme);
}

function applyTheme(theme) {
  const isLight = theme === 'light';
  if (isLight) {
    document.documentElement.setAttribute('data-theme', 'light');
    document.body.classList.add('theme-light');
  } else {
    document.documentElement.removeAttribute('data-theme');
    document.body.classList.remove('theme-light');
  }

  const iconEl = document.getElementById('theme-icon');
  const labelEl = document.getElementById('theme-label');
  if (iconEl && labelEl) {
    if (isLight) {
      iconEl.textContent = '🌙';
      labelEl.textContent = 'Dark';
    } else {
      iconEl.textContent = '☀️';
      labelEl.textContent = 'Light';
    }
  }

  try {
    localStorage.setItem(THEME_STORAGE_KEY, isLight ? 'light' : 'dark');
  } catch (e) {
    console.warn('Could not save theme preference:', e);
  }
}

function toggleTheme() {
  const currentTheme = (document.documentElement.getAttribute('data-theme') === 'light' || document.body.classList.contains('theme-light')) ? 'light' : 'dark';
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  applyTheme(newTheme);
  showToast(`Switched to ${newTheme === 'light' ? 'Light Mode' : 'Dark Mode'}.`, 'info');
}

// ------------------------------------------------------------
//  INITIALIZATION & VIEW ROUTING
// ------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initApp();
  initLocalDevBar();
  registerServiceWorker();
});

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('Service Worker registration skipped:', err);
    });
  }
}

function initApp() {
  fetchHopperStock();
  const session = getSession();
  if (session && session.role === 'admin') {
    showAdminDashboard();
  } else if (session && session.role === 'refill') {
    showRefillPortal();
  } else if (session && session.role === 'user' && session.uid) {
    showUserPortal();
  } else {
    showAuthView();
  }
}

function getSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function setSession(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to persist session:', e);
  }
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

function showAuthView() {
  if (pollInterval) clearInterval(pollInterval);
  
  document.getElementById('view-auth').classList.remove('hidden');
  document.getElementById('view-admin').classList.add('hidden');
  document.getElementById('view-user').classList.add('hidden');
  document.getElementById('view-refill').classList.add('hidden');
  
  // Navbar state
  document.getElementById('nav-user-pill').style.display = 'none';
  const authBtn = document.getElementById('btn-auth-action');
  authBtn.textContent = 'Sign In';
  authBtn.className = 'btn btn-primary btn-sm';
  
  fetchHealthStatus();
  fetchHopperStock();
  populateQuickPills();
}

function showAdminDashboard() {
  if (pollInterval) clearInterval(pollInterval);
  
  document.getElementById('view-auth').classList.add('hidden');
  document.getElementById('view-admin').classList.remove('hidden');
  document.getElementById('view-user').classList.add('hidden');
  document.getElementById('view-refill').classList.add('hidden');
  
  // Navbar state
  const userPill = document.getElementById('nav-user-pill');
  userPill.style.display = 'flex';
  document.getElementById('nav-user-avatar').textContent = 'A';
  document.getElementById('nav-user-name').textContent = 'Admin';
  
  const authBtn = document.getElementById('btn-auth-action');
  authBtn.textContent = 'Sign Out';
  authBtn.className = 'btn btn-secondary btn-sm';
  
  fetchAdminDashboardData();
  pollInterval = setInterval(fetchAdminDashboardData, 6000);
}

function showUserPortal() {
  if (pollInterval) clearInterval(pollInterval);
  
  const session = getSession();
  const userName = session ? (session.name || 'Beneficiary') : 'Beneficiary';
  
  document.getElementById('view-auth').classList.add('hidden');
  document.getElementById('view-admin').classList.add('hidden');
  document.getElementById('view-user').classList.remove('hidden');
  document.getElementById('view-refill').classList.add('hidden');
  
  // Navbar state
  const userPill = document.getElementById('nav-user-pill');
  userPill.style.display = 'flex';
  document.getElementById('nav-user-avatar').textContent = userName.charAt(0).toUpperCase();
  document.getElementById('nav-user-name').textContent = userName;
  
  const authBtn = document.getElementById('btn-auth-action');
  authBtn.textContent = 'Sign Out';
  authBtn.className = 'btn btn-secondary btn-sm';
  
  loadUserProfile();
  pollInterval = setInterval(loadUserProfile, 8000);
}

function showRefillPortal() {
  if (pollInterval) clearInterval(pollInterval);
  
  const session = getSession();
  const staffName = session ? (session.name || 'Restock Staff') : 'Restock Staff';
  
  document.getElementById('view-auth').classList.add('hidden');
  document.getElementById('view-admin').classList.add('hidden');
  document.getElementById('view-user').classList.add('hidden');
  document.getElementById('view-refill').classList.remove('hidden');
  
  // Navbar state
  const userPill = document.getElementById('nav-user-pill');
  userPill.style.display = 'flex';
  document.getElementById('nav-user-avatar').textContent = 'R';
  document.getElementById('nav-user-name').textContent = staffName;
  
  const authBtn = document.getElementById('btn-auth-action');
  authBtn.textContent = 'Sign Out';
  authBtn.className = 'btn btn-secondary btn-sm';
  
  const staffTitle = document.getElementById('refill-portal-staff-title');
  if (staffTitle) staffTitle.textContent = staffName;
  
  fetchRefillStaffData();
  pollInterval = setInterval(fetchRefillStaffData, 8000);
}

function handleAuthAction() {
  const session = getSession();
  if (session) {
    signOut();
  } else {
    showAuthView();
  }
}

function signOut() {
  clearSession();
  showToast('You have signed out successfully.', 'info');
  showAuthView();
}

function refreshCurrentView() {
  const session = getSession();
  fetchHopperStock();
  if (session && session.role === 'admin') {
    fetchAdminDashboardData();
    showToast('Admin data synchronized.', 'info');
  } else if (session && session.role === 'refill') {
    fetchRefillStaffData();
    showToast('Restock portal refreshed.', 'info');
  } else if (session && session.role === 'user') {
    loadUserProfile();
    showToast('Beneficiary quota refreshed.', 'info');
  } else {
    fetchHealthStatus();
    showToast('Connection status checked.', 'info');
  }
}

// ------------------------------------------------------------
//  AUTHENTICATION TAB SWITCHING & LOGIN
// ------------------------------------------------------------

function switchAuthTab(tab) {
  const adminBtn = document.getElementById('tab-btn-admin');
  const userBtn = document.getElementById('tab-btn-user');
  const refillBtn = document.getElementById('tab-btn-refill');
  
  const adminForm = document.getElementById('admin-login-form');
  const userForm = document.getElementById('user-login-form');
  const refillForm = document.getElementById('refill-login-form');

  adminBtn.classList.remove('active');
  userBtn.classList.remove('active');
  refillBtn.classList.remove('active');
  adminForm.classList.add('hidden');
  userForm.classList.add('hidden');
  refillForm.classList.add('hidden');

  if (tab === 'admin') {
    adminBtn.classList.add('active');
    adminForm.classList.remove('hidden');
  } else if (tab === 'refill') {
    refillBtn.classList.add('active');
    refillForm.classList.remove('hidden');
  } else {
    userBtn.classList.add('active');
    userForm.classList.remove('hidden');
  }
}

async function populateQuickPills() {
  const container = document.getElementById('quick-pills-container');
  if (!container) return;
  try {
    const users = await fetch('/api/users', { cache: 'no-store' }).then(r => r.json());
    if (users && users.length > 0) {
      container.innerHTML = users.slice(0, 6).map(u => `
        <button type="button" class="quick-pill" onclick="quickFillUid('${escapeHtml(u.rfid_uid)}')">
          <span>${escapeHtml(u.name)}</span>
          <code>${escapeHtml(u.rfid_uid)}</code>
        </button>
      `).join('');
    }
  } catch (e) {
    console.warn('Could not auto-fetch quick pills:', e);
  }
}

function quickFillUid(uid) {
  const input = document.getElementById('beneficiary-uid');
  input.value = uid;
  input.focus();
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const idInput = document.getElementById('admin-id').value.trim();
  const passInput = document.getElementById('admin-password').value.trim();
  const btn = document.getElementById('btn-admin-submit');

  btn.disabled = true;
  btn.innerHTML = 'Signing In...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin', id: idInput, password: passInput })
    });

    const data = await res.json();
    if (data.success) {
      setSession({ role: 'admin', name: data.name || 'Administrator' });
      showToast(data.message || 'Welcome, Administrator.', 'success');
      showAdminDashboard();
    } else {
      showToast(data.message || 'Invalid Admin ID or Password.', 'error');
    }
  } catch (err) {
    showToast('Network error contacting cloud server.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `Sign In as Administrator <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
  }
}

async function handleRefillLogin(e) {
  e.preventDefault();
  const idInput = document.getElementById('refill-id').value.trim();
  const passInput = document.getElementById('refill-password').value.trim();
  const btn = document.getElementById('btn-refill-submit');

  btn.disabled = true;
  btn.innerHTML = 'Signing In...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'refill', id: idInput, password: passInput })
    });

    const data = await res.json();
    if (data.success) {
      setSession({ role: 'refill', name: data.name || 'Restock Staff' });
      showToast(data.message || 'Signed in to Restock Portal.', 'success');
      showRefillPortal();
    } else {
      showToast(data.message || 'Invalid Restock Staff ID or Password.', 'error');
    }
  } catch (err) {
    showToast('Network error contacting server.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `Sign In as Restock Staff <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
  }
}

async function handleUserLogin(e) {
  e.preventDefault();
  const uidInput = document.getElementById('beneficiary-uid').value.trim().toUpperCase();
  const btn = document.getElementById('btn-user-submit');

  if (!uidInput) {
    showToast('Please enter your RFID Card UID.', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = 'Verifying Card...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', uid: uidInput })
    });

    const data = await res.json();
    if (data.success && data.user) {
      setSession({
        role: 'user',
        uid: data.user.rfid_uid,
        name: data.user.name
      });
      showToast(`Welcome back, ${data.user.name}!`, 'success');
      showUserPortal();
      renderUserProfile(data.user);
      if (data.user.cycle_data) {
        updateCycleTracker(data.user.cycle_data, data.user.remaining);
      }
    } else {
      showToast(data.message || 'Card UID not registered in system.', 'error');
    }
  } catch (err) {
    showToast('Network error contacting cloud server.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `Access My Account & Quota <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
  }
}

async function fetchHealthStatus() {
  try {
    const res = await fetch('/api/health').then(r => r.json());
    updateCloudStatusPill(res.database && res.database.connected);
  } catch (err) {
    updateCloudStatusPill(false);
  }
}

function updateCloudStatusPill(isOnline) {
  const pill = document.getElementById('cloud-status-text');
  const dot = document.querySelector('#cloud-status-pill .status-indicator-dot');
  if (isOnline) {
    pill.textContent = 'MongoDB Atlas Live';
    dot.className = 'status-indicator-dot online';
  } else {
    pill.textContent = 'Resilient Cache Mode';
    dot.className = 'status-indicator-dot';
  }
}

// ------------------------------------------------------------
//  MACHINE HOPPER INVENTORY & LIVE STATUS
// ------------------------------------------------------------

async function fetchHopperStock() {
  try {
    const res = await fetch('/api/hopper', { cache: 'no-store' }).then(r => r.json());
    if (res.success) {
      cachedHopper = res;
      renderHopperStock(res);
    }
  } catch (e) {
    console.warn('Could not load hopper stock:', e);
  }
}

function renderHopperStock(hopper) {
  const stock = hopper.current_stock !== undefined ? hopper.current_stock : 50;
  const cap = hopper.capacity || 60;
  const isLow = stock <= 10;
  const isEmpty = stock <= 0;

  // Nav pill
  const navText = document.getElementById('nav-hopper-text');
  const navDot = document.getElementById('nav-hopper-dot');
  if (navText && navDot) {
    navText.textContent = `Hopper: ${stock} Pads`;
    if (isEmpty) {
      navDot.className = 'status-indicator-dot';
      navDot.style.background = '#ef4444';
    } else if (isLow) {
      navDot.className = 'status-indicator-dot';
      navDot.style.background = '#f59e0b';
    } else {
      navDot.className = 'status-indicator-dot online';
      navDot.style.background = '#10b981';
    }
  }

  // Admin metric card
  const adminHopperCount = document.getElementById('stat-hopper-count');
  const adminHopperBadge = document.getElementById('stat-hopper-badge');
  if (adminHopperCount) adminHopperCount.textContent = stock;
  if (adminHopperBadge) {
    adminHopperBadge.textContent = `${stock} / ${cap} Pads`;
  }

  // Beneficiary machine strip
  const userHopperLabel = document.getElementById('user-hopper-label');
  const userHopperSub = document.getElementById('user-hopper-sub');
  const userHopperBadge = document.getElementById('user-hopper-stock-badge');
  const userHopperDot = document.getElementById('user-hopper-dot');

  if (userHopperLabel) {
    if (isEmpty) {
      userHopperLabel.textContent = `MMMUT Center #01: 🔴 Hopper Empty — Refill Pending`;
      if (userHopperSub) userHopperSub.textContent = 'Machine is currently being restocked by attendant.';
      if (userHopperBadge) {
        userHopperBadge.textContent = 'Empty';
        userHopperBadge.className = 'badge badge-err';
      }
      if (userHopperDot) userHopperDot.style.background = '#ef4444';
    } else if (isLow) {
      userHopperLabel.textContent = `MMMUT Center #01: 🟠 Low Stock (${stock} Pads Remaining)`;
      if (userHopperSub) userHopperSub.textContent = 'Machine has limited pads. Restock requested.';
      if (userHopperBadge) {
        userHopperBadge.textContent = `${stock} / ${cap} Low`;
        userHopperBadge.className = 'badge badge-warn';
      }
      if (userHopperDot) userHopperDot.style.background = '#f59e0b';
    } else {
      userHopperLabel.textContent = `MMMUT Center #01: 🟢 ${stock} Pads in Stock — Dispenser Ready`;
      if (userHopperSub) userHopperSub.textContent = 'Machine online • Ready to dispense on RFID tap';
      if (userHopperBadge) {
        userHopperBadge.textContent = `${stock} / ${cap} Ready`;
        userHopperBadge.className = 'badge badge-emerald';
      }
      if (userHopperDot) userHopperDot.style.background = '#10b981';
    }
  }

  // Refill Portal banner
  const refillStockTitle = document.getElementById('refill-stock-title');
  const refillStockBadge = document.getElementById('refill-stock-badge');
  if (refillStockTitle) refillStockTitle.textContent = `Hopper: ${stock} / ${cap} Pads Remaining`;
  if (refillStockBadge) {
    if (isEmpty) {
      refillStockBadge.textContent = 'Refill Urgent';
      refillStockBadge.className = 'badge badge-err';
    } else if (isLow) {
      refillStockBadge.textContent = 'Stock Low';
      refillStockBadge.className = 'badge badge-warn';
    } else {
      refillStockBadge.textContent = 'Stock OK';
      refillStockBadge.className = 'badge badge-emerald';
    }
  }
}

// ------------------------------------------------------------
//  ADMIN MANAGEMENT DASHBOARD & QUEUES
// ------------------------------------------------------------

async function fetchAdminDashboardData() {
  try {
    const [statsRes, usersRes, txRes] = await Promise.all([
      fetch('/api/dashboard/stats').then(r => r.json()),
      fetch('/api/users').then(r => r.json()),
      fetch('/api/transactions?limit=30').then(r => r.json())
    ]);

    cachedUsers = usersRes || [];
    cachedTransactions = txRes || [];

    renderAdminStats(statsRes);
    renderAdminUsers(cachedUsers, statsRes.monthly_limit);
    renderAdminTransactions(cachedTransactions);

    // Fetch new feature queues
    fetchAdminRefillRequests();
    fetchAdminRegistrationRequests();
    fetchAdminEmergencyRequests();
    fetchMonthlySummary();
    fetchHopperStock();
  } catch (err) {
    console.error('Error fetching admin telemetry:', err);
  }
}

function renderAdminStats(stats) {
  if (!stats) return;

  document.getElementById('stat-total-dispensed').textContent = stats.total_dispensed || 0;
  document.getElementById('stat-today-tx').textContent = stats.today_transactions || 0;
  document.getElementById('stat-active-users').textContent = stats.registered_users || 0;
  document.getElementById('stat-monthly-limit').textContent = stats.monthly_limit || 5;

  const conn = stats.connection || {};
  const dbBadge = document.getElementById('db-badge');
  const dbTitle = document.getElementById('db-title');
  const dbDesc = document.getElementById('db-desc');

  if (conn.connected) {
    dbBadge.textContent = 'MongoDB Atlas Live';
    dbBadge.className = 'banner-badge';
    dbTitle.textContent = 'MongoDB Atlas Cluster Synchronized';
    dbDesc.textContent = 'All transactions, beneficiary quotas, and machine heartbeats are persistently saved in your cloud cluster.';
    updateCloudStatusPill(true);
  } else {
    dbBadge.textContent = 'Local Cache Active';
    dbBadge.className = 'banner-badge badge-warn';
    dbTitle.textContent = 'Resilient Fallback Operating';
    dbDesc.textContent = conn.error ? `Atlas: ${conn.error}` : 'Connected to local high-speed cache.';
    updateCloudStatusPill(false);
  }

  // Device status
  const devText = document.getElementById('admin-device-text');
  const devices = stats.devices || [];
  const activeDevice = devices.find(d => d.is_active);
  if (activeDevice) {
    devText.textContent = `${activeDevice.device_id}: Online`;
  } else {
    devText.textContent = 'UNO R4 WiFi: Ready';
  }
}

function handleUserSearch(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    renderAdminUsers(cachedUsers);
    return;
  }
  const filtered = cachedUsers.filter(u => 
    (u.name && u.name.toLowerCase().includes(q)) || 
    (u.rfid_uid && u.rfid_uid.toLowerCase().includes(q)) ||
    (u.aadhaar_no && u.aadhaar_no.toLowerCase().includes(q))
  );
  renderAdminUsers(filtered);
}

function renderAdminUsers(users, defaultLimit = 5) {
  const tbody = document.getElementById('users-tbody');
  if (!users || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No beneficiaries match. Click "Add Beneficiary" to register a card.</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => {
    const limit = u.monthly_limit || defaultLimit;
    const used = u.used_pads || 0;
    const remaining = Math.max(0, limit - used);
    const pct = Math.min(Math.round((used / limit) * 100), 100);
    const isExhausted = remaining === 0;

    const statusBadge = isExhausted
      ? '<span class="badge badge-warn">Limit Reached</span>'
      : '<span class="badge badge-emerald">Active</span>';

    // Masked Aadhaar display
    let aadhaarDisplay = '<span class="text-muted">—</span>';
    if (u.aadhaar_no) {
      const clean = u.aadhaar_no.replace(/\D/g, '');
      if (clean.length >= 4) {
        aadhaarDisplay = `<code class="font-mono" style="font-size:11px;">XXXX XXXX ${clean.slice(-4)}</code>`;
      } else {
        aadhaarDisplay = `<code class="font-mono">${escapeHtml(u.aadhaar_no)}</code>`;
      }
    }

    return `
      <tr>
        <td><strong>${escapeHtml(u.name)}</strong></td>
        <td>${aadhaarDisplay}</td>
        <td><code class="font-mono">${escapeHtml(u.rfid_uid)}</code></td>
        <td>
          <div style="font-size:12px; font-weight:600">${used} / ${limit} pads</div>
          <div class="progress-wrap">
            <div class="progress-bar ${isExhausted ? 'limit-reached' : ''}" style="width: ${pct}%"></div>
          </div>
        </td>
        <td><strong style="color:${isExhausted ? '#fbbf24' : '#34d399'}">${remaining}</strong> pads</td>
        <td>${statusBadge}</td>
        <td class="text-right">
          <div class="action-btn-group">
            <button class="btn-table-action" onclick="openEditUserModal('${escapeHtml(u.rfid_uid)}', '${escapeHtml(u.name)}', ${limit}, '${escapeHtml(u.aadhaar_no || '')}')" title="Edit Name or Monthly Quota">Edit</button>
            <button class="btn-table-action" onclick="resetSingleUser('${escapeHtml(u.rfid_uid)}')" title="Reset used pads to 0">Reset</button>
            <button class="btn-table-action btn-del" onclick="deleteUser('${escapeHtml(u.rfid_uid)}', '${escapeHtml(u.name)}')" title="Delete Card">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderAdminTransactions(txs) {
  const tbody = document.getElementById('tx-tbody');
  if (!txs || txs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No dispense activity logged yet.</td></tr>';
    return;
  }

  tbody.innerHTML = txs.map(t => {
    let badgeClass = 'badge-emerald';
    let statusLabel = 'Dispensed';

    if (t.status === 'DENIED_LIMIT_REACHED') {
      badgeClass = 'badge-warn';
      statusLabel = 'Quota Exceeded';
    } else if (t.status === 'INVALID_CARD') {
      badgeClass = 'badge-err';
      statusLabel = 'Invalid Card';
    }

    return `
      <tr>
        <td>${escapeHtml(t.user_name || 'Unknown')}</td>
        <td><code class="font-mono">${escapeHtml(t.rfid_uid)}</code></td>
        <td><strong>${t.quantity > 0 ? t.quantity : '—'}</strong></td>
        <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
        <td style="color:var(--text-dim); font-size:12px;">${escapeHtml(t.timestamp || '')}</td>
      </tr>
    `;
  }).join('');
}

function exportTransactionsCSV() {
  if (!cachedTransactions || cachedTransactions.length === 0) {
    showToast('No transactions available to export.', 'info');
    return;
  }

  const headers = ['Beneficiary Name', 'RFID UID', 'Quantity Dispensed', 'Status', 'Timestamp'];
  const rows = cachedTransactions.map(t => [
    `"${(t.user_name || 'Unknown').replace(/"/g, '""')}"`,
    `"${(t.rfid_uid || '').replace(/"/g, '""')}"`,
    t.quantity || 0,
    `"${(t.status || '').replace(/"/g, '""')}"`,
    `"${(t.timestamp || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `HygieNet_Dispense_Ledger_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Transactions exported as CSV.', 'success');
}

// ------------------------------------------------------------
//  ADMIN QUEUES: REFILL PROOFS, ALLOTMENTS & EMERGENCY REQUESTS
// ------------------------------------------------------------

async function fetchAdminRefillRequests() {
  try {
    const listEl = document.getElementById('admin-refill-requests-list');
    const badgeEl = document.getElementById('badge-pending-refills-count');
    if (!listEl) return;

    const res = await fetch('/api/admin/refills', { cache: 'no-store' }).then(r => r.json());
    const refills = res.refills || [];
    const pending = refills.filter(r => r.status === 'PENDING_VERIFICATION');

    if (badgeEl) badgeEl.textContent = pending.length;

    if (pending.length === 0) {
      listEl.innerHTML = '<div class="text-center text-muted py-3">No pending refill logs to verify</div>';
      return;
    }

    listEl.innerHTML = pending.map(r => {
      const photos = [];
      if (r.photo_hopper_base64) photos.push({ src: r.photo_hopper_base64, label: 'Hopper Proof' });
      if (r.photo_tray_base64) photos.push({ src: r.photo_tray_base64, label: 'Tray Proof' });

      const thumbsHtml = photos.map(p => `
        <img src="${p.src}" class="proof-thumb" alt="${p.label}" title="Click to view full image" onclick="openImageLightbox('${p.src}', '${escapeHtml(r.staff_name)} - ${p.label}')">
      `).join('');

      return `
        <div class="queue-item">
          <div class="queue-item-header">
            <strong>${escapeHtml(r.staff_name)}</strong>
            <span class="badge badge-warn">+${r.quantity_added} Pads</span>
          </div>
          <div class="queue-item-meta">
            <span>Remarks: "${escapeHtml(r.remarks || 'Hopper replenishment')}"</span>
            <span>Submitted: ${escapeHtml(r.timestamp || '')}</span>
          </div>
          ${thumbsHtml ? `<div class="queue-thumbs-row">${thumbsHtml}</div>` : ''}
          <div class="queue-actions-row">
            <button class="btn btn-primary btn-sm" onclick="handleVerifyRefill('${r.id}', 'approve')">
              ✓ Verify & Update Stock
            </button>
            <button class="btn btn-danger-subtle btn-sm" onclick="handleVerifyRefill('${r.id}', 'reject')">
              ✕ Reject
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.warn('Could not load refill queue:', err);
  }
}

async function handleVerifyRefill(refillId, action) {
  try {
    const res = await fetch(`/api/admin/refills/${encodeURIComponent(refillId)}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      fetchAdminRefillRequests();
      fetchHopperStock();
      fetchAdminDashboardData();
    } else {
      showToast(data.message || 'Failed to update refill log', 'error');
    }
  } catch (e) {
    showToast('Network error updating refill log', 'error');
  }
}

async function fetchAdminRegistrationRequests() {
  try {
    const listEl = document.getElementById('admin-allotments-requests-list');
    const badgeEl = document.getElementById('badge-pending-allotments-count');
    if (!listEl) return;

    const res = await fetch('/api/admin/registration-requests', { cache: 'no-store' }).then(r => r.json());
    const requests = res.requests || [];
    // Show any request that is pending allotment / verified / not yet allotted
    const pending = requests.filter(r => r.status !== 'ALLOTTED' && r.status !== 'REJECTED');

    if (badgeEl) badgeEl.textContent = pending.length;

    if (pending.length === 0) {
      listEl.innerHTML = '<div class="text-center text-muted py-3">No students awaiting card allotment</div>';
      return;
    }

    listEl.innerHTML = pending.map(req => {
      const id = req.id || req._id || '';
      const maskedAadhaar = req.aadhaar_no ? `XXXX XXXX ${req.aadhaar_no.replace(/\D/g, '').slice(-4)}` : 'Verified';
      const isOtpDone = req.status === 'PENDING_ALLOTMENT' || req.status === 'OTP_VERIFIED';
      const badgeHtml = isOtpDone
        ? '<span class="badge badge-emerald">Aadhaar Verified</span>'
        : '<span class="badge badge-warn">Pending OTP</span>';

      return `
        <div class="queue-item">
          <div class="queue-item-header">
            <strong>${escapeHtml(req.name)}</strong>
            ${badgeHtml}
          </div>
          <div class="queue-item-meta">
            <span>Aadhaar: <code class="font-mono">${maskedAadhaar}</code></span>
            <span>Email: ${escapeHtml(req.email || '')}</span>
            <span>Created: ${escapeHtml(req.created_at || 'Recently')}</span>
          </div>
          <div class="queue-actions-row">
            <button class="btn btn-primary btn-sm" onclick="openAllotModal('${escapeHtml(id)}', '${escapeHtml(req.name)}', '${maskedAadhaar}', '${escapeHtml(req.email || '')}', '${escapeHtml(req.department || '')}')">
              💳 Allot RFID Card
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.warn('Could not load allotments queue:', err);
  }
}

function openAllotModal(reqId, name, aadhaar, email, dept) {
  document.getElementById('allot-req-id').value = reqId;
  const summary = document.getElementById('allot-summary-box');
  summary.innerHTML = `
    <strong>Student: ${escapeHtml(name)}</strong>
    <span>Aadhaar: <code class="font-mono">${escapeHtml(aadhaar)}</code></span>
    <span>Email: ${escapeHtml(email)} ${dept ? `• ${escapeHtml(dept)}` : ''}</span>
  `;
  document.getElementById('allot-uid').value = '';
  document.getElementById('allot-limit').value = 5;
  document.getElementById('allot-modal').classList.remove('hidden');
}

function closeAllotModal() {
  document.getElementById('allot-modal').classList.add('hidden');
}

async function handleAllotSubmit(e) {
  e.preventDefault();
  const reqId = document.getElementById('allot-req-id').value;
  const uid = document.getElementById('allot-uid').value.trim().toUpperCase();
  const limit = parseInt(document.getElementById('allot-limit').value, 10) || 5;

  if (!uid) {
    showToast('Please enter or scan an RFID UID.', 'error');
    return;
  }

  const saveBtn = document.getElementById('btn-allot-save');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Allotting...';
  }

  try {
    const res = await fetch(`/api/admin/registration-requests/${encodeURIComponent(reqId)}/allot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rfid_uid: uid, monthly_limit: limit })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      closeAllotModal();
      await fetchAdminDashboardData();
    } else {
      showToast(data.message || 'Failed to allot card', 'error');
    }
  } catch (err) {
    console.error('Allotment error:', err);
    showToast('Network error allotting card', 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Confirm & Allot Card';
    }
  }
}

async function fetchAdminEmergencyRequests() {
  try {
    const listEl = document.getElementById('admin-emergency-requests-list');
    const badgeEl = document.getElementById('badge-emergency-requests-count');
    if (!listEl) return;

    const res = await fetch('/api/admin/emergency-requests', { cache: 'no-store' }).then(r => r.json());
    const requests = res.requests || [];
    const pending = requests.filter(r => r.status === 'PENDING');

    if (badgeEl) badgeEl.textContent = pending.length;

    if (pending.length === 0) {
      listEl.innerHTML = '<div class="text-center text-muted py-3">No emergency requests active</div>';
      return;
    }

    listEl.innerHTML = pending.map(req => {
      return `
        <div class="queue-item">
          <div class="queue-item-header">
            <strong>${escapeHtml(req.user_name || 'Beneficiary')}</strong>
            <span class="badge badge-warn">🚨 Emergency</span>
          </div>
          <div class="queue-item-meta">
            <span>Card UID: <code class="font-mono">${escapeHtml(req.rfid_uid)}</code></span>
            <span>Reason: "${escapeHtml(req.reason || 'Unexpected emergency flow')}"</span>
            <span>Requested: ${escapeHtml(req.timestamp || '')}</span>
          </div>
          <div class="queue-actions-row">
            <button class="btn btn-primary btn-sm" onclick="handleEmergencyAction('${req.id}', 'grant', 1)">
              Grant +1 Pad
            </button>
            <button class="btn btn-primary btn-sm" onclick="handleEmergencyAction('${req.id}', 'grant', 2)">
              Grant +2 Pads
            </button>
            <button class="btn btn-danger-subtle btn-sm" onclick="handleEmergencyAction('${req.id}', 'reject', 0)">
              Dismiss
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.warn('Could not load emergency queue:', err);
  }
}

async function handleEmergencyAction(reqId, action, extraPads) {
  try {
    const res = await fetch(`/api/admin/emergency-requests/${encodeURIComponent(reqId)}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, extra_pads: extraPads })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      fetchAdminEmergencyRequests();
      fetchAdminDashboardData();
    } else {
      showToast(data.message || 'Operation failed', 'error');
    }
  } catch (e) {
    showToast('Network error handling emergency request', 'error');
  }
}

// ------------------------------------------------------------
//  MONTHLY SUMMARY & SIMULATED ROLLOVER
// ------------------------------------------------------------

async function fetchMonthlySummary() {
  try {
    const res = await fetch('/api/dashboard/monthly-summary', { cache: 'no-store' }).then(r => r.json());
    if (!res.success) return;

    const badge = document.getElementById('current-month-badge');
    if (badge) {
      badge.textContent = `Month ${res.current_month} — ${res.current_month_name} ${res.current_year}`;
    }

    const summaries = res.monthly_summary || [];
    const current = summaries.find(s => s.month_no === res.current_month) || summaries[0] || {};

    const curDisp = document.getElementById('month-stat-current-dispensed');
    const curUsers = document.getElementById('month-stat-unique-users');
    const avgQty = document.getElementById('month-stat-avg-qty');

    if (curDisp) curDisp.textContent = `${current.total_dispensed || 0} pads`;
    if (curUsers) curUsers.textContent = current.unique_beneficiaries || 0;
    if (avgQty) {
      const avg = current.total_transactions > 0 ? (current.total_dispensed / current.total_transactions).toFixed(1) : '1.0';
      avgQty.textContent = avg;
    }

    const tbody = document.getElementById('monthly-summary-tbody');
    if (tbody) {
      if (summaries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No monthly records accumulated yet</td></tr>';
      } else {
        tbody.innerHTML = summaries.map(s => `
          <tr>
            <td><strong>Month ${s.month_no}</strong></td>
            <td>${escapeHtml(s.month_name)} ${s.year}</td>
            <td><strong class="text-emerald">${s.total_dispensed}</strong> pads</td>
            <td>${s.total_transactions} txns</td>
            <td>${s.unique_beneficiaries} beneficiaries</td>
          </tr>
        `).join('');
      }
    }
  } catch (e) {
    console.warn('Could not load monthly summary:', e);
  }
}

async function confirmSimulateMonthRollover() {
  if (!confirm('Simulate New Month Rollover (For Testing)?\n\nThis will:\n1. Archive the current month dispense statistics\n2. Increment the month number\n3. Reset all beneficiaries used pads to 0\n\nAre you sure you want to proceed?')) {
    return;
  }

  try {
    const res = await fetch('/api/admin/simulate-month-rollover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      fetchMonthlySummary();
      fetchAdminDashboardData();
    } else {
      showToast(data.message || 'Rollover simulation failed', 'error');
    }
  } catch (e) {
    showToast('Network error during rollover simulation', 'error');
  }
}

// ------------------------------------------------------------
//  STUDENT REGISTRATION WITH AADHAAR & OTP
// ------------------------------------------------------------

function openRegisterModal() {
  document.getElementById('reg-step1-form').reset();
  document.getElementById('reg-step2-form').reset();
  document.getElementById('reg-step1-form').classList.remove('hidden');
  document.getElementById('reg-step2-form').classList.add('hidden');
  const feedback = document.getElementById('aadhaar-feedback');
  if (feedback) {
    feedback.className = 'aadhaar-feedback';
    feedback.innerHTML = '<span class="indicator-icon">ℹ️</span><span class="indicator-text">Enter 12 digits to verify checksum</span>';
  }
  document.getElementById('register-modal').classList.remove('hidden');
}

function closeRegisterModal() {
  document.getElementById('register-modal').classList.add('hidden');
}

function backToRegStep1() {
  document.getElementById('reg-step2-form').classList.add('hidden');
  document.getElementById('reg-step1-form').classList.remove('hidden');
}

async function handleSendRegistrationOTP(e) {
  e.preventDefault();
  const name = document.getElementById('reg-name').value.trim();
  const aadhaarRaw = document.getElementById('reg-aadhaar').value.replace(/\D/g, '');
  const email = document.getElementById('reg-email').value.trim();
  const dept = document.getElementById('reg-dept').value.trim();
  const btn = document.getElementById('btn-reg-step1');

  if (!validateVerhoeff(aadhaarRaw)) {
    showToast('Invalid 12-digit Aadhaar number checksum. Please verify digits.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Generating OTP...';

  try {
    const res = await fetch('/api/auth/register-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        aadhaar_no: aadhaarRaw,
        email: email,
        department: dept
      })
    });
    const data = await res.json();
    if (data.success) {
      tempRegistrationId = data.request_id;
      showToast(data.message, 'success');
      
      // If dev OTP provided in response, show immediate dev helper
      if (data.dev_otp) {
        showToast(`[DEV MODE] Verification OTP: ${data.dev_otp}`, 'info');
        const otpInput = document.getElementById('reg-otp-input');
        if (otpInput) otpInput.value = data.dev_otp;
      }

      document.getElementById('otp-destination-text').textContent = `Verification code sent to ${email}`;
      document.getElementById('reg-step1-form').classList.add('hidden');
      document.getElementById('reg-step2-form').classList.remove('hidden');
    } else {
      showToast(data.message || 'Could not generate OTP', 'error');
    }
  } catch (err) {
    showToast('Network error generating registration OTP', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate Verification OTP →';
  }
}

async function handleVerifyRegistrationOTP(e) {
  e.preventDefault();
  const otp = document.getElementById('reg-otp-input').value.trim();
  const btn = document.getElementById('btn-reg-verify');

  if (!tempRegistrationId) {
    showToast('Registration session expired. Please retry.', 'error');
    backToRegStep1();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verifying...';

  try {
    const res = await fetch('/api/auth/verify-registration-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: tempRegistrationId,
        otp: otp
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Registration Verified! An administrator will allot your card shortly.', 'success');
      closeRegisterModal();
    } else {
      showToast(data.message || 'Invalid or expired OTP', 'error');
    }
  } catch (err) {
    showToast('Network error verifying registration OTP', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verify & Queue for Card Allotment';
  }
}

// ------------------------------------------------------------
//  RESTOCK / REFILL STAFF PORTAL
// ------------------------------------------------------------

function handlePhotoSelect(event, photoIndex) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const base64Data = e.target.result;
    if (photoIndex === 1) {
      refillPhoto1Base64 = base64Data;
      document.getElementById('photo1-empty').classList.add('hidden');
      document.getElementById('photo1-preview-wrap').classList.remove('hidden');
      document.getElementById('photo1-preview-img').src = base64Data;
    } else {
      refillPhoto2Base64 = base64Data;
      document.getElementById('photo2-empty').classList.add('hidden');
      document.getElementById('photo2-preview-wrap').classList.remove('hidden');
      document.getElementById('photo2-preview-img').src = base64Data;
    }
  };
  reader.readAsDataURL(file);
}

function removePhoto(photoIndex) {
  if (photoIndex === 1) {
    refillPhoto1Base64 = '';
    document.getElementById('refill-photo1-file').value = '';
    document.getElementById('photo1-empty').classList.remove('hidden');
    document.getElementById('photo1-preview-wrap').classList.add('hidden');
  } else {
    refillPhoto2Base64 = '';
    document.getElementById('refill-photo2-file').value = '';
    document.getElementById('photo2-empty').classList.remove('hidden');
    document.getElementById('photo2-preview-wrap').classList.add('hidden');
  }
}

async function handleRefillSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('refill-staff-name').value.trim();
  const qty = parseInt(document.getElementById('refill-quantity-added').value, 10) || 50;
  const remarks = document.getElementById('refill-remarks').value.trim();
  const btn = document.getElementById('btn-submit-refill');

  if (!refillPhoto1Base64) {
    showToast('Please upload Proof Photo 1 (Hopper interior with pads).', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = 'Uploading Proof...';

  try {
    const res = await fetch('/api/refill/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        staff_name: name,
        quantity_added: qty,
        remarks: remarks,
        photo_hopper_base64: refillPhoto1Base64,
        photo_tray_base64: refillPhoto2Base64
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      document.getElementById('refill-submit-form').reset();
      removePhoto(1);
      removePhoto(2);
      fetchRefillStaffData();
    } else {
      showToast(data.message || 'Failed to submit restock report', 'error');
    }
  } catch (err) {
    showToast('Network error submitting restock report', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `Submit Restock for Admin Approval <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
  }
}

async function fetchRefillStaffData() {
  fetchHopperStock();
  const listEl = document.getElementById('refill-staff-logs-list');
  if (!listEl) return;

  try {
    const res = await fetch('/api/admin/refills', { cache: 'no-store' }).then(r => r.json());
    const logs = res.refills || [];
    if (logs.length === 0) {
      listEl.innerHTML = '<div class="text-center text-muted py-4">No replenishment reports submitted yet.</div>';
      return;
    }

    listEl.innerHTML = logs.slice(0, 10).map(l => {
      let badgeClass = 'badge-warn';
      let statusText = 'Pending Verification';
      if (l.status === 'APPROVED') {
        badgeClass = 'badge-emerald';
        statusText = 'Verified & Credited';
      } else if (l.status === 'REJECTED') {
        badgeClass = 'badge-err';
        statusText = 'Rejected';
      }

      const thumbs = [];
      if (l.photo_hopper_base64) thumbs.push({ src: l.photo_hopper_base64, label: 'Hopper Proof' });
      if (l.photo_tray_base64) thumbs.push({ src: l.photo_tray_base64, label: 'Tray Proof' });

      const thumbsHtml = thumbs.map(t => `
        <img src="${t.src}" class="proof-thumb" alt="${t.label}" onclick="openImageLightbox('${t.src}', '${escapeHtml(l.staff_name)} - ${t.label}')">
      `).join('');

      return `
        <div class="refill-log-item">
          <div class="refill-log-top">
            <strong>+${l.quantity_added} Pads (${escapeHtml(l.staff_name)})</strong>
            <span class="badge ${badgeClass}">${statusText}</span>
          </div>
          <div style="font-size: 11px; color: var(--text-dim);">
            <span>Remarks: "${escapeHtml(l.remarks || 'Restocked')}"</span> • <span>${escapeHtml(l.timestamp || '')}</span>
          </div>
          ${thumbsHtml ? `<div class="queue-thumbs-row">${thumbsHtml}</div>` : ''}
        </div>
      `;
    }).join('');
  } catch (e) {
    console.warn('Could not load refill staff logs:', e);
  }
}

// ------------------------------------------------------------
//  BENEFICIARY EMERGENCY PAD REQUESTS
// ------------------------------------------------------------

function openEmergencyModal() {
  document.getElementById('emergency-form').reset();
  document.getElementById('emergency-modal').classList.remove('hidden');
}

function closeEmergencyModal() {
  document.getElementById('emergency-modal').classList.add('hidden');
}

async function handleEmergencySubmit(e) {
  e.preventDefault();
  const session = getSession();
  if (!session || !session.uid) {
    showToast('Please log in with your beneficiary card first.', 'error');
    return;
  }

  const reason = document.getElementById('emergency-reason').value.trim();
  const btn = document.getElementById('btn-emergency-submit');

  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    const res = await fetch('/api/user/emergency-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rfid_uid: session.uid,
        user_name: session.name,
        reason: reason
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      closeEmergencyModal();
    } else {
      showToast(data.message || 'Failed to submit emergency request', 'error');
    }
  } catch (err) {
    showToast('Network error submitting emergency request', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Emergency Request';
  }
}

// ------------------------------------------------------------
//  LIGHTBOX IMAGE PREVIEW
// ------------------------------------------------------------

function openImageLightbox(src, caption) {
  const modal = document.getElementById('image-lightbox-modal');
  const img = document.getElementById('lightbox-img');
  const cap = document.getElementById('lightbox-caption');
  if (!modal || !img) return;

  img.src = src;
  if (cap) cap.textContent = caption || 'Restock Proof Photo';
  modal.classList.remove('hidden');
}

function closeImageLightbox(event) {
  const modal = document.getElementById('image-lightbox-modal');
  if (modal) modal.classList.add('hidden');
}

// ------------------------------------------------------------
//  BENEFICIARY MANAGEMENT (ADD, EDIT, DELETE, RESET)
// ------------------------------------------------------------

function openAddUserModal() {
  document.getElementById('user-form').reset();
  document.getElementById('form-is-edit').value = '0';
  document.getElementById('modal-title').textContent = 'Register Beneficiary Card';
  document.getElementById('btn-modal-save').textContent = 'Register Card';
  
  const uidInput = document.getElementById('form-uid');
  uidInput.readOnly = false;
  uidInput.classList.remove('readonly-input');
  document.getElementById('form-uid-hint').textContent = 'Format: 8-10 hex characters (colons optional)';
  
  const feedback = document.getElementById('form-aadhaar-feedback');
  if (feedback) {
    feedback.className = 'aadhaar-feedback';
    feedback.innerHTML = '<span class="indicator-icon">ℹ️</span><span class="indicator-text">Verhoeff checksum checked on entry</span>';
  }

  document.getElementById('user-modal').classList.remove('hidden');
}

function openEditUserModal(uid, name, limit, aadhaar) {
  document.getElementById('form-is-edit').value = '1';
  document.getElementById('modal-title').textContent = `Edit Beneficiary (${uid})`;
  document.getElementById('btn-modal-save').textContent = 'Save Changes';
  
  document.getElementById('form-name').value = name;
  const uidInput = document.getElementById('form-uid');
  uidInput.value = uid;
  uidInput.readOnly = true;
  document.getElementById('form-uid-hint').textContent = 'Card UID cannot be changed while editing.';
  document.getElementById('form-limit').value = limit || 5;

  const aadhaarInput = document.getElementById('form-aadhaar');
  if (aadhaarInput) {
    aadhaarInput.value = aadhaar || '';
    formatAndValidateAadhaar(aadhaarInput, 'form-aadhaar-feedback');
  }

  document.getElementById('user-modal').classList.remove('hidden');
}

function closeUserModal() {
  document.getElementById('user-modal').classList.add('hidden');
}

async function handleUserSubmit(e) {
  e.preventDefault();
  const isEdit = document.getElementById('form-is-edit').value === '1';
  const name = document.getElementById('form-name').value.trim();
  const uid = document.getElementById('form-uid').value.trim().toUpperCase();
  const limit = parseInt(document.getElementById('form-limit').value, 10);
  const aadhaar = document.getElementById('form-aadhaar') ? document.getElementById('form-aadhaar').value.replace(/\D/g, '') : '';

  if (aadhaar && aadhaar.length === 12 && !validateVerhoeff(aadhaar)) {
    showToast('Invalid Aadhaar number (Verhoeff checksum failed)', 'error');
    return;
  }

  try {
    let res;
    if (isEdit) {
      res = await fetch(`/api/users/${encodeURIComponent(uid)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, monthly_limit: limit, aadhaar_no: aadhaar })
      });
    } else {
      res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rfid_uid: uid, name: name, monthly_limit: limit, aadhaar_no: aadhaar })
      });
    }

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      closeUserModal();
      fetchAdminDashboardData();
    } else {
      showToast(data.message || 'Operation failed', 'error');
    }
  } catch (err) {
    showToast('Network error saving beneficiary', 'error');
  }
}

async function deleteUser(uid, name) {
  if (!confirm(`Are you sure you want to delete beneficiary "${name}" (${uid})? This cannot be undone.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/users/${encodeURIComponent(uid)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      fetchAdminDashboardData();
    } else {
      showToast(data.message || 'Failed to delete user', 'error');
    }
  } catch (err) {
    showToast('Network error deleting user', 'error');
  }
}

async function resetSingleUser(uid) {
  if (!confirm(`Reset monthly pad usage to 0 for card ${uid}?`)) return;

  try {
    const res = await fetch('/api/users/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rfid_uid: uid })
    });
    const data = await res.json();
    showToast(data.message, 'success');
    fetchAdminDashboardData();
  } catch (err) {
    showToast('Failed to reset quota', 'error');
  }
}

async function confirmResetAll() {
  if (!confirm('Are you sure you want to reset the monthly pad usage to 0 for ALL registered beneficiaries?')) return;

  try {
    const res = await fetch('/api/users/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    showToast(data.message, 'success');
    fetchAdminDashboardData();
  } catch (err) {
    showToast('Failed to reset quotas', 'error');
  }
}

// ------------------------------------------------------------
//  BENEFICIARY PROFILE PORTAL
// ------------------------------------------------------------

async function loadUserProfile() {
  const session = getSession();
  if (!session || !session.uid) return;

  fetchHopperStock();

  try {
    const [profileRes, txRes] = await Promise.all([
      fetch(`/api/user/${encodeURIComponent(session.uid)}`, { cache: 'no-store' }).then(r => r.json()),
      fetch(`/api/user/${encodeURIComponent(session.uid)}/transactions?limit=20`, { cache: 'no-store' }).then(r => r.json())
    ]);

    if (profileRes.success && profileRes.user) {
      setSession({
        role: 'user',
        uid: profileRes.user.rfid_uid,
        name: profileRes.user.name
      });
      renderUserProfile(profileRes.user);
      if (profileRes.user.cycle_data) {
        updateCycleTracker(profileRes.user.cycle_data, profileRes.user.remaining);
      }
    }
    renderUserTransactions(txRes || []);
  } catch (err) {
    console.error('Error loading beneficiary telemetry:', err);
  }
}

function renderUserProfile(u) {
  const name = u.name || 'Beneficiary';
  const limit = u.monthly_limit || 5;
  const used = u.used_pads || 0;
  const remaining = Math.max(0, limit - used);
  const isExhausted = remaining === 0;

  // Banner details
  document.getElementById('user-profile-name').textContent = name;
  document.getElementById('user-profile-avatar').textContent = name.charAt(0).toUpperCase();
  document.getElementById('user-profile-uid').textContent = u.rfid_uid;

  const aadhaarWrap = document.getElementById('user-profile-aadhaar-wrap');
  const aadhaarEl = document.getElementById('user-profile-aadhaar');
  if (u.aadhaar_no && aadhaarWrap && aadhaarEl) {
    const clean = u.aadhaar_no.replace(/\D/g, '');
    aadhaarEl.textContent = `XXXX XXXX ${clean.slice(-4)}`;
    aadhaarWrap.style.display = 'inline';
  } else if (aadhaarWrap) {
    aadhaarWrap.style.display = 'none';
  }

  const statusBadge = document.getElementById('user-profile-status');
  if (isExhausted) {
    statusBadge.textContent = 'Quota Reached';
    statusBadge.className = 'badge badge-warn';
  } else {
    statusBadge.textContent = 'Active';
    statusBadge.className = 'badge badge-emerald';
  }

  // Quota circular ring calculation (r=50 -> circum = ~314.15)
  const circumference = 314.15;
  const fraction = Math.min(Math.max(remaining / limit, 0), 1);
  const offset = circumference * (1 - fraction);

  const ringFill = document.getElementById('user-ring-fill');
  ringFill.style.strokeDashoffset = offset;
  if (isExhausted) {
    ringFill.style.stroke = 'var(--amber)';
  } else {
    ringFill.style.stroke = 'var(--primary)';
  }

  // Numbers & text
  document.getElementById('user-quota-remaining').textContent = remaining;
  document.getElementById('user-quota-limit').textContent = `${limit} pads`;
  document.getElementById('user-quota-used').textContent = `${used} pads`;
  document.getElementById('user-quota-rem-sub').textContent = `${remaining} pads`;

  // Linear progress bar
  const pct = Math.min(Math.round((used / limit) * 100), 100);
  const pBar = document.getElementById('user-progress-bar');
  pBar.style.width = `${pct}%`;
  if (isExhausted) {
    pBar.className = 'progress-bar limit-reached';
  } else {
    pBar.className = 'progress-bar';
  }

  document.getElementById('user-progress-text').textContent = `${used} of ${limit} Collected`;
  document.getElementById('user-max-label').textContent = `${limit} pads`;

  // Emergency banner visibility
  const emergBanner = document.getElementById('user-emergency-banner');
  if (emergBanner) {
    if (isExhausted) {
      emergBanner.style.display = 'flex';
    } else {
      emergBanner.style.display = 'flex'; // Keep accessible so students in urgent need can request extra pads anytime
    }
  }
}

function renderUserTransactions(txs) {
  const tbody = document.getElementById('user-history-tbody');
  if (!txs || txs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">No dispense history recorded yet for this card.</td></tr>';
    return;
  }

  tbody.innerHTML = txs.map(t => {
    let badgeClass = 'badge-emerald';
    let statusLabel = 'Dispensed';

    if (t.status === 'DENIED_LIMIT_REACHED') {
      badgeClass = 'badge-warn';
      statusLabel = 'Quota Exceeded';
    } else if (t.status === 'INVALID_CARD') {
      badgeClass = 'badge-err';
      statusLabel = 'Invalid Card';
    }

    const rem = t.remaining_after !== undefined ? `${t.remaining_after} pads` : '—';

    return `
      <tr>
        <td><strong>${t.quantity > 0 ? t.quantity + ' pad(s)' : '0'}</strong></td>
        <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
        <td>${rem}</td>
        <td style="color:var(--text-dim); font-size:12px;">${escapeHtml(t.timestamp || '')}</td>
      </tr>
    `;
  }).join('');
}

// ------------------------------------------------------------
//  TOAST UTILITIES & HELPERS
// ------------------------------------------------------------

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4200);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ------------------------------------------------------------
//  PERIOD & MENSTRUAL CYCLE TRACKER
// ------------------------------------------------------------

let currentUserCycleData = null;
let currentUserRemainingPads = 5;

function updateCycleTracker(cycleData, remainingPads) {
  if (remainingPads !== undefined) {
    currentUserRemainingPads = remainingPads;
  }
  if (cycleData) {
    currentUserCycleData = cycleData;
  }

  const today = new Date();
  let defaultDateStr = new Date(today.getTime() - 12 * 86400000).toISOString().slice(0, 10);
  let cycleLength = 28;
  let periodDuration = 5;
  let lastPeriodDateStr = defaultDateStr;

  if (currentUserCycleData && currentUserCycleData.last_period_date) {
    lastPeriodDateStr = currentUserCycleData.last_period_date;
    cycleLength = currentUserCycleData.cycle_length || 28;
    periodDuration = currentUserCycleData.period_duration || 5;
  }

  const lastDateInput = document.getElementById('cycle-last-date');
  if (lastDateInput && !lastDateInput.value) {
    lastDateInput.value = lastPeriodDateStr;
  }
  const cycleLenInput = document.getElementById('cycle-length-input');
  if (cycleLenInput) cycleLenInput.value = cycleLength;
  const periodDurInput = document.getElementById('period-duration-input');
  if (periodDurInput) periodDurInput.value = periodDuration;

  const lastPeriodDate = new Date(lastPeriodDateStr + 'T00:00:00');
  const todayClean = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.floor((todayClean - lastPeriodDate) / 86400000);
  const currentDayInCycle = ((diffDays % cycleLength) + cycleLength) % cycleLength + 1;

  let phaseName = 'Follicular Phase';
  let phaseColor = '#34d399';
  let phaseTitle = 'Follicular Phase (Days 6–13)';
  let phaseDesc = 'Estrogen rises, prepping your body. Energy levels generally elevate.';

  if (currentDayInCycle <= periodDuration) {
    phaseName = 'Menstrual Phase';
    phaseColor = '#f43f5e';
    phaseTitle = 'Menstrual Phase (Days 1–5)';
    phaseDesc = 'Uterine lining sheds. Stay hydrated and have clean pads ready.';
  } else if (currentDayInCycle >= 14 && currentDayInCycle <= 16) {
    phaseName = 'Ovulation Phase';
    phaseColor = '#38bdf8';
    phaseTitle = 'Ovulation Phase (Days 14–16)';
    phaseDesc = 'Peak fertility window with highest energy levels.';
  } else if (currentDayInCycle > 16) {
    phaseName = 'Luteal Phase';
    phaseColor = '#a78bfa';
    phaseTitle = 'Luteal Phase (Days 17–28)';
    phaseDesc = 'Progesterone peaks. Mild PMS symptoms may begin.';
  }

  const dayNumEl = document.getElementById('cycle-day-num');
  if (dayNumEl) dayNumEl.textContent = `Day ${currentDayInCycle}`;
  const dayLblEl = document.getElementById('cycle-day-label');
  if (dayLblEl) dayLblEl.textContent = `of ${cycleLength} Day Cycle`;

  const daysUntilNext = cycleLength - currentDayInCycle + 1;
  const countEl = document.getElementById('cycle-countdown-text');
  if (countEl) {
    countEl.textContent = currentDayInCycle <= periodDuration ? 'Period in progress' : `Starts in ${daysUntilNext} day(s)`;
  }

  const nextDate = new Date(todayClean.getTime() + daysUntilNext * 86400000);
  const nextDateFormatted = nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const nextDateEl = document.getElementById('cycle-next-date');
  if (nextDateEl) nextDateEl.textContent = nextDateFormatted;

  const phaseBadge = document.getElementById('cycle-phase-badge');
  if (phaseBadge) {
    phaseBadge.textContent = phaseName;
    phaseBadge.style.color = phaseColor;
  }
  const phaseNameEl = document.getElementById('cycle-phase-name');
  if (phaseNameEl) {
    phaseNameEl.textContent = phaseName;
    phaseNameEl.style.color = phaseColor;
  }

  const phaseDetailTitle = document.getElementById('phase-detail-title');
  if (phaseDetailTitle) phaseDetailTitle.textContent = phaseTitle;
  const phaseDetailDesc = document.getElementById('phase-detail-desc');
  if (phaseDetailDesc) phaseDetailDesc.textContent = phaseDesc;
  const phaseDot = document.getElementById('phase-color-dot');
  if (phaseDot) phaseDot.style.background = phaseColor;

  const gaugeCircumference = 427.25;
  const gaugeFraction = currentDayInCycle / cycleLength;
  const gaugeFill = document.getElementById('cycle-gauge-fill');
  if (gaugeFill) {
    gaugeFill.style.strokeDashoffset = gaugeCircumference * (1 - gaugeFraction);
    gaugeFill.style.stroke = phaseColor;
  }

  const needle = document.getElementById('timeline-needle');
  if (needle) {
    needle.style.left = `${Math.min(gaugeFraction * 100, 98)}%`;
  }

  const banner = document.getElementById('pad-readiness-banner');
  const readTitle = document.getElementById('readiness-title');
  const readDesc = document.getElementById('readiness-desc');

  if (banner && readTitle && readDesc) {
    banner.classList.remove('urgent', 'ready');
    if (currentDayInCycle <= periodDuration) {
      banner.classList.add('urgent');
      readTitle.textContent = `Period Active — ${currentUserRemainingPads} Pad(s) Available in Quota`;
      readDesc.textContent = `Your cycle is currently active. You can dispense your remaining ${currentUserRemainingPads} pad(s) from the HygieNet machine whenever needed.`;
    } else if (daysUntilNext <= 3) {
      banner.classList.add('ready');
      readTitle.textContent = `Flow Imminent (${currentUserRemainingPads} pads ready for collection)`;
      readDesc.textContent = `Your period is estimated to begin in ${daysUntilNext} day(s). Tap your RFID card at the HygieNet machine today to collect pads ahead of time!`;
    } else {
      banner.classList.add('ready');
      readTitle.textContent = `Machine Stock Ready (${currentUserRemainingPads} pads balance)`;
      readDesc.textContent = `Next cycle starts in ~${daysUntilNext} days (${nextDateFormatted}). You have a healthy monthly balance of ${currentUserRemainingPads} pads.`;
    }
  }
}

async function handleCycleSettingsSave(e) {
  e.preventDefault();
  const session = getSession();
  if (!session || !session.uid) {
    showToast('Please log in as a beneficiary to save cycle data.', 'error');
    return;
  }

  const lastDate = document.getElementById('cycle-last-date').value;
  const cycleLen = parseInt(document.getElementById('cycle-length-input').value, 10) || 28;
  const periodDur = parseInt(document.getElementById('period-duration-input').value, 10) || 5;
  const btn = document.getElementById('btn-save-cycle');

  if (!lastDate) {
    showToast('Please select your last period start date.', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = 'Saving...';

  try {
    const res = await fetch(`/api/user/${encodeURIComponent(session.uid)}/cycle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        last_period_date: lastDate,
        cycle_length: cycleLen,
        period_duration: periodDur
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast('Cycle tracker updated successfully!', 'success');
      updateCycleTracker({
        last_period_date: lastDate,
        cycle_length: cycleLen,
        period_duration: periodDur
      }, currentUserRemainingPads);
    } else {
      showToast(data.message || 'Failed to save cycle settings', 'error');
    }
  } catch (err) {
    showToast('Network error saving cycle settings', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `Save & Recalculate Cycle`;
  }
}

// ------------------------------------------------------------
//  AI CHATBOT (HYGIEBOT / SAHELI AI)
// ------------------------------------------------------------

let chatLanguage = 'en';

function toggleChatWindow() {
  const box = document.getElementById('chat-window');
  if (!box) return;
  box.classList.toggle('hidden');
  if (!box.classList.contains('hidden')) {
    const input = document.getElementById('chat-user-input');
    if (input) input.focus();
    scrollChatToBottom();
  }
}

function toggleChatLanguage() {
  chatLanguage = chatLanguage === 'en' ? 'hi' : 'en';
  const flag = document.getElementById('chat-lang-flag');
  const label = document.getElementById('chat-lang-label');
  const chipsContainer = document.getElementById('chat-quick-chips');

  if (chatLanguage === 'hi') {
    if (flag) flag.textContent = '🇬🇧';
    if (label) label.textContent = 'English';
    if (chipsContainer) {
      chipsContainer.innerHTML = `
        <button type="button" class="chat-chip" onclick="handleChipClick(this)">🩸 पैड कब बदलें?</button>
        <button type="button" class="chat-chip" onclick="handleChipClick(this)">🌿 दर्द से राहत के उपाय</button>
        <button type="button" class="chat-chip" onclick="handleChipClick(this)">🗑️ पैड का सही निपटान</button>
        <button type="button" class="chat-chip" onclick="handleChipClick(this)">⚙️ मशीन कैसे चलाएं?</button>
        <button type="button" class="chat-chip" onclick="handleChipClick(this)">📅 मासिक चक्र ट्रैकर</button>
      `;
    }
    appendChatMessage('bot', 'नमस्ते! मैं **HygieBot** हूँ — आपकी माहवारी स्वास्थ्य एवं HygieNet मशीन सहायक। आप मुझसे कोई भी प्रश्न पूछ सकती हैं।');
  } else {
    if (flag) flag.textContent = '🇮🇳';
    if (label) label.textContent = 'हिन्दी';
    if (chipsContainer) {
      chipsContainer.innerHTML = `
        <button type="button" class="chat-chip" onclick="handleChipClick(this)">🩸 Pad change guide</button>
        <button type="button" class="chat-chip" onclick="handleChipClick(this)">🌿 Period cramp relief</button>
        <button type="button" class="chat-chip" onclick="handleChipClick(this)">🗑️ Safe pad disposal</button>
        <button type="button" class="chat-chip" onclick="handleChipClick(this)">⚙️ How to use machine</button>
        <button type="button" class="chat-chip" onclick="handleChipClick(this)">📅 Menstrual cycle phases</button>
      `;
    }
    appendChatMessage('bot', 'Switched to English! Feel free to ask about period hygiene, cramps, or machine vending.');
  }
}

function handleChipClick(btn) {
  const text = btn.textContent.replace(/^[^\w\u0900-\u097F]+/, '').trim();
  const input = document.getElementById('chat-user-input');
  if (input) input.value = text;
  sendChatMessage(text);
}

function handleSendChatMessage(e) {
  e.preventDefault();
  const input = document.getElementById('chat-user-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  sendChatMessage(text);
}

async function sendChatMessage(text) {
  appendChatMessage('user', text);
  const typing = document.getElementById('chat-typing');
  if (typing) typing.classList.remove('hidden');
  scrollChatToBottom();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, lang: chatLanguage })
    });
    const data = await res.json();
    if (typing) typing.classList.add('hidden');
    appendChatMessage('bot', data.reply || 'I could not process your request right now. Please try asking again.');
  } catch (err) {
    if (typing) typing.classList.add('hidden');
    appendChatMessage('bot', 'Network error reaching HygieBot AI. Please try again in a moment.');
  }
  scrollChatToBottom();
}

function appendChatMessage(sender, text) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-msg msg-${sender}`;

  let formatted = escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');

  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  msgDiv.innerHTML = `
    <div class="msg-bubble">${formatted}</div>
    <span class="msg-time">${timeStr}</span>
  `;

  container.appendChild(msgDiv);
  scrollChatToBottom();
}

function scrollChatToBottom() {
  const container = document.getElementById('chat-messages');
  if (container) {
    setTimeout(() => {
      container.scrollTop = container.scrollHeight;
    }, 40);
  }
}

// ------------------------------------------------------------
//  LOCALHOST HARDWARE SIMULATOR (ZERO ARDUINO NEEDED)
// ------------------------------------------------------------

function initLocalDevBar() {
  const isLocal = window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1' || 
                  window.location.hostname === '::1';
  const bar = document.getElementById('localhost-dev-bar');
  if (!bar) return;

  if (isLocal) {
    bar.style.display = 'block';
  } else {
    bar.style.display = 'none';
  }
}

function toggleDevBar() {
  const body = document.getElementById('dev-bar-body');
  const btn = document.getElementById('btn-dev-toggle');
  if (!body) return;

  body.classList.toggle('hidden');
  if (body.classList.contains('hidden')) {
    if (btn) btn.textContent = '▲ Expand Simulator';
  } else {
    if (btn) btn.textContent = '▼ Collapse Simulator';
  }
}

async function simVerifySelectedCard() {
  const sel = document.getElementById('sim-card-select');
  const uid = sel ? sel.value : 'C3:27:87:14';
  const statusEl = document.getElementById('dev-sim-status');

  statusEl.textContent = `[Simulating Uno R4 Card Tap] Querying /api/card/verify for ${uid}...`;

  try {
    const res = await fetch(`/api/card/verify?uid=${encodeURIComponent(uid)}`, {
      headers: {
        'X-Client': 'WebSimulator',
        'X-Device-Key': 'hygienet_r4_sec_2026_x89'
      }
    });
    const data = await res.json();
    statusEl.textContent = `[Uno R4 Response] ${data.authorized ? '🟢 AUTHORIZED' : '🔴 DENIED'}: ${data.name || 'Unknown'} (Remaining: ${data.remaining} pads, Limit: ${data.monthly_limit})`;
    showToast(`Simulator: ${data.name || uid} verified (${data.remaining} pads remaining)`, data.authorized ? 'success' : 'error');
  } catch (err) {
    statusEl.textContent = `[Simulator Error] Failed to contact local server: ${err.message}`;
  }
}

async function simDispenseSelectedCard(qty = 1) {
  const sel = document.getElementById('sim-card-select');
  const uid = sel ? sel.value : 'C3:27:87:14';
  const statusEl = document.getElementById('dev-sim-status');

  statusEl.textContent = `[Simulating Dispenser Actuation] Sending /api/dispense/record for ${uid} (Qty: ${qty})...`;

  try {
    const res = await fetch('/api/dispense/record', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client': 'WebSimulator',
        'X-Device-Key': 'hygienet_r4_sec_2026_x89'
      },
      body: JSON.stringify({
        uid: uid,
        quantity: qty,
        status: 'DISPENSED'
      })
    });
    const data = await res.json();
    if (data.success) {
      statusEl.textContent = `[Dispenser Success] Motor pulsed! Delivered ${qty} pad(s). Remaining quota: ${data.remaining_after}. Hopper stock decremented.`;
      showToast(`Simulator: Dispensed ${qty} pad(s) to ${uid}!`, 'success');
      fetchHopperStock();
      refreshCurrentView();
    } else {
      statusEl.textContent = `[Dispenser Error] ${data.message || 'Dispense denied'}`;
      showToast(`Simulator Error: ${data.message}`, 'error');
    }
  } catch (err) {
    statusEl.textContent = `[Simulator Error] ${err.message}`;
  }
}

async function simTriggerHopperStockDrop() {
  const statusEl = document.getElementById('dev-sim-status');
  statusEl.textContent = '[Simulating Machine Stock Drop] Decrementing hopper stock by 1...';

  try {
    const res = await fetch('/api/dispense/record', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client': 'WebSimulator',
        'X-Device-Key': 'hygienet_r4_sec_2026_x89'
      },
      body: JSON.stringify({
        uid: 'TEST:LOCAL:SIM',
        quantity: 1,
        status: 'MANUAL_TEST'
      })
    });
    const data = await res.json();
    statusEl.textContent = `[Hopper Decremented] Current hopper stock updated.`;
    fetchHopperStock();
    showToast('Simulator: Hopper stock decremented by 1', 'info');
  } catch (e) {
    statusEl.textContent = `[Simulator Error] ${e.message}`;
  }
}
