import { RENDERING_SCRIPT } from "./renderers.js";

export const CLIENT_SCRIPT = String.raw`
${RENDERING_SCRIPT}

async function goToPage(serviceKey, targetPage) {
  const tbody = document.getElementById('tbody-' + serviceKey);
  const footer = document.getElementById('footer-' + serviceKey);
  if (!tbody || !footer) return;

  tbody.classList.add('table-loading');
  try {
    const response = await fetch('/api/data?service=' + encodeURIComponent(serviceKey) + '&page=' + targetPage);
    if (!response.ok) throw new Error('Network error');
    const data = await response.json();
    tbody.innerHTML = renderRows(data.rows);

    const badge = document.getElementById('badge-' + serviceKey);
    if (badge && data.count !== undefined) badge.textContent = data.count + ' pings';
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
    footer.innerHTML = renderPagination(data.page, data.totalPages, data.count);
  } catch (error) {
    console.error(error);
    alert('加载第 ' + targetPage + ' 页数据失败，请重试');
  } finally {
    tbody.classList.remove('table-loading');
  }
}

document.addEventListener('click', event => {
  const button = event.target.closest('.page-btn, .page-num');
  if (!button || button.classList.contains('disabled') || button.classList.contains('active')) return;
  const card = button.closest('.card');
  const targetPage = parseInt(button.getAttribute('data-page'));
  if (!card || Number.isNaN(targetPage)) return;
  event.preventDefault();
  goToPage(card.id.replace('card-', ''), targetPage);
});

if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
`;
