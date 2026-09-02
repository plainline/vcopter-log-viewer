// Extracts data from PTZ.logbin records (the gimbal's message stream, tag
// `55 25` at offset 8-9 of the base header). Every such record shares an
// 18-byte sub-header; the payload after that is either raw UART debug text
// (a serial console passthrough from the gimbal's own firmware) or a
// float32[] telemetry array, distinguished here by a printable-ASCII-ratio
// heuristic rather than a hardcoded length, so it keeps working if a
// different firmware/record size shows up in someone else's log.

import { makeReader } from './binary-reader.js';

const SUB_HEADER_LEN = 18;
const OFF_PAYLOAD_LEN = 16; // uint16 LE, exact valid byte count from offset 18
const PITCH_OFFSET = 157; // float32 LE, degrees -- confirmed only for length-224 telemetry records
const TELEMETRY_RECORD_LEN_WITH_PITCH = 224;

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
const TEXT_RATIO_THRESHOLD = 0.85;

function printableRatio(bytes, start, end) {
  if (end <= start) return 0;
  let printable = 0;
  for (let i = start; i < end; i++) {
    const c = bytes[i];
    if ((c >= 0x20 && c <= 0x7e) || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x1b) printable++;
  }
  return printable / (end - start);
}

// Decodes bytes 1:1 as Latin-1 (matches how the original firmware emits
// plain ASCII/extended-ASCII over its debug UART -- using TextDecoder utf-8
// here would mis-decode stray high bytes from truncated/garbage tails).
function decodeLatin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

export function parsePtz(records) {
  const textChunks = []; // {text, fileOffset}
  const telemetryByLength = new Map(); // length -> [{fileOffset, bytes}]
  const pitch = []; // {fileOffset, pitchDeg}
  let counts = { text: 0, telemetry: 0 };

  for (const rec of records) {
    if (rec.kind !== 'ptz' || rec.length <= SUB_HEADER_LEN) continue;
    const bytes = rec.bytes;
    const ratio = printableRatio(bytes, SUB_HEADER_LEN, rec.length);
    if (ratio > TEXT_RATIO_THRESHOLD) {
      counts.text++;
      const r = makeReader(bytes);
      const payloadLen = r.u16(OFF_PAYLOAD_LEN);
      const end = Math.min(SUB_HEADER_LEN + payloadLen, rec.length);
      const raw = decodeLatin1(bytes.subarray(SUB_HEADER_LEN, Math.max(end, SUB_HEADER_LEN)));
      const text = raw.replace(ANSI_RE, '');
      if (text.length) textChunks.push({ text, fileOffset: rec.fileOffset });
    } else {
      counts.telemetry++;
      let bucket = telemetryByLength.get(rec.length);
      if (!bucket) { bucket = []; telemetryByLength.set(rec.length, bucket); }
      bucket.push({ fileOffset: rec.fileOffset, bytes });
      if (rec.length === TELEMETRY_RECORD_LEN_WITH_PITCH) {
        const r = makeReader(bytes);
        pitch.push({ fileOffset: rec.fileOffset, pitchDeg: r.f32(PITCH_OFFSET) });
      }
    }
  }

  const { transcript, chunkIndex } = buildTranscript(textChunks);
  const flyStatusEvents = findFlyStatusEvents(transcript, chunkIndex);

  return {
    transcript,
    flyStatusEvents,
    pitch,
    telemetryByLength,
    counts,
  };
}

function buildTranscript(chunks) {
  let transcript = '';
  const chunkIndex = []; // {startChar, endChar, fileOffset}, sorted by startChar
  for (const c of chunks) {
    const startChar = transcript.length;
    transcript += c.text;
    chunkIndex.push({ startChar, endChar: transcript.length, fileOffset: c.fileOffset });
  }
  return { transcript, chunkIndex };
}

function fileOffsetForCharIndex(chunkIndex, charIdx) {
  // Linear scan is fine here: called only a handful of times (one per
  // flying/landing marker found), not per character.
  for (const c of chunkIndex) {
    if (charIdx >= c.startChar && charIdx < c.endChar) return c.fileOffset;
  }
  return chunkIndex.length ? chunkIndex[chunkIndex.length - 1].fileOffset : null;
}

function findFlyStatusEvents(transcript, chunkIndex) {
  const events = [];
  const re = /^(flying|landing)$/gm;
  let m;
  while ((m = re.exec(transcript))) {
    events.push({
      type: m[1],
      charIndex: m.index,
      fileOffset: fileOffsetForCharIndex(chunkIndex, m.index),
    });
  }
  return events;
}
