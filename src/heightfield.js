import * as THREE from 'three';
import { loadPNG16 } from './png16.js';
import { detailHeight, detailMask } from './detail.js';

/**
 * Real Jezero Crater elevation, in a local ENU-style frame.
 *
 * World frame (chosen so raster indices map to world axes with no flips):
 *     +X = east      (increasing longitude)
 *     +Z = south     (increasing raster row, i.e. decreasing latitude)
 *     +Y = up        (metres above the product's MOLA/geoid reference)
 * The origin is an anchor texel, normally the Octavia E. Butler landing site.
 *
 * Elevation is stored as the exact uint16 the DTM was quantised to; metres are
 * recovered as  elevMin + v * (elevMax-elevMin)/65535.
 */
export class Heightfield {
  constructor(meta, width, height, data) {
    this.meta = meta;
    this.width = width;
    this.height = height;
    this.data = data;                       // Uint16Array, row-major
    this.mpp = meta.metresPerPixel;
    this.elevMin = meta.elevMin;
    this.elevSpan = (meta.elevMax - meta.elevMin) / 65535;

    // anchor: raster texel that sits at world (0,0)
    /* Off until the host enables it, so anything built before settings bind
       sees the raw measured surface. */
    this.detailScale = 0;
    this.anchorCol = meta.anchorCol ?? width / 2;
    this.anchorRow = meta.anchorRow ?? height / 2;

    this.minX = (0 - this.anchorCol) * this.mpp;
    this.maxX = (width - 1 - this.anchorCol) * this.mpp;
    this.minZ = (0 - this.anchorRow) * this.mpp;
    this.maxZ = (height - 1 - this.anchorRow) * this.mpp;
  }

  static async load(pngUrl, jsonUrl, anchor, onProgress) {
    const meta = await (await fetch(jsonUrl)).json();
    const img = await loadPNG16(pngUrl, onProgress);
    if (img.width !== meta.width || img.height !== meta.height)
      throw new Error(`heightmap/metadata mismatch: png ${img.width}x${img.height} vs json ${meta.width}x${meta.height}`);
    if (anchor) { meta.anchorCol = anchor.col; meta.anchorRow = anchor.row; }
    return new Heightfield(meta, img.width, img.height, img.data);
  }

  /** world X/Z -> fractional texel coordinates */
  worldToTexel(x, z) {
    return [x / this.mpp + this.anchorCol, z / this.mpp + this.anchorRow];
  }
  texelToWorld(col, row) {
    return [(col - this.anchorCol) * this.mpp, (row - this.anchorRow) * this.mpp];
  }

  rawAt(col, row) {
    const c = col < 0 ? 0 : (col > this.width - 1 ? this.width - 1 : col);
    const r = row < 0 ? 0 : (row > this.height - 1 ? this.height - 1 : row);
    return this.data[r * this.width + c];
  }

  /**
   * Measured DTM elevation only, no synthesised detail. The ray tracer, the
   * rock scatter and the LOD pyramid all reason about this real surface.
   */
  baseHeightAt(x, z) {
    const [fc, fr] = this.worldToTexel(x, z);
    const c0 = Math.floor(fc), r0 = Math.floor(fr);
    const tx = fc - c0, ty = fr - r0;
    const h00 = this.rawAt(c0, r0),     h10 = this.rawAt(c0 + 1, r0);
    const h01 = this.rawAt(c0, r0 + 1), h11 = this.rawAt(c0 + 1, r0 + 1);
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return this.elevMin + (a + (b - a) * ty) * this.elevSpan;
  }

  /** Normal of the measured surface, ignoring synthesised detail. */
  baseNormalAt(x, z, out = new THREE.Vector3()) {
    const d = this.mpp;
    const hl = this.baseHeightAt(x - d, z), hr = this.baseHeightAt(x + d, z);
    const hd = this.baseHeightAt(x, z - d), hu = this.baseHeightAt(x, z + d);
    return out.set(hl - hr, 2 * d, hd - hu).normalize();
  }

  /** Measured slope in degrees. */
  baseSlopeAt(x, z) {
    const n = this.baseNormalAt(x, z, _n);
    return Math.acos(Math.min(1, Math.max(-1, n.y))) * 180 / Math.PI;
  }

  /**
   * The walkable surface: measured DTM plus the synthesised sub-metre band.
   * This MUST match the terrain vertex shader or the player walks on a surface
   * that is not the one being drawn. Both sides use the same integer hash and
   * the same mask, so they agree to float precision.
   */
  heightAt(x, z) {
    const b = this.baseHeightAt(x, z);
    if (!this.detailScale) return b;
    const slopeRad = this.baseSlopeAt(x, z) * Math.PI / 180;
    return b + detailHeight(x, z) * detailMask(slopeRad, this.detailScale);
  }

  /** Normal of the walkable surface, detail included. */
  normalAt(x, z, out = new THREE.Vector3()) {
    const d = this.detailScale ? 0.4 : this.mpp;
    const hl = this.heightAt(x - d, z), hr = this.heightAt(x + d, z);
    const hd = this.heightAt(x, z - d), hu = this.heightAt(x, z + d);
    return out.set(hl - hr, 2 * d, hd - hu).normalize();
  }

  slopeAt(x, z) {
    const n = this.normalAt(x, z, _n);
    return Math.acos(Math.min(1, Math.max(-1, n.y))) * 180 / Math.PI;
  }

  /**
   * Integer texture so the GPU reads the exact same uint16 the CPU does.
   * R16UI cannot be linearly filtered, so the shader bilinears by hand -
   * which is what keeps GPU and CPU height queries bit-identical.
   */
  createTexture() {
    const tex = new THREE.DataTexture(
      this.data, this.width, this.height,
      THREE.RedIntegerFormat, THREE.UnsignedShortType
    );
    tex.internalFormat = 'R16UI';
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Quadtree min/max pyramid, needed for correct frustum culling of terrain
   * nodes (a node's AABB has to bound the actual terrain inside it, not a guess).
   * Built bottom-up in one pass over the data.
   */
  buildMinMax(leafTexels) {
    const levels = [];
    let w = Math.ceil(this.width / leafTexels);
    let h = Math.ceil(this.height / leafTexels);
    const mn = new Uint16Array(w * h).fill(0xffff);
    const mx = new Uint16Array(w * h);
    for (let r = 0; r < this.height; r++) {
      const br = (r / leafTexels) | 0;
      const rowBase = r * this.width;
      for (let c = 0; c < this.width; c++) {
        const i = br * w + ((c / leafTexels) | 0);
        const v = this.data[rowBase + c];
        if (v < mn[i]) mn[i] = v;
        if (v > mx[i]) mx[i] = v;
      }
    }
    levels.push({ w, h, mn, mx, texels: leafTexels });
    while (w > 1 || h > 1) {
      const pw = Math.ceil(w / 2), ph = Math.ceil(h / 2);
      const pmn = new Uint16Array(pw * ph).fill(0xffff);
      const pmx = new Uint16Array(pw * ph);
      const prev = levels[levels.length - 1];
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          const i = ((r / 2) | 0) * pw + ((c / 2) | 0);
          const j = r * w + c;
          if (prev.mn[j] < pmn[i]) pmn[i] = prev.mn[j];
          if (prev.mx[j] > pmx[i]) pmx[i] = prev.mx[j];
        }
      }
      levels.push({ w: pw, h: ph, mn: pmn, mx: pmx, texels: prev.texels * 2 });
      w = pw; h = ph;
    }
    this.minmax = levels;
    return levels;
  }

  /** metres, for a node covering [col0,col0+texels) x [row0,row0+texels) */
  nodeElevRange(col0, row0, texels) {
    const li = Math.max(0, Math.round(Math.log2(texels / this.minmax[0].texels)));
    const L = this.minmax[Math.min(li, this.minmax.length - 1)];
    const c = Math.min(L.w - 1, Math.max(0, (col0 / L.texels) | 0));
    const r = Math.min(L.h - 1, Math.max(0, (row0 / L.texels) | 0));
    const i = r * L.w + c;
    return [this.elevMin + L.mn[i] * this.elevSpan, this.elevMin + L.mx[i] * this.elevSpan];
  }
}

const _n = new THREE.Vector3();
