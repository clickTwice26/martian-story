#!/usr/bin/env python3
"""Paragraph start times for the narration -> video/ov/cues.json.

With video/narration.mp3 present, the 16 paragraphs are found from the
voice itself: the 15 longest pauses are the paragraph breaks. Without it,
times are estimated from word counts (2.55 words/s + 0.7 s per break).
Both the tour's camera shots and the overlay cards are placed on these cues,
so they always change together with the sentence being spoken.
"""
import json, os, re, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
OV = os.path.join(HERE, "ov"); os.makedirs(OV, exist_ok=True)
MP3 = os.path.join(HERE, "narration.mp3")

text = open(os.path.join(HERE, "voice_script.md")).read()
paras = [p.strip() for sec in re.split(r"\n## ", text)[1:] for p in sec.split("\n", 1)[1].split("\n\n") if p.strip()]
assert len(paras) == 16, len(paras)

def estimate():
    t, cues = 0.0, []
    for p in paras:
        cues.append(round(t, 2))
        t += len(p.split()) / 2.55 + 0.7
    return cues, round(t, 2)

def from_voice():
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                         "-of", "csv=p=0", MP3]).decode())
    log = subprocess.run(["ffmpeg", "-i", MP3, "-af", "silencedetect=noise=-38dB:d=0.3", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
    durs = [float(x) for x in re.findall(r"silence_duration: ([\d.]+)", log)]
    sil = [(d, e) for d, e in zip(durs, ends) if 0.5 < e < dur - 0.5]     # inner pauses only
    if len(sil) < 15:
        raise SystemExit(f"only {len(sil)} pauses found; cannot split 16 paragraphs")
    # The 15 longest pauses should be the paragraph breaks; check them against the estimate.
    breaks = sorted(e for _, e in sorted(sil, reverse=True)[:15])
    est, est_total = estimate()
    scale = dur / est_total
    for i, b in enumerate(breaks):
        if abs(b - est[i + 1] * scale) > 9:
            print(f"  warning: break {i + 1} at {b:.1f}s, expected ~{est[i + 1] * scale:.1f}s")
    return [0.0] + [round(b - 0.05, 2) for b in breaks], round(dur, 2)

WORDS = os.path.join(HERE, "narration_words.json")      # whisper --word_timestamps output

def from_transcript():
    """Exact times: align every script word to Whisper's word timestamps."""
    import difflib
    norm = lambda w: re.sub(r"[^a-z0-9]", "", w.lower())
    wj = json.load(open(WORDS))
    hw = [(norm(w["word"]), w["start"]) for seg in wj["segments"] for w in seg.get("words", []) if norm(w["word"])]
    sw = [(pi, norm(w)) for pi, p in enumerate(paras) for w in p.split() if norm(w)]
    sm = difflib.SequenceMatcher(a=[w for _, w in sw], b=[w for w, _ in hw], autojunk=False)
    t = [None] * len(sw)
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            t[blk.a + k] = hw[blk.b + k][1]
    known = [i for i, v in enumerate(t) if v is not None]
    for i in range(len(t)):                                   # interpolate the few unmatched words
        if t[i] is None:
            lo = max((k for k in known if k < i), default=None); hi = min((k for k in known if k > i), default=None)
            t[i] = t[lo] if hi is None else t[hi] if lo is None else t[lo] + (t[hi] - t[lo]) * (i - lo) / (hi - lo)
    words = [[] for _ in paras]
    for (pi, _), ti in zip(sw, t):
        words[pi].append(round(ti, 2))
    print(f"aligned {len(known)}/{len(sw)} script words to the transcript")
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                         "-of", "csv=p=0", MP3]).decode())
    cues = [0.0] + [round(max(0.0, w[0] - 0.15), 2) for w in words[1:]]
    return cues, round(dur, 2), words

words = None
if os.path.exists(MP3) and os.path.exists(WORDS):
    cues, total, words = from_transcript(); src = "narration.mp3 + whisper word timestamps"
elif os.path.exists(MP3):
    cues, total = from_voice(); src = "narration.mp3 pauses"
else:
    cues, total = estimate(); src = "estimate"
json.dump({"source": src, "cues": cues, "end": total, "words": words}, open(os.path.join(OV, "cues.json"), "w"), indent=1)
print(f"cues from {src}: " + " ".join(f"{c:.1f}" for c in cues) + f" | end {total:.1f}s")
