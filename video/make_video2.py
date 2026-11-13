#!/usr/bin/env python3
"""Final edit: tour recording (from the magenta sync flash) + overlays + narration.

    python3 video/make_video2.py <voice.mp3> <recording.mov> [--offset S]

--offset shifts the narration later (+) or earlier (-) against the footage.
Output: video/martian_story_demo.mp4 (1080p, <= 239 s).
"""
import json, os, subprocess, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OV = os.path.join(HERE, "ov")
voice, rec = sys.argv[1], sys.argv[2]
offset = float(sys.argv[sys.argv.index("--offset") + 1]) if "--offset" in sys.argv else 0.0

def probe(path, entry):
    return subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", entry, "-of", "csv=p=0", path]).decode().strip()

dur_rec = float(probe(rec, "format=duration"))
w, h = [int(v) for v in probe(rec, "stream=width,height").split("\n")[0].split(",") if v][:2]

# ---- 1. find the magenta sync flash (first 150 s, 10 fps, tiny frames)
sw, sh = 64, 36
raw = subprocess.check_output(["ffmpeg", "-v", "error", "-t", "150", "-i", rec, "-vf", f"fps=10,scale={sw}:{sh}",
                               "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
fr = np.frombuffer(raw, np.uint8).reshape(-1, sh, sw, 3).astype(int)
mag = ((fr[..., 0] > 200) & (fr[..., 1] < 80) & (fr[..., 2] > 200)).mean((1, 2))
hits = np.where(mag > 0.4)[0]
if not len(hits):
    sys.exit("no magenta sync flash found in the first 150 s of the recording")
start = (hits[-1] + 1) / 10 + 0.05          # first frame after the flash
print(f"sync flash at {hits[0] / 10:.1f}s, footage starts at {start:.2f}s")

# ---- 2. crop box: the game area inside the browser window (bright, non-UI pixels)
frame = subprocess.check_output(["ffmpeg", "-v", "error", "-ss", str(min(start + 60, dur_rec - 1)), "-i", rec, "-frames:v", "1",
                                 "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
a = np.frombuffer(frame, np.uint8).reshape(h, w, 3).astype(int)
m = (a[..., 0] > 80) & (a[..., 0] > a[..., 2] + 25)
rows = np.where(m.mean(1) > 0.35)[0]; cols = np.where(m.mean(0) > 0.35)[0]
crop = ""
if len(rows) > h * 0.3 and len(cols) > w * 0.3:
    y0, y1, x0, x1 = rows.min() + 2, rows.max() - 2, cols.min() + 2, cols.max() - 2
    cw, ch = (x1 - x0) // 2 * 2, (y1 - y0) // 2 * 2
    if cw < w - 20 or ch < h - 20:
        crop = f"crop={cw}:{ch}:{x0}:{y0},"
print("crop", crop or "none")

# ---- 3. length: narration + 1.5 s, at most 239 s and what the footage holds
vdur = float(probe(voice, "format=duration"))
total = min(239.0, vdur + max(0.0, offset) + 1.5, dur_rec - start)
print(f"voice {vdur:.1f}s -> video {total:.1f}s")

# ---- 4. overlays
tl = json.load(open(os.path.join(OV, "timeline.json")))
inputs = ["-ss", f"{start:.3f}", "-t", f"{total:.3f}", "-i", rec, "-i", voice]
fc = [f"[0:v]{crop}scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuva420p[v0]"]
cur, k = "v0", 2
for i, o in enumerate(tl):
    t0, t1 = o["t0"], min(o["t1"], total)
    if t0 >= total:
        continue
    png = os.path.join(HERE, "title.png") if o["png"] == "team_card" else os.path.join(OV, o["png"])
    inputs += ["-loop", "1", "-t", f"{total:.3f}", "-i", png]
    fade = min(0.5, (t1 - t0) / 4)
    fc.append(f"[{k}:v]scale=1920:1080,format=rgba,fade=t=in:st={t0}:d={fade}:alpha=1,"
              f"fade=t=out:st={t1 - fade}:d={fade}:alpha=1[o{i}]")
    fc.append(f"[{cur}][o{i}]overlay=0:0:enable='between(t,{t0},{t1})'[v{i + 1}]")
    cur, k = f"v{i + 1}", k + 1
fc.append(f"[{cur}]fade=t=in:st=0:d=0.6,fade=t=out:st={total - 1.0}:d=1.0,format=yuv420p[vout]")
delay = int(max(0.0, offset) * 1000)
trim = f"atrim=start={-offset}," if offset < 0 else ""
fc.append(f"[1:a]{trim}adelay={delay}|{delay},loudnorm=I=-15:TP=-1.5:LRA=11,apad[aout]")

out = os.path.join(HERE, "martian_story_demo.mp4")
cmd = ["ffmpeg", "-y", "-v", "error", "-stats", *inputs, "-filter_complex", ";".join(fc),
       "-map", "[vout]", "-map", "[aout]", "-t", f"{total:.3f}",
       "-c:v", "h264_videotoolbox", "-b:v", "10M", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]
subprocess.run(cmd, check=True)
print("done:", out, probe(out, "format=duration"), "s")
