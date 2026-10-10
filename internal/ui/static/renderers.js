const { renderRows, renderPagination } = (function createRenderers(pops, maxPage, escapeHtml, parseBoundedInt) {
  function countryFlag(code) {
    if (!code || code.length !== 2) return "🌐";
    const offset = 127397;
    return String.fromCodePoint(...code.toUpperCase().split("").map(char => char.charCodeAt(0) + offset));
  }

  function formatLocation(row) {
    if (!row?.colo && !row?.country) return "—";
    let country = row.country;
    let city = row.city;
    const pop = pops[row.colo];
    if (pop && (city === "Edge" || !city || country === "XX" || (row.colo === "SIN" && country === "US"))) {
      city = pop.city;
      country = pop.country;
    }
    return `${countryFlag(country)} ${city || country || ""}${row.colo ? ` (${row.colo})` : ""}`;
  }

  function toHKT(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const hkt = new Date(date.getTime() + 8 * 3600000);
    const pad = number => String(number).padStart(2, "0");
    return `${pad(hkt.getUTCMonth() + 1)}-${pad(hkt.getUTCDate())} ${pad(hkt.getUTCHours())}:${pad(hkt.getUTCMinutes())}:${pad(hkt.getUTCSeconds())}`;
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
      <div class="pagination-info">第 <span class="cur-page">${current}</span> / <span class="total-pages">${total}</span> 页 <span class="total-count">（共 ${totalCount} 条）</span></div>
      <div class="pagination-controls">
        <a href="javascript:void(0)" class="page-btn${current > 1 ? "" : " disabled"}" ${previousLink}>上一页</a>
        <div class="page-numbers">${pages}</div>
        <a href="javascript:void(0)" class="page-btn${current < total ? "" : " disabled"}" ${nextLink}>下一页</a>
      </div>
    </div>`;
  }

  function renderRows(rows = []) {
    return !rows || rows.length === 0
        ? '<tr><td colspan="4" class="empty">No records yet</td></tr>'
        : rows.map(row => {
            const ok = row.status === "SUCCESS";
            return `<tr>
              <td class="col-time">${escapeHtml(toHKT(row.ping_time))}</td>
              <td class="col-status"><div class="status-badge"><span class="status-dot ${ok ? "ok" : "fail"}"></span><span class="status-text">${ok ? "Success" : "Failed"}</span></div></td>
              <td class="col-loc">${escapeHtml(formatLocation(row))}</td>
              <td class="col-ip"><code>${escapeHtml(row.ip || "—")}</code></td>
            </tr>`;
          }).join("");
  }

  return { renderRows, renderPagination };
})(
  JSON.parse(document.getElementById('geo-locations').textContent), 10000, function escapeHtml(value) {
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

