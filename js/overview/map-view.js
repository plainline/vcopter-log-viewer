// Renders the flight path on a real Leaflet + OpenStreetMap map. This is
// the one deliberate exception to "no runtime network requests" in this
// tool: rendering an actual map means fetching OSM tile images for the
// visible area. Nothing about the flight data itself is sent anywhere --
// only tile-image requests for map areas the user is looking at, same as
// any map embed. See README.md for the full privacy note.

const MAX_POLYLINE_POINTS = 3000;

function decimate(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  const out = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

let map = null;
let layerGroup = null;
let highlightMarker = null;

export function renderMap(container, gpsValid) {
  if (!map) {
    map = L.map(container, { attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
  } else {
    map.invalidateSize();
  }
  if (layerGroup) layerGroup.remove();
  layerGroup = L.layerGroup().addTo(map);
  clearMapHighlight(); // don't carry a stale highlight over from a previous flight

  if (!gpsValid || gpsValid.length === 0) {
    map.setView([0, 0], 2);
    return;
  }

  const pts = decimate(gpsValid, MAX_POLYLINE_POINTS);
  const latlngs = pts.map((p) => [p.lat, p.lon]);

  L.polyline(latlngs, { color: '#ffb454', weight: 3, opacity: 0.9 }).addTo(layerGroup);
  L.circleMarker(latlngs[0], { radius: 6, color: '#7fd88f', fillColor: '#7fd88f', fillOpacity: 1 })
    .bindTooltip('Start').addTo(layerGroup);
  L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, color: '#ff6b6b', fillColor: '#ff6b6b', fillOpacity: 1 })
    .bindTooltip('Last recorded position').addTo(layerGroup);

  map.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24] });
}

export function invalidateMapSize() {
  if (map) map.invalidateSize();
}

// Cross-highlight: called by the altitude/pitch chart on hover so the
// corresponding position lights up on the map too.
export function highlightMapPoint(lat, lon) {
  if (!map || lat == null || lon == null) return;
  if (!highlightMarker) {
    highlightMarker = L.circleMarker([lat, lon], {
      radius: 8,
      color: '#5ecbd8',
      weight: 2,
      fillColor: '#5ecbd8',
      fillOpacity: 0.5,
      interactive: false,
      pane: 'markerPane',
    }).addTo(map);
  } else {
    highlightMarker.setLatLng([lat, lon]);
    if (!map.hasLayer(highlightMarker)) highlightMarker.addTo(map);
  }
}

export function clearMapHighlight() {
  if (highlightMarker && map && map.hasLayer(highlightMarker)) {
    map.removeLayer(highlightMarker);
  }
}
