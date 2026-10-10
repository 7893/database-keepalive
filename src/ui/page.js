import { SITE_TITLE } from "../config/constants.js";
import { renderServiceTable } from './cards.js';
import { CLIENT_SCRIPT } from './client.js';
import { STYLES } from './styles.js';
import { DISPLAY_SERVICES, SERVICE_DEFINITIONS } from '../config/services.js';

export function renderHTML(stats) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${SITE_TITLE}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500;700&family=Ubuntu+Mono&display=swap">
<style>${STYLES}</style>
</head>
<body>
  <div class="page">
    <div class="header">
      <h1>${SITE_TITLE}</h1>
      <div class="system-status"><div class="pulse"></div>Active</div>
    </div>
    ${DISPLAY_SERVICES.map(service => renderServiceTable(service, SERVICE_DEFINITIONS[service].title, stats[service])).join('\n    ')}
  </div>
  <script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
}
