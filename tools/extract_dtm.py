#!/usr/bin/env python3
"""
Extract playable heightmaps from the USGS Mars 2020 TRN HiRISE DTM mosaic of
Jezero Crater, without downloading all 1.84 GB of it.

The source GeoTIFF is uncompressed 32-bit float with RowsPerStrip=1, and S3
honours byte ranges, so any individual raster row is a contiguous byte run that
can be fetched on its own. We fetch only the rows we need, decimate, and bake
16-bit PNG heightmaps plus JSON georeferencing sidecars.

Source : https://www.usgs.gov/data/mars-2020-terrain-relative-navigation-hirise-dtm-mosaic
Product: JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif
"""
import json, math, os, struct, sys, time, zlib
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np

S3 = ("https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/"
      "HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif")

R_MARS = 3396190.0          # IAU Mars equatorial radius, matches the product's projection
NODATA = -3.4028226550889045e38
OUT    = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")

# ---------------------------------------------------------------- TIFF header
def read_range(start, length, retries=5):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(S3, headers={"Range": f"bytes={start}-{start+length-1}"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))


def parse_header():
    """Parse IFD, returning geometry plus the full per-row byte offset table."""
    b = read_range(0, 262144)
    assert b[:2] == b"II", "expected little-endian TIFF"
    ifd = struct.unpack("<I", b[4:8])[0]
    n = struct.unpack("<H", b[ifd:ifd + 2])[0]
    tags = {}
    for i in range(n):
        p = ifd + 2 + i * 12
        tag, typ, cnt = struct.unpack("<HHI", b[p:p + 8])
        raw = b[p + 8:p + 12]
        size = {1: 1, 3: 2, 4: 4, 12: 8}.get(typ, 1)
        fmt = {1: "B", 3: "H", 4: "I", 12: "d"}.get(typ, "B")
        if size * cnt <= 4:
            tags[tag] = struct.unpack("<" + fmt * cnt, raw[:size * cnt])
        else:
            off = struct.unpack("<I", raw)[0]
            need = off + size * cnt
            buf = b if need <= len(b) else b + read_range(len(b), need - len(b) + 8)
            tags[tag] = struct.unpack("<" + fmt * cnt, buf[off:off + size * cnt])
    w, h = tags[256][0], tags[257][0]
    assert tags[259][0] == 1, "expected uncompressed"
    assert tags[258][0] == 32 and tags[339][0] == 3, "expected 32-bit float samples"
    scale = tags[33550]
    tie = tags[33922]
    return {
        "w": w, "h": h,
        "row_offsets": tags[273],           # StripOffsets, one per row
        "row_bytes": tags[279][0],          # StripByteCounts
        "px_scale": scale[0],               # metres per pixel
        "x0": tie[3], "y0": tie[4],         # projected metres at raster (0,0)
    }


# ---------------------------------------------------------- 16-bit PNG writer
def write_png16(path, arr_u16):
    """Minimal 16-bit greyscale PNG. Avoids depending on Pillow's 16-bit path."""
    h, w = arr_u16.shape
    stride = w * 2
    rows = np.ascontiguousarray(arr_u16.astype(">u2")).view(np.uint8).reshape(h, stride)
    # Filter type 2 (Up): terrain is smooth vertically, so per-byte deltas
    # collapse to near-zero and deflate very well. Vectorised, not per-byte.
    prev = np.empty_like(rows)
    prev[0] = 0
    prev[1:] = rows[:-1]
    filt = (rows.astype(np.int16) - prev.astype(np.int16)).astype(np.uint8)
    raw = np.hstack([np.full((h, 1), 2, np.uint8), filt]).tobytes()

    def chunk(kind, data):
        c = struct.pack(">I", len(data)) + kind + data
        return c + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 16, 0, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(raw, 6)))
        f.write(chunk(b"IEND", b""))
    return os.path.getsize(path)


# --------------------------------------------------------------- the extractor
def extract(hdr, name, x0, y0, win_w, win_h, step, workers=32):
    """Fetch every `step`-th row over [y0, y0+win_h), keeping x in [x0, x0+win_w)."""
    out_w, out_h = win_w // step, win_h // step
    rows = [y0 + j * step for j in range(out_h)]
    byte_x0, byte_len = x0 * 4, win_w * 4
    buf = np.empty((out_h, out_w), dtype=np.float32)
    done = [0]
    t0 = time.time()

    def fetch(j):
        y = rows[j]
        data = read_range(hdr["row_offsets"][y] + byte_x0, byte_len)
        line = np.frombuffer(data, dtype="<f4", count=win_w)
        buf[j] = line[::step]
        done[0] += 1
        if done[0] % 256 == 0:
            el = time.time() - t0
            mb = done[0] * byte_len / 1e6
            pct = 100 * done[0] / out_h
            print(f"    {name}: {done[0]}/{out_h} rows ({pct:.0f}%)  "
                  f"{mb:.0f} MB  {mb/el:.2f} MB/s", flush=True)

    print(f"  [{name}] window x{x0}..{x0+win_w} y{y0}..{y0+win_h} step={step} "
          f"-> {out_w}x{out_h} @ {step} m/px  ({out_h*byte_len/1e6:.0f} MB to fetch)", flush=True)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(fetch, range(out_h)))

    # ---- NoData handling: fill from the nearest valid value, column then row ----
    bad = buf < -1e30
    nbad = int(bad.sum())
    if nbad:
        med = float(np.median(buf[~bad])) if (~bad).any() else 0.0
        buf[bad] = np.nan

        def ffill_rows(a):
            """Replace each NaN with the nearest preceding valid value in its row."""
            m = np.isnan(a)
            idx = np.where(~m, np.arange(a.shape[1])[None, :], 0)
            np.maximum.accumulate(idx, axis=1, out=idx)
            return np.take_along_axis(a, idx, axis=1)

        for _ in range(2):                       # rows, then columns
            buf = ffill_rows(buf)                        # left  -> right
            buf = ffill_rows(buf[:, ::-1])[:, ::-1]      # right -> left
            buf = buf.T.copy()                           # transpose, repeat
        buf = np.ascontiguousarray(buf)
        buf[np.isnan(buf)] = med                 # anything still unreachable

    zmin, zmax = float(buf.min()), float(buf.max())
    span = max(zmax - zmin, 1e-6)
    u16 = np.clip(np.rint((buf - zmin) / span * 65535.0), 0, 65535).astype(np.uint16)

    os.makedirs(OUT, exist_ok=True)
    png = os.path.join(OUT, f"{name}.png")
    nbytes = write_png16(png, u16)

    px = hdr["px_scale"]
    meta = {
        "name": name,
        "width": out_w, "height": out_h,
        "metresPerPixel": step * px,
        "widthMetres": win_w * px, "heightMetres": win_h * px,
        "elevMin": zmin, "elevMax": zmax,
        "elevEncoding": "uint16 linear; metres = elevMin + v/65535*(elevMax-elevMin)",
        "verticalPrecisionMetres": span / 65535.0,
        "projected": {"xLeft": hdr["x0"] + x0 * px, "yTop": hdr["y0"] - y0 * px},
        "lonLeft":  math.degrees((hdr["x0"] + x0 * px) / R_MARS),
        "lonRight": math.degrees((hdr["x0"] + (x0 + win_w) * px) / R_MARS),
        "latTop":    math.degrees((hdr["y0"] - y0 * px) / R_MARS),
        "latBottom": math.degrees((hdr["y0"] - (y0 + win_h) * px) / R_MARS),
        "marsRadius": R_MARS,
        "noDataFilled": nbad,
        "source": "USGS Mars 2020 TRN HiRISE DTM Mosaic (JEZ_hirise_soc_006, 1 m/px)",
        "sourceUrl": "https://www.usgs.gov/data/mars-2020-terrain-relative-navigation-hirise-dtm-mosaic",
    }
    with open(os.path.join(OUT, f"{name}.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print(f"  [{name}] DONE  {out_w}x{out_h}  elev {zmin:.1f}..{zmax:.1f} m "
          f"(span {span:.1f} m, precision {span/65535*100:.2f} cm)  "
          f"nodata_filled={nbad}  png={nbytes/1e6:.1f} MB", flush=True)
    return meta


def main():
    print("Parsing TIFF header...", flush=True)
    hdr = parse_header()
    print(f"  raster {hdr['w']}x{hdr['h']} @ {hdr['px_scale']} m/px, "
          f"origin ({hdr['x0']}, {hdr['y0']})", flush=True)
    offs = hdr["row_offsets"]
    contiguous = all(offs[i + 1] - offs[i] == hdr["row_bytes"] for i in range(0, 2000))
    print(f"  {len(offs)} row offsets, first={offs[0]}, "
          f"row_bytes={hdr['row_bytes']}, contiguous={contiguous}", flush=True)

    # Rover traverse occupies x 0..14238, y 10056..14780 (verified against
    # M20_waypoints.json). These windows centre on that band.
    results = {}
    results["jezero_base"]   = extract(hdr, "jezero_base",   x0=0,     y0=8192,  win_w=16384, win_h=8192,  step=2)
    results["jezero_detail"] = extract(hdr, "jezero_detail", x0=12488, y0=12294, win_w=2048,  win_h=2048,  step=1)

    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(results, f, indent=2)
    print("\nALL DONE ->", OUT, flush=True)


if __name__ == "__main__":
    main()
