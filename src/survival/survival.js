import * as THREE from 'three';
import { Prop } from '../interact.js';
import { siteTime, utcForSolAndLmst, formatSolClock, JEZERO, SOL_SECONDS } from '../marstime.js';
import { Particles } from '../intro/particles.js';
import * as M from './models.js';
import { MISSIONS, CRATES, OPENING, BADGES, RANKS } from './campaign.js';

/**
 * Part Two: Survive Jezero - the engine.
 *
 * Runs the life-support budget (oxygen, power, water, food, radiation) on the
 * game's own Mars clock, places the salvage and base modules in the world,
 * checks mission objectives, and draws the survival HUD and journal.
 *
 * Time: while the story runs, the Mars clock advances 60x (one Mars minute per
 * real second), so the sun - and with it the solar array - moves for real.
 * Resting in the habitat skips time and integrates the same budget offline.
 *
 * Rates are per sol unless named otherwise. The ones from NASA sources:
 *   0.84 kg O2 / person / sol, 2.5 L drinking water, 1.83 kg (3000 kcal) food,
 *   0.67 mSv surface dose, 1.84 mSv cruise dose, 586 W/m^2 sunlight,
 *   MOXIE 12 g/h on 300 W, 98% water recovery (ISS).
 * Scaled for play (and labelled so in the journal): the 10x MOXIE stack,
 * the 40 m^2 array, the oven's per-rock grade, the berm mass.
 */

const RATE = 60;                       // Mars seconds per real second while playing
const SAVE_KEY = 'martianStory.survival.v1';

const O2_PER_SOL = 0.84;               // kg, NASA NTRS 20120015343
const SUIT_HOURS = 8;                  // EVA suit endurance
const SUIT_KG_PER_HOUR = O2_PER_SOL / 24.66;
const WATER_PER_SOL = 2.5;             // L, NASA OCHMO minimum
const RECYCLE = 0.98;                  // ISS water recovery
const DOSE_SURFACE = 0.67;             // mSv/sol, Curiosity RAD
const DOSE_CRUISE_START = 212 * 1.84;  // the transfer so far: 390 mSv
const DOSE_LIMIT = 600;                // NASA career limit (2022)
const SOLAR_W_M2 = 586.2;              // top of atmosphere, NASA fact sheet
const PV_AREA = 40, PV_EFF = 0.29, PV_CLEAR = 0.75;
const BATTERY_CAP = 40;                // kWh
const HAB_LOAD = 0.5, GREEN_LOAD = 1.2, O2_LOAD = 3.0, ISRU_LOAD = 3.5;   // kW
const O2_RATE = 0.120;                 // kg/h: a 10x MOXIE (MOXIE peak 12 g/h)
const HAB_O2_START = 6, HAB_O2_CAP = 12;
const OVEN_KWH_PER_L = 1.2;            // M-WIP gypsum case, ~1.2 kWh per kg water
const RECOVERY = 0.5;                  // NASA Glenn tilt-tray test
const PURIFY_KWH_PER_L = 0.25, PURIFY_YIELD = 0.9;
const PROPELLANT_SOLS = 300;           // DRA 5.0: plant runs >= 300 days
const GREEN_DIET = 0.4;                // share of the diet the greenhouse grows

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const el = id => document.getElementById(id);
const hash01 = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

export class Survival {
  /**
   * @param o { scene, hf, crash, wreck, player, companion, actions, props, audio,
   *            timeState, camera, notice(msg, ms), isMeasured(x, z) }
   */
  constructor(o) {
    Object.assign(this, o);
    this.SHIELD_KG = 160;
    this.running = false;
    this.journalOpen = false;
    this.paused = false;
    this.ending = null;
    this.prompt = '';
    this.job = null;
    this.storm = 0;
    this.radio = [];
    this._radioT = 0;
    this._hudT = 0;
    this._tmp = new THREE.Vector3();
    this._fx = new THREE.Group();
    this.scene.add(this._fx);
    this.crates = {};
    this.zoneRings = {};
    this.modules = {};
    this._layout();
    this._buildHUD();
    this._reset();
    this._load();
  }

  /* ================================================================ layout == */
  _layout() {
    const hf = this.hf, L = this.crash;
    const W = L.W, h = L.h, side = L.side, I = L.I;
    const A = this.anchors = {};
    const at = (x, z) => new THREE.Vector3(x, hf.heightAt(x, z), z);
    const off = (p, a, b, s = 1, t = 1) => at(p.x + a.x * s + b.x * t, p.z + a.z * s + b.z * t);
    A.wreck = at(W.x, W.z);
    A.bay = off(W, side, h, 4.6, -2.5);
    A.sled = off(W, h, side, -12, 1.5);
    A.capsule = off(W, h, side, 13, -6);

    // Camp: the flattest measured ground 18-36 m from the spawn, clear of the
    // furrow and the hull, so modules sit level and the walk to the wreck is short.
    const spawn = L.spawn;
    const segD = (x, z) => {
      const abx = W.x - I.x, abz = W.z - I.z;
      const t = clamp(((x - I.x) * abx + (z - I.z) * abz) / (abx * abx + abz * abz), 0, 1);
      return Math.hypot(x - (I.x + abx * t), z - (I.z + abz * t));
    };
    const rough = (x, z) => {
      let s = 0;
      for (const [dx, dz] of [[0, 0], [7, 0], [-7, 0], [0, 7], [0, -7], [5, 5], [-5, -5]]) s += hf.slopeAt(x + dx, z + dz);
      return s / 7;
    };
    let best = null, bs = Infinity;
    for (let r = 18; r <= 36; r += 3) for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2;
      const x = spawn.x + Math.cos(a) * r, z = spawn.z + Math.sin(a) * r;
      if (segD(x, z) < 14 || Math.hypot(x - W.x, z - W.z) < 22) continue;
      const measured = this.isMeasured ? this.isMeasured(x, z) : true;
      const s = rough(x, z) + (measured ? 0 : 50) + r * 0.04;
      if (s < bs) { bs = s; best = [x, z]; }
    }
    if (!best) best = [spawn.x - 20, spawn.z];
    const B = at(best[0], best[1]);
    A.base = B;
    const fwd = new THREE.Vector3(A.bay.x - B.x, 0, A.bay.z - B.z).normalize();
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    this.baseYaw = Math.atan2(fwd.x, fwd.z);
    this.fwd = fwd; this.right = right;
    const local = (lx, lz) => off(B, right, fwd, lx, lz);
    A.door = local(0, 4.6);
    A.solar = local(-14, -2);
    A.plant = local(8.5, 5);
    A.oven = local(12, 1.2);
    A.purifier = local(8.5, 9);
    A.sabatier = local(12.5, 6.5);
    A.greenhouse = local(-7.5, 9);
    A.cargo = local(-22, -26);

    // Reactor: 80 m behind camp, on the least sloping ground nearby.
    let rb = null, rs = Infinity;
    for (let k = -4; k <= 4; k++) for (const d of [74, 80, 86]) {
      const a = k * 0.12;
      const dx = -fwd.x * Math.cos(a) + right.x * Math.sin(a), dz = -fwd.z * Math.cos(a) + right.z * Math.sin(a);
      const x = B.x + dx * d, z = B.z + dz * d;
      const s = rough(x, z);
      if (s < rs) { rs = s; rb = [x, z]; }
    }
    A.reactor = at(rb[0], rb[1]);

    // Ore: a sulfate-bearing outcrop 40-55 m to one side of camp. The side with
    // more scattered rock (steeper, broken ground) reads as the outcrop.
    let ob = null, os = -Infinity;
    for (const sgn of [1, -1]) for (const d of [40, 48, 55]) for (const a of [-0.35, 0, 0.35]) {
      const dx = right.x * sgn * Math.cos(a) + fwd.x * Math.sin(a), dz = right.z * sgn * Math.cos(a) + fwd.z * Math.sin(a);
      const x = B.x + dx * d, z = B.z + dz * d;
      if (segD(x, z) < 16 || Math.hypot(x - W.x, z - W.z) < 24) continue;
      const s = Math.min(rough(x, z), 18) - d * 0.05;
      if (s > os) { os = s; ob = [x, z]; }
    }
    if (!ob) ob = [B.x + right.x * 45, B.z + right.z * 45];
    A.ore = at(ob[0], ob[1]);
    this.ORE_R = 11;

    // Salvage scattered down the furrow, and the bay's own cargo.
    const furrow = t => [I.x + (W.x - I.x) * t, I.z + (W.z - I.z) * t];
    const fz = (t, s) => { const [x, z] = furrow(t); return at(x + side.x * s, z + side.z * s); };
    this.crateHome = {
      hab: fz(0.28, 5.5), solar: fz(0.52, -6.0), food: fz(0.74, 6.5),
      isru: off(A.bay, side, h, 1.6, -1.4), oven: off(A.bay, side, h, 1.6, 0.2),
      purifier: off(A.bay, side, h, 1.6, 1.6), seeds: off(A.bay, side, h, 2.6, -0.6),
      sabatier: off(A.bay, side, h, 2.6, 1.0), hose: off(A.bay, side, h, 3.4, 0.2),
      cargo: A.cargo,
    };
    // where each crate counts as delivered
    this.crateZone = {
      hab: ['base', 9], solar: ['base', 9], food: ['base', 9], cargo: ['base', 9],
      isru: ['plant', 3.5], oven: ['oven', 3.5], purifier: ['purifier', 3.5], seeds: ['greenhouse', 4],
      sabatier: ['sabatier', 3.5], hose: ['capsule', 4.5],
    };
  }

  pt(name) { return typeof name === 'string' ? this.anchors[name] : name; }

  /* ================================================================= state == */
  _reset() {
    this.m = 0; this.step = 0;
    this.res = { suitO2: 1.6, habO2: 0, battery: 0, water: 1.0, waterRaw: 0, food: 1, dose: DOSE_CRUISE_START, propellant: 0 };
    this.built = {};
    this.flag = { greenOn: true };
    this.c = { shieldKg: 0, waterMade: 0, waterPurified: 0, rockKg: 0, harvest: 0, growth: 0, stormSols: 0,
               o2Made: 0, kwhSolar: 0, kwhReactor: 0 };
    this.solsSinceCrash = 0;
    this.points = 0;
    this.badges = [];
    this.blackouts = 0;
    this.bottleFills = 4;
    this.reactorState = 'wreck';
    this.delivered_ = {};
    this.done = false;
    this.power = { gen: 0, load: 0, solar: 0 };
  }

  _save() {
    if (!this.running) return;
    const data = { v: 1, m: this.m, step: this.step, res: this.res, built: this.built, flag: this.flag, c: this.c,
                   sols: this.solsSinceCrash, points: this.points, badges: this.badges, blackouts: this.blackouts,
                   bottle: this.bottleFills, reactor: this.reactorState === 'towing' ? 'site' : this.reactorState,
                   delivered: this.delivered_, done: this.done,
                   time: { sol: this.timeState.sol, lmst: this.timeState.lmst } };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { /* private mode: play on unsaved */ }
  }

  _load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { d = null; }
    this.saved = d && d.v === 1 ? d : null;
  }

  get hasSave() { return !!this.saved; }

  /* ================================================================= start == */
  /** Called when play begins (after the opening, or straight away without it). */
  begin() {
    if (this.running) return;
    this.running = true;
    this.hud.root.classList.add('on');
    document.body.classList.add('story');
    if (this.wreck) this.wreck.age = Math.max(this.wreck.age, 380);   // a night later: smouldering
    this.showZone('base'); this.showZone('ore');
    if (!this.saved?.done) this._placeCapsule();
    const d = this.saved;
    if (d) {
      Object.assign(this.res, d.res);
      this.built = d.built || {}; this.flag = { greenOn: true, ...d.flag }; Object.assign(this.c, d.c);
      this.solsSinceCrash = d.sols || 0; this.points = d.points || 0; this.badges = d.badges || [];
      this.blackouts = d.blackouts || 0; this.bottleFills = d.bottle ?? 4; this.reactorState = d.reactor || 'wreck';
      this.delivered_ = d.delivered || {}; this.done = !!d.done;
      if (d.time) { this.timeState.sol = d.time.sol; this.timeState.lmst = d.time.lmst; }
      for (const k of Object.keys(this.built)) if (this.built[k]) this._placeModule(k, true);
      for (const k of Object.keys(this.delivered_)) this._placeDeliveredCrate(k);
      this.m = Math.min(d.m, MISSIONS.length - 1); this.step = d.step || 0;
      if (this.done) { this.m = MISSIONS.length; this._renderMission(); this.say([['K-7', 'Welcome back, Commander. The plant is still running.']]); }
      else {
        this._enterMission(false);
        this._banner(`MISSION ${this.m + 1} · RESUMED`, MISSIONS[this.m].title, `Sol ${this._crashSol()} after impact`);
        this.say([['K-7', 'Welcome back, Commander. Picking up where we left off.']]);
      }
      this.player.placeAt(this.anchors.door.x + this.fwd.x * 2, this.anchors.door.z + this.fwd.z * 2);
    } else {
      // The morning after: sol +1, 07:40 local.
      this.timeState.sol += 1;
      this.timeState.lmst = 7 + 40 / 60;
      this.solsSinceCrash = 1;
      this._fade(true);
      setTimeout(() => {
        this._fade(false);
        this._banner('PART TWO', 'SURVIVE JEZERO', 'Sol 1 after impact · 07:40 local solar time', 6500);
        this.say(OPENING);
        this._enterMission(true);
      }, 900);
    }
  }

  _crashSol() { return Math.max(1, Math.floor(this.solsSinceCrash)); }

  _enterMission(fresh) {
    const mi = MISSIONS[this.m];
    if (!mi) return;
    mi.setup?.(this);
    const obj = mi.objectives[this.step];
    obj?.enter?.(this);
    if (fresh) {
      setTimeout(() => {
        this._banner(`MISSION ${this.m + 1} OF ${MISSIONS.length} · ACT ${mi.act}`, mi.title, mi.tagline, 5200);
        this.audio?.beep?.('mode');
      }, this.m === 0 ? 7200 : 600);
      this.say(mi.brief);
      if (obj?.say) this.say(obj.say);
      this._guide();
    }
    this._renderMission();
  }

  _guide() {
    const obj = MISSIONS[this.m]?.objectives[this.step];
    if (!obj || !obj.at) return;
    const p = this.pt(typeof obj.at === 'function' ? obj.at(this) : obj.at);
    const c = this.companion;
    if (!p || !c || !c.root.visible || c.heel) return;
    c.poi = { key: 'story' + this.m + '_' + this.step, x: p.x, z: p.z, tease: '', call: 'Over here, Commander',
              detail: typeof obj.text === 'function' ? obj.text(this) : obj.text, emote: 'ThumbsUp' };
    c.target.set(p.x, 0, p.z);
    c.marker.visible = false;
    c._setMode('goto');
  }

  /* ============================================================ world API == */
  near(name, r) {
    const p = this.pt(name);
    return p ? Math.hypot(this.player.pos.x - p.x, this.player.pos.z - p.z) <= r : false;
  }
  get inside() {
    return !!this.built.hab && Math.hypot(this.player.pos.x - this.anchors.base.x, this.player.pos.z - this.anchors.base.z) < 5.2;
  }
  delivered(id) { return !!this.delivered_[id]; }
  carryingRock() { return this.actions.held?.kind === 'rock'; }

  /** Where to point the player for a crate: the crate itself, or its drop zone while carried. */
  crateTarget(id, zone) {
    const c = this.crates[id];
    if (!c) return zone || this.crateZone[id][0];
    if (c.prop.held) return zone || this.crateZone[id][0];
    return c.prop.position;
  }

  spawnCrate(id) {
    if (this.crates[id] || this.delivered_[id]) return;
    const def = CRATES[id];
    const { mesh, halfHeight, radius } = M.makeCrate(def.code, def.accent, def.size);
    const home = this.crateHome[id];
    mesh.position.set(home.x, this.hf.heightAt(home.x, home.z) + halfHeight, home.z);
    mesh.rotation.y = hash01(home.x, home.z) * Math.PI;
    const prop = new Prop({ mesh, mass: def.mass, radius, restOffset: halfHeight, kind: 'crate', label: def.label });
    prop.crateId = id;
    this.props.add(prop);
    this.crates[id] = { id, prop };
  }

  _placeDeliveredCrate(id) {
    // Delivered crates stay in camp as props you can no longer pick up, until used.
    if (this._usedBy(id) && this.built[this._usedBy(id)]) return;
    const def = CRATES[id];
    const [zone] = this.crateZone[id];
    const z = this.anchors[zone];
    const { mesh, halfHeight } = M.makeCrate(def.code, def.accent, def.size);
    const a = hash01(z.x + id.length, z.z) * Math.PI * 2;
    const x = z.x + Math.cos(a) * 2.2, zz = z.z + Math.sin(a) * 2.2;
    mesh.position.set(x, this.hf.heightAt(x, zz) + halfHeight, zz);
    this._fx.add(mesh);
    this.crates[id] = { id, prop: { mesh, position: mesh.position, held: false }, stored: true };
  }

  _usedBy(id) {
    return { hab: 'hab', solar: 'solar', isru: 'o2plant', oven: 'oven', purifier: 'purifier',
             seeds: 'greenhouse', sabatier: 'sabatier', hose: 'fuelLine' }[id];
  }

  showZone(name) {
    if (this.zoneRings[name]) return;
    const p = this.anchors[name];
    const r = name === 'ore' ? this.ORE_R : 9;
    const ring = M.makeZoneRing(this.hf, p.x, p.z, r, name === 'ore' ? 0x7fe3ff : 0xffb347);
    this.zoneRings[name] = ring;
    this._fx.add(ring);
  }

  startJob(label, seconds, at, onDone) {
    this.job = { label, t: 0, dur: seconds, at, onDone };
    this.audio?.beep?.('mode');
    const p = this.pt(at), c = this.companion;
    if (c && c.root.visible && !c.heel && p) {        // K-7 comes over to help
      c.poi = null; c.marker.visible = false;
      c.target.set(p.x + 1.5, 0, p.z + 1.5);
      c._setMode('regroup');
    }
  }

  build(kind) {
    this.built[kind] = true;
    this._placeModule(kind, false);
    const used = Object.entries({ hab: 'hab', solar: 'solar', o2plant: 'isru', oven: 'oven', purifier: 'purifier',
                                  greenhouse: 'seeds', sabatier: 'sabatier', fuelLine: 'hose' }).find(([k]) => k === kind);
    if (used) {
      const c = this.crates[used[1]];
      if (c) { if (c.stored) this._fx.remove(c.prop.mesh); else this.props.remove(c.prop); }
    }
    if (kind === 'hab') this.res.habO2 = Math.max(this.res.habO2, HAB_O2_START);
    this.audio?.beep?.('ok');
    this._points(60, kind === 'fuelLine' ? 'fuel line connected' : kind + ' online');
    this._save();
  }

  _placeModule(kind, instant) {
    const A = this.anchors, hf = this.hf;
    let g = null, at = null, yaw = this.baseYaw;
    switch (kind) {
      case 'hab': {
        g = M.makeHab(); at = A.base;
        const berm = M.makeBerm();
        berm.position.copy(A.base); berm.rotation.y = yaw;
        this._fx.add(berm);
        this.modules.berm = berm;
        break;
      }
      case 'solar': g = M.makeSolarArray(); at = A.solar; break;
      case 'o2plant': g = M.makeO2Plant(); at = A.plant; break;
      case 'oven': g = M.makeOven(); at = A.oven; break;
      case 'purifier': g = M.makePurifier(); at = A.purifier; break;
      case 'greenhouse': g = M.makeGreenhouse(); at = A.greenhouse; break;
      case 'sabatier': g = M.makeSabatier(); at = A.sabatier; break;
      case 'reactor': {
        if (!this.modules.reactor) { this.setupReactor(); }
        this.reactorState = 'site';
        const r = this.modules.reactor;
        r.position.copy(A.reactor);
        r.userData.fins.scale.setScalar(1);
        return;
      }
      case 'fuelLine': {
        const line = M.makeFuelLine(hf, A.sabatier, A.capsule);
        this._fx.add(line);
        this.modules.fuelLine = line;
        return;
      }
      default: return;
    }
    g.position.copy(at);
    g.rotation.y = yaw;
    g.userData.grow = instant ? 1 : 0;
    if (!instant) g.scale.setScalar(0.01);
    this._fx.add(g);
    this.modules[kind] = g;
  }

  setupReactor() {
    if (this.modules.reactor) return;
    const r = M.makeReactor();
    const s = this.anchors.sled;
    r.position.copy(this.reactorState === 'wreck' ? s : this.anchors.reactor);
    r.rotation.y = this.baseYaw;
    if (this.built.reactor) r.userData.fins.scale.setScalar(1);
    this._fx.add(r);
    this.modules.reactor = r;
  }

  towReactor() {
    this.reactorState = 'towing';
    this.say([['K-7', 'Clamps free. Towing. Walk with me — it is 80 metres.']]);
    this.audio?.beep?.('ok');
    const c = this.companion, p = this.anchors.reactor;
    if (c && c.root.visible) {
      c.heel = false;
      c.poi = { key: 'tow', x: p.x, z: p.z, tease: '', call: 'Reactor site', detail: 'Reactor parked. Distance and the ground between us are the shielding.', emote: 'ThumbsUp' };
      c.target.set(p.x, 0, p.z);
      c._setMode('goto');
    }
  }

  purify() {
    const L = this.res.waterRaw, need = L * PURIFY_KWH_PER_L;
    if (this.res.battery < need) {
      this.notice(`Purifier needs ${need.toFixed(1)} kWh — battery has ${this.res.battery.toFixed(1)}.`, 3200);
      this.audio?.beep?.('err');
      return;
    }
    this.startJob('Distilling and polishing', 5, 'purifier', () => {
      this.res.battery -= need;
      const out = L * PURIFY_YIELD;
      this.res.waterRaw -= L;
      this.res.water += out;
      this.c.waterPurified += out;
      this.say([['K-7', `${out.toFixed(1)} L of clean water. The salts stay behind in the still.`]]);
      this._points(Math.round(out * 15), 'water purified');
      this._save();
    });
  }

  launch() {
    this.flag.launched = true;
    this.ending = { t: 0, v: 0, y: 0 };
    this.plume = new Particles(600, { additive: true, renderOrder: 15 });
    this.smoke = new Particles(400, { additive: false, renderOrder: 14 });
    this.scene.add(this.plume.mesh, this.smoke.mesh);
    this.actions.dropNow();
    this._hideTop(true);
  }

  say(lines) { for (const [who, text] of lines || []) this.radio.push({ who, text }); }

  award(id) {
    if (this.badges.includes(id) || !BADGES[id]) return;
    this.badges.push(id);
    const [name, why] = BADGES[id];
    this._points(150, null);
    this._toast(`BADGE · ${name.toUpperCase()}`, why);
  }

  _points(n, why) {
    this.points = Math.max(0, this.points + n);
    if (why && n) this._float(`${n > 0 ? '+' : ''}${n} · ${why}`, n < 0);
  }

  /* ================================================================ input == */
  /** E pressed. Returns true if a station used it (so the hands do not grab). */
  interact() {
    if (!this.running || this.ending || this.journalOpen) return false;
    if (this.actions.state === 'carry' || this.actions.candidate) return false;
    const s = this._station;
    if (!s) return false;
    s.use(this);
    return true;
  }

  noteGrab(candidate) { this._lastCand = candidate || null; }

  onPickUp(prop) {
    if (prop.kind === 'rock' && prop.grade === undefined) {
      const c = this._lastCand;
      const p = c ? c.position : prop.position;
      prop.grade = this.gradeAt(p.x, p.z);
      if (prop.grade > 0) prop.label = 'hydrated sulfate';
    }
  }

  gradeAt(x, z) {
    const o = this.anchors.ore;
    if (Math.hypot(x - o.x, z - o.z) > this.ORE_R) return 0;
    return 0.04 + 0.16 * hash01(Math.round(x * 50), Math.round(z * 50));
  }

  /** Extra words for the pick-up prompt. */
  describe(it) {
    if (!this.running || !it) return '';
    if (it.kind === 'rock' && (this.flag.oreOpen || this.m >= 5)) {
      const g = it.grade ?? this.gradeAt(it.position.x, it.position.z);
      return g > 0 ? ` · <span style="color:#7fe3ff">sulfate, ${(g * 100).toFixed(0)}% water → ${(it.mass * g * RECOVERY).toFixed(1)} L</span>`
                   : ' · <span style="color:#9a7c66">basalt, dry</span>';
    }
    return '';
  }

  /** Camera hook for the ending. Returns true when it drove the camera. */
  driveCamera(cam) {
    const e = this.ending;
    if (!e || !this.modules.capsule) return false;
    const c = this.anchors.capsule, body = this.modules.capsule.userData.body;
    const tgt = this._tmp.set(c.x, c.y + 2.5 + body.position.y * 0.85, c.z);
    const a = 0.6 + e.t * 0.02;
    cam.position.set(c.x + Math.cos(a) * 34, c.y + 7 + Math.min(40, body.position.y * 0.25), c.z + Math.sin(a) * 34);
    cam.lookAt(tgt);
    return true;
  }

  get hidePlayer() { return !!this.ending; }

  /** Mars seconds per real second the world clock should run at, or null when the story is not driving it. */
  clockRate() {
    if (!this.running) return null;
    return this.paused || this.journalOpen || this.ending ? 0 : RATE;
  }

  /** Keep the walker out of the hab, the pod and the bigger modules. */
  collide(pos) {
    const A = this.anchors;
    const hit = (cx, cz, R) => {
      const dx = pos.x - cx, dz = pos.z - cz, d = Math.hypot(dx, dz);
      if (d >= R || d < 1e-6) return false;
      pos.x = cx + dx / d * R; pos.z = cz + dz / d * R;
      return true;
    };
    let any = false;
    if (this.built.hab) {
      // capsule along the hab's long axis (local x), 2.1 m radius
      const B = A.base, rx = this.right.x, rz = this.right.z;
      const t = clamp((pos.x - B.x) * rx + (pos.z - B.z) * rz, -2.6, 2.6);
      any = hit(B.x + rx * t, B.z + rz * t, 2.55) || any;
    }
    if (this.modules.capsule && !this.ending) any = hit(A.capsule.x, A.capsule.z, 1.9) || any;
    if (this.modules.greenhouse) any = hit(A.greenhouse.x, A.greenhouse.z, 2.7) || any;
    if (this.modules.reactor) any = hit(this.modules.reactor.position.x, this.modules.reactor.position.z, 1.6) || any;
    for (const k of ['o2plant', 'oven', 'purifier', 'sabatier'])
      if (this.modules[k]) any = hit(this.modules[k].position.x, this.modules[k].position.z, 1.0) || any;
    return any;
  }

  /* ================================================================ update == */
  update(dt, ctx) {
    if (!this.running) return;
    const sunEl = ctx.sunElevation ?? 0;
    this._animate(dt, sunEl);
    this._updateRadio();
    if (this.ending) { this._updateEnding(dt); this._updateHUD(dt, ctx); return; }
    if (this.journalOpen || this.paused) { this._updateHUD(dt, ctx); return; }

    const dtSol = dt * RATE / SOL_SECONDS;
    this.solsSinceCrash += dtSol;
    this._sim(dtSol, { inside: this.inside, sunEl, exertion: this.player.exertion || 0, live: true });
    this._liveRefill(dt);
    this._zones();
    this._crateDelivery();
    this._jobs(dt);
    this._towing(dt);
    this._checkObjectives();
    this._stations();
    this._consequences(dt);
    this._updateHUD(dt, ctx);
  }

  /** The budget. Integrated live every frame and offline while resting. */
  _sim(dtSol, { inside, sunEl, exertion = 0, live = false }) {
    const r = this.res, b = this.built, f = this.flag, hrs = dtSol * 24;
    this.storm += ((f.storm ? 1 : 0) - this.storm) * Math.min(1, live ? dtSol * 24 * 0.5 : 1);

    // ---- power ----
    const sun = Math.max(0, Math.sin(sunEl * Math.PI / 180));
    const solar = b.solar ? SOLAR_W_M2 * PV_CLEAR * PV_AREA * PV_EFF * sun / 1000 * (f.dusty ? 0.4 : 1) * (1 - 0.82 * this.storm) : 0;
    const reactor = b.reactor ? 10 : 0;
    const gen = solar + reactor;
    let load = 0;
    if (b.hab) load += HAB_LOAD;
    if (b.greenhouse && f.greenOn !== false) load += GREEN_LOAD;
    const spare = gen - load;
    const o2want = b.o2plant && r.habO2 < HAB_O2_CAP;
    const o2run = o2want && (spare >= O2_LOAD * 0.8 || r.battery > BATTERY_CAP * 0.3);
    if (o2run) load += O2_LOAD;
    const isruWant = f.campaign && b.sabatier && b.fuelLine && !f.jam && r.propellant < 1;
    const isruRun = isruWant && (gen - load >= ISRU_LOAD * 0.8 || r.battery > BATTERY_CAP * 0.2);
    if (isruRun) load += ISRU_LOAD;
    r.battery = clamp(r.battery + (gen - load) * hrs, 0, BATTERY_CAP);
    const brownout = r.battery <= 0 && gen < load;
    if (brownout && this.storm > 0.3) f.stormBrownout = true;
    this.power = { gen, load, solar, brownout, o2run, isruRun };
    this.c.kwhSolar += solar * hrs; this.c.kwhReactor += reactor * hrs;

    // ---- oxygen ----
    if (o2run && !brownout) { r.habO2 = Math.min(HAB_O2_CAP, r.habO2 + O2_RATE * hrs); this.c.o2Made += O2_RATE * hrs; }
    if (isruRun && !brownout) { r.habO2 = Math.min(HAB_O2_CAP, r.habO2 + 0.02 * hrs); }
    if (inside && r.habO2 > 0) r.habO2 = Math.max(0, r.habO2 - O2_PER_SOL * dtSol);
    else r.suitO2 = Math.max(0, r.suitO2 - hrs * (1 + 0.6 * exertion));

    // ---- water and food ----
    const drink = WATER_PER_SOL * dtSol * (f.recycler ? 1 - RECYCLE : 1);
    r.water = Math.max(0, r.water - drink - (b.greenhouse ? 0.1 * dtSol : 0));
    if (isruRun && !brownout) r.water += 0.3 * dtSol;      // the crawler's ore feeds the hab loop too
    r.food = Math.max(0, r.food - dtSol);
    if (b.greenhouse && !brownout) {
      if (this.c.harvest < 1) {
        this.c.growth += dtSol / 2 * (f.greenOn === false ? 0.3 : 1);
        if (this.c.growth >= 1) {
          this.c.harvest = 1;
          this.say([['K-7', 'First harvest: lettuce and radishes. From here the greenhouse grows 40% of what you eat.']]);
        }
      } else r.food += GREEN_DIET * dtSol * (f.greenOn === false ? 0.3 : 1);
    }

    // ---- radiation ----
    r.dose += (inside ? this._habDoseRate() : DOSE_SURFACE) * dtSol;

    // ---- propellant ----
    if (isruRun && !brownout) r.propellant = Math.min(1, r.propellant + dtSol / PROPELLANT_SOLS);
    if (f.storm && !live) this.c.stormSols += dtSol;
  }

  _habDoseRate() {
    if (!this.built.hab) return DOSE_SURFACE;
    const s = clamp(this.c.shieldKg / this.SHIELD_KG, 0, 1);
    if (s < 0.25) return s > 0.02 ? 0.70 : 0.62;          // a thin cover makes neutrons: worse than none
    return 0.60 - (0.60 - 0.27) * (s - 0.25) / 0.75;     // ~1 m of regolith: ~100 mSv a year
  }

  _liveRefill(dt) {
    const r = this.res;
    if (this.inside && r.habO2 > 0.05 && r.suitO2 < SUIT_HOURS) {
      const add = Math.min(SUIT_HOURS - r.suitO2, dt * 2.5);
      r.suitO2 += add;
      r.habO2 = Math.max(0, r.habO2 - add * SUIT_KG_PER_HOUR);
    }
  }

  /** Rocks set down in the berm ring or the oven hopper. */
  _zones() {
    const B = this.anchors.base, O = this.anchors.oven;
    const list = this.props.props;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (p.kind !== 'rock' || p.held || !p.asleep) continue;
      const db = Math.hypot(p.position.x - B.x, p.position.z - B.z);
      if (this.flag.shieldOpen && this.built.hab && db < 8.5) {
        this.props.remove(p);
        this.c.shieldKg += p.mass; this.c.rockKg += p.mass;
        this._points(Math.round(p.mass * 0.6), `${p.mass.toFixed(0)} kg on the berm`);
        this.audio?.thud?.(0.5);
        if (this.c.shieldKg >= this.SHIELD_KG * 0.25 && !this._saidThin) {
          this._saidThin = true;
          this.say([['K-7', 'Careful — a thin layer is worse than nothing: cosmic rays shatter nuclei in it and make neutrons. Keep piling.']]);
        }
        if (this.c.rockKg >= 400) this.award('rock-hound');
        continue;
      }
      if (this.built.oven && this.flag.oreOpen && Math.hypot(p.position.x - O.x, p.position.z - O.z) < 2.4) {
        const g = p.grade || 0;
        const water = p.mass * g * RECOVERY;
        const need = g > 0 ? water * OVEN_KWH_PER_L : 0.15;
        if (this.res.battery < need) {
          if (!this._ovenWarnT || performance.now() > this._ovenWarnT) {
            this._ovenWarnT = performance.now() + 7000;
            this.say([['K-7', `The oven needs ${need.toFixed(1)} kWh for that load; the battery has ${this.res.battery.toFixed(1)}. Wait for sun, or rest.`]]);
          }
          continue;
        }
        this.props.remove(p);
        this.res.battery -= need;
        this.c.rockKg += p.mass;
        this.ovenHeat = 1;
        if (g > 0) {
          this.res.waterRaw += water; this.c.waterMade += water;
          this._points(Math.round(water * 40), `${water.toFixed(1)} L baked out`);
          if (this.c.waterMade >= 10) this.award('water-witch');
        } else {
          this.say([['K-7', 'That was basalt — olivine and pyroxene, no water in the crystals. Take rock from inside the blue ring.']]);
        }
        this.audio?.thud?.(0.6);
      }
    }
  }

  _crateDelivery() {
    for (const c of Object.values(this.crates)) {
      if (c.stored || this.delivered_[c.id]) continue;
      const p = c.prop;
      if (p.held) continue;
      const [zone, r] = this.crateZone[c.id];
      const z = this.anchors[zone];
      if (Math.hypot(p.position.x - z.x, p.position.z - z.z) > r) continue;
      if (!p.asleep) continue;
      this.delivered_[c.id] = true;
      this.props.remove(p, true);
      c.stored = true;
      this._fx.attach(p.mesh);
      this.audio?.beep?.('ok');
      this._points(80, `${CRATES[c.id].label} delivered`);
      this._save();
    }
  }

  _jobs(dt) {
    const j = this.job;
    if (!j) return;
    const p = this.pt(j.at);
    const d = Math.hypot(this.player.pos.x - p.x, this.player.pos.z - p.z);
    if (d < 9) j.t += dt;
    if (j.t >= j.dur) { this.job = null; j.onDone(); }
  }

  _towing(dt) {
    if (this.reactorState !== 'towing') return;
    const r = this.modules.reactor, dest = this.anchors.reactor, c = this.companion;
    let tx, tz;
    if (c && c.root.visible) {
      // the sled trails 3.5 m behind K-7
      const dx = r.position.x - c.pos.x, dz = r.position.z - c.pos.z, d = Math.hypot(dx, dz) || 1;
      tx = c.pos.x + dx / d * 3.5; tz = c.pos.z + dz / d * 3.5;
      if (d < 3.5) { tx = r.position.x; tz = r.position.z; }
      if (Math.hypot(c.pos.x - dest.x, c.pos.z - dest.z) < 3.5) { tx = dest.x; tz = dest.z; }
    } else { tx = dest.x; tz = dest.z; }
    const dx = tx - r.position.x, dz = tz - r.position.z, d = Math.hypot(dx, dz);
    const step = Math.min(d, dt * 2.6);
    if (d > 1e-3) {
      r.position.x += dx / d * step; r.position.z += dz / d * step;
      r.rotation.y = Math.atan2(dx, dz);
    }
    r.position.y = this.hf.heightAt(r.position.x, r.position.z);
    if (Math.hypot(r.position.x - dest.x, r.position.z - dest.z) < 0.3) {
      this.reactorState = 'site';
      r.position.copy(dest);
      this._save();
    }
  }

  _checkObjectives() {
    const mi = MISSIONS[this.m];
    if (!mi) return;
    const obj = mi.objectives[this.step];
    if (!obj || !obj.done(this)) return;
    this.step++;
    this._points(50, 'objective complete');
    this.audio?.beep?.('ok');
    if (this.step >= mi.objectives.length) { this._completeMission(); return; }
    const next = mi.objectives[this.step];
    next.enter?.(this);
    if (next.say) this.say(next.say);
    this._guide();
    this._renderMission();
    this._save();
  }

  _completeMission() {
    const mi = MISSIONS[this.m];
    mi.onComplete?.(this);
    this._points(mi.points, null);
    if (mi.id === 'air') this.award('first-breath');
    if (mi.id === 'salvage') this.award('pack-mule');
    this._banner('MISSION COMPLETE', mi.title, `+${mi.points} points · science unlocked: ${mi.fact.title}`, 5200);
    this._showFact(mi.fact);
    this._chime();
    if (mi.id === 'ascent') { this.done = true; this.m = MISSIONS.length; this._renderMission(); this._save(); return; }
    this.m++; this.step = 0;
    this._save();
    setTimeout(() => this._enterMission(true), 5600);
    this._renderMission();
  }

  /** Stations in reach: the nearest usable one becomes the E prompt. */
  _stations() {
    const list = [...this._globalStations(), ...(MISSIONS[this.m]?.stations || [])];
    let best = null, bd = Infinity;
    for (const s of list) {
      if (!s.when(this)) continue;
      const p = this.pt(s.at);
      const d = Math.hypot(this.player.pos.x - p.x, this.player.pos.z - p.z);
      if (d <= (s.r || 3.5) && d < bd) { bd = d; best = s; }
    }
    this._station = this.actions.state === 'carry' || this.actions.candidate ? null : best;
    this.prompt = this.job ? '' : best ? best.label(this) : '';
  }

  _globalStations() {
    const S = this;
    return [
      { id: 'bottle', at: 'bay', r: 3.5, when: () => S.bottleFills > 0 && S.res.suitO2 < SUIT_HOURS - 0.3,
        label: () => `Refill suit O₂ from the emergency bottle (${S.bottleFills} left)`,
        use: () => {
          S.bottleFills--; S.res.suitO2 = SUIT_HOURS; S.flag.firstRefill = true;
          S.audio?.exhaleSharp?.(); S.audio?.beep?.('ok');
          S.notice('Suit oxygen: 8 hours.', 2000);
          S._save();
        } },
      { id: 'restWreck', at: 'bay', r: 3.5, when: () => !S.built.hab && S.res.suitO2 >= SUIT_HOURS - 0.3,
        label: () => S._isNight() ? 'Rest in the cockpit until 07:00' : 'Rest in the cockpit for 3 hours',
        use: () => S.rest(S._isNight() ? 'dawn' : 3, false) },
      { id: 'rest', at: 'door', r: 4, when: () => S.built.hab, label: () => S._restLabel(), use: () => S._restAuto() },
    ];
  }

  _isNight() {
    const l = this.timeState.lmst;
    return l >= 18.3 || l < 6.2;
  }

  _waitObjective() {
    const o = MISSIONS[this.m]?.objectives[this.step];
    return o && o.wait && !o.done(this) ? o : null;
  }

  _restLabel() {
    if (this._campaignActive()) return 'Rest 50 sols — let the plant run';
    if (this.flag.storm) return 'Shelter for 1 sol';
    if (this._waitObjective()) return 'Rest until it is done (up to 3 sols)';
    if (this._isNight()) return 'Sleep until 07:00';
    return 'Rest 4 hours';
  }

  _campaignActive() {
    return this.flag.campaign && this.built.sabatier && this.built.fuelLine && this.res.propellant < 1;
  }

  _restAuto() {
    if (this._campaignActive()) return this.rest(50 * 24, true);
    if (this.flag.storm) return this.rest(24, true);
    if (this._waitObjective()) return this.rest(72, true);
    return this.rest(this._isNight() ? 'dawn' : 4, true);
  }

  /** Skip time, integrating the budget with the real sun for each quarter hour. */
  rest(hours, inHab) {
    if (this.paused) return;
    this.paused = true;
    this.actions.dropNow();
    this._fade(true, 'RESTING…');
    const before = { ...this.res };
    setTimeout(() => {
      const ts = this.timeState;
      const mi = MISSIONS[this.m], obj = mi?.objectives[this.step];
      const stepH = 0.25;
      let n = 0, slept = 0;
      const maxSteps = hours === 'dawn' ? 4 * 30 : Math.ceil(hours / stepH);
      const stormStart = this.c.stormSols;
      while (n++ < maxSteps) {
        ts.lmst += stepH;
        if (ts.lmst >= 24) { ts.lmst -= 24; ts.sol += 1; }
        const st = siteTime(utcForSolAndLmst(ts.sol, ts.lmst), JEZERO.lonEast, JEZERO.latNorth);
        const dtSol = stepH / 24;
        this.solsSinceCrash += dtSol;
        slept += stepH;
        this._sim(dtSol, { inside: inHab, sunEl: st.elevation });
        if (inHab) this.res.suitO2 = SUIT_HOURS;
        if (hours === 'dawn' && ts.lmst >= 7 && ts.lmst < 7.3) break;
        if (obj && obj.progress && obj.done(this)) break;        // wake when the job is done
        if (this.flag.storm && this.c.stormSols - stormStart >= 1) break;
      }
      if (!inHab) this.res.suitO2 = SUIT_HOURS;
      const d = this.res;
      const parts = [`+${slept >= 48 ? (slept / 24.66).toFixed(0) + ' sols' : slept.toFixed(1) + ' h'}`,
        `O₂ ${(d.habO2 - before.habO2 >= 0 ? '+' : '')}${(d.habO2 - before.habO2).toFixed(1)} kg`,
        `battery ${d.battery.toFixed(0)} kWh`, `dose +${(d.dose - before.dose).toFixed(1)} mSv`];
      if (d.propellant > before.propellant) parts.push(`propellant ${(d.propellant * 100).toFixed(0)}%`);
      this._fade(false);
      this.paused = false;
      this.notice('Rested · ' + parts.join(' · '), 6000);
      this._save();
    }, 650);
  }

  _consequences(dt) {
    const r = this.res;
    // suit empty outside: K-7 drags you back
    if (r.suitO2 <= 0 && !this.inside && !this.paused) this._blackout();
    if (r.water <= 0 || r.food <= 0) {
      this._starveT = (this._starveT || 0) + dt;
      if (this._starveT > 1) { this._starveT = 0; this.points = Math.max(0, this.points - 2); }
    }
    // warnings, once each time a line is crossed
    const warn = (key, cond, msg) => {
      if (cond && !this._warned[key]) { this._warned[key] = true; this.say([['K-7', msg]]); this.audio?.beep?.('err'); }
      if (!cond) this._warned[key] = false;
    };
    this._warned = this._warned || {};
    warn('suit', r.suitO2 < 1 && !this.inside, 'Commander, your suit is under one hour of oxygen. Get to the hab or the bottle.');
    warn('water', this.m > 1 && r.water < 1.5, 'Water is low. You need 2.5 litres a sol.');
    warn('food', this.m > 1 && r.food < 3, 'Food is down to a few sols.');
    warn('hab', this.built.hab && r.habO2 < 1.2, 'Habitat oxygen is low. Get the O₂ plant running and power to it.');
    warn('limit', r.dose >= DOSE_LIMIT, 'Your dose just passed NASA’s 600 mSv career limit.');
    if (this.c.shieldKg >= this.SHIELD_KG && !this.flag.shieldDone) this.flag.shieldDone = true;
  }

  _blackout() {
    this.blackouts++;
    this.paused = true;
    this.actions.dropNow();
    this._fade(true, 'HYPOXIA');
    this.audio?.exhaleSharp?.();
    setTimeout(() => {
      const to = this.built.hab ? this.anchors.door : this.anchors.bay;
      this.player.placeAt(to.x + this.fwd.x * 1.5, to.z + this.fwd.z * 1.5);
      this.res.suitO2 = SUIT_HOURS;
      this.timeState.lmst = (this.timeState.lmst + 2) % 24;
      this.solsSinceCrash += 2 / 24.66;
      this._points(-150, null);
      this._fade(false);
      this.paused = false;
      this.say([['K-7', 'You blacked out. I carried you back and hooked you to my reserve. Please don’t do that again.']]);
      this._save();
    }, 1400);
  }

  /* ============================================================== visuals == */
  _animate(dt, sunEl) {
    const t = performance.now() / 1000;
    for (const g of Object.values(this.modules)) {
      if (g.userData && g.userData.grow !== undefined && g.userData.grow < 1) {
        g.userData.grow = Math.min(1, g.userData.grow + dt * 1.4);
        const k = g.userData.grow, e = 1 - Math.pow(1 - k, 3);
        g.scale.set(e, Math.max(0.01, e * (1 + 0.08 * Math.sin(k * 9) * (1 - k))), e);
      }
    }
    const berm = this.modules.berm;
    if (berm) {
      const want = 0.001 + clamp(this.c.shieldKg / this.SHIELD_KG, 0, 1);
      berm.scale.y += (want - berm.scale.y) * Math.min(1, dt * 3);
    }
    const sol = this.modules.solar;
    if (sol) {
      // single-axis tracker: tilt toward the sun about the array's long axis
      const tilt = clamp((90 - Math.max(5, sunEl)) * Math.PI / 180, 0, 1.2);
      sol.userData.tracker.rotation.z = this.timeState.lmst < 12 ? tilt * 0.8 : -tilt * 0.8;
    }
    const o2 = this.modules.o2plant;
    if (o2) o2.userData.led.material.color.setHex(this.power.o2run ? (Math.sin(t * 4) > 0 ? 0x5cff9b : 0x2a7a4a) : 0x553322);
    const ov = this.modules.oven;
    if (ov) {
      this.ovenHeat = Math.max(0, (this.ovenHeat || 0) - dt * 0.12);
      ov.userData.heat.material.opacity = this.ovenHeat;
    }
    const rx = this.modules.reactor;
    if (rx && this.built.reactor) rx.userData.fins.scale.setScalar(Math.min(1, rx.userData.fins.scale.x + dt * 0.5));
    const cap = this.modules.capsule;
    if (cap) cap.userData.gauge.scale.y = Math.max(0.02, this.res.propellant);
    for (const ring of Object.values(this.zoneRings)) ring.material.opacity = 0.55 + 0.3 * Math.sin(t * 2.4);
    const id = MISSIONS[this.m]?.id;
    if (this.zoneRings.base) this.zoneRings.base.visible = id === 'salvage' || id === 'resupply';
    if (this.zoneRings.ore) this.zoneRings.ore.visible = id === 'water' || id === 'clean';
  }

  _placeCapsule() {
    const g = M.makeCapsule();
    g.position.copy(this.anchors.capsule);
    g.rotation.y = this.baseYaw;
    this._fx.add(g);
    this.modules.capsule = g;
  }

  _updateEnding(dt) {
    const e = this.ending;
    e.t += dt;
    const cap = this.modules.capsule;
    if (!cap) return;
    const body = cap.userData.body;
    if (e.t > 3) {
      e.v = Math.min(60, e.v + dt * (4 + e.t * 0.8));
      body.position.y += e.v * dt;
    }
    const base = this._tmp.copy(cap.position);
    base.y += body.position.y + 0.6;
    const n = e.t > 2.2 ? 26 : e.t > 1.2 ? 6 : 0;
    for (let i = 0; i < n * dt * 60 / 10; i++) {
      this.plume.spawn({ x: base.x + (Math.random() - 0.5) * 0.4, y: base.y, z: base.z + (Math.random() - 0.5) * 0.4,
        vx: (Math.random() - 0.5) * 2, vy: -14 - Math.random() * 8, vz: (Math.random() - 0.5) * 2,
        life: 0.5 + Math.random() * 0.3, size0: 1.4, size1: 0.4, c0: [4, 2.2, 0.8, 0.9], c1: [1.5, 0.4, 0.1, 0], fadeIn: 0.05, fadeOut: 0.4 });
      if (body.position.y < 25)
        this.smoke.spawn({ x: cap.position.x + (Math.random() - 0.5) * 3, y: cap.position.y + 0.5, z: cap.position.z + (Math.random() - 0.5) * 3,
          vx: (Math.random() - 0.5) * 7, vy: 0.6 + Math.random(), vz: (Math.random() - 0.5) * 7,
          life: 6 + Math.random() * 4, size0: 2, size1: 9, drag: 0.3, c0: [0.5, 0.36, 0.26, 0.55], c1: [0.6, 0.45, 0.32, 0], fadeIn: 0.05, fadeOut: 0.5 });
    }
    this.plume.update(dt, null);
    this.smoke.update(dt, null);
    if (e.t > 15 && !e.card) { e.card = true; this._endCard(); }
  }

  /* =================================================================== HUD == */
  _buildHUD() {
    const hud = document.getElementById('hud');
    const root = document.createElement('div');
    root.id = 'sv';
    root.innerHTML = `
      <div class="panel" id="svMission">
        <h3><span id="svAct">MISSION</span><span id="svScore"></span></h3>
        <div id="svTitle"></div><div id="svTag"></div>
        <ul id="svObjs"></ul>
        <div id="svHint"><b>E</b> use / pick up &nbsp; <b>J</b> journal &nbsp; <b>H</b> call K-7 &nbsp; <b>V</b> view &nbsp; <b>ESC</b> settings</div>
      </div>
      <div class="panel" id="svLife"><h3><span>LIFE SUPPORT</span><span id="svSol"></span></h3><div id="svRows"></div></div>
      <div id="svMarker"><div class="dia"></div><span></span></div>
      <div id="svBanner"><small></small><h2></h2><p></p></div>
      <div id="svComms"><b></b><span></span></div>
      <div id="svFact"><small>SCIENCE UNLOCKED</small><h4></h4><p></p><em></em></div>
      <div id="svToast"><small></small><p></p></div>
      <div id="svFloat"></div>
      <div id="svJob"><span></span><i><u></u></i></div>`;
    hud.appendChild(root);
    const fade = document.createElement('div');
    fade.id = 'svFade'; fade.innerHTML = '<div></div>';
    document.body.appendChild(fade);
    const journal = document.createElement('div');
    journal.id = 'svJournal';
    document.body.appendChild(journal);
    const end = document.createElement('div');
    end.id = 'svEnd';
    document.body.appendChild(end);
    const rows = [
      ['suit', 'SUIT O₂'], ['hab', 'HAB O₂'], ['power', 'POWER'], ['water', 'WATER'], ['food', 'FOOD'],
      ['dose', 'DOSE'], ['air', 'OUTSIDE'], ['prop', 'PROPELLANT'],
    ];
    el('svRows').innerHTML = rows.map(([k, n]) =>
      `<div class="svRow" id="svR_${k}"><span>${n}</span><b></b><i><u></u></i></div>`).join('');
    this.hud = { root, rows: Object.fromEntries(rows.map(([k]) => [k, el('svR_' + k)])) };
    addEventListener('keydown', e => {
      if (!this.journalOpen) return;
      if (e.code === 'KeyJ' || e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); this.toggleJournal(false); }
      if (e.code === 'KeyR') {
        e.preventDefault();
        if (this._confirmReset && performance.now() < this._confirmReset) this.resetStory();
        else { this._confirmReset = performance.now() + 3000; this._renderJournal('Press R again within 3 s to restart the story from sol 1.'); }
      }
    }, true);
    end.addEventListener('click', () => this._closeEnd());
  }

  _hideTop(v) { document.body.classList.toggle('svCine', v); }

  _setRow(k, text, frac, level = '') {
    const r = this.hud.rows[k];
    if (!r) return;
    const b = r.children[1], u = r.children[2].firstChild;
    if (b.textContent !== text) b.textContent = text;
    u.style.width = (clamp(frac, 0, 1) * 100).toFixed(1) + '%';
    r.className = 'svRow ' + level;
  }

  _updateHUD(dt, ctx) {
    // objective marker every frame
    this._marker(ctx.camera || this.camera);
    const j = this.job, jb = el('svJob');
    if (j) {
      jb.classList.add('show');
      jb.firstChild.textContent = `${j.label}… ${Math.round(j.t / j.dur * 100)}%` +
        (Math.hypot(this.player.pos.x - this.pt(j.at).x, this.player.pos.z - this.pt(j.at).z) >= 9 ? ' (move closer)' : '');
      jb.querySelector('u').style.width = (j.t / j.dur * 100) + '%';
    } else jb.classList.remove('show');

    this._hudT -= dt;
    if (this._hudT > 0) return;
    this._hudT = 0.2;
    const r = this.res, P = this.power;
    const lv = (v, w, c) => v <= c ? 'crit' : v <= w ? 'warn' : '';
    this._setRow('suit', this.inside && r.habO2 > 0 ? `${r.suitO2.toFixed(1)} h · hab air` : `${r.suitO2.toFixed(1)} h`,
      r.suitO2 / SUIT_HOURS, this.inside ? '' : lv(r.suitO2, 2, 1));
    this._setRow('hab', this.built.hab ? `${r.habO2.toFixed(2)} kg${P.o2run ? ' ▲' : ''}` : '—',
      r.habO2 / HAB_O2_CAP, this.built.hab ? lv(r.habO2, 2, 0.9) : 'off');
    this._setRow('power', this.built.solar || this.built.reactor
      ? `${r.battery.toFixed(0)} kWh · ${P.gen.toFixed(1)}/${P.load.toFixed(1)} kW` : '—',
      r.battery / BATTERY_CAP, this.built.solar ? (P.brownout ? 'crit' : r.battery < 6 ? 'warn' : '') : 'off');
    this._setRow('water', `${r.water.toFixed(1)} L${r.waterRaw > 0.05 ? ` · ${r.waterRaw.toFixed(1)} raw` : ''}`,
      r.water / 20, lv(r.water, 2, 0.5));
    this._setRow('food', `${r.food.toFixed(r.food < 10 ? 1 : 0)} sols`, r.food / 60, this.m > 1 ? lv(r.food, 4, 1) : '');
    this._setRow('dose', `${r.dose.toFixed(1)} / ${DOSE_LIMIT} mSv`, r.dose / DOSE_LIMIT, r.dose >= DOSE_LIMIT ? 'crit' : r.dose > 540 ? 'warn' : '');
    const T = this._airTemp();
    this._setRow('air', `${T.toFixed(0)} °C · ${this.storm > 0.2 ? 'DUST STORM' : '7 mbar CO₂'}`, (T + 90) / 80, this.storm > 0.2 ? 'warn' : '');
    this._setRow('prop', this.flag.campaign || r.propellant > 0 ? `${(r.propellant * 100).toFixed(1)} %` : '—',
      r.propellant, this.flag.campaign ? '' : 'off');
    el('svSol').textContent = `SOL ${this._crashSol()} · ${formatSolClock(this.timeState.lmst).slice(0, 5)}`;
    const rank = RANKS.filter(([p]) => this.points >= p).pop()[1];
    el('svScore').textContent = `★ ${this.points.toLocaleString()} · ${rank}`;
    this._renderObjectiveProgress();
  }

  _airTemp() {
    // Perseverance MEDA: about -55 C average, 50-60 C day-night swing
    const l = this.timeState.lmst;
    return -55 + 28 * Math.cos((l - 14.5) / 24 * Math.PI * 2) - 6 * this.storm;
  }

  _renderMission() {
    const mi = MISSIONS[this.m];
    if (!mi) {
      el('svAct').textContent = 'STORY COMPLETE';
      el('svTitle').textContent = 'JEZERO ENDURES';
      el('svTag').textContent = 'K-7 keeps the plant running. Explore freely; J for your journal.';
      el('svObjs').innerHTML = '';
      return;
    }
    el('svAct').textContent = `MISSION ${this.m + 1}/${MISSIONS.length} · ACT ${mi.act}`;
    el('svTitle').textContent = mi.title;
    el('svTag').textContent = mi.tagline;
    el('svObjs').innerHTML = mi.objectives.map((o, i) => {
      const t = typeof o.text === 'function' ? o.text(this) : o.text;
      const st = i < this.step ? 'done' : i === this.step ? 'now' : 'next';
      return `<li class="${st}" data-i="${i}"><span>${i < this.step ? '✓' : i === this.step ? '▸' : '·'}</span><em>${t}</em><b></b></li>`;
    }).join('');
  }

  _renderObjectiveProgress() {
    const mi = MISSIONS[this.m];
    const o = mi?.objectives[this.step];
    if (!o || !o.progress) return;
    const li = document.querySelector(`#svObjs li[data-i="${this.step}"] b`);
    if (!li) return;
    const [v, max, unit] = o.progress(this);
    li.textContent = `${Math.min(v, max).toFixed(max >= 50 || unit === '%' ? 0 : 1)}/${max} ${unit}`;
  }

  _marker(cam) {
    const mk = el('svMarker');
    const mi = MISSIONS[this.m];
    const o = mi?.objectives[this.step];
    if (!o || !o.at || this.ending || !cam) { mk.classList.remove('show'); this._beacon(null); return; }
    const p = this.pt(typeof o.at === 'function' ? o.at(this) : o.at);
    if (!p) { mk.classList.remove('show'); this._beacon(null); return; }
    this._beacon(p);
    const d = Math.hypot(this.player.pos.x - p.x, this.player.pos.z - p.z);
    const v = this._tmp.set(p.x, (p.y ?? this.hf.heightAt(p.x, p.z)) + 1.8, p.z).project(cam);
    let x = v.x, y = v.y;
    const behind = v.z > 1;
    if (behind) { x = -x; y = -y; }
    const edge = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.86;
    if (edge) {
      const k = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.86, 1e-3);
      x /= k; y /= k;
      if (behind && Math.abs(y) < 0.86) y = -0.86;
    }
    mk.classList.add('show');
    mk.classList.toggle('edge', edge);
    mk.style.left = ((x * 0.5 + 0.5) * innerWidth) + 'px';
    mk.style.top = ((-y * 0.5 + 0.5) * innerHeight) + 'px';
    mk.lastChild.textContent = d < 4 ? 'HERE' : `${d.toFixed(0)} m`;
    mk.firstChild.style.transform = edge ? `rotate(${Math.atan2(-y, x) * 180 / Math.PI + 45}deg)` : 'rotate(45deg)';
  }

  _beacon(p) {
    if (!this.beacon) {
      this.beacon = M.makeBeacon();
      this._fx.add(this.beacon);
    }
    const b = this.beacon;
    b.visible = !!p && !this.near(p, 3);
    if (!p) return;
    b.position.set(p.x, this.hf.heightAt(p.x, p.z), p.z);
    const t = performance.now() / 1000;
    b.userData.ring.scale.setScalar(1 + 0.25 * Math.sin(t * 3));
  }

  _banner(small, big, sub, ms = 4200) {
    const b = el('svBanner');
    b.children[0].textContent = small; b.children[1].textContent = big; b.children[2].textContent = sub || '';
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => b.classList.remove('show'), ms);
  }

  _showFact(f) {
    const c = el('svFact');
    c.children[1].textContent = f.title;
    c.children[2].textContent = f.body;
    c.children[3].textContent = 'Source: ' + f.src.map(s => s[0]).join(' · ');
    c.classList.add('show');
    clearTimeout(this._factT);
    this._factT = setTimeout(() => c.classList.remove('show'), 16000);
  }

  _toast(head, text) {
    const t = el('svToast');
    t.children[0].textContent = head; t.children[1].textContent = text;
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 4200);
    this._chime(true);
  }

  _float(text, bad) {
    const f = document.createElement('div');
    f.className = 'svPts' + (bad ? ' bad' : '');
    f.textContent = text;
    el('svFloat').appendChild(f);
    setTimeout(() => f.remove(), 2200);
  }

  _updateRadio() {
    // wall-clock, so a slow frame rate cannot stretch a line into minutes
    const box = el('svComms'), now = performance.now() / 1000;
    this._radioT -= now - (this._radioLast ?? now);
    this._radioLast = now;
    if (this._radioT > 0) return;
    const next = this.radio.shift();
    if (!next) { box.classList.remove('show'); return; }
    box.children[0].textContent = next.who === 'EARTH' ? 'HOUSTON' : next.who;
    box.className = next.who === 'EARTH' ? 'show earth' : 'show';
    box.children[1].textContent = next.text;
    this._radioT = Math.max(3.2, next.text.length * 0.055);
    this.audio?.beep?.(next.who === 'EARTH' ? 'mode' : 'ok');
  }

  _fade(on, text = '') {
    const f = el('svFade');
    f.firstChild.textContent = text;
    f.classList.toggle('on', on);
  }

  _chime(small) {
    const a = this.audio;
    if (!a || !a.ready || !a.enabled) return;
    const ctx = a.ctx, t = ctx.currentTime;
    const notes = small ? [784, 1175] : [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.11);
      g.gain.exponentialRampToValueAtTime(0.06, t + i * 0.11 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.11 + 0.6);
      o.connect(g).connect(a.master);
      o.start(t + i * 0.11); o.stop(t + i * 0.11 + 0.65);
    });
  }

  /* =============================================================== journal == */
  toggleJournal(open = !this.journalOpen) {
    if (!this.running) return;
    this.journalOpen = open;
    el('svJournal').classList.toggle('open', open);
    if (open) this._renderJournal();
    this.onJournal?.(open);
  }

  _renderJournal(note = '') {
    const done = MISSIONS.slice(0, Math.min(this.m, MISSIONS.length));
    const cur = MISSIONS[this.m];
    const r = this.res;
    const facts = done.map((mi, i) => `
      <div class="jf"><small>MISSION ${i + 1} · ${mi.title}</small><h4>${mi.fact.title}</h4><p>${mi.fact.body}</p>
      <p class="src">${mi.fact.src.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${n}</a>`).join(' · ')}</p></div>`).join('');
    const badges = Object.entries(BADGES).map(([k, [n, w]]) =>
      `<div class="jb ${this.badges.includes(k) ? 'got' : ''}"><b>${n}</b><span>${w}</span></div>`).join('');
    el('svJournal').innerHTML = `
      <div class="jp">
        <div class="jh"><h2>MISSION JOURNAL</h2><span>SOL ${this._crashSol()} AFTER IMPACT · ★ ${this.points.toLocaleString()}</span><button id="svJClose">CLOSE [J]</button></div>
        ${note ? `<div class="jnote">${note}</div>` : ''}
        <div class="jbody">
          <div class="jcol">
            <h3>${cur ? `NOW · MISSION ${this.m + 1}: ${cur.title}` : 'STORY COMPLETE'}</h3>
            ${cur ? `<p class="tag">${cur.tagline}</p><ul>${cur.objectives.map((o, i) =>
              `<li class="${i < this.step ? 'done' : i === this.step ? 'now' : ''}">${typeof o.text === 'function' ? o.text(this) : o.text}</li>`).join('')}</ul>` : ''}
            <h3>STATS</h3>
            <table>
              <tr><td>Oxygen made</td><td>${this.c.o2Made.toFixed(2)} kg</td></tr>
              <tr><td>Water baked from rock</td><td>${this.c.waterMade.toFixed(1)} L</td></tr>
              <tr><td>Rock moved by hand</td><td>${this.c.rockKg.toFixed(0)} kg</td></tr>
              <tr><td>Energy: solar / reactor</td><td>${this.c.kwhSolar.toFixed(0)} / ${this.c.kwhReactor.toFixed(0)} kWh</td></tr>
              <tr><td>Radiation dose</td><td>${r.dose.toFixed(1)} mSv (limit ${DOSE_LIMIT})</td></tr>
              <tr><td>Habitat dose rate</td><td>${this._habDoseRate().toFixed(2)} mSv/sol (surface ${DOSE_SURFACE})</td></tr>
              <tr><td>Blackouts</td><td>${this.blackouts}</td></tr>
            </table>
            <h3>BADGES</h3><div class="jbs">${badges}</div>
            <p class="jkeys">R twice: restart the story · J / ESC: close</p>
          </div>
          <div class="jcol facts"><h3>SCIENCE UNLOCKED (${done.length}/${MISSIONS.length})</h3>${facts || '<p class="tag">Complete missions to unlock the NASA science behind them.</p>'}</div>
        </div>
      </div>`;
    el('svJClose').onclick = () => this.toggleJournal(false);
  }

  resetStory() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    location.reload();
  }

  _endCard() {
    const r = this.res;
    if (!this.blackouts) this.award('no-blackout');
    if (r.dose < DOSE_LIMIT) this.award('under-limit');
    this.award('homeward');
    const rank = RANKS.filter(([p]) => this.points >= p).pop()[1];
    el('svEnd').innerHTML = `<div class="ec">
      <small>MARTIAN STORY · PART TWO</small><h1>ASCENT</h1>
      <p class="lead">Sol ${this._crashSol()} after impact. The pod clears the crater rim on Martian methane and oxygen.
      K-7 stays behind with the plant, the greenhouse and the reactor — a base for whoever comes next.</p>
      <div class="es">
        <div><b>${this._crashSol()}</b><span>sols survived</span></div>
        <div><b>${r.dose.toFixed(0)}</b><span>mSv dose (limit 600)</span></div>
        <div><b>${this.c.waterMade.toFixed(1)} L</b><span>water from rock</span></div>
        <div><b>${this.c.o2Made.toFixed(1)} kg</b><span>oxygen made</span></div>
        <div><b>${this.points.toLocaleString()}</b><span>${rank}</span></div>
      </div>
      <p class="badges">${this.badges.map(b => BADGES[b][0]).join(' · ')}</p>
      <p class="hint">Click to keep exploring Jezero</p></div>`;
    el('svEnd').classList.add('open');
    this.onJournal?.(true);
  }

  _closeEnd() {
    el('svEnd').classList.remove('open');
    this.ending = null;
    this._hideTop(false);
    const cap = this.modules.capsule;
    if (cap) { cap.visible = false; this.modules.capsule = null; }
    for (const p of [this.plume, this.smoke]) if (p) { this.scene.remove(p.mesh); }
    this.onJournal?.(false);
    this._renderMission();
    this._save();
  }
}
