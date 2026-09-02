// Hex-dump table for record kinds with no confirmed field layout: the 43B
// RawData "IMU" records, and any rarer/uncatalogued record shapes. Nothing
// gets silently dropped here -- every distinct (tag, length) combination
// the scanner saw is listed, even ones this tool has never seen before.

const PAGE_SIZE = 25;

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

function renderPagedTable(container, records, formatRow) {
  let page = 0;
  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));

  function draw() {
    const start = page * PAGE_SIZE;
    const rows = records.slice(start, start + PAGE_SIZE).map(formatRow).join('');
    container.innerHTML = `
      <div class="table-wrap"><table class="hex-table"><tbody>${rows}</tbody></table></div>
      <div class="pager">
        <button class="pager-prev" ${page === 0 ? 'disabled' : ''}>&larr; Prev</button>
        <span>Page ${page + 1} / ${totalPages} (${records.length} records)</span>
        <button class="pager-next" ${page >= totalPages - 1 ? 'disabled' : ''}>Next &rarr;</button>
      </div>
    `;
    container.querySelector('.pager-prev')?.addEventListener('click', () => { page--; draw(); });
    container.querySelector('.pager-next')?.addEventListener('click', () => { page++; draw(); });
  }
  draw();
}

export function renderRecordInspector(root, flight) {
  const imu43 = flight.dev.rawRecords.filter((r) => r.kind === 'rawdata-imu');
  const unknown = flight.dev.unknownRecordTypes;

  const sections = [];

  sections.push(`<h3>RawData 43B "IMU/motor" records — fields not yet identified</h3>`);
  sections.push(`<p class="muted">${imu43.length} records. Raw bytes shown as hex; use the Offset Explorer above to plot any offset here.</p>`);
  sections.push(`<div class="imu43-table"></div>`);

  if (unknown.length) {
    sections.push(`<h3>Uncatalogued record types</h3>`);
    sections.push(`<p class="muted">Byte patterns at offset 8-9 that don't match any known tag. Shown here instead of being discarded, in case they turn out to matter.</p>`);
    for (const u of unknown) {
      sections.push(`<h4>tag ${u.tagHex} · ${u.length}B · ${u.count}×</h4><div class="unknown-table" data-key="${u.tagHex}-${u.length}"></div>`);
    }
  }

  root.innerHTML = sections.join('\n');

  renderPagedTable(root.querySelector('.imu43-table'), imu43, (rec) => `
    <tr><td class="mono">t=${rec.t != null ? rec.t.toFixed(2) + 's' : '–'}</td><td class="mono hex-cell">${toHex(rec.bytes)}</td></tr>
  `);

  for (const u of unknown) {
    const el = root.querySelector(`.unknown-table[data-key="${u.tagHex}-${u.length}"]`);
    renderPagedTable(el, u.samples, (rec) => `
      <tr><td class="mono">t=${rec.t != null ? rec.t.toFixed(2) + 's' : '–'}</td><td class="mono hex-cell">${toHex(rec.bytes)}</td></tr>
    `);
  }
}
