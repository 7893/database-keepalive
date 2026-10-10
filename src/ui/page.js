import { renderServiceTable } from "./components.js";
import { CLIENT_SCRIPT } from "./client-script.js";
import { STYLES } from "./styles.js";

export function renderHTML(stats) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Keepalive Status</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap">
<style>${STYLES}</style>
</head>
<body>
  <div class="page">
    <div class="header">
      <h1>Keepalive Metrics</h1>
      <div class="system-status"><div class="pulse"></div>Active</div>
    </div>
    ${renderServiceTable("supabase", "Supabase", stats.supabase)}
    ${renderServiceTable("db2", "IBM · Db2", stats.db2)}
    ${renderServiceTable("adb_us", "OCI · US", stats.adb_us)}
    ${renderServiceTable("mysql_jp", "MySQL · JP", stats.mysql_jp)}
    ${renderServiceTable("adb_jp", "OCI · JP", stats.adb_jp)}
  </div>
  <script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
}
