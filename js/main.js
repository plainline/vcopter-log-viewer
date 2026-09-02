import { pairFiles } from './parser/file-pairing.js';
import { buildFlightData } from './parser/model.js';
import { renderMap } from './overview/map-view.js';
import { renderAltitudeChart } from './overview/altitude-chart.js';
import { renderKeyFacts } from './overview/key-facts.js';
import { renderTranscript } from './overview/transcript-view.js';
import { assessLanding } from './overview/verdict.js';
import { initOffsetExplorer } from './developer/offset-explorer.js';
import { renderRecordInspector } from './developer/record-inspector.js';

const els = {
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('file-input'),
  uploadStatus: document.getElementById('upload-status'),
  app: document.getElementById('app'),
  errorState: document.getElementById('error-state'),
  tabButtons: document.querySelectorAll('.tab-button'),
  tabPanels: document.querySelectorAll('.tab-panel'),
  transcriptSearch: document.getElementById('transcript-search'),
};

let currentFlight = null;
let devInitialized = false;
let overviewRendered = false;

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name) => cs.getPropertyValue(name).trim();
  return {
    border: get('--border'),
    textDim: get('--text-dim'),
    text: get('--text'),
    accent: get('--accent'),
    accent2: get('--accent-2'),
    good: get('--good'),
    bad: get('--bad'),
  };
}

async function readFileAsBytes(file) {
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

async function handleFiles(fileList) {
  const files = Array.from(fileList).slice(0, 2);
  if (files.length === 0) return;

  setUploadStatus('Reading files…');
  const entries = [];
  for (const f of files) {
    entries.push({ name: f.name, bytes: await readFileAsBytes(f) });
  }

  const paired = pairFiles(entries);
  if (!paired.ptz && !paired.rawdata) {
    showError("These files don't look like VCopter .logbin files — no recognizable records were found in either one.");
    return;
  }

  const statusParts = [];
  if (paired.ptz) statusParts.push(`PTZ: <b>${paired.ptz.name}</b>`);
  if (paired.rawdata) statusParts.push(`RawData: <b>${paired.rawdata.name}</b>`);
  if (!paired.ptz) statusParts.push('<span class="muted">No PTZ file — gimbal pitch and transcript will be unavailable.</span>');
  if (!paired.rawdata) statusParts.push('<span class="muted">No RawData file — map, altitude and speed will be unavailable.</span>');
  if (paired.unrecognized.length) {
    statusParts.push(`<span class="muted">Ignored (not recognized or duplicate): ${paired.unrecognized.map((f) => f.name).join(', ')}</span>`);
  }
  setUploadStatus(statusParts.join(' · '));

  try {
    currentFlight = buildFlightData(paired.ptz, paired.rawdata);
  } catch (err) {
    console.error(err);
    showError('Something went wrong while parsing these files. See the browser console for details.');
    return;
  }

  els.errorState.hidden = true;
  els.app.hidden = false;
  devInitialized = false;

  // Render only whichever tab is actually visible right now, and remember
  // that the other one is stale. Leaflet (and, to a lesser extent, the
  // canvas charts) can't correctly size/fit themselves against a
  // display:none container, so rendering a hidden tab's contents up front
  // silently produces a blank map -- rendering lazily on tab-switch instead
  // guarantees the container has real dimensions when it matters.
  overviewRendered = false;
  const activeTab = document.querySelector('.tab-button.active')?.dataset.tab;
  if (activeTab === 'developer') {
    renderDeveloper();
  } else {
    renderOverview();
  }
}

function setUploadStatus(html) {
  els.uploadStatus.innerHTML = html;
}

function showError(message) {
  els.errorState.hidden = false;
  els.errorState.textContent = message;
  els.app.hidden = true;
}

function renderOverview() {
  if (overviewRendered || !currentFlight) return;
  const colors = readColors();
  renderKeyFacts(document.getElementById('key-facts'), currentFlight);

  const verdict = assessLanding(currentFlight);
  const verdictEl = document.getElementById('verdict');
  verdictEl.className = `verdict verdict-${verdict.verdict}`;
  const verdictLabel = { landed: 'Landed', 'lost-link': 'Likely lost link mid-flight', unknown: 'Inconclusive' }[verdict.verdict];
  verdictEl.innerHTML = `
    <div class="verdict-label">${verdictLabel}</div>
    <ul class="verdict-reasons">${verdict.reasons.map((r) => `<li>${r}</li>`).join('')}</ul>
  `;

  // renderMap() itself handles the "no fixes" case (shows an empty world
  // view) -- always going through it, rather than swapping in a message div
  // when empty, keeps the one Leaflet instance's DOM references intact
  // across flights that do/don't have GPS data.
  renderMap(document.getElementById('map'), currentFlight.gps.valid);

  renderAltitudeChart(document.getElementById('altitude-canvas'), currentFlight, colors);
  renderTranscript(document.getElementById('transcript'), els.transcriptSearch, currentFlight);
  overviewRendered = true;
}

function renderDeveloper() {
  if (devInitialized || !currentFlight) return;
  const colors = readColors();
  initOffsetExplorer(document.getElementById('offset-explorer'), currentFlight, colors);
  renderRecordInspector(document.getElementById('record-inspector'), currentFlight);
  devInitialized = true;
}

// --- upload wiring ---
els.dropzone.addEventListener('click', () => els.fileInput.click());
els.dropzone.addEventListener('dragover', (e) => { e.preventDefault(); els.dropzone.classList.add('drag'); });
els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('drag'));
els.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  els.dropzone.classList.remove('drag');
  handleFiles(e.dataTransfer.files);
});
els.fileInput.addEventListener('change', () => handleFiles(els.fileInput.files));

// --- tabs ---
els.tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    els.tabButtons.forEach((b) => b.classList.toggle('active', b === btn));
    els.tabPanels.forEach((p) => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
    if (btn.dataset.tab === 'developer') renderDeveloper();
    if (btn.dataset.tab === 'overview') renderOverview();
  });
});

// --- donation address copy button ---
const btcCopyBtn = document.getElementById('btc-copy');
if (btcCopyBtn) {
  btcCopyBtn.addEventListener('click', async () => {
    const address = document.getElementById('btc-address').textContent.trim();
    try {
      await navigator.clipboard.writeText(address);
      btcCopyBtn.textContent = 'Copied!';
    } catch {
      btcCopyBtn.textContent = 'Copy failed';
    }
    setTimeout(() => { btcCopyBtn.textContent = 'Copy'; }, 1500);
  });
}
