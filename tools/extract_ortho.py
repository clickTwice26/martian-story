#!/usr/bin/env python3
"""
Bake surface-brightness (albedo) maps from the USGS Mars 2020 TRN HiRISE
orthomosaic, registered pixel-for-pixel to the DTM the game already uses.

The orthomosaic is 85600 x 85952 px at 0.25 m/px (7.4 GB), uncompressed 8-bit
with one row per strip, and its grid origin x equals the DTM tile's xLeft
exactly. So, like extract_dtm.py, we range-fetch only the rows we need.

A photograph is not an albedo map: it carries the shading and shadows of the
moment HiRISE took it, and the game lights the DTM itself. We therefore fit
the image brightness against the measured DTM surface normal (a linear
Lambert model, b = c0 + c . n) and subtract the fitted shading term, leaving
the brightness that the slope does not explain - the albedo pattern of dark
sand, bright bedrock and the delta units. Different HiRISE images in the
mosaic carry different stretches, so very large-scale brightness is flattened
by half (in log space) to hide seams between them.

Source : https://www.usgs.gov/data/mars-2020-terrain-relative-navigation-hirise-dtm-mosaic
Product: JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif
Output : data/jezero_albedo.jpg (+ .json) covering jezero_base at 2 m/px
         data/jezero_albedo_near.jpg (+ .json) covering a 2048 m window at 0.5 m/px
Encoding: 8-bit; 128 = the tile's median albedo, value/128 = relative albedo;
          0..3 = no image (fall back to the procedural surface).
"""
import json, os, struct, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

URL = ("https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/"
       "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif")
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
PX = 0.25


def read_range(start, length, retries=6):
    for a in range(retries):
        try:
            req = urllib.request.Request(URL, headers={"Range": f"bytes={start}-{start + length - 1}"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception:
            if a == retries - 1:
                raise
            time.sleep(1.5 * (a + 1))


def parse_bigtiff():
    b = read_range(0, 1 << 16)
    assert b[:2] == b"II" and struct.unpack("<H", b[2:4])[0] == 43, "expected little-endian BigTIFF"
    ifd = struct.unpack("<Q", b[8:16])[0]
    n = struct.unpack("<Q", b[ifd:ifd + 8])[0]
    tags = {}
    for i in range(n):
        p = ifd + 8 + i * 20
        tag, typ, cnt = struct.unpack("<HHQ", b[p:p + 12])
        tags[tag] = (typ, cnt, b[p + 12:p + 20])
    w = struct.unpack("<I", tags[256][2][:4])[0]
    h = struct.unpack("<I", tags[257][2][:4])[0]
    typ, cnt, raw = tags[273]                       # StripOffsets, one per row
    assert cnt == h and typ == 16, (typ, cnt)
    off = struct.unpack("<Q", raw)[0]
    table = read_range(off, cnt * 8)
    offsets = np.frombuffer(table, dtype="<u8")
    typ, cnt, raw = tags[33922]
    tie = struct.unpack("<6d", read_range(struct.unpack("<Q", raw)[0], 48))
    return {"w": w, "h": h, "offsets": offsets, "x0": tie[3], "y0": tie[4]}


def fetch_window(hdr, x0, y0, win_w, win_h, step, taps, name):
    """Average a step x step block per output pixel, sampling `taps` rows of each block."""
    out_w, out_h = win_w // step, win_h // step
    buf = np.zeros((out_h, out_w), np.float32)
    cnt = np.zeros((out_h, out_w), np.float32)
    rows_per = [int((k + 0.5) * step / taps) for k in range(taps)]
    jobs = [(j, r) for j in range(out_h) for r in rows_per]
    done = [0]
    t0 = time.time()
    print(f"  [{name}] {out_w}x{out_h} @ {step * PX} m/px, {len(jobs)} rows, "
          f"{len(jobs) * win_w / 1e6:.0f} MB to fetch", flush=True)

    def job(jr):
        j, r = jr
        y = y0 + j * step + r
        line = np.frombuffer(read_range(int(hdr["offsets"][y]) + x0, win_w), np.uint8)
        blk = line[:out_w * step].reshape(out_w, step).astype(np.float32)
        valid = blk > 0
        s = (blk * valid).sum(1)
        c = valid.sum(1)
        return j, s, c

    with ThreadPoolExecutor(max_workers=48) as ex:
        for j, s, c in ex.map(job, jobs):
            buf[j] += s
            cnt[j] += c
            done[0] += 1
            if done[0] % 2000 == 0:
                el = time.time() - t0
                print(f"    {done[0]}/{len(jobs)}  {done[0] * win_w / 1e6 / el:.1f} MB/s", flush=True)
    valid = cnt >= 0.5 * step * taps
    img = np.where(valid, buf / np.maximum(cnt, 1), 0)
    return img, valid


def load_dtm(name):
    meta = json.load(open(os.path.join(DATA, f"{name}.json")))
    im = Image.open(os.path.join(DATA, f"{name}.png"))
    a = np.asarray(im).astype(np.float32)
    z = meta["elevMin"] + a / 65535.0 * (meta["elevMax"] - meta["elevMin"])
    return z, meta


def box_blur(a, r):
    """Separable box blur with an integral image; r in pixels."""
    if r < 1:
        return a.copy()
    def run(x, axis):
        c = np.cumsum(np.pad(x, [(r + 1, r) if ax == axis else (0, 0) for ax in range(2)], mode="edge"), axis=axis)
        hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
        lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
        return (hi - lo) / (2 * r + 1)
    return run(run(a, 0), 1)


def deshade(img, valid, z, mpp):
    """Remove the brightness the measured slope explains; return relative albedo."""
    gy, gx = np.gradient(z, mpp)
    nx, nz = -gx, gy                       # image rows run south; ny ~ 1
    inv = 1 / np.sqrt(1 + nx * nx + nz * nz)
    nx, nz, ny = nx * inv, nz * inv, inv
    lb = np.log(np.maximum(img, 1))
    # fit on a sparse grid of valid pixels
    sel = valid.copy()
    sel[::, :] &= (np.random.default_rng(1).random(sel.shape) < min(1, 400000 / max(1, sel.sum())))
    A = np.stack([np.ones(sel.sum()), nx[sel], nz[sel], ny[sel]], 1)
    coef, *_ = np.linalg.lstsq(A, lb[sel], rcond=None)
    pred = A @ coef
    ss = ((lb[sel] - lb[sel].mean()) ** 2).sum()
    r2 = 1 - ((lb[sel] - pred) ** 2).sum() / ss
    shade = coef[1] * nx + coef[2] * nz + coef[3] * ny
    shade -= shade[valid].mean()
    la = lb - shade
    print(f"    shading fit: sun-vector coef {coef[1:]}, R^2 {r2:.3f} (share of brightness the slope explains)", flush=True)
    return la


def encode(la, valid, mpp, name, meta_extra, ref_median=None):
    # halve very-large-scale brightness (seams between source images) in log space
    r = max(1, int(round(400 / mpp)))
    fill = np.where(valid, la, np.median(la[valid]))
    low = box_blur(fill, r)
    la2 = la - 0.5 * (low - np.median(low[valid]))
    med = np.median(la2[valid]) if ref_median is None else ref_median
    rel = np.exp(la2 - med)                       # 1.0 = median albedo
    v = np.clip(np.rint(rel * 128), 4, 255).astype(np.uint8)
    v[~valid] = 0
    path = os.path.join(DATA, f"{name}.jpg")
    Image.fromarray(v, "L").save(path, quality=88, optimize=True)
    meta = {
        "name": name, "width": v.shape[1], "height": v.shape[0], "metresPerPixel": mpp,
        "encoding": "8-bit; relative albedo = value/128 (128 = tile median); <=3 = no image",
        "validFraction": float(valid.mean()),
        "source": "USGS Mars 2020 TRN HiRISE orthomosaic (JEZ_hirise_soc_006_orthoMosaic_25cm, first)",
        "sourceUrl": "https://www.usgs.gov/data/mars-2020-terrain-relative-navigation-hirise-dtm-mosaic",
        "processing": "block-averaged from 0.25 m, DTM-slope shading regressed out (log-linear Lambert), "
                      "400 m-scale brightness halved to suppress inter-image seams",
        **meta_extra,
    }
    json.dump(meta, open(os.path.join(DATA, f"{name}.json"), "w"), indent=2)
    print(f"  [{name}] -> {path} {os.path.getsize(path) / 1e6:.1f} MB, valid {valid.mean() * 100:.1f}%", flush=True)
    return med


def main():
    hdr = parse_bigtiff()
    print(f"ortho {hdr['w']}x{hdr['h']} origin ({hdr['x0']}, {hdr['y0']})", flush=True)

    # ---- base tile: 2 m/px over the 16384 x 8192 m jezero_base window ---------
    z, meta = load_dtm("jezero_base")
    xl, yt = meta["projected"]["xLeft"], meta["projected"]["yTop"]
    x0 = int(round((xl - hdr["x0"]) / PX))
    y0 = int(round((hdr["y0"] - yt) / PX))
    step = int(round(meta["metresPerPixel"] / PX))
    img, valid = fetch_window(hdr, x0, y0, int(meta["widthMetres"] / PX), int(meta["heightMetres"] / PX),
                              step, taps=2, name="albedo_base")
    la = deshade(img, valid, z, meta["metresPerPixel"])
    med = encode(la, valid, meta["metresPerPixel"], "jezero_albedo",
                 {"covers": "jezero_base", "projected": meta["projected"]})

    # ---- near window: 0.5 m/px over the jezero_detail 2048 m window -----------
    zd, md = load_dtm("jezero_detail")
    xl, yt = md["projected"]["xLeft"], md["projected"]["yTop"]
    x0 = int(round((xl - hdr["x0"]) / PX))
    y0 = int(round((hdr["y0"] - yt) / PX))
    img, valid = fetch_window(hdr, x0, y0, int(md["widthMetres"] / PX), int(md["heightMetres"] / PX),
                              2, taps=2, name="albedo_near")
    # DTM at 1 m -> upsample normals to 0.5 m by repetition
    zu = np.repeat(np.repeat(zd, 2, 0), 2, 1)
    la = deshade(img, valid, zu, 0.5)
    encode(la, valid, 0.5, "jezero_albedo_near",
           {"projected": md["projected"], "widthMetres": md["widthMetres"], "heightMetres": md["heightMetres"]},
           ref_median=None)


if __name__ == "__main__":
    main()
