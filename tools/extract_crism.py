#!/usr/bin/env python3
"""
Bake a mineral map of the HiRISE tile from MRO CRISM orbital spectroscopy.

Every CRISM targeted observation over the tile has map-projected browse
products (MTRDR, Viviano-Beck et al. 2014 summary parameters, byte-scaled):
  MAF  OLINDEX3 (olivine), LCPINDEX2, HCPINDEX2 (pyroxenes)
  CAR  D2300, BD2500_2 (Mg carbonate), BD1900_2
  HYD  SINDEX2 (polyhydrated sulfate), BD2100_2, BD1900_2 (bound water)
We undo the byte scaling to get the real parameter values, reproject each
observation onto the jezero_base grid at 8 m/px, keep the strongest value
where observations overlap, and pack three indicator channels:

  R  olivine           OLINDEX3                         (0..0.30 -> 0..255)
  G  Mg carbonate      min(D2300/0.04, BD2500_2/0.02)  (0..1    -> 0..255)
  B  hydrated minerals max(SINDEX2/0.06, BD1900_2/0.04)(0..1    -> 0..255)
  A  255 where at least one CRISM observation covers the pixel

These are spectral *indicators*, not confirmed identifications; CRISM's own
documentation says so and the game says so too. Jezero's olivine-carbonate
floor unit and the hydrated/carbonate delta should be clearly visible.

Source : PDS Geosciences Node, MRO-M-CRISM-5-RDR-MPTARGETED-V1.0 (no login)
         found through the ODE REST API (oderest.rsl.wustl.edu)
Output : data/jezero_minerals.png (+ .json)
"""
import json, math, os, re, time, urllib.request

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
ODE = ("https://oderest.rsl.wustl.edu/live2/?query=product&results=f&output=JSON&target=mars"
       "&ihid=MRO&iid=CRISM&pt=MTRDR&westernlon={w}&easternlon={e}&minlat={s}&maxlat={n}&limit=100")
R_GAME = 3396190.0
MPP = 8.0


def get(url, retries=5):
    for a in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "martian-story-data-tools/1.0"}), timeout=120) as r:
                return r.read()
        except Exception:
            if a == retries - 1:
                raise
            time.sleep(2 * (a + 1))


def pds3(text):
    """Flat KEY = VALUE parse of the parts of a PDS3 label we need."""
    out = {}
    for m in re.finditer(r"^\s*([A-Z_:^0-9]+)\s*=\s*(\([^)]*\)|\"[^\"]*\"|[^\n]*)", text, re.M):
        k, v = m.group(1), m.group(2).strip()
        if k in out and k in ("LINES", "LINE_SAMPLES", "BANDS"):
            continue
        out.setdefault(k, v)
    return out


def num(v):
    return float(re.match(r"[-+0-9.Ee]+", v.strip()).group(0))


def tup(v):
    return [x.strip().strip('"') for x in v.strip("() ").split(",")]


def load_browse(img_url, lbl_url):
    L = pds3(get(lbl_url).decode("latin-1"))
    lines, samples, bands = int(num(L["LINES"])), int(num(L["LINE_SAMPLES"])), int(num(L["BANDS"]))
    names = tup(L["BAND_NAME"])
    scale = [float(x) for x in tup(L["SCALING_FACTOR"])]
    offset = [float(x) for x in tup(L["OFFSET"])]
    raw = np.frombuffer(get(img_url), np.uint8)[: lines * samples * bands].reshape(bands, lines, samples)
    # 255 marks pixels outside the scene (the PNG twin carries it as alpha)
    vals = {n: np.where(raw[i] < 255, raw[i] * s + o, np.nan)
            for i, (n, s, o) in enumerate(zip(names, scale, offset))}
    proj = {
        "res": num(L["MAP_RESOLUTION"]), "clat": num(L["CENTER_LATITUDE"]), "clon": num(L["CENTER_LONGITUDE"]),
        "loff": num(L["LINE_PROJECTION_OFFSET"]), "soff": num(L["SAMPLE_PROJECTION_OFFSET"]),
        "lines": lines, "samples": samples,
    }
    return vals, proj


def to_grid(vals, proj, lat, lon):
    """Nearest-neighbour sample of a browse band set at grid lat/lon (degrees)."""
    line = proj["loff"] - lat * proj["res"]                    # 0-based line
    samp = (lon - proj["clon"]) * proj["res"] * math.cos(math.radians(proj["clat"])) + proj["soff"]
    li, si = np.rint(line).astype(int), np.rint(samp).astype(int)
    ok = (li >= 0) & (li < proj["lines"]) & (si >= 0) & (si < proj["samples"])
    out = {}
    for k, a in vals.items():
        g = np.full(lat.shape, np.nan, np.float32)
        g[ok] = a[li[ok], si[ok]]
        out[k] = g
    return out


def main():
    base = json.load(open(os.path.join(DATA, "jezero_base.json")))
    W = int(base["widthMetres"] / MPP); H = int(base["heightMetres"] / MPP)
    xs = base["projected"]["xLeft"] + (np.arange(W) + 0.5) * MPP
    ys = base["projected"]["yTop"] - (np.arange(H) + 0.5) * MPP
    X, Y = np.meshgrid(xs, ys)
    lon = np.degrees(X / R_GAME); lat = np.degrees(Y / R_GAME)

    q = ODE.format(w=base["lonLeft"], e=base["lonRight"], s=base["latBottom"], n=base["latTop"])
    prods = json.loads(get(q))["ODEResults"]["Products"]["Product"]
    prods = prods if isinstance(prods, list) else [prods]
    print(f"{len(prods)} CRISM MTRDR observations over the tile", flush=True)

    best = {k: np.full((H, W), np.nan, np.float32) for k in ("OLINDEX3", "D2300", "BD2500_2", "SINDEX2", "BD1900_2")}
    used = []
    for p in prods:
        files = p["Product_files"]["Product_file"]
        files = files if isinstance(files, list) else [files]
        urls = {f["FileName"].lower(): f["URL"] for f in files}
        got = False
        for kind in ("maf", "car", "hyd"):
            img = next((u for n, u in urls.items() if re.search(rf"_br{kind}j_mtr3\.img$", n)), None)
            lbl = next((u for n, u in urls.items() if re.search(rf"_br{kind}j_mtr3\.lbl$", n)), None)
            if not (img and lbl):
                continue
            vals, proj = load_browse(img, lbl)
            g = to_grid(vals, proj, lat, lon)
            for k, a in g.items():
                if k in best:
                    best[k] = np.fmax(best[k], a)
            got = True
        if got:
            used.append(p.get("pdsid") or p.get("PDSID") or re.sub(r"_br\w+$", "", os.path.basename(img).split(".")[0]))
            print(f"  {used[-1]}", flush=True)

    cover = np.isfinite(best["OLINDEX3"]) | np.isfinite(best["D2300"]) | np.isfinite(best["SINDEX2"])
    z = lambda a: np.nan_to_num(a, nan=0.0)
    oli = np.clip(z(best["OLINDEX3"]) / 0.30, 0, 1)
    carb = np.clip(np.minimum(z(best["D2300"]) / 0.04, z(best["BD2500_2"]) / 0.02), 0, 1)
    hyd = np.clip(np.maximum(z(best["SINDEX2"]) / 0.06, z(best["BD1900_2"]) / 0.04), 0, 1)
    rgba = np.stack([oli, carb, hyd, cover.astype(np.float32)], -1)
    rgba = np.rint(rgba * 255).astype(np.uint8)
    path = os.path.join(DATA, "jezero_minerals.png")
    Image.fromarray(rgba, "RGBA").save(path, optimize=True)

    def stat(a):
        v = a[cover]
        return {"p50": float(np.percentile(v, 50)), "p95": float(np.percentile(v, 95)), "p99": float(np.percentile(v, 99))}

    meta = {
        "name": "jezero_minerals", "width": W, "height": H, "metresPerPixel": MPP, "covers": "jezero_base",
        "channels": {
            "r": "olivine indicator: OLINDEX3 / 0.30",
            "g": "Mg-carbonate indicator: min(D2300/0.04, BD2500_2/0.02)",
            "b": "hydrated-mineral indicator (sulfate / bound water): max(SINDEX2/0.06, BD1900_2/0.04)",
            "a": "255 = covered by at least one CRISM observation",
        },
        "caveat": "Spectral summary parameters are indicators, not mineral identifications (Viviano-Beck et al. 2014).",
        "coverage": float(cover.mean()),
        "stats": {"olivine": stat(oli), "carbonate": stat(carb), "hydrated": stat(hyd)},
        "observations": used,
        "source": "MRO CRISM MTRDR browse products (MRO-M-CRISM-5-RDR-MPTARGETED-V1.0), PDS Geosciences Node",
        "sourceUrl": "https://pds-geosciences.wustl.edu/missions/mro/crism.htm",
    }
    json.dump(meta, open(os.path.join(DATA, "jezero_minerals.json"), "w"), indent=2)
    print(f"DONE {path} {os.path.getsize(path) / 1e3:.0f} kB, coverage {cover.mean() * 100:.1f}%", flush=True)
    print(json.dumps(meta["stats"]), flush=True)


if __name__ == "__main__":
    main()
