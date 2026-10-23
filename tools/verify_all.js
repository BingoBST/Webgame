#!/usr/bin/env node
'use strict';
// ---------------------------------------------------------------------------
// OpusMC / htgame Automated Sandbox Verification Suite (tools/verify_all.js)
// Runs inside Gemini Task Sandbox VM in ~2 seconds without a GPU browser:
// 1. Verifies game/index.html script load order & file existence on disk.
// 2. Audits WebGL2 shader compile/link API calls (catches getShaderParameter
//    vs getProgramParameter bugs before runtime).
// 3. Boots the full game stack in an isolated VM context with WebGL2/IDB
//    stubs + synchronous inline Blob Worker simulation.
// 4. Verifies W0-A/B/C, W1 (Villager trading, Hopper->Furnace loop, Brewing
//    Stand + 4 Potions + HUD Status Effects + Save/Load persistence), and W2
//    (Redstone Automation Trio 514..518: Comparator, Observer, Piston & Sticky
//    Piston with 12-block push limit & Guard Rule #4 blacklist + automatic
//    Observer+Piston+Hopper Sugar Cane harvester, plus 1.20 Cherry Grove &
//    Cherry Wood Set 519..526).
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const GAME_DIR = path.join(ROOT, 'game');

// 1. Check index.html <script> tags vs disk files
const indexHtml = fs.readFileSync(path.join(GAME_DIR, 'index.html'), 'utf8');
const scriptMatches = [...indexHtml.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map(m => m[1]);
assert(scriptMatches.length >= 16, 'Expected at least 16 script tags in game/index.html');
for (const rel of scriptMatches) {
  const full = path.join(GAME_DIR, rel);
  assert(fs.existsSync(full), `Missing script referenced by index.html: ${rel}`);
}
console.log(`[PASS] index.html script integrity (${scriptMatches.length} scripts verified on disk)`);

// 2. Static audit of render.js WebGL shader/program parameter calls
const renderCode = fs.readFileSync(path.join(GAME_DIR, 'js/render.js'), 'utf8');
assert(
  renderCode.includes('gl.getProgramParameter(p, gl.LINK_STATUS)'),
  'render.js must use gl.getProgramParameter(p, gl.LINK_STATUS), NEVER gl.getShaderParameter(p, gl.LINK_STATUS)'
);
assert(
  !renderCode.includes('gl.getShaderParameter(p,'),
  'Fatal WebGL error detected: gl.getShaderParameter called on WebGLProgram p'
);
console.log('[PASS] render.js WebGL2 program/shader API audit');

// 3. Build Sandbox VM with WebGL2, Canvas2D, IndexedDB, and Inline Worker mocks
function makeCanvasMock(w = 256, h = 256) {
  return {
    width: w,
    height: h,
    style: {},
    value: '',
    focus: () => {},
    blur: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
    addEventListener: () => {},
    requestPointerLock: () => Promise.resolve(),
    getContext: (type) => {
      if (type === '2d') {
        return new Proxy({
          canvas: { width: w, height: h },
          fillStyle: '#000',
          strokeStyle: '#000',
          font: '12px sans-serif',
          textAlign: 'left',
          textBaseline: 'top',
          globalAlpha: 1,
          imageSmoothingEnabled: false,
          measureText: (t) => ({ width: String(t).length * 8 }),
          createLinearGradient: () => ({ addColorStop: () => {} }),
          createImageData: (iw, ih) => ({ data: new Uint8ClampedArray(iw * ih * 4), width: iw, height: ih }),
          getImageData: (_x, _y, iw, ih) => ({ data: new Uint8ClampedArray(iw * ih * 4), width: iw, height: ih }),
        }, {
          get(target, prop) {
            if (prop in target) return target[prop];
            return () => {};
          },
        });
      }
      if (type === 'webgl2') {
        const baseGl = {
          canvas: { width: w, height: h },
          VERTEX_SHADER: 0x8B31,
          FRAGMENT_SHADER: 0x8B30,
          COMPILE_STATUS: 0x8B81,
          LINK_STATUS: 0x8B82,
          ACTIVE_UNIFORMS: 0x8B86,
          ARRAY_BUFFER: 0x8892,
          ELEMENT_ARRAY_BUFFER: 0x8893,
          STATIC_DRAW: 0x88E4,
          DYNAMIC_DRAW: 0x88E8,
          FLOAT: 0x1406,
          UNSIGNED_BYTE: 0x1401,
          UNSIGNED_SHORT: 0x1403,
          UNSIGNED_INT: 0x1405,
          TRIANGLES: 0x0004,
          LINES: 0x0001,
          TEXTURE_2D: 0x0DE1,
          TEXTURE_2D_ARRAY: 0x8C1A,
          TEXTURE0: 0x84C0,
          TEXTURE1: 0x84C1,
          RGBA: 0x1908,
          RGBA8: 0x8058,
          NEAREST: 0x2600,
          LINEAR: 0x2601,
          NEAREST_MIPMAP_LINEAR: 0x2702,
          TEXTURE_MIN_FILTER: 0x2801,
          TEXTURE_MAG_FILTER: 0x2800,
          TEXTURE_WRAP_S: 0x2802,
          TEXTURE_WRAP_T: 0x2803,
          REPEAT: 0x2901,
          CLAMP_TO_EDGE: 0x812F,
          DEPTH_TEST: 0x0B71,
          CULL_FACE: 0x0B44,
          BLEND: 0x0BE2,
          SRC_ALPHA: 0x0302,
          ONE_MINUS_SRC_ALPHA: 0x0303,
          ONE: 1,
          LEQUAL: 0x0203,
          LESS: 0x0201,
          COLOR_BUFFER_BIT: 0x4000,
          DEPTH_BUFFER_BIT: 0x0100,
          createShader: (t) => ({ __type: 'shader', t }),
          getShaderParameter: (s, pname) => {
            assert(s && s.__type === 'shader', 'gl.getShaderParameter called with non-shader!');
            assert(pname === 0x8B81, 'gl.getShaderParameter expected gl.COMPILE_STATUS');
            return true;
          },
          getShaderInfoLog: () => '',
          createProgram: () => ({ __type: 'program' }),
          getProgramParameter: (p, pname) => {
            assert(p && p.__type === 'program', 'gl.getProgramParameter called with non-program!');
            if (pname === 0x8B86) return 0; // gl.ACTIVE_UNIFORMS
            if (pname === 0x8B82) return true; // gl.LINK_STATUS
            return true;
          },
          getProgramInfoLog: () => '',
          getUniformLocation: (_p, name) => ({ name }),
          getAttribLocation: () => 0,
          createVertexArray: () => ({}),
          createBuffer: () => ({}),
          createTexture: () => ({}),
          getExtension: () => null,
        };
        return new Proxy(baseGl, {
          get(target, prop) {
            if (prop in target) return target[prop];
            return () => {};
          },
        });
      }
      return null;
    },
  };
}

// IndexedDB in-memory mock supporting 'onsuccess' in r and IDBKeyRange.bound
const idbStores = { worlds: new Map(), chunks: new Map() };
const indexedDBMock = {
  open: () => {
    const req = { onupgradeneeded: null, onsuccess: null, onerror: null, result: null };
    setImmediate(() => {
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => ({ createIndex: () => {} }),
        transaction: (_names, _mode) => {
          const tx = {
            oncomplete: null,
            onerror: null,
            objectStore: (name) => {
              const map = idbStores[name];
              return {
                put: (val, explicitKey) => {
                  const key = explicitKey !== undefined ? explicitKey : (name === 'worlds' ? val.id : val.key);
                  map.set(key, structuredClone(val));
                  const r = { onsuccess: null, onerror: null, result: key };
                  setImmediate(() => {
                    if (r.onsuccess) r.onsuccess({ target: r });
                    if (tx.oncomplete) tx.oncomplete();
                  });
                  return r;
                },
                get: (key) => {
                  const r = { onsuccess: null, onerror: null, result: structuredClone(map.get(key)) };
                  setImmediate(() => {
                    if (r.onsuccess) r.onsuccess({ target: r });
                    if (tx.oncomplete) tx.oncomplete();
                  });
                  return r;
                },
                getAll: () => {
                  const r = { onsuccess: null, onerror: null, result: [...map.values()].map(v => structuredClone(v)) };
                  setImmediate(() => {
                    if (r.onsuccess) r.onsuccess({ target: r });
                    if (tx.oncomplete) tx.oncomplete();
                  });
                  return r;
                },
                delete: (keyOrRange) => {
                  if (keyOrRange && keyOrRange._lower !== undefined) {
                    for (const k of [...map.keys()]) {
                      if (k >= keyOrRange._lower && k <= keyOrRange._upper) map.delete(k);
                    }
                  } else {
                    map.delete(keyOrRange);
                  }
                  const r = { onsuccess: null, onerror: null };
                  setImmediate(() => {
                    if (r.onsuccess) r.onsuccess({ target: r });
                    if (tx.oncomplete) tx.oncomplete();
                  });
                  return r;
                },
                openCursor: (range) => {
                  const entries = [...map.entries()].filter(([k]) => {
                    if (!range) return true;
                    if (range._lower !== undefined) return k >= range._lower && k <= range._upper;
                    return true;
                  });
                  let idx = 0;
                  const r = { onsuccess: null, onerror: null, result: null };
                  const step = () => {
                    if (idx < entries.length) {
                      const [k, v] = entries[idx++];
                      r.result = {
                        key: k,
                        value: structuredClone(v),
                        delete: () => map.delete(k),
                        continue: () => setImmediate(step),
                      };
                      if (r.onsuccess) r.onsuccess({ target: r });
                    } else {
                      r.result = null;
                      if (r.onsuccess) r.onsuccess({ target: r });
                      if (tx.oncomplete) tx.oncomplete();
                    }
                  };
                  setImmediate(step);
                  return r;
                },
              };
            },
          };
          return tx;
        },
      };
      req.result = db;
      if (req.onsuccess) req.onsuccess({ target: req });
    });
    return req;
  },
};

const blobStore = new Map();
class MockBlob {
  constructor(parts) { this.code = parts.join(''); }
}
class MockWorker {
  constructor(url) {
    const blob = blobStore.get(url);
    if (!blob) throw new Error('Invalid Blob URL: ' + url);
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
    const selfRef = this;
    this.workerCtx = vm.createContext({
      console,
      Math,
      Date,
      Uint8Array,
      Uint16Array,
      Uint32Array,
      Int8Array,
      Int16Array,
      Int32Array,
      Float32Array,
      Float64Array,
      ArrayBuffer,
      DataView,
      Map,
      Set,
      Object,
      Array,
      String,
      Number,
      Boolean,
      Error,
      JSON,
      self: {
        postMessage(data) {
          if (selfRef.terminated) return;
          setImmediate(() => {
            if (!selfRef.terminated && selfRef.onmessage) {
              selfRef.onmessage({ data });
            }
          });
        },
      },
    });
    vm.runInContext(blob.code, this.workerCtx, { filename: 'inline-blob-worker.js' });
  }
  postMessage(data) {
    if (this.terminated) return;
    setImmediate(() => {
      if (this.terminated) return;
      try {
        if (this.workerCtx.self.onmessage) {
          this.workerCtx.self.onmessage({ data });
        }
      } catch (err) {
        if (this.onerror) this.onerror(err);
      }
    });
  }
  terminate() { this.terminated = true; }
}

const sandbox = vm.createContext({
  console,
  Math,
  Date,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 1,
  Uint8Array,
  Uint8ClampedArray,
  Uint16Array,
  Uint32Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Float32Array,
  Float64Array,
  ArrayBuffer,
  DataView,
  Map,
  Set,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Error,
  Promise,
  JSON,
  atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
  btoa: (bin) => Buffer.from(bin, 'binary').toString('base64'),
  Blob: MockBlob,
  URL: {
    createObjectURL: (blob) => {
      const u = 'blob:mock-' + Math.random().toString(36).slice(2);
      blobStore.set(u, blob);
      return u;
    },
    revokeObjectURL: () => {},
  },
  Worker: MockWorker,
  indexedDB: indexedDBMock,
  IDBKeyRange: {
    only: (v) => ({ _only: v }),
    bound: (lower, upper) => ({ _lower: lower, _upper: upper }),
  },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, length: 0 },
  AudioContext: function() {},
  webkitAudioContext: function() {},
  Image: class {
    set src(_v) {
      this.width = 256;
      this.height = 256;
      setImmediate(() => { if (this.onload) this.onload(); });
    }
  },
  document: {
    getElementById: () => makeCanvasMock(800, 600),
    createElement: (tag) => tag === 'canvas' ? makeCanvasMock(256, 256) : {
      style: {},
      value: '',
      focus: () => {},
      blur: () => {},
      click: () => {},
      remove: () => {},
      addEventListener: () => {},
    },
    body: { appendChild: () => {}, removeChild: () => {} },
    addEventListener: () => {},
    pointerLockElement: null,
    exitPointerLock: () => {},
  },
});
sandbox.window = sandbox;

for (const rel of scriptMatches) {
  if (rel.endsWith('main.js')) continue; // Don't auto-run window.onload loop yet
  const code = fs.readFileSync(path.join(GAME_DIR, rel), 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}

(async () => {
  const testCode = `
    (async () => {
      await DB.open();
      const game = new Game();
      game.settings.renderDist = 2;
      window.game = game;
      game.canvas = document.getElementById('gl');
      game.renderer = new Renderer(game.canvas);
      await game.renderer.init();
      Font.init(game.renderer.images.font);
      game.renderer.buildIcons();
      game.worker = new WorldWorker(game);
      game.ui = new UI(game, document.getElementById('ui'));
      game.particles = new Particles(game);

      // Wait for Worker bootstrap handshake
      await new Promise(r => setTimeout(r, 50));
      if (!game.worker.isReady()) throw new Error('Worker failed to become ready: ' + game.worker.fallbackReason);

      // ---- Test 1: W0-A & W2 Block IDs (512..527) & compact iconIdx ----
      const expectedBlocks = {
        512: 'prismarine_bricks',
        513: 'hopper',
        514: 'comparator',
        515: 'observer',
        516: 'piston',
        517: 'sticky_piston',
        518: 'piston_head',
        519: 'cherry_log',
        520: 'cherry_leaves',
        521: 'cherry_sapling',
        522: 'pink_petals',
        523: 'cherry_slab',
        524: 'cherry_stairs',
        525: 'cherry_door',
        526: 'cherry_fence',
        527: 'brewing_stand',
      };
      for (const [idStr, key] of Object.entries(expectedBlocks)) {
        const id = Number(idStr);
        if (!BLOCKS[id] || BLOCKS[id].key !== key) {
          throw new Error('Block ID mismatch at ' + id + ': expected ' + key + ', got ' + (BLOCKS[id] && BLOCKS[id].key));
        }
        if (id !== 518 && (!ITEMS[id] || ITEMS[id].iconIdx >= 400)) {
          throw new Error('Compact iconIdx failed for block ' + id + ' (' + key + ')');
        }
      }

      // ---- Test 2: W0-C Worker Generate & Mesh + Transferable Safety ----
      await game.createWorld('VerifyWorld', '12345', 'survival', false);
      for (let i = 0; i < 12; i++) {
        game.updateChunks(16);
        await new Promise(r => setTimeout(r, 10));
      }
      game.state = 'play';
      const pcx = Math.floor(game.player.pos[0]) >> 4, pcz = Math.floor(game.player.pos[2]) >> 4;
      const ch0 = game.world.getChunk(pcx, pcz);
      if (!ch0 || !(ch0.blocks instanceof Uint16Array) || ch0.blocks.byteLength !== 131072) {
        throw new Error('Spawn chunk not generated with Uint16Array(65536)');
      }
      const bx = pcx * 16 + 2, bz = pcz * 16 + 2;
      game.world.setBlock(bx, 80, bz, 512, 0);
      if (game.world.getBlock(bx, 80, bz) !== 512) throw new Error('High ID 512 setBlock failed');
      game.flushMesh(false);
      await new Promise(r => setTimeout(r, 25));
      if (ch0.blocks.byteLength !== 131072) throw new Error('ch0.blocks ArrayBuffer was detached during Worker mesh!');

      // ---- Test 3: W1 Villager 3-Profession Trading, Stock Lock, Daily Restock ----
      const farmer = new Mob(game, 'villager', bx + 2.5, 81, bz + 2.5);
      const librarian = new Mob(game, 'villager', bx + 4.5, 81, bz + 2.5);
      const smith = new Mob(game, 'villager', bx + 6.5, 81, bz + 2.5);
      Trading.ensureVillager(farmer, game, 'farmer');
      Trading.ensureVillager(librarian, game, 'librarian');
      Trading.ensureVillager(smith, game, 'smith');
      for (const t of librarian.trades) {
        if (t.result.ench) {
          for (const ek of Object.keys(t.result.ench)) {
            if (!ENCHANTS[ek]) throw new Error('Unregistered enchantment on librarian book: ' + ek);
          }
        }
      }
      const t0 = farmer.trades[0];
      for (let i = 0; i < t0.maxUses; i++) {
        let payA = { id: t0.costA.id, count: t0.costA.count, dmg: 0 }, payB = null;
        const ok = Trading.consumePayment(t0, () => payA, v => { payA = v; }, () => payB, v => { payB = v; }, farmer, game);
        if (!ok) throw new Error('Trade consumePayment failed at iteration ' + i);
      }
      if (!Trading.isOutOfStock(t0)) throw new Error('Trade should be out of stock after maxUses');
      game.worldTime += 24000;
      const restocked = Trading.checkRestock(farmer, game);
      if (!restocked || Trading.isOutOfStock(t0)) throw new Error('Villager daily restock failed');

      // ---- Test 4: W1 Hopper -> Furnace -> Hopper -> Chest Automation Loop ----
      const hx = bx + 4, hy = 85, hz = bz + 4;
      for (let dy = -1; dy <= 4; dy++) game.world.setBlock(hx, hy + dy, hz, 0, 0);
      game.world.setBlock(hx + 1, hy + 1, hz, 0, 0);
      game.world.setBlock(hx, hy + 2, hz, 513, 2);
      const topHopper = game.getBlockEntity(hx, hy + 2, hz, 'hopper');
      topHopper.slots[0] = makeStack('raw_iron', 2);
      game.world.setBlock(hx + 1, hy + 1, hz, 513, 0);
      const sideHopper = game.getBlockEntity(hx + 1, hy + 1, hz, 'hopper');
      sideHopper.slots[0] = makeStack('coal', 2);
      game.world.setBlock(hx, hy + 1, hz, 20, 2);
      const furnace = game.getBlockEntity(hx, hy + 1, hz, 'furnace');
      game.world.setBlock(hx, hy, hz, 513, 2);
      const botHopper = game.getBlockEntity(hx, hy, hz, 'hopper');
      game.world.setBlock(hx, hy - 1, hz, 52, 2);
      const outChest = game.getBlockEntity(hx, hy - 1, hz, 'chest');

      for (let t = 0; t < 260; t++) {
        game.tickHoppers();
        game.tickFurnaces();
      }
      const smeltedInChest = outChest.slots.find(s => s && s.id === item('iron_ingot'));
      if (!smeltedInChest || smeltedInChest.count < 1) {
        throw new Error('Hopper -> Furnace -> Hopper -> Chest automation failed!');
      }

      // ---- Test 5: W2 Redstone Comparator (ID 514) Container Fullness + Compare/Subtract Mode ----
      const cx = bx + 1, cy = 92, cz = bz + 1;
      for (let dx = -2; dx <= 4; dx++) for (let dz = -2; dz <= 4; dz++) {
        game.world.setBlock(cx + dx, cy - 1, cz + dz, 1, 0); // stone floor
        game.world.setBlock(cx + dx, cy, cz + dz, 0, 0);
      }
      // Place chest at (cx, cy, cz+1), Comparator at (cx, cy, cz) with rot=0 (input at +Z=cz+1, output at -Z=cz-1), Redstone Wire at (cx, cy, cz-1)
      game.world.setBlock(cx, cy, cz + 1, 52, 0);
      const compChest = game.getBlockEntity(cx, cy, cz + 1, 'chest');
      game.world.setBlock(cx, cy, cz, 514, 0);
      game.world.setBlock(cx, cy, cz - 1, 119, 0);

      // Empty chest => signal 0
      Redstone.updateComparator(game, cx, cy, cz);
      if (((game.world.getMeta(cx, cy, cz) >> 4) & 15) !== 0) throw new Error('Empty chest comparator should output 0');

      // 1 item in chest => signal 1
      compChest.slots[0] = makeStack('stone', 1);
      Redstone.updateComparatorsNear(game, cx, cy, cz + 1);
      if (((game.world.getMeta(cx, cy, cz) >> 4) & 15) !== 1 || (game.world.getMeta(cx, cy, cz - 1) & 15) !== 1) {
        throw new Error('1-item chest comparator should output 1 to front wire, got ' + (game.world.getMeta(cx, cy, cz - 1) & 15));
      }

      // Full chest (27 stacks of 64) => signal 15
      for (let i = 0; i < 27; i++) compChest.slots[i] = makeStack('stone', 64);
      Redstone.updateComparatorsNear(game, cx, cy, cz + 1);
      if (((game.world.getMeta(cx, cy, cz) >> 4) & 15) !== 15 || (game.world.getMeta(cx, cy, cz - 1) & 15) !== 15) {
        throw new Error('Full chest comparator should output 15');
      }

      // Half chest (13.5 stacks => 13 full stacks + 32 items => ratio = 13.5/27 = 0.5 => 1 + floor(0.5 * 14) = 8)
      for (let i = 0; i < 27; i++) compChest.slots[i] = i < 13 ? makeStack('stone', 64) : (i === 13 ? makeStack('stone', 32) : null);
      Redstone.updateComparatorsNear(game, cx, cy, cz + 1);
      const halfSig = (game.world.getMeta(cx, cy, cz) >> 4) & 15;
      if (halfSig !== 8) throw new Error('Half-full chest comparator expected 8, got ' + halfSig);

      // Side input test: place Redstone wire at (cx+1, cy, cz) with power 5 (via a torch at cx+1, cy, cz+11? Or repeater/comparator)
      // Let's place another chest + comparator feeding into the side of our main comparator!
      game.world.setBlock(cx + 2, cy, cz, 52, 0);
      const sideChest = game.getBlockEntity(cx + 2, cy, cz, 'chest');
      // 6 full stacks in sideChest => 1 + floor((6/27)*14) = 1 + 3 = 4
      for (let i = 0; i < 6; i++) sideChest.slots[i] = makeStack('stone', 64);
      // Side comparator at (cx+1, cy, cz) with rot=3 (input at +X=cx+2, output at -X=cx)
      game.world.setBlock(cx + 1, cy, cz, 514, 3);
      Redstone.updateComparator(game, cx + 1, cy, cz);
      const sideSig = (game.world.getMeta(cx + 1, cy, cz) >> 4) & 15;
      if (sideSig !== 4) throw new Error('Side comparator expected 4, got ' + sideSig);

      // In Compare mode (bit 4 === 0): rear=8 >= side=4 => output 8
      Redstone.updateComparator(game, cx, cy, cz);
      if (((game.world.getMeta(cx, cy, cz) >> 4) & 15) !== 8) throw new Error('Compare mode 8 vs 4 should output 8');

      // Switch to Subtract mode (bit 4 === 4): rear=8, side=4 => output 8 - 4 = 4
      game.world.setMeta(cx, cy, cz, (game.world.getMeta(cx, cy, cz) & ~4) | 4);
      Redstone.updateComparator(game, cx, cy, cz);
      if (((game.world.getMeta(cx, cy, cz) >> 4) & 15) !== 4 || (game.world.getMeta(cx, cy, cz - 1) & 15) !== 4) {
        throw new Error('Subtract mode (8 - 4) should output 4, got ' + ((game.world.getMeta(cx, cy, cz) >> 4) & 15));
      }

      // ---- Test 6: W2 Pistons (516/517), 12-block limit, Guard Rule #4 Blacklist, & Harvester Loop ----
      const px = bx + 1, py = 100, pz = bz + 8;
      for (let dx = -3; dx <= 16; dx++) for (let dz = -3; dz <= 6; dz++) {
        game.world.setBlock(px + dx, py - 1, pz + dz, 1, 0);
        for (let dy = 0; dy <= 4; dy++) game.world.setBlock(px + dx, py + dy, pz + dz, 0, 0);
      }

      // 6a. Push 12 blocks of stone (+X direction, dir=1)
      game.world.setBlock(px, py, pz, 516, 1); // Piston facing +X
      for (let i = 1; i <= 12; i++) game.world.setBlock(px + i, py, pz, 1, 0);
      game.world.setBlock(px - 1, py, pz, 120, 0); // Redstone torch behind piston
      if (!(game.world.getMeta(px, py, pz) & 8) || game.world.getBlock(px + 1, py, pz) !== 518 || game.world.getBlock(px + 13, py, pz) !== 1) {
        throw new Error('Piston should push 12 blocks of stone');
      }
      // Retract piston
      game.world.setBlock(px - 1, py, pz, 0, 0);
      if ((game.world.getMeta(px, py, pz) & 8) !== 0 || game.world.getBlock(px + 1, py, pz) !== 0) {
        throw new Error('Normal piston failed to retract');
      }

      // 6b. 13 blocks in front => must NOT push (> 12 limit)
      for (let i = 1; i <= 13; i++) game.world.setBlock(px + i, py, pz, 1, 0);
      game.world.setBlock(px - 1, py, pz, 120, 0);
      if ((game.world.getMeta(px, py, pz) & 8) !== 0) {
        throw new Error('Piston must NOT push 13 blocks (exceeds 12-block limit)');
      }
      game.world.setBlock(px - 1, py, pz, 0, 0);
      for (let i = 1; i <= 14; i++) game.world.setBlock(px + i, py, pz, 0, 0);

      // 6c. Guard Rule #4 Blacklist: Obsidian (28), Chest (52), Furnace (20), Hopper (513), Brewing Stand (527), Enchanting Table (185), Anvil (186)
      for (const blkId of [28, 6, 52, 20, 513, 527, 185, 186]) {
        game.world.setBlock(px + 1, py, pz, blkId, 0);
        game.world.setBlock(px - 1, py, pz, 120, 0);
        if ((game.world.getMeta(px, py, pz) & 8) !== 0) {
          throw new Error('Piston violated Guard Rule #4 blacklist by pushing block ID ' + blkId);
        }
        game.world.setBlock(px - 1, py, pz, 0, 0);
        game.world.setBlock(px + 1, py, pz, 0, 0);
      }

      // 6d. Sticky Piston (517) push & pull-back 1 block
      game.world.setBlock(px, py, pz, 517, 1); // Sticky Piston facing +X
      game.world.setBlock(px + 1, py, pz, 4, 0); // Cobblestone at +1
      game.world.setBlock(px - 1, py, pz, 120, 0); // Power ON -> pushes cobblestone to +2
      if (game.world.getBlock(px + 1, py, pz) !== 518 || game.world.getBlock(px + 2, py, pz) !== 4) {
        throw new Error('Sticky piston failed to push cobblestone to +2');
      }
      game.world.setBlock(px - 1, py, pz, 0, 0); // Power OFF -> pulls cobblestone back to +1
      if ((game.world.getMeta(px, py, pz) & 8) !== 0 || game.world.getBlock(px + 1, py, pz) !== 4 || game.world.getBlock(px + 2, py, pz) !== 0) {
        throw new Error('Sticky piston failed to pull cobblestone back to +1');
      }

      // 6e. End-to-End "Observer + Piston + Hopper" Automatic Sugar Cane Harvester
      const gx = px + 2, gy = py, gz = pz + 3;
      // Dirt at (gx, gy-1, gz) with water at (gx+1, gy-1, gz), base Sugar Cane at (gx, gy, gz)
      game.world.setBlock(gx, gy - 1, gz, 3, 0);
      game.world.setBlock(gx + 1, gy - 1, gz, WATER, 0);
      game.world.setBlock(gx, gy, gz, 38, 0);
      // Hopper at (gx, gy-1, gz-1) pointing into Chest at (gx, gy-1, gz-2) (or hopper right next to sugar cane at gy)
      // Place Hopper at (gx+1, gy, gz) pointing down into Chest at (gx+1, gy-1, gz+1)? Let's put Hopper at (gx, gy, gz+1) pointing into Chest at (gx, gy, gz+2)
      game.world.setBlock(gx, gy, gz + 2, 52, 0);
      const harvestChest = game.getBlockEntity(gx, gy, gz + 2, 'chest');
      game.world.setBlock(gx, gy, gz + 1, 513, 5); // Hopper pointing +Z (dir 5) into harvestChest
      const harvestHopper = game.getBlockEntity(gx, gy, gz + 1, 'hopper');

      // Piston at (gx-1, gy+1, gz) facing +X (dir 1) to push/break middle sugar cane at (gx, gy+1, gz)
      game.world.setBlock(gx - 1, gy + 1, gz, 516, 1);
      // Observer at (gx-1, gy+2, gz) facing +X (dir 1) watching (gx, gy+2, gz)
      game.world.setBlock(gx - 1, gy + 2, gz, 515, 1);
      // Solid stone behind Observer at (gx-2, gy+2, gz) and Redstone Wire at (gx-2, gy+1, gz) behind Piston (with stone at gx-2, gy, gz)
      game.world.setBlock(gx - 2, gy, gz, 1, 0);
      game.world.setBlock(gx - 2, gy + 1, gz, 119, 0);
      game.world.setBlock(gx - 2, gy + 2, gz, 1, 0);
      // Clear any initial scheduled pulse from placing blocks around the observer
      for (let t = 0; t < 6; t++) { game.worldTime++; game.world.time++; game.world.tickScheduled(); }
      game.entities = game.entities.filter(e => !(e instanceof ItemEntity));

      // Now Sugar Cane grows to height 2 (gy+1) and then height 3 (gy+2)
      game.world.setBlock(gx, gy + 1, gz, 38, 0);
      game.world.setBlock(gx, gy + 2, gz, 38, 0);
      // Tick 1: Observer scheduled tick fires 15-strength pulse -> powers stone at (gx-2,gy+2,gz) -> powers wire at (gx-2,gy+1,gz) -> Piston extends and breaks sugar cane at gy+1 & gy+2!
      game.worldTime++; game.world.time++; game.world.tickScheduled();
      if (game.world.getBlock(gx, gy + 1, gz) !== 518) {
        throw new Error('Harvester piston should have extended into (gx, gy+1, gz) on Observer pulse');
      }
      // Tick 2..4: Pulse ends -> Piston retracts; dropped sugar_cane items fall near Hopper
      for (let t = 0; t < 4; t++) { game.worldTime++; game.world.time++; game.world.tickScheduled(); }
      if ((game.world.getMeta(gx - 1, gy + 1, gz) & 8) !== 0) {
        throw new Error('Harvester piston should have retracted after 2-tick Observer pulse');
      }
      // Move dropped sugar_cane ItemEntities over the hopper capture zone (gx+0.5, gy+1.1, gz+1.5) and tick Hoppers
      const caneDrops = game.entities.filter(e => e instanceof ItemEntity && e.stack.id === item('sugar_cane'));
      if (caneDrops.length < 1) throw new Error('Expected broken sugar cane to drop as ItemEntity');
      for (const d of caneDrops) { d.pos = [gx + 0.5, gy + 1.1, gz + 1.5]; }
      for (let t = 0; t < 20; t++) game.tickHoppers();
      const harvestedCane = harvestChest.slots.find(s => s && s.id === item('sugar_cane'));
      if (!harvestedCane || harvestedCane.count < 1) {
        throw new Error('Observer + Piston + Hopper harvester failed to collect sugar cane into chest!');
      }

      // ---- Test 7: 1.20 Cherry Grove Biome, Cherry Tree, Petals & Recipes ----
      if (BI.CHERRY_GROVE !== 12 || BIOMES[12] !== '樱花树林') throw new Error('Missing BI.CHERRY_GROVE');
      const testBiome = game.world.biomeOf({ temp: 0.45, humid: 0.55, h: 86, river: 0, cont: 0.4, mount: 0.5 });
      if (testBiome !== BI.CHERRY_GROVE) throw new Error('High-altitude temperate/humid column should resolve to BI.CHERRY_GROVE');

      // Grow cherry sapling (521)
      const tx = px + 10, ty = py, tz = pz + 3;
      game.world.setBlock(tx, ty - 1, tz, 2, 0);
      game.world.setBlock(tx, ty, tz, 521, 0);
      if (!game.growTree(tx, ty, tz, 521)) throw new Error('growTree failed for cherry_sapling (521)');
      if (game.world.getBlock(tx, ty, tz) !== 519) throw new Error('Cherry tree trunk should be cherry_log (519)');
      let foundCherryLeaves = false;
      for (let dy = 2; dy <= 7; dy++) for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        if (game.world.getBlock(tx + dx, ty + dy, tz + dz) === 520) foundCherryLeaves = true;
      }
      if (!foundCherryLeaves) throw new Error('Cherry tree should generate cherry_leaves (520) canopy');

      // Spawn cherry_petal particle
      const petalP = game.particles.spawn('cherry_petal', tx + 0.5, ty + 3, tz + 0.5, 0, -0.02, 0);
      if (!petalP || petalP.type !== 'cherry_petal') throw new Error('Failed to spawn cherry_petal particle');

      // Verify Cherry wood & Redstone & Brewing crafting recipes
      const checkCraft = (grid3x3, expectedKey) => {
        const g = grid3x3.map(k => k ? { id: item(k), count: 1 } : null);
        const m = matchRecipe(g, 3);
        if (!m || m.result !== item(expectedKey)) {
          throw new Error('Crafting recipe failed for ' + expectedKey + ', got ' + (m && ITEMS[m.result] && ITEMS[m.result].key));
        }
      };
      checkCraft(['cherry_log', null, null, null, null, null, null, null, null], 'cherry_planks');
      checkCraft(['cherry_planks', 'cherry_planks', 'cherry_planks', null, null, null, null, null, null], 'cherry_slab');
      checkCraft(['cherry_planks', null, null, 'cherry_planks', 'cherry_planks', null, 'cherry_planks', 'cherry_planks', 'cherry_planks'], 'cherry_stairs');
      checkCraft(['cherry_planks', 'cherry_planks', null, 'cherry_planks', 'cherry_planks', null, 'cherry_planks', 'cherry_planks', null], 'cherry_door');
      checkCraft(['cherry_planks', 'stick', 'cherry_planks', 'cherry_planks', 'stick', 'cherry_planks', null, null, null], 'cherry_fence');
      checkCraft([null, 'redstone_torch', null, 'redstone_torch', 'quartz_block', 'redstone_torch', 'stone', 'stone', 'stone'], 'comparator');
      checkCraft(['cobblestone', 'cobblestone', 'cobblestone', 'redstone', 'redstone', 'quartz_block', 'cobblestone', 'cobblestone', 'cobblestone'], 'observer');
      checkCraft(['oak_planks', 'oak_planks', 'oak_planks', 'cobblestone', 'iron_ingot', 'cobblestone', 'cobblestone', 'redstone', 'cobblestone'], 'piston');
      checkCraft(['magma_cream', null, null, 'piston', null, null, null, null, null], 'sticky_piston');
      checkCraft([null, 'blaze_rod', null, 'cobblestone', 'cobblestone', 'cobblestone', null, null, null], 'brewing_stand');

      // ---- Test 8: Brewing Stand (527) + 4 Core Potions + HUD Status Effects + Save/Load Persistence ----
      const bwx = bx + 8, bwy = 85, bwz = bz + 8;
      game.world.setBlock(bwx, bwy, bwz, 527, 0);
      const brewBe = game.getBlockEntity(bwx, bwy, bwz, 'brewing');
      brewBe.fuel = makeStack('blaze_powder', 1);
      brewBe.ingredient = makeStack('nether_wart', 1);
      brewBe.bottles = [makeStack('water_bottle', 1), makeStack('water_bottle', 1), makeStack('water_bottle', 1)];

      for (let t = 0; t < 400; t++) game.tickBrewingStands();
      if (!brewBe.bottles.every(b => b && b.id === item('awkward_potion'))) {
        throw new Error('Step 1 brewing (water_bottle + nether_wart -> awkward_potion) failed');
      }

      // Brew Instant Healing, Fire Resistance, Swiftness, Night Vision
      const potionTests = [
        ['glistering_melon_slice', 'potion_healing'],
        ['magma_cream', 'potion_fire_resistance'],
        ['sugar', 'potion_swiftness'],
        ['golden_carrot', 'potion_night_vision'],
      ];
      for (const [ingKey, potKey] of potionTests) {
        brewBe.bottles = [makeStack('awkward_potion', 1), null, null];
        brewBe.ingredient = makeStack(ingKey, 1);
        for (let t = 0; t < 400; t++) game.tickBrewingStands();
        if (!brewBe.bottles[0] || brewBe.bottles[0].id !== item(potKey)) {
          throw new Error('Brewing ' + ingKey + ' -> ' + potKey + ' failed');
        }
      }

      // Test drinking Instant Healing (+8 HP)
      game.player.health = 10;
      game.player.inv.slots[0] = makeStack('potion_healing', 1);
      game.player.inv.sel = 0;
      game.finishDrinking(game.player.inv.held);
      if (game.player.health !== 18 || game.player.inv.slots[0].id !== item('glass_bottle')) {
        throw new Error('Instant healing potion should restore +8 HP and leave glass_bottle');
      }

      // Apply Fire Resistance, Swiftness, and Night Vision
      game.player.applyEffect('fire_resistance', 3600, 1);
      game.player.applyEffect('speed', 3600, 1);
      game.player.applyEffect('night_vision', 3600, 1);
      if (!game.player.hasEffect('fire_resistance') || !game.player.hasEffect('speed') || !game.player.hasEffect('night_vision')) {
        throw new Error('Player status effects not active');
      }
      // Verify fire_resistance blocks lava/fire damage
      const hpBeforeFire = game.player.health;
      game.player.hurt(4, { type: 'lava' });
      game.player.hurt(2, { type: 'fire' });
      if (game.player.health !== hpBeforeFire) {
        throw new Error('fire_resistance should prevent lava and fire damage');
      }
      // Verify night_vision boosts night brightness in env()
      game.worldTime = 18000; // midnight
      const nightEnv = game.env(0);
      if (nightEnv.day < 0.9) throw new Error('night_vision should boost midnight env.day >= 0.9, got ' + nightEnv.day);

      // Test BrewingScreen & HUD status effects drawing
      game.ui.open(new BrewingScreen(game, brewBe));
      game.ui.draw();
      game.ui.close();

      // ---- Test 9: Save / Export / Import Round-Trip (including Player Status Effects) ----
      game.entities.push(farmer);
      await game.saveWorld(true);
      const exported = await game.exportWorld(game.worldMeta.id);
      if (!exported.world.player.effects || !exported.world.player.effects.fire_resistance) {
        throw new Error('Exported world JSON missing persisted player.effects');
      }
      const importedMeta = await game.importWorldData(JSON.stringify(exported));
      if (!importedMeta || !importedMeta.id) throw new Error('World export/import round-trip failed');
      await game.loadWorld(importedMeta.id);
      if (!game.player.hasEffect('fire_resistance') || !game.player.hasEffect('speed') || !game.player.hasEffect('night_vision')) {
        throw new Error('Player status effects failed to persist across loadWorld');
      }

      // ---- Test 9b: Regression Checks for 5 Audit Bugs (Armor 3D, onNeighborUpdate null guard, Smith trades, Book 3D preview) ----
      // 1) onNeighborUpdate with id=0 (air) and id=999 (unregistered) must never throw TypeError
      game.onNeighborUpdate(bx, 80, bz, 0);
      game.onNeighborUpdate(bx, 80, bz, 999);
      // 2) Setting v.profession = 'smith' AFTER new Mob() must rebuild Smith trade table (coal, raw_iron, iron_pickaxe...)
      const lateSmith = new Mob(game, 'villager', bx + 1.5, 81, bz + 3.5);
      lateSmith.profession = 'smith';
      Trading.ensureVillager(lateSmith, game);
      if (!lateSmith.trades[0] || lateSmith.trades[0].costA.id !== item('coal')) {
        throw new Error('Smith villager loaded wrong trade table: first costA=' + (lateSmith.trades[0] && lateSmith.trades[0].costA.id));
      }
      // 3) 3D Armor models & textures must exist and render in playerPreview & drawPlayerArmor
      for (const mk of ['armor_helmet', 'armor_chestplate', 'armor_leggings', 'armor_boots']) {
        if (!game.renderer.models[mk]) throw new Error('Missing 3D armor model: ' + mk);
      }
      for (const tk of ['armor_leather_1', 'armor_leather_2', 'armor_iron_1', 'armor_iron_2', 'armor_diamond_1', 'armor_diamond_2']) {
        if (!game.renderer.entityTex[tk]) throw new Error('Missing 3D armor texture: ' + tk);
      }
      game.player.inv.slots[36] = makeStack('diamond_helmet', 1);
      game.player.inv.slots[37] = makeStack('diamond_chestplate', 1);
      game.player.inv.slots[38] = makeStack('diamond_leggings', 1);
      game.player.inv.slots[39] = makeStack('diamond_boots', 1);
      game.renderer.drawPlayerArmor(game.player, M4.create(), {}, [1, 0], { day: 1, fogColor: [0,0,0], fogNear: 100, fogFar: 200, nightTint: [1,1,1] });

      // ---- Test 10: Worker Fallback to Main Thread ----
      game.worker._enterFallback('manual test fallback');
      if (game.worker.isReady()) throw new Error('Worker should report not ready in fallback mode');
      game.world.setBlock(bx + 1, 80, bz + 1, 513, 2);
      game.flushMesh(false);
      return {
        blocksCount: BLOCKS.filter(Boolean).length,
        itemsCount: ITEMS.filter(Boolean).length,
        farmerLevel: farmer.level,
        smeltedCount: smeltedInChest.count,
        harvestedSugarCane: harvestedCane.count,
        activeEffects: Object.keys(game.player.effects),
      };
    })()
  `;
  const res = await vm.runInContext(testCode, sandbox);
  console.log('[PASS] Full runtime verification passed:', JSON.stringify(res));
})().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
