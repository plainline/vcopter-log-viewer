// Segments a raw .logbin ArrayBuffer into records.
//
// Format (reverse-engineered, see README.md "Format notes" for the full
// writeup): every record starts with a 4-byte sync marker, followed by a
// rolling 8-bit sequence counter and a 3-byte field at offset 5-7 that
// looked constant (`88 8d 6a`) across one recording but turned out to
// differ between recordings (a different flight's log used `eb 8a 6a`
// there) -- so it's tracked but deliberately *not* used to validate a sync
// candidate; only the 4-byte magic itself is required. There is no
// explicit length field in this outer header, so a record's length is
// inferred as the distance to the next sync marker -- this is more robust
// than a hardcoded lookup table of known lengths, since it lets
// previously-uncatalogued record sizes fall out of the scan automatically
// instead of needing special-casing.

export const SYNC = [0x12, 0x34, 0x56, 0x78];
export const BASE_HEADER_LEN = 8;

// Second-level dispatch tag at offset 8-9, present on every record that
// carries one of the two known sub-formats. Empirically these three values
// reliably identify their record kind across multiple real recordings, even
// though the offset 5-7 field above does not.
const TAG_PTZ_STREAM = 0x2555; // bytes 55 25, read as uint16 LE
const TAG_RAWDATA_GPS = 0x2058; // bytes 58 20
const TAG_RAWDATA_IMU = 0x0048; // bytes 48 00

function isValidSyncAt(bytes, pos) {
  if (pos + BASE_HEADER_LEN > bytes.length) return false;
  for (let i = 0; i < SYNC.length; i++) {
    if (bytes[pos + i] !== SYNC[i]) return false;
  }
  return true;
}

function findSyncOffsets(bytes) {
  const offsets = [];
  let i = 0;
  while (true) {
    const found = bytes.indexOf(SYNC[0], i);
    if (found === -1) break;
    if (isValidSyncAt(bytes, found)) {
      offsets.push(found);
      i = found + BASE_HEADER_LEN;
    } else {
      i = found + 1;
    }
  }
  return offsets;
}

/**
 * @param {Uint8Array} bytes
 * @returns {{fileOffset:number, seq:number, tag:number, length:number, bytes:Uint8Array, kind:'ptz'|'rawdata-gps'|'rawdata-imu'|'unknown'}[]}
 */
export function scanRecords(bytes) {
  const offsets = findSyncOffsets(bytes);
  const records = [];
  for (let j = 0; j < offsets.length; j++) {
    const start = offsets[j];
    const end = j + 1 < offsets.length ? offsets[j + 1] : bytes.length;
    const length = end - start;
    const rec = bytes.subarray(start, end);
    const seq = rec[4];
    const tag = length >= 10 ? (rec[8] | (rec[9] << 8)) : -1;
    let kind = 'unknown';
    if (tag === TAG_PTZ_STREAM) kind = 'ptz';
    else if (tag === TAG_RAWDATA_GPS) kind = 'rawdata-gps';
    else if (tag === TAG_RAWDATA_IMU) kind = 'rawdata-imu';
    records.push({ fileOffset: start, seq, tag, length, bytes: rec, kind });
  }
  return records;
}

export function tagHex(tag) {
  if (tag < 0) return 'n/a';
  const lo = tag & 0xff;
  const hi = (tag >> 8) & 0xff;
  const h = (n) => n.toString(16).padStart(2, '0');
  return `${h(lo)} ${h(hi)}`;
}
