const FETCH_TIMEOUT_MS = 15_000;
const BASE_REFRESH_MS = 60_000;
const DUE_POLL_MS = 6_000;
const DUE_WINDOW_MS = 45_000;
const POST_CHECKIN_DELAY_MS = 3_000;
const MAX_BACKOFF_MS = 120_000;
const IDLE_WARN_MS = 72 * 3_600_000;
const IDLE_STALE_MS = 120 * 3_600_000;
const MAX_HISTORY_ROWS = 10;
const ANIM_RESET_MS = 1_900;
const LIVE_NOTICE_MS = 12_000;

let timezone = 'Asia/Hong_Kong';
let loading = false;
let initialized = false;
let liveCheckinCount = 0;
let lastSyncAt = 0;
let consecutiveErrors = 0;

let refreshTimer = null;
let tickTimer = null;
let noticeTimer = null;
let activeController = null;

// Strictly bounded to fixed UI slots and currently configured database instances.
const cardMap = new Map();
const lastReceiptById = new Map();
const summaryAnimTimers = new Map();

function typeIcon(type) {
  if (type === 'supabase') return '⚡';
  if (type === 'oracle' || type === 'oracle_adb' || type === 'adb') return '🔴';
  if (type === 'mysql') return '🐬';
  return '🗄️';
}

function formatTime(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '-';
  const opts = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  try {
    return d.toLocaleString([], { timeZone: timezone, ...opts });
  } catch {
    try {
      return d.toLocaleString([], { timeZone: 'UTC', ...opts });
    } catch {
      return d.toISOString();
    }
  }
}

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(mins).padStart(2, '0')}m`;
  if (mins > 0) return `${mins}m ${String(secs).padStart(2, '0')}s`;
  return `${secs}s`;
}

function setNotice(text, isOk) {
  const notice = document.getElementById('notice');
  if (!notice) return;
  if (noticeTimer !== null) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }
  notice.textContent = text;
  notice.classList.toggle('notice-ok', Boolean(isOk));
  if (isOk && text) {
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      if (notice.classList.contains('notice-ok')) {
        notice.textContent = '';
        notice.classList.remove('notice-ok');
      }
    }, LIVE_NOTICE_MS);
  }
}

function pulseSummary(el) {
  if (!el || !el.id) return;
  const prev = summaryAnimTimers.get(el.id);
  if (prev !== undefined) clearTimeout(prev);
  el.classList.remove('num-bump');
  void el.offsetWidth;
  el.classList.add('num-bump');
  summaryAnimTimers.set(el.id, setTimeout(() => {
    summaryAnimTimers.delete(el.id);
    el.classList.remove('num-bump');
  }, ANIM_RESET_MS));
}

function createCard(id) {
  const card = document.createElement('div');
  card.className = 'card';

  const header = document.createElement('div');
  header.className = 'card-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'card-title-group';

  const title = document.createElement('div');
  title.className = 'card-title';
  const iconEl = document.createElement('span');
  iconEl.className = 'card-type-icon';
  const nameEl = document.createElement('span');
  title.append(iconEl, nameEl);

  const badges = document.createElement('div');
  badges.className = 'badges';
  const regionBadge = document.createElement('span');
  regionBadge.className = 'badge';
  const typeBadge = document.createElement('span');
  typeBadge.className = 'badge';
  badges.append(regionBadge, typeBadge);
  titleGroup.append(title, badges);

  const statusPill = document.createElement('div');
  statusPill.className = 'status-pill';
  const dot = document.createElement('span');
  dot.className = 'dot';
  const statusText = document.createElement('span');
  statusPill.append(dot, statusText);
  header.append(titleGroup, statusPill);

  const metricsRow = document.createElement('div');
  metricsRow.className = 'metrics-row';

  const lastCol = document.createElement('div');
  const lastLabel = document.createElement('div');
  lastLabel.className = 'metric-label';
  lastLabel.textContent = 'Last Check-in';
  const lastVal = document.createElement('div');
  lastVal.className = 'metric-val';
  const lastSub = document.createElement('div');
  lastSub.className = 'metric-sub';
  lastCol.append(lastLabel, lastVal, lastSub);

  const nextCol = document.createElement('div');
  const nextLabel = document.createElement('div');
  nextLabel.className = 'metric-label';
  nextLabel.textContent = 'Next Scheduled';
  const nextVal = document.createElement('div');
  nextVal.className = 'metric-val';
  const nextSub = document.createElement('div');
  nextSub.className = 'metric-sub';
  nextCol.append(nextLabel, nextVal, nextSub);
  metricsRow.append(lastCol, nextCol);

  const errorEl = document.createElement('p');
  errorEl.className = 'card-error is-hidden';

  const warningEl = document.createElement('p');
  warningEl.className = 'card-warning is-hidden';

  const historyTitle = document.createElement('div');
  historyTitle.className = 'history-title';
  historyTitle.textContent = 'Recent Activity';

  const historyList = document.createElement('div');
  historyList.className = 'history-list';
  const historyEmpty = document.createElement('div');
  historyEmpty.className = 'history-empty is-hidden';
  historyEmpty.textContent = 'No check-in history yet';
  historyList.appendChild(historyEmpty);

  const historyRows = [];
  for (let i = 0; i < MAX_HISTORY_ROWS; i++) {
    const row = document.createElement('div');
    row.className = 'history-item is-hidden';
    const timeEl = document.createElement('span');
    timeEl.className = 'history-time';
    const stEl = document.createElement('span');
    stEl.className = 'history-status';
    row.append(timeEl, stEl);
    historyList.appendChild(row);
    historyRows.push({ row, timeEl, stEl });
  }

  card.append(header, metricsRow, errorEl, warningEl, historyTitle, historyList);

  return {
    id,
    card,
    iconEl,
    nameEl,
    regionBadge,
    typeBadge,
    statusPill,
    statusText,
    lastVal,
    lastSub,
    nextVal,
    nextSub,
    errorEl,
    warningEl,
    historyEmpty,
    historyRows,
    lastPingMs: NaN,
    nextTimeMs: NaN,
    animTimer: null,
  };
}

function triggerCardHighlight(ref) {
  if (ref.animTimer !== null) {
    clearTimeout(ref.animTimer);
    ref.animTimer = null;
  }
  const topRow = ref.historyRows[0]?.row;
  ref.card.classList.remove('card-updated');
  ref.lastVal.classList.remove('num-bump');
  ref.nextVal.classList.remove('num-bump');
  if (topRow) topRow.classList.remove('history-item-new');
  void ref.card.offsetWidth;
  ref.card.classList.add('card-updated');
  ref.lastVal.classList.add('num-bump');
  ref.nextVal.classList.add('num-bump');
  if (topRow) topRow.classList.add('history-item-new');
  ref.animTimer = setTimeout(() => {
    ref.animTimer = null;
    ref.card.classList.remove('card-updated');
    ref.lastVal.classList.remove('num-bump');
    ref.nextVal.classList.remove('num-bump');
    if (topRow) topRow.classList.remove('history-item-new');
  }, ANIM_RESET_MS);
}

function evaluateHealth(inst, now) {
  if (inst.error || inst.last_status === 'FAILED') {
    return { level: 'failed', label: 'ERROR' };
  }
  if (inst.last_status === 'EMPTY') {
    return { level: 'failed', label: 'NO RECORDS' };
  }
  const latestMs = inst.history?.[0] ? Date.parse(inst.history[0].ping_time) : NaN;
  if (Number.isFinite(latestMs)) {
    const idleMs = now - latestMs;
    if (idleMs >= IDLE_STALE_MS) return { level: 'failed', label: 'STALE' };
    if (idleMs >= IDLE_WARN_MS) return { level: 'warning', label: 'IDLE' };
  }
  if (inst.schedule_issue) {
    return { level: 'warning', label: 'WARN' };
  }
  if (inst.last_status === 'SUCCESS') {
    return { level: 'success', label: 'ACTIVE' };
  }
  return { level: 'failed', label: 'ERROR' };
}

function formatIssue(issue) {
  if (!issue) return '';
  const at = formatTime(issue.at);
  if (issue.retention_error) return `Cleanup issue (${at}): ${issue.retention_error}`;
  if (issue.error) return `Schedule retry (${at}): ${issue.error}`;
  return '';
}

function updateRelativeTimes() {
  const now = Date.now();
  const lastSyncEl = document.getElementById('lastSync');
  if (lastSyncEl && lastSyncAt > 0) {
    lastSyncEl.textContent = `Updated ${formatDuration(now - lastSyncAt)} ago`;
  }
  for (const ref of cardMap.values()) {
    if (Number.isFinite(ref.lastPingMs)) {
      ref.lastSub.textContent = `${formatDuration(now - ref.lastPingMs)} ago`;
    } else {
      ref.lastSub.textContent = '';
    }
    if (Number.isFinite(ref.nextTimeMs)) {
      const diff = ref.nextTimeMs - now;
      if (diff <= 0) {
        ref.nextSub.textContent = 'Checking in...';
        ref.nextSub.classList.add('due-now');
      } else {
        ref.nextSub.textContent = `in ${formatDuration(diff)}`;
        ref.nextSub.classList.remove('due-now');
      }
    } else {
      ref.nextSub.textContent = '';
      ref.nextSub.classList.remove('due-now');
    }
  }
}

function render(data) {
  const now = Date.now();
  timezone = data.timezone || 'Asia/Hong_Kong';
  lastSyncAt = now;

  const totalEl = document.getElementById('totalInstances');
  const nextTotal = String(data.instances.length);
  if (totalEl) {
    const changed = initialized && totalEl.textContent !== nextTotal;
    totalEl.textContent = nextTotal;
    if (changed) pulseSummary(totalEl);
  }
  const tzEl = document.getElementById('tzDisplay');
  if (tzEl) tzEl.textContent = timezone === 'Asia/Hong_Kong' ? '香港时间（UTC+8）' : timezone;

  const grid = document.getElementById('grid');
  const loadingState = document.getElementById('loadingState');
  if (loadingState) loadingState.remove();

  let healthy = 0;
  let hasWarning = false;
  const seenIds = new Set();
  const newlyCheckedIn = [];

  data.instances.forEach((inst, index) => {
    seenIds.add(inst.id);
    const health = evaluateHealth(inst, now);
    if (health.level === 'success') healthy++;
    else if (health.level === 'warning') hasWarning = true;

    let ref = cardMap.get(inst.id);
    if (!ref) {
      ref = createCard(inst.id);
      cardMap.set(inst.id, ref);
    }
    if (grid.children[index] !== ref.card) {
      grid.insertBefore(ref.card, grid.children[index] ?? null);
    }

    const latest = inst.history?.[0];
    const receiptKey = latest ? `${latest.id}|${latest.ping_time}` : '';
    const prevKey = lastReceiptById.get(inst.id);
    const isNewCheckin = initialized && prevKey !== undefined && receiptKey !== '' && receiptKey !== prevKey;
    lastReceiptById.set(inst.id, receiptKey);

    ref.iconEl.textContent = typeIcon(inst.type);
    ref.nameEl.textContent = String(inst.name ?? inst.id ?? '');
    if (inst.region) {
      ref.regionBadge.textContent = String(inst.region);
      ref.regionBadge.classList.remove('is-hidden');
    } else {
      ref.regionBadge.textContent = '';
      ref.regionBadge.classList.add('is-hidden');
    }
    ref.typeBadge.textContent = String(inst.type ?? '').toUpperCase();

    ref.statusPill.className = `status-pill ${health.level}`;
    ref.statusText.textContent = health.label;

    ref.lastPingMs = latest ? Date.parse(latest.ping_time) : NaN;
    ref.nextTimeMs = inst.next_time ? Date.parse(inst.next_time) : NaN;
    ref.lastVal.textContent = latest ? formatTime(latest.ping_time) : '-';
    ref.nextVal.textContent = inst.next_time ? formatTime(inst.next_time) : 'Calculating...';

    if (inst.error) {
      ref.errorEl.textContent = String(inst.error);
      ref.errorEl.classList.remove('is-hidden');
    } else {
      ref.errorEl.textContent = '';
      ref.errorEl.classList.add('is-hidden');
    }

    const issueText = formatIssue(inst.schedule_issue);
    if (issueText) {
      ref.warningEl.textContent = issueText;
      ref.warningEl.classList.remove('is-hidden');
    } else {
      ref.warningEl.textContent = '';
      ref.warningEl.classList.add('is-hidden');
    }

    const history = Array.isArray(inst.history) ? inst.history.slice(0, MAX_HISTORY_ROWS) : [];
    ref.historyEmpty.classList.toggle('is-hidden', history.length > 0);
    for (let i = 0; i < MAX_HISTORY_ROWS; i++) {
      const slot = ref.historyRows[i];
      const item = history[i];
      if (!item) {
        slot.row.classList.add('is-hidden');
      } else {
        slot.row.classList.remove('is-hidden');
        slot.timeEl.textContent = formatTime(item.ping_time);
        slot.stEl.textContent = String(item.status ?? '');
        slot.stEl.className = `history-status ${item.status === 'SUCCESS' ? 'ok' : 'err'}`;
      }
    }

    if (isNewCheckin) {
      newlyCheckedIn.push(String(inst.name ?? inst.id));
      triggerCardHighlight(ref);
    }
  });

  // Prune any instances removed from configuration so memory never grows.
  for (const [id, ref] of cardMap.entries()) {
    if (!seenIds.has(id)) {
      if (ref.animTimer !== null) clearTimeout(ref.animTimer);
      ref.card.remove();
      cardMap.delete(id);
      lastReceiptById.delete(id);
    }
  }

  const healthyEl = document.getElementById('healthyCount');
  if (healthyEl) {
    const nextHealthText = `${healthy}/${data.instances.length} Active`;
    const changed = initialized && healthyEl.textContent !== nextHealthText;
    healthyEl.textContent = nextHealthText;
    healthyEl.classList.remove('health-ok', 'health-warn', 'health-err');
    healthyEl.classList.add(
      data.instances.length > 0 && healthy === data.instances.length && !hasWarning
        ? 'health-ok'
        : healthy === 0 && !hasWarning ? 'health-err' : 'health-warn',
    );
    if (changed) pulseSummary(healthyEl);
  }

  if (newlyCheckedIn.length > 0) {
    liveCheckinCount += newlyCheckedIn.length;
    const liveEl = document.getElementById('liveCheckins');
    if (liveEl) {
      liveEl.textContent = `+${liveCheckinCount}`;
      pulseSummary(liveEl);
    }
    setNotice(`New check-in recorded: ${newlyCheckedIn.join(', ')}`, true);
  }

  initialized = true;
  updateRelativeTimes();
}

function nextRefreshDelay() {
  if (consecutiveErrors > 0) {
    return Math.min(MAX_BACKOFF_MS, 30_000 * (2 ** Math.min(consecutiveErrors - 1, 2)));
  }
  const now = Date.now();
  let delay = BASE_REFRESH_MS;
  for (const ref of cardMap.values()) {
    if (!Number.isFinite(ref.nextTimeMs)) continue;
    const diff = ref.nextTimeMs - now;
    if (diff > 0 && diff + POST_CHECKIN_DELAY_MS < delay) {
      delay = Math.max(DUE_POLL_MS, diff + POST_CHECKIN_DELAY_MS);
    } else if (diff <= 0 && -diff < DUE_WINDOW_MS) {
      delay = Math.min(delay, DUE_POLL_MS);
    }
  }
  return delay;
}

function scheduleNextRefresh(customDelay) {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (document.hidden) return;
  const delay = typeof customDelay === 'number' ? customDelay : nextRefreshDelay();
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (!document.hidden) void loadData();
  }, delay);
}

function startTicker() {
  if (tickTimer !== null || document.hidden) return;
  tickTimer = setInterval(updateRelativeTimes, 1000);
}

function stopTimers() {
  if (refreshTimer !== null) { clearTimeout(refreshTimer); refreshTimer = null; }
  if (tickTimer !== null) { clearInterval(tickTimer); tickTimer = null; }
}

async function loadData() {
  if (loading) return;
  loading = true;
  const controller = new AbortController();
  activeController = controller;
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch('/api/status', { signal: controller.signal });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    if (!data || !Array.isArray(data.instances)) throw new Error('Status unavailable');
    consecutiveErrors = 0;
    const notice = document.getElementById('notice');
    if (notice && notice.textContent.startsWith('Unable to refresh')) setNotice('', false);
    render(data);
  } catch (err) {
    consecutiveErrors = Math.min(consecutiveErrors + 1, 6);
    const message = err && typeof err === 'object' && err.name === 'AbortError'
      ? 'Request timed out'
      : (err instanceof Error ? err.message : String(err));
    setNotice('Unable to refresh status: ' + message, false);
  } finally {
    clearTimeout(timeoutId);
    if (activeController === controller) activeController = null;
    loading = false;
    scheduleNextRefresh();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopTimers();
    return;
  }
  updateRelativeTimes();
  startTicker();
  if (!loading && Date.now() - lastSyncAt >= 15_000) {
    void loadData();
  } else {
    scheduleNextRefresh();
  }
});

window.addEventListener('online', () => {
  if (!document.hidden && !loading) void loadData();
});

window.addEventListener('pagehide', () => {
  stopTimers();
  if (noticeTimer !== null) { clearTimeout(noticeTimer); noticeTimer = null; }
  for (const timer of summaryAnimTimers.values()) clearTimeout(timer);
  summaryAnimTimers.clear();
  for (const ref of cardMap.values()) {
    if (ref.animTimer !== null) { clearTimeout(ref.animTimer); ref.animTimer = null; }
  }
  if (activeController) { activeController.abort(); activeController = null; }
});

// Initial load and managed live updates
startTicker();
void loadData();
