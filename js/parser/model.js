// Builds the single shared FlightData object that both the Overview and
// Developer tabs read from. Runs the raw parsers once, aligns everything
// onto RawData's clock (exactly, for RawData's own other record kinds;
// approximately, for PTZ -- see align.js), filters GPS cold-start noise,
// and derives the handful of summary numbers the UI needs.

import { scanRecords } from './record-scanner.js';
import { parseRawData } from './rawdata-parser.js';
import { parsePtz } from './ptz-parser.js';
import { buildTimeIndex, interpolateTime, approxPtzTime } from './align.js';

const EARTH_RADIUS_M = 6371000;

function haversine(lat1, lon1, lat2, lon2) {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlmb = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlmb / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

// Drops (0,0) cold-start placeholders, then scans the early part of the
// remaining points for implausible position jumps (a receiver acquiring a
// fix can briefly *stably* hold a wrong solution for several consecutive
// samples -- a run of points close to each other doesn't by itself prove
// they're correct, it can just mean the noise held steady for a moment --
// so this looks for the actual jump-to-truth instead of for "closeness").
// Everything up to and including the last such jump within the acquisition
// window is discarded. The window is a time bound, not a location/country
// assumption, so this works for a log from anywhere.
const COLD_START_WINDOW_S = 60; // real GPS acquisition noise resolves well within this
const COLD_START_MAX_SPEED_MPS = 25;

function filterGpsColdStart(points) {
  const nonZero = points.filter((p) => !(p.lat === 0 && p.lon === 0));
  if (nonZero.length < 2) return nonZero;
  const t0 = nonZero[0].t;
  let lastBadIdx = -1;
  for (let i = 1; i < nonZero.length; i++) {
    if (nonZero[i].t - t0 > COLD_START_WINDOW_S) break;
    const a = nonZero[i - 1], b = nonZero[i];
    const dt = b.t - a.t;
    const speed = dt > 0 ? haversine(a.lat, a.lon, b.lat, b.lon) / dt : 0;
    if (speed > COLD_START_MAX_SPEED_MPS) lastBadIdx = i;
  }
  return lastBadIdx >= 0 ? nonZero.slice(lastBadIdx) : nonZero;
}

// A dt smaller than this is most likely two near-duplicate timestamps
// (interpolation/float noise) rather than a real sub-100ms GPS update, and
// dividing a real distance by it produces nonsense speeds -- e.g. a single
// leftover cold-start jump right at the edge of the settle filter can
// otherwise show up as "18 million m/s". Treat those as unreliable instead
// of silently feeding them into max-speed.
const MIN_DT_FOR_SPEED_S = 0.05;
const MAX_PLAUSIBLE_SPEED_MPS = 60; // ~216 km/h, generously above anything this drone class does

function computeSpeeds(validGps) {
  const withSpeed = validGps.map((p) => ({ ...p, speedMps: null }));
  for (let i = 1; i < withSpeed.length; i++) {
    const a = withSpeed[i - 1], b = withSpeed[i];
    const dt = b.t - a.t;
    if (dt >= MIN_DT_FOR_SPEED_S) {
      const speed = haversine(a.lat, a.lon, b.lat, b.lon) / dt;
      b.speedMps = speed <= MAX_PLAUSIBLE_SPEED_MPS ? speed : null;
    }
  }
  return withSpeed;
}

/**
 * @param {{name:string, bytes:Uint8Array}|null} ptzFile
 * @param {{name:string, bytes:Uint8Array}|null} rawFile
 */
export function buildFlightData(ptzFile, rawFile) {
  const rawRecords = rawFile ? scanRecords(rawFile.bytes) : [];
  const ptzRecords = ptzFile ? scanRecords(ptzFile.bytes) : [];

  const rawData = parseRawData(rawRecords);
  const ptzData = parsePtz(ptzRecords);

  const timeIndex = buildTimeIndex(rawData.gps);
  const rawStartT = timeIndex.length ? timeIndex[0].t : 0;
  const rawEndT = timeIndex.length ? timeIndex[timeIndex.length - 1].t : 0;

  // Attach an estimated time to every RawData record, including the raw
  // scanned list (used by the developer offset explorer to plot *any*
  // record kind against time), via exact same-file interpolation.
  for (const rec of rawRecords) rec.t = interpolateTime(timeIndex, rec.fileOffset);
  for (const rec of rawData.imu43) rec.t = interpolateTime(timeIndex, rec.fileOffset);
  for (const bucket of rawData.unknownRecordTypes) {
    for (const rec of bucket.samples) rec.t = interpolateTime(timeIndex, rec.fileOffset);
  }

  // Attach an *approximate* time to PTZ-derived data via proportional
  // file-position mapping (see align.js -- flagged everywhere as "~t").
  const ptzFileLength = ptzFile ? ptzFile.bytes.length : 0;
  const approxT = (fileOffset) => approxPtzTime(fileOffset, ptzFileLength, rawStartT, rawEndT);
  for (const rec of ptzRecords) rec.approxT = approxT(rec.fileOffset);
  for (const p of ptzData.pitch) p.approxT = approxT(p.fileOffset);
  for (const e of ptzData.flyStatusEvents) e.approxT = approxT(e.fileOffset);
  for (const [, bucket] of ptzData.telemetryByLength) {
    for (const rec of bucket) rec.approxT = approxT(rec.fileOffset);
  }

  const gpsValid = filterGpsColdStart(rawData.gps);
  const gpsWithSpeed = computeSpeeds(gpsValid);

  const maxAltitude = rawData.gps.length ? Math.max(...rawData.gps.map((p) => p.altM)) : null;
  const lastGps = gpsWithSpeed.length ? gpsWithSpeed[gpsWithSpeed.length - 1] : null;
  const maxSpeed = gpsWithSpeed.reduce((m, p) => (p.speedMps != null && p.speedMps > m ? p.speedMps : m), 0);
  const pitchValues = ptzData.pitch.map((p) => p.pitchDeg).filter(Number.isFinite);

  return {
    meta: {
      ptzFileName: ptzFile ? ptzFile.name : null,
      rawFileName: rawFile ? rawFile.name : null,
      hasPtz: !!ptzFile,
      hasRaw: !!rawFile,
      startT: rawStartT,
      endT: rawEndT,
      durationS: rawEndT - rawStartT,
      firstFixT: gpsValid.length ? gpsValid[0].t : null,
    },
    gps: {
      all: rawData.gps, // includes cold-start noise, for the dev tab
      valid: gpsWithSpeed, // cold-start-filtered, with per-point speed
      maxAltitudeM: maxAltitude,
      lastAltitudeM: rawData.gps.length ? rawData.gps[rawData.gps.length - 1].altM : null,
      lastSpeedMps: lastGps ? lastGps.speedMps : null,
      maxSpeedMps: maxSpeed,
      lastPoint: lastGps,
    },
    pitch: {
      points: ptzData.pitch, // [{fileOffset, approxT, pitchDeg}]
      minDeg: pitchValues.length ? Math.min(...pitchValues) : null,
      maxDeg: pitchValues.length ? Math.max(...pitchValues) : null,
    },
    transcript: ptzData.transcript,
    flyStatusEvents: ptzData.flyStatusEvents,
    dev: {
      // Full scanned record lists (bytes + estimated time), for the offset
      // explorer to group by (kind, length) and decode any offset/type live.
      rawRecords,
      ptzRecords,
      unknownRecordTypes: rawData.unknownRecordTypes,
    },
    counts: {
      raw: rawData.counts,
      ptz: ptzData.counts,
    },
  };
}
