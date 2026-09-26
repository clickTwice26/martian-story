import * as THREE from 'three';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';

/**
 * EVA support unit: a companion that follows you across Jezero.
 *
 * It is deliberately not decorative. Everything it says is read out of the
 * same real data the world is built from - the Perseverance waypoint file, the
 * DTM validity mask, the measured slope, and the Mars24 clock - so it works as
 * a guide to the actual site rather than as flavour text.
 *
 * Model: three.js RobotExpressive (MIT, ships with the library). It carries a
 * full emote set and three facial morph targets, which is what lets it react
 * rather than just walk.
 */

export const COMPANION_MODEL = 'vendor/models/RobotExpressive.glb';
const TARGET_HEIGHT = 1.15;             // shorter than the 1.85 m crew member

const LOCOMOTION = ['Idle', 'Walking', 'Running'];
const EMOTES = ['Wave', 'ThumbsUp', 'Yes', 'No', 'Jump', 'Dance', 'Punch'];

export class Companion {
  constructor(gltf, hf) {
    this.hf = hf;
    this.root = new THREE.Group();
    this.model = gltf.scene;
    this.root.add(this.model);

    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    const h = Math.max(0.1, box.max.y - box.min.y);
    this.model.scale.setScalar(TARGET_HEIGHT / h);
    this.model.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(this.model);
    this.model.position.y -= box2.min.y;
    /* Donor facing. NOT the same as the crew model: Soldier.glb is authored
       facing -Z and needs a half turn, RobotExpressive is authored facing +Z
       and must not get one. Copying the astronaut's offset here is what made
       it moonwalk. Verified by dotting the model's world +Z against velocity. */
    this.model.rotation.y = 0;

    this.model.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; }
    });

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const c of gltf.animations) {
      const a = this.mixer.clipAction(c);
      if (EMOTES.includes(c.name)) { a.clampWhenFinished = true; a.loop = THREE.LoopOnce; }
      this.actions[c.name] = a;
    }
    this.current = null;
    this._play('Idle', 0);

    // facial morphs live on the Head mesh
    this.face = null;
    this.model.traverse(o => {
      if (o.isMesh && o.morphTargetDictionary && o.name.toLowerCase().includes('head')) this.face = o;
    });
    this.expression = null;
    this._expTimer = 0;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.emoteUntil = 0;

    // ---- autonomy ----
    this.mode = 'roam';          // roam | goto | beckon | explain | regroup | pause
    this.heel = false;           // manual override: stay close instead of roaming
    this.target = new THREE.Vector3();
    this.poi = null;
    this.stateT = 0;
    this.pauseFor = 0;
    this.nextScan = 4;
    this.lastCall = -99;
    this.visited = new Set();
    this.skipped = new Set();

    this.WALK = 1.25;            // relaxed roaming pace
    this.HURRY = 2.45;           // heading somewhere on purpose
    this.CATCHUP = 4.4;
    this.LEASH = 85;             // beyond this it comes back to find you
    this.ARRIVE = 2.0;
    this.CLOSE = 9.0;            // player this near a beckon triggers the explanation

    this.say = null;
    this.clock = 0;
    this._distanceWalked = 0;
    this._lastPlayerPos = new THREE.Vector3();
    this._greeted = false;

    // A marker it plants at whatever it wants to show you, so the call can be
    // followed from a distance instead of guessing which way it went.
    this.marker = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 26, 6),
      new THREE.MeshBasicMaterial({ color: 0x64c8ff, transparent: true, opacity: 0.34,
                                    depthWrite: false, toneMapped: false })
    );
    beam.position.y = 13;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1.05, 28),
      new THREE.MeshBasicMaterial({ color: 0x64c8ff, transparent: true, opacity: 0.55,
                                    side: THREE.DoubleSide, depthWrite: false, toneMapped: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    this.marker.add(beam, ring);
    this.marker.visible = false;
  }

  static async load(hf, url = COMPANION_MODEL) {
    const loader = new GLTFLoader();
    const gltf = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
    return new Companion(gltf, hf);
  }

  placeNear(x, z) {
    this.pos.set(x + 2.2, this.hf.heightAt(x + 2.2, z - 1.6), z - 1.6);
    this._lastPlayerPos.set(x, 0, z);
    this.root.position.copy(this.pos);
    this._setMode('roam');
  }

  _play(name, fade = 0.25) {
    const a = this.actions[name];
    if (!a || this.current === a) return;
    if (this.current) this.current.fadeOut(fade);
    a.reset().setEffectiveWeight(1).fadeIn(fade).play();
    this.current = a;
    this.currentName = name;
  }

  emote(name, expression) {
    const a = this.actions[name];
    if (!a || this.clock < this.emoteUntil) return false;
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true;
    if (this.current) this.current.fadeOut(0.18);
    a.setEffectiveWeight(1).fadeIn(0.18).play();
    this.current = a; this.currentName = name;
    this.emoteUntil = this.clock + a.getClip().duration + 0.12;
    if (expression) this.setExpression(expression, a.getClip().duration + 0.7);
    return true;
  }

  setExpression(name, seconds = 2.0) {
    if (!this.face || !this.face.morphTargetDictionary) return;
    const i = this.face.morphTargetDictionary[name];
    if (i === undefined) return;
    this.expression = i; this._expTimer = seconds;
  }

  _speak(text, ms = 5600) { if (this.say) this.say(text, ms); }
  _setMode(m) { this.mode = m; this.stateT = 0; }

  /* ------------------------------------------------------------------ AI --
   * It is not on a leash. It wanders, and independently looks for something
   * in the real data worth showing you; when it finds one it walks there,
   * plants a marker and calls you over, then explains once you arrive.
   */
  update(dt, ctx) {
    this.clock += dt;
    this.stateT += dt;
    const P = ctx.player;
    const toPlayer = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);

    if (!this._greeted && this.clock > 2.5) {
      this._greeted = true;
      this.emote('Wave', 'Surprised');
      this._speak('Support unit online. I will range ahead — when I find something worth seeing I will call you over.', 7000);
    }

    // --- manual heel overrides everything ---
    if (this.heel) {
      const bx = P.pos.x - Math.sin(P.yaw) * 2.6, bz = P.pos.z - Math.cos(P.yaw) * 2.6;
      this.target.set(bx, 0, bz);
      this._steer(dt, toPlayer > 4 ? this.HURRY : this.WALK);
      this._finish(dt, ctx, P, toPlayer);
      return;
    }

    // --- lost you: come back before anything else ---
    if (toPlayer > this.LEASH && this.mode !== 'regroup') {
      this._setMode('regroup');
      this.marker.visible = false;
      this.poi = null;
      this._speak('Too far out — coming back to you.', 3600);
    }

    switch (this.mode) {
      case 'regroup': {
        this.target.set(P.pos.x, 0, P.pos.z);
        this._steer(dt, this.CATCHUP);
        if (toPlayer < 12) { this._setMode('pause'); this.pauseFor = 1.2; }
        break;
      }

      case 'pause': {
        this.vel.multiplyScalar(Math.exp(-9 * dt));
        // idles look around rather than standing rigid
        if (this.stateT > this.pauseFor) this._setMode('roam');
        break;
      }

      case 'roam': {
        if (!this._roamTarget || this._reached(1.8)) {
          this._pickRoamTarget(P);
          if (Math.random() < 0.35) { this._setMode('pause'); this.pauseFor = 1.0 + Math.random() * 2.4; break; }
        }
        this._steer(dt, this.WALK);
        // periodically go looking for something to show you
        if (this.clock > this.nextScan) {
          this.nextScan = this.clock + 14 + Math.random() * 16;
          const poi = this._findPOI(ctx, P);
          if (poi) {
            this.poi = poi;
            this.target.set(poi.x, 0, poi.z);
            this._setMode('goto');
            this.emote('Surprised' in (this.face?.morphTargetDictionary || {}) ? 'Jump' : 'Jump', 'Surprised');
            this._speak(poi.tease, 4200);
          }
        }
        break;
      }

      case 'goto': {
        this.target.set(this.poi.x, 0, this.poi.z);
        this._steer(dt, this.HURRY);
        if (this._reached(this.ARRIVE)) {
          this.marker.position.set(this.poi.x, this.hf.heightAt(this.poi.x, this.poi.z), this.poi.z);
          this.marker.visible = true;
          this._setMode('beckon');
          this.lastCall = -99;
        }
        break;
      }

      case 'beckon': {
        this.vel.multiplyScalar(Math.exp(-8 * dt));
        this._faceToward(dt, P.pos.x, P.pos.z, 4);
        if (this.clock - this.lastCall > 9) {
          this.lastCall = this.clock;
          this.emote('Wave', 'Surprised');
          const d = Math.round(toPlayer);
          this._speak(`${this.poi.call} — ${d} m from you.`, 6000);
        }
        if (toPlayer < this.CLOSE) { this._setMode('explain'); }
        else if (this.stateT > 55) {              // you did not come; move on
          this.skipped.add(this.poi.key);
          this.marker.visible = false;
          this.poi = null;
          this._setMode('roam');
        }
        break;
      }

      case 'explain': {
        this.vel.multiplyScalar(Math.exp(-9 * dt));
        this._faceToward(dt, P.pos.x, P.pos.z, 5);
        if (this.stateT < 0.05) {
          this.emote(this.poi.emote || 'ThumbsUp');
          this._speak(this.poi.detail, 8500);
          this.visited.add(this.poi.key);
        }
        if (this.stateT > 3.2) {
          this.marker.visible = false;
          this.poi = null;
          this.nextScan = this.clock + 10 + Math.random() * 12;
          this._setMode('roam');
        }
        break;
      }
    }

    this._finish(dt, ctx, P, toPlayer);
  }

  // ------------------------------------------------------------ movement
  _pickRoamTarget(P) {
    // wander, but drift around the player rather than away over the horizon
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 9 + Math.random() * 22;
      const x = this.pos.x + Math.cos(a) * r;
      const z = this.pos.z + Math.sin(a) * r;
      if (Math.hypot(x - P.pos.x, z - P.pos.z) > 55) continue;
      if (this.hf.slopeAt(x, z) > 26) continue;              // it avoids scree too
      this.target.set(x, 0, z);
      this._roamTarget = true;
      return;
    }
    this.target.set(P.pos.x, 0, P.pos.z);
    this._roamTarget = true;
  }

  _reached(r) { return Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z) < r; }

  _steer(dt, speed) {
    const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { this.vel.multiplyScalar(Math.exp(-8 * dt)); return; }
    const want = Math.min(speed, d * 1.35);
    const nx = dx / d, nz = dz / d;
    const acc = Math.min(1, 6.5 * dt);
    this.vel.x += (nx * want - this.vel.x) * acc;
    this.vel.z += (nz * want - this.vel.z) * acc;
  }

  _faceToward(dt, x, z, rate) {
    const want = Math.atan2(x - this.pos.x, z - this.pos.z);
    let d = (want - this.yaw) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * rate);
  }

  _finish(dt, ctx, P, toPlayer) {
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.x = Math.min(this.hf.maxX - 3, Math.max(this.hf.minX + 3, this.pos.x));
    this.pos.z = Math.min(this.hf.maxZ - 3, Math.max(this.hf.minZ + 3, this.pos.z));
    this.pos.y = this.hf.heightAt(this.pos.x, this.pos.z);
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    if (this.speed > 0.2) this._faceToward(dt, this.pos.x + this.vel.x, this.pos.z + this.vel.z, 7);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;

    if (this.clock >= this.emoteUntil) {
      this._play(this.speed > 2.1 ? 'Running' : this.speed > 0.22 ? 'Walking' : 'Idle');
    }
    // Animation level of detail, set by the host from distance and view:
    // 1 = every frame, N = every Nth frame with the time accumulated, 0 = off
    // screen, so the skeleton is not posed at all. Movement is unaffected.
    this._animDt = (this._animDt || 0) + dt;
    this._animFrame = (this._animFrame || 0) + 1;
    const every = this.animEvery ?? 1;
    if (every > 0 && this._animFrame % every === 0) {
      this.mixer.update(Math.min(this._animDt, 0.5));
      this._animDt = 0;
    } else if (every === 0) {
      this._animDt = Math.min(this._animDt, 0.5);
    }

    if (this.face && this.face.morphTargetInfluences) {
      const inf = this.face.morphTargetInfluences;
      for (let i = 0; i < inf.length; i++) {
        const t = (i === this.expression && this._expTimer > 0) ? 1 : 0;
        inf[i] += (t - inf[i]) * Math.min(1, dt * 6);
      }
      if (this._expTimer > 0) this._expTimer -= dt; else this.expression = null;
    }

    if (this.marker.visible) {
      this.marker.rotation.y += dt * 0.7;
      const pulse = 0.4 + 0.2 * Math.sin(this.clock * 3);
      this.marker.children[1].material.opacity = pulse;
    }

    const moved = Math.hypot(P.pos.x - this._lastPlayerPos.x, P.pos.z - this._lastPlayerPos.z);
    if (moved < 200) this._distanceWalked += moved;
    this._lastPlayerPos.set(P.pos.x, 0, P.pos.z);
  }

  // ------------------------------------------------- what is worth showing
  _findPOI(ctx, P) {
    const cands = [];

    // 1. a real Perseverance waypoint it has not shown you yet
    if (ctx.waypoints) {
      let best = null, bd = Infinity;
      for (const f of ctx.waypoints) {
        const pr = f.properties;
        const key = 'wp' + pr.RMC;
        if (this.visited.has(key) || this.skipped.has(key)) continue;
        const [x, z] = ctx.projector.lonLatToWorld(pr.lon, pr.lat);
        const d = Math.hypot(x - this.pos.x, z - this.pos.z);
        if (d < 8 || d > 70) continue;
        if (d < bd) { bd = d; best = { pr, x, z, key }; }
      }
      if (best) {
        const km = best.pr.dist_total_m ? (best.pr.dist_total_m / 1000).toFixed(2) : null;
        cands.push({
          key: best.key, x: best.x, z: best.z, score: 3,
          tease: 'Picking up a rover position marker — follow me.',
          call: 'Perseverance stopped right here',
          emote: 'ThumbsUp',
          detail: `Rover position sol ${best.pr.sol}, site ${best.pr.site}, drive ${best.pr.drive}.` +
                  (km ? ` That was ${km} km into a traverse that reached 45.13 km.` : '') +
                  ` Recorded elevation ${best.pr.elev_geoid ? best.pr.elev_geoid.toFixed(1) : '—'} m.`,
        });
      }
    }

    // 2. the edge of measured coverage
    if (ctx.isMeasured) {
      const here = ctx.isMeasured(this.pos.x, this.pos.z);
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2, r = 18 + Math.random() * 45;
        const x = this.pos.x + Math.cos(a) * r, z = this.pos.z + Math.sin(a) * r;
        if (ctx.isMeasured(x, z) === here) continue;
        const key = 'gap' + Math.round(x / 40) + '_' + Math.round(z / 40);
        if (this.visited.has(key) || this.skipped.has(key)) continue;
        cands.push({
          key, x, z, score: 2,
          tease: 'Coverage boundary over here — worth a look.',
          call: 'The data itself changes here',
          emote: 'No',
          detail: 'This line is where HiRISE stereo coverage ends. On one side the elevation is ' +
                  'measured at 1 m per pixel; on the other it is interpolated across the gap ' +
                  'between stereo pairs. 9.3% of this tile is on the wrong side of it.',
        });
        break;
      }
    }

    // 3. genuinely steep ground, and a high vantage
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 50;
      const x = this.pos.x + Math.cos(a) * r, z = this.pos.z + Math.sin(a) * r;
      const slope = this.hf.slopeAt(x, z);
      const key = 'ter' + Math.round(x / 50) + '_' + Math.round(z / 50);
      if (this.visited.has(key) || this.skipped.has(key)) continue;
      if (slope > 24) {
        cands.push({
          key, x, z, score: 2,
          tease: 'Steep ground ahead — come see.',
          call: 'Careful on this face',
          emote: 'No',
          detail: `Measured slope here is ${slope.toFixed(0)}°. Dry regolith holds to about 29°, ` +
                  `so past that it gives way underfoot — which is why the rover routes around ground like this.`,
        });
        break;
      }
      const h = this.hf.heightAt(x, z);
      if (h - this.hf.heightAt(this.pos.x, this.pos.z) > 28) {
        cands.push({
          key, x, z, score: 1,
          tease: 'High ground this way.',
          call: 'Good vantage up here',
          emote: 'Dance',
          detail: `We are ${h.toFixed(0)} m on the Mars datum, about ` +
                  `${(h - this.hf.heightAt(P.pos.x, P.pos.z)).toFixed(0)} m above where you were standing. ` +
                  `The crater floor runs to roughly -2646 m at its lowest in this tile.`,
        });
        break;
      }
    }

    if (!cands.length) return null;
    cands.sort((a, b) => b.score - a.score);
    return cands[0];
  }
}
