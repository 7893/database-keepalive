export function publicIp(ip, showFullIp = false) {
  if (!ip) return "—";
  if (showFullIp) return String(ip);

  const value = String(ip);
  const ipv4 = value.split(".");
  if (ipv4.length === 4 && ipv4.every(part => /^\d{1,3}$/.test(part))) {
    return `${ipv4[0]}.${ipv4[1]}.${ipv4[2]}.xxx`;
  }
  if (value.includes(":")) {
    const prefix = value.split(":").filter(Boolean).slice(0, 3).join(":");
    return prefix ? `${prefix}::` : "IPv6";
  }
  return "—";
}

export function publicQueryResult(result, showFullIp = false) {
  return {
    ...result,
    rows: (result?.rows || []).map(row => ({ ...row, ip: publicIp(row.ip, showFullIp) }))
  };
}

export function publicStats(stats, showFullIp = false) {
  return Object.fromEntries(
    Object.entries(stats).map(([service, result]) => [service, publicQueryResult(result, showFullIp)])
  );
}
