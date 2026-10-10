import { REQUEST_TIMEOUT_MS } from '../config/constants.js';

export async function fetchWithTimeout(input, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("upstream_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function publicErrorCode(error) {
  return error?.message === "upstream_timeout" ? "upstream_timeout" : "upstream_error";
}

export function logError(event, details = {}) {
  console.error(JSON.stringify({ level: "error", event, ...details }));
}
