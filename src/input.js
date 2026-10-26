/**
 * Input manager.
 *
 * Built around one rule: the game must stay playable even when pointer lock is
 * unavailable. Lock is refused in a surprising number of real situations -
 * cross-origin iframes, some embedded webviews, a user who dismissed the
 * permission, Safari in certain modes - and the previous code silently
 * swallowed that failure, which left the mouse dead with no explanation.
 *
 * So there are two look modes:
 *   captured  - pointer lock held; movementX/Y, unlimited travel
 *   drag      - hold left button on the canvas and drag; works everywhere
 *
 * Keys are bound through an action map rather than read as raw codes, so they
 * can be rebound, and every action supports two bindings (e.g. WASD + arrows).
 * Gamepads are polled through the standard mapping when present.
 */

export const ACTION_DEFS = {
  forward:   { label: 'Move Forward',  def: ['KeyW', 'ArrowUp'] },
  back:      { label: 'Move Backward', def: ['KeyS', 'ArrowDown'] },
  left:      { label: 'Strafe Left',   def: ['KeyA', 'ArrowLeft'] },
  right:     { label: 'Strafe Right',  def: ['KeyD', 'ArrowRight'] },
  sprint:    { label: 'Sprint',        def: ['ShiftLeft', 'ShiftRight'] },
  jump:      { label: 'Jump',          def: ['Space', ''] },
  ascend:    { label: 'Survey: Up',    def: ['Space', ''] },
  descend:   { label: 'Survey: Down',  def: ['KeyC', 'ControlLeft'] },
  toggleView:{ label: 'First / Third Person', def: ['KeyV', ''] },
  surveyMode:{ label: 'Survey Mode',   def: ['KeyF', ''] },
  respawn:   { label: 'Return to Landing Site', def: ['KeyR', ''] },
  roverTrack:{ label: 'Toggle Rover Track', def: ['KeyT', ''] },
  gapOverlay:{ label: 'Toggle Gap Overlay', def: ['KeyM', ''] },
  headBob:   { label: 'Toggle Head Bob', def: ['KeyB', ''] },
  mute:      { label: 'Mute',          def: ['KeyN', ''] },
  timeBack:  { label: 'Time of Sol -', def: ['Comma', ''] },
  timeFwd:   { label: 'Time of Sol +', def: ['Period', ''] },
  sensDown:  { label: 'Sensitivity -', def: ['BracketLeft', ''] },
  sensUp:    { label: 'Sensitivity +', def: ['BracketRight', ''] },
  cycleRT:   { label: 'Cycle Ray Tracing', def: ['KeyG', ''] },
  companion: { label: 'Signal Support Unit', def: ['KeyH', ''] },
  punch:     { label: 'Punch / Throw Held', def: ['KeyQ', 'Mouse0'] },
  defend:    { label: 'Defend (hold)', def: ['KeyX', 'Mouse2'] },
  grab:      { label: 'Use / Grab / Drop', def: ['KeyE', ''] },
  journal:   { label: 'Mission Journal', def: ['KeyJ', ''] },
  openMenu:  { label: 'Open Settings',  def: ['Escape', ''] },
};

const EDGE_ACTIONS = ['toggleView', 'surveyMode', 'respawn', 'roverTrack',
                      'gapOverlay', 'headBob', 'mute', 'timeBack', 'timeFwd',
                      'sensDown', 'sensUp', 'cycleRT', 'companion', 'punch', 'grab', 'journal'];

/* Standard-mapping gamepad buttons for the character actions:
   X / Square punches, Y / Triangle grabs, LB blocks while held. */
const PAD_EDGE = { punch: 2, grab: 3 };
const PAD_HOLD = { defend: 4 };

export class Input {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.bindings = {};
    for (const [a, d] of Object.entries(ACTION_DEFS)) this.bindings[a] = d.def.slice();

    this.down = Object.create(null);        // raw code -> bool
    this.pressedEdge = new Set();           // actions pressed this frame
    this.lookX = 0; this.lookY = 0;         // accumulated, consumed per frame
    this.mode = 'none';                     // 'locked' | 'drag' | 'none'
    this.lockSupported = 'requestPointerLock' in Element.prototype;
    this.lockFailed = false;
    this.dragging = false;
    this.gamepadIndex = null;
    this.gamepadLookScale = 2.6;
    this.onModeChange = opts.onModeChange || (() => {});
    this.onNotice = opts.onNotice || (() => {});
    this.enabled = true;                    // false while a menu is open
    this._canvasBound = false;

    this._installGlobal();
    if (canvas) this.attach(canvas);
  }

  /** Canvas-level listeners are attached separately: the renderer's canvas
   *  does not exist yet when the manager is constructed. */
  attach(canvas) {
    if (!canvas || this._canvasBound) return;
    this.canvas = canvas;
    this._installCanvas();
    this._canvasBound = true;
  }

  // ------------------------------------------------------------- bindings
  codesFor(action) { return this.bindings[action] || []; }
  setBinding(action, slot, code) {
    if (!this.bindings[action]) return;
    this.bindings[action][slot] = code || '';
  }
  resetBindings() {
    for (const [a, d] of Object.entries(ACTION_DEFS)) this.bindings[a] = d.def.slice();
  }
  serialize() { return JSON.parse(JSON.stringify(this.bindings)); }
  deserialize(obj) {
    if (!obj) return;
    for (const a of Object.keys(this.bindings))
      if (Array.isArray(obj[a])) this.bindings[a] = obj[a].slice(0, 2);
  }

  isDown(action) {
    if (!this.enabled) return false;
    for (const c of this.bindings[action] || []) if (c && this.down[c]) return true;
    const pb = PAD_HOLD[action] ?? PAD_EDGE[action];
    if (pb !== undefined) {
      const gp = this._gamepad();
      if (gp && gp.buttons[pb] && gp.buttons[pb].pressed) return true;
    }
    return false;
  }

  /** Gamepad buttons have no events; turn presses into edges once per frame. */
  pollPad() {
    const gp = this._gamepad();
    this._padPrev = this._padPrev || {};
    for (const [action, i] of Object.entries(PAD_EDGE)) {
      const now = !!(gp && this.enabled && gp.buttons[i] && gp.buttons[i].pressed);
      if (now && !this._padPrev[action]) this.pressedEdge.add(action);
      this._padPrev[action] = now;
    }
  }
  /** True once per press. */
  consume(action) {
    if (this.pressedEdge.has(action)) { this.pressedEdge.delete(action); return true; }
    return false;
  }

  /** Movement/look snapshot the player controller consumes. */
  state() {
    const gp = this._gamepad();
    const s = {
      forward: this.isDown('forward'), back: this.isDown('back'),
      left: this.isDown('left'), right: this.isDown('right'),
      sprint: this.isDown('sprint'), jump: this.isDown('jump'),
      ascend: this.isDown('ascend'), descend: this.isDown('descend'),
      axisX: 0, axisY: 0,
    };
    if (gp) {
      if (Math.abs(gp.axes[0]) > 0.15) s.axisX = gp.axes[0];
      if (Math.abs(gp.axes[1]) > 0.15) s.axisY = -gp.axes[1];
      if (gp.buttons[0] && gp.buttons[0].pressed) s.jump = true;
      if ((gp.buttons[10] && gp.buttons[10].pressed) ||
          (gp.buttons[6] && gp.buttons[6].value > 0.4)) s.sprint = true;
    }
    // keyboard contributes to the same axes so both can be used together
    if (s.forward) s.axisY = 1; else if (s.back) s.axisY = -1;
    if (s.right) s.axisX = 1; else if (s.left) s.axisX = -1;
    return s;
  }

  /** Accumulated look delta in mouse counts; zeroed on read. */
  consumeLook() {
    const gp = this._gamepad();
    if (gp) {
      const rx = Math.abs(gp.axes[2]) > 0.16 ? gp.axes[2] : 0;
      const ry = Math.abs(gp.axes[3]) > 0.16 ? gp.axes[3] : 0;
      // squared response gives fine aim near centre, fast flicks at the edge
      this.lookX += Math.sign(rx) * rx * rx * 34 * this.gamepadLookScale;
      this.lookY += Math.sign(ry) * ry * ry * 34 * this.gamepadLookScale;
    }
    const d = { x: this.lookX, y: this.lookY };
    this.lookX = 0; this.lookY = 0;
    return d;
  }

  _gamepad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const p of pads) if (p && p.connected && p.axes.length >= 4) return p;
    return null;
  }

  // ---------------------------------------------------------------- lock
  /**
   * MUST be called directly inside a user gesture. Any await before this and
   * the browser will refuse - which is exactly how the previous version broke.
   */
  requestCapture() {
    if (!this.canvas) return false;
    if (!this.lockSupported) { this._setMode('drag'); return false; }
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => this._lockDenied());
      return true;
    } catch (e) {
      this._lockDenied();
      return false;
    }
  }
  releaseCapture() { if (document.pointerLockElement) document.exitPointerLock(); }

  _lockDenied() {
    this.lockFailed = true;
    this._setMode('drag');
    this.onNotice('Pointer lock unavailable — drag with the left mouse button to look.');
  }
  _setMode(m) { if (this.mode !== m) { this.mode = m; this.onModeChange(m); } }

  _press(code) {
    this.down[code] = true;
    for (const a of EDGE_ACTIONS)
      if ((this.bindings[a] || []).includes(code)) this.pressedEdge.add(a);
  }

  clearKeys() { for (const k in this.down) this.down[k] = false; this.pressedEdge.clear(); }

  // ------------------------------------------------------------- wiring
  _installGlobal() {
    addEventListener('keydown', e => {
      if (!this.enabled) return;
      // never swallow browser chrome shortcuts
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code))
        e.preventDefault();
      if (e.repeat) return;
      this._press(e.code);
    });
    addEventListener('keyup', e => { this.down[e.code] = false; });

    // Any path that loses focus must drop every key, or movement sticks on.
    addEventListener('blur', () => this.clearKeys());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clearKeys(); });
    addEventListener('contextmenu', e => { if (this.mode !== 'none') e.preventDefault(); });

    document.addEventListener('pointerlockchange', () => {
      if (this.canvas && document.pointerLockElement === this.canvas) {
        this.lockFailed = false; this._setMode('locked');
      } else {
        this.clearKeys(); this._setMode(this.lockFailed ? 'drag' : 'none');
      }
    });
    document.addEventListener('pointerlockerror', () => this._lockDenied());

    addEventListener('mousemove', e => {
      if (!this.enabled) return;
      if (this.canvas && document.pointerLockElement === this.canvas) {
        this.lookX += e.movementX; this.lookY += e.movementY;
      } else if (this.dragging) {
        this.lookX += e.movementX || 0; this.lookY += e.movementY || 0;
      }
    });

    addEventListener('mouseup', e => {
      this.down['Mouse' + e.button] = false;
      if (this.dragging) {
        this.dragging = false;
        if (this.canvas) this.canvas.style.cursor = '';
      }
    });

    addEventListener('gamepadconnected', e => {
      this.onNotice(`Gamepad connected: ${e.gamepad.id.slice(0, 40)}`);
    });
  }

  _installCanvas() {
    const canvas = this.canvas;
    // Drag-to-look fallback. Also how you look around before ever locking,
    // and the only way to look at all if pointer lock is refused.
    canvas.addEventListener('mousedown', e => {
      if (!this.enabled) return;
      // Mouse buttons bind like keys ('Mouse0' left, 'Mouse2' right) - but only
      // while the pointer is captured. In drag mode the left button is the look.
      if (document.pointerLockElement === canvas) { this._press('Mouse' + e.button); return; }
      if (e.button !== 0) return;
      this.dragging = true;
      canvas.style.cursor = 'grabbing';
      if (this.mode === 'none' && !this.lockFailed) this._setMode('drag');
    });
  }
}
