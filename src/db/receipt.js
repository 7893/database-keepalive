export const GEO_FIELDS = ['colo', 'country', 'city', 'region', 'ip'];

export function confirmedRow(rows, requestId, geo) {
  return Array.isArray(rows) && rows.length === 1
    && rows[0].request_id === requestId && rows[0].status === 'SUCCESS'
    && GEO_FIELDS.every(field => (rows[0][field] ?? '') === (geo[field] ?? ''));
}
