// The main flight-profile chart: altitude (confirmed field, left axis) over
// time, with gimbal pitch (confirmed field, right axis, PTZ file only) and
// flying/landing markers overlaid for context. Both series come straight
// out of the shared FlightData model.

import { createLineChart } from '../charts/canvas-line-chart.js';
import { highlightMapPoint, clearMapHighlight } from './map-view.js';

let chart = null;

// flight.gps.valid is sorted by t (see model.js) and holds real lat/lon --
// unlike flight.gps.all, which still includes the (0,0)/cold-start noise
// that's plotted on the altitude axis but would be a useless map highlight.
function nearestValidGpsPoint(gpsValid, t) {
  if (!gpsValid.length) return null;
  let lo = 0, hi = gpsValid.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (gpsValid[mid].t < t) lo = mid + 1; else hi = mid;
  }
  if (lo > 0 && Math.abs(gpsValid[lo - 1].t - t) < Math.abs(gpsValid[lo].t - t)) return gpsValid[lo - 1];
  return gpsValid[lo];
}

export function renderAltitudeChart(canvas, flight, colors) {
  const altSeries = {
    label: 'Altitude (m)',
    color: colors.accent,
    axis: 'left',
    points: flight.gps.all.map((p) => ({ x: p.t, y: p.altM })),
  };
  const pitchSeries = {
    label: 'Gimbal pitch (° , ~t estimated)',
    color: colors.accent2,
    axis: 'right',
    dash: [4, 3],
    width: 1.2,
    points: flight.pitch.points
      .filter((p) => p.approxT != null)
      .sort((a, b) => a.approxT - b.approxT)
      .map((p) => ({ x: p.approxT, y: p.pitchDeg })),
  };

  const markers = flight.flyStatusEvents
    .filter((e) => e.approxT != null)
    .map((e) => ({
      x: e.approxT,
      color: e.type === 'landing' ? colors.good : colors.textDim,
      label: e.type,
    }));

  const series = [altSeries];
  if (pitchSeries.points.length) series.push(pitchSeries);

  const tooltipEl = canvas.parentElement.querySelector('.chart-tooltip');
  const gpsValid = flight.gps.valid;

  function onHover(info) {
    renderTooltip(tooltipEl, info);
    if (!info) { clearMapHighlight(); return; }
    const nearest = nearestValidGpsPoint(gpsValid, info.x);
    // Don't highlight a GPS fix that's many seconds away from the hovered
    // time -- e.g. hovering the pre-liftoff/no-fix part of the altitude
    // trace shouldn't light up an unrelated point on the map.
    if (nearest && Math.abs(nearest.t - info.x) < 3) {
      highlightMapPoint(nearest.lat, nearest.lon);
    } else {
      clearMapHighlight();
    }
  }

  if (!chart) {
    chart = createLineChart(canvas, {
      series,
      markers,
      xLabel: 'Time (s)',
      yLeftLabel: 'Altitude (m)',
      yRightLabel: 'Pitch (°)',
      colors,
      tooltip: onHover,
    });
  } else {
    chart.setSeries(series, markers);
  }
  return chart;
}

function renderTooltip(el, info) {
  if (!el) return;
  if (!info) { el.classList.remove('show'); return; }
  const parts = info.seriesValues
    .filter((s) => Number.isFinite(s.value))
    .map((s) => `<span style="color:${s.color}">${s.label.split(' (')[0]}: <b>${s.value.toFixed(1)}</b></span>`);
  el.innerHTML = `t=${info.x.toFixed(1)}s &nbsp; ${parts.join(' &nbsp; ')}`;
  el.classList.add('show');
}
