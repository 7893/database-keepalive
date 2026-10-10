async function goToPage(serviceKey, targetPage, quiet = false) {
  const tbody = document.getElementById('tbody-' + serviceKey);
  const footer = document.getElementById('footer-' + serviceKey);
  if (!tbody || !footer) return;

  if (tbody.classList.contains('table-loading')) return;
  tbody.classList.add('table-loading');
  try {
    const response = await fetch('/api/data?service=' + encodeURIComponent(serviceKey) + '&page=' + targetPage);
    if (!response.ok) throw new Error('Network error');
    const data = await response.json();
    tbody.innerHTML = renderRows(data.rows);

    const badge = document.getElementById('badge-' + serviceKey);
    if (badge && data.count !== undefined) badge.textContent = data.count + ' records';
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
    footer.innerHTML = renderPagination(data.page, data.totalPages, data.count);
  } catch (error) {
    console.error(error);
    if (!quiet) alert('Unable to load page ' + targetPage + '. Please try again.');
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

if (displaySettings.refresh_seconds > 0) {
  setInterval(() => {
    if (document.hidden) return;
    for (const card of document.querySelectorAll('.card')) {
      const page = Number(card.querySelector('.cur-page')?.textContent || 1);
      goToPage(card.id.slice(5), page, true);
    }
  }, displaySettings.refresh_seconds * 1000);
}
