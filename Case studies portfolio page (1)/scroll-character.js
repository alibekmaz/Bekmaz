// <scroll-character> — loads the exported Spline scene (geometry only; materials are
// re-applied here) and drives a scroll-linked camera POV around it.
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

class ScrollCharacter extends HTMLElement {
  connectedCallback() {
    if (this._started) return;
    this._started = true;
    Object.assign(this.style, { display: 'block', position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '0' });
    this.showLoader();
    this.init();
  }


  size() {
    const r = this.getBoundingClientRect();
    return {
      w: Math.max(1, Math.round(r.width || innerWidth || 1)),
      h: Math.max(1, Math.round(r.height || innerHeight || 1))
    };
  }

  fit() {
    if (!this.renderer) return;
    const { w, h } = this.size();
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  showLoader() {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed', inset: '0', display: 'flex', flexDirection: 'column',
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

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 200);

    scene.add(new THREE.HemisphereLight(0xffd9b8, 0x1a1210, 1.0));
    const key = new THREE.DirectionalLight(0xffe2bb, 2.2);
    key.position.set(-5.2, 3.4, 1.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { near: 0.3, far: 24, left: -6, right: 6, top: 5, bottom: -3 });
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffb591, 0.75);
    rim.position.set(3.4, 2.8, -3.0);
    scene.add(rim);
    const fill = new THREE.PointLight(0xffd8bd, 2.2, 10);
    fill.position.set(-0.4, 1.5, 1.4);
    scene.add(fill);
    const bounce = new THREE.PointLight(0xffcfa6, 3.0, 13);
    bounce.position.set(0.2, 2.7, -1.8);
    scene.add(bounce);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(14, 64),
      new THREE.MeshStandardMaterial({ color: 0x241a17, roughness: 0.98, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.pointer = { x: 0, y: 0 };
    this.scrollP = 0; this.scrollTarget = 0;

    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    const people = gltf.scene.getObjectByName('people');
    const figure = new THREE.Group();
    figure.name = 'figure';
    figure.add(gltf.scene);
    scene.add(figure);
    this.figure = figure;

    // the export ships a whole room; keep the props, drop the floor plate and floating UI bits
    ['Floor', 'Cube', 'Sphere', 'Icons'].forEach((n) => {
      const o = gltf.scene.getObjectByName(n);
      if (o) o.visible = false;
    });

    // normalise: y-up, feet on the ground, ~1.6m tall, facing +z
    figure.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(people || gltf.scene);
    const size = new THREE.Vector3(); box.getSize(size);
    const s = 1.62 / size.y;
    figure.scale.setScalar(s);
    figure.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(people || gltf.scene);
    const c = new THREE.Vector3(); box.getCenter(c);
    figure.position.x -= c.x;
    figure.position.z -= c.z;
    figure.position.y -= box.min.y;
    this.head = people && people.getObjectByName('head');
    if (this.head) this.headRest = this.head.quaternion.clone();
    this.hands = [];
    (people || gltf.scene).traverse((o) => {
      const n = (o.name || '').replace(/ /g, '_');
      if (n === 'hand-15' || n === 'hand-15_2') {
        const ws = o.getWorldScale(new THREE.Vector3()).length() / Math.sqrt(3);
        this.hands.push({ o, rest: o.position.clone(), q: o.quaternion.clone(), s: 1 / (Math.abs(ws) || 1) });
      }
    });
    figure.updateMatrixWorld(true);
    this.paint(THREE, figure);
    this.buildRoom(THREE, scene);

    addEventListener('resize', () => this.fit());
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this);
    this.fit();
    requestAnimationFrame(() => this.fit());
    addEventListener('pointermove', (e) => {
      this.pointer.x = (e.clientX / innerWidth) * 2 - 1;
      this.pointer.y = (e.clientY / innerHeight) * 2 - 1;
    }, { passive: true });
    addEventListener('scroll', () => {
      const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      this.scrollTarget = Math.min(1, Math.max(0, scrollY / max));
    }, { passive: true });

    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;

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
      screen: M(0xf6ecdc, 0.8, { emissive: 0xffd9a8, emissiveIntensity: 0.32 }),
      wood:   M(0x6b4526, 0.9),
      woodD:  M(0x3a2519, 0.92),
      pot:    M(0xb45f38, 0.95),
      leaf:   M(0x4b7347, 0.95),
      book:   M(0xc0863c, 0.95),
      paper:  M(0xe6dccd, 0.96),
      cupM:   M(0xd6cabb, 0.9),
      metal:  M(0x2c2523, 0.75),
      shade:  M(0xffe3ba, 0.85, { emissive: 0xffc98a, emissiveIntensity: 0.9 }),
      frame:  M(0x2a211d, 0.9),
      art:    M(0xb0704a, 0.95)
    };
    const byGroup = {
      shoes: P.shoe, shoe: P.shoe, headphones: P.phones, chair: P.chair, computer: P.laptop,
      leg: P.jeans, line: P.cable, body: P.sweater, head: P.skin,
      'hand-15': P.skin, 'hand-15_2': P.skin, 'hand-15 2': P.skin, Cylinder_1: P.skin,
      desk: P.wood, books: P.book, document: P.paper, cup: P.cupM, Rectangle_5: P.paper,
      plant: P.leaf, plant2: P.leaf, lamp: P.metal, picture: P.frame
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

    // pots, lamp shade and picture art sit at known heights inside their groups
    const band = (groupName, frac, lowMat, highMat) => {
      const g = root.getObjectByName(groupName);
      if (!g) return;
      const gb = new THREE.Box3().setFromObject(g);
      const cut = gb.min.y + (gb.max.y - gb.min.y) * frac;
      g.traverse((o) => {
        if (!o.isMesh) return;
        const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
        const m = c.y < cut ? lowMat : highMat;
        if (m) o.material = m;
      });
    };
    band('plant', 0.32, P.pot, P.leaf);
    band('plant2', 0.3, P.pot, P.leaf);
    band('lamp', 0.72, P.metal, P.shade);
    band('picture', 0.99, P.art, P.frame);

    // the laptop: drop the embossed logo, put a design tool on the screen
    const laptop = root.getObjectByName('computer');
    if (laptop) {
      const logo = laptop.getObjectByName('Text');
      if (logo) logo.visible = false;
      this.addScreen(THREE, laptop.getObjectByName('Rectangle_2_8'));
    }
  }

  // A design-app UI drawn to canvas and laid over the laptop's screen panel.
  addScreen(THREE, panel) {
    if (!panel) return;
    const W = 1024, H = 605;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    const ink = '#F5F3EE', dim = 'rgba(245,243,238,.42)', accent = '#FF5A36';
    x.fillStyle = '#17141A'; x.fillRect(0, 0, W, H);

    // top bar
    x.fillStyle = '#100E13'; x.fillRect(0, 0, W, 54);
    x.fillStyle = accent; x.beginPath(); x.arc(34, 27, 9, 0, 7); x.fill();
    x.fillStyle = dim; x.font = '500 20px Inter, sans-serif';
    x.fillText('portfolio — hero', 60, 34);

    // left tool rail
    x.fillStyle = '#100E13'; x.fillRect(0, 54, 74, H - 54);
    for (let i = 0; i < 6; i++) {
      x.fillStyle = i === 1 ? accent : 'rgba(245,243,238,.22)';
      x.fillRect(26, 92 + i * 52, 22, 22);
    }

    // right inspector
    x.fillStyle = '#100E13'; x.fillRect(W - 210, 54, 210, H - 54);
    for (let i = 0; i < 7; i++) {
      x.fillStyle = 'rgba(245,243,238,.16)';
      x.fillRect(W - 182, 100 + i * 48, 120, 12);
      x.fillStyle = 'rgba(245,243,238,.3)';
      x.fillRect(W - 182, 120 + i * 48, 58, 12);
    }

    // artboard
    const ax = 132, ay = 100, aw = W - 210 - ax - 44, ah = H - ay - 60;
    x.fillStyle = '#0B0B0D'; x.fillRect(ax, ay, aw, ah);
    x.strokeStyle = accent; x.lineWidth = 2; x.strokeRect(ax, ay, aw, ah);
    x.fillStyle = ink; x.font = '700 46px Inter, sans-serif';
    x.fillText('Let\u2019s design', ax + 34, ay + 96);
    x.fillText('your ideas', ax + 34, ay + 146);
    x.fillStyle = dim; x.font = '400 20px Inter, sans-serif';
    x.fillText('Product designer, three years of work.', ax + 34, ay + 196);
    x.fillStyle = accent; x.fillRect(ax + 34, ay + 226, 148, 44);
    x.fillStyle = 'rgba(245,243,238,.14)'; x.fillRect(ax + 196, ay + 226, 148, 44);
    x.fillStyle = 'rgba(245,243,238,.08)'; x.fillRect(ax + 34, ay + 300, aw - 68, ah - 340);
    x.strokeStyle = 'rgba(255,90,54,.5)'; x.lineWidth = 1.5;
    x.strokeRect(ax + 34, ay + 300, aw - 68, ah - 340);

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;

    // the panel is a thin plate spanning local x -110..110, y -65..65, z 0..1
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(206, 122),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    );
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(panel.getWorldQuaternion(new THREE.Quaternion()));
    if (n.z < 0) {
      plane.position.set(0, 0, 4);
    } else {
      plane.position.set(0, 0, -3);
      plane.rotation.y = Math.PI;
    }
    panel.add(plane);
    this.screen = plane;
  }

  // Warm dark room around the scene, lit by two tall windows on the left wall.
  buildRoom(THREE, scene) {
    const HX = 4.8, HZ = 5.0, H = 3.5;
    const room = new THREE.Group();
    room.name = 'room';

    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(HX * 2, H, HZ * 2),
      new THREE.MeshStandardMaterial({ color: 0x3a2a24, roughness: 0.98, metalness: 0, side: THREE.BackSide })
    );
    shell.position.set(0, H / 2 - 0.01, 0);
    shell.receiveShadow = true;
    room.add(shell);

    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xffe9c9, roughness: 1, metalness: 0,
      emissive: 0xffd9a0, emissiveIntensity: 0.95
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1d1512, roughness: 0.92, metalness: 0 });

    // windows on the two walls the camera faces: -x and -z
    const walls = [
      { axis: 'x', sign: -1, offs: [-1.25, 1.35] },
      { axis: 'z', sign: -1, offs: [1.95, 3.85] }
    ];
    walls.forEach(({ axis, sign, offs }) => {
      const half = axis === 'x' ? HX : HZ;
      offs.forEach((o) => {
        const w = 1.5, h = 1.95, y = 1.35;
        const place = (mesh, inset) => {
          if (axis === 'x') { mesh.position.set(sign * (half - inset), y, o); mesh.rotation.y = Math.PI / 2; }
          else { mesh.position.set(o, y, sign * (half - inset)); }
          room.add(mesh);
        };
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
        place(glass, 0.03);

        const bar = (len, th, dy, dOff, vertical) => {
          const g = vertical ? new THREE.BoxGeometry(len, th, 0.06) : new THREE.BoxGeometry(th, len, 0.06);
          const m = new THREE.Mesh(g, frameMat);
          place(m, 0.07);
          if (axis === 'x') { m.position.y += dy; m.position.z += dOff; }
          else { m.position.y += dy; m.position.x += dOff; }
          if (vertical) m.rotation.z = 0;
          return m;
        };
        // frame: two uprights, two rails, one cross in each direction
        bar(0.09, h + 0.12, 0, -w / 2, true);
        bar(0.09, h + 0.12, 0, w / 2, true);
        bar(w + 0.12, 0.09, -h / 2, 0, true);
        bar(w + 0.12, 0.09, h / 2, 0, true);
        bar(0.05, h, 0, 0, true);
        bar(w, 0.05, 0, 0, true);

      });
    });

    // skirting board grounds the walls
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0x1f1714, roughness: 0.95, metalness: 0 });
    [[0, -HZ + 0.04, HX * 2, 0], [0, HZ - 0.04, HX * 2, 0], [-HX + 0.04, 0, HZ * 2, Math.PI / 2], [HX - 0.04, 0, HZ * 2, Math.PI / 2]]
      .forEach(([x, z, len, ry]) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, 0.08), skirtMat);
        m.position.set(x, 0.07, z);
        m.rotation.y = ry;
        room.add(m);
      });

    scene.add(room);
    this.room = room;

    // one warm source standing in for all four windows
    const win = new THREE.PointLight(0xffd7a3, 3.2, 12);
    win.position.set(-HX + 1.2, 1.5, -HZ + 2.2);
    scene.add(win);
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

  static KEYS = [
    { p: 0.00, pos: [-2.15, 1.35, 3.35], look: [-0.7, 0.9, 0.15], fov: 34 },
    { p: 0.19, pos: [1.9, 1.45, 2.9], look: [-0.6, 0.95, 0.2], fov: 36 },
    { p: 0.40, pos: [-2.5, 0.95, 2.5], look: [0.8, 0.9, 0.1], fov: 38 },
    { p: 0.60, pos: [-1.0, 2.4, -2.7], look: [0.65, 0.8, 0], fov: 42 },
    { p: 0.80, pos: [-1.7, 0.8, 3.0], look: [0.85, 1.05, 0.2], fov: 34 },
    { p: 1.00, pos: [-1.9, 1.45, 2.4], look: [1.75, 1.15, 0.1], fov: 30 }
  ];

  sampleCamera(p) {
    const K = ScrollCharacter.KEYS;
    let i = 0;
    while (i < K.length - 2 && p > K[i + 1].p) i++;
    const a = K[i], b = K[i + 1];
    let t = Math.min(1, Math.max(0, (p - a.p) / (b.p - a.p)));
    t = t * t * (3 - 2 * t);
    const l = (u, v) => u + (v - u) * t;
    return { pos: a.pos.map((v, k) => l(v, b.pos[k])), look: a.look.map((v, k) => l(v, b.look[k])), fov: l(a.fov, b.fov) };
  }

  loop = () => {
    const { camera, renderer, scene, THREE } = this;
    this.scrollP += (this.scrollTarget - this.scrollP) * 0.075;
    const s = this.sampleCamera(this.scrollP);
    camera.position.set(s.pos[0], s.pos[1], s.pos[2]);
    camera.lookAt(s.look[0], s.look[1], s.look[2]);
    if (Math.abs(camera.fov - s.fov) > 0.01) { camera.fov = s.fov; camera.updateProjectionMatrix(); }

    const t = performance.now() / 1000;
    const _e = this._e || (this._e = new THREE.Euler(0, 0, 0, 'XYZ'));
    const _q = this._q || (this._q = new THREE.Quaternion());
    // typing: keystrokes hinge at the wrist so the hands stay inside the sleeves
    if (this.hands) this.hands.forEach((hd, i) => {
      const off = i * 0.9;
      const strike = Math.sin(t * 17.5 + off);
      const S = hd.s || 1;
      hd.o.position.y = hd.rest.y + Math.max(0, strike) * 0.003 * S;
      _e.set(strike * 0.1, Math.sin(t * 3.1 + off) * 0.05, Math.sin(t * 2.3 + off * 1.7) * 0.035);
      hd.o.quaternion.copy(hd.q).multiply(_q.setFromEuler(_e));
    });
    if (this.head && this.headRest) {
      const e = new THREE.Euler(
        this.pointer.y * 0.16 + Math.sin(t * 0.7) * 0.02,
        this.pointer.x * 0.36 + Math.sin(t * 0.5) * 0.03,
        0, 'XYZ'
      );
      const target = this.headRest.clone().multiply(new THREE.Quaternion().setFromEuler(e));
      this.head.quaternion.slerp(target, 0.06);
    }
    if (this.figure) this.figure.rotation.y = Math.sin(t * 0.25) * 0.02;
    if (this.palette) this.palette.screen.emissiveIntensity = 0.3 + Math.sin(t * 2.1) * 0.06;

    renderer.render(scene, camera);
    requestAnimationFrame(this.loop);
  };

  disconnectedCallback() {
    if (this.ro) this.ro.disconnect();
  }
}
customElements.define('scroll-character', ScrollCharacter);
