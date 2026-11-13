#!/usr/bin/env python3
"""
Turn record_tour.mjs frames into a 1920x1080 30 fps H.264 MP4, optionally
with a voice-over. The video is cut to the voice length (or kept at the
frame length if shorter) and never exceeds 240 s.

  python3 tools/make_video.py <framesDir> <out.mp4> [voice.mp3]
"""
import json, os, subprocess, sys

frames_dir, out = sys.argv[1], sys.argv[2]
voice = sys.argv[3] if len(sys.argv) > 3 else None
frames = json.load(open(os.path.join(frames_dir, "frames.json")))
lst = os.path.join(frames_dir, "concat.txt")
with open(lst, "w") as f:
    for a, b in zip(frames, frames[1:] + [None]):
        f.write(f"file '{os.path.abspath(a['f'])}'\n")
        f.write(f"duration {max(0.001, (b['t'] - a['t']) if b else 1 / 30):.4f}\n")
    f.write(f"file '{os.path.abspath(frames[-1]['f'])}'\n")
span = frames[-1]["t"] - frames[0]["t"]

def dur(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p],
                                capture_output=True, text=True).stdout.strip())

length = min(240.0, span)
cmd = ["ffmpeg", "-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", lst]
vf = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p"
if voice:
    vlen = dur(voice)
    length = min(240.0, vlen + 1.0)
    if length > span:                       # voice longer than footage: hold the last frame
        vf += f",tpad=stop_mode=clone:stop_duration={length - span:.2f}"
    cmd += ["-i", voice, "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k", "-af", "apad"]
vf += f",fade=t=out:st={max(0, length - 1.2):.2f}:d=1.2"
cmd += ["-vf", vf, "-t", f"{length:.2f}", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-movflags", "+faststart", out]
subprocess.run(cmd, check=True)
print(f"DONE {out}: {length:.1f} s, footage {span:.1f} s" + (f", voice {dur(voice):.1f} s" if voice else ""))
