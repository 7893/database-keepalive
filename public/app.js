let timezone = 'Asia/Hong_Kong';
let loading = false;

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[char]));

async function loadData() {
  if (loading) return;
  loading = true;
  try {
    const res = await fetch('/api/status');
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    if (!data || !Array.isArray(data.instances)) throw new Error('Status unavailable');
    const notice = document.getElementById('notice');
    if (notice && notice.textContent.startsWith('Unable to refresh')) notice.textContent = '';
    render(data);
  } catch (err) {
    const notice = document.getElementById('notice');
    if (notice) notice.textContent = 'Unable to refresh status: ' + (err instanceof Error ? err.message : String(err));
  } finally {
    loading = false;
  }
}

function typeIcon(type) {
  if (type === 'supabase') return '⚡';
  if (type === 'oracle' || type === 'oracle_adb' || type === 'adb') return '🔴';
  if (type === 'mysql') return '🐬';
  return '🗄️';
}

function render(data) {
  timezone = data.timezone || 'Asia/Hong_Kong';
  document.getElementById('totalInstances').innerText = data.instances.length;
  document.getElementById('tzDisplay').innerText = timezone === 'Asia/Hong_Kong' ? '香港时间（UTC+8）' : timezone;

  let healthy = 0;
  data.instances.forEach(i => {
    if (!i.error && i.last_status === 'SUCCESS') {
      healthy++;
    }
  });
  const healthyEl = document.getElementById('healthyCount');
  healthyEl.innerText = `${healthy}/${data.instances.length} Active`;
  healthyEl.classList.remove('health-ok', 'health-warn', 'health-err');
  healthyEl.classList.add(
    data.instances.length > 0 && healthy === data.instances.length
      ? 'health-ok'
      : healthy === 0 ? 'health-err' : 'health-warn',
  );

  const grid = document.getElementById('grid');
  grid.innerHTML = '';

  data.instances.forEach(inst => {
    const isOk = !inst.error && inst.last_status === 'SUCCESS';
    const card = document.createElement('div');
    card.className = 'card';

    const historyHtml = (inst.history || []).slice(0, 10).map(h => `
      <div class="history-item">
        <span class="history-time">${formatTime(h.ping_time)}</span>
        <span class="history-status ${h.status === 'SUCCESS' ? 'ok' : 'err'}">${escapeHtml(h.status)}</span>
      </div>
    `).join('') || '<div class="history-empty">No check-in history yet</div>';

    card.innerHTML = `
      <div class="card-header">
        <div class="card-title-group">
          <div class="card-title">
            <span class="card-type-icon">${typeIcon(inst.type)}</span>
            <span>${escapeHtml(inst.name)}</span>
          </div>
          <div class="badges">
            ${inst.region ? `<span class="badge">${escapeHtml(inst.region)}</span>` : ''}
            <span class="badge">${escapeHtml(String(inst.type ?? '').toUpperCase())}</span>
          </div>
        </div>
        <div class="status-pill ${isOk ? 'success' : 'failed'}">
          <span class="dot"></span>
          <span>${isOk ? 'ACTIVE' : inst.last_status === 'EMPTY' ? 'NO RECORDS' : 'ERROR'}</span>
        </div>
      </div>

      <div class="metrics-row">
        <div>
          <div class="metric-label">Last Check-in</div>
          <div class="metric-val">${inst.history?.[0] ? formatTime(inst.history[0].ping_time) : '-'}</div>
        </div>
        <div>
          <div class="metric-label">Next Scheduled</div>
          <div class="metric-val">${inst.next_time ? formatTime(inst.next_time) : 'Calculating...'}</div>
        </div>
      </div>

      ${inst.error ? `<p class="card-error">${escapeHtml(inst.error)}</p>` : ''}
      <div class="history-title">Recent Activity</div>
      <div class="history-list">
        ${historyHtml}
      </div>
    `;
    grid.appendChild(card);
  });
}

function formatTime(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '-';
  const opts = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  try {
    return escapeHtml(d.toLocaleString([], { timeZone: timezone, ...opts }));
  } catch {
    try {
      return escapeHtml(d.toLocaleString([], { timeZone: 'UTC', ...opts }));
    } catch {
      return escapeHtml(d.toISOString());
    }
  }
}

// Initial load and periodic refresh every 60 seconds
loadData();
setInterval(() => { if (!document.hidden && !loading) void loadData(); }, 60000);
