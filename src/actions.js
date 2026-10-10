import * as THREE from 'three';
import { emptyPose } from './rig.js';

/**
 * Character activities: punch, defend, grab / carry / drop, throw.
 *
 * This is the brain, not the body. It knows nothing about keys, cameras or
 * meshes: something calls punch() / setDefend() / grab(), update() advances
 * the state machine, and the result is
 *
 *   pose        hand targets, crouch and bend in body frame - feed it to a
 *               HumanoidRig, or ignore it (first person still works)
 *   moveScale / canSprint / canJump / faceYaw
 *               how the activity constrains locomotion
 *   held        the Prop being carried, if any
 *   candidate   what grab() would pick up right now (for a prompt / marker)
 *
 * So the same controller can sit on the player, an NPC, or the support unit:
 * give it a body ({ pos, yaw, aimYaw, vel }), a world of Interactables and a
 * ground function, and drive it from input or from AI.
 */

const LIFT_MAX = 80;          // kg. Mars weight ~30 kgf, a hard but honest suited lift
const SPAN_MAX = 0.42;        // m. Widest rock two gloved hands can get round
const PUNCH_IMPULSE = 28;     // N*s. ~3.5 kg of arm and glove arriving at ~8 m/s
const HIT_RADIUS = 0.32;
const HAND_OFFSET = 0.07;     // m. Wrist sits this far above where the fingers grip
const STAND_OFF = 0.36;       // m. Feet to the near side of an item being picked up

const smooth = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const easeOut = t => { t = Math.min(1, Math.max(0, t)); return 1 - (1 - t) * (1 - t); };
const lerp = (a, b, t) => a + (b - a) * t;

/** Body frame <-> world, from feet position and facing yaw. */
function toWorld(body, v, out) {
  const s = Math.sin(body.yaw), c = Math.cos(body.yaw);
  // body x is the character's right, which faces -x of a yaw-0 forward of +z
  return out.set(body.pos.x + v.z * s - v.x * c, body.pos.y + v.y, body.pos.z + v.z * c + v.x * s);
}
function toBody(body, w, out) {
  const s = Math.sin(body.yaw), c = Math.cos(body.yaw);
  const dx = w.x - body.pos.x, dz = w.z - body.pos.z;
  return out.set(-(dx * c - dz * s), w.y - body.pos.y, dx * s + dz * c);
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

export class CharacterActions {
  /**
   * @param opts.world   Interactables registry
   * @param opts.ground  (x, z) => terrain height
   * @param opts.dims    { shoulderY, shoulderX, hipY, armLength } of the body, metres
   */
  constructor({ world, ground, dims = {} }) {
    this.world = world;
    this.ground = ground;
    this.dims = {
      shoulderY: dims.shoulderY ?? 1.48,
      shoulderX: dims.shoulderX ?? 0.19,
      hipY: dims.hipY ?? 0.98,
      armLength: dims.armLength ?? 0.6,
    };
    this.pose = emptyPose();
    this.events = {};             // onPunch, onStrike, onHit, onPickUp, onDrop, onThrow, onFail

    this.state = 'idle';          // idle | punch | reach | lift | carry | lower | release | strain | throw
    this.t = 0;
    this.guard = 0;               // 0..1 how far the block is raised
    this._defendHeld = false;
    this._punchSide = 'right';
    this._punchQueued = false;

    this.held = null;             // Prop being carried
    this.target = null;           // interactable being reached for
    this.candidate = null;
    this._from = new THREE.Vector3();     // world: where the held item started this phase
    this._to = new THREE.Vector3();       // world: where it is going
    this._relQ = new THREE.Quaternion();  // held item orientation relative to the body
    this._itemBody = new THREE.Vector3(); // item centre, body frame

    this.moveScale = 1; this.canSprint = true; this.canJump = true; this.faceYaw = null;
    this.stepTo = null;           // world point the feet should shuffle to, or null
    this._step = new THREE.Vector3();
  }

  // ------------------------------------------------------------- commands
  get busy() { return this.state !== 'idle' && this.state !== 'carry'; }

  punch() {
    if (this.state === 'carry') return this._startThrow();
    if (this.state === 'punch') { this._punchQueued = true; return true; }
    if (this.state !== 'idle') return false;
    this._startPunch();
    return true;
  }

  setDefend(on) { this._defendHeld = !!on; }

  /** Pick up what is in reach, or put down what is held. */
  grab() {
    if (this.state === 'carry') { this._startLower(); return true; }
    if (this.state !== 'idle') return false;
    const it = this.candidate;
    if (!it) { this._emit('onFail', 'nothing', null); return false; }
    if (it.radius > SPAN_MAX) { this._emit('onFail', 'too-big', it); return false; }
    this.target = it;
    this._reachT = 0;
    this._go('reach');
    return true;
  }

  /** Let go of anything at once - for teleports, mode switches, being hit. */
  dropNow() {
    if (this.held) this.held.release(null);
    this.held = null;
    this.target = null;
    this.guard = 0;
    this._go('idle');
  }

  // --------------------------------------------------------------- update
  /** @param body { pos: feet Vector3, yaw: body facing, aimYaw, vel } */
  update(dt, body) {
    this.body = body;
    this.t += dt;

    // What would grab() take? Only looked for when the hands are free.
    this.candidate = this.state === 'idle'
      ? this.world.best(body.pos, body.aimYaw ?? body.yaw, 1.25, 1.1, it => !it.held)
      : null;

    const defendTarget = this._defendHeld && (this.state === 'idle' || this.state === 'punch') ? 1 : 0;
    this.guard += (defendTarget - this.guard) * Math.min(1, dt / 0.07);

    // ---- state machine ----
    switch (this.state) {
      case 'punch': this._updatePunch(); break;
      case 'reach':
        // Shuffle in first - nobody picks a rock up from arm's length - and
        // only start bending once the feet are there (or have given up).
        if (this._approach(body) && this.t < 1.6) this._reachT = 0;
        else { this.stepTo = null; this._reachT += dt; }
        if (this._reachT >= 0.5) {
          if (this.target.mass > LIFT_MAX) { this._go('strain'); this._emit('onFail', 'too-heavy', this.target); }
          else this._startLift();
        }
        break;
      case 'strain': if (this.t >= 0.9) { this.target = null; this._go('idle'); } break;
      case 'lift': if (this.t >= 0.6) this._go('carry'); break;
      case 'lower': if (this.t >= 0.55) this._finishLower(); break;
      case 'release': if (this.t >= 0.35) { this.target = null; this._go('idle'); } break;
      case 'throw': this._updateThrow(); break;
    }

    if (this.state !== 'reach') this.stepTo = null;
    this._updateHeld();
    this._buildPose();
    this._locomotion(body);
  }

  _go(s) { this.state = s; this.t = 0; }

  /** Set stepTo while the feet are still too far from the target. */
  _approach(body) {
    const it = this.target;
    const dx = it.position.x - body.pos.x, dz = it.position.z - body.pos.z;
    const d = Math.hypot(dx, dz), want = STAND_OFF + it.radius;
    if (d <= want + 0.06) { this.stepTo = null; return false; }
    this.stepTo = this._step.set(it.position.x - dx / d * want, body.pos.y, it.position.z - dz / d * want);
    return true;
  }
  _emit(name, ...a) { const f = this.events[name]; if (f) f(...a); }

  // ---------------------------------------------------------------- punch
  _startPunch() {
    this._go('punch');
    this._punchQueued = false;
    this._struck = false;
    this._emit('onPunch', this._punchSide);
  }

  _updatePunch() {
    // windup 0-.10, strike .10-.20, hold to .25, recover to .42
    if (!this._struck && this.t >= 0.17) {
      this._struck = true;
      this._strike();
    }
    if (this._punchQueued && this.t >= 0.24) {
      this._punchSide = this._punchSide === 'right' ? 'left' : 'right';   // jab, cross
      this._startPunch();
    } else if (this.t >= 0.42) {
      this._punchSide = 'right';
      this._go('idle');
    }
  }

  _strike() {
    const D = this.dims, side = this._punchSide === 'right' ? 1 : -1;
    const point = toWorld(this.body, _v.set(side * 0.03, D.shoulderY - 0.02, D.armLength * 1.02), new THREE.Vector3());
    const dir = new THREE.Vector3(Math.sin(this.body.yaw), 0, Math.cos(this.body.yaw));
    this._emit('onStrike', { point, dir, side: this._punchSide });
    const hits = this.world.near(point, HIT_RADIUS);
    for (const it of hits) {
      if (it.held || !it.hit) continue;
      const moved = it.hit(dir, PUNCH_IMPULSE);
      this._emit('onHit', { item: it, point, dir, moved: moved !== false });
      break;
    }
  }

  // ------------------------------------------------------- grab and carry
  _startLift() {
    const prop = this.target.take();
    prop.held = true;
    prop.asleep = true;
    this.held = prop;
    this.target = prop;
    this._from.copy(prop.position);
    // keep its orientation fixed relative to the body while carried
    _q.setFromAxisAngle(_up, this.body.yaw).invert();
    this._relQ.copy(_q).multiply(prop.mesh.quaternion);
    this._go('lift');
    this._emit('onPickUp', prop);
  }

  _startLower() {
    const p = this.held;
    this._from.copy(p.position);
    // set it down just in front of the boots
    toWorld(this.body, _v.set(0, 0, 0.42 + p.radius), this._to);
    this._to.y = this.ground(this._to.x, this._to.z) + p.restOffset;
    this._go('lower');
  }

  _finishLower() {
    const p = this.held;
    p.position.copy(this._to);
    p.release(null);
    this.held = null;
    this.target = p;               // hands stay on it while straightening up
    this._go('release');
    this._emit('onDrop', p);
  }

  _startThrow() {
    this._go('throw');
    this._thrown = false;
    this._from.copy(this.held.position);
    return true;
  }

  _updateThrow() {
    const p = this.held;
    if (!this._thrown && this.t >= 0.22) {
      this._thrown = true;
      // Same push, any mass: lighter rocks leave faster. Capped at a good
      // two-handed chest toss; on Mars that still carries ~8 m.
      const speed = Math.min(6, 120 / Math.max(1, p.mass));
      const f = _v.set(Math.sin(this.body.yaw), 0, Math.cos(this.body.yaw));
      const v = new THREE.Vector3().copy(f).multiplyScalar(speed);
      v.y = speed * 0.55;
      if (this.body.vel) { v.x += this.body.vel.x; v.z += this.body.vel.z; }
      p.release(v);
      this.held = null;
      this.target = null;
      this._emit('onThrow', p, speed);
    }
    if (this.t >= 0.45) this._go('idle');
  }

  /** Where the carried item sits, body frame: chest high, lower when heavy. */
  _carryPoint(out) {
    const p = this.held || this.target, D = this.dims;
    const heavy = Math.min(1, p.mass / LIFT_MAX);
    return out.set(0, D.shoulderY - 0.36 - heavy * 0.18, 0.26 + p.radius);
  }

  _updateHeld() {
    const p = this.held;
    if (!p) return;
    const carry = this._carryPoint(_u);
    if (this.state === 'lift') {
      // break it free of the regolith, then bring it in to the chest
      toWorld(this.body, carry, _w);
      const k = smooth((this.t - 0.05) / 0.55);
      p.position.lerpVectors(this._from, _w, k);
    } else if (this.state === 'lower') {
      toWorld(this.body, carry, _w);
      const k = smooth(this.t / 0.55);
      p.position.lerpVectors(_w, this._to, k);
    } else if (this.state === 'throw') {
      // draw back over the shoulder, then drive it forward
      const t = this.t;
      const back = smooth(t / 0.14), fwd = easeOut((t - 0.14) / 0.08);
      _v.copy(carry);
      _v.y += back * 0.32; _v.z += -back * 0.16 + fwd * 0.42;
      toWorld(this.body, _v, p.position);
    } else {
      toWorld(this.body, carry, p.position);
    }
    // orientation follows the body
    _q.setFromAxisAngle(_up, this.body.yaw);
    p.mesh.quaternion.copy(_q).multiply(this._relQ);
  }

  /** Crouch and bend just deep enough that the hands can reach height y at z. */
  _reachBody(y, z) {
    const D = this.dims, spine = D.shoulderY - D.hipY, L = D.armLength * 0.95;
    let lo = 0, hi = 1;
    const ok = t => {
      const c = 0.55 * t, b = 1.2 * t;
      const sy = D.hipY - c + spine * Math.cos(b), sz = spine * Math.sin(b);
      return Math.hypot(sy - y, sz - z) <= L;
    };
    if (ok(0)) return 0;
    for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
    return hi;
  }

  // ----------------------------------------------------------------- pose
  _buildPose() {
    const P = this.pose, D = this.dims, S = D.shoulderY, L = D.armLength;
    P.crouch = 0; P.bend = 0; P.twist = 0;
    P.right.w = 0; P.left.w = 0;

    const setHand = (side, x, y, z, px, py, pz, w) => {
      const h = P[side];
      h.pos.set(x, y, z); h.pole.set(px, py, pz); h.w = w;
    };
    const guardHand = (side, w, lift = 0) => {
      const sx = side === 'right' ? 1 : -1;
      setHand(side, sx * 0.13, S + 0.04 + lift, 0.28,
              sx * (D.shoulderX + 0.55), S - 0.75, -0.15, w);
    };

    // ---- block: forearms up in front of the visor ----
    if (this.guard > 1e-3) {
      for (const side of ['right', 'left']) {
        const sx = side === 'right' ? 1 : -1;
        setHand(side, sx * 0.09, S + 0.24, 0.24, sx * 0.30, S - 0.45, 0.65, this.guard);
      }
      P.crouch = 0.06 * this.guard;
      P.bend = 0.10 * this.guard;
    }

    switch (this.state) {
      case 'punch': {
        const t = this.t, side = this._punchSide, sx = side === 'right' ? 1 : -1;
        const other = side === 'right' ? 'left' : 'right';
        const inW = smooth(t / 0.08), outW = 1 - smooth((t - 0.30) / 0.12);
        const ext = t < 0.10 ? 0 : t < 0.20 ? easeOut((t - 0.10) / 0.10) : 1 - smooth((t - 0.25) / 0.17);
        const w = Math.max(inW * outW, this.guard);
        // guard position -> full extension at shoulder height, fist turned in
        const gx = sx * 0.13, gy = S + 0.04, gz = 0.28;
        const ex = sx * 0.03, ey = S - 0.02, ez = L * 0.98;
        setHand(side, lerp(gx, ex, ext), lerp(gy, ey, ext), lerp(gz, ez, ext),
                sx * (D.shoulderX + 0.7), S - 0.55, lerp(-0.15, 0.1, ext), w);
        // off hand stays up to cover the face
        if (this.guard < 0.5) guardHand(other, Math.max(w, this.guard));
        // the torso turns into it - that is where a punch's power comes from
        P.twist = -sx * 0.38 * ext * w;
        P.bend = Math.max(P.bend, 0.06 * ext);
        break;
      }
      case 'throw':
        if (!this.held) {
          // follow-through: both arms out after the release, then relax
          const w = 1 - smooth((this.t - 0.22) / 0.23);
          for (const side of ['right', 'left']) {
            const sx = side === 'right' ? 1 : -1;
            setHand(side, sx * 0.16, S + 0.05, L * 0.95, sx * 0.7, S - 0.5, 0, w);
          }
          break;
        }
        this._grabPose(P, setHand);
        break;
      case 'reach': case 'strain': case 'lift': case 'lower': case 'release': case 'carry':
        this._grabPose(P, setHand);
        break;
    }
  }

  _grabPose(P, setHand) {
    const it = this.held || this.target;
    if (!it) return;
    toBody(this.body, it.position, this._itemBody);
    const c = this._itemBody, r = it.radius;

    // how bent the body must be to reach the item where it is now
    const gripY = c.y + r * 0.15 + HAND_OFFSET;
    const need = this._reachBody(gripY, c.z);
    let w = 1, k = need;
    switch (this.state) {
      case 'reach': w = smooth(this._reachT / 0.3); k = need * smooth(this._reachT / 0.45); break;
      case 'strain': {
        // try, fail, try once more, give up
        const s = Math.sin(this.t / 0.9 * Math.PI * 2.5);
        k = need * (1 - 0.18 * Math.max(0, s));
        w = 1 - smooth((this.t - 0.6) / 0.3);
        k *= w;
        break;
      }
      case 'release': w = 1 - smooth(this.t / 0.35); k = need * w; break;
    }
    P.crouch = 0.55 * k;
    P.bend = 1.2 * k;

    // carrying weight in front: lean back to keep the centre of mass over the feet
    if (this.held && (this.state === 'carry' || this.state === 'lift' || this.state === 'throw')) {
      const heavy = Math.min(1, it.mass / LIFT_MAX);
      P.bend -= 0.12 * heavy * (this.state === 'lift' ? smooth(this.t / 0.6) : 1);
    }

    // palms on either side of the rock, elbows out
    const grip = r + 0.035;
    for (const side of ['right', 'left']) {
      const sx = side === 'right' ? 1 : -1;
      setHand(side, c.x + sx * grip, gripY, c.z - r * 0.15,
              c.x + sx * 0.75, c.y + 0.5, c.z - 0.45, w);
    }
  }

  // ----------------------------------------------------------- locomotion
  _locomotion(body) {
    const st = this.state;
    const m = this.held ? this.held.mass : 0;
    this.faceYaw = null;
    this.moveScale = 1; this.canSprint = true; this.canJump = true;

    if (st === 'reach' || st === 'lift' || st === 'lower' || st === 'release' || st === 'strain') {
      this.moveScale = 0; this.canSprint = false; this.canJump = false;
      const it = this.held || this.target;
      if (it && st === 'reach') {
        // turn to face what we are reaching for
        this.faceYaw = Math.atan2(it.position.x - body.pos.x, it.position.z - body.pos.z);
      }
    } else if (st === 'punch' || st === 'throw') {
      this.moveScale = 0.55; this.canSprint = false;
      this.faceYaw = body.aimYaw ?? body.yaw;
    }
    if (this.guard > 0.05) {
      this.moveScale = Math.min(this.moveScale, 0.5); this.canSprint = false;
      this.faceYaw = body.aimYaw ?? body.yaw;
    }
    if (this.held) {
      // the boots have the same grip, but legs and suit carry the extra load
      this.moveScale = Math.min(this.moveScale, 1 - 0.55 * Math.min(1, m / LIFT_MAX));
      if (m > 25) this.canSprint = false;
      if (m > 40) this.canJump = false;
    }
  }
}

export { LIFT_MAX, SPAN_MAX };
