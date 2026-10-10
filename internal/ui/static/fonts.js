const displaySettings = JSON.parse(document.getElementById('display-settings').textContent);
const genericFonts = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'cursive', 'fantasy',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']);
const fontRequests = new Map();

function loadOnlineFont(family) {
  if (fontRequests.has(family)) return fontRequests.get(family);
  const request = new Promise(resolve => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    const weights = family === 'Ubuntu' ? ':wght@400;500;700' : '';
    link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family + weights) + '&display=swap';
    let settled = false;
    const finish = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!ok) link.remove();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 5000);
    link.onerror = () => finish(false);
    link.onload = async () => {
      try {
        // CSS loading alone cannot detect an unavailable font file.
        const faces = await document.fonts.load('400 14px "' + family + '"');
        finish(faces.length > 0);
      } catch { finish(false); }
    };
    document.head.appendChild(link);
  });
  fontRequests.set(family, request);
  return request;
}

async function loadFontStack(families) {
  for (const family of families) {
    if (genericFonts.has(family) || await loadOnlineFont(family)) return;
  }
}
loadFontStack(displaySettings.fonts);
loadFontStack(displaySettings.mono_fonts);
