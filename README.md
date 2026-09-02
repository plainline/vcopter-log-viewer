# VCopter Log Viewer

A browser-based viewer and decoder for the proprietary `.logbin` flight logs
written by the **ZeroZero VCopter** drone app. Drop in your `PTZ.logbin` and
`RawData.logbin` pair and get a flight-path map, an altitude/gimbal-pitch
chart, and a set of confirmed facts about the flight -- plus a developer view
for poking at everything that's still unidentified.

**Your files never leave your browser.** There is no backend, no upload, no
build step. Everything runs client-side as plain JavaScript. The only
network requests this tool makes at runtime are OpenStreetMap map-tile
images for the area your flight was in (see [Privacy](#privacy) below).

This is an **unofficial, community reverse-engineering project**. It is not
affiliated with, endorsed by, or built from any documentation from ZeroZero
Robotics -- everything here was figured out by staring at real log files in
a hex editor. Treat every field marked "unconfirmed" as a guess, not a fact.

Tested with logs from a **ZeroZero Falcon Mini**, VCopter app version
**1.0.16**. Other drones/app versions in the same family likely use the same
or a very similar format, but that's untested -- if you try it on something
else, please open an issue either way (works or doesn't) so this note can
get more accurate.

## Using it

Open `index.html` in a browser (locally, or host the whole folder on GitHub
Pages / any static host). Drop your two `.logbin` files onto the page, or
click to pick them from a file dialog. Either file works alone with reduced
functionality; the tool figures out which is which from the file contents,
not the filename.

## What's confirmed

All offsets are byte offsets from the start of a record, little-endian.

**Every record** (both files) starts with an 8-byte header:

| Offset | Size | Meaning |
|---|---|---|
| 0-3 | 4 | Sync marker, always `12 34 56 78` |
| 4 | 1 | Rolling 8-bit sequence counter |
| 5-7 | 3 | Varies per recording (looked constant within one session, differed between two real recordings) -- not used for parsing |

Offset 8-9 is a dispatch tag that reliably identifies the record's kind
across every recording tested so far:

| Tag (offset 8-9) | File | Meaning |
|---|---|---|
| `55 25` | PTZ | Gimbal message stream (18-byte sub-header, see below; payload is either UART debug text or a float32[] telemetry array) |
| `58 20` | RawData | GPS/status record, ~10 Hz |
| `48 00` | RawData | High-frequency IMU/motor record, fields not yet identified |

**PTZ sub-header** (records tagged `55 25`), 18 bytes:

| Offset | Size | Meaning |
|---|---|---|
| 16-17 | 2 | Payload length in bytes (uint16) -- for text records, everything past this length is stale buffer content, not padding |
| 18+ | — | Payload: raw UART text (ANSI color codes included) or a float32 telemetry array |

Confirmed fields, verified against two real flights (one that landed
normally, one where the link was lost mid-flight):

| Field | Record | Offset | Type | Notes |
|---|---|---|---|---|
| Longitude | RawData `58 20` | 22 | int32, ÷1e7 | degrees |
| Latitude | RawData `58 20` | 26 | int32, ÷1e7 | degrees |
| **Altitude** | RawData `58 20` | 34 | int16, ÷10 | meters. Verified end-to-end: 0m at launch → climb → peak → 0m at touchdown on a normal landing; still 100+ m on a flight where the connection was lost mid-air |
| Elapsed time | RawData `58 20` | 106 | float32 | seconds since session start, this record's own clock (~10 Hz) |
| Gimbal pitch | PTZ telemetry, 224-byte records only | 157 | float32 | degrees |
| Flight status | PTZ text | — | the literal strings `flying` / `landing`, printed by the gimbal firmware on every status change |

### What's not identified yet

- The 43-byte RawData "IMU/motor" record (by far the highest-frequency one) has no confirmed fields.
- PTZ telemetry offsets 161/165/169/173 look like more gimbal-orientation values (correlated with pitch) but aren't confirmed.
- A handful of rarer record lengths (42B, 66B, 171B, and others) show up occasionally in both files and haven't been investigated.
- There's no shared clock between the two files. RawData's `58 20` records carry a real timestamp; everything else in RawData is time-aligned to that by interpolating file position. PTZ has *no* native timestamp at all -- the app labels PTZ-derived times `~t` and estimates them by mapping a PTZ record's position within its own file onto RawData's time range. Treat any PTZ timing as approximate.

The **Developer** tab exists specifically to make progress on the above: pick
any record type found in your upload, any numeric interpretation, any byte
offset, and plot it against time. If you find something that looks like a
real signal, please open an issue or a PR describing what you found and how
you confirmed it (ideally against a flight where you independently know the
ground truth, the way altitude and the flying/landing markers were found here).

## Privacy

Nothing about your flight is ever sent anywhere. The one exception: once you
load a flight with GPS data, the map view fetches OpenStreetMap tile images
for the area shown, which means the map tile provider sees which map tiles
(i.e. roughly where in the world) you're looking at -- the same as any
embedded map. No flight data, coordinates, or file contents are included in
those requests, only tile x/y/zoom coordinates.

## Contributing

Pull requests welcome, especially ones that identify more fields (see
"What's not identified yet" above). A few things to know:

- No build step, no bundler, no dependencies beyond the vendored Leaflet in `vendor/`. Please keep it that way -- an earlier prototype of this tool used Chart.js from a public CDN and it silently failed to load on a network that blocked that CDN, leaving a blank chart with no error. Every script this tool needs ships with the repo.
- Never commit real flight-log files, or data derived from them (base64 blobs, hardcoded coordinates/timestamps from a specific flight, etc.). Format-level constants (offsets, tags, confirmed field meanings) are fine and expected; anyone's personal flight data is not.
