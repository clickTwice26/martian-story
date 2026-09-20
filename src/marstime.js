/**
 * Mars timekeeping and solar position.
 *
 * Implements the Allison & McEwen (2000) areocentric solar coordinate
 * algorithm, the same one behind NASA's Mars24. Everything the sky and the
 * shadows need comes out of here: where the sun is, what season it is, and
 * what the clock reads at Jezero.
 *
 *   sol            88,775.244 s  (24h 39m 35.244s) - a Mars solar day
 *   Mars year      668.5991 sols / 686.9725 Earth days
 *   obliquity      25.19 deg, so Mars has seasons much like Earth's
 *
 * Reference: Allison, M. and McEwen, M. (2000), "A post-Pathfinder evaluation
 * of areocentric solar coordinates with improved timing recipes for Mars
 * seasonal/diurnal climate studies", Planet. Space Sci. 48, 215-235.
 */

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const sin = d => Math.sin(d * D2R);
const cos = d => Math.cos(d * D2R);

export const SOL_SECONDS = 88775.244;
export const SOLS_PER_MARS_YEAR = 668.5991;

/** Leap seconds: TAI-UTC = 37 s since 2017-01-01; TT-TAI = 32.184 s. */
const TT_MINUS_UTC = 69.184;

/** Perturbation terms (amplitude deg, period Earth-days, phase deg). */
const PERTURBERS = [
  [0.0071, 2.2353, 49.409], [0.0057, 2.7543, 168.173],
  [0.0039, 1.1177, 191.837], [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704], [0.0020, 2.4694, 95.528],
  [0.0018, 32.8493, 49.095],
];

/**
 * @param date JS Date (UTC)
 * @returns raw Mars time quantities, longitude-independent
 */
export function marsTime(date) {
  const millis = date.getTime();
  const jdUT = 2440587.5 + millis / 8.64e7;                 // A-1
  const jdTT = jdUT + TT_MINUS_UTC / 86400;                 // A-2
  const dt = jdTT - 2451545.0;                              // A-3, days since J2000 TT

  const M = 19.3871 + 0.52402073 * dt;                      // B-1 Mars mean anomaly
  const aFMS = 270.3871 + 0.524038496 * dt;                 // B-2 fictitious mean sun

  let pbs = 0;                                              // B-3
  for (const [a, tau, phi] of PERTURBERS) pbs += a * cos((0.985626 * dt) / tau + phi);

  const vMinusM =                                           // B-4 equation of centre
      (10.691 + 3.0e-7 * dt) * sin(M)
    + 0.623 * sin(2 * M)
    + 0.050 * sin(3 * M)
    + 0.005 * sin(4 * M)
    + 0.0005 * sin(5 * M)
    + pbs;

  const Ls = (aFMS + vMinusM) % 360;                        // B-5 areocentric solar longitude
  const ls = Ls < 0 ? Ls + 360 : Ls;

  const eot = 2.861 * sin(2 * ls)                           // C-1 equation of time, degrees
            - 0.071 * sin(4 * ls)
            + 0.002 * sin(6 * ls)
            - vMinusM;

  const msd = (dt - 4.5) / 1.027491252 + 44796.0 - 0.00096; // C-2 Mars Sol Date
  const mtc = ((24 * msd) % 24 + 24) % 24;                  // C-3 Coordinated Mars Time

  // Mars Year, anchored on MY 12 beginning at JD 2442765.667 (1975-06-19)
  const marsYear = Math.floor((jdTT - 2442765.667) / 686.9725) + 12;

  // D-1 solar declination
  const decl = Math.asin(0.42565 * sin(ls)) * R2D + 0.25 * sin(ls);

  return { jdUT, jdTT, dt, M, ls, eot, msd, mtc, marsYear, decl, vMinusM };
}

/**
 * Local solar time and sun position for a site.
 * @param lonEast  east longitude, degrees (Jezero: 77.4509)
 * @param latNorth north latitude, degrees (Jezero: 18.4446)
 */
export function siteTime(date, lonEast, latNorth) {
  const t = marsTime(date);
  const west = ((360 - lonEast) % 360 + 360) % 360;         // algorithm uses WEST longitude

  const lmst = ((t.mtc - west * (24 / 360)) % 24 + 24) % 24;          // C-4
  const ltst = ((lmst + t.eot * (24 / 360)) % 24 + 24) % 24;          // C-5

  // Local sol number, fractional part == LMST/24
  const localSolDate = t.msd - west / 360;

  // Hour angle: 0 at local true solar noon, +15 deg per hour after
  const H = (ltst - 12) * 15;

  const sinEl = sin(latNorth) * sin(t.decl) + cos(latNorth) * cos(t.decl) * cos(H);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl))) * R2D;

  // Azimuth measured clockwise from north
  const y = -cos(t.decl) * sin(H);
  const x = cos(latNorth) * sin(t.decl) - sin(latNorth) * cos(t.decl) * cos(H);
  let azimuth = Math.atan2(y, x) * R2D;
  if (azimuth < 0) azimuth += 360;

  return { ...t, lmst, ltst, localSolDate, hourAngle: H, elevation, azimuth };
}

/** Perseverance touched down 2021-02-18 20:43:48 UTC; that sol is mission sol 0. */
export const M20_LANDING_UTC = Date.UTC(2021, 1, 18, 20, 43, 48);
export const JEZERO = { lonEast: 77.45089, latNorth: 18.44463, name: 'Jezero Crater' };

export function missionSol(date, site = JEZERO) {
  const now = siteTime(date, site.lonEast, site.latNorth);
  const land = siteTime(new Date(M20_LANDING_UTC), site.lonEast, site.latNorth);
  return Math.floor(now.localSolDate) - Math.floor(land.localSolDate);
}

/** Season name from Ls, for the northern hemisphere (Jezero is 18 deg N). */
export function season(ls) {
  if (ls < 90) return 'N. Spring';
  if (ls < 180) return 'N. Summer';
  if (ls < 270) return 'N. Autumn';
  return 'N. Winter';
}

export function formatSolClock(hoursFloat) {
  const h = Math.floor(hoursFloat);
  const mF = (hoursFloat - h) * 60;
  const m = Math.floor(mF);
  const s = Math.floor((mF - m) * 60);
  const p = n => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}`;
}

/**
 * Sun direction in the world frame (+X east, +Y up, +Z south).
 * Azimuth is clockwise from north, so north is -Z and east is +X.
 */
export function sunDirection(elevationDeg, azimuthDeg, out) {
  const el = elevationDeg * D2R, az = azimuthDeg * D2R;
  const c = Math.cos(el);
  const x = c * Math.sin(az);        // east component
  const y = Math.sin(el);            // up
  const z = -c * Math.cos(az);       // north is -Z, so azimuth 0 -> -Z
  if (out) return out.set(x, y, z);
  return { x, y, z };
}

/** Real UTC instant for a chosen mission sol + local mean solar time. */
export function utcForSolAndLmst(sol, lmstHours, site = JEZERO) {
  const land = siteTime(new Date(M20_LANDING_UTC), site.lonEast, site.latNorth);
  const targetLocalSolDate = Math.floor(land.localSolDate) + sol + lmstHours / 24;
  const west = ((360 - site.lonEast) % 360 + 360) % 360;
  const msd = targetLocalSolDate + west / 360;
  const dt = (msd - 44796.0 + 0.00096) * 1.027491252 + 4.5;
  const jdTT = dt + 2451545.0;
  const jdUT = jdTT - TT_MINUS_UTC / 86400;
  return new Date((jdUT - 2440587.5) * 8.64e7);
}
