import * as THREE from 'three';

export const MARS_G = 3.721;          // m/s^2

/**
 * Suited astronaut movement, built from the physics rather than tuned by feel.
 *
 * The defining fact of walking on Mars is NOT that you float. Your mass is
 * unchanged; only your weight drops to 38%. Since available traction is
 * mu * m * g, every horizontal manoeuvre - starting, stopping, turning - is
 * limited to about 2.0 m/s^2 instead of Earth's ~5.4. You accelerate slowly,
 * you slide when you try to stop, and you cannot change direction sharply.
 * That inertia-without-grip is what low gravity really feels like.
 *
 * Slopes follow from the same model, so the angle of repose falls out for free:
 *   downslope accel  = g * n.y * (n.x, n.z)     -> magnitude g*cos(t)*sin(t)
 *   max traction     = mu * g * n.y^2           -> magnitude mu*g*cos^2(t)
 * You begin to slide exactly when tan(t) > mu, which for mu = 0.55 is 28.8 deg -
 * close to the real angle of repose of Martian regolith.
 */
export const SETTINGS = {
  mouse: {
    sensitivity: 0.115,      // degrees of view per mouse count
    invertY: false,
    /* Zero by default, deliberately. Aim must be exactly 1:1 with the mouse.
       A critically damped spring at tau=0.038 needs ~6.6*tau to settle: >200 ms
       of the view still drifting after the mouse stopped. Measured, that reads
       as mush, not as mass. Weight belongs in the PRESENTATION around the aim
       (view.lookSway), never in the aim itself. */
    helmetInertia: 0.0,
    smoothing: 0.0,          // raw; smoothing hurts precision
  },
  view: {
    bobEnabled: true,
    bobScale: 1.0,
    strafeRoll: 1.0,
    landingDip: 1.0,
    /* Helmet + PLSS rotational inertia as a slight bank into fast pans.
       Costs nothing in aim precision because it only touches roll. */
    lookSway: 1.0,
    /* A 1.85 m figure at 3.4 m under a 62 deg FOV fills 49% of frame height,
       which reads as a giant. 6.0 m puts it near 28%, the usual third-person
       framing. The model was always the right size; the camera was not. */
    camDistance: 6.0,
    fov: 62,
  },
  move: {
    frictionCoef: 0.55,      // boot on regolith
    walkSpeed: 1.35,         // suited crews manage ~1 m/s; Apollo lope was faster
    runSpeed: 3.05,
    jumpSpeed: 3.4,
    airControl: 0.045,       // there is nothing to push against
    stepLengthWalk: 0.72,
    stepLengthRun: 1.18,
  },
};

export class Player {
  constructor(heightfield) {
    this.hf = heightfield;
    this.eyeHeight = 1.62;                 // helmet centre above the boots
    this.flySpeed = 120;

    this.pos = new THREE.Vector3();        // feet
    this.vel = new THREE.Vector3();
    this.mode = 'walk';                    // 'walk' | 'fly'

    // aim = raw mouse state; view = what the camera actually uses
    this.aimYaw = 0; this.aimPitch = 0;
    this.yaw = 0; this.pitch = 0;
    this._yawVel = 0; this._pitchVel = 0;

    this.onGround = false;
    this.groundY = 0;
    this.slope = 0;
    this.normal = new THREE.Vector3(0, 1, 0);

    this.gaitPhase = 0;
    this.speed01 = 0;
    this.exertion = 0;
    this.lean = 0;

    this.bobY = 0; this.bobX = 0; this.roll = 0;
    this._swayRoll = 0; this._strafeRoll = 0; this._prevAimYaw = 0;
    this._dip = 0; this._dipVel = 0;       // landing impact spring
    this._lastGaitSin = 0;
    this._wasGround = true;
    this._breathT = 0;

    this.events = { footstep: null, land: null };
  }

  placeAt(x, z) {
    this.pos.set(x, this.hf.heightAt(x, z), z);
    this.vel.set(0, 0, 0);
    this.onGround = true;
    this._dip = 0; this._dipVel = 0;
  }

  /** Raw pointer delta in counts. */
  applyMouse(dx, dy) {
    const s = SETTINGS.mouse.sensitivity * Math.PI / 180;
    this.aimYaw += dx * s;
    this.aimPitch += (SETTINGS.mouse.invertY ? dy : -dy) * s;
    const lim = Math.PI / 2 - 0.012;
    this.aimPitch = Math.max(-lim, Math.min(lim, this.aimPitch));
  }

  /** Critically damped spring: the helmet has mass, the input does not lag. */
  _settleView(dt) {
    const tau = Math.max(1e-4, SETTINGS.mouse.helmetInertia);
    if (tau < 1e-3) { this.yaw = this.aimYaw; this.pitch = this.aimPitch; return; }
    const w = 1 / tau;
    const stepY = -2 * w * this._yawVel - w * w * (this.yaw - this.aimYaw);
    const stepP = -2 * w * this._pitchVel - w * w * (this.pitch - this.aimPitch);
    this._yawVel += stepY * dt;
    this._pitchVel += stepP * dt;
    this.yaw += this._yawVel * dt;
    this.pitch += this._pitchVel * dt;
  }

  /**
   * Turning a ~50 kg suit-and-backpack assembly has genuine rotational
   * inertia, so the body banks slightly into a fast pan and settles out of
   * it. Roll only - yaw and pitch stay exactly where the mouse put them.
   */
  _updateSway(dt) {
    if (dt <= 0) return;
    const d = this.aimYaw - this._prevAimYaw;
    this._prevAimYaw = this.aimYaw;
    const rate = d / dt;
    const target = Math.max(-0.045, Math.min(0.045, -rate * 0.010)) * SETTINGS.view.lookSway;
    this._swayRoll += (target - this._swayRoll) * Math.min(1, dt * 7);
  }

  get eye() {
    return _eye.set(this.pos.x, this.pos.y + this.eyeHeight + this.bobY + this._dip, this.pos.z);
  }

  forward(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }

  /** @param st input snapshot from Input.state(); axes are analog-capable */
  update(dt, st) {
    this._settleView(dt);
    this._updateSway(dt);
    if (this.mode === 'fly') return this._updateFly(dt, st);
    return this._updateWalk(dt, st);
  }

  _updateFly(dt, st) {
    const hf = this.hf;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const ix = st.axisX, iz = st.axisY;
    const f = this.forward(_f);
    const r = _r.set(cos, 0, -sin);
    const boost = st.sprint ? 6 : 1;
    const slow = st.descend && st.ascend ? 0.15 : 1;
    const up = (st.ascend ? 1 : 0) - (st.descend ? 1 : 0);
    _d.set(0, 0, 0).addScaledVector(f, iz).addScaledVector(r, ix);
    if (_d.lengthSq() > 0) _d.normalize();
    _d.y += up;
    this.vel.lerp(_d.multiplyScalar(this.flySpeed * boost * slow), 1 - Math.exp(-6 * dt));
    this.pos.addScaledVector(this.vel, dt);
    this.groundY = hf.heightAt(this.pos.x, this.pos.z);
    this.slope = hf.slopeAt(this.pos.x, this.pos.z);
    if (this.pos.y < this.groundY + 2) this.pos.y = this.groundY + 2;
    this._clamp();
    this.bobY = 0; this.bobX = 0;
    this.roll = this._swayRoll;
    this.speed01 = 0; this.exertion = 0;
    return;
  }

  _updateWalk(dt, st) {
    const hf = this.hf;
    const M = SETTINGS.move;

    hf.normalAt(this.pos.x, this.pos.z, this.normal);
    const ny = Math.max(0.05, this.normal.y);
    this.slope = Math.acos(Math.min(1, ny)) * 180 / Math.PI;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const ix = st.axisX, iz = st.axisY;
    let dx = sin * iz + cos * ix;
    let dz = cos * iz - sin * ix;
    const raw = Math.hypot(dx, dz);
    // Preserve analog magnitude: a half-pushed stick must walk at half speed,
    // while a key (which reports 1.0) still saturates.
    const inMag = Math.min(1, raw);
    if (raw > 1e-5) { dx /= raw; dz /= raw; }

    const running = st.sprint;
    const desired = inMag * (running ? M.runSpeed : M.walkSpeed);

    // ---- traction budget for this frame ----
    const maxTraction = M.frictionCoef * MARS_G * ny * ny;

    if (this.onGround) {
      // gravity pulling along the surface, horizontal projection
      const gx = MARS_G * this.normal.y * this.normal.x;
      const gz = MARS_G * this.normal.y * this.normal.z;

      // Uphill costs you: the same traction now has to fight gravity too.
      const upDot = (inMag > 1e-5) ? -(dx * gx + dz * gz) : 0;
      const climbPenalty = Math.max(0.25, 1 - Math.max(0, upDot) / Math.max(maxTraction, 1e-3) * 0.55);
      const target = desired * climbPenalty;

      let wantX = dx * target - this.vel.x;
      let wantZ = dz * target - this.vel.z;

      // the whole traction budget, spent on whatever the boots are asked to do
      const budget = maxTraction * dt;
      const wm = Math.hypot(wantX, wantZ);
      if (wm > budget) { wantX *= budget / wm; wantZ *= budget / wm; }
      this.vel.x += wantX; this.vel.z += wantZ;

      // downslope pull always applies; above the angle of repose it wins
      this.vel.x += gx * dt;
      this.vel.z += gz * dt;

      this.lean += (Math.min(0.16, (wm / Math.max(budget, 1e-6)) * 0.10) - this.lean) * Math.min(1, dt * 6);
    } else {
      // Nothing to push against. A sliver of control, no more.
      const a = M.airControl * MARS_G * dt * 10;
      this.vel.x += dx * desired * a * 0.1;
      this.vel.z += dz * desired * a * 0.1;
      this.lean += (0 - this.lean) * Math.min(1, dt * 3);
    }

    if (st.jump && this.onGround) {
      this.vel.y = M.jumpSpeed;
      this.onGround = false;
    }

    this.vel.y -= MARS_G * dt;
    this.pos.addScaledVector(this.vel, dt);
    this._clamp();

    const gy = hf.heightAt(this.pos.x, this.pos.z);
    this.groundY = gy;
    const wasAir = !this.onGround;
    if (this.pos.y <= gy) {
      const impact = this.vel.y;
      this.pos.y = gy;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
      if (wasAir && impact < -1.2) {
        this._dipVel -= Math.min(2.6, -impact * 0.30) * SETTINGS.view.landingDip;
        if (this.events.land) this.events.land(impact);
      }
    } else if (this.pos.y > gy + 0.02) {
      this.onGround = false;
    }

    // ---------------- gait, driven by distance not time ----------------
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.speed01 = Math.min(1, hs / M.runSpeed);
    if (this.onGround && hs > 0.08) {
      const stepLen = M.stepLengthWalk +
        (M.stepLengthRun - M.stepLengthWalk) * this.speed01;
      this.gaitPhase += (hs * dt / stepLen) * Math.PI;
      const s = Math.sin(this.gaitPhase);
      if (this._lastGaitSin <= 0 && s > 0 || this._lastGaitSin >= 0 && s < 0) {
        if (this.events.footstep) this.events.footstep(0.45 + this.speed01 * 0.8, this.slope);
        this._dipVel -= 0.55 * (0.3 + this.speed01) * SETTINGS.view.landingDip;
      }
      this._lastGaitSin = s;
    } else if (!this.onGround) {
      this.gaitPhase += dt * 1.2;
    }

    // ---------------- view motion ----------------
    const V = SETTINGS.view;
    if (V.bobEnabled && this.onGround) {
      const a = this.speed01 * V.bobScale;
      const tgtY = Math.cos(this.gaitPhase * 2) * 0.026 * a;
      const tgtX = Math.sin(this.gaitPhase) * 0.032 * a;
      this.bobY += (tgtY - this.bobY) * Math.min(1, dt * 16);
      this.bobX += (tgtX - this.bobX) * Math.min(1, dt * 16);
    } else {
      this.bobY += (0 - this.bobY) * Math.min(1, dt * 6);
      this.bobX += (0 - this.bobX) * Math.min(1, dt * 6);
    }

    // idle breathing sway, so a standing view is never perfectly dead
    this._breathT += dt;
    if (this.speed01 < 0.05 && this.onGround) {
      this.bobY += Math.sin(this._breathT * 1.15) * 0.0022;
    }

    // strafe roll: leaning into a sidestep
    const strafe = (ix !== 0 && this.onGround) ? -ix * 0.016 * V.strafeRoll : 0;
    this._strafeRoll += (strafe - this._strafeRoll) * Math.min(1, dt * 5);
    this.roll = this._strafeRoll + this._swayRoll;

    // landing / footfall dip spring (critically damped, w = 13)
    const w = 13;
    this._dipVel += (-2 * w * this._dipVel - w * w * this._dip) * dt;
    this._dip += this._dipVel * dt;
    if (this._dip < -0.45) { this._dip = -0.45; this._dipVel = 0; }

    // exertion drives breathing rate in the audio mix
    const climb = Math.max(0, this.slope - 8) / 28;
    const target = Math.min(1, this.speed01 * 0.75 + climb * 0.5 + (running ? 0.12 : 0));
    this.exertion += (target - this.exertion) * Math.min(1, dt * 0.55);
  }

  _clamp() {
    const hf = this.hf, m = 4;
    this.pos.x = Math.min(hf.maxX - m, Math.max(hf.minX + m, this.pos.x));
    this.pos.z = Math.min(hf.maxZ - m, Math.max(hf.minZ + m, this.pos.z));
  }
}

const _eye = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _d = new THREE.Vector3();
