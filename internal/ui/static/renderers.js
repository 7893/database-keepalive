const { renderRows, renderPagination } = (function createRenderers(timezone, maxPage, escapeHtml, parseBoundedInt) {
  function formatTimestamp(value) {
    if (!value) return "—";
    // Older ORDS timestamps omitted the suffix but were stored in UTC.
    const normalized = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)?$/.test(value)
      ? (value.length === 10 ? value + "T00:00:00" : value.replace(" ", "T")) + "Z" : value;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return value;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
  }

  function renderPagination(page, totalPages, totalCount) {
    if (!totalCount) return "";
    const current = parseBoundedInt(page, 1, 1, maxPage);
    const total = parseBoundedInt(totalPages, 1, 1, maxPage);
    const visible = [...new Set([1, current - 1, current, current + 1, total])]
      .filter(value => value >= 1 && value <= total)
      .sort((left, right) => left - right);

    let pages = "";
    let previous = 0;
    for (const value of visible) {
      if (previous && value - previous > 1) pages += '<span class="page-ellipsis">…</span>';
      const active = value === current ? " active" : "";
      pages += `<a href="javascript:void(0)" class="page-num${active}" data-page="${value}">${value}</a>`;
      previous = value;
    }

    const previousLink = current > 1
      ? `data-page="${current - 1}"`
      : 'tabindex="-1" aria-disabled="true"';
    const nextLink = current < total
      ? `data-page="${current + 1}"`
      : 'tabindex="-1" aria-disabled="true"';
    return `<div class="pagination">
      <div class="pagination-info">Page <span class="cur-page">${current}</span> / <span class="total-pages">${total}</span> <span class="total-count">(${totalCount} records)</span></div>
      <div class="pagination-controls">
        <a href="javascript:void(0)" class="page-btn${current > 1 ? "" : " disabled"}" ${previousLink}>Previous</a>
        <div class="page-numbers">${pages}</div>
        <a href="javascript:void(0)" class="page-btn${current < total ? "" : " disabled"}" ${nextLink}>Next</a>
      </div>
    </div>`;
  }

  function renderRows(rows = []) {
    return !rows || rows.length === 0
        ? '<li class="empty">No check-ins yet</li>'
        : rows.map(row => {
            const ok = row.status === "SUCCESS";
            return `<li class="check-in">
              <span class="status-dot ${ok ? "ok" : "fail"}" aria-hidden="true"></span>
              <span class="check-in-detail"><span class="check-in-time">${escapeHtml(formatTimestamp(row.ping_time))}</span><span class="check-in-id">Record #${escapeHtml(row.id)}</span></span>
              <span class="check-in-status ${ok ? "ok" : "fail"}">${ok ? "Success" : "Failed"}</span>
            </li>`;
          }).join("");
  }

  return { renderRows, renderPagination };
})(
  displaySettings.timezone, 10000, function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}, function parseBoundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
);

