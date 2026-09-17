// <desk-character> — the same Spline figure, framed close on the laptop and driven by a
// 5.5s looping "working" performance (typing, glance up, confident nod) inside its container.
const THREE_URL = 'https://unpkg.com/three@0.184.0/build/three.module.js';
const LOADER_URL = 'https://unpkg.com/three@0.184.0/examples/jsm/loaders/GLTFLoader.js';
const MODEL_URL = './room_relaxing.gltf';

// Loads an ES module whose bare "three" specifier is rewritten to the pinned URL,
// so no import map is required in the host document.
const _blobCache = new Map();
async function toBlobModule(url) {
  if (_blobCache.has(url)) return _blobCache.get(url);
  const promise = (async () => {
    const src = await (await fetch(url)).text();
    const specs = new Set();
    const re = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src))) specs.add(m[1]);
    let out = src;
    for (const spec of specs) {
      let replacement = null;
      if (spec === 'three') replacement = THREE_URL;
      else if (spec.startsWith('./') || spec.startsWith('../')) replacement = await toBlobModule(new URL(spec, url).href);
      if (replacement) out = out.split(`'${spec}'`).join(`'${replacement}'`).split(`"${spec}"`).join(`"${replacement}"`);
    }
    return URL.createObjectURL(new Blob([out], { type: 'text/javascript' }));
  })();
  _blobCache.set(url, promise);
  return promise;
}
async function importRemote(url) {
  return import(await toBlobModule(url));
}

class DeskCharacter extends HTMLElement {
  connectedCallback() {
    if (this._started) return;
    this._started = true;
    Object.assign(this.style, { display: 'block', position: 'relative', overflow: 'hidden' });
    this.showLoader();
    this.init();
  }

  size() {
    const r = this.getBoundingClientRect();
    return { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height || r.width)) };
  }


  showLoader() {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: '14px', pointerEvents: 'none',
      font: "500 12px 'Inter',system-ui,sans-serif", letterSpacing: '.14em',
      textTransform: 'uppercase', color: 'rgba(245,243,238,.45)', transition: 'opacity .5s ease'
    });
    const ring = document.createElement('div');
    Object.assign(ring.style, {
      width: '30px', height: '30px', borderRadius: '50%',
      border: '2px solid rgba(245,243,238,.14)', borderTopColor: '#FF5A36',
      animation: 'dc-spin .8s linear infinite'
    });
    const label = document.createElement('span');
    label.textContent = 'Loading';
    const style = document.createElement('style');
    style.textContent = '@keyframes dc-spin{to{transform:rotate(360deg)}}';
    el.append(style, ring, label);
    this.appendChild(el);
    this._loader = el;
  }

  hideLoader() {
    const el = this._loader;
    if (!el) return;
    this._loader = null;
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 550);
  }

  async init() {
    const THREE = await import(THREE_URL);
    const { GLTFLoader } = await importRemote(LOADER_URL);
    this.THREE = THREE;
    const { w, h } = this.size();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    this.appendChild(renderer.domElement);
    Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, w / h, 0.05, 200);

    scene.add(new THREE.HemisphereLight(0xffe9d6, 0x2f2320, 1.05));
    const key = new THREE.DirectionalLight(0xfff4e6, 1.5);
    key.position.set(1.9, 3.4, 2.8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { near: 0.2, far: 16, left: -2.5, right: 2.5, top: 2.5, bottom: -2.5 });
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffb591, 0.7);
    rim.position.set(-2.6, 1.8, -1.9);
    scene.add(rim);
    // bounce off the laptop screen, onto the face
    const glow = new THREE.PointLight(0xffd9a8, 2.6, 3.2);
    scene.add(glow);
    this.glow = glow;

    this.renderer = renderer; this.scene = scene; this.camera = camera;

    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    const people = gltf.scene.getObjectByName('people');
    const figure = new THREE.Group();
    figure.name = 'figure';
    figure.add(people || gltf.scene);
    scene.add(figure);
    this.figure = figure;

    figure.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(figure);
    const size = new THREE.Vector3(); box.getSize(size);
    figure.scale.setScalar(1.62 / size.y);
    figure.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(figure);
    const c = new THREE.Vector3(); box.getCenter(c);
    figure.position.x -= c.x;
    figure.position.z -= c.z;
    figure.position.y -= box.min.y;
    figure.updateMatrixWorld(true);

    this.head = people && people.getObjectByName('head');
    if (this.head) this.headRest = this.head.quaternion.clone();
    this.body = people && people.getObjectByName('body');
    if (this.body) this.bodyRest = this.body.quaternion.clone();
    this.hands = [];
    (people || gltf.scene).traverse((o) => {
      const n = (o.name || '').replace(/ /g, '_');
      if (n === 'hand-15' || n === 'hand-15_2') {
        const ws = o.getWorldScale(new THREE.Vector3()).length() / Math.sqrt(3);
        this.hands.push({ o, rest: o.position.clone(), q: o.quaternion.clone(), s: 1 / (Math.abs(ws) || 1) });
      }
    });

    this.paint(THREE, figure);

    // frame on the laptop and the upper body
    const laptop = (people || gltf.scene).getObjectByName('computer');
    const target = new THREE.Vector3();
    if (laptop) new THREE.Box3().setFromObject(laptop).getCenter(target);
    else { new THREE.Box3().setFromObject(figure).getCenter(target); }
    const headBox = this.head ? new THREE.Box3().setFromObject(this.head) : null;
    const aim = new THREE.Vector3(
      target.x * 0.35,
      headBox ? (headBox.getCenter(new THREE.Vector3()).y + target.y) / 2 + 0.02 : target.y,
      target.z * 0.2
    );
    this.aim = aim;
    if (laptop) {
      const lc = new THREE.Box3().setFromObject(laptop).getCenter(new THREE.Vector3());
      glow.position.set(lc.x, lc.y + 0.18, lc.z + 0.12);
    } else glow.position.copy(aim);

    this._rw = w; this._rh = h;
    this.ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        const { w: nw, h: nh } = this.size();
        if (nw === this._rw && nh === this._rh) return;
        this._rw = nw; this._rh = nh;
        renderer.setSize(nw, nh, false);
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
      });
    });
    this.ro.observe(this);

    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    this.t0 = performance.now() / 1000;
    this.hideLoader();
    this.dispatchEvent(new CustomEvent('ready'));
    this.loop();
  }

  // Spline's exporter dropped the materials, so they are re-authored here by part.
  paint(THREE, root) {
    const M = (c, r, extra) => new THREE.MeshStandardMaterial(
      Object.assign({ color: c, roughness: r ?? 0.96, metalness: 0 }, extra || {})
    );
    const P = {
      skin:   M(0xf0b98f),
      beanie: M(0xf2a7b0, 0.94),
      beard:  M(0x7d6ee0, 0.92),
      hair:   M(0x1b1517, 0.9),
      hairD:  M(0x0f0c0d, 0.9),
      eye:    M(0x2a2226, 0.5),
      sweater:M(0x8ec2ee, 0.98),
      collar: M(0xf7f4ee),
      jeans:  M(0x4f6fd6, 0.98),
      shoe:   M(0xf9f6f1),
      shoeDk: M(0x2f2a2b, 0.85),
      lace:   M(0x9fd6e8, 0.9),
      phones: M(0xf0a7ae, 0.92),
      cable:  M(0xf0a7ae, 0.92),
      beanieTag: M(0xf7c3c9, 0.94),
      mouth:  M(0x8f4a44, 0.9),
      chair:  M(0xa9525f),
      laptop: M(0xe8a52f),
      screen: M(0xf6ecdc, 0.8, { emissive: 0xffd9a8, emissiveIntensity: 0.32 })
    };
    const byGroup = {
      shoes: P.shoe, shoe: P.shoe, headphones: P.phones, chair: P.chair, computer: P.laptop,
      leg: P.jeans, line: P.cable, body: P.sweater, head: P.skin,
      'hand-15': P.skin, 'hand-15_2': P.skin, 'hand-15 2': P.skin, Cylinder_1: P.skin
    };
    const meshes = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      let group = o, name = '';
      while (group) { const key = (group.name || '').replace(/ /g, '_'); if (byGroup[key]) { name = key; break; } group = group.parent; }
      o.material = byGroup[name] || P.sweater;
      o.userData.group = name;
      meshes.push(o);
    });

    // the head's parts all export as "Cube N"; they are identified by position/size
    const head = root.getObjectByName('head');
    if (head) {
      const byIndex = {
        16: P.skin, 14: P.skin, 15: P.skin,
        4: P.hair, 5: P.hair, 6: P.hair, 7: P.hair, 8: P.hair, 9: P.hair,
        12: P.hair, 13: P.hair,
        10: P.eye, 11: P.eye,
        1: P.hairD
      };
      const hidden = [0, 2, 3]; // beanie, beanie tag, beard
      head.children.forEach((child, i) => {
        if (hidden.includes(i)) { child.visible = false; return; }
        const mat = byIndex[i];
        if (!mat) return;
        child.traverse((o) => { if (o.isMesh) o.material = mat; });
      });
      this.addCurls(THREE, head, P.hair);
      this.addMoustache(THREE, head, P.hairD);
    }
    this.parts = meshes;
    this.palette = P;
  }

  // Scatters ringlets over the scalp so the hair reads as tight curls rather than a smooth cap.
  addCurls(THREE, head, mat) {
    const skull = head.children[16];
    const eyeA = head.children[10], eyeB = head.children[11];
    if (!skull || !eyeA || !eyeB) return;
    const wbox = (o) => new THREE.Box3().setFromObject(o);
    const skullBox = wbox(skull);
    const skullC = skullBox.getCenter(new THREE.Vector3());
    const skullR = skullBox.getSize(new THREE.Vector3()).length() / 3.35;
    const eyeC = wbox(eyeA).getCenter(new THREE.Vector3()).add(wbox(eyeB).getCenter(new THREE.Vector3())).multiplyScalar(0.5);
    const front = eyeC.clone().sub(skullC).setY(0).normalize();

    const ws = head.getWorldScale(new THREE.Vector3()).x || 1;
    const rand = (s) => { const x = Math.sin(s * 127.1) * 43758.5453; return x - Math.floor(x); };

    const N = 260;
    const geo = new THREE.SphereGeometry(1, 8, 6);
    const inst = new THREE.InstancedMesh(geo, mat, N);
    inst.name = 'curls';
    inst.castShadow = true;
    inst.receiveShadow = true;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < N * 3 && n < N; i++) {
      const u = rand(i + 5), v = rand(i + 61), w = rand(i + 137);
      const phi = Math.acos(1 - 1.32 * u);          // weighted toward the crown
      const theta = v * Math.PI * 2;
      const dir = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      const facing = dir.clone().setY(0).normalize().dot(front);
      if (dir.y < 0.5 && facing > 0.3) continue;   // keep the face and moustache clear
      if (dir.y < -0.5) continue;                    // no curls under the jaw
      const layer = w < 0.62 ? 1 : (w < 0.88 ? 1.035 : 0.94);
      const jitter = 0.94 + rand(i + 211) * 0.14;
      pos.copy(skullC).add(dir.clone().multiplyScalar(skullR * 0.9 * layer * jitter));
      head.worldToLocal(pos);
      const r = (skullR * (0.125 + rand(i + 313) * 0.065)) / ws;
      q.setFromEuler(new THREE.Euler(rand(i + 7) * 3, rand(i + 71) * 3, rand(i + 401) * 3));
      sc.set(r * (0.85 + rand(i + 29) * 0.4), r * (0.85 + rand(i + 53) * 0.4), r * (0.85 + rand(i + 97) * 0.4));
      m4.compose(pos, q, sc);
      inst.setMatrixAt(n++, m4);
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    head.add(inst);
    this.curls = inst;
  }

  // Thick moustache with the ends sweeping down past the mouth corners.
  addMoustache(THREE, head, mat) {
    const lip = head.children[1];
    const skull = head.children[16];
    const eyeA = head.children[10], eyeB = head.children[11];
    if (!lip || !skull || !eyeA || !eyeB) return;
    const wbox = (o) => new THREE.Box3().setFromObject(o);
    const skullBox = wbox(skull);
    const skullC = skullBox.getCenter(new THREE.Vector3());
    const skullR = skullBox.getSize(new THREE.Vector3()).length() / 3.35;
    const eyeCA = wbox(eyeA).getCenter(new THREE.Vector3());
    const eyeCB = wbox(eyeB).getCenter(new THREE.Vector3());
    const eyeC = eyeCA.clone().add(eyeCB).multiplyScalar(0.5);
    const anchor = wbox(lip).getCenter(new THREE.Vector3());
    lip.visible = false;

    const front = eyeC.clone().sub(skullC).normalize();
    const right = eyeCB.clone().sub(eyeCA).normalize();
    if (right.dot(new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), front)) < 0) right.negate();
    const up = new THREE.Vector3().crossVectors(front, right).normalize();

    const g = new THREE.Group();
    g.name = 'moustache';
    const ws = head.getWorldScale(new THREE.Vector3()).x || 1;
    const W = skullR * 0.22;    // half-width
    const SLOPE = skullR * 0.05; // gentle fall along the arms
    const TIP = skullR * 0.055;  // short drop at the ends
    const R0 = skullR * 0.05;    // stroke weight
    const base = anchor.clone().add(up.clone().multiplyScalar(skullR * 0.09));

    const add = (p, r, sq) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r / ws, 10, 7), mat);
      const local = head.worldToLocal(p.clone());
      m.position.copy(local);
      if (sq) m.scale.set(1, sq, 1);
      m.name = 'moustache_lobe';
      g.add(m);
    };

    for (const s of [-1, 1]) {
      const N = 16;
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const lateral = s * W * Math.min(1, t / 0.8);
        const drop = -(SLOPE * t) - (t > 0.78 ? TIP * Math.pow((t - 0.78) / 0.22, 1.4) : 0);
        const fwd = skullR * (0.02 - 0.09 * t * t);
        const r = R0 * (1 - 0.45 * t * t);
        const p = base.clone()
          .add(right.clone().multiplyScalar(lateral))
          .add(up.clone().multiplyScalar(drop))
          .add(front.clone().multiplyScalar(fwd));
        add(p, r, 0.62);
      }
    }
    head.add(g);
    this.moustache = g;
  }

  // 5.5s performance: settle in, two typing bursts, a glance up, a confident nod.
  static CYCLE = 5.5;

  // eased 0..1 ramp
  static ramp(x) { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); }

  loop = () => {
    const { camera, renderer, scene, THREE } = this;
    const t = performance.now() / 1000 - this.t0;
    const C = DeskCharacter.CYCLE;
    const p = (t % C) / C;            // 0..1 through the loop
    const R = DeskCharacter.ramp;

    // typing runs through most of the loop, pausing while he looks up
    const typeGate = 1 - R((p - 0.52) / 0.1) * (1 - R((p - 0.78) / 0.12));
    const beat = Math.sin(t * 17.5);
    this.hands.forEach((hd, i) => {
      const off = i * 0.9;
      const strike = Math.sin(t * 17.5 + off);
      // keystrokes come from the wrist hinge, so the hand stays inside the sleeve
      const S = hd.s || 1;
      hd.o.position.y = hd.rest.y + Math.max(0, strike) * 0.003 * S * typeGate;
      hd.o.position.x = hd.rest.x;
      hd.o.position.z = hd.rest.z;
      // wrist flexes into each strike and rolls gently as he reaches across the keys
      const _e = this._e || (this._e = new THREE.Euler(0, 0, 0, 'XYZ'));
      const _q = this._q || (this._q = new THREE.Quaternion());
      _e.set(strike * 0.1 * typeGate, Math.sin(t * 3.1 + off) * 0.05 * typeGate, Math.sin(t * 2.3 + off * 1.7) * 0.035 * typeGate);
      hd.o.quaternion.copy(hd.q).multiply(_q.setFromEuler(_e));
    });

    // head: down at the keys, lifts to read the screen, then the nod
    if (this.head && this.headRest) {
      const lookUp = R((p - 0.5) / 0.12) * (1 - R((p - 0.82) / 0.14));
      const nod = Math.sin(Math.min(1, Math.max(0, (p - 0.62) / 0.14)) * Math.PI * 2) * 0.09;
      const e = new THREE.Euler(
        0.1 - lookUp * 0.18 + nod + Math.sin(t * 1.9) * 0.012 + beat * 0.004 * typeGate,
        Math.sin(t * 0.6) * 0.05 - lookUp * 0.05,
        Math.sin(t * 0.8) * 0.012,
        'XYZ'
      );
      this.head.quaternion.copy(this.headRest).multiply(new THREE.Quaternion().setFromEuler(e));
    }

    // torso: leans in to type, eases back on the nod
    if (this.body && this.bodyRest) {
      const lean = 0.035 - R((p - 0.54) / 0.14) * (1 - R((p - 0.86) / 0.12)) * 0.055;
      const e = new THREE.Euler(lean, Math.sin(t * 0.45) * 0.02, 0, 'XYZ');
      this.body.quaternion.copy(this.bodyRest).multiply(new THREE.Quaternion().setFromEuler(e));
    }

    // slow drift around the desk, tightening as he looks up
    const orbit = 0.44 + Math.sin(p * Math.PI * 2) * 0.13;
    const dist = 2.55 - R((p - 0.5) / 0.2) * (1 - R((p - 0.85) / 0.12)) * 0.22;
    camera.position.set(
      this.aim.x + Math.sin(orbit) * dist,
      this.aim.y + 0.3 + Math.sin(p * Math.PI * 2 + 1) * 0.06,
      this.aim.z + Math.cos(orbit) * dist
    );
    camera.lookAt(this.aim.x + 0.1, this.aim.y - 0.05, this.aim.z);

    // screen light pulses with the keystrokes
    if (this.palette) this.palette.screen.emissiveIntensity = 0.34 + beat * 0.05 * typeGate + Math.sin(t * 1.3) * 0.03;
    if (this.glow) this.glow.intensity = 2.5 + beat * 0.25 * typeGate;

    renderer.render(scene, camera);
    this._raf = requestAnimationFrame(this.loop);
  };

  disconnectedCallback() {
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this.ro) this.ro.disconnect();
  }
}
customElements.define('desk-character', DeskCharacter);
