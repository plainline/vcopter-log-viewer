// Figures out which of one or two uploaded files is the PTZ stream and
// which is the RawData stream. Content is the source of truth (a user could
// rename files, or the convention could differ) -- the filename is only
// used to pre-fill an upload slot before sniffing runs, never trusted alone.

import { scanRecords } from './record-scanner.js';

const SNIFF_BYTES = 262144; // 256 KiB is plenty to see which record kind dominates

/**
 * @param {Uint8Array} bytes
 * @returns {'ptz'|'rawdata'|'unknown'}
 */
export function sniffFileKind(bytes) {
  const sample = bytes.subarray(0, Math.min(SNIFF_BYTES, bytes.length));
  const records = scanRecords(sample);
  if (records.length === 0) return 'unknown';
  let ptz = 0, rawdata = 0;
  for (const r of records) {
    if (r.kind === 'ptz') ptz++;
    else if (r.kind === 'rawdata-gps' || r.kind === 'rawdata-imu') rawdata++;
  }
  if (ptz === 0 && rawdata === 0) return 'unknown';
  return ptz >= rawdata ? 'ptz' : 'rawdata';
}

/**
 * Sorts up to two uploaded {name, bytes} entries into {ptz, rawdata} slots
 * by content. Either slot may end up null if only one file was provided or
 * if a file doesn't look like either kind.
 */
export function pairFiles(files) {
  const result = { ptz: null, rawdata: null, unrecognized: [] };
  for (const f of files) {
    const kind = sniffFileKind(f.bytes);
    if (kind === 'ptz' && !result.ptz) result.ptz = f;
    else if (kind === 'rawdata' && !result.rawdata) result.rawdata = f;
    else if (kind === 'ptz' || kind === 'rawdata') {
      // second file of a kind we already have a slot for -- keep the first,
      // report the rest as unrecognized/duplicate so the UI can say so
      result.unrecognized.push(f);
    } else {
      result.unrecognized.push(f);
    }
  }
  return result;
}
