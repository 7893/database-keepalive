import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export function nativeDriver(env, fatal) {
  const child = spawn(env.DB2_PYTHON || '/opt/venv/bin/python', ['-B', 'service/native.py'], {
    env, stdio: ['pipe', 'pipe', 'pipe']
  });
  const pending = new Map();
  let next = 0;
  child.stderr.resume(); // Never forward driver messages containing connection details.
  child.on('error', fatal);
  child.on('exit', fatal);
  child.stdin.on('error', fatal);
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      const { id, result } = JSON.parse(line);
      const entry = pending.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.resolve(result);
    } catch { fatal(); }
  });
  return {
    call(data) {
      if (pending.size >= 8) return Promise.resolve({ ok: false, error: 'busy' });
      return new Promise(resolve => {
        const id = ++next;
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, error: 'database_timeout' });
          fatal();
        }, 120_000);
        pending.set(id, { resolve, timer });
        child.stdin.write(JSON.stringify({ ...data, id }) + '\n');
      });
    },
    stop() { child.kill(); }
  };
}
