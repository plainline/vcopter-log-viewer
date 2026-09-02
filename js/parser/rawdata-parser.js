// Extracts the confirmed fields from RawData.logbin records, and buckets
// everything else (the still-undecoded 43-byte IMU/motor record and any
// rarer, uncatalogued record shapes) so the developer tab can surface them
// instead of silently dropping them.

import { makeReader } from './binary-reader.js';

// Confirmed field offsets within a "rawdata-gps" record (see README.md).
const OFF_LON = 22; // int32 LE, degrees * 1e7
const OFF_LAT = 26; // int32 LE, degrees * 1e7
const OFF_ALT = 34; // int16 LE, decimeters
const OFF_T = 106; // float32 LE, seconds since session start

const MAX_SAMPLES_PER_UNKNOWN_TYPE = 200; // cap memory for pathological uploads

export function parseRawData(records) {
  const gps = []; // {t, lat, lon, altM, fileOffset}
  const imu43 = []; // {fileOffset, bytes} -- 43B records, fields unidentified
  const unknownByKey = new Map(); // "tagHex/len" -> {tagHex, length, count, samples:[{fileOffset,bytes}]}
  const counts = { gps: 0, imu43: 0, unknown: 0 };

  for (const rec of records) {
    if (rec.kind === 'rawdata-gps') {
      counts.gps++;
      if (rec.length < OFF_T + 4) continue; // too short to hold the confirmed fields
      const r = makeReader(rec.bytes);
      gps.push({
        fileOffset: rec.fileOffset,
        t: r.f32(OFF_T),
        lat: r.i32(OFF_LAT) / 1e7,
        lon: r.i32(OFF_LON) / 1e7,
        altM: r.i16(OFF_ALT) / 10,
      });
    } else if (rec.kind === 'rawdata-imu') {
      counts.imu43++;
      imu43.push({ fileOffset: rec.fileOffset, bytes: rec.bytes });
    } else if (rec.kind === 'unknown') {
      counts.unknown++;
      const tagHex = tagHexOf(rec);
      const key = `${tagHex}/${rec.length}`;
      let bucket = unknownByKey.get(key);
      if (!bucket) {
        bucket = { tagHex, length: rec.length, count: 0, samples: [] };
        unknownByKey.set(key, bucket);
      }
      bucket.count++;
      if (bucket.samples.length < MAX_SAMPLES_PER_UNKNOWN_TYPE) {
        bucket.samples.push({ fileOffset: rec.fileOffset, bytes: rec.bytes });
      }
    }
  }

  gps.sort((a, b) => a.t - b.t);

  return {
    gps,
    imu43,
    unknownRecordTypes: [...unknownByKey.values()].sort((a, b) => b.count - a.count),
    counts,
  };
}

function tagHexOf(rec) {
  if (rec.length < 10) return 'n/a';
  const h = (n) => n.toString(16).padStart(2, '0');
  return `${h(rec.bytes[8])} ${h(rec.bytes[9])}`;
}
