#!/usr/bin/env python3
"""
Bake a Jezero weather climatology from Perseverance's MEDA weather station.

MEDA records pressure, air and ground temperature and wind at ~1 Hz for most
of every sol, ~10-25 MB of CSV per sol. The game needs none of that rate, only
"what is the weather here at this season and this hour". So we sample every
STEP-th sol, reduce each to 24 hourly means (LMST), and bin the result by solar
longitude (Ls, 10 degree bins). Nothing is invented: empty bins are filled only
by interpolating between neighbouring seasons, and are flagged as such.

Source : NASA PDS Atmospheres Node, Mars 2020 MEDA bundle (no login)
         https://pds-atmospheres.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/
Files  : data_derived_env/.../DER_PS (pressure, Pa)
         data_calibrated_env/.../CAL_TIRS (atmospheric air temperature, ground
                                            temperature, both K)
         data_derived_env/.../DER_WS (horizontal wind speed m/s, direction)
         data_derived_env/.../DER_ANCILLARY (first rows only: Ls of the sol)
Output : data/meda_climate.json
"""
import io, json, math, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "https://pds-atmospheres.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/"
STEP = int(os.environ.get("MEDA_STEP", "9"))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "meda_climate.json")
CACHE = os.environ.get("MEDA_CACHE")      # optional dir for per-sol reductions (resumable)
BAD = 999999999.0
UA = {"User-Agent": "martian-story-data-tools/1.0"}


def get(url, rng=None, retries=5):
    for a in range(retries):
        try:
            h = dict(UA)
            if rng:
                h["Range"] = f"bytes={rng[0]}-{rng[1]}"
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=180) as r:
                return r.read()
        except Exception as e:
            if getattr(e, "code", None) == 404 or a == retries - 1:
                raise
            time.sleep(2 * (a + 1))


def listing(url):
    html = get(url).decode("utf-8", "replace")
    return re.findall(r'href="([^"?/][^"?]*)"', html)


def sol_dirs(product):
    """{sol: url_of_sol_folder} for one data collection."""
    out = {}
    for rng in listing(BASE + product + "/"):
        if not rng.startswith("sol_"):
            continue
        for s in listing(BASE + product + "/" + rng):
            m = re.match(r"sol_(\d{4})/$", s)
            if m:
                out[int(m.group(1))] = BASE + product + "/" + rng + s
    return out


# Mars24 (Allison & McEwen 2000), as in src/marstime.js. MEDA's ancillary
# SOLAR_LONGITUDE_ANGLE column is not the seasonal Ls, so compute it from the sol.
LANDING_UTC = 1613681580.0                # 2021-02-18 20:53 UTC, ~15:53 LMST on sol 0
SOL_S = 88775.244
_PERT = [(0.0071, 2.2353, 49.409), (0.0057, 2.7543, 168.173), (0.0039, 1.1177, 191.837),
         (0.0037, 15.7866, 21.736), (0.0021, 2.1354, 15.704), (0.0020, 2.4694, 95.528),
         (0.0018, 32.8493, 49.095)]


def ls_of_sol(sol, lmst=12.0):
    t = LANDING_UTC + (sol + (lmst - 15.88) / 24) * SOL_S
    dt = (2440587.5 + t / 86400 + 69.184 / 86400) - 2451545.0
    d = math.radians
    M = 19.3871 + 0.52402073 * dt
    a = 270.3871 + 0.524038496 * dt
    pbs = sum(A * math.cos(d(0.985626 * dt / tau + phi)) for A, tau, phi in _PERT)
    v = ((10.691 + 3.0e-7 * dt) * math.sin(d(M)) + 0.623 * math.sin(d(2 * M)) + 0.050 * math.sin(d(3 * M))
         + 0.005 * math.sin(d(4 * M)) + 0.0005 * math.sin(d(5 * M)) + pbs)
    return (a + v) % 360


def lmst_hours(s):
    # "00300M02:00:30.032"
    t = s.split("M", 1)[1]
    hh, mm, ss = t.split(":")
    return int(hh) + int(mm) / 60 + float(ss) / 3600


def hourly(csv_bytes, cols):
    """Mean of each column in each LMST hour. Returns {col: [24 floats|None]}."""
    f = io.StringIO(csv_bytes.decode("ascii", "replace"))
    head = f.readline().strip().split(",")
    ix = {c: head.index(c) for c in cols if c in head}
    lm = head.index("LMST")
    acc = {c: [[0.0, 0] for _ in range(24)] for c in ix}
    for line in f:
        p = line.rstrip("\n").split(",")
        if len(p) <= lm:
            continue
        try:
            h = int(lmst_hours(p[lm])) % 24
        except Exception:
            continue
        for c, i in ix.items():
            v = p[i] if i < len(p) else ""
            if not v:
                continue
            try:
                x = float(v)
            except ValueError:
                continue
            if x >= BAD or x != x:
                continue
            a = acc[c][h]
            a[0] += x
            a[1] += 1
    return {c: [(a[0] / a[1] if a[1] >= 20 else None) for a in acc[c]] for c in acc}


def hourly_dir(csv_bytes):
    """Wind direction is circular: average unit vectors, weighted by speed."""
    f = io.StringIO(csv_bytes.decode("ascii", "replace"))
    head = f.readline().strip().split(",")
    lm, sp, dr = head.index("LMST"), head.index("HORIZONTAL_WIND_SPEED"), head.index("WIND_DIRECTION")
    acc = [[0.0, 0.0, 0] for _ in range(24)]
    for line in f:
        p = line.rstrip("\n").split(",")
        try:
            s, d = float(p[sp]), float(p[dr])
            h = int(lmst_hours(p[lm])) % 24
        except Exception:
            continue
        if s >= BAD or d >= BAD:
            continue
        acc[h][0] += s * math.sin(math.radians(d))
        acc[h][1] += s * math.cos(math.radians(d))
        acc[h][2] += 1
    return [(math.degrees(math.atan2(a[0], a[1])) % 360 if a[2] >= 20 else None) for a in acc]


def pick(files, kind):
    """Highest product version of e.g. DER_PS in a sol folder."""
    c = sorted(f for f in files if re.search(rf"_{kind}_+P\d+\.CSV$", f))
    return c[-1] if c else None


def reduce_sol(sol, der_url, cal_url):
    if CACHE:
        cp = os.path.join(CACHE, f"sol_{sol:04d}.json")
        if os.path.exists(cp):
            with open(cp) as f:
                return json.load(f)
    der = listing(der_url)
    cal = listing(cal_url) if cal_url else []
    rec = {"sol": sol}
    anc = pick(der, "DER_ANCILLARY")
    if anc:
        head = get(der_url + anc, rng=(0, 4095)).decode("ascii", "replace").splitlines()
        cols = head[0].split(",")
        for row in head[1:]:
            p = row.split(",")
            try:
                rec["ls"] = float(p[cols.index("SOLAR_LONGITUDE_ANGLE")]) % 360
                break
            except Exception:
                continue
    ps = pick(der, "DER_PS")
    if ps:
        rec["pressure"] = hourly(get(der_url + ps), ["PRESSURE"])["PRESSURE"]
    tirs = pick(cal, "CAL_TIRS")
    if tirs:
        h = hourly(get(cal_url + tirs), ["AIR_TEMP", "GROUND_TEMP"])
        rec["airT"], rec["groundT"] = h.get("AIR_TEMP"), h.get("GROUND_TEMP")
    ws = pick(der, "DER_WS")
    if ws:
        b = get(der_url + ws)
        rec["wind"] = hourly(b, ["HORIZONTAL_WIND_SPEED"])["HORIZONTAL_WIND_SPEED"]
        rec["windDir"] = hourly_dir(b)
    if CACHE:
        os.makedirs(CACHE, exist_ok=True)
        with open(cp, "w") as f:
            json.dump(rec, f)
    return rec


def main():
    print("Listing MEDA sol folders...", flush=True)
    der = sol_dirs("data_derived_env")
    cal = sol_dirs("data_calibrated_env")
    sols = sorted(s for s in der if s % STEP == 0)
    print(f"  derived sols {min(der)}..{max(der)}, sampling {len(sols)} (every {STEP})", flush=True)

    recs, t0 = [], time.time()

    def job(s):
        try:
            return reduce_sol(s, der[s], cal.get(s))
        except Exception as e:
            print(f"  sol {s}: {e}", flush=True)
            return None

    with ThreadPoolExecutor(max_workers=int(os.environ.get("MEDA_WORKERS", "8"))) as ex:
        for i, r in enumerate(ex.map(job, sols)):
            if r:
                r["ls"] = ls_of_sol(r["sol"])
                recs.append(r)
            if (i + 1) % 10 == 0:
                print(f"  {i + 1}/{len(sols)} sols  {time.time() - t0:.0f} s", flush=True)

    # ---- bin by season --------------------------------------------------------
    NB = 36
    fields = ["pressure", "airT", "groundT", "wind"]
    acc = {f: [[[0.0, 0] for _ in range(24)] for _ in range(NB)] for f in fields}
    dacc = [[[0.0, 0.0] for _ in range(24)] for _ in range(NB)]
    for r in recs:
        b = int(r["ls"] // 10) % NB
        for f in fields:
            for h, v in enumerate(r.get(f) or []):
                if v is not None:
                    acc[f][b][h][0] += v
                    acc[f][b][h][1] += 1
        for h, d in enumerate(r.get("windDir") or []):
            if d is not None:
                dacc[b][h][0] += math.sin(math.radians(d))
                dacc[b][h][1] += math.cos(math.radians(d))

    def fill(grid):
        """Fill empty (bin,hour) cells from the nearest measured seasons either side."""
        filled = [[False] * 24 for _ in range(NB)]
        for h in range(24):
            have = [b for b in range(NB) if grid[b][h] is not None]
            if not have:
                continue
            for b in range(NB):
                if grid[b][h] is not None:
                    continue
                lo = max((x for x in have), key=lambda x: -((b - x) % NB))
                hi = min((x for x in have), key=lambda x: (x - b) % NB)
                dl, dh = (b - lo) % NB, (hi - b) % NB
                w = dl / (dl + dh) if dl + dh else 0
                grid[b][h] = grid[lo][h] * (1 - w) + grid[hi][h] * w
                filled[b][h] = True
        return filled

    out = {
        "source": "NASA PDS Atmospheres Node - Mars 2020 MEDA (DER_PS, CAL_TIRS, DER_WS)",
        "sourceUrl": BASE,
        "note": "Hourly LMST means binned by solar longitude (10 deg). Cells with no "
                "measurement are interpolated between neighbouring seasons and listed in 'interpolated'.",
        "units": {"pressure": "Pa", "airT": "K (TIRS atmospheric channel)", "groundT": "K", "wind": "m/s", "windDir": "deg, direction wind blows FROM, clockwise from north"},
        "lsBinDeg": 10, "hours": 24,
        "solsSampled": len(recs), "sampleStep": STEP,
        "solRange": [min(r["sol"] for r in recs), max(r["sol"] for r in recs)],
        "interpolated": {},
        "lsMethod": "Ls computed from the sol with Mars24 (Allison & McEwen 2000) at local noon",
        "windNote": "MEDA wind retrievals are sparse in the archive (present on a minority of sampled sols), "
                    "so most wind cells are interpolated between seasons; see 'interpolated'.",
    }
    for f in fields:
        grid = [[(c[0] / c[1] if c[1] else None) for c in row] for row in acc[f]]
        filled = fill(grid)
        out[f] = [[(round(v, 2) if v is not None else None) for v in row] for row in grid]
        out["interpolated"][f] = sum(sum(r) for r in filled)
    dgrid = [[(round(math.degrees(math.atan2(c[0], c[1])) % 360, 1) if (c[0] or c[1]) else None) for c in row] for row in dacc]
    out["windDir"] = dgrid
    # per-sol daily summary: the actual weather Perseverance logged that sol
    out["daily"] = [{
        "sol": r["sol"], "ls": round(r["ls"], 2),
        "pMean": _mean(r.get("pressure")),
        "tMin": _min(r.get("airT")), "tMax": _max(r.get("airT")),
        "gMin": _min(r.get("groundT")), "gMax": _max(r.get("groundT")),
        "windMax": _max(r.get("wind")),
    } for r in sorted(recs, key=lambda r: r["sol"])]

    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"DONE {len(recs)} sols -> {OUT} ({os.path.getsize(OUT) / 1e3:.0f} kB)", flush=True)


def _vals(a):
    return [v for v in (a or []) if v is not None]


def _mean(a):
    v = _vals(a)
    return round(sum(v) / len(v), 2) if v else None


def _min(a):
    v = _vals(a)
    return round(min(v), 2) if v else None


def _max(a):
    v = _vals(a)
    return round(max(v), 2) if v else None


if __name__ == "__main__":
    main()
