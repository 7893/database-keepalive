import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { nativeDriver } from './native.mjs';
import { makeBackends } from '../src/service-registry.js';
import { handle } from './handler.mjs';
import { runtimeConfig, tunnelAddress } from './config.mjs';

const env = runtimeConfig(process.env);
writeFileSync(env.MYSQL_SSL_CA, env.MYSQL_CA_PEM, { mode: 0o600 });
let stopping = false;
function fatal() {
  if (stopping) return;
  stopping = true;
  console.error('{"event":"native_process_stopped"}');
  process.exit(1);
}
const tunnel = spawn('cloudflared', ['access', 'tcp', '--hostname', env.TUNNEL_SERVICE_HOSTNAME, '--url', tunnelAddress(env)], {
  env, stdio: 'ignore'
});
tunnel.on('error', fatal);
tunnel.on('exit', fatal);
const native = nativeDriver(env, fatal);
env.backends = makeBackends(env, native);
let active = 0;
const server = createServer(async (req, res) => {
  if (active >= 16) { res.writeHead(503, { 'retry-after': '5' }); res.end(); return; }
  active++;
  try {
    const url = new URL(req.url, env.PUBLIC_ORIGIN);
    // Existing routes use query parameters only; reject bodies rather than buffer them.
    req.resume();
    const request = new Request(url, { method: req.method, headers: req.headers });
    const response = await handle(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end('{"error":"internal_error"}');
  } finally { active--; }
});
server.requestTimeout = 240_000;
server.listen(Number(env.PORT || 8080), '0.0.0.0', () => console.log('{"event":"service_ready"}'));
process.on('SIGTERM', () => {
  stopping = true;
  server.close(() => { native.stop(); tunnel.kill(); process.exit(0); });
  setTimeout(() => process.exit(0), 8000).unref();
});
