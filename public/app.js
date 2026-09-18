// ============================================================
//  HygieNet Cloud Edition — Clean Dashboard & Portals JS
// ============================================================

const STORAGE_KEY = 'hygienet_auth_session';
let pollInterval = null;
let cachedUsers = [];
let cachedTransactions = [];

// ------------------------------------------------------------
//  INITIALIZATION & VIEW ROUTING
// ------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  const session = getSession();
  if (session && session.role === 'admin') {
    showAdminDashboard();
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
  
  // Navbar state
  document.getElementById('nav-user-pill').style.display = 'none';
  const authBtn = document.getElementById('btn-auth-action');
  authBtn.textContent = 'Sign In';
  authBtn.className = 'btn btn-primary btn-sm';
  
  // Health sync & load registered cards
  fetchHealthStatus();
  populateQuickPills();
}

function showAdminDashboard() {
  if (pollInterval) clearInterval(pollInterval);
  
  document.getElementById('view-auth').classList.add('hidden');
  document.getElementById('view-admin').classList.remove('hidden');
  document.getElementById('view-user').classList.add('hidden');
  
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
  if (session && session.role === 'admin') {
    fetchAdminDashboardData();
    showToast('Admin data synchronized with MongoDB Atlas.', 'info');
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
  const adminForm = document.getElementById('admin-login-form');
  const userForm = document.getElementById('user-login-form');

  if (tab === 'admin') {
    adminBtn.classList.add('active');
    userBtn.classList.remove('active');
    adminForm.classList.remove('hidden');
    userForm.classList.add('hidden');
  } else {
    userBtn.classList.add('active');
    adminBtn.classList.remove('active');
    userForm.classList.remove('hidden');
    adminForm.classList.add('hidden');
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
//  ADMIN MANAGEMENT DASHBOARD
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
    (u.rfid_uid && u.rfid_uid.toLowerCase().includes(q))
  );
  renderAdminUsers(filtered);
}

function renderAdminUsers(users, defaultLimit = 5) {
  const tbody = document.getElementById('users-tbody');
  if (!users || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No beneficiaries match. Click "Add Beneficiary" to register a card.</td></tr>';
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

    return `
      <tr>
        <td><strong>${escapeHtml(u.name)}</strong></td>
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
            <button class="btn-table-action" onclick="openEditUserModal('${escapeHtml(u.rfid_uid)}', '${escapeHtml(u.name)}', ${limit})" title="Edit Name or Monthly Quota">Edit</button>
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
  
  document.getElementById('user-modal').classList.remove('hidden');
}

function openEditUserModal(uid, name, limit) {
  document.getElementById('form-is-edit').value = '1';
  document.getElementById('modal-title').textContent = `Edit Beneficiary (${uid})`;
  document.getElementById('btn-modal-save').textContent = 'Save Changes';
  
  document.getElementById('form-name').value = name;
  const uidInput = document.getElementById('form-uid');
  uidInput.value = uid;
  uidInput.readOnly = true;
  document.getElementById('form-uid-hint').textContent = 'Card UID cannot be changed while editing.';
  document.getElementById('form-limit').value = limit || 5;

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

  try {
    let res;
    if (isEdit) {
      res = await fetch(`/api/users/${encodeURIComponent(uid)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, monthly_limit: limit })
      });
    } else {
      res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rfid_uid: uid, name: name, monthly_limit: limit })
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
      updateCycleTracker(profileRes.user.cycle_data, profileRes.user.remaining);
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

  const statusBadge = document.getElementById('user-profile-status');
  if (isExhausted) {
    statusBadge.textContent = 'Quota Reached';
    statusBadge.className = 'badge badge-warn';
  } else {
    statusBadge.textContent = 'Active';
    statusBadge.className = 'badge badge-emerald';
  }

  // Quota circular ring calculation
  // Total circumference for r=50 is ~314.15
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
  }, 3800);
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

  // Calculate default date if none provided (14 days ago for mid-cycle demo)
  const today = new Date();
  let defaultDateStr = new Date(today.getTime() - 12 * 86400000).toISOString().slice(0, 10);

  const lastDateStr = (currentUserCycleData && currentUserCycleData.last_period_date)
    ? currentUserCycleData.last_period_date
    : defaultDateStr;

  const cycleLen = (currentUserCycleData && currentUserCycleData.cycle_length)
    ? parseInt(currentUserCycleData.cycle_length, 10)
    : 28;

  const periodDur = (currentUserCycleData && currentUserCycleData.period_duration)
    ? parseInt(currentUserCycleData.period_duration, 10)
    : 5;

  // Set input values
  const dateInput = document.getElementById('cycle-last-date');
  const lenInput = document.getElementById('cycle-length-input');
  const durInput = document.getElementById('period-duration-input');

  if (dateInput) dateInput.value = lastDateStr;
  if (lenInput) lenInput.value = cycleLen;
  if (durInput) durInput.value = periodDur;

  // Day calculation
  const [sy, sm, sd] = lastDateStr.split('-').map(Number);
  const startDate = new Date(sy, sm - 1, sd);
  const nowOnlyDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  
  let diffDays = Math.floor((nowOnlyDate - startDate) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) diffDays = 0;

  const cycleDay = (diffDays % cycleLen) + 1;
  const daysUntilNext = cycleLen - (cycleDay - 1);
  const isPeriodActive = cycleDay <= periodDur;

  // Phase categorization
  let phaseName = 'Menstrual Phase';
  let phaseColor = '#f43f5e';
  let badgeClass = 'badge badge-err';
  let phaseTitle = 'Menstrual Phase (Active Flow)';
  let phaseDesc = 'Uterine lining is shedding. Prioritize gentle rest, warmth, adequate hydration, and change sanitary pads every 4 to 6 hours.';

  if (isPeriodActive) {
    phaseName = `Menstrual Phase (Day ${cycleDay})`;
    phaseColor = '#f43f5e';
    badgeClass = 'badge badge-err';
    phaseTitle = `Menstrual Phase (Day ${cycleDay} of ${periodDur})`;
    phaseDesc = 'Active menstrual flow. Stay clean, comfortable, and ensure you have sufficient pads from the HygieNet dispenser.';
  } else if (cycleDay <= Math.floor(cycleLen * 0.46)) {
    phaseName = 'Follicular Phase';
    phaseColor = '#10b981';
    badgeClass = 'badge badge-emerald';
    phaseTitle = 'Follicular Phase (Renewal)';
    phaseDesc = 'Follicle-stimulating hormone is elevating estrogen levels. Physical stamina, mood, and cognitive clarity are generally highest.';
  } else if (cycleDay <= Math.floor(cycleLen * 0.58)) {
    phaseName = 'Ovulation Phase';
    phaseColor = '#8b5cf6';
    badgeClass = 'badge badge-cyan';
    phaseTitle = 'Ovulation Phase (Peak Vitality)';
    phaseDesc = 'A mature egg is released from the ovary. Hormonal vitality and body temperature peak during this window.';
  } else {
    phaseName = 'Luteal Phase';
    phaseColor = '#f59e0b';
    badgeClass = 'badge badge-warn';
    phaseTitle = 'Luteal Phase (PMS & Pad Readiness)';
    phaseDesc = 'Progesterone dominance prepares for your next cycle. Mild PMS or fatigue may occur. Excellent time to collect pads from the machine!';
  }

  // Update circular gauge
  const circumference = 427.26; // 2 * PI * 68
  const fraction = Math.min(Math.max(cycleDay / cycleLen, 0.03), 1);
  const offset = circumference * (1 - fraction);

  const gaugeFill = document.getElementById('cycle-gauge-fill');
  if (gaugeFill) {
    gaugeFill.style.strokeDashoffset = offset;
    gaugeFill.style.stroke = phaseColor;
  }

  // Text Elements
  const dayNumEl = document.getElementById('cycle-day-num');
  if (dayNumEl) dayNumEl.textContent = `Day ${cycleDay}`;

  const dayLabelEl = document.getElementById('cycle-day-label');
  if (dayLabelEl) dayLabelEl.textContent = `of ${cycleLen} Day Cycle`;

  const countTextEl = document.getElementById('cycle-countdown-text');
  if (countTextEl) {
    if (isPeriodActive) {
      countTextEl.textContent = '🩸 Period in Progress';
      countTextEl.style.color = '#f43f5e';
    } else if (daysUntilNext === 0 || daysUntilNext === cycleLen) {
      countTextEl.textContent = '🩸 Period Due Today';
      countTextEl.style.color = '#f43f5e';
    } else {
      countTextEl.textContent = `Starts in ${daysUntilNext} day${daysUntilNext === 1 ? '' : 's'}`;
      countTextEl.style.color = '#38bdf8';
    }
  }

  const phaseNameEl = document.getElementById('cycle-phase-name');
  if (phaseNameEl) {
    phaseNameEl.textContent = phaseName;
    phaseNameEl.style.color = phaseColor;
  }

  const phaseBadgeEl = document.getElementById('cycle-phase-badge');
  if (phaseBadgeEl) {
    phaseBadgeEl.textContent = phaseName;
    phaseBadgeEl.className = badgeClass;
  }

  // Estimated next start date
  const cyclesCompleted = Math.floor(diffDays / cycleLen);
  const nextEstimatedTimestamp = startDate.getTime() + (cyclesCompleted + 1) * cycleLen * 86400000;
  const nextEstimatedDate = new Date(nextEstimatedTimestamp);
  const nextDateFormatted = nextEstimatedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  const nextDateEl = document.getElementById('cycle-next-date');
  if (nextDateEl) nextDateEl.textContent = nextDateFormatted;

  // Phase Detail box
  const phaseDot = document.getElementById('phase-color-dot');
  if (phaseDot) phaseDot.style.background = phaseColor;

  const phaseTitleEl = document.getElementById('phase-detail-title');
  if (phaseTitleEl) phaseTitleEl.textContent = phaseTitle;

  const phaseDescEl = document.getElementById('phase-detail-desc');
  if (phaseDescEl) phaseDescEl.textContent = phaseDesc;

  // Timeline indicator needle
  const timelineNeedle = document.getElementById('timeline-needle');
  if (timelineNeedle) {
    const percent = Math.min(Math.max(((cycleDay - 1) / cycleLen) * 100, 2), 98);
    timelineNeedle.style.left = `${percent}%`;
  }

  // Smart HygieNet Pad Readiness Banner
  const banner = document.getElementById('pad-readiness-banner');
  const readTitle = document.getElementById('readiness-title');
  const readDesc = document.getElementById('readiness-desc');

  if (banner && readTitle && readDesc) {
    if (currentUserRemainingPads === 0) {
      banner.classList.remove('ready');
      readTitle.textContent = 'Pad Quota Fully Used (0 pads remaining)';
      readDesc.textContent = `Your next cycle begins in ~${daysUntilNext} day(s), but your monthly quota is exhausted. Please contact your campus administrator for an allocation reload.`;
    } else if (isPeriodActive) {
      banner.classList.add('ready');
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
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
        <polyline points="17 21 17 13 7 13 7 21"></polyline>
        <polyline points="7 3 7 8 15 8"></polyline>
      </svg>
      Save & Recalculate Cycle
    `;
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

