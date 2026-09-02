// Pure "did it land, or did we just lose the link" heuristic.
//
// This was reverse-engineered and validated on exactly two real flights (one
// confirmed landing, one confirmed mid-flight link loss) -- treat it as a
// best-guess with visible supporting evidence, never render it as a fact.
// See README.md for the reasoning this was built from.

const LANDED_ALT_M = 3;
const LANDED_SPEED_MPS = 1;
const AIRBORNE_ALT_M = 10;
const MOVING_SPEED_MPS = 3;

/**
 * @param {import('../parser/model.js').FlightData} flight
 * @returns {{verdict:'landed'|'lost-link'|'unknown', reasons:string[]}}
 */
export function assessLanding(flight) {
  const reasons = [];
  const hasLandingEvent = flight.flyStatusEvents.some((e) => e.type === 'landing');
  const hasFlyingEvent = flight.flyStatusEvents.some((e) => e.type === 'flying');
  const lastAlt = flight.gps.lastAltitudeM;
  const lastSpeed = flight.gps.lastSpeedMps;

  if (hasFlyingEvent) {
    reasons.push(hasLandingEvent
      ? 'Transcript contains a "landing" status marker from the gimbal firmware.'
      : 'Transcript contains a "flying" status marker but no "landing" marker.');
  } else {
    reasons.push('No fly-status text markers found in the PTZ transcript (or no PTZ file uploaded).');
  }

  if (lastAlt != null) {
    reasons.push(`Altitude at the last recorded sample: ${lastAlt.toFixed(1)} m.`);
  }
  if (lastSpeed != null) {
    reasons.push(`Horizontal ground speed at the last recorded sample: ${lastSpeed.toFixed(1)} m/s.`);
  }

  const looksLanded = hasLandingEvent && lastAlt != null && lastAlt <= LANDED_ALT_M
    && lastSpeed != null && lastSpeed <= LANDED_SPEED_MPS;
  const looksAirborne = !hasLandingEvent && (
    (lastAlt != null && lastAlt >= AIRBORNE_ALT_M) ||
    (lastSpeed != null && lastSpeed >= MOVING_SPEED_MPS)
  );

  if (looksLanded) {
    return { verdict: 'landed', reasons };
  }
  if (looksAirborne) {
    reasons.push('The recording ends without a landing sequence while still airborne and/or moving -- this looks like the link was lost mid-flight, not a normal landing.');
    return { verdict: 'lost-link', reasons };
  }
  reasons.push('Not enough evidence to call this confidently -- check the altitude and pitch charts yourself.');
  return { verdict: 'unknown', reasons };
}
