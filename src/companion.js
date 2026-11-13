import * as THREE from 'three';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';

/**
 * EVA support unit: a companion that follows you across Jezero.
 *
 * Supports two authentic configurations:
 * 1. NASA Mars Ingenuity Helicopter (Default): The real coaxial Mars aerial scout
 *    that flew 72 missions alongside Perseverance in Jezero Crater.
 * 2. K-7 Ground Android Unit: The experimental robotic support unit.
 *
 * It is deliberately not decorative. Everything it says is read out of the
 * same real data the world is built from - the Perseverance waypoint file, the
 * DTM validity mask, the measured slope, and the Mars24 clock - so it works as
 * a guide to the actual site rather than as flavour text.
 */

export const COMPANION_ROBOT_MODEL = 'vendor/models/RobotExpressive.glb';
export const COMPANION_INGENUITY_MODEL = 'vendor/models/Ingenuity.glb';
const TARGET_ROBOT_HEIGHT = 1.15;

const LOCOMOTION = ['Idle', 'Walking', 'Running'];
const EMOTES = ['Wave', 'ThumbsUp', 'Yes', 'No', 'Jump', 'Dance', 'Punch'];

export class Companion {
  constructor(models, hf) {
    this.hf = hf;
    this.root = new THREE.Group();
    this.root.name = 'CompanionRoot';

    // --------------------------------------------------- 1. K-7 Android Model
    this.robotGroup = new THREE.Group();
    this.robotGroup.name = 'RobotGroup';
    if (models.robot) {
      this.robotModel = models.robot.scene;
      this.robotGroup.add(this.robotModel);

      this.robotModel.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(this.robotModel);
      const h = Math.max(0.1, box.max.y - box.min.y);
      this.robotModel.scale.setScalar(TARGET_ROBOT_HEIGHT / h);
      this.robotModel.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(this.robotModel);
      this.robotModel.position.y -= box2.min.y;
      this.robotModel.rotation.y = 0;

      this.robotModel.traverse(o => {
        if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; }
      });

      this.mixer = new THREE.AnimationMixer(this.robotModel);
      this.actions = {};
      for (const c of models.robot.animations) {
        const a = this.mixer.clipAction(c);
        if (EMOTES.includes(c.name)) { a.clampWhenFinished = true; a.loop = THREE.LoopOnce; }
        this.actions[c.name] = a;
      }

      this.face = null;
      this.robotModel.traverse(o => {
        if (o.isMesh && o.morphTargetDictionary && o.name.toLowerCase().includes('head')) this.face = o;
      });
    }
    this.root.add(this.robotGroup);

    // --------------------------------------------------- 2. NASA Ingenuity Model
    this.ingenuityGroup = new THREE.Group();
    this.ingenuityGroup.name = 'IngenuityGroup';
    this.rotorsUpper = null;
    this.rotorsLower = null;

    if (models.ingenuity) {
      this.ingenuityModel = models.ingenuity.scene;
      this.ingenuityGroup.add(this.ingenuityModel);

      // Find counter-rotating rotor blade assemblies
      this.ingenuityModel.traverse(o => {
        if (o.name === 'rotors_01') this.rotorsUpper = o;
        if (o.name === 'rotors_02') this.rotorsLower = o;
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.material) {
            o.material.roughness = Math.max(0.2, o.material.roughness || 0.4);
            o.material.metalness = Math.min(0.9, o.material.metalness || 0.3);
          }
        }
      });

      // Align vertical height so legs rest at ground offset y=0
      this.ingenuityModel.updateMatrixWorld(true);
      const iBox = new THREE.Box3().setFromObject(this.ingenuityModel);
      this.ingenuityGroundOffset = -iBox.min.y;
      this.ingenuityModel.position.y = this.ingenuityGroundOffset;
    }
    this.root.add(this.ingenuityGroup);

    // Default configuration: NASA Ingenuity Mars Helicopter
    this.type = 'ingenuity';
    this.setType('Ingenuity Mars Helicopter (NASA)');

    this.expression = null;
    this._expTimer = 0;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.emoteUntil = 0;

    // Aerial dynamics for Ingenuity
    this.hoverAltitude = 2.6;
    this.rotorRpm = 0;
    this.spinRoll = 0;

    // Autonomy AI
    this.mode = 'roam';          // roam | goto | beckon | explain | regroup | pause
    this.heel = false;
    this.target = new THREE.Vector3();
    this.poi = null;
    this.stateT = 0;
    this.pauseFor = 0;
    this.nextScan = 4;
    this.lastCall = -99;
    this.visited = new Set();
    this.skipped = new Set();

    this.WALK = 1.35;
    this.HURRY = 2.85;
    this.CATCHUP = 5.2;
    this.LEASH = 85;
    this.ARRIVE = 2.0;
    this.CLOSE = 9.0;

    this.say = null;
    this.clock = 0;
    this._distanceWalked = 0;
    this._lastPlayerPos = new THREE.Vector3();
    this._greeted = false;

    // Marker planted at interesting data features
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

  static async load(hf, robotUrl = COMPANION_ROBOT_MODEL, ingenuityUrl = COMPANION_INGENUITY_MODEL) {
    const loader = new GLTFLoader();
    const [robot, ingenuity] = await Promise.all([
      new Promise((res, rej) => loader.load(robotUrl, res, undefined, rej)),
      new Promise((res, rej) => loader.load(ingenuityUrl, res, undefined, err => {
        console.warn('[companion] Failed loading Ingenuity, fallback to robot:', err);
        res(null);
      })),
    ]);
    return new Companion({ robot, ingenuity }, hf);
  }

  setType(typeName) {
    const isIng = typeName.toLowerCase().includes('ingenuity');
    this.type = isIng ? 'ingenuity' : 'robot';
    this.isIngenuity = isIng;
    if (this.ingenuityGroup) this.ingenuityGroup.visible = isIng;
    if (this.robotGroup) this.robotGroup.visible = !isIng;
    if (!isIng && this.actions && this.actions.Idle) {
      this._play('Idle', 0);
    }
  }

  placeNear(x, z) {
    this.pos.set(x + 2.2, this.hf.heightAt(x + 2.2, z - 1.6), z - 1.6);
    this._lastPlayerPos.set(x, 0, z);
    this.root.position.copy(this.pos);
    this._setMode('roam');
  }

  _play(name, fade = 0.25) {
    if (this.isIngenuity || !this.actions) return;
    const a = this.actions[name];
    if (!a || this.current === a) return;
    if (this.current) this.current.fadeOut(fade);
    a.reset().setEffectiveWeight(1).fadeIn(fade).play();
    this.current = a;
    this.currentName = name;
  }

  emote(name, expression) {
    if (this.isIngenuity) {
      // Aerial maneuvers for Ingenuity
      this.spinRoll = name === 'Jump' || name === 'Dance' ? Math.PI * 2 : 0;
      this.emoteUntil = this.clock + 1.6;
      return true;
    }
    const a = this.actions?.[name];
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

  /* ------------------------------------------------------------------ AI -- */
  update(dt, ctx) {
    this.clock += dt;
    this.stateT += dt;
    const P = ctx.player;
    const toPlayer = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);

    if (!this._greeted && this.clock > 2.5) {
      this._greeted = true;
      this.emote('Wave', 'Surprised');
      const intro = this.isIngenuity
        ? 'Ingenuity Mars Helicopter online. Scouting ahead for safe traversals and scientific waypoints.'
        : 'Support unit online. I will range ahead — when I find something worth seeing I will call you over.';
      this._speak(intro, 7000);
    }

    // --- manual heel overrides everything ---
    if (this.heel) {
      const bx = P.pos.x - Math.sin(P.yaw) * 3.2, bz = P.pos.z - Math.cos(P.yaw) * 3.2;
      this.target.set(bx, 0, bz);
      this._steer(dt, toPlayer > 4 ? this.HURRY : this.WALK);
      this._finish(dt, ctx, P, toPlayer);
      return;
    }

    // --- lost you: return to player ---
    if (toPlayer > this.LEASH && this.mode !== 'regroup') {
      this._setMode('regroup');
      this.marker.visible = false;
      this.poi = null;
      this._speak(this.isIngenuity ? 'Ranging limit reached — returning to base perimeter.' : 'Too far out — coming back to you.', 3600);
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
        if (this.stateT > this.pauseFor) this._setMode('roam');
        break;
      }

      case 'roam': {
        if (!this._roamTarget || this._reached(1.8)) {
          this._pickRoamTarget(P);
          if (Math.random() < 0.35) { this._setMode('pause'); this.pauseFor = 1.0 + Math.random() * 2.4; break; }
        }
        this._steer(dt, this.WALK);
        if (this.clock > this.nextScan) {
          this.nextScan = this.clock + 14 + Math.random() * 16;
          const poi = this._findPOI(ctx, P);
          if (poi) {
            this.poi = poi;
            this.target.set(poi.x, 0, poi.z);
            this._setMode('goto');
            this._speak(poi.tease, 4800);
          }
        }
        break;
      }

      case 'goto': {
        this._steer(dt, this.HURRY);
        if (this._reached(this.ARRIVE)) {
          this.marker.position.set(this.poi.x, this.hf.heightAt(this.poi.x, this.poi.z), this.poi.z);
          this.marker.visible = true;
          this.lastCall = this.clock;
          this.emote('ThumbsUp', 'Happy');
          this._speak(`${this.poi.call} — ${Math.round(toPlayer)} m from you.`, 5400);
          this._setMode('beckon');
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
        else if (this.stateT > 55) {
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
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 9 + Math.random() * 22;
      const x = this.pos.x + Math.cos(a) * r;
      const z = this.pos.z + Math.sin(a) * r;
      if (Math.hypot(x - P.pos.x, z - P.pos.z) > 55) continue;
      if (this.hf.slopeAt(x, z) > 28) continue;
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
    
    const groundY = this.hf.heightAt(this.pos.x, this.pos.z);
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    if (this.speed > 0.2) this._faceToward(dt, this.pos.x + this.vel.x, this.pos.z + this.vel.z, 7);

    if (this.isIngenuity) {
      // ---------------- NASA Ingenuity Helicopter Flight & Rotor Physics
      const isLanded = (this.mode === 'pause' && this.stateT > 0.85);
      const targetAlt = isLanded ? 0.0 : (2.5 + Math.sin(this.clock * 2.8) * 0.12);
      const currentAlt = this.pos.y - groundY;
      const targetY = groundY + targetAlt;
      this.pos.y += (targetY - this.pos.y) * Math.min(1, dt * (isLanded ? 2.5 : 4.5));

      // Rotor blade spin (counter-rotating coaxial rotors)
      const wantRpm = isLanded ? 0 : (2400 + this.speed * 300);
      this.rotorRpm += (wantRpm - this.rotorRpm) * Math.min(1, dt * 5.0);
      const rotDelta = this.rotorRpm * (Math.PI * 2 / 60) * dt;
      if (this.rotorsUpper) this.rotorsUpper.rotation.y += rotDelta;
      if (this.rotorsLower) this.rotorsLower.rotation.y -= rotDelta;

      // Aerodynamic forward tilt into flight speed
      const forwardPitch = -Math.min(0.24, this.speed * 0.065);
      if (this.ingenuityGroup) {
        this.ingenuityGroup.rotation.x = forwardPitch;
        this.ingenuityGroup.rotation.z = Math.sin(this.clock * 2.5) * 0.03;
      }

      this.root.position.copy(this.pos);
      this.root.rotation.y = this.yaw;
    } else {
      // ---------------- K-7 Ground Android locomotion
      this.pos.y = groundY;
      this.root.position.copy(this.pos);
      this.root.rotation.y = this.yaw;

      if (this.clock >= this.emoteUntil) {
        this._play(this.speed > 2.1 ? 'Running' : this.speed > 0.22 ? 'Walking' : 'Idle');
      }

      this._animDt = (this._animDt || 0) + dt;
      this._animFrame = (this._animFrame || 0) + 1;
      const every = this.animEvery ?? 1;
      if (every > 0 && this._animFrame % every === 0 && this.mixer) {
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

    // 1. a real Perseverance waypoint from NASA mission data
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
          tease: this.isIngenuity ? 'Aerial telemetry acquired rover waypoint — follow flight vector.' : 'Picking up a rover position marker — follow me.',
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

    // 3. steep ground and high vantage
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
