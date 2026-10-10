import { SCHEMA, QUALITY_PRESETS } from './settings.js';
import { ACTION_DEFS } from './input.js';

/** Turn a KeyboardEvent.code into something a human recognises. */
export function keyName(code) {
  if (!code) return '—';
  const m = {
    Space: 'SPACE', ArrowUp: '\u2191', ArrowDown: '\u2193',
    ArrowLeft: '\u2190', ArrowRight: '\u2192',
    ShiftLeft: 'L SHIFT', ShiftRight: 'R SHIFT',
    ControlLeft: 'L CTRL', ControlRight: 'R CTRL',
    AltLeft: 'L ALT', AltRight: 'R ALT',
    BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.',
    Slash: '/', Semicolon: ';', Quote: "'", Backquote: '`',
    Minus: '-', Equal: '=', Tab: 'TAB', Enter: 'ENTER', Backspace: 'BKSP',
    Mouse0: 'MOUSE L', Mouse1: 'MOUSE M', Mouse2: 'MOUSE R',
  };
  if (m[code]) return m[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6);
  return code.toUpperCase();
}

/** Builds the settings menu from the schema. No control is hand-written. */
export function buildSettingsUI(settings, host, onClose, input) {
  host.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'set-panel';
  host.appendChild(panel);

  // ---- header ----
  const head = document.createElement('div');
  head.className = 'set-head';
  head.innerHTML = `<h2>SETTINGS</h2>`;
  const presets = document.createElement('div');
  presets.className = 'set-presets';
  presets.innerHTML = `<span>QUALITY</span>`;
  for (const name of Object.keys(QUALITY_PRESETS)) {
    const b = document.createElement('button');
    b.textContent = name.toUpperCase();
    b.onclick = () => { settings.applyPreset(name); refreshAll(); };
    presets.appendChild(b);
  }
  const reset = document.createElement('button');
  reset.textContent = 'DEFAULTS';
  reset.className = 'set-reset';
  reset.onclick = () => { settings.resetDefaults(); refreshAll(); };
  presets.appendChild(reset);
  head.appendChild(presets);
  const close = document.createElement('button');
  close.className = 'set-close';
  close.textContent = '✕';
  close.onclick = onClose;
  head.appendChild(close);
  panel.appendChild(head);

  // ---- body: tabs + pages ----
  const body = document.createElement('div');
  body.className = 'set-body';
  panel.appendChild(body);

  const tabs = document.createElement('div');
  tabs.className = 'set-tabs';
  body.appendChild(tabs);

  const pages = document.createElement('div');
  pages.className = 'set-pages';
  body.appendChild(pages);

  const refreshers = [];
  const groups = Object.keys(SCHEMA);
  const pageEls = {};

  groups.forEach((group, gi) => {
    const tab = document.createElement('button');
    tab.textContent = group.toUpperCase();
    tab.onclick = () => selectTab(group);
    tab.dataset.group = group;
    tabs.appendChild(tab);

    const page = document.createElement('div');
    page.className = 'set-page';
    pageEls[group] = page;
    pages.appendChild(page);

    for (const [key, d] of Object.entries(SCHEMA[group])) {
      const row = document.createElement('div');
      row.className = 'set-row';

      const label = document.createElement('div');
      label.className = 'set-label';
      label.innerHTML = `<span>${d.label}</span>` +
        (d.hint ? `<em>${d.hint}</em>` : '');
      row.appendChild(label);

      const ctrl = document.createElement('div');
      ctrl.className = 'set-ctrl';
      row.appendChild(ctrl);

      if (d.type === 'toggle') {
        const b = document.createElement('button');
        b.className = 'set-toggle';
        const paint = () => {
          const on = !!settings.get(key);
          b.textContent = on ? 'ON' : 'OFF';
          b.classList.toggle('on', on);
        };
        b.onclick = () => { settings.set(key, !settings.get(key)); paint(); };
        ctrl.appendChild(b);
        refreshers.push(paint);

      } else if (d.type === 'select') {
        const wrap = document.createElement('div');
        wrap.className = 'set-seg';
        const btns = d.options.map(opt => {
          const b = document.createElement('button');
          b.textContent = opt;
          b.onclick = () => { settings.set(key, opt); paint(); };
          wrap.appendChild(b);
          return [opt, b];
        });
        const paint = () => {
          const cur = settings.get(key);
          for (const [opt, b] of btns) b.classList.toggle('on', opt === cur);
        };
        ctrl.appendChild(wrap);
        refreshers.push(paint);

      } else {                                  // slider
        const s = document.createElement('input');
        s.type = 'range';
        s.min = d.min; s.max = d.max; s.step = d.step;
        const out = document.createElement('span');
        out.className = 'set-val';
        const fmt = v => {
          const n = Number(v);
          if (d.step >= 1) return String(Math.round(n));
          if (d.step >= 0.01) return n.toFixed(2);
          if (d.step >= 0.001) return n.toFixed(3);
          return n.toExponential(1);
        };
        s.oninput = () => { settings.set(key, Number(s.value)); out.textContent = fmt(s.value); };
        const paint = () => { s.value = settings.get(key); out.textContent = fmt(s.value); };
        ctrl.appendChild(s); ctrl.appendChild(out);
        refreshers.push(paint);
      }
      page.appendChild(row);
    }
  });

  // ---------------- Controls: rebinding, appended after the schema tabs ----
  if (input) {
    const group = 'Controls';
    const tab = document.createElement('button');
    tab.textContent = 'CONTROLS';
    tab.dataset.group = group;
    tab.onclick = () => selectTab(group);
    tabs.appendChild(tab);

    const page = document.createElement('div');
    page.className = 'set-page';
    pageEls[group] = page;
    pages.appendChild(page);

    const note = document.createElement('div');
    note.className = 'set-note';
    note.innerHTML =
      'Click a slot then press a key. Every action takes two bindings, so WASD and the ' +
      'arrow keys can both work. A connected gamepad is picked up automatically: ' +
      'left stick moves, right stick looks, <b>A</b> jumps, <b>L3</b> or the left trigger sprints, ' +
      '<b>X</b> punches, <b>Y</b> grabs, <b>LB</b> blocks. Mouse buttons act only while the pointer is captured.';
    page.appendChild(note);

    let capturing = null;
    const slotBtns = [];

    for (const [action, d] of Object.entries(ACTION_DEFS)) {
      const row = document.createElement('div');
      row.className = 'set-row';
      const label = document.createElement('div');
      label.className = 'set-label';
      label.innerHTML = `<span>${d.label}</span>`;
      row.appendChild(label);
      const ctrl = document.createElement('div');
      ctrl.className = 'set-ctrl';
      for (let slot = 0; slot < 2; slot++) {
        const b = document.createElement('button');
        b.className = 'set-key';
        b.onclick = () => {
          if (capturing) capturing.btn.classList.remove('capturing');
          capturing = { action, slot, btn: b };
          b.textContent = 'PRESS KEY';
          b.classList.add('capturing');
        };
        ctrl.appendChild(b);
        slotBtns.push({ action, slot, btn: b });
      }
      row.appendChild(ctrl);
      page.appendChild(row);
    }

    const resetRow = document.createElement('div');
    resetRow.className = 'set-row';
    const rb = document.createElement('button');
    rb.className = 'set-toggle';
    rb.style.width = 'auto';
    rb.style.padding = '7px 14px';
    rb.textContent = 'RESET BINDINGS';
    rb.onclick = () => {
      input.resetBindings();
      settings.set('keybinds', input.serialize());
      paintKeys();
    };
    resetRow.innerHTML = '<div class="set-label"><span>Restore Defaults</span></div>';
    const rc = document.createElement('div');
    rc.className = 'set-ctrl';
    rc.appendChild(rb);
    resetRow.appendChild(rc);
    page.appendChild(resetRow);

    function paintKeys() {
      for (const { action, slot, btn } of slotBtns) {
        btn.textContent = keyName(input.codesFor(action)[slot]);
        btn.classList.remove('capturing');
      }
    }
    refreshers.push(paintKeys);

    // Capture phase, so a rebind never also triggers a game action.
    addEventListener('keydown', e => {
      if (!capturing) return;
      e.preventDefault(); e.stopPropagation();
      const code = e.code === 'Escape' ? '' : e.code;   // Escape clears a slot
      input.setBinding(capturing.action, capturing.slot, code);
      settings.set('keybinds', input.serialize());
      capturing = null;
      paintKeys();
    }, true);
  }

  function selectTab(group) {
    for (const t of tabs.children) t.classList.toggle('on', t.dataset.group === group);
    for (const [g, p] of Object.entries(pageEls)) p.classList.toggle('on', g === group);
  }
  function refreshAll() { for (const f of refreshers) f(); }

  selectTab(groups[0]);
  refreshAll();

  const foot = document.createElement('div');
  foot.className = 'set-foot';
  foot.innerHTML =
    `<span id="setStatus"></span><span>ESC to close &nbsp;·&nbsp; settings persist in this browser</span>`;
  panel.appendChild(foot);

  return { refreshAll };
}
