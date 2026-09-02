// Generalized "pick any record type / numeric type / byte offset / divisor
// and plot it against time" tool -- the same idea as the throwaway
// prototype this project grew out of, now working on whatever the visitor
// uploads instead of one hardcoded flight. This is the mechanism by which
// more of the format can get reverse-engineered over time: most fields are
// still unidentified (see README.md), and this view exists so anyone can
// go looking.

import { makeReader, readNumeric, typeSize, NUMERIC_TYPES } from '../parser/binary-reader.js';
import { createLineChart } from '../charts/canvas-line-chart.js';

const BASE_HEADER_LEN = 8;

// Format-confirmed fields, offered as one-click presets. Deliberately only
// format-level facts here -- no numbers tied to any specific real flight.
const PRESETS = [
  { label: 'RawData GPS: longitude (off 22, i32, ÷1e7)', source: 'raw', kind: 'rawdata-gps', type: 'i32', offset: 22, divisor: 1e7, confirmed: true },
  { label: 'RawData GPS: latitude (off 26, i32, ÷1e7)', source: 'raw', kind: 'rawdata-gps', type: 'i32', offset: 26, divisor: 1e7, confirmed: true },
  { label: 'RawData GPS: altitude (off 34, i16, ÷10)', source: 'raw', kind: 'rawdata-gps', type: 'i16', offset: 34, divisor: 10, confirmed: true },
  { label: 'RawData GPS: elapsed time (off 106, f32)', source: 'raw', kind: 'rawdata-gps', type: 'f32', offset: 106, divisor: 1, confirmed: true },
  { label: 'PTZ telemetry (224B): gimbal pitch (off 157, f32)', source: 'ptz', kind: 224, type: 'f32', offset: 157, divisor: 1, confirmed: true },
];

function groupRecords(records, sourceLabel) {
  const groups = new Map(); // key -> {key, source, kind, length, label, records}
  for (const rec of records) {
    const key = `${sourceLabel}/${rec.kind}/${rec.length}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, source: sourceLabel, kind: rec.kind, length: rec.length, records: [] };
      groups.set(key, g);
    }
    g.records.push(rec);
  }
  return [...groups.values()].sort((a, b) => b.records.length - a.records.length);
}

function groupLabel(g) {
  const kindLabel = typeof g.kind === 'string' ? g.kind : `len-${g.kind}`;
  return `${g.source} · ${kindLabel} · ${g.length}B (${g.records.length}×)`;
}

export function initOffsetExplorer(root, flight, colors) {
  const rawGroups = groupRecords(flight.dev.rawRecords, 'raw');
  const ptzGroups = groupRecords(flight.dev.ptzRecords, 'ptz');
  const allGroups = [...rawGroups, ...ptzGroups];

  root.innerHTML = `
    <div class="panel">
      <div class="row">
        <div class="field">
          <label>Record group</label>
          <select class="dev-group"></select>
        </div>
        <div class="field">
          <label>Numeric type</label>
          <div class="segmented dev-type">
            ${NUMERIC_TYPES.map((t) => `<button data-val="${t}">${t}</button>`).join('')}
          </div>
        </div>
        <div class="field">
          <label>Byte offset</label>
          <div class="offset-input">
            <input type="range" class="dev-offset-slider" min="8" max="8" step="1" value="8">
            <input type="number" class="dev-offset-num" min="8" max="8" step="1" value="8">
          </div>
        </div>
        <div class="field">
          <label>Divisor</label>
          <input type="number" class="dev-divisor" value="1" step="any" style="width:90px">
        </div>
      </div>
      <div class="field">
        <label>Format-confirmed fields</label>
        <div class="chips dev-presets"></div>
      </div>
      <div class="readout dev-readout"></div>
    </div>
    <div class="chart-card">
      <div class="chart-wrap">
        <canvas class="dev-canvas"></canvas>
        <div class="chart-tooltip"></div>
      </div>
    </div>
    <div class="dev-unknown"></div>
  `;

  const groupSel = root.querySelector('.dev-group');
  const typeSeg = root.querySelector('.dev-type');
  const offsetSlider = root.querySelector('.dev-offset-slider');
  const offsetNum = root.querySelector('.dev-offset-num');
  const divisorInput = root.querySelector('.dev-divisor');
  const presetsEl = root.querySelector('.dev-presets');
  const readoutEl = root.querySelector('.dev-readout');
  const canvas = root.querySelector('.dev-canvas');

  groupSel.innerHTML = allGroups.map((g) => `<option value="${g.key}">${groupLabel(g)}</option>`).join('');

  const state = { groupKey: allGroups[0] ? allGroups[0].key : null, type: 'i16', offset: 8, divisor: 100 };

  let chart = createLineChart(canvas, {
    series: [],
    colors,
    tooltip: (info) => {
      const el = root.querySelector('.chart-tooltip');
      if (!info) { el.classList.remove('show'); return; }
      const v = info.seriesValues[0];
      el.innerHTML = v && Number.isFinite(v.value) ? `t=${info.x.toFixed(2)}s &nbsp; value=<b>${v.value.toFixed(3)}</b>` : `t=${info.x.toFixed(2)}s`;
      el.classList.add('show');
    },
  });

  function currentGroup() {
    return allGroups.find((g) => g.key === state.groupKey) || null;
  }

  function syncOffsetBounds() {
    const g = currentGroup();
    const maxOff = g ? g.length - typeSize(state.type) : BASE_HEADER_LEN;
    offsetSlider.min = BASE_HEADER_LEN; offsetSlider.max = Math.max(maxOff, BASE_HEADER_LEN);
    offsetNum.min = BASE_HEADER_LEN; offsetNum.max = Math.max(maxOff, BASE_HEADER_LEN);
    if (state.offset > maxOff) state.offset = Math.max(maxOff, BASE_HEADER_LEN);
    if (state.offset < BASE_HEADER_LEN) state.offset = BASE_HEADER_LEN;
    offsetSlider.value = state.offset; offsetNum.value = state.offset;
  }

  function render() {
    const g = currentGroup();
    syncOffsetBounds();
    typeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.val === state.type));

    if (!g) { chart.setSeries([]); return; }
    const size = typeSize(state.type);
    const points = [];
    let min = Infinity, max = -Infinity;
    for (const rec of g.records) {
      const r = makeReader(rec.bytes);
      const raw = readNumeric(r, state.type, state.offset);
      if (raw == null) continue;
      const v = raw / (state.divisor || 1);
      const t = g.source === 'raw' ? rec.t : rec.approxT;
      if (t == null) continue;
      points.push({ x: t, y: v });
      if (v < min) min = v; if (v > max) max = v;
    }
    points.sort((a, b) => a.x - b.x);
    chart.setSeries([{ label: `off ${state.offset} (${state.type}, ÷${state.divisor})`, color: colors.accent, points }]);

    readoutEl.innerHTML = `
      <span>min <b>${Number.isFinite(min) ? min.toFixed(3) : '–'}</b></span>
      <span>max <b>${Number.isFinite(max) ? max.toFixed(3) : '–'}</b></span>
      <span>records <b>${g.records.length}</b></span>
      <span>record length <b>${g.length}B</b></span>
      ${g.source === 'ptz' ? '<span class="muted">time is approximate (~t) for PTZ records — see README</span>' : ''}
    `;
  }

  groupSel.addEventListener('change', () => { state.groupKey = groupSel.value; render(); });
  typeSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.type = b.dataset.val; render();
  });
  offsetSlider.addEventListener('input', () => { state.offset = Number(offsetSlider.value); offsetNum.value = state.offset; render(); });
  offsetNum.addEventListener('change', () => { state.offset = Number(offsetNum.value); offsetSlider.value = state.offset; render(); });
  divisorInput.addEventListener('change', () => { state.divisor = Number(divisorInput.value) || 1; render(); });

  presetsEl.innerHTML = PRESETS.map((p, i) => `<button class="chip" data-i="${i}">${p.label}</button>`).join('');
  presetsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const p = PRESETS[Number(b.dataset.i)];
    const g = allGroups.find((gr) => gr.source === p.source && gr.kind === p.kind);
    if (!g) return;
    state.groupKey = g.key; state.type = p.type; state.offset = p.offset; state.divisor = p.divisor;
    groupSel.value = g.key; divisorInput.value = p.divisor;
    render();
  });

  render();
  return { rerender: render };
}
