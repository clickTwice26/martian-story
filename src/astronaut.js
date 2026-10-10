import * as THREE from 'three';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import { HumanoidRig, findBone } from './rig.js';

/**
 * Suited crew member, built on a real rigged humanoid rather than primitives.
 *
 * The body is any glTF with a Mixamo-style skeleton. That is deliberate: Ready
 * Player Me avatars use the same bone naming, so a personal avatar GLB can be
 * dropped in by changing MODEL_URL and nothing else.
 *
 * Locomotion is NOT played back at wall-clock speed. The walk and run clips are
 * scrubbed directly from the player's gait phase, which advances with distance
 * travelled under the traction model. Locking the clip to distance rather than
 * to time means the feet cannot slide: one gait cycle is always exactly one
 * stride of ground, whatever the speed or slope.
 */

export const MODEL_URL = 'vendor/models/Soldier.glb';   // document-relative
const TARGET_HEIGHT = 1.85;        // suited crew height, metres

const SUIT = 0xd8d3c8, SUIT_D = 0xa8a296, TRIM = 0xc8641e;
const GOLD = 0xffbb55, DARK = 0x2b2b31, METAL = 0x9aa0a8;

export class Astronaut {
  constructor(gltf) {
    this.root = new THREE.Group();
    this.model = gltf.scene;
    this.root.add(this.model);

    // ---- normalise height so any donor model lands at crew scale ----
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    const h = Math.max(0.1, box.max.y - box.min.y);
    const s = TARGET_HEIGHT / h;
    this.model.scale.setScalar(s);
    this.model.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(this.model);
    this.model.position.y -= box2.min.y;              // feet exactly on the origin
    this.measuredHeight = h * s;

    /* Donor facing. Verified on screen rather than assumed: this rig faces -Z,
       while the world's bodyYaw convention faces +Z, so it needs a half turn.
       Isolated here so swapping in another humanoid is one constant. */
    this.model.rotation.y = Math.PI;

    // ---- re-dress as EVA: recolour the donor's materials ----
    const suitMat = new THREE.MeshStandardMaterial({ color: SUIT, roughness: 0.85, metalness: 0.03 });
    this.model.traverse(o => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      o.frustumCulled = false;                        // skinned bounds go stale
      const apply = m => {
        const n = new THREE.MeshStandardMaterial({
          color: SUIT, roughness: 0.85, metalness: 0.03,
        });
        // keep any donor texture as subtle fabric variation, tinted to suit white
        if (m && m.map) { n.map = m.map; n.color.setHex(SUIT); }
        return n;
      };
      o.material = Array.isArray(o.material) ? o.material.map(apply) : apply(o.material);
    });

    // ---- suit hardware, parented to real bones ----
    this.bones = {
      head: findBone(this.model, 'mixamorigHead', 'head'),
      spine: findBone(this.model, 'mixamorigSpine2', 'mixamorigSpine1', 'spine2', 'spine'),
      hips: findBone(this.model, 'mixamorigHips', 'hips'),
    };
    this._buildSuitHardware();

    // Procedural pose layer for punch / block / pick-up, measured off this rig.
    this.rig = new HumanoidRig(this.root, this.model);

    // ---- animation ----
    this.mixer = new THREE.AnimationMixer(this.model);
    this.clips = {};
    for (const c of gltf.animations) this.clips[c.name.toLowerCase()] = c;
    this.actions = {};
    const pick = (...names) => { for (const n of names) if (this.clips[n]) return this.clips[n]; return null; };
    const idle = pick('idle'), walk = pick('walk'), run = pick('run');
    for (const [key, clip] of [['idle', idle], ['walk', walk], ['run', run]]) {
      if (!clip) continue;
      const a = this.mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(key === 'idle' ? 1 : 0);
      // walk and run are scrubbed by gait phase, so they must not self-advance
      if (key !== 'idle') a.timeScale = 0;
      this.actions[key] = a;
    }
    this.hasLocomotion = !!(this.actions.walk || this.actions.run);
    this._visible = true;
    this.availableClips = Object.keys(this.clips);
  }

  static async load(url = MODEL_URL, onProgress) {
    const loader = new GLTFLoader();
    const gltf = await new Promise((res, rej) =>
      loader.load(url, res, e => onProgress && e.total && onProgress(e.loaded / e.total), rej));
    return new Astronaut(gltf);
  }

  _buildSuitHardware() {
    const M = {
      suit: new THREE.MeshStandardMaterial({ color: SUIT, roughness: 0.86 }),
      suitD: new THREE.MeshStandardMaterial({ color: SUIT_D, roughness: 0.9 }),
      visor: new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.07, metalness: 0.96 }),
      dark: new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.55, metalness: 0.3 }),
      metal: new THREE.MeshStandardMaterial({ color: METAL, roughness: 0.35, metalness: 0.85 }),
      trim: new THREE.MeshStandardMaterial({ color: TRIM, roughness: 0.7 }),
    };

    // Hardware is sized in world metres, but bones carry the model's scale, so
    // divide it back out before parenting.
    const inv = 1 / (this.model.scale.x || 1);

    if (this.bones.head) {
      const g = new THREE.Group();
      g.scale.setScalar(inv);
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.175, 28, 22), M.suit);
      helmet.position.y = 0.085;
      const visor = new THREE.Mesh(
        new THREE.SphereGeometry(0.179, 28, 22, -Math.PI * 0.44, Math.PI * 0.88, Math.PI * 0.20, Math.PI * 0.56),
        M.visor);
      visor.position.y = 0.085;
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.05, 10), M.dark);
      lamp.position.set(0.105, 0.205, 0.05); lamp.rotation.x = Math.PI / 2.4;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.115, 0.05, 18), M.metal);
      ring.position.y = -0.075;
      g.add(helmet, visor, lamp, ring);
      this.bones.head.add(g);
      this.helmetGroup = g;
    }

    if (this.bones.spine) {
      const g = new THREE.Group();
      g.scale.setScalar(inv);
      const plss = new THREE.Mesh(new THREE.CapsuleGeometry(0.135, 0.28, 6, 18), M.suitD);
      plss.position.set(0, 0.10, -0.20); plss.scale.set(1.30, 1, 0.62);
      const t1 = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.30, 12), M.metal);
      t1.position.set(0.085, 0.10, -0.275);
      const t2 = t1.clone(); t2.position.x = -0.085;
      const ccm = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.13, 0.06), M.dark);
      ccm.position.set(0, 0.10, 0.155);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.018, 0.012), M.trim);
      band.position.set(0, 0.04, 0.185);
      g.add(plss, t1, t2, ccm, band);
      this.bones.spine.add(g);
      this.plssGroup = g;
    }

    this.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  setVisible(v) { if (this._visible !== v) { this._visible = v; this.root.visible = v; } }

  /**
   * @param gaitPhase radians; advances with DISTANCE walked, not time
   * @param speed01   0..1 of run speed
   * @param pose      optional action pose (see rig.js), layered over the clips
   */
  animate(dt, gaitPhase, speed01, airborne, lean = 0, pose = null) {
    const A = this.actions;
    const cycle = gaitPhase / (Math.PI * 2);           // full strides completed

    // Scrub locomotion clips from distance so the feet never slide.
    if (A.walk) A.walk.time = ((cycle % 1) + 1) % 1 * A.walk.getClip().duration;
    if (A.run) A.run.time = ((cycle % 1) + 1) % 1 * A.run.getClip().duration;

    // weights: idle -> walk -> run
    const moving = Math.min(1, speed01 / 0.35);
    const runBlend = Math.max(0, Math.min(1, (speed01 - 0.42) / 0.45));
    const air = airborne ? 1 : 0;
    const wIdle = (1 - moving) * (1 - air);
    const wWalk = moving * (1 - runBlend) * (1 - air * 0.75);
    const wRun = moving * runBlend * (1 - air * 0.75);
    const L = (a, w) => { if (a) a.setEffectiveWeight(a.getEffectiveWeight() + (w - a.getEffectiveWeight()) * Math.min(1, dt * 9)); };
    L(A.idle, wIdle); L(A.walk, wWalk); L(A.run, wRun);

    this.mixer.update(dt);                            // timeScale 0 on walk/run

    // Forward lean under acceleration, applied on top of the clip.
    if (this.bones.spine) {
      const t = lean + speed01 * 0.06 + (airborne ? 0.10 : 0);
      this.bones.spine.rotation.x += (t - (this._leanApplied || 0)) * Math.min(1, dt * 8) - 0;
      this._leanApplied = t;
    }
    // Keep the helmet level rather than pitching with the spine.
    if (this.helmetGroup && this.bones.head) {
      this.helmetGroup.rotation.x = -(this._leanApplied || 0) * 0.5;
    }
    this.rig.apply(pose);
  }
}
