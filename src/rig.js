import * as THREE from 'three';

/**
 * Procedural pose layer for any humanoid on a Mixamo-style skeleton.
 *
 * The donor clips only cover idle / walk / run, and every new verb (punch,
 * block, pick up) would otherwise need its own authored clip per model. So
 * actions are described as WHERE the hands should be, not how each joint
 * turns: a hand target and an elbow pole in the character's own frame, plus
 * how far to crouch and bend. Two-bone IK turns that into joint rotations for
 * whatever skeleton is underneath - the same pose drives the Soldier rig, a
 * Ready Player Me avatar, or any future NPC with a humanoid skeleton.
 *
 * It runs after the AnimationMixer every frame and only edits bone locals the
 * mixer rewrites anyway, so nothing accumulates: weight 0 is exactly the clip.
 *
 * Body frame used by every pose: metres from the feet, +y up, +z forward,
 * +x toward the character's RIGHT hand - whichever side the rig puts it on.
 */

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _t = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Vector3();
const _d0 = new THREE.Vector3(), _d1 = new THREE.Vector3(), _ax = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qw = new THREE.Quaternion();
const _qa = new THREE.Quaternion();

/** Bone names survive glTF import with punctuation stripped, so match loosely. */
export function findBone(root, ...suffixes) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const bones = [];
  root.traverse(o => { if (o.isBone) bones.push(o); });
  // Suffix list outermost, so priority is by preference rather than by the
  // order bones happen to appear in the hierarchy ('spine' vs 'spine2').
  for (const want of suffixes.map(norm)) {
    for (const b of bones) if (norm(b.name) === want) return b;
    for (const b of bones) if (norm(b.name).endsWith(want)) return b;
  }
  return null;
}

/** Rotate a bone by a WORLD-space rotation, expressed back in its local frame. */
function rotateBoneWorld(bone, qWorld) {
  bone.parent.getWorldQuaternion(_qp);
  // local' = parent^-1 * qWorld * parent * local
  _q.copy(_qp).invert().multiply(qWorld).multiply(_qp);
  bone.quaternion.premultiply(_q);
  bone.updateMatrixWorld(true);
}

/**
 * Analytic two-bone IK by construction: place the middle joint where the two
 * segment lengths allow, in the plane of root->target and the pole, then aim
 * each segment at its goal. Returns nothing; leaves the chain solved in place.
 */
export function solveTwoBone(upper, lower, end, target, pole) {
  upper.getWorldPosition(_a);
  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  const l1 = _a.distanceTo(_b), l2 = _b.distanceTo(_c);
  if (l1 < 1e-5 || l2 < 1e-5) return;

  _t.subVectors(target, _a);
  let dist = _t.length();
  if (dist < 1e-5) return;
  _t.divideScalar(dist);
  // Never fully straight: a locked elbow has no defined bend plane and snaps.
  dist = Math.max(Math.abs(l1 - l2) + 1e-3, Math.min(dist, (l1 + l2) * 0.999));

  // bend direction: the pole, made perpendicular to the reach
  _p.subVectors(pole, _a);
  _p.addScaledVector(_t, -_p.dot(_t));
  if (_p.lengthSq() < 1e-8) _p.set(0, -1, 0).addScaledVector(_t, _t.y);
  _p.normalize();

  const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  _e.copy(_a).addScaledVector(_t, along).addScaledVector(_p, h);   // new elbow / knee

  // upper segment: current direction -> elbow
  _d0.subVectors(_b, _a).normalize();
  _d1.subVectors(_e, _a).normalize();
  rotateBoneWorld(upper, _qw.setFromUnitVectors(_d0, _d1));

  // lower segment: current direction -> target
  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  _d0.subVectors(_c, _b).normalize();
  _ax.copy(_a).addScaledVector(_t, dist);                          // clamped goal
  _d1.subVectors(_ax, _b).normalize();
  rotateBoneWorld(lower, _qw.setFromUnitVectors(_d0, _d1));
}

/**
 * A pose request. Every field is optional and defaults to "leave the clip".
 * Hands and feet are { pos: Vector3, pole: Vector3, w: 0..1 } in body frame.
 */
export function emptyPose() {
  return {
    crouch: 0,                 // metres the hips drop, feet stay planted
    bend: 0,                   // radians of forward spine flexion
    twist: 0,                  // radians of spine yaw (torso turns into a punch)
    right: { pos: new THREE.Vector3(), pole: new THREE.Vector3(), w: 0 },
    left: { pos: new THREE.Vector3(), pole: new THREE.Vector3(), w: 0 },
  };
}

export class HumanoidRig {
  /**
   * @param root   the object whose transform is the character's body frame
   *               (feet at origin, facing +z)
   * @param model  the skinned model inside it (bones live here)
   */
  constructor(root, model) {
    this.root = root;
    this.model = model;
    const B = (...n) => findBone(model, ...n);
    this.bones = {
      hips: B('mixamorigHips', 'hips'),
      spine: [B('mixamorigSpine', 'spine'), B('mixamorigSpine1', 'spine1'), B('mixamorigSpine2', 'spine2')]
        .filter((b, i, a) => b && a.indexOf(b) === i),
      right: [B('mixamorigRightArm', 'rightarm'), B('mixamorigRightForeArm', 'rightforearm'), B('mixamorigRightHand', 'righthand')],
      left: [B('mixamorigLeftArm', 'leftarm'), B('mixamorigLeftForeArm', 'leftforearm'), B('mixamorigLeftHand', 'lefthand')],
      rightLeg: [B('mixamorigRightUpLeg', 'rightupleg'), B('mixamorigRightLeg', 'rightleg'), B('mixamorigRightFoot', 'rightfoot')],
      leftLeg: [B('mixamorigLeftUpLeg', 'leftupleg'), B('mixamorigLeftLeg', 'leftleg'), B('mixamorigLeftFoot', 'leftfoot')],
    };
    const ok = chain => chain.every(Boolean);
    this.hasArms = ok(this.bones.right) && ok(this.bones.left);
    this.hasLegs = ok(this.bones.rightLeg) && ok(this.bones.leftLeg);

    // Which way is "right" in this rig's body frame? Measured, not assumed:
    // donors differ in facing and mirroring.
    root.updateMatrixWorld(true);
    this.rightSign = 1;
    this.armLength = 0.6;
    if (this.hasArms) {
      const rh = this._local(this.bones.right[2], new THREE.Vector3());
      const lh = this._local(this.bones.left[2], new THREE.Vector3());
      this.rightSign = rh.x >= lh.x ? 1 : -1;
      const [u, l, e] = this.bones.right.map(b => b.getWorldPosition(new THREE.Vector3()));
      this.armLength = u.distanceTo(l) + l.distanceTo(e);
      const sh = this._local(this.bones.right[0], new THREE.Vector3());
      this.shoulderHeight = sh.y;
      this.shoulderWidth = Math.abs(sh.x);
    }
    this.hipHeight = this.bones.hips ? this._local(this.bones.hips, new THREE.Vector3()).y : null;
    this._baseModelY = model.position.y;
    this._feet = [new THREE.Vector3(), new THREE.Vector3()];
    this._target = new THREE.Vector3();
    this._pole = new THREE.Vector3();
    this._saved = new Map();
  }

  /** Measured proportions, in the shape CharacterActions wants. */
  get dims() {
    return {
      shoulderY: this.shoulderHeight, shoulderX: this.shoulderWidth,
      hipY: this.hipHeight, armLength: this.armLength,
    };
  }

  /** World position of a bone, in body frame. */
  _local(bone, out) {
    bone.getWorldPosition(out);
    return this.root.worldToLocal(out);
  }

  /** Body frame (x = right hand side) to world. */
  toWorld(v, out) {
    out.set(v.x * this.rightSign, v.y, v.z);
    return this.root.localToWorld(out);
  }

  /** Current body-frame position of a shoulder, after crouch and bend. */
  shoulder(side, out = new THREE.Vector3()) {
    this._local(this.bones[side][0], out);
    out.x *= this.rightSign;
    return out;
  }

  _save(bones) { for (const b of bones) this._saved.set(b, b.quaternion.clone()); }
  _blend(bones, w) {
    if (w >= 0.999) return;
    for (const b of bones) b.quaternion.slerp(this._saved.get(b), 1 - w);
  }

  /** Apply a pose on top of whatever the mixer just wrote. */
  apply(pose) {
    const root = this.root;
    this.model.position.y = this._baseModelY;
    if (!pose) return;
    root.updateMatrixWorld(true);

    // ---- crouch: drop the hips, keep the feet where the clip planted them ----
    if (pose.crouch > 1e-3 && this.hasLegs) {
      this._feet[0].copy(this.bones.rightLeg[2].getWorldPosition(_c));
      this._feet[1].copy(this.bones.leftLeg[2].getWorldPosition(_c));
      this.model.position.y = this._baseModelY - pose.crouch;
      this.model.updateMatrixWorld(true);
      const legs = [this.bones.rightLeg, this.bones.leftLeg];
      for (let i = 0; i < 2; i++) {
        const [hip, knee, foot] = legs[i];
        // knees go forward and slightly out, the way a squat actually bends
        hip.getWorldPosition(_a);
        _b.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(_qa));
        this._pole.copy(_a).addScaledVector(_b, 1.0);
        this._pole.y -= 0.2;
        solveTwoBone(hip, knee, foot, this._feet[i], this._pole);
      }
    }

    // ---- spine: forward bend about the body's lateral axis, then twist ----
    const sp = this.bones.spine;
    if (sp.length && (Math.abs(pose.bend) > 1e-4 || Math.abs(pose.twist) > 1e-4)) {
      root.getWorldQuaternion(_qa);
      const lateral = _ax.set(1, 0, 0).applyQuaternion(_qa);     // up x forward
      const up = _d0.set(0, 1, 0).applyQuaternion(_qa);
      const per = 1 / sp.length;
      for (const b of sp) {
        if (pose.bend) rotateBoneWorld(b, _qw.setFromAxisAngle(lateral, pose.bend * per));
        if (pose.twist) rotateBoneWorld(b, _qw.setFromAxisAngle(up, pose.twist * this.rightSign * per));
      }
    }

    // ---- arms ----
    if (!this.hasArms) return;
    for (const side of ['right', 'left']) {
      const h = pose[side];
      if (!h || h.w <= 1e-3) continue;
      const chain = this.bones[side];
      this._save(chain);
      this.toWorld(h.pos, this._target);
      this.toWorld(h.pole, this._pole);
      solveTwoBone(chain[0], chain[1], chain[2], this._target, this._pole);
      this._blend(chain, Math.min(1, h.w));
      chain[0].updateMatrixWorld(true);
    }
  }
}
