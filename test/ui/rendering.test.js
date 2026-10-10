import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { CLIENT_SCRIPT } from '../../src/ui/client.js';
import { renderServiceTable } from '../../src/ui/cards.js';
import { renderHTML } from '../../src/ui/page.js';
const compact = html => html.replace(/>\s+</g, '><').trim();
const rows = [
  { status: 'SUCCESS', ping_time: '2026-10-10T20:59:01Z', colo: 'SIN', country: 'US', city: 'Edge', ip: '203.0.113.xxx' },
  { status: 'FAILED', ping_time: '<time>', colo: 'XYZ', country: 'XX', city: '<script>bad</script>', ip: '"<&' },
  { status: 'SUCCESS' }
];


test('browser pagination preserves server-rendered rows, locations, dates, escaping and controls', async () => {
  const elements = {
    'tbody-supabase': { classList: { add() {}, remove() {} } },
    'footer-supabase': {}, 'badge-supabase': {}
  };
  const context = {
    document: { addEventListener() {}, getElementById: id => elements[id] },
    window: { location: { search: '' } },
    fetch: async url => {
      assert.equal(url, '/api/data?service=supabase&page=5');
      return Response.json({ ok: true, rows, count: 101, page: 5, totalPages: 11 });
    },
    alert: message => assert.fail(message), console
  };
  await runInNewContext(CLIENT_SCRIPT + '\ngoToPage("supabase", 5)', context);
  const html = renderServiceTable('supabase', 'Supabase', { rows, count: 101, page: 5, totalPages: 11 });
  assert.equal(compact(elements['tbody-supabase'].innerHTML), compact(html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)[1]));
  assert.equal(compact(elements['footer-supabase'].innerHTML), compact(html.match(/id="footer-supabase">([\s\S]*)<\/div>\s*<\/div>/)[1]));
  assert.match(html, /🇸🇬 Singapore \(SIN\)/);
  assert.match(html, /10-11 04:59:01/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<\/?script\b/i);
  assert.match(html, /data-page="4"/);
  assert.match(html, /data-page="6"/);
  assert.match(html, /page-ellipsis/);
  assert.equal(elements['badge-supabase'].textContent, '101 pings');
});

test('empty rows, failed reads and first/last-page controls keep their existing display', () => {
  const browser = runInNewContext(CLIENT_SCRIPT + '\n({ renderRows, renderPagination })', {
    document: { addEventListener() {} }, window: { location: { search: '' } }
  });
  assert.match(browser.renderRows(null), /No records yet/);
  assert.equal(browser.renderPagination(1, 1, 0), '');
  const first = browser.renderPagination(1, 10, 100);
  const last = browser.renderPagination(10, 10, 100);
  assert.match(first, /class="page-btn disabled"[^>]*>上一页/);
  assert.match(last, /class="page-btn disabled"[^>]*>下一页/);
  assert.match(renderServiceTable('db2', 'Db2', { ok: false, error: 'database_error' }), /Unable to load data/);
});

test('dashboard uses Ubuntu fonts and explicit database names in the existing order', () => {
  const html = renderHTML({});
  assert.match(html, /<title>Database Keepalive<\/title>/);
  assert.match(html, /<h1>Database Keepalive<\/h1>/);
  const labels = [...html.matchAll(/class="card-title">([^<]+)<\/h2>/g)].map(match => match[1]);
  assert.deepEqual(labels, ['Supabase', 'IBM Db2', 'Oracle ADB · United States', 'MySQL · Japan', 'Oracle ADB · Japan']);
  assert.match(html, /family=Ubuntu:wght@400;500;700&family=Ubuntu\+Mono/);
  assert.match(html, /font-family: 'Ubuntu',/);
  assert.match(html, /font-family: 'Ubuntu Mono',/);
  assert.doesNotMatch(html, /OCI ·|MySQL · JP|JetBrains Mono|family=Inter/);
});
