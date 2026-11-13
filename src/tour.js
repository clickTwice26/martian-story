/**
 * Automatic tour for recording the Space Apps video: open the game with
 * ?tour, click BEGIN. It plays the narration (video/narration.mp3), shows the
 * Space Apps cards (video/ov, made by video/make_overlays.py) and flies the
 * camera, all on one clock: the start of each narration paragraph
 * (video/ov/timeline.json "cues", from video/build_cues.py). Every shot and
 * every card changes with the sentence being spoken. Press ESC to abort.
 */
export async function runTour(m) {
  const wait = s => new Promise(r => setTimeout(r, s * 1000));
  const P = m.player;
  const Y = Math.PI;
  const ease = t => t * t * (3 - 2 * t);
  let alive = true;
  addEventListener('keydown', e => { if (e.code === 'Escape' && !window.__tourPanel) alive = false; });

  // ---- skip the opening film and the story's wake-up --------------------------
  for (let i = 0; i < 40; i++) { if (m.intro?.active) { m.intro.skip(); break; } await wait(0.25); }
  for (let i = 0; i < 80; i++) {
    if (m.survival?.wake) m.survival.wake.skip = true;
    else if (i > 8 && !m.intro?.active) break;
    await wait(0.25);
  }
  await wait(1.5);
  m.timeState.lmst = 14.5;                         // mid-afternoon light for every shot
  setInterval(() => { if (m.timeState.lmst < 13 || m.timeState.lmst > 16.5) m.timeState.lmst = 14.5; }, 1000);

  // ---- a clean frame: only the minimap, life support and weather panels stay -
  // Everything else the game shows (mission card, radio, clock, prompts, the
  // objective marker) would collide with the captions or tell a different story.
  const st = document.createElement('style');
  st.textContent = ['#notice', '#inputMode', '#srcNote', '#keysPanel', '#perfPanel', '#crosshair', '#marsPanel',
    '#solPanel', '#svMission', '#svComms', '#svFact', '#svToast', '#svBanner', '#svFloat', '#svJob', '#svMarker',
    '#companionSay', '#actionPrompt', '#startOverlay', '#settings'].join(',') + '{display:none!important}' +
    '#roverDataModal{align-items:flex-end!important;padding-bottom:3vh}' +
    '#envPanel{bottom:auto!important;top:330px!important}' +
    "@font-face{font-family:'Fira Sans Tour';src:url(video/fonts/FiraSans-ExtraBold.ttf);font-weight:800}" +
    "@font-face{font-family:'Fira Sans Tour';src:url(video/fonts/FiraSans-Bold.ttf);font-weight:700}" +
    '#roverDataModal .p-panel{height:min(730px,80vh)!important}';
  document.head.appendChild(st);
  document.getElementById('startOverlay')?.classList.add('hidden');
  const hudEl = document.getElementById('hud');
  const hud = v => { hudEl.style.opacity = v ? '1' : '0'; };
  hud(false);

  // ---- cards, cues, narration ---------------------------------------------------
  let TL = { cards: [], cues: [], end: 240, shots: {} };
  try { TL = await (await fetch('video/ov/timeline.json', { cache: 'no-store' })).json(); } catch (e) { console.warn('[tour] no timeline', e); }
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);' +
    'width:min(100vw,calc(100vh*16/9));aspect-ratio:16/9;pointer-events:none;z-index:9000';
  document.body.appendChild(box);
  const v = Date.now();
  const imgs = TL.cards.map(c => {
    const im = new Image();
    im.src = 'video/ov/' + c.png + '?v=' + v;
    const full = c.png === 'team_card.png' || c.png === 'credits.png';   // opaque cards fill any screen
    im.style.cssText = (full ? 'position:fixed;inset:0;width:100vw;height:100vh;object-fit:cover;z-index:9001;'
                             : 'position:absolute;inset:0;width:100%;height:100%;') +
      'opacity:0;transition:opacity .45s ease;pointer-events:none';
    (full ? document.body : box).appendChild(im);
    return im;
  });
  await Promise.all(imgs.map(i => i.decode().catch(() => {})));

  let voice = null;
  try {
    const r = await fetch('video/narration.mp3', { method: 'HEAD', cache: 'no-store' });
    if (r.ok) { voice = new Audio('video/narration.mp3?v=' + v); voice.preload = 'auto'; voice.load(); }
  } catch (e) { voice = null; }
  const soundWas = m.settings.get('enabled');
  m.settings.set('enabled', false);                // game sounds off; the narration carries the video
  const clock = () => voice && voice.currentTime > 0 ? voice.currentTime : (performance.now() - window.__tourT0) / 1000;
  window.__tourClock = clock;
  (function show() {
    if (window.__tourT0) {
      const t = clock();
      TL.cards.forEach((c, i) => {
        const on = t >= c.t0 && t < c.t1;
        if ((imgs[i].style.opacity === '1') !== on) imgs[i].style.opacity = on ? '1' : '0';
      });
    }
    requestAnimationFrame(show);
  })();
  // ---- the 4:00 clock, bottom-right, in the Space Apps style (above every card)
  const timer = document.createElement('div');
  timer.innerHTML = '<b style="font:700 1.05vmin Fira Sans Tour,sans-serif;letter-spacing:.14em;color:#EAFE07">' +
    'VIDEO TIME</b><div style="display:flex;align-items:baseline;gap:.6vmin;margin-top:.3vmin">' +
    '<span id="tourT" style="font:800 3.6vmin Fira Sans Tour,sans-serif;color:#fff">0:00</span>' +
    '<span style="font:700 1.8vmin Fira Sans Tour,sans-serif;color:#bad6ff">/ 4:00</span></div>' +
    '<i style="display:block;height:.6vmin;margin-top:.8vmin;border-radius:.3vmin;background:rgba(255,255,255,.18);overflow:hidden">' +
    '<u id="tourBar" style="display:block;height:100%;width:0;background:#EAFE07"></u></i>';
  timer.style.cssText = 'position:fixed;right:2.2vmin;bottom:2.2vmin;z-index:9500;pointer-events:none;' +
    'background:rgba(28,36,112,.93);border-left:.7vmin solid #EAFE07;border-radius:1.2vmin;' +
    'padding:1.2vmin 2vmin 1.4vmin 1.8vmin;min-width:19vmin;box-shadow:0 .8vmin 2.4vmin rgba(0,0,0,.45)';
  document.body.appendChild(timer);
  const tT = timer.querySelector('#tourT'), tBar = timer.querySelector('#tourBar');
  (function tick() {
    if (window.__tourT0) {
      const t = Math.min(240, Math.max(0, clock()));
      const txt = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      if (tT.textContent !== txt) tT.textContent = txt;
      tBar.style.width = (t / 240 * 100).toFixed(2) + '%';
    }
    requestAnimationFrame(tick);
  })();

  const until = async t => { while (alive && clock() < t) await wait(0.03); };
  const C = [...TL.cues, TL.end];
  const span = i => Math.max(1, C[i + 1] - C[i]);

  // ---- camera moves -------------------------------------------------------------
  /** Fly from a to b: [x, height above ground, z, yaw, pitch] over `dur` s. */
  function fly(a, b, dur) {
    return new Promise(res => {
      const t0 = performance.now();
      P.mode = 'fly';
      (function step() {
        if (!alive) return res();
        const t = Math.min(1, (performance.now() - t0) / 1000 / dur), k = ease(t);
        const L = i => a[i] + (b[i] - a[i]) * k;
        const x = L(0), z = L(2);
        P.pos.set(x, m.hf.heightAt(x, z) + L(1), z);
        P.vel.set(0, 0, 0);
        P.aimYaw = P.yaw = L(3);
        P.aimPitch = P.pitch = L(4);
        if (t < 1) requestAnimationFrame(step); else res();
      })();
    });
  }
  /** Circle (cx, cz) at radius r, height h, facing the centre. */
  function orbit(cx, cz, r, h, a0, a1, dur, pitch) {
    return new Promise(res => {
      const t0 = performance.now();
      P.mode = 'fly';
      (function step() {
        if (!alive) return res();
        const t = Math.min(1, (performance.now() - t0) / 1000 / dur), ang = a0 + (a1 - a0) * ease(t);
        const x = cx + Math.cos(ang) * r, z = cz + Math.sin(ang) * r;
        P.pos.set(x, m.hf.heightAt(x, z) + h, z);
        P.vel.set(0, 0, 0);
        P.aimYaw = P.yaw = Math.atan2(cx - x, cz - z);
        P.aimPitch = P.pitch = pitch;
        if (t < 1) requestAnimationFrame(step); else res();
      })();
    });
  }
  /** Walk (or run) in third person, turning from yaw0 to yaw1, for `dur` s. */
  function walk(dur, yaw0, yaw1, run = false) {
    return new Promise(res => {
      P.mode = 'walk';
      m.settings.set('viewMode', 'Third Person');
      m.input.enabled = true;
      m.input.down.KeyW = true;
      if (run) m.input.down.ShiftLeft = true;
      const t0 = performance.now();
      (function step() {
        const t = Math.min(1, (performance.now() - t0) / 1000 / dur);
        P.aimYaw = P.yaw = yaw0 + (yaw1 - yaw0) * ease(t);
        P.aimPitch = P.pitch = -0.10;
        m.input.enabled = true;                       // re-assert: a window blur clears held keys
        m.input.down.KeyW = true;
        if (run) m.input.down.ShiftLeft = true;
        if (alive && t < 1) requestAnimationFrame(step);
        else { m.input.down.KeyW = false; m.input.down.ShiftLeft = false; res(); }
      })();
    });
  }
  const key = (code, k) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: k }));
    setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code, key: k })), 120);
  };

  // The game's 1-px track lines vanish on a high-DPI recording; for the video
  // lay a 9 m glowing ribbon along the same real traverse segments.
  const ribbon = (() => {
    const T3 = m.THREE, src = window.__traverseLine, posArr = [];
    src?.traverse(o => {
      if (!o.isLineSegments) return;
      const a = o.geometry.attributes.position.array;
      for (let i = 0; i + 5 < a.length; i += 6) {
        const x0 = a[i], z0 = a[i + 2], x1 = a[i + 3], z1 = a[i + 5];
        const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, nx = -dz / l * 4.5, nz = dx / l * 4.5;
        const y0 = m.hf.heightAt(x0, z0) + 0.9, y1 = m.hf.heightAt(x1, z1) + 0.9;
        posArr.push(x0 + nx, y0, z0 + nz, x0 - nx, y0, z0 - nz, x1 + nx, y1, z1 + nz,
                    x1 + nx, y1, z1 + nz, x0 - nx, y0, z0 - nz, x1 - nx, y1, z1 - nz);
      }
    });
    const g = new T3.BufferGeometry();
    g.setAttribute('position', new T3.Float32BufferAttribute(posArr, 3));
    const mesh = new T3.Mesh(g, new T3.MeshBasicMaterial({ color: 0x38d9ff, transparent: true, opacity: 0.9,
      depthWrite: false, side: T3.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 5;
    m.scene.add(mesh);
    return mesh;
  })();
  const track = v => { ribbon.visible = v; m.settings.set('roverTrack', v); };
  const fogWas = m.settings.get('fogDensity');
  const haze = thin => m.settings.set('fogDensity', thin ? 0.000018 : fogWas);

  const W = m.crash?.W || { x: 0, z: 0 };
  const rv = m.perseverance?.pos;
  const gapWas = m.settings.get('gapOverlay'), trackWas = m.settings.get('roverTrack');
  m.settings.set('gapOverlay', false);
  m.settings.set('mineralOverlay', false);
  m.settings.set('roverTrack', false);

  // ---- sync mark, then the clock starts with the narration ------------------------
  const sync = document.createElement('div');
  sync.style.cssText = 'position:fixed;inset:0;background:#ff00ff;z-index:9999';
  document.body.appendChild(sync);
  await wait(0.3);
  sync.remove();
  window.__tourT0 = performance.now();
  if (voice) voice.play().catch(e => console.warn('[tour] narration blocked', e));

  // ===== WHO =====
  // P0 "Imagine waking up alone on Mars, after a crash": rush toward the smoking wreck
  await fly([W.x - 420, 60, W.z + 300, Math.atan2(420, -300), -0.10],
            [W.x - 40, 9, W.z + 28, Math.atan2(40, -28), -0.12], span(0));
  // P1-P2 team names (full-screen card); slow high orbit behind it
  await until(C[1]);
  await orbit(0, 0, 520, 260, 0.6, 1.4, C[3] - C[1], -0.38);
  // P3 "we built Martian Story... where Perseverance landed": glide over the landing site to the rover
  await until(C[3]);
  const rx = rv ? rv.x : 0, rz = rv ? rv.z : 0;
  await fly([rx + 260, 140, rz + 260, Math.atan2(-260, -260), -0.40],
            [rx + 22, 12, rz + 22, Math.atan2(-22, -22), -0.32], span(3));

  // ===== WHY =====
  // P4 the challenge, what crews need: panorama to the crater rim
  await until(C[4]);
  haze(true);
  await fly([300, 700, -200, Y * 1.90, -0.08], [900, 900, 300, Y * 2.55, -0.04], span(4));
  haze(false);
  // P5 "NASA has mapped Jezero... Perseverance has driven 45 km": high over the rover's route
  await until(C[5]);
  track(true);
  await fly([500, 420, 700, Math.atan2(-900, -1300), -0.55], [-500, 520, -200, Math.atan2(-900, -1300), -0.60], span(5));
  // P6 "at the Perseverance landing site... one centimetre apart": descend onto the landing site
  await until(C[6]);
  track(false);
  await fly([420, 380, 260, Y * 0.80, -0.30], [8, 3, 6, Y * 0.75, -0.06], span(6));
  // P7 "anyone... to stand on that ground": the astronaut on foot, life support visible
  await until(C[7]);
  P.placeAt(W.x - 30, W.z + 20);
  hud(true);
  await walk(span(7) - 0.2, Math.atan2(30, -20), Math.atan2(30, -20) + 0.5);

  // ===== WHAT =====
  // P8 "in a web browser... HiRISE... CTX... MOLA": high flyover from the delta to the rim
  await until(C[8]);
  hud(false);
  haze(true);
  await fly([-1500, 950, 900, Y * 1.70, -0.12], [900, 900, 300, Y * 2.50, -0.05], span(8));
  haze(false);
  // P9 "Press K... CRISM": the mineral map from above
  await until(C[9]);
  m.settings.set('mineralOverlay', true);
  await fly([0, 1300, 600, Y * 1.75, -0.55], [-700, 1100, 200, Y * 1.60, -0.60], span(9) - 0.3);
  m.settings.set('mineralOverlay', false);
  // P10 "The blue line is Perseverance's real traverse... Press P": walk the track, then the panel
  await until(C[10]);
  const [tP, tRim, tMeda, tEnd] = TL.shots.panel || [C[10] + 4, C[10] + 10, C[10] + 13, C[11]];
  track(true);
  await fly([180, 110, 220, Math.atan2(-180, -220), -0.62], [40, 70, 60, Math.atan2(-40, -60), -0.70], Math.max(1, tP - clock()));
  window.__tourPanel = true;
  key('KeyP', 'p');
  await until(tRim);
  document.getElementById('rdRadar')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await until(tMeda);
  document.getElementById('rdMeda')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await until(tEnd - 0.4);
  key('Escape', 'Escape');
  await wait(0.2);
  window.__tourPanel = false;
  track(false);
  // P11 "there is Perseverance itself": circle the rover
  await until(C[11]);
  hud(false);
  if (rv) await orbit(rv.x, rv.z, 9, 3.2, 0, Math.PI * 1.1, span(11), -0.30);

  // ===== IMPACT =====
  // P12 survival science: IMPACT card over a clean frame, then run with life support showing
  await until(C[12]);
  P.placeAt(W.x + 140, W.z - 160);
  const tHud = TL.shots.impactHud || C[12] + 5;
  setTimeout(() => hud(true), Math.max(0, (tHud - clock()) * 1000));
  await walk(span(12) - 0.2, Math.atan2(140, -160) + 0.3, Math.atan2(140, -160) + 0.8, true);
  // P13 "Students learn Mars by walking on it": first-person walk across the floor
  await until(C[13]);
  P.placeAt(-60, 120);
  await walk(span(13) - 0.2, Y * 1.30, Y * 1.45);
  // P14 "Next, we want more landing sites": wide flight over the delta cliffs
  await until(C[14]);
  hud(false);
  haze(true);
  await fly([-2600, 600, -900, Y * 1.40, -0.30], [-4300, 420, -1700, Y * 1.55, -0.38], span(14));
  // P15 credits: pull back into the sky behind the credits card
  await until(C[15]);
  await fly([-4300, 420, -1700, Y * 1.55, -0.38], [-3600, 1600, -1000, Y * 1.75, -0.12], span(15) + 4);
  haze(false);
  m.scene.remove(ribbon);

  if (voice && !voice.ended) await new Promise(r => voice.addEventListener('ended', r, { once: true }));
  m.settings.set('gapOverlay', gapWas);
  m.settings.set('roverTrack', trackWas);
  m.settings.set('enabled', soundWas);
  window.__tourDone = true;
}
