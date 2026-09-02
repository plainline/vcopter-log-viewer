// Renders the small grid of confirmed summary facts at the top of the
// Overview tab. Pure DOM rendering, no computation (that lives in model.js).

function fmt(v, digits, unit) {
  return v == null || !Number.isFinite(v) ? '–' : `${v.toFixed(digits)}${unit}`;
}

export function renderKeyFacts(container, flight) {
  const m = flight.meta;
  const g = flight.gps;
  const p = flight.pitch;

  const items = [
    ['Duration', fmt(m.durationS, 1, 's')],
    ['GPS lock at', m.firstFixT != null ? `t=${m.firstFixT.toFixed(1)}s` : '–'],
    ['Max altitude', fmt(g.maxAltitudeM, 1, ' m')],
    ['Altitude at last sample', fmt(g.lastAltitudeM, 1, ' m')],
    ['Max ground speed', fmt(g.maxSpeedMps, 1, ' m/s')],
    ['Speed at last sample', fmt(g.lastSpeedMps, 1, ' m/s')],
    ['Gimbal pitch range', p.minDeg != null ? `${p.minDeg.toFixed(0)}° to ${p.maxDeg.toFixed(0)}°` : '–'],
    ['RawData records', String(flight.counts.raw.gps + flight.counts.raw.imu43 + flight.counts.raw.unknown)],
    ['PTZ records', String(flight.counts.ptz.text + flight.counts.ptz.telemetry)],
  ];

  container.innerHTML = items
    .map(([label, value]) => `<div class="stat"><span class="stat-label">${label}</span><b>${value}</b></div>`)
    .join('');
}
