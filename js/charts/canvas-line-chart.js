// Small, dependency-free line chart on a <canvas>. Built from scratch on
// purpose: an earlier prototype used Chart.js from a public CDN and it
// silently failed to render for a user whose corporate network blocks that
// CDN -- the chart area just stayed blank with no visible error. Since this
// tool has no backend and no bundler, every runtime script dependency is a
// deployment risk; this chart (and the rest of the app) has none.
//
// Supports: one or two series (independent left/right Y axes), a hover
// crosshair with a tooltip callback, optional vertical event markers, and
// resize handling. Deliberately unopinionated about theme -- callers pass
// resolved color strings so it stays in sync with the page's CSS custom
// properties (light/dark) without this module reading the DOM itself.

export function createLineChart(canvas, opts) {
  const state = {
    series: opts.series || [], // [{label, color, dash:[..]?, points:[{x,y}], axis:'left'|'right'}]
    markers: opts.markers || [], // [{x, color, label?}]
    xLabel: opts.xLabel || '',
    yLeftLabel: opts.yLeftLabel || '',
    yRightLabel: opts.yRightLabel || '',
    colors: Object.assign({ border: '#333', textDim: '#888', text: '#eee' }, opts.colors || {}),
    formatX: opts.formatX || ((v) => v.toFixed(1)),
    formatY: opts.formatY || defaultFormatNum,
    tooltip: opts.tooltip || null, // (el, {x, seriesValues:[{label,color,value}]}) => void, called on hover
  };

  let hoverPx = null;
  let geom = null;
  let ro = null;

  function niceStep(range, targetSteps) {
    if (!(range > 0)) return 1;
    const raw = range / targetSteps;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let step;
    if (norm < 1.5) step = 1;
    else if (norm < 3) step = 2;
    else if (norm < 7) step = 5;
    else step = 10;
    return step * mag;
  }

  function axisSeries(axis) {
    return state.series.filter((s) => (s.axis || 'left') === axis && s.points && s.points.length);
  }

  function extent(seriesList) {
    let lo = Infinity, hi = -Infinity;
    for (const s of seriesList) {
      for (const p of s.points) {
        if (!Number.isFinite(p.y)) continue;
        if (p.y < lo) lo = p.y;
        if (p.y > hi) hi = p.y;
      }
    }
    if (!Number.isFinite(lo)) return [0, 1];
    if (lo === hi) return [lo - 1, hi + 1];
    const pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
  }

  function xExtent() {
    let lo = Infinity, hi = -Infinity;
    for (const s of state.series) {
      for (const p of s.points) {
        if (p.x < lo) lo = p.x;
        if (p.x > hi) hi = p.x;
      }
    }
    if (!Number.isFinite(lo)) return [0, 1];
    if (lo === hi) return [lo - 1, hi + 1];
    return [lo, hi];
  }

  function render() {
    const wrap = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(wrap.clientWidth, 200);
    const cssH = Math.max(wrap.clientHeight, 160);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const leftSeries = axisSeries('left');
    const rightSeries = axisSeries('right');
    const hasRight = rightSeries.length > 0;

    const padL = 58, padR = hasRight ? 58 : 16, padT = 12, padB = 30;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;

    const [xLo, xHi] = xExtent();
    const [yLo, yHi] = extent(leftSeries.length ? leftSeries : state.series);
    const [yLo2, yHi2] = hasRight ? extent(rightSeries) : [0, 1];

    const xOf = (x) => padL + ((x - xLo) / (xHi - xLo || 1)) * plotW;
    const yOf = (y) => padT + (1 - (y - yLo) / (yHi - yLo || 1)) * plotH;
    const yOf2 = (y) => padT + (1 - (y - yLo2) / (yHi2 - yLo2 || 1)) * plotH;

    ctx.font = "11px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.strokeStyle = state.colors.border;
    ctx.lineWidth = 1;

    // left axis grid + labels
    const yStep = niceStep(yHi - yLo, 5);
    const yStart = Math.ceil(yLo / yStep) * yStep;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = yStart; v <= yHi; v += yStep) {
      const y = yOf(v);
      ctx.strokeStyle = state.colors.border;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
      ctx.fillStyle = state.colors.textDim;
      ctx.fillText(state.formatY(v), padL - 8, y);
    }

    // x axis labels
    const xStep = niceStep(xHi - xLo, 6);
    const xStart = Math.ceil(xLo / xStep) * xStep;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let v = xStart; v <= xHi; v += xStep) {
      ctx.fillStyle = state.colors.textDim;
      ctx.fillText(state.formatX(v), xOf(v), padT + plotH + 8);
    }

    // right axis labels
    if (hasRight) {
      const yStep2 = niceStep(yHi2 - yLo2, 5);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (let v = Math.ceil(yLo2 / yStep2) * yStep2; v <= yHi2; v += yStep2) {
        ctx.fillStyle = state.colors.textDim;
        ctx.fillText(state.formatY(v), padL + plotW + 8, yOf2(v));
      }
    }

    // vertical event markers
    for (const m of state.markers) {
      if (m.x == null || !Number.isFinite(m.x)) continue;
      const x = xOf(m.x);
      ctx.save();
      ctx.strokeStyle = m.color || state.colors.textDim;
      ctx.setLineDash(m.dash || [3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
      ctx.restore();
    }

    // series lines
    for (const s of state.series) {
      if (!s.points || !s.points.length) continue;
      const y = (s.axis || 'left') === 'right' ? yOf2 : yOf;
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width || 1.6;
      if (s.dash) ctx.setLineDash(s.dash);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      for (const p of s.points) {
        if (!Number.isFinite(p.y)) { started = false; continue; }
        const x = xOf(p.x), yy = y(p.y);
        if (!started) { ctx.moveTo(x, yy); started = true; } else ctx.lineTo(x, yy);
      }
      ctx.stroke();
      ctx.restore();
    }

    ctx.strokeStyle = state.colors.border;
    ctx.strokeRect(padL + 0.5, padT + 0.5, plotW, plotH);

    geom = { padL, padR, padT, padB, plotW, plotH, xLo, xHi, xOf, yOf, yOf2 };

    if (hoverPx !== null) drawHover(ctx);
  }

  function bisectNearest(points, x) {
    let lo = 0, hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].x < x) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(points[lo - 1].x - x) < Math.abs(points[lo].x - x)) return lo - 1;
    return lo;
  }

  function drawHover(ctx) {
    if (!geom) return;
    const { padL, plotW, xLo, xHi, xOf, yOf, yOf2, padT, plotH } = geom;
    const clampedPx = Math.min(Math.max(hoverPx, padL), padL + plotW);
    const xVal = xLo + ((clampedPx - padL) / plotW) * (xHi - xLo);

    ctx.save();
    ctx.strokeStyle = state.colors.textDim;
    ctx.setLineDash([2, 2]);
    ctx.lineWidth = 1;
    const x = xOf(xVal);
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
    ctx.restore();

    const seriesValues = [];
    for (const s of state.series) {
      if (!s.points || !s.points.length) continue;
      const idx = bisectNearest(s.points, xVal);
      const p = s.points[idx];
      const y = (s.axis || 'left') === 'right' ? yOf2 : yOf;
      if (Number.isFinite(p.y)) {
        ctx.save();
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(x, y(p.y), 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      seriesValues.push({ label: s.label, color: s.color, value: p.y, x: p.x });
    }
    if (state.tooltip) state.tooltip({ x: xVal, seriesValues });
  }

  function onMove(e) {
    const rect = canvas.getBoundingClientRect();
    hoverPx = e.clientX - rect.left;
    render();
  }
  function onLeave() {
    hoverPx = null;
    if (state.tooltip) state.tooltip(null);
    render();
  }

  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  ro = new ResizeObserver(() => render());
  ro.observe(canvas.parentElement);

  return {
    render,
    setSeries(series, markers) {
      state.series = series || [];
      if (markers) state.markers = markers;
      render();
    },
    destroy() {
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      if (ro) ro.disconnect();
    },
  };
}

function defaultFormatNum(v) {
  const av = Math.abs(v);
  if (av !== 0 && (av < 0.01 || av >= 100000)) return v.toExponential(1);
  if (av >= 1000) return v.toFixed(0);
  if (av >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
