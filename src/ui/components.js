import { escapeHtml } from "../http.js";
import { renderRows, renderPagination } from "./renderers.js";

export function renderServiceTable(serviceKey, title, data) {
  const count = data?.count ?? 0;
  const rows = data?.rows || [];
  const page = data?.page ?? 1;
  const totalPages = data?.totalPages ?? 1;
  const body = data?.ok === false
    ? `<tr><td colspan="4" class="empty">Unable to load data (${escapeHtml(data.error || "upstream_error")})</td></tr>`
    : renderRows(rows);

  return `<div class="card" id="card-${escapeHtml(serviceKey)}">
    <div class="card-head">
      <h2 class="card-title">${escapeHtml(title)}</h2>
      <span class="card-badge" id="badge-${escapeHtml(serviceKey)}">${escapeHtml(count)} pings</span>
    </div>
    <div class="table-container"><table>
      <thead><tr><th class="col-time">Timestamp (HKT)</th><th class="col-status">Status</th><th class="col-loc">Location</th><th class="col-ip">IP Address</th></tr></thead>
      <tbody id="tbody-${escapeHtml(serviceKey)}">${body}</tbody>
    </table></div>
    <div class="card-footer" id="footer-${escapeHtml(serviceKey)}">${renderPagination(page, totalPages, count)}</div>
  </div>`;
}
