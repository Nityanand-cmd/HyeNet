// ============================================================
//  HygieNet Cloud Edition — Admin Dashboard & Simulator JS
// ============================================================

let currentSimState = {
  activeUid: null,
  activeName: null,
  remaining: 0,
  selectedQty: 1,
  maxSelectable: 0,
  isBusy: false
};

// Polling interval
let pollTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  fetchDashboardData();
  pollTimer = setInterval(fetchDashboardData, 5000);
});

// ------------------------------------------------------------
//  DASHBOARD DATA FETCHING & RENDERING
// ------------------------------------------------------------

async function fetchDashboardData() {
  try {
    const [statsRes, usersRes, txRes] = await Promise.all([
      fetch('/api/dashboard/stats').then(r => r.json()),
      fetch('/api/users').then(r => r.json()),
      fetch('/api/transactions?limit=20').then(r => r.json())
    ]);

    renderStats(statsRes);
    renderUsers(usersRes, statsRes.monthly_limit);
    renderTransactions(txRes);
  } catch (err) {
    console.error('Error fetching dashboard telemetry:', err);
  }
}

function renderStats(stats) {
  if (!stats) return;

  document.getElementById('stat-total-dispensed').textContent = stats.total_dispensed || 0;
  document.getElementById('stat-today-tx').textContent = stats.today_transactions || 0;
  document.getElementById('stat-active-users').textContent = stats.registered_users || 0;
  document.getElementById('stat-monthly-limit').textContent = stats.monthly_limit || 5;

  // Render Database & Device connection
  const conn = stats.connection || {};
  const dbBadge = document.getElementById('db-badge');
  const dbTitle = document.getElementById('db-title');
  const dbDesc = document.getElementById('db-desc');

  if (conn.connected) {
    dbBadge.textContent = "MongoDB Atlas Live";
    dbBadge.className = "banner-badge";
    dbTitle.textContent = "MongoDB Atlas Cluster Synchronized";
    dbDesc.textContent = "All transactions, users, and device telemetry are persistently synced with your MongoDB Atlas cloud database.";
  } else {
    dbBadge.textContent = "Local Fallback Cache";
    dbBadge.className = "banner-badge badge-warn";
    dbTitle.textContent = "Operating in Resilient Mode";
    dbDesc.textContent = conn.error ? `Atlas Notice: ${conn.error}. System is running smoothly in local storage mode.` : "Connecting to database...";
  }

  // Device status
  const devStatusText = document.getElementById('device-status-text');
  const devices = stats.devices || [];
  const activeDevice = devices.find(d => d.is_active);
  if (activeDevice) {
    devStatusText.textContent = `${activeDevice.device_id}: Online`;
  } else {
    devStatusText.textContent = "UNO R4 WiFi: Ready";
  }
}

function renderUsers(users, defaultLimit = 5) {
  const tbody = document.getElementById('users-tbody');
  if (!users || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No beneficiaries registered yet. Click "Add User" above.</td></tr>';
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
        <td><strong style="color:${isExhausted ? '#f59e0b' : '#34d399'}">${remaining}</strong> pads</td>
        <td>${statusBadge}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="resetSingleUser('${escapeHtml(u.rfid_uid)}')">Reset</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderTransactions(txs) {
  const tbody = document.getElementById('tx-tbody');
  if (!txs || txs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No dispense activity yet. Tap a card in the simulator to test!</td></tr>';
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

// ------------------------------------------------------------
//  INTERACTIVE HARDWARE & DISPENSER SIMULATOR
// ------------------------------------------------------------

function toggleSimulator() {
  const container = document.getElementById('simulator-container');
  container.classList.toggle('hidden');
  if (!container.classList.contains('hidden')) {
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

async function simTapCard(uid) {
  if (currentSimState.isBusy) return;

  setOledText("AUTHENTICATING...", "CONNECTING HTTPS", "CHECKING VERCEL");

  try {
    const res = await fetch('/api/card/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client': 'WebSimulator'
      },
      body: JSON.stringify({ uid: uid, device_id: 'SIMULATOR-01' })
    });

    const data = await res.json();

    if (data.authorized) {
      currentSimState.activeUid = uid;
      currentSimState.activeName = data.name;
      currentSimState.remaining = data.remaining;
      currentSimState.maxSelectable = data.max_selectable;
      currentSimState.selectedQty = 1;

      setOledText(
        data.name.toUpperCase(),
        `REMAINING: ${data.remaining}`,
        `SELECT: [ 1 ] PAD`
      );
      showToast(`Card Verified: ${data.name} (${data.remaining} pads available)`, 'success');
    } else {
      currentSimState.activeUid = null;
      if (data.reason === 'LIMIT_REACHED') {
        setOledText(data.name.toUpperCase(), "LIMIT REACHED", "0 PADS REMAINING");
        showToast(`Limit Reached: ${data.name} has exhausted monthly quota.`, 'error');
      } else {
        setOledText("INVALID CARD", "NOT REGISTERED", "TAP VALID CARD");
        showToast("Card not registered in database.", 'error');
      }

      setTimeout(resetOledIdle, 3500);
    }
  } catch (err) {
    setOledText("SERVER ERROR", "CHECK CONNECTION", "TRY AGAIN");
    setTimeout(resetOledIdle, 3000);
  }
}

function simTapCustomCard() {
  const input = document.getElementById('sim-custom-uid');
  const uid = input.value.trim().toUpperCase();
  if (!uid) {
    showToast("Please enter a card UID", 'error');
    return;
  }
  simTapCard(uid);
}

function simAdjustQty(delta) {
  if (!currentSimState.activeUid || currentSimState.isBusy) return;

  const newQty = currentSimState.selectedQty + delta;
  if (newQty >= 1 && newQty <= currentSimState.maxSelectable) {
    currentSimState.selectedQty = newQty;
    setOledText(
      currentSimState.activeName.toUpperCase(),
      `REMAINING: ${currentSimState.remaining}`,
      `SELECT: [ ${newQty} ] PADS`
    );
  }
}

async function simConfirmDispense() {
  if (!currentSimState.activeUid || currentSimState.isBusy) return;

  currentSimState.isBusy = true;
  const qty = currentSimState.selectedQty;
  const uid = currentSimState.activeUid;

  setOledText("COMMITTING...", `REQUESTING ${qty} PADS`, "CONTACTING CLOUD");

  try {
    const res = await fetch('/api/dispense/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client': 'WebSimulator'
      },
      body: JSON.stringify({
        uid: uid,
        device_id: 'SIMULATOR-01',
        quantity: qty
      })
    });

    const data = await res.json();

    if (data.success) {
      showToast(`Dispensing ${qty} pads for ${data.user_name}...`, 'success');

      // Animate Servos
      for (let i = 1; i <= qty; i++) {
        setOledText("DISPENSING...", `PAD ${i} OF ${qty}`, "PLEASE WAIT");
        await runServoCycle();
      }

      setOledText("THANK YOU!", "COLLECT PADS", `REMAINING: ${data.remaining}`);
      showToast("Dispense cycle complete!", 'success');
      fetchDashboardData();
    } else {
      setOledText("TRANSACTION FAILED", data.reason || "ERROR", "TRY AGAIN");
      showToast(data.message || "Dispense denied", 'error');
    }
  } catch (err) {
    setOledText("DISPENSE ERROR", "SERVER TIMEOUT", "PLEASE RETRY");
  } finally {
    currentSimState.isBusy = false;
    currentSimState.activeUid = null;
    setTimeout(resetOledIdle, 4000);
  }
}

async function runServoCycle() {
  const arm = document.getElementById('sim-servo-arm');
  const gate = document.getElementById('sim-servo-gate');

  // Step 1: Arm actuates (moves pad forward)
  arm.classList.add('actuated');
  await sleep(700);

  // Step 2: Gate opens (drops pad)
  gate.classList.add('actuated');
  await sleep(700);

  // Step 3: Arm returns to home
  arm.classList.remove('actuated');
  await sleep(600);

  // Step 4: Gate returns to home
  gate.classList.remove('actuated');
  await sleep(600);
}

function setOledText(line1, line2, line3) {
  document.getElementById('sim-oled-line1').textContent = line1;
  document.getElementById('sim-oled-line2').textContent = line2;
  document.getElementById('sim-oled-line3').textContent = line3;
}

function resetOledIdle() {
  setOledText("HYGIENET R4", "READY TO SCAN", "TAP RFID CARD");
}

// ------------------------------------------------------------
//  BENEFICIARY MANAGEMENT MODAL & RESET
// ------------------------------------------------------------

function openAddUserModal() {
  document.getElementById('user-form').reset();
  document.getElementById('user-modal').classList.remove('hidden');
}

function closeUserModal() {
  document.getElementById('user-modal').classList.add('hidden');
}

async function handleUserSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('form-name').value.trim();
  const uid = document.getElementById('form-uid').value.trim().toUpperCase();
  const limit = parseInt(document.getElementById('form-limit').value, 10);

  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rfid_uid: uid, name: name, monthly_limit: limit })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      closeUserModal();
      fetchDashboardData();
    } else {
      showToast(data.message || 'Failed to save beneficiary', 'error');
    }
  } catch (err) {
    showToast('Network error saving user', 'error');
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
    fetchDashboardData();
  } catch (err) {
    showToast('Failed to reset quota', 'error');
  }
}

async function confirmResetAll() {
  if (!confirm("Are you sure you want to reset the monthly pad usage to 0 for ALL registered beneficiaries?")) return;

  try {
    const res = await fetch('/api/users/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    showToast(data.message, 'success');
    fetchDashboardData();
  } catch (err) {
    showToast('Failed to reset quotas', 'error');
  }
}

// ------------------------------------------------------------
//  TOAST UTILITY & HELPERS
// ------------------------------------------------------------

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
