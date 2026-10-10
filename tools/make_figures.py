#!/usr/bin/env python3
"""
Reference figures for Martian Story: the NASA data the game is built on, and
the algorithms it runs on that data. Every figure is computed from the files in
this repository - nothing is drawn by hand.

    python3 tools/make_figures.py            # writes docs/figures/{light,dark}/*.png

Needs numpy, pillow, matplotlib, and node (the sun figure calls the game's own
src/marstime.js, so it plots exactly what the game computes).
"""
import json
import math
import os
import subprocess
import sys

import numpy as np
from PIL import Image

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.patches import FancyBboxPatch, Patch
from matplotlib.lines import Line2D

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
R_MARS = 3396190.0                       # the radius the game projects with (src/main.js)
DEG = math.pi / 180

THEMES = {
    'light': dict(surface='#fcfcfb', ink='#0b0b0b', ink2='#52514e', muted='#898781',
                  grid='#e1e0d9', axis='#c3c2b7', s1='#2a78d6', s2='#eb6834'),
    'dark':  dict(surface='#1a1a19', ink='#f0efec', ink2='#c3c2b7', muted='#898781',
                  grid='#2c2c2a', axis='#383835', s1='#3987e5', s2='#d95926'),
}
# Terrain: one warm hue, light (low) -> dark (high) would read inverted on a map, so
# low ground is dark and high ground light, monotonic in lightness - a single-hue ramp.
TERRAIN = LinearSegmentedColormap.from_list('mars', ['#3b1a0c', '#7a3a1c', '#b8673a', '#dca27a', '#f4dcc6'])

SOURCE_DTM = 'USGS Mars 2020 TRN HiRISE DTM Mosaic (NASA MRO HiRISE)'
SOURCE_TRAV = 'NASA MMGIS Mars 2020 traverse, through sol 1980'


# ----------------------------------------------------------------- data --
def load_dtm():
    meta = json.load(open(os.path.join(DATA, 'jezero_base.json')))
    raw = np.asarray(Image.open(os.path.join(DATA, 'jezero_base.png')), dtype=np.float32)
    h = meta['elevMin'] + raw * ((meta['elevMax'] - meta['elevMin']) / 65535.0)
    return meta, h


def load_mask():
    return np.asarray(Image.open(os.path.join(DATA, 'jezero_base_mask.png')).convert('L')) > 127


def lonlat_to_texel(meta, lon, lat):
    """Same mapping as makeProjector().lonLatToTexel in src/main.js."""
    mpp, p = meta['metresPerPixel'], meta['projected']
    col = (np.asarray(lon) * DEG * R_MARS - p['xLeft']) / mpp
    row = (p['yTop'] - np.asarray(lat) * DEG * R_MARS) / mpp
    return col, row


def bilinear(h, col, row):
    """Same bilinear filter as Heightfield.heightAt / the shaders' sampleH."""
    H, W = h.shape
    c0 = np.clip(np.floor(col).astype(np.int64), 0, W - 1)
    r0 = np.clip(np.floor(row).astype(np.int64), 0, H - 1)
    c1, r1 = np.clip(c0 + 1, 0, W - 1), np.clip(r0 + 1, 0, H - 1)
    tx, ty = col - np.floor(col), row - np.floor(row)
    a = h[r0, c0] + (h[r0, c1] - h[r0, c0]) * tx
    b = h[r1, c0] + (h[r1, c1] - h[r1, c0]) * tx
    return a + (b - a) * ty


def hillshade(z, mpp, az_deg=315.0, alt_deg=35.0):
    gy, gx = np.gradient(z, mpp)
    nx, ny, nz = -gx, gy, np.ones_like(z)                 # rows run south: flip y
    n = np.sqrt(nx * nx + ny * ny + nz * nz)
    az, alt = az_deg * DEG, alt_deg * DEG
    lx, ly, lz = math.sin(az) * math.cos(alt), math.cos(az) * math.cos(alt), math.sin(alt)
    return np.clip((nx * lx + ny * ly + nz * lz) / n, 0, 1)


# --------------------------------------------------------------- styling --
def style(T):
    plt.rcParams.update({
        'figure.facecolor': T['surface'], 'axes.facecolor': T['surface'], 'savefig.facecolor': T['surface'],
        'text.color': T['ink'], 'axes.labelcolor': T['ink2'], 'axes.edgecolor': T['axis'],
        'xtick.color': T['muted'], 'ytick.color': T['muted'], 'grid.color': T['grid'],
        'font.family': 'DejaVu Sans', 'font.size': 11, 'axes.titlesize': 13,
        'axes.spines.top': False, 'axes.spines.right': False,
    })


def title(fig, T, head, sub, source):
    fig.text(0.035, 0.955, head, fontsize=17, fontweight='bold', color=T['ink'], va='top')
    fig.text(0.035, 0.905, sub, fontsize=11.5, color=T['ink2'], va='top')
    fig.text(0.035, 0.025, 'Source: ' + source, fontsize=9, color=T['muted'], va='bottom')


def degree_axes(ax, meta, T):
    ax.set_xlabel('Longitude (°E)')
    ax.set_ylabel('Latitude (°N)')
    ax.tick_params(length=3)
    for s in ax.spines.values():
        s.set_visible(False)


def scale_bar(ax, meta, T, km=2):
    lon0, lat0 = meta['lonLeft'], meta['latBottom']
    dlon = km * 1000 / (R_MARS * DEG)
    x0 = lon0 + (meta['lonRight'] - lon0) * 0.04
    y0 = lat0 + (meta['latTop'] - lat0) * 0.06
    ax.plot([x0, x0 + dlon], [y0, y0], color='#ffffff', lw=3, solid_capstyle='butt', zorder=6)
    ax.text(x0 + dlon / 2, y0 + (meta['latTop'] - lat0) * 0.025, f'{km} km', color='#ffffff',
            ha='center', va='bottom', fontsize=10, zorder=6)


# ------------------------------------------------------------- figure 1 --
def fig_terrain(meta, h, T, out):
    z = h[::4, ::4]                                         # 8 m/px for display
    shade = hillshade(z, 8.0)
    norm = (z - meta['elevMin']) / (meta['elevMax'] - meta['elevMin'])
    rgb = TERRAIN(norm)[..., :3] * (0.35 + 0.65 * shade[..., None])
    trav = json.load(open(os.path.join(DATA, 'm20_traverse.json')))['features']
    wps = json.load(open(os.path.join(DATA, 'm20_waypoints.json')))['features']

    fig = plt.figure(figsize=(12, 7.2), dpi=160)
    ax = fig.add_axes([0.06, 0.12, 0.80, 0.70])
    ext = [meta['lonLeft'], meta['lonRight'], meta['latBottom'], meta['latTop']]
    ax.imshow(rgb, extent=ext, origin='upper', interpolation='bilinear')
    for f in trav:
        c = np.array(f['geometry']['coordinates'])
        ax.plot(c[:, 0], c[:, 1], color=T['s1'], lw=1.6, solid_capstyle='round', zorder=3)
    p0, p1 = wps[0]['properties'], wps[-1]['properties']
    for p, lab, dx, dy, ha in ((p0, f"Sol {p0['sol']}: start of the drive log\n(game spawn point)", -0.03, -0.024, 'right'),
                               (p1, f"Sol {p1['sol']}: last position in the data", 0.006, 0.012, 'left')):
        ax.plot(p['lon'], p['lat'], 'o', ms=9, mfc='#ffffff', mec=T['s1'], mew=2.5, zorder=5)
        ax.annotate(lab, (p['lon'], p['lat']), xytext=(p['lon'] + dx, p['lat'] + dy), ha=ha,
                    color='#ffffff', fontsize=10, zorder=6,
                    arrowprops=dict(arrowstyle='-', color='#ffffff', lw=0.8))
    ax.set_xlim(ext[0], ext[1]); ax.set_ylim(ext[2], ext[3])
    degree_axes(ax, meta, T)
    scale_bar(ax, meta, T)
    cax = fig.add_axes([0.885, 0.20, 0.018, 0.54])
    sm = plt.cm.ScalarMappable(cmap=TERRAIN, norm=plt.Normalize(meta['elevMin'], meta['elevMax']))
    cb = fig.colorbar(sm, cax=cax)
    cb.set_label('Elevation (m, Mars datum)', color=T['ink2'])
    cb.outline.set_visible(False)
    ax.legend(handles=[Line2D([0], [0], color=T['s1'], lw=2, label='Perseverance traverse (45.13 km)')],
              loc='upper right', frameon=True, facecolor=T['surface'], edgecolor=T['axis'], labelcolor=T['ink'])
    title(fig, T, 'Jezero Crater: the real terrain under the game',
          '16.4 × 8.2 km at 2 m/px, 1.5 cm vertical precision, with the rover\'s actual route',
          f'{SOURCE_DTM}; {SOURCE_TRAV}.')
    fig.savefig(out)
    plt.close(fig)


# ------------------------------------------------------------- figure 2 --
def fig_mask(meta, h, T, out):
    mask = load_mask()                                      # 2048 x 1024 at 8 m
    z = h[::4, ::4]
    shade = hillshade(z, 8.0)
    g = (0.30 + 0.55 * shade)[..., None]
    rgb = np.repeat(g, 3, axis=2)
    gap = np.array(matplotlib.colors.to_rgb(T['s2']))
    rgb = np.where(mask[..., None], rgb, rgb * 0.45 + gap * 0.55)
    fig = plt.figure(figsize=(12, 7.2), dpi=160)
    ax = fig.add_axes([0.06, 0.12, 0.88, 0.70])
    ext = [meta['lonLeft'], meta['lonRight'], meta['latBottom'], meta['latTop']]
    ax.imshow(rgb, extent=ext, origin='upper', interpolation='nearest')
    degree_axes(ax, meta, T)
    scale_bar(ax, meta, T)
    gapf = 1 - mask.mean()
    ax.legend(handles=[Patch(facecolor='#8a8a88', label=f'Measured by HiRISE stereo ({(1 - gapf) * 100:.1f}%)'),
                       Patch(facecolor=T['s2'], label=f'Interpolated between stereo pairs ({gapf * 100:.1f}%)')],
              loc='upper right', frameon=True, facecolor=T['surface'], edgecolor=T['axis'], labelcolor=T['ink'])
    title(fig, T, 'What is measured, and what is not',
          'The game renders interpolated ground desaturated (press M), so it is never passed off as measurement',
          f'{SOURCE_DTM}; validity mask from tools/extract_mask.py.')
    fig.savefig(out)
    plt.close(fig)


# ------------------------------------------------------------- figure 3 --
def fig_validation(meta, h, T, out):
    wps = [f['properties'] for f in json.load(open(os.path.join(DATA, 'm20_waypoints.json')))['features']]
    wps = [p for p in wps if p.get('elev_geoid') not in (None, -9999.0)]          # file order is chronological
    lon = np.array([p['lon'] for p in wps]); lat = np.array([p['lat'] for p in wps])
    col, row = lonlat_to_texel(meta, lon, lat)
    inside = (col >= 0) & (row >= 0) & (col < meta['width'] - 1) & (row < meta['height'] - 1)
    sol = np.array([p['sol'] for p in wps])[inside]
    nasa = np.array([p['elev_geoid'] for p in wps])[inside]
    dtm = bilinear(h, col[inside], row[inside])
    d = dtm - nasa
    mask = load_mask()
    meas = mask[np.clip(np.round(row[inside] / 4).astype(int), 0, mask.shape[0] - 1),
                np.clip(np.round(col[inside] / 4).astype(int), 0, mask.shape[1] - 1)]
    am, ai = np.abs(d[meas]), np.abs(d[~meas])
    st = dict(n=int(inside.sum()), n_meas=int(meas.sum()), n_interp=int((~meas).sum()),
              median_meas=float(np.median(am)), within1_meas=float(100 * np.mean(am <= 1)),
              max_meas=float(am.max()), median_interp=float(np.median(ai)) if ai.size else 0.0,
              first=float(d[0]))

    fig = plt.figure(figsize=(12, 7.2), dpi=160)
    ax = fig.add_axes([0.08, 0.43, 0.88, 0.41])
    ax.plot(sol, nasa, color=T['s1'], lw=2, label='NASA recorded rover elevation')
    ax.plot(sol, dtm, color=T['s2'], lw=2, ls=(0, (4, 2)), label='Game terrain under the same point')
    ax.set_ylabel('Elevation (m)')
    ax.grid(axis='y', lw=0.6)
    ax.tick_params(labelbottom=False, length=0)
    ax.legend(loc='upper left', frameon=False, labelcolor=T['ink'])
    bx = fig.add_axes([0.08, 0.12, 0.88, 0.25], sharex=ax)
    bx.axhline(0, color=T['axis'], lw=1)
    bx.plot(sol[meas], d[meas], 'o', ms=3.4, color=T['ink2'], label=f'On measured ground ({st["n_meas"]})')
    bx.plot(sol[~meas], d[~meas], 'x', ms=6, mew=1.6, color=T['ink2'],
            label=f'On interpolated ground ({st["n_interp"]})')
    bx.set_yscale('symlog', linthresh=1)
    bx.set_yticks([-100, -10, -1, 0, 1, 10, 100]); bx.set_yticklabels(['−100', '−10', '−1', '0', '1', '10', '100'])
    bx.set_ylim(-300, 300)
    bx.set_ylabel('Game − NASA (m)')
    bx.set_xlabel('Mission sol')
    bx.grid(axis='y', lw=0.6)
    bx.tick_params(length=0)
    bx.legend(loc='upper left', frameon=False, labelcolor=T['ink'], ncol=2)
    if (~meas).any():
        i = np.argmax(np.where(~meas, d, -np.inf))
        bx.annotate('gap-filled strip: why the game marks it', (sol[i], d[i]), xytext=(-12, -2),
                    textcoords='offset points', ha='right', va='center', color=T['ink'], fontsize=10)
    title(fig, T, 'Checked against NASA: where it is measured, the terrain matches the rover',
          f'{st["n_meas"]} rover positions on measured ground: median difference {st["median_meas"] * 100:.0f} cm, '
          f'{st["within1_meas"]:.0f}% within 1 m · on the {st["n_interp"]} interpolated: {st["median_interp"]:.0f} m',
          f'{SOURCE_TRAV} (elev_geoid); {SOURCE_DTM}, sampled bilinearly exactly as the game does.')
    fig.savefig(out)
    plt.close(fig)
    return st


# ------------------------------------------------------------- figure 4 --
def sun_series():
    js = """
      import { siteTime, utcForSolAndLmst, JEZERO } from '%s';
      const out = [];
      for (let i = 0; i <= 24 * 12; i++) {
        const l = i / 12, st = siteTime(utcForSolAndLmst(1980, l), JEZERO.lonEast, JEZERO.latNorth);
        out.push([l, st.elevation, st.azimuth, st.ls]);
      }
      console.log(JSON.stringify(out));
    """ % os.path.join(ROOT, 'src', 'marstime.js')
    r = subprocess.run(['node', '--input-type=module', '-e', js], capture_output=True, text=True, check=True)
    return np.array(json.loads(r.stdout))


def fig_sun(T, out):
    s = sun_series()
    lmst, elev, az, ls = s[:, 0], s[:, 1], s[:, 2], s[0, 3]
    fig = plt.figure(figsize=(12, 7.2), dpi=160)
    ax = fig.add_axes([0.08, 0.45, 0.88, 0.38])
    ax.axhline(0, color=T['axis'], lw=1)
    ax.plot(lmst, elev, color=T['s1'], lw=2)
    ax.fill_between(lmst, elev, 0, where=elev < 0, color=T['grid'], alpha=0.8, lw=0)
    ax.set_ylabel('Sun elevation (°)')
    ax.grid(axis='y', lw=0.6)
    ax.tick_params(labelbottom=False, length=0)
    for t, lab in ((9.5, 'Game default\n09:30'), (17.25, 'Opening crash\n17:15')):
        e = np.interp(t, lmst, elev)
        ax.plot(t, e, 'o', ms=8, color=T['s2'], zorder=4)
        ax.annotate(f'{lab}  ({e:.1f}°)', (t, e), xytext=(8, 10), textcoords='offset points',
                    color=T['ink'], fontsize=10)
    bx = fig.add_axes([0.08, 0.12, 0.88, 0.27], sharex=ax)
    a = np.where(np.abs(np.diff(az, prepend=az[0])) > 180, np.nan, az)
    bx.plot(lmst, a, color=T['s1'], lw=2)
    bx.set_ylabel('Azimuth (° from N)')
    bx.set_xlabel('Local mean solar time at Jezero (hours)')
    bx.set_xlim(0, 24); bx.set_xticks(range(0, 25, 3))
    bx.set_yticks([0, 90, 180, 270, 360])
    bx.grid(axis='y', lw=0.6)
    bx.tick_params(length=0)
    title(fig, T, 'Where the sun is: NASA Mars24 timekeeping at Jezero',
          f'Sol 1980 of the Perseverance mission · Ls {ls:.1f}° · 18.44° N, 77.45° E · one sol = 24 h 39 m 35 s',
          'Allison & McEwen (2000), the algorithm behind NASA Mars24, as implemented in src/marstime.js.')
    fig.savefig(out)
    plt.close(fig)


# ------------------------------------------------------------- figure 5 --
def trace_shadows(h, mpp, r0, c0, H, W, sun_el, sun_az, steps=72, soft=22.0, max_dist=5000.0):
    """NumPy port of traceSunShadow() in src/terrain.js (the 'High' tier)."""
    rows, cols = np.mgrid[r0:r0 + H, c0:c0 + W].astype(np.float64)
    py = bilinear(h, cols.ravel(), rows.ravel())
    px, pz = cols.ravel() * mpp, rows.ravel() * mpp          # world metres; +z runs south
    el, az = sun_el * DEG, sun_az * DEG
    L = np.array([math.cos(el) * math.sin(az), math.sin(el), -math.cos(el) * math.cos(az)])
    t = np.full(px.shape, mpp * 1.5); res = np.ones(px.shape); live = np.ones(px.shape, bool)
    for _ in range(steps):
        qx, qy, qz = px + L[0] * t, py + L[1] * t, pz + L[2] * t
        hh = bilinear(h, qx / mpp, qz / mpp)
        d = qy - hh
        blocked = live & (d < 0)
        res[blocked] = 0.0
        live &= ~blocked
        res = np.where(live, np.minimum(res, soft * d / t), res)
        t = np.where(live, t + np.clip(d * 0.75, mpp * 0.9, max_dist * 0.06), t)
        live &= t <= max_dist
        if not live.any():
            break
    return np.clip(res, 0, 1).reshape(H, W), L


def fig_shadows(meta, h, T, out):
    mpp = meta['metresPerPixel']
    # the measured window with the most relief: where cast shadows matter most
    z8 = h[::8, ::8]
    win = 64
    best, br, bc = -1, 0, 0
    mask = load_mask()[::2, ::2]
    for r in range(0, z8.shape[0] - win, 8):
        for c in range(0, z8.shape[1] - win * 3 // 2, 8):
            if mask[r:r + win, c:c + win * 3 // 2].mean() < 0.995:
                continue
            blk = z8[r:r + win, c:c + win * 3 // 2]
            v = np.percentile(blk, 98) - np.percentile(blk, 2)
            if v > best:
                best, br, bc = v, r, c
    H, W = win * 8, win * 12
    r0, c0 = br * 8, bc * 8
    # a low evening sun, read off the same Mars24 curve as figure 4
    s = sun_series()
    pm = s[:, 0] > 12
    sun_el = 10.0
    lmst_at = float(np.interp(-sun_el, -s[pm, 1], s[pm, 0]))
    sun_az = float(np.interp(lmst_at, s[:, 0], s[:, 2]))
    shadow, L = trace_shadows(h, mpp, r0, c0, H, W, sun_el, sun_az)
    z = h[r0:r0 + H, c0:c0 + W]
    gy, gx = np.gradient(z, mpp)
    n = np.dstack([-gx, np.ones_like(z), -gy])             # world (x east, y up, z south)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    ndl = np.clip(n @ L, 0, 1)
    sky = 0.18 + 0.10 * n[..., 1]
    plain = np.clip(ndl * 1.25 + sky, 0, 1)
    traced = np.clip(ndl * shadow * 1.25 + sky, 0, 1)
    tone = LinearSegmentedColormap.from_list('lit', ['#1a0c06', '#6b3317', '#c27a4b', '#f2d2b4'])

    fig = plt.figure(figsize=(12, 7.2), dpi=160)
    for i, (img, lab) in enumerate(((plain, 'Slope lighting only'),
                                    (traced, 'With the game\'s ray-traced shadows'))):
        ax = fig.add_axes([0.035 + i * 0.485, 0.13, 0.445, 0.66])
        ax.imshow(tone(img)[..., :3], interpolation='bilinear')
        ax.set_xticks([]); ax.set_yticks([])
        for s in ax.spines.values():
            s.set_visible(False)
        ax.set_title(lab, color=T['ink'], loc='left', fontsize=12.5, pad=8)
        if i == 1:
            ax.plot([20, 20 + 500 / mpp], [H - 24, H - 24], color='#ffffff', lw=3, solid_capstyle='butt')
            ax.text(20 + 250 / mpp, H - 34, '500 m', color='#ffffff', ha='center', fontsize=10)
    frac = 100 * np.mean(shadow < 0.5)
    lon = (meta['projected']['xLeft'] + (c0 + W / 2) * mpp) / R_MARS / DEG
    lat = (meta['projected']['yTop'] - (r0 + H / 2) * mpp) / R_MARS / DEG
    hh, mm = int(lmst_at), int(round((lmst_at % 1) * 60))
    title(fig, T, 'Shadows traced through the real elevation data',
          f'Sol 1980, {hh:02d}:{mm:02d} local time, sun {sun_el:.0f}° above the west · {frac:.0f}% of this '
          f'{W * mpp / 1000:.1f} × {H * mpp / 1000:.1f} km patch ({lat:.3f}° N, {lon:.3f}° E) lies in cast shadow',
          'Sphere tracing against the HiRISE DTM, ported 1:1 from traceSunShadow() in src/terrain.js (High tier: '
          '72 steps, 5 km reach).')
    fig.savefig(out)
    plt.close(fig)


# ------------------------------------------------------------- figure 6 --
def fig_pipeline(T, out):
    fig = plt.figure(figsize=(12, 7.2), dpi=160)
    ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, 100); ax.set_ylim(0, 60); ax.axis('off')
    cols = [(4, 'NASA & USGS sources'), (37, 'Offline extraction  (tools/)'), (70, 'In the browser  (src/)')]
    boxes = {
        0: [('HiRISE DTM mosaic', '1 m/px GeoTIFF, 1.84 GB\nMRO stereo, USGS Astrogeology'),
            ('Perseverance traverse', 'NASA MMGIS, 703 waypoints\n556 drives to sol 1980'),
            ('Mars24 algorithm', 'Allison & McEwen (2000)\nNASA GISS')],
        1: [('HTTP range requests', 'only the rows needed:\n285 MB fetched, not 1.84 GB'),
            ('16-bit PNG tiles', '2 m/px, 1.5 cm precision\n+ measured/interpolated mask'),
            ('Projected to the tile', 'lon/lat -> metres, anchored\nat the first rover position')],
        2: [('Exact 16-bit heightfield', 'custom PNG decoder; GPU R16UI;\ncollision = what is drawn'),
            ('Terrain + ray tracing', 'CDLOD quadtree; sun shadows\nand sky occlusion, cached'),
            ('Sun, clock and season', 'real LMST, sol and Ls\nposition the sun every frame')],
    }
    bw, bh = 27, 11.5
    ys = [36.5, 21.5, 6.5]
    for ci, (x, head) in enumerate(cols):
        ax.text(x, 52.5, head, fontsize=13.5, fontweight='bold', color=T['ink'])
        for bi, (t1, t2) in enumerate(boxes[ci]):
            y = ys[bi]
            edge = T['s1'] if ci == 0 else (T['axis'] if ci == 1 else T['s2'])
            ax.add_patch(FancyBboxPatch((x, y), bw, bh, boxstyle='round,pad=0.25,rounding_size=1.2',
                                        fc=T['surface'], ec=edge, lw=1.6))
            ax.text(x + 1.4, y + bh - 2.2, t1, fontsize=11.5, fontweight='bold', color=T['ink'], va='top')
            ax.text(x + 1.4, y + bh - 5.3, t2, fontsize=9.8, color=T['ink2'], va='top', linespacing=1.35)
            if ci < 2:
                ax.annotate('', xy=(cols[ci + 1][0] - 0.6, y + bh / 2), xytext=(x + bw + 0.6, y + bh / 2),
                            arrowprops=dict(arrowstyle='-|>', color=T['muted'], lw=1.4, mutation_scale=14))
    ax.text(4, 58, 'From NASA data to a walkable Mars', fontsize=17, fontweight='bold', color=T['ink'], va='top')
    ax.text(4, 2.0, 'Everything ships as static files: no backend. Elevation at the first rover stop: '
            '-2569.92 m in the game, -2569.91 m in NASA\'s record.', fontsize=9.5, color=T['muted'])
    fig.savefig(out)
    plt.close(fig)


# ------------------------------------------------------------------ main --
def main():
    meta, h = load_dtm()
    stats = None
    for name, T in THEMES.items():
        style(T)
        d = os.path.join(ROOT, 'docs', 'figures', name)
        os.makedirs(d, exist_ok=True)
        fig_terrain(meta, h, T, os.path.join(d, '1-jezero-terrain-and-traverse.png'))
        fig_mask(meta, h, T, os.path.join(d, '2-measured-vs-interpolated.png'))
        stats = fig_validation(meta, h, T, os.path.join(d, '3-terrain-vs-nasa-rover-elevation.png'))
        fig_sun(T, os.path.join(d, '4-mars24-sun-at-jezero.png'))
        fig_shadows(meta, h, T, os.path.join(d, '5-ray-traced-shadows.png'))
        fig_pipeline(T, os.path.join(d, '6-data-pipeline.png'))
        print('wrote', d)
    print('validation:', json.dumps(stats))


if __name__ == '__main__':
    sys.exit(main())
