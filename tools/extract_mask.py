#!/usr/bin/env python3
"""
Bake a validity mask for the Jezero base tile.

The base tile is stitched from six HiRISE stereo pairs, so the corners of the
rectangular window fall outside their union and were gap-filled during
extraction. The game must be able to say which ground is measured and which is
interpolated, rather than presenting both as data.

NoData boundaries are large and smooth, so an 8 m/px mask is ample and costs
a quarter of the bandwidth of the elevation pass.
"""
import json, os, struct, sys, time, zlib
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_dtm import parse_header, read_range, OUT
from concurrent.futures import ThreadPoolExecutor

X0, Y0, WIN_W, WIN_H, STEP = 0, 8192, 16384, 8192, 8

def write_png8(path, arr):
    h, w = arr.shape
    rows = np.ascontiguousarray(arr.astype(np.uint8))
    prev = np.empty_like(rows); prev[0] = 0; prev[1:] = rows[:-1]
    filt = (rows.astype(np.int16) - prev.astype(np.int16)).astype(np.uint8)
    raw = np.hstack([np.full((h, 1), 2, np.uint8), filt]).tobytes()
    def chunk(k, d):
        c = struct.pack(">I", len(d)) + k + d
        return c + struct.pack(">I", zlib.crc32(k + d) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))
    return os.path.getsize(path)

def main():
    hdr = parse_header()
    out_w, out_h = WIN_W // STEP, WIN_H // STEP
    mask = np.zeros((out_h, out_w), dtype=np.uint8)
    byte_len = WIN_W * 4
    done = [0]; t0 = time.time()

    def fetch(j):
        y = Y0 + j * STEP
        data = read_range(hdr["row_offsets"][y] + X0 * 4, byte_len)
        line = np.frombuffer(data, dtype="<f4", count=WIN_W)[::STEP]
        mask[j] = np.where(line < -1e30, 0, 255).astype(np.uint8)
        done[0] += 1
        if done[0] % 256 == 0:
            print(f"    mask {done[0]}/{out_h}  {done[0]*byte_len/1e6:.0f} MB  "
                  f"{done[0]*byte_len/1e6/(time.time()-t0):.2f} MB/s", flush=True)

    print(f"  mask window -> {out_w}x{out_h} @ {STEP} m/px  ({out_h*byte_len/1e6:.0f} MB)", flush=True)
    with ThreadPoolExecutor(max_workers=32) as ex:
        list(ex.map(fetch, range(out_h)))

    valid = int((mask > 0).sum()); total = mask.size
    n = write_png8(os.path.join(OUT, "jezero_base_mask.png"), mask)
    meta = {
        "width": out_w, "height": out_h, "metresPerPixel": STEP * hdr["px_scale"],
        "covers": "jezero_base", "validFraction": valid / total,
        "gapFraction": 1 - valid / total,
        "encoding": "8-bit greyscale; 255 = measured DTM, 0 = gap-filled",
    }
    json.dump(meta, open(os.path.join(OUT, "jezero_base_mask.json"), "w"), indent=2)
    print(f"  MASK DONE {out_w}x{out_h}  valid={100*valid/total:.2f}%  "
          f"gap={100*(1-valid/total):.2f}%  png={n/1e3:.0f} KB", flush=True)

if __name__ == "__main__":
    main()
