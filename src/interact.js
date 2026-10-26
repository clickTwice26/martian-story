import * as THREE from 'three';
import { MARS_G } from './player.js';

/**
 * Things a character can act on.
 *
 * Anything that can be grabbed, carried, dropped or struck goes through one
 * small interface, so the action system never needs to know whether it is
 * holding a rock, a sample tube or a tool:
 *
 *   Interactable {
 *     kind, label            'rock', 'basalt cobble'
 *     position               world centre (Vector3)
 *     radius                 rough half-size, metres
 *     mass                   kilograms - lifting limits come from this
 *     take()  -> Prop        detach from wherever it lives and become a carried body
 *     hit(dir, impulse)      optional: struck by a punch
 *   }
 *
 * Providers hand out interactables near a point. Two exist now: the loose-prop
 * set below, and the procedural rock field (adapted in RockSource).
 */

const BASALT_DENSITY = 2900;        // kg/m^3 - Jezero's floor rocks are igneous
const GROUND_MU = 0.55;             // same regolith friction the boots get

/**
 * A free body resting on (or falling onto) the heightfield. Deliberately
 * simple: a sphere-ish rock under Mars gravity with ground friction and a
 * small bounce. It sleeps when still, so a hundred dropped rocks cost nothing.
 */
export class Prop {
  constructor({ mesh, mass, radius, restOffset, kind = 'rock', label = 'rock' }) {
    this.mesh = mesh;
    this.kind = kind;
    this.label = label;
    this.mass = mass;
    this.radius = radius;
    this.restOffset = restOffset;    // centre height above the ground when resting
    this.position = mesh.position;   // shared: moving one moves the other
    this.vel = new THREE.Vector3();
    this.held = false;
    this.asleep = true;
  }

  take() { return this; }

  hit(dir, impulse) {
    const dv = impulse / this.mass;
    this.vel.addScaledVector(dir, dv);
    this.vel.y += dv * 0.25;          // a strike from above-ish still lifts it a little
    this.asleep = false;
  }

  /** Released by a hand: keep any carry velocity, let physics take over. */
  release(vel) {
    this.held = false;
    if (vel) this.vel.copy(vel);
    this.asleep = false;
  }

  update(dt, hf) {
    if (this.held || this.asleep) return;
    const p = this.position, v = this.vel;
    v.y -= MARS_G * dt;
    p.addScaledVector(v, dt);
    p.x = Math.min(hf.maxX - 2, Math.max(hf.minX + 2, p.x));
    p.z = Math.min(hf.maxZ - 2, Math.max(hf.minZ + 2, p.z));

    const floor = hf.heightAt(p.x, p.z) + this.restOffset;
    const hs = Math.hypot(v.x, v.z);
    this.impact = 0;
    if (p.y <= floor) {
      p.y = floor;
      if (v.y < -1.2) this.impact = -v.y;
      if (v.y < -0.6) {
        // A rock landing in regolith digs in: most of the bounce and much of
        // the forward speed go into the crater it makes, not into a long slide.
        const keep = Math.max(0.2, 1 - (-v.y) * 0.18);
        v.x *= keep; v.z *= keep;
        v.y *= -0.22;
      } else v.y = 0;
      // Coulomb friction: the same mu*g that limits the boots
      const dec = GROUND_MU * MARS_G * dt;
      if (hs <= dec) { v.x = 0; v.z = 0; }
      else { v.x -= v.x / hs * dec; v.z -= v.z / hs * dec; }
      if (v.y === 0 && hs < 0.03) { this.asleep = true; v.set(0, 0, 0); }
    }
    // tumble with travel: roll about the axis perpendicular to motion
    if (hs > 0.02) {
      _axis.set(v.z, 0, -v.x).normalize();
      _rq.setFromAxisAngle(_axis, hs * dt / Math.max(0.05, this.radius));
      this.mesh.quaternion.premultiply(_rq);
    }
  }
}
const _axis = new THREE.Vector3(), _rq = new THREE.Quaternion();

/** Every loose body in the world, updated together; also a provider. */
export class PropSet {
  constructor(hf) {
    this.hf = hf;
    this.props = [];
    this.group = new THREE.Group();
    this.onImpact = null;          // (prop, speed) when something lands hard
  }
  add(prop) {
    this.props.push(prop);
    this.group.add(prop.mesh);
    return prop;
  }
  /** Take a body out of the world: it stops simulating and can no longer be picked up. */
  remove(prop, keepMesh = false) {
    const i = this.props.indexOf(prop);
    if (i >= 0) this.props.splice(i, 1);
    if (!keepMesh) this.group.remove(prop.mesh);
  }
  update(dt) {
    for (const p of this.props) {
      p.update(dt, this.hf);
      if (p.impact && this.onImpact) this.onImpact(p, p.impact);
    }
  }
  query(x, z, r, out) {
    for (const p of this.props) {
      if (p.held) continue;
      if ((p.position.x - x) ** 2 + (p.position.z - z) ** 2 <= r * r) out.push(p);
    }
    return out;
  }
}

/** Signed-tetrahedron volume of a closed mesh, in its own units. */
export function geometryVolume(g) {
  const p = g.attributes.position, idx = g.index;
  const n = idx ? idx.count : p.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let v = 0;
  for (let i = 0; i < n; i += 3) {
    const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(p, i0); b.fromBufferAttribute(p, i1); c.fromBufferAttribute(p, i2);
    v += a.dot(b.cross(c)) / 6;
  }
  return Math.abs(v);
}

/**
 * Adapts the procedural RockField so its rocks can be picked up.
 *
 * Field rocks are not objects - they are regenerated from a hash every time
 * the camera crosses a cell. Taking one records it as removed in the field and
 * spawns an identical loose Prop in its place, so the swap is invisible.
 */
export class RockSource {
  constructor(rocks, props) {
    this.rocks = rocks;
    this.props = props;
    const geo = rocks.geometry;
    geo.computeBoundingBox();
    this.unitVolume = geometryVolume(geo);
    this.unitHalfY = (geo.boundingBox.max.y - geo.boundingBox.min.y) / 2;
    this.unitHalfXZ = Math.max(geo.boundingBox.max.x - geo.boundingBox.min.x,
                               geo.boundingBox.max.z - geo.boundingBox.min.z) / 2;
  }

  query(x, z, r, out) {
    for (const rk of this.rocks.query(x, z, r)) out.push(this._wrap(rk));
    return out;
  }

  _wrap(rk) {
    const src = this;
    const s = rk.scale;
    const mass = this.unitVolume * s.x * s.y * s.z * BASALT_DENSITY;
    const radius = this.unitHalfXZ * Math.max(s.x, s.z);
    return {
      kind: 'rock',
      label: rockLabel(rk.size),
      key: rk.key,
      position: rk.position,
      radius,
      halfHeight: this.unitHalfY * s.y,
      mass,
      take() { return src._take(rk, mass, radius); },
      // A strike that could not shift it by a centimetre per second is a
      // knock on bedrock: leave it in the field rather than spawn a prop.
      hit(dir, impulse) {
        if (impulse / mass < 0.05) return false;
        src._take(rk, mass, radius).hit(dir, impulse);
        return true;
      },
    };
  }

  _take(rk, mass, radius) {
    this.rocks.remove(rk.key);
    const mesh = new THREE.Mesh(this.rocks.geometry, this.rocks.material);
    mesh.position.copy(rk.position);
    mesh.quaternion.copy(rk.quaternion);
    mesh.scale.copy(rk.scale);
    mesh.castShadow = mesh.receiveShadow = true;
    // Keep it sunk into the regolith exactly as the field placed it, so taking
    // it - or setting it back down - never makes it pop up out of the ground.
    const p = rk.position;
    const restOffset = Math.max(this.unitHalfY * rk.scale.y * 0.3, p.y - this.rocks.hf.heightAt(p.x, p.z));
    return this.props.add(new Prop({ mesh, mass, radius, restOffset, label: rockLabel(rk.size) }));
  }
}

/** Wentworth grain-size classes, which is how a field geologist would say it. */
export function rockLabel(size) {
  return size < 0.064 ? 'pebble' : size < 0.256 ? 'cobble' : 'boulder';
}

/**
 * The registry the action system queries. Picks the best target in front of a
 * character: close, and inside a forward cone, nearer the centre wins.
 */
export class Interactables {
  constructor() { this.providers = []; this._buf = []; }
  register(p) { this.providers.push(p); return this; }

  /**
   * @param pos     character feet, world
   * @param yaw     facing, radians (forward = sin, cos)
   * @param reach   max horizontal distance from the feet, metres
   * @param cone    half-angle, radians
   */
  best(pos, yaw, reach = 1.5, cone = 1.0, filter = null) {
    const buf = this._buf; buf.length = 0;
    for (const p of this.providers) p.query(pos.x, pos.z, reach + 1, buf);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let best = null, bestScore = Infinity;
    for (const it of buf) {
      if (filter && !filter(it)) continue;
      const dx = it.position.x - pos.x, dz = it.position.z - pos.z;
      const d = Math.hypot(dx, dz);
      const edge = Math.max(0, d - it.radius);         // big rocks are reachable from further
      if (edge > reach) continue;
      const ang = d > 1e-3 ? Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) : 0;
      if (ang > cone && d > it.radius + 0.25) continue;
      const score = edge + ang * 0.6;
      if (score < bestScore) { bestScore = score; best = it; }
    }
    return best;
  }

  /** Everything within r of a point, nearest first. */
  near(point, r) {
    const buf = [];
    for (const p of this.providers) p.query(point.x, point.z, r + 1, buf);
    return buf
      .map(it => ({ it, d: it.position.distanceTo(point) - it.radius }))
      .filter(o => o.d <= r)
      .sort((a, b) => a.d - b.d)
      .map(o => o.it);
  }
}
