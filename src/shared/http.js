import { REQUEST_TIMEOUT_MS } from '../config/constants.js';

export async function fetchWithTimeout(input, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('upstream_timeout'));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await fetch(input, { ...init, signal: controller.signal });
      // Buffer our small API responses while the same deadline is still active.
      const body = await response.arrayBuffer();
      return new Response([204, 205, 304].includes(response.status) ? null : body, {
        status: response.status, statusText: response.statusText, headers: response.headers
      });
    })()]);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('upstream_timeout');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function publicErrorCode(error) {
  return error?.message === "upstream_timeout" ? "upstream_timeout" : "upstream_error";
}

export function logError(event, details = {}) {
  console.error(JSON.stringify({ level: "error", event, ...details }));
}
