#!/usr/bin/env python3
"""
Index the real Perseverance media that belongs to places on the traverse, so
the game can show what the rover actually saw and sensed where you stand.

  photos  NASA Mars 2020 raw-image API: for every sol with a traverse
          waypoint, one Mastcam-Z and one Navcam frame (largest full frame)
  rimfax  PDS Geosciences RIMFAX annotated browse radargrams: sol, the rover's
          lat/lon box during the sounding, and the PNG location

Only links and metadata are stored; images load from NASA/PDS at runtime and
the game copes when they cannot be reached. Public domain, no login.

Output : data/m20_media.json
"""
import json, os, re, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
# The API ignores sol= once a camera search is given, so ask for the first
# frames on or after the sol, sorted by sol, and keep those within 3 sols.
RAW = ("https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json"
       "&num=40&search={cam}&order=sol%20asc&condition_2={sol}:sol:gte&extended=sample_type::full")
RF = "https://pds-geosciences.wustl.edu/m2020/urn-nasa-pds-mars2020_rimfax/browse_radargram/"
UA = {"User-Agent": "Mozilla/5.0 (martian-story-data-tools)"}


def get(url, retries=5):
    for a in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                return r.read()
        except Exception:
            if a == retries - 1:
                raise
            time.sleep(2 * (a + 1))


def best_frame(sol, cams):
    try:
        d = json.loads(get(RAW.format(sol=sol, cam=cams)))
    except Exception as e:
        return None
    best, area = None, 0
    for im in d.get("images", []):
        if not (sol <= int(im.get("sol", -1)) <= sol + 3):
            continue
        m = re.match(r"\((\d+),(\d+)\)", im.get("extended", {}).get("dimension", "") or "")
        if not m:
            continue
        w, h = int(m.group(1)), int(m.group(2))
        if h < 0.5 * w or w < 640:          # skip thumbnails and strips
            continue
        if w * h > area:
            f = im["image_files"]
            best, area = {"cam": im["camera"]["instrument"], "small": f.get("small"),
                          "medium": f.get("medium"), "large": f.get("large") or f.get("full_res"),
                          "date": im.get("date_taken_utc", "")[:10], "sol": int(im["sol"])}, w * h
    return best


def photos():
    wps = json.load(open(os.path.join(DATA, "m20_waypoints.json")))["features"]
    by_sol = {}
    for f in wps:
        p = f["properties"]
        by_sol.setdefault(p["sol"], p)          # first waypoint of the sol
    sols = sorted(by_sol)
    print(f"photos: {len(sols)} traverse sols", flush=True)

    def job(sol):
        z = best_frame(sol, "MCZ_LEFT")
        n = best_frame(sol, "NAVCAM_LEFT")
        p = by_sol[sol]
        return {"sol": sol, "lon": p["lon"], "lat": p["lat"], "mastcamz": z, "navcam": n}

    out = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for i, r in enumerate(ex.map(job, sols)):
            if r["mastcamz"] or r["navcam"]:
                out.append(r)
            if (i + 1) % 50 == 0:
                print(f"  {i + 1}/{len(sols)}", flush=True)
    return out


def rimfax():
    html = get(RF).decode()
    years = sorted(set(re.findall(r'browse_radargram/(\d{4})/', html)))
    xmls = []
    for y in years:
        h = get(RF + y + "/").decode()
        xmls += [RF + y + "/" + m for m in re.findall(r'/(rimfax_abrowse_\d+\.xml)"', h)]
    print(f"rimfax: {len(xmls)} radargrams", flush=True)

    def tag(t, name):
        m = re.search(rf"<mars2020:{name}[^>]*>([^<]+)<", t)
        return m.group(1).strip() if m else None

    def job(u):
        try:
            t = get(u).decode("utf-8", "replace")
            r = {"sol": int(tag(t, "start_sol_number")), "png": u[:-4] + ".png"}
            for k, n in (("latMin", "min_rover_lat"), ("latMax", "max_rover_lat"),
                         ("lonMin", "min_rover_lon"), ("lonMax", "max_rover_lon"),
                         ("ls", "start_solar_longitude")):
                v = tag(t, n)
                r[k] = float(v) if v else None
            return r if r["latMin"] is not None else None
        except Exception:
            return None

    with ThreadPoolExecutor(max_workers=6) as ex:
        return sorted([r for r in ex.map(job, xmls) if r], key=lambda r: r["sol"])


def main():
    out = {
        "sources": {
            "photos": "NASA Mars 2020 raw images (mars.nasa.gov raw-image API), public domain",
            "rimfax": "PDS Geosciences Node, Mars 2020 RIMFAX bundle, annotated browse radargrams",
        },
        "rimfax": rimfax(),
        "photos": photos(),
    }
    path = os.path.join(DATA, "m20_media.json")
    json.dump(out, open(path, "w"), separators=(",", ":"))
    print(f"DONE {len(out['photos'])} photo sols, {len(out['rimfax'])} radargrams, "
          f"{os.path.getsize(path) / 1e3:.0f} kB", flush=True)


if __name__ == "__main__":
    main()
