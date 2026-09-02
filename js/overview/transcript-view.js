// Renders the reconstructed gimbal UART debug transcript with a search box
// and the flying/landing status markers highlighted.

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function highlight(text, query) {
  let html = escapeHtml(text);
  html = html.replace(/^(flying|landing)$/gm, '<mark class="status-marker $1">$1</mark>');
  if (query) {
    const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(`(${esc})`, 'gi'), '<mark class="search-hit">$1</mark>');
  }
  return html;
}

export function renderTranscript(container, searchInput, flight) {
  const pre = container.querySelector('.transcript-body') || (() => {
    const el = document.createElement('pre');
    el.className = 'transcript-body';
    container.appendChild(el);
    return el;
  })();

  function update() {
    const q = searchInput ? searchInput.value.trim() : '';
    if (!flight.transcript) {
      pre.innerHTML = '<span class="muted">No PTZ file uploaded, or no readable debug text found in it.</span>';
      return;
    }
    pre.innerHTML = highlight(flight.transcript, q);
  }

  if (searchInput) searchInput.addEventListener('input', update);
  update();
}
