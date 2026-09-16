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
  
  // Health sync
  fetchHealthStatus();
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
      fetch(`/api/user/${encodeURIComponent(session.uid)}`).then(r => r.json()),
      fetch(`/api/user/${encodeURIComponent(session.uid)}/transactions?limit=20`).then(r => r.json())
    ]);

    if (profileRes.success && profileRes.user) {
      renderUserProfile(profileRes.user);
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
