// Time alignment helpers.
//
// Only RawData's "gps" records (tag 58 20) carry a native clock (offset 106,
// elapsed seconds since session start). Everything else has to be aligned
// against that:
//
//  - Other RawData record kinds (43B IMU, unknown) live in the *same file*,
//    so their byte offset can be linearly interpolated against the sorted
//    (fileOffset, t) pairs from the gps records. This is a solid estimate.
//
//  - PTZ records live in a *different file* with no shared clock at all.
//    The best we can honestly do is assume both files were written at
//    roughly constant relative rates and map a PTZ record's fractional
//    position within the PTZ file onto RawData's [startT, endT] range.
//    Callers MUST treat this as an approximation (the UI labels it "~t")
//    rather than a real timestamp -- there is no way to derive a precise
//    cross-file alignment from the data alone.

export function buildTimeIndex(gpsRecords) {
  return gpsRecords
    .map((r) => ({ fileOffset: r.fileOffset, t: r.t }))
    .sort((a, b) => a.fileOffset - b.fileOffset);
}

export function interpolateTime(timeIndex, fileOffset) {
  if (timeIndex.length === 0) return null;
  if (timeIndex.length === 1) return timeIndex[0].t;
  let lo = 0, hi = timeIndex.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timeIndex[mid].fileOffset < fileOffset) lo = mid + 1; else hi = mid;
  }
  let a, b;
  if (lo === 0) { a = timeIndex[0]; b = timeIndex[1]; }
  else if (lo >= timeIndex.length) { a = timeIndex[timeIndex.length - 2]; b = timeIndex[timeIndex.length - 1]; }
  else { a = timeIndex[lo - 1]; b = timeIndex[lo]; }
  if (b.fileOffset === a.fileOffset) return a.t;
  const frac = (fileOffset - a.fileOffset) / (b.fileOffset - a.fileOffset);
  return a.t + frac * (b.t - a.t);
}

/**
 * Rough, explicitly-approximate PTZ->RawData time mapping. See module
 * comment: there is no shared clock, this is a proportional-position guess.
 */
export function approxPtzTime(fileOffset, ptzFileLength, rawStartT, rawEndT) {
  if (!ptzFileLength) return null;
  const frac = Math.min(Math.max(fileOffset / ptzFileLength, 0), 1);
  return rawStartT + frac * (rawEndT - rawStartT);
}
