// The main flight-profile chart: altitude (confirmed field, left axis) over
// time, with gimbal pitch (confirmed field, right axis, PTZ file only) and
// flying/landing markers overlaid for context. Both series come straight
// out of the shared FlightData model.

import { createLineChart } from '../charts/canvas-line-chart.js';

let chart = null;

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

  if (!chart) {
    chart = createLineChart(canvas, {
      series,
      markers,
      xLabel: 'Time (s)',
      yLeftLabel: 'Altitude (m)',
      yRightLabel: 'Pitch (°)',
      colors,
      tooltip: (info) => renderTooltip(tooltipEl, info),
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
