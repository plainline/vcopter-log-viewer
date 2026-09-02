// Tiny helper around DataView for reading little-endian primitives out of a
// Uint8Array/ArrayBuffer at an explicit byte offset. No cursor state is kept
// here on purpose -- callers pass the offset each time, which keeps the
// parser modules that use this easy to reason about (offsets in this format
// are all fixed/absolute within a record, not sequential reads).

export function makeReader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    bytes,
    length: bytes.length,
    u8(off) { return view.getUint8(off); },
    i8(off) { return view.getInt8(off); },
    u16(off) { return view.getUint16(off, true); },
    i16(off) { return view.getInt16(off, true); },
    u32(off) { return view.getUint32(off, true); },
    i32(off) { return view.getInt32(off, true); },
    f32(off) { return view.getFloat32(off, true); },
    // Reads `len` bytes starting at `off` as a Uint8Array view (no copy).
    slice(off, len) { return bytes.subarray(off, off + len); },
  };
}

// Reads a value of the given numeric type at `off` from a reader. Used by
// the developer-tab offset explorer, which lets the user pick the type at
// runtime rather than having it hardcoded per field.
export const NUMERIC_TYPES = ['i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'f32'];

export function readNumeric(reader, type, off) {
  if (off < 0 || off + typeSize(type) > reader.length) return null;
  return reader[type](off);
}

export function typeSize(type) {
  switch (type) {
    case 'i8': case 'u8': return 1;
    case 'i16': case 'u16': return 2;
    case 'i32': case 'u32': case 'f32': return 4;
    default: throw new Error(`Unknown numeric type: ${type}`);
  }
}
