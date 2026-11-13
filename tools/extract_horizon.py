#!/usr/bin/env python3
"""
Bake the far field: the rest of Jezero crater, its rim and the plains beyond,
so the horizon past the 16 x 8 km HiRISE tile is real terrain instead of fog.

Sources, best first (all public, no login, range-fetched by row):
  1. JPL / USGS Mars 2020 science CTX DEM of Jezero crater, 20 m/px, 89 x 101 km
     M20_JezeroCrater_CTXDEM_20m.tif (Equirectangular, standard parallel 18.4663)
  2. MGS MOLA global DEM, 463 m/px (fills the strip west of the CTX DEM)
     Mars_MGS_MOLA_DEM_mosaic_global_463m.tif
  Albedo: JPL CTX orthomosaic of Jezero, 5 m/px (M20_JezeroCrater_CTXortho_mosaic_5m.tif)

All three are relative to the MOLA areoid, like the HiRISE DTM, so no datum
shift is applied. The far grid is laid out in the HiRISE tile's own projection
(Equirectangular, latTs 0: x = R*lon, y = R*lat), so its metres are the game's
metres and its texels line up with jezero_base.

Output : data/jezero_far.png (16-bit) + data/jezero_far.json
         data/jezero_far_albedo.jpg (8-bit relative albedo, 128 = median, 0 = none)
"""
import json, math, os, struct, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

import importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
_spec = importlib.util.spec_from_file_location("extract_dtm", os.path.join(HERE, "extract_dtm.py"))
_dtm = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_dtm)
write_png16 = _dtm.write_png16

R = 3396190.0
S3 = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/"
CTX_DEM = S3 + "mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif"
CTX_ORT = S3 + "mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXortho_mosaic_5m.tif"
MOLA = S3 + "Mars_MGS_MOLA_DEM_mosaic_global_463m.tif"

FAR_MPP = 80.0          # height grid
ALB_MPP = 40.0          # albedo grid
HALF = 48000.0          # metres either side of the HiRISE tile centre


def rng(url, a, n, retries=6):
    for k in range(retries):
        try:
            req = urllib.request.Request(url, headers={"Range": f"bytes={a}-{a + n - 1}"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception:
            if k == retries - 1:
                raise
            time.sleep(1.5 * (k + 1))


def tiff(url):
    """Classic little-endian TIFF, one row per strip, uncompressed."""
    b = rng(url, 0, 16)
    assert b[:2] == b"II" and struct.unpack("<H", b[2:4])[0] == 42
    ifd = struct.unpack("<I", b[4:8])[0]
    b = rng(url, ifd, 4096)
    n = struct.unpack("<H", b[:2])[0]
    t = {}
    for i in range(n):
        p = 2 + i * 12
        tag, typ, cnt = struct.unpack("<HHI", b[p:p + 8])
        t[tag] = (typ, cnt, b[p + 8:p + 12])

    def val(tag):
        typ, cnt, raw = t[tag]
        return struct.unpack("<I" if typ == 4 else "<H", raw[:4 if typ == 4 else 2])[0]

    def arr(tag, fmt, size):
        typ, cnt, raw = t[tag]
        if cnt * size <= 4:
            return struct.unpack("<" + fmt * cnt, raw[:cnt * size])
        return struct.unpack("<" + fmt * cnt, rng(url, struct.unpack("<I", raw)[0], cnt * size))

    assert val(259) == 1 and val(278) == 1, "need uncompressed, one row per strip"
    typ = t[273][0]
    offs = arr(273, "I" if typ == 4 else "H", 4 if typ == 4 else 2)
    bits, fmt = val(258), val(339) if 339 in t else 1
    dtype = {(32, 3): "<f4", (16, 2): "<i2", (16, 1): "<u2", (8, 1): "u1"}[(bits, fmt)]
    scale = arr(33550, "d", 8)
    tie = arr(33922, "d", 8)
    return {"url": url, "w": val(256), "h": val(257), "offs": offs, "dtype": np.dtype(dtype),
            "px": scale[0], "x0": tie[3], "y0": tie[4]}


def read_rows(h, rows, workers=32):
    out = {}
    rb = h["w"] * h["dtype"].itemsize

    def job(y):
        return y, np.frombuffer(rng(h["url"], h["offs"][y], rb), h["dtype"]).astype(np.float32)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        for y, line in ex.map(job, sorted(set(rows))):
            out[y] = line
    return out


def sample(h, rows_cache, px, py, nodata):
    """Bilinear sample of image pixel coords (px, py); NaN where nodata or outside."""
    keys = sorted(rows_cache)
    stack = np.stack([rows_cache[y] for y in keys])
    lut = np.full(h["h"] + 2, -1, np.int64)
    lut[np.array(keys)] = np.arange(len(keys))
    x0 = np.floor(px).astype(int); y0 = np.floor(py).astype(int)
    fx = px - x0; fy = py - y0
    res = np.full(px.shape, np.nan, np.float32)
    ok = (x0 >= 0) & (y0 >= 0) & (x0 + 1 < h["w"]) & (y0 + 1 < h["h"])
    ok[ok] &= (lut[y0[ok]] >= 0) & (lut[y0[ok] + 1] >= 0)
    idx = np.nonzero(ok)
    acc = np.zeros(len(idx[0]), np.float32); wsum = np.zeros_like(acc)
    for dy in (0, 1):
        for dx in (0, 1):
            w = (fx[idx] if dx else 1 - fx[idx]) * (fy[idx] if dy else 1 - fy[idx])
            v = stack[lut[y0[idx] + dy], x0[idx] + dx]
            good = np.isfinite(v) & (v > nodata)
            acc += np.where(good, v * w, 0); wsum += np.where(good, w, 0)
    vals = np.where(wsum > 0.5, acc / np.maximum(wsum, 1e-6), np.nan)
    res[idx] = vals
    return res


def main():
    base = json.load(open(os.path.join(DATA, "jezero_base.json")))
    cx = base["projected"]["xLeft"] + base["widthMetres"] / 2
    cy = base["projected"]["yTop"] - base["heightMetres"] / 2
    xL = math.floor((cx - HALF) / FAR_MPP) * FAR_MPP
    yT = math.ceil((cy + HALF) / FAR_MPP) * FAR_MPP
    N = int(2 * HALF / FAR_MPP)
    gx = xL + (np.arange(N) + 0.5) * FAR_MPP
    gy = yT - (np.arange(N) + 0.5) * FAR_MPP
    X, Y = np.meshgrid(gx, gy)
    lon, lat = X / R, Y / R                      # radians

    # ---- 1. JPL CTX DEM (standard parallel 18.4663) ----------------------------
    ctx = tiff(CTX_DEM)
    k = R * math.cos(math.radians(18.4663))
    px = (k * lon - ctx["x0"]) / ctx["px"] - 0.5
    py = (ctx["y0"] - R * lat) / ctx["px"] - 0.5
    need = np.unique(np.concatenate([np.floor(py).astype(int), np.floor(py).astype(int) + 1]).ravel())
    need = need[(need >= 0) & (need < ctx["h"])]
    print(f"CTX DEM {ctx['w']}x{ctx['h']} @ {ctx['px']} m: fetching {len(need)} rows", flush=True)
    rows = read_rows(ctx, need)
    z_ctx = sample(ctx, rows, px, py, nodata=-1e30)

    # ---- 2. MOLA 463 m ---------------------------------------------------------
    mola = tiff(MOLA)
    # global simple cylindrical, x = R*lon from -180
    mpx = (R * lon - mola["x0"]) / mola["px"] - 0.5
    mpy = (mola["y0"] - R * lat) / mola["px"] - 0.5
    need = np.unique(np.concatenate([np.floor(mpy).astype(int), np.floor(mpy).astype(int) + 1]).ravel())
    print(f"MOLA {mola['w']}x{mola['h']} @ {mola['px']:.1f} m: fetching {len(need)} rows", flush=True)
    mrows = read_rows(mola, need)
    z_mola = sample(mola, mrows, mpx, mpy, nodata=-1e9)

    # Feather CTX into MOLA over ~2 km so the seam is not a step.
    have = np.isfinite(z_ctx)
    dist = np.where(have, 0.0, 1.0)
    w = have.astype(np.float32)
    for _ in range(int(2000 / FAR_MPP)):          # erode the CTX weight inward
        e = w.copy()
        e[1:, :] = np.minimum(e[1:, :], w[:-1, :]); e[:-1, :] = np.minimum(e[:-1, :], w[1:, :])
        e[:, 1:] = np.minimum(e[:, 1:], w[:, :-1]); e[:, :-1] = np.minimum(e[:, :-1], w[:, 1:])
        w = 0.5 * (w + e) * have
    zc = np.where(have, z_ctx, 0)
    zm = np.where(np.isfinite(z_mola), z_mola, np.nanmedian(z_mola))
    z = w * zc + (1 - w) * zm
    print(f"  CTX coverage {have.mean() * 100:.1f}%, elev {z.min():.0f}..{z.max():.0f} m", flush=True)

    zmin, zmax = float(z.min()), float(z.max())
    u16 = np.clip(np.rint((z - zmin) / (zmax - zmin) * 65535), 0, 65535).astype(np.uint16)
    write_png16(os.path.join(DATA, "jezero_far.png"), u16)

    # ---- albedo from the CTX orthomosaic --------------------------------------
    NA = int(2 * HALF / ALB_MPP)
    ax = xL + (np.arange(NA) + 0.5) * ALB_MPP
    ay = yT - (np.arange(NA) + 0.5) * ALB_MPP
    AX, AY = np.meshgrid(ax, ay)
    ort = tiff(CTX_ORT)
    print(f"CTX ortho {ort['w']}x{ort['h']} @ {ort['px']} m, dtype {ort['dtype']}", flush=True)
    opx = (k * AX / R - ort["x0"]) / ort["px"] - 0.5
    opy = (ort["y0"] - AY) / ort["px"] - 0.5
    # average a few rows per output row to tame aliasing (40 m from 5 m)
    taps = (-3, 0, 3)
    need = set()
    for t in taps:
        r = np.floor(opy[:, 0] + t).astype(int)
        need.update(r.tolist()); need.update((r + 1).tolist())
    need = [r for r in need if 0 <= r < ort["h"]]
    print(f"  fetching {len(need)} ortho rows", flush=True)
    orows = read_rows(ort, need)
    acc = np.zeros(AX.shape, np.float32); cnt = np.zeros(AX.shape, np.float32)
    for t in taps:
        for s in (-3, 0, 3):
            v = sample(ort, orows, opx + s, opy + t, nodata=0.5)
            g = np.isfinite(v)
            acc += np.where(g, v, 0); cnt += g
    img = np.where(cnt >= 3, acc / np.maximum(cnt, 1), np.nan)
    valid = np.isfinite(img)

    # deshade against the far DEM (upsampled to the albedo grid)
    zu = np.repeat(np.repeat(z, 2, 0), 2, 1)[:NA, :NA]
    gyy, gxx = np.gradient(zu, ALB_MPP)
    inv = 1 / np.sqrt(1 + gxx ** 2 + gyy ** 2)
    nx, nz, ny = -gxx * inv, gyy * inv, inv
    lb = np.log(np.maximum(np.where(valid, img, 1), 1))
    sel = valid & (np.random.default_rng(2).random(valid.shape) < 0.25)
    A = np.stack([np.ones(sel.sum()), nx[sel], nz[sel], ny[sel]], 1)
    coef, *_ = np.linalg.lstsq(A, lb[sel], rcond=None)
    shade = coef[1] * nx + coef[2] * nz + coef[3] * ny
    la = lb - (shade - shade[valid].mean())
    rel = np.exp(la - np.median(la[valid]))
    v8 = np.clip(np.rint(rel * 128), 4, 255).astype(np.uint8)
    v8[~valid] = 0
    Image.fromarray(v8, "L").save(os.path.join(DATA, "jezero_far_albedo.jpg"), quality=86, optimize=True)

    meta = {
        "name": "jezero_far", "width": N, "height": N, "metresPerPixel": FAR_MPP,
        "widthMetres": N * FAR_MPP, "heightMetres": N * FAR_MPP,
        "elevMin": zmin, "elevMax": zmax,
        "elevEncoding": "uint16 linear; metres = elevMin + v/65535*(elevMax-elevMin)",
        "projected": {"xLeft": xL, "yTop": yT},
        "lonLeft": math.degrees(xL / R), "lonRight": math.degrees((xL + N * FAR_MPP) / R),
        "latTop": math.degrees(yT / R), "latBottom": math.degrees((yT - N * FAR_MPP) / R),
        "ctxCoverage": float(have.mean()),
        "albedo": {"file": "jezero_far_albedo.jpg", "width": NA, "height": NA, "metresPerPixel": ALB_MPP,
                   "encoding": "8-bit; relative albedo = value/128; 0 = none", "validFraction": float(valid.mean())},
        "sources": [
            {"name": "JPL/USGS Mars 2020 CTX DEM of Jezero crater, 20 m", "url": CTX_DEM},
            {"name": "MGS MOLA global DEM, 463 m (fill west of the CTX DEM)", "url": MOLA},
            {"name": "JPL/USGS Mars 2020 CTX orthomosaic of Jezero crater, 5 m (albedo)", "url": CTX_ORT},
        ],
    }
    json.dump(meta, open(os.path.join(DATA, "jezero_far.json"), "w"), indent=2)
    print("DONE", json.dumps({k: meta[k] for k in ("lonLeft", "lonRight", "latTop", "latBottom", "elevMin", "elevMax")}), flush=True)


if __name__ == "__main__":
    main()
