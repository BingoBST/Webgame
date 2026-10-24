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
  addEventListener: () => {},
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
  // Load main.js too (window.addEventListener is mocked as no-op) so playerPreview & bookPreview are tested // Don't auto-run window.onload loop yet
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
        528: 'nether_portal',
        529: 'netherrack',
        530: 'soul_sand',
        531: 'nether_quartz_ore',
        532: 'nether_gold_ore',
        533: 'nether_bricks',
        534: 'nether_brick_fence',
        535: 'nether_brick_stairs',
        536: 'nether_wart_crop',
        537: 'fire',
      };
      for (const [idStr, key] of Object.entries(expectedBlocks)) {
        const id = Number(idStr);
        if (!BLOCKS[id] || BLOCKS[id].key !== key) {
          throw new Error('Block ID mismatch at ' + id + ': expected ' + key + ', got ' + (BLOCKS[id] && BLOCKS[id].key));
        }
        if (id !== 518 && id !== 528 && id !== 536 && id !== 537 && (!ITEMS[id] || ITEMS[id].iconIdx >= 400)) {
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
      game.loadChunk(pcx, pcz);
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

      // ---- Test 10: Step 6 Underwater Sprint Swimming Pose & Shield Blocking ----
      // 10a. Underwater Sprint Swimming Pose + Pitch-Directed Ascent/Descent
      const swx = bx + 2, swy = 105, swz = bz + 2;
      for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 3; dy++) for (let dz = -2; dz <= 2; dz++) {
        game.world.setBlock(swx + dx, swy + dy, swz + dz, WATER, 0);
      }
      game.player.pos = [swx + 0.5, swy + 0.5, swz + 0.5];
      game.player.prev = [...game.player.pos];
      game.player.vel = [0, 0, 0];
      game.player.yaw = 0; // looking -Z
      game.player.pitch = 0;
      game.player.flying = false;
      game.player.tick({ fwd: 1, strafe: 0, jump: false, sneak: false, sprint: true });
      if (!game.player.inWater || !game.player.swimming) {
        throw new Error('Player should enter swimming state when sprinting forward in water');
      }
      if (Math.abs(game.player.h - 0.6) > 1e-4 || Math.abs(game.player.eye() - 0.45) > 1e-4) {
        throw new Error('Swimming player should have prone hitbox h=0.6 and eye=0.45');
      }
      for (let i = 0; i < 6; i++) game.player.tick({ fwd: 1, strafe: 0, jump: false, sneak: false, sprint: true });
      const swimPose = game.playerPose(1);
      if (!swimPose || swimPose.bodyPitch > -0.5) {
        throw new Error('Third-person swimming pose should pitch body horizontally, got bodyPitch=' + (swimPose && swimPose.bodyPitch));
      }
      // Pitch UP (+0.65 rad) => should ascend (vel[1] > 0)
      game.player.pos = [swx + 0.5, swy + 0.5, swz + 0.5];
      game.player.vel = [0, 0, 0];
      game.player.pitch = 0.65;
      for (let i = 0; i < 3; i++) game.player.tick({ fwd: 1, strafe: 0, jump: false, sneak: false, sprint: true });
      const ascendVy = game.player.vel[1];
      if (ascendVy <= 0.04) throw new Error('Swimming while looking up should ascend (vel[1] > 0.04), got ' + ascendVy);

      // Pitch DOWN (-0.65 rad) => should dive (vel[1] < 0)
      game.player.pos = [swx + 0.5, swy + 1.2, swz + 0.5];
      game.player.vel = [0, 0, 0];
      game.player.pitch = -0.65;
      for (let i = 0; i < 3; i++) game.player.tick({ fwd: 1, strafe: 0, jump: false, sneak: false, sprint: true });
      const diveVy = game.player.vel[1];
      if (diveVy >= -0.04) throw new Error('Swimming while looking down should dive (vel[1] < -0.04), got ' + diveVy);

      // 10a-2. Official MC 1-block-high tunnel ceiling restriction:
      // Place solid stone floor at swy-1, water at swy, and solid stone ceiling at swy+1 (1-block-high tunnel)
      for (let dz = -2; dz <= 2; dz++) {
        game.world.setBlock(swx, swy - 1, swz + dz, 1, 0);
        game.world.setBlock(swx, swy, swz + dz, WATER, 0);
        game.world.setBlock(swx, swy + 1, swz + dz, 1, 0);
      }
      game.player.pos = [swx + 0.5, swy + 0.05, swz + 0.5];
      game.player.prev = [...game.player.pos];
      game.player.vel = [0, 0, 0];
      game.player.pitch = 0;
      // Enter sprint-swimming in the 1-block tunnel
      game.player.tick({ fwd: 1, strafe: 0, jump: false, sneak: false, sprint: true });
      if (!game.player.swimming || !game.player.sprinting || Math.abs(game.player.h - 0.6) > 1e-4) {
        throw new Error('Should sprint-swim inside 1-block tunnel');
      }
      // Release Sprint (sprint: false, fwd: 1) inside 1-block tunnel -> MUST stay prone (swimming=true, h=0.6, eye=0.45) in slow-swim mode (sprinting=false) and NOT clip into ceiling!
      game.player.tick({ fwd: 1, strafe: 0, jump: false, sneak: false, sprint: false });
      if (!game.player.swimming || game.player.sprinting || Math.abs(game.player.h - 0.6) > 1e-4 || Math.abs(game.player.eye() - 0.45) > 1e-4) {
        throw new Error('Releasing sprint inside 1-block tunnel must keep swimming=true (h=0.6, eye=0.45) and switch to slow swim (sprinting=false)');
      }
      if (game.player.collides(game.player.box())) {
        throw new Error('Player box collided with ceiling inside 1-block tunnel!');
      }
      // Also release Forward (sprint: false, fwd: 0) inside 1-block tunnel -> MUST still stay prone (h=0.6) under the ceiling!
      game.player.tick({ fwd: 0, strafe: 0, jump: false, sneak: false, sprint: false });
      if (!game.player.swimming || Math.abs(game.player.h - 0.6) > 1e-4) {
        throw new Error('Stopping inside 1-block tunnel must keep h=0.6 and not stand up into ceiling');
      }
      // Remove ceiling block above (open water) with sprint: false -> should now stand up to h=1.8!
      for (let dz = -2; dz <= 2; dz++) game.world.setBlock(swx, swy + 1, swz + dz, WATER, 0);
      game.player.tick({ fwd: 1, strafe: 0, jump: false, sneak: false, sprint: false });
      if (game.player.swimming || Math.abs(game.player.h - 1.8) > 1e-4) {
        throw new Error('In open water without ceiling, releasing sprint should return to standing h=1.8');
      }

      // Clean up water pool
      for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 3; dy++) for (let dz = -2; dz <= 2; dz++) {
        game.world.setBlock(swx + dx, swy + dy, swz + dz, 0, 0);
      }

      // 10b. Shield Crafting Recipe (6 Planks + 1 Iron Ingot)
      checkCraft(['oak_planks', 'iron_ingot', 'oak_planks', 'oak_planks', 'oak_planks', 'oak_planks', null, 'oak_planks', null], 'shield');
      checkCraft(['cherry_planks', 'iron_ingot', 'cherry_planks', 'cherry_planks', 'cherry_planks', 'cherry_planks', null, 'cherry_planks', null], 'shield');
      if (!game.renderer.models.shield || !game.renderer.entityTex.shield) {
        throw new Error('Missing 3D shield model or entity texture');
      }

      // 10c. Mainhand & Offhand Right-Click Shield Blocking (Melee, Arrow, Creeper Explosion)
      game.player.pos = [swx + 0.5, swy, swz + 0.5];
      game.player.prev = [...game.player.pos];
      game.player.vel = [0, 0, 0];
      game.player.yaw = 0; // looking North (-Z)
      game.player.pitch = 0;
      game.player.swimming = false;
      game.player.h = 1.8;
      game.player.health = 20;
      game.player.invuln = 0;
      game.target = null;
      game.targetEntity = null;

      // Equip Shield in Mainhand and right-click (use)
      game.player.inv.slots[0] = makeStack('shield', 1);
      game.player.inv.sel = 0;
      game.use();
      if (!game.player.isBlocking() || game.player.getActiveShield().hand !== 'main') {
        throw new Error('Right-clicking with shield in mainhand should activate mainhand shield blocking');
      }
      const sbBeforeMelee = Sound.shieldBlockCount || 0;
      const attackerMob = { pos: [swx + 0.5, swy, swz - 1.2], vel: [0, 0, 0], onGround: true };
      const meleeHurt = game.player.hurt(5, { type: 'mob', attacker: attackerMob, knockFrom: attackerMob.pos });
      if (meleeHurt !== false || game.player.health !== 20 || (Sound.shieldBlockCount || 0) <= sbBeforeMelee) {
        throw new Error('Mainhand shield should block frontal melee attack and play shieldBlock sound');
      }
      if (game.player.inv.slots[0].dmg <= 0) {
        throw new Error('Blocking melee attack should consume shield durability');
      }

      // Move Shield to Offhand (slot 40) with Sword in Mainhand, right-click (use)
      game.player.inv.slots[40] = game.player.inv.slots[0];
      game.player.inv.slots[0] = makeStack('diamond_sword', 1);
      game.player.usingItem = null;
      game.player.blocking = false;
      game.use();
      if (!game.player.isBlocking() || game.player.getActiveShield().hand !== 'offhand') {
        throw new Error('Right-clicking with sword in mainhand and shield in offhand should activate offhand shield blocking');
      }

      // Block Frontal Arrow with Offhand Shield
      const sbBeforeArrow = Sound.shieldBlockCount || 0;
      const testArrow = new Arrow(game, swx + 0.5, swy + 1.0, swz - 0.8, [0, 0, 0.9], null);
      for (let t = 0; t < 4; t++) testArrow.tick();
      if (game.player.health !== 20 || (Sound.shieldBlockCount || 0) <= sbBeforeArrow || testArrow.vel[2] >= 0) {
        throw new Error('Offhand shield should block and deflect frontal arrow');
      }

      // Block Frontal Creeper Explosion with Offhand Shield
      const sbBeforeExp = Sound.shieldBlockCount || 0;
      game.explode(swx + 0.5, swy + 0.5, swz - 1.5, 3, { T: MOB_TYPES.creeper, pos: [swx + 0.5, swy, swz - 1.5] }, true);
      if (game.player.health !== 20 || (Sound.shieldBlockCount || 0) <= sbBeforeExp) {
        throw new Error('Offhand shield should block frontal creeper explosion damage');
      }

      // Rear Attack (+Z, behind player looking -Z) must NOT be blocked
      const rearHurt = game.player.hurt(4, { type: 'mob', attacker: { pos: [swx + 0.5, swy, swz + 2.5], vel: [0, 0, 0] }, knockFrom: [swx + 0.5, swy, swz + 2.5] });
      if (rearHurt !== true || game.player.health >= 20) {
        throw new Error('Shield must NOT block attacks from behind the player');
      }

      // 10d. Verify third-person Shield 3D orientation in both IDLE and BLOCKING states
      game.player.pos = [0, 0, 0];
      game.player.yaw = 0;
      game.player.pitch = 0;
      game.player.swimAmt = 0;
      game.player.prevSwimAmt = 0;
      let capturedShieldMat = null;
      const origDrawModel = game.renderer.drawModel.bind(game.renderer);
      game.renderer.drawModel = function(name, texName, m, poses, light, env, opts) {
        if (name === 'shield') capturedShieldMat = new Float32Array(m);
        return origDrawModel(name, texName, m, poses, light, env, opts);
      };
      // Idle offhand shield (larm at x < 0): front normal (-z column = [-m[8], -m[9], -m[10]]) must point OUTWARD (-X), and handle (+z) must be closer to hand than plate (-z)
      game.player.blocking = false;
      game.player.usingItem = null;
      game.drawMob(game.player, [0, 0, 0], 1, game.env(0), [1, 0]);
      if (!capturedShieldMat) throw new Error('Shield model was not drawn in third-person');
      const idleFrontNormX = -capturedShieldMat[8];
      const idlePlateX = capturedShieldMat[12] + capturedShieldMat[8] * (-1.5 / 16);
      const idleHandleX = capturedShieldMat[12] + capturedShieldMat[8] * (2.0 / 16);
      if (idleFrontNormX > -0.5 || idleHandleX <= idlePlateX) {
        throw new Error('Offhand idle shield is backwards! frontNormX=' + idleFrontNormX + ', handleX=' + idleHandleX + ', plateX=' + idlePlateX);
      }
      // Blocking offhand shield: must be centered in front of torso (|plateX| < 0.15, plateZ < -0.35) with front normal pointing FORWARD (-Z, frontNormZ < -0.6)
      game.player.blocking = true;
      game.player.usingItem = item('shield');
      capturedShieldMat = null;
      game.drawMob(game.player, [0, 0, 0], 1, game.env(0), [1, 0]);
      const blkFrontNormZ = -capturedShieldMat[10];
      const blkPlateX = capturedShieldMat[12] + capturedShieldMat[8] * (-1.5 / 16);
      const blkPlateZ = capturedShieldMat[14] + capturedShieldMat[10] * (-1.5 / 16);
      const blkHandleZ = capturedShieldMat[14] + capturedShieldMat[10] * (2.0 / 16);
      if (Math.abs(blkPlateX) > 0.15 || blkPlateZ > -0.35 || blkFrontNormZ > -0.6 || blkHandleZ <= blkPlateZ) {
        throw new Error('Blocking shield not protecting front of torso! plateX=' + blkPlateX + ', plateZ=' + blkPlateZ + ', frontNormZ=' + blkFrontNormZ);
      }
      game.renderer.drawModel = origDrawModel;
      game.drawHand(1, game.env(0));

      // ---- Test 11: W3 Phase 1 Nether Dimension, Obsidian Portal, Nether Fortress, Nether Mobs & Wither Effect ----
      // 11a. Verify transitional W1 recipes for blaze_rod and nether_wart are removed, and genuine Nether recipes work
      const tryCraft = (grid3x3) => matchRecipe(grid3x3.map(k => k ? { id: item(k), count: 1 } : null), 3);
      if (tryCraft(['gold_ingot', null, null, 'magma_block', null, null, 'gold_ingot', null, null]) !== null) {
        throw new Error('Transitional blaze_rod crafting recipe should have been removed!');
      }
      if (tryCraft(['red_mushroom', 'redstone', null, null, null, null, null, null, null]) !== null) {
        throw new Error('Transitional nether_wart crafting recipe should have been removed!');
      }
      checkCraft(['quartz', 'quartz', null, 'quartz', 'quartz', null, null, null, null], 'quartz_block');
      checkCraft([null, 'redstone_torch', null, 'redstone_torch', 'quartz', 'redstone_torch', 'stone', 'stone', 'stone'], 'comparator');
      checkCraft(['cobblestone', 'cobblestone', 'cobblestone', 'redstone', 'redstone', 'quartz', 'cobblestone', 'cobblestone', 'cobblestone'], 'observer');
      checkCraft(['nether_brick', 'nether_brick', null, 'nether_brick', 'nether_brick', null, null, null, null], 'nether_bricks');
      checkCraft(['gold_nugget', 'gold_nugget', 'gold_nugget', 'gold_nugget', 'gold_nugget', 'gold_nugget', 'gold_nugget', 'gold_nugget', 'gold_nugget'], 'gold_ingot');

      // 11b. Build a 4x5 Obsidian frame in Overworld, ignite with flint_and_steel, and verify cascade break
      const opx = bx + 2, opy = 108, opz = bz + 2;
      for (let dx = -2; dx <= 5; dx++) for (let dy = -1; dy <= 6; dy++) for (let dz = -2; dz <= 2; dz++) {
        game.world.setBlock(opx + dx, opy + dy, opz + dz, 0, 0, 0);
      }
      for (let dx = 0; dx < 4; dx++) {
        game.world.setBlock(opx + dx, opy, opz, 28, 0, 0);
        game.world.setBlock(opx + dx, opy + 4, opz, 28, 0, 0);
      }
      for (let dy = 1; dy <= 3; dy++) {
        game.world.setBlock(opx, opy + dy, opz, 28, 0, 0);
        game.world.setBlock(opx + 3, opy + dy, opz, 28, 0, 0);
      }
      if (!game.tryIgnitePortal(opx + 1, opy + 1, opz)) {
        throw new Error('tryIgnitePortal failed on valid 4x5 Obsidian frame');
      }
      for (let dy = 1; dy <= 3; dy++) for (let dx = 1; dx <= 2; dx++) {
        if (game.world.getBlock(opx + dx, opy + dy, opz) !== 528) {
          throw new Error('Portal interior not filled with nether_portal (528)');
        }
      }
      // Verify nether_portal (528) is immovable by pistons (Guard Rule #4)
      if (!Redstone.isImmovable(game, opx + 1, opy + 1, opz, 528, 0)) {
        throw new Error('nether_portal (528) must be immovable in Piston blacklist');
      }
      // Break 1 frame obsidian block -> all 6 nether_portal blocks must cascade-shatter to air (0)!
      game.breakBlock(opx + 1, opy + 4, opz, false, true);
      for (let dy = 1; dy <= 3; dy++) for (let dx = 1; dx <= 2; dx++) {
        if (game.world.getBlock(opx + dx, opy + dy, opz) !== 0) {
          throw new Error('Breaking obsidian frame failed to cascade-shatter nether_portal at (' + (opx + dx) + ',' + (opy + dy) + ')');
        }
      }
      // Rebuild top obsidian & re-ignite for portal travel test
      game.world.setBlock(opx + 1, opy + 4, opz, 28, 0, 0);
      if (!game.tryIgnitePortal(opx + 1, opy + 1, opz)) throw new Error('Re-igniting portal failed');

      // 11c. Guard Rule #5 Single-Active-Dimension Switch to Nether & 8:1 Coordinate Scaling
      // Place a marker block in Overworld at (bx, 82, bz) to verify Overworld state persists across Nether round-trip
      game.world.setBlock(bx, 82, bz, 512, 0);
      game.player.pos = [160.5, 72, -80.5];
      game.player.prev = [...game.player.pos];
      await game.switchDimension('nether');
      if (game.world.dimension !== 'nether' || game.worker.dimension !== 'nether') {
        throw new Error('World or Worker dimension did not switch to nether');
      }
      // 160 / 8 = 20, -80 / 8 = -10 => player should land near (20, y, -10) inside a constructed destination portal!
      if (Math.hypot(game.player.pos[0] - 20.5, game.player.pos[2] - (-10.5)) > 16) {
        throw new Error('8:1 coordinate scaling into Nether failed! Player at ' + JSON.stringify(game.player.pos));
      }
      // Verify Nether environment (crimson fog, no sun/stars, isNether=true)
      const netherEnv = game.env(0);
      if (!netherEnv.isNether || netherEnv.sunAlpha !== 0 || netherEnv.starBright !== 0) {
        throw new Error('Nether env() should set isNether=true and disable sun/stars');
      }

      // 11d. Verify Nether Wastes terrain (Bedrock floor Y=0 & ceiling Y=127, Netherrack 529, Soul Sand 530, Glowstone 27, Quartz Ore 531)
      const nch = game.loadChunk(0, 0);
      if (nch.biome[0] !== BI.NETHER_WASTES) throw new Error('Nether chunk biome should be BI.NETHER_WASTES (13)');
      if (game.world.getBlock(8, 0, 8) !== 6 || game.world.getBlock(8, 127, 8) !== 6) {
        throw new Error('Nether chunk must have Bedrock (6) at Y=0 and Y=127');
      }
      let hasNetherrack = false, hasQuartzOre = false, hasGlowstone = false, hasSoulSand = false;
      for (let i = 0; i < nch.blocks.length; i++) {
        const bid = nch.blocks[i];
        if (bid === 529) hasNetherrack = true;
        else if (bid === 531) hasQuartzOre = true;
        else if (bid === 27) hasGlowstone = true;
        else if (bid === 530) hasSoulSand = true;
      }
      if (!hasNetherrack || !hasQuartzOre || !hasGlowstone || !hasSoulSand) {
        throw new Error('Nether chunk missing expected blocks: ' + JSON.stringify({ hasNetherrack, hasQuartzOre, hasGlowstone, hasSoulSand }));
      }

      // 11e. Verify Nether Fortress at (cx=2, cz=2) with Nether Bricks (533), Soul Sand + Nether Wart (536), and Blaze Spawner (182, meta=1)
      let hasFortBrick = false, hasFortWart = false, hasBlazeSpawner = false;
      for (let fcz = 1; fcz <= 5; fcz++) {
        for (let fcx = 1; fcx <= 5; fcx++) {
          const fch = game.loadChunk(fcx, fcz);
          for (let i = 0; i < fch.blocks.length; i++) {
            const bid = fch.blocks[i];
            if (bid === 533) hasFortBrick = true;
            else if (bid === 536) hasFortWart = true;
            else if (bid === 182 && fch.meta[i] === 1) hasBlazeSpawner = true;
          }
        }
      }
      if (!hasFortBrick || !hasFortWart || !hasBlazeSpawner) {
        throw new Error('Nether Fortress missing expected features: ' + JSON.stringify({ hasFortBrick, hasFortWart, hasBlazeSpawner }));
      }
      if (!Structures.isInsideNetherFortress(40, 52, 40, game.world)) {
        throw new Error('Structures.isInsideNetherFortress should return true at fortress center (40, 52, 40)');
      }

      // 11f. Verify Water Bucket immediately evaporates in Nether, and Bed triggers explosion in Nether
      const ntx = 20, nty = Math.floor(game.player.pos[1]), ntz = -10;
      game.world.setBlock(ntx, nty - 1, ntz - 2, 529, 0);
      game.world.setBlock(ntx, nty, ntz - 2, 0, 0);
      game.player.inv.slots[0] = makeStack('water_bucket', 1);
      game.player.inv.sel = 0;
      game.target = { pos: [ntx, nty - 1, ntz - 2], face: 3, id: 529, point: [ntx + 0.5, nty, ntz - 1.5] };
      game.targetEntity = null;
      game.use();
      if (game.world.getBlock(ntx, nty, ntz - 2) === WATER || game.player.inv.slots[0].id !== item('bucket')) {
        throw new Error('Water bucket in Nether must evaporate immediately without placing WATER block');
      }
      // Place a bed in the Nether and call trySleep -> must explode and destroy the bed!
      game.world.setBlock(ntx + 4, nty, ntz, 118, 0);
      game.world.setBlock(ntx + 4, nty, ntz - 1, 118, 4);
      game.trySleep(ntx + 4, nty, ntz);
      if (game.world.getBlock(ntx + 4, nty, ntz) === 118) {
        throw new Error('Using a bed in the Nether must explode and destroy the bed');
      }

      // 11g. Verify Nether Mobs: Blaze, Wither Skeleton (+ Wither effect), Ghast (+ Fireball deflection), Zombified Piglin (+ group aggro), Enderman & Skeleton spawn weights
      // 1) Blaze native drop of blaze_rod
      game.entities = [];
      const testBlaze = new Mob(game, 'blaze', ntx + 0.5, nty + 1, ntz + 0.5);
      game.entities.push(testBlaze);
      testBlaze.hurt(100, { type: 'player', attacker: game.player, player: true, looting: 1 });
      const droppedRod = game.entities.find(e => e instanceof ItemEntity && e.stack.id === item('blaze_rod'));
      if (!droppedRod || droppedRod.stack.count < 1) {
        throw new Error('Killing Blaze must drop blaze_rod');
      }

      // 2) Wither Skeleton inflicts Wither effect (10s = 200 ticks, deals 1 HP every 40 ticks, renders black hearts) & drops coal/bone/stone_sword (NO skull)
      game.player.clearEffects();
      game.player.blocking = false;
      game.player.usingItem = null;
      game.player.pos = [ntx + 0.5, nty, ntz + 0.5];
      game.player.prev = [...game.player.pos];
      game.player.health = 20;
      game.player.invuln = 0;
      const testWitherSkel = new Mob(game, 'wither_skeleton', ntx + 0.5, nty, ntz - 0.4);
      testWitherSkel.target = game.player;
      testWitherSkel.attackCd = 0;
      game.entities.push(testWitherSkel);
      testWitherSkel.tick();
      if (!game.player.hasEffect('wither')) {
        throw new Error('Wither Skeleton melee hit must inflict wither status effect');
      }
      const hpAfterHit = game.player.health;
      game.player.invuln = 0;
      for (let t = 0; t < 45; t++) {
        game.player.invuln = 0;
        game.player.tickEffects();
      }
      if (game.player.health >= hpAfterHit) {
        throw new Error('Wither status effect must deal periodic damage every 40 ticks');
      }
      // Draw HUD while withered to verify black hearts rendering
      game.ui.draw();
      // Kill Wither Skeleton with forceRareDrop to verify stone_sword drop and no skull item
      testWitherSkel.invuln = 0;
      testWitherSkel.hurt(100, { type: 'player', attacker: game.player, player: true, forceRareDrop: true });
      const droppedStoneSword = game.entities.find(e => e instanceof ItemEntity && e.stack.id === item('stone_sword'));
      if (!droppedStoneSword || ITEM_KEY.wither_skeleton_skull !== undefined) {
        throw new Error('Wither Skeleton should drop stone_sword on rare roll and must NOT have wither_skeleton_skull registered');
      }

      // 3) Ghast & GhastFireball melee deflection (Return to Sender)
      const testGhast = new Mob(game, 'ghast', ntx + 0.5, nty + 3, ntz - 8.5);
      game.entities.push(testGhast);
      const ghastFb = new GhastFireball(game, ntx + 0.5, nty + 1.2, ntz - 2.0, [0, 0, 0.5], testGhast);
      game.entities.push(ghastFb);
      game.player.yaw = 0; // looking -Z toward testGhast
      game.player.pitch = 0.2;
      game.attack(ghastFb);
      if (!ghastFb.deflected || ghastFb.vel[2] >= 0) {
        throw new Error('Attacking GhastFireball should deflect it back along player lookDir (-Z)');
      }

      // 4) Zombified Piglin neutral by default + 32-block group aggro when provoked
      const piglin1 = new Mob(game, 'zombified_piglin', ntx + 2.5, nty, ntz + 2.5);
      const piglin2 = new Mob(game, 'zombified_piglin', ntx + 8.5, nty, ntz + 4.5);
      game.entities.push(piglin1, piglin2);
      piglin1.tick();
      piglin2.tick();
      if (piglin1.target !== null || piglin2.target !== null) {
        throw new Error('Zombified Piglin must be neutral (target === null) before being attacked');
      }
      piglin1.hurt(4, { type: 'player', attacker: game.player, player: true });
      if (piglin1.target !== game.player || piglin2.target !== game.player || piglin2.angerTicks <= 0) {
        throw new Error('Attacking one Zombified Piglin must aggro nearby Zombified Piglins within 32 blocks');
      }

      // 5) Verify Nether Wastes natural spawn table includes zombified_piglin, ghast, enderman (small), and skeleton (very small)
      const wTypes = [0.1, 0.65, 0.88, 0.98].map(rv => game.pickNetherMobType(0, 50, 0, rv));
      if (wTypes[0] !== 'zombified_piglin' || wTypes[1] !== 'ghast' || wTypes[2] !== 'enderman' || wTypes[3] !== 'skeleton') {
        throw new Error('Nether Wastes spawn distribution mismatch: ' + JSON.stringify(wTypes));
      }
      const fTypes = [0.1, 0.5, 0.8, 0.95].map(rv => game.pickNetherMobType(40, 52, 40, rv));
      if (fTypes[0] !== 'blaze' || fTypes[1] !== 'wither_skeleton' || fTypes[2] !== 'zombified_piglin' || fTypes[3] !== 'skeleton') {
        throw new Error('Nether Fortress spawn distribution mismatch: ' + JSON.stringify(fTypes));
      }

      // 6) Verify Overworld grass/flower tiles & Nether mob WebGL textures (no missing tile fallback or villager skin fallback!)
      for (const reqTile of ['grass_block_top', 'grass_block_side_overlay', 'grass_block_snow', 'cornflower', 'oxeye_daisy', 'azure_bluet', 'lily_of_the_valley', 'netherrack', 'nether_portal', 'nether_bricks']) {
        if (!(ASSETS.tiles[reqTile] > 0)) {
          throw new Error('Missing block tile in ASSETS.tiles: ' + reqTile);
        }
      }
      for (const reqTex of ['blaze', 'wither_skeleton', 'ghast', 'ghast_shooting', 'zombified_piglin', 'enderman', 'enderman_eyes']) {
        if (!game.renderer.entityTex[reqTex]) {
          throw new Error('Missing WebGL entityTex for Nether mob: ' + reqTex);
        }
      }
      // Render all 5 new Nether mobs (blaze, wither_skeleton, ghast, zombified_piglin, enderman) to verify 3D models & textures
      for (const mType of ['blaze', 'wither_skeleton', 'ghast', 'zombified_piglin', 'enderman']) {
        const mEnt = new Mob(game, mType, ntx + 0.5, nty, ntz + 0.5);
        game.drawMob(mEnt, mEnt.pos, 1, netherEnv, [1, 1]);
      }

      // 11h. Switch back from Nether (20, y, -10) to Overworld -> verify 8:1 scaling (160, y, -80) and Overworld saved block (512 at bx, 82, bz) intact!
      game.player.pos = [20.5, 64, -10.5];
      await game.switchDimension('overworld');
      if (game.world.dimension !== 'overworld') throw new Error('Failed to switch back to overworld');
      if (Math.hypot(game.player.pos[0] - 160.5, game.player.pos[2] - (-80.5)) > 16) {
        throw new Error('8:1 scaling from Nether back to Overworld failed: ' + JSON.stringify(game.player.pos));
      }
      game.loadChunk(pcx, pcz);
      if (game.world.getBlock(bx, 82, bz) !== 512) {
        throw new Error('Overworld modified block (512) was lost after Nether round-trip!');
      }

      // ---- Test 12: W3 Phase 2 Ender Pearl, Eye of Ender, Stronghold, The End & Ender Dragon Boss Fight ----
      // 12a. Verify End assets, tiles, animations, Chinese names & WebGL entityTex
      if (BLOCKS[534].cn !== '下界砖栅栏' || ITEMS[534].cn !== '下界砖栅栏' || BLOCKS[534].tex[0] !== T('nether_bricks')) {
        throw new Error('nether_brick_fence (534) definition or texture corrupted: cn=' + BLOCKS[534].cn + ', tex=' + BLOCKS[534].tex[0]);
      }
      if (BLOCKS[542].cn !== '铁栏杆' || ITEMS[542].cn !== '铁栏杆' || BLOCKS[542].shape !== SH_MODEL) {
        throw new Error('iron_bars (542) must be SH_MODEL with cn=铁栏杆');
      }
      if (!(ANIM_FRAMES[T('fire_0')] > 1) || !(ANIM_FRAMES[T('end_portal')] > 1)) {
        throw new Error('fire_0 and end_portal must have animated multi-frame tiles in ANIM_FRAMES');
      }
      const fireMesh = Mesher.single(537, 0);
      if (fireMesh.u8[30] !== ANIM_FRAMES[T('fire_0')]) {
        throw new Error('Mesher.quadFlat failed to pass ANIM_FRAMES[fire_0] to vertex anim attribute (got ' + fireMesh.u8[30] + ')');
      }
      for (const reqTile of ['end_portal_frame_top', 'end_portal_frame_side', 'end_portal_frame_bottom', 'end_portal_frame_eye', 'end_portal', 'end_stone', 'end_stone_bricks', 'dragon_egg', 'iron_bars', 'i_ender_eye', 'i_end_crystal']) {
        if (!(ASSETS.tiles[reqTile] > 0)) {
          throw new Error('Missing End tile in ASSETS.tiles: ' + reqTile);
        }
      }
      for (const reqTex of ['end_crystal', 'ender_dragon', 'dragon_eyes', 'dragon_fireball', 'end_beam']) {
        if (!game.renderer.entityTex[reqTex]) {
          throw new Error('Missing WebGL entityTex for End entity: ' + reqTex);
        }
      }
      if (!game.renderer.models.end_crystal || !game.renderer.models.ender_dragon) {
        throw new Error('Missing 3D model for end_crystal or ender_dragon');
      }

      // 12b. Verify W3 Phase 2 Crafting Recipes (eye_of_ender, end_stone_bricks, iron_bars, end_crystal)
      checkCraft(['ender_pearl', 'blaze_powder', null, null, null, null, null, null, null], 'eye_of_ender');
      checkCraft(['end_stone', 'end_stone', null, 'end_stone', 'end_stone', null, null, null, null], 'end_stone_bricks');
      checkCraft(['iron_ingot', 'iron_ingot', 'iron_ingot', 'iron_ingot', 'iron_ingot', 'iron_ingot', null, null, null], 'iron_bars');
      checkCraft(['glass', 'glass', 'glass', 'glass', 'eye_of_ender', 'glass', 'glass', 'ghast_tear', 'glass'], 'end_crystal');

      // 12c. Ender Pearl throw, 20-tick cooldown & 5 HP fall damage teleportation
      game.mode = 'survival';
      game.player.creative = false;
      game.player.clearEffects();
      // Clear any lingering entities along the landing strip and remove armor
      game.entities = [];
      for (let s = 36; s < 40; s++) game.player.inv.slots[s] = null;
      game.player.health = 20;
      game.player.invuln = 0;
      game.player.pearlCooldown = 0;
      // Ensure chunks along landing strip are loaded
      for (let cz = pcz - 1; cz <= pcz; cz++) game.loadChunk(pcx, cz);
      // Build a flat stone landing strip at (bx + dx, 115, bz + dz)
      for (let dz = -12; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        game.world.setBlock(bx + dx, 114, bz + dz, 1, 0, 0);
        for (let dy = 115; dy <= 122; dy++) game.world.setBlock(bx + dx, dy, bz + dz, 0, 0, 0);
      }
      game.player.pos = [bx + 0.5, 115, bz + 0.5];
      game.player.prev = [...game.player.pos];
      game.player.yaw = 0; // looking North (-Z)
      game.player.pitch = -0.45; // angled downward toward floor ahead
      game.target = null;
      game.targetEntity = null;
      game.player.inv.slots[0] = makeStack('ender_pearl', 4);
      game.player.inv.sel = 0;
      game.use();
      if (game.player.pearlCooldown !== 20 || game.player.inv.slots[0].count !== 3) {
        throw new Error('Throwing Ender Pearl should set 20-tick pearlCooldown and consume 1 pearl');
      }
      // Draw HUD while pearlCooldown > 0 to verify white cooldown overlay
      game.ui.draw();
      const pearlEnt = game.entities.find(e => e instanceof EnderPearlEntity && !e.dead);
      if (!pearlEnt) throw new Error('EnderPearlEntity was not spawned');
      for (let t = 0; t < 40 && !pearlEnt.dead; t++) pearlEnt.tick();
      if (!pearlEnt.dead || game.player.pos[2] >= bz - 1.0 || game.player.health !== 15) {
        throw new Error('Ender Pearl impact failed: pearlPos=' + JSON.stringify(pearlEnt.pos) + ', dead=' + pearlEnt.dead + ', playerPos=' + JSON.stringify(game.player.pos) + ', hp=' + game.player.health);
      }

      // 12d. Stronghold Locator & Eye of Ender flight
      const locSh = Structures.locateNearest(game.world, 'stronghold', 0, 0);
      if (!locSh || locSh.x !== 168 || locSh.z !== -157) {
        throw new Error('Structures.locateNearest(stronghold) failed: ' + JSON.stringify(locSh));
      }
      game.player.pos = [0.5, 85, 0.5];
      game.player.prev = [...game.player.pos];
      game.target = null;
      game.targetEntity = null;
      game.player.inv.slots[0] = makeStack('eye_of_ender', 2);
      game.player.inv.sel = 0;
      game.use();
      const eyeEnt = game.entities.find(e => e instanceof EyeOfEnderEntity && !e.dead);
      if (!eyeEnt) throw new Error('EyeOfEnderEntity was not spawned on right-click');
      eyeEnt.forceDrop = true;
      for (let t = 0; t < 55 && !eyeEnt.dead; t++) eyeEnt.tick();
      if (!eyeEnt.dead || eyeEnt.pos[0] <= 5 || eyeEnt.pos[2] >= -5) {
        throw new Error('EyeOfEnderEntity did not fly toward Stronghold at (168, -157): pos=' + JSON.stringify(eyeEnt.pos));
      }

      // 12e. Stronghold Portal Room Generation, Comparator Frame Signal & 12-Eye End Portal Activation
      for (let scz = -11; scz <= -9; scz++) {
        for (let scx = 9; scx <= 11; scx++) {
          game.loadChunk(scx, scz);
        }
      }
      // Portal center is at (168, 31, -157)
      const pCx = 168, pCy = 31, pCz = -157;
      // Verify Spawner at (168, 30, -153)
      if (game.world.getBlock(168, 30, -153) !== 182) {
        throw new Error('Stronghold Portal Room missing Silverfish/Monster Spawner at staircase (168, 30, -153)');
      }
      // Verify all 12 End Portal Frames (538) around (168, 31, -157) and insert Eyes of Ender into empty ones
      const frameCoords = [];
      for (let i = -1; i <= 1; i++) {
        frameCoords.push([pCx + i, pCy, pCz - 2], [pCx + i, pCy, pCz + 2], [pCx - 2, pCy, pCz + i], [pCx + 2, pCy, pCz + i]);
      }
      for (const [fx, fy, fz] of frameCoords) {
        if (game.world.getBlock(fx, fy, fz) !== 538) {
          throw new Error('Missing end_portal_frame (538) at (' + fx + ',' + fy + ',' + fz + '), got ' + game.world.getBlock(fx, fy, fz));
        }
      }
      // Verify Comparator reading on end_portal_frame (0 when empty, 15 when filled with eye)
      const [tfx, tfy, tfz] = frameCoords[0];
      const origFrameMeta = game.world.getMeta(tfx, tfy, tfz);
      game.world.setMeta(tfx, tfy, tfz, origFrameMeta & 3);
      if (Redstone.getContainerSignal(game, tfx, tfy, tfz, 538) !== 0) {
        throw new Error('Empty end_portal_frame must output comparator signal 0');
      }
      game.world.setMeta(tfx, tfy, tfz, (origFrameMeta & 3) | 4);
      if (Redstone.getContainerSignal(game, tfx, tfy, tfz, 538) !== 15) {
        throw new Error('Filled end_portal_frame must output comparator signal 15');
      }
      // Verify end_portal_frame (538) and end_portal (539) are immovable by pistons
      if (!Redstone.isImmovable(game, tfx, tfy, tfz, 538, 0) || !Redstone.isImmovable(game, pCx, pCy, pCz, 539, 0)) {
        throw new Error('end_portal_frame (538) and end_portal (539) must be in Piston immovable blacklist');
      }
      // Fill all 12 frames using Eye of Ender right-click interaction
      for (const [fx, fy, fz] of frameCoords) {
        if (!(game.world.getMeta(fx, fy, fz) & 4)) {
          game.player.inv.slots[0] = makeStack('eye_of_ender', 1);
          game.player.inv.sel = 0;
          game.target = { pos: [fx, fy, fz], face: 3, id: 538, point: [fx + 0.5, fy + 0.8, fz + 0.5] };
          game.targetEntity = null;
          game.use();
        }
      }
      // Verify all 9 interior blocks of the 3x3 ring are now end_portal (539)!
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (game.world.getBlock(pCx + dx, pCy, pCz + dz) !== 539) {
            throw new Error('3x3 End Portal interior at (' + (pCx + dx) + ',' + pCy + ',' + (pCz + dz) + ') did not activate to end_portal (539)');
          }
        }
      }

      // 12f. Switch to The End Dimension ('end'), Verify Main Island, Obsidian Pillars, Cages, End Crystals & Ender Dragon Boss Fight
      await game.triggerEndPortal();
      if (game.world.dimension !== 'end' || game.worker.dimension !== 'end') {
        throw new Error('Failed to switch to The End dimension');
      }
      // Player spawns on the 5x5 Obsidian Platform at (42.5, 50, 0.5)
      if (Math.hypot(game.player.pos[0] - 42.5, game.player.pos[2] - 0.5) > 2 || game.world.getBlock(42, 49, 0) !== 28) {
        throw new Error('Player did not spawn on 5x5 Obsidian platform in The End: pos=' + JSON.stringify(game.player.pos));
      }
      const endEnv = game.env(0);
      if (!endEnv.isEnd || endEnv.sunAlpha !== 0) {
        throw new Error('End env() should set isEnd=true and sunAlpha=0');
      }
      // Verify End Stone (540) main island & Central Bedrock Exit Portal pillar at (0, 59..62, 0)
      if (game.world.getBlock(10, 55, 10) !== 540 || game.world.getBlock(0, 60, 0) !== 6) {
        throw new Error('End Main Island missing end_stone (540) or central bedrock pillar (6)');
      }
      // Verify 8 EndCrystals and 1 EnderDragon spawned
      const crystals = game.entities.filter(e => e instanceof EndCrystal && !e.dead);
      const dragon = game.entities.find(e => e instanceof Mob && !e.dead && !e.deathTime && e.type === 'ender_dragon');
      if (crystals.length !== 8 || !dragon || dragon.health !== 200) {
        throw new Error('Expected 8 EndCrystals and 200 HP EnderDragon, got crystals=' + crystals.length + ', dragon=' + (dragon && dragon.health));
      }
      // Verify Caged Pillar #1 has iron_bars (542)
      const pil1 = game.world.getEndPillars()[1];
      if (game.world.getBlock(pil1.x + 2, pil1.topY + 2, pil1.z) !== 542) {
        throw new Error('Caged Obsidian Pillar #1 missing iron_bars (542) cage');
      }
      // Render EndEntities + Dynamic End Portal Starfield Shader + HUD Boss Bar
      game.nearbyEndPortals = [[1, 59, 0], [-1, 59, 0]];
      game.renderer.setCamera([0, 68, 25], 0, -0.2, 70);
      game.drawEntities(1, endEnv);
      game.ui.draw();

      // Test Crystal Healing Link & 10 HP Backlash when Crystal is destroyed
      dragon.health = 180;
      dragon.pos = [crystals[0].pos[0] + 4, crystals[0].pos[1], crystals[0].pos[2]];
      for (let t = 0; t < 12; t++) dragon.tick();
      if (dragon.healingCrystal !== crystals[0] || dragon.health <= 180) {
        throw new Error('EnderDragon failed to link and heal from nearby EndCrystal');
      }
      const hpBeforeCrystalBreak = dragon.health;
      crystals[0].hurt(1, { type: 'arrow', attacker: game.player, player: true });
      if (!crystals[0].dead || dragon.health !== hpBeforeCrystalBreak - 10) {
        throw new Error('Destroying linked EndCrystal should deal 10 HP backlash to EnderDragon: before=' + hpBeforeCrystalBreak + ', after=' + dragon.health);
      }

      // Test Landing Approach Speed Cap: Dragon at (0.5, 75, 28.5) entering 'landing' must fly at <= 0.40 blocks/tick (no instant teleport!)
      dragon.phase = 'landing';
      dragon.phaseTicks = 0;
      dragon.pos = [0.5, 75.0, 28.5];
      dragon.prev = [...dragon.pos];
      dragon.tick();
      const landingStep = Math.hypot(dragon.pos[0] - dragon.prev[0], dragon.pos[1] - dragon.prev[1], dragon.pos[2] - dragon.prev[2]);
      if (landingStep > 0.42 || landingStep < 0.25) {
        throw new Error('Dragon landing approach speed out of bounds (expected ~0.38 blocks/tick, got ' + landingStep.toFixed(3) + ')');
      }

      // Test Perching Phase: Immune to Arrows, Vulnerable to Melee Sword
      dragon.phase = 'perching';
      dragon.phaseTicks = 0;
      dragon.pos = [0.5, 63.0, 0.5];
      dragon.invuln = 0;
      const hpBeforeArrow = dragon.health;
      const arrowRes = dragon.hurt(12, { type: 'arrow', attacker: game.player, player: true });
      if (arrowRes !== false || dragon.health !== hpBeforeArrow) {
        throw new Error('Perched EnderDragon must be immune to arrows per Minecraft Wiki');
      }
      const meleeRes = dragon.hurt(15, { type: 'player', attacker: game.player, player: true });
      if (meleeRes !== true || dragon.health !== hpBeforeArrow - 15) {
        throw new Error('Perched EnderDragon must take melee damage');
      }

      // Test Defeating the Ender Dragon -> +12,000 XP, Central Exit Portal Ignition (539), Dragon Egg (541) at (0, 63, 0) & Egg Teleportation
      const xpBeforeKill = game.player.xp;
      dragon.invuln = 0;
      dragon.hurt(500, { type: 'player', attacker: game.player, player: true });
      if (game.player.xp < xpBeforeKill + 12000) {
        throw new Error('Defeating EnderDragon must award 12,000 XP');
      }
      if (game.world.getBlock(1, 59, 0) !== 539 || game.world.getBlock(-1, 59, 0) !== 539) {
        throw new Error('Defeating EnderDragon must ignite Central Exit Portal with end_portal (539) at y=59');
      }
      if (game.world.getBlock(0, 63, 0) !== 541) {
        throw new Error('Defeating EnderDragon must place dragon_egg (541) atop central bedrock pillar at (0, 63, 0)');
      }
      // Right-click Dragon Egg at (0, 63, 0) -> must teleport to a nearby End Stone block!
      game.target = { pos: [0, 63, 0], face: 3, id: 541, point: [0.5, 63.5, 0.5] };
      game.targetEntity = null;
      game.use();
      if (game.world.getBlock(0, 63, 0) === 541) {
        throw new Error('Right-clicking dragon_egg (541) should teleport it away from (0, 63, 0)');
      }

      // P0-2 Verification: Collect Dragon's Breath from DragonBreathCloud using glass_bottle
      const breathCloud = new DragonBreathCloud(game, game.player.pos[0] + 1, game.player.pos[1], game.player.pos[2], 140);
      game.entities.push(breathCloud);
      game.player.inv.slots[0] = makeStack('glass_bottle', 2);
      game.player.inv.sel = 0;
      game.target = null;
      game.targetEntity = null;
      game.use();
      const hasBreath = game.player.inv.slots.some(s => s && s.id === item('dragon_breath'));
      if (!hasBreath || game.player.inv.slots[0].count !== 1) {
        throw new Error('P0-2: Collecting DragonBreathCloud with glass_bottle failed to yield dragon_breath item');
      }

      // P1-2 Verification: Perched EnderDragon multi-part subBoxes hittable from fountain rim in survival mode
      const testDragon = new Mob(game, 'ender_dragon', 0.5, 63.0, 0.5);
      testDragon.phase = 'perching';
      testDragon.yaw = Math.PI; // facing +Z (South), so head is at z = 0.5 + 5.2 = 5.7
      game.entities.push(testDragon);
      game.mode = 'survival';
      game.player.pos = [0.5, 60.0, 4.2]; // standing on South fountain rim looking North at dragon head/neck/chest
      game.player.yaw = 0; // looking North (-Z)
      game.player.pitch = 0.1; // nearly horizontal
      game.updateTarget();
      if (game.targetEntity !== testDragon) {
        throw new Error('P1-2: Player on fountain rim failed to target perched EnderDragon head/body in survival mode');
      }
      testDragon.dead = true;

      // P1-3 Verification: 4 EndCrystals placed around Exit Portal respawn EnderDragon, extinguish portal & restore 8 pillar crystals
      for (const [rcx, rcz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
        game.world.setBlock(rcx, 59, rcz, 6, 0, 0);
        game.world.setBlock(rcx, 60, rcz, 0, 0, 0);
        game.player.inv.slots[0] = makeStack('end_crystal', 1);
        game.player.inv.sel = 0;
        game.target = { pos: [rcx, 59, rcz], face: 3, id: 6, point: [rcx + 0.5, 60, rcz + 0.5] };
        game.targetEntity = null;
        game.use();
      }
      const respawnedDragon = game.entities.find(e => e instanceof Mob && !e.dead && !e.deathTime && e.type === 'ender_dragon');
      const restoredCrystals = game.entities.filter(e => e instanceof EndCrystal && !e.dead);
      if (!respawnedDragon || restoredCrystals.length !== 8 || game.world.getBlock(1, 59, 0) === 539) {
        throw new Error('P1-3: 4-Crystal respawn ritual failed: dragon=' + !!respawnedDragon + ', crystals=' + restoredCrystals.length + ', portalBlock=' + game.world.getBlock(1, 59, 0));
      }

      // P1-6 Verification: Explosion (e.g. Bed / TNT) destroys nearby EndCrystal
      const targetCrystal = restoredCrystals[0];
      game.explode(targetCrystal.pos[0] + 0.5, targetCrystal.pos[1], targetCrystal.pos[2], 4, null);
      if (!targetCrystal.dead) {
        throw new Error('P1-6: explode() failed to destroy nearby EndCrystal');
      }

      // P1-1 Verification: Saving & reloading via startWorld() while in The End preserves the live EnderDragon
      respawnedDragon.health = 135;
      await game.saveWorld(true);
      game.state = 'title';
      await game.loadWorld(game.worldMeta.id);
      const reloadedDragon = game.entities.find(e => e instanceof Mob && !e.dead && !e.deathTime && e.type === 'ender_dragon');
      if (!reloadedDragon || reloadedDragon.health !== 135) {
        throw new Error('P1-1: Reloading save in The End lost EnderDragon or its HP: ' + (reloadedDragon && reloadedDragon.health));
      }
      reloadedDragon.invuln = 0;
      reloadedDragon.hurt(500, { type: 'player', attacker: game.player, player: true });

      // Step into Exit Portal -> returns player to Overworld spawn!
      await game.triggerEndPortal();
      if (game.world.dimension !== 'overworld') {
        throw new Error('Stepping into End Exit Portal should return player to Overworld');
      }

      // P0-1 Verification: Reloading modified Nether chunk via _buildChunkFromSaved does not throw w.netherBiomeAt error
      await game.switchDimension('nether');
      const nSaved = encodeChunk(game.world.getChunk(Math.floor(game.player.pos[0]) >> 4, Math.floor(game.player.pos[2]) >> 4));
      const nRebuilt = game._buildChunkFromSaved(0, 0, nSaved);
      if (nRebuilt.biome[0] !== BI.NETHER_WASTES) {
        throw new Error('P0-1: _buildChunkFromSaved in Nether failed to set BI.NETHER_WASTES');
      }
      await game.switchDimension('overworld');

      // P1-5 Verification: Placing end_portal_frame (538) while facing North (yaw=0, hdir=4) sets inward facing meta=2 (South)
      game.world.setBlock(bx, 114, bz - 2, 1, 0, 0);
      game.world.setBlock(bx, 115, bz - 2, 0, 0, 0);
      game.player.pos = [bx + 0.5, 115, bz + 0.5];
      game.player.yaw = 0; // looking North (-Z, hdir=4)
      game.player.pitch = -0.3;
      game.player.inv.slots[0] = makeStack('end_portal_frame', 1);
      game.player.inv.sel = 0;
      game.target = { pos: [bx, 114, bz - 2], face: 3, id: 1, point: [bx + 0.5, 115, bz - 1.5] };
      game.targetEntity = null;
      game.use();
      if (game.world.getBlock(bx, 115, bz - 2) !== 538 || (game.world.getMeta(bx, 115, bz - 2) & 3) !== 2) {
        throw new Error('P1-5: Placed end_portal_frame facing North should have inward meta=2, got ' + game.world.getMeta(bx, 115, bz - 2));
      }

      // P2-2 Verification: ASSETS.images.end_portal & entityTex.end_portal exist
      if (!ASSETS.images.end_portal || !game.renderer.entityTex.end_portal) {
        throw new Error('P2-2: Missing ASSETS.images.end_portal or entityTex.end_portal');
      }

      // ---- UI/UX & Performance Regression Tests (5 items) ----
      // 1. Double-click item stack collection in ContainerScreen (collects partial stacks first onto ui.cursor)
      Sound.init = () => {};
      const invScreen = new CraftingScreen(game, 2);
      game.ui.open(invScreen);
      game.ui.cursor = null;
      game.player.inv.slots.fill(null);
      const plankId = item('birch_planks');
      game.player.inv.slots[9] = { id: plankId, count: 2, dmg: 0 };
      game.player.inv.slots[10] = { id: plankId, count: 64, dmg: 0 };
      game.player.inv.slots[11] = { id: plankId, count: 5, dmg: 0 };
      game.player.inv.slots[12] = { id: plankId, count: 10, dmg: 0 };
      const slot9 = invScreen.slots.find(s => s.idx === 9);
      const sx9 = invScreen.x + slot9.x + 4, sy9 = invScreen.y + slot9.y + 4;
      // First click picks up 2 birch_planks onto ui.cursor
      invScreen.mouseDown(game.ui, sx9, sy9, 0, false);
      invScreen.mouseUp(game.ui, sx9, sy9, 0);
      if (!game.ui.cursor || game.ui.cursor.count !== 2) {
        throw new Error('First click should pick up 2 birch_planks onto cursor');
      }
      // Second click within 380ms gathers partial stacks (5 + 10) first -> 2 + 5 + 10 = 17, plus 47 from full stack -> 64 on cursor, leaving 17 in slot 10!
      invScreen.mouseDown(game.ui, sx9, sy9, 0, false);
      invScreen.mouseUp(game.ui, sx9, sy9, 0);
      if (!game.ui.cursor || game.ui.cursor.id !== plankId || game.ui.cursor.count !== 64) {
        throw new Error('Double-click should collect 64 birch_planks onto cursor, got ' + JSON.stringify(game.ui.cursor));
      }
      if (game.player.inv.slots[11] !== null || game.player.inv.slots[12] !== null || !game.player.inv.slots[10] || game.player.inv.slots[10].count !== 17) {
        throw new Error('Double-click should drain partial stacks (slots 11 & 12) before full stack (slot 10)');
      }
      game.ui.cursor = null;
      game.ui.close();

      // 2. Player preview look direction & readPixels cache verification
      game.ui.mouse.x = 300;
      game.ui.mouse.y = 220;
      const pvCv1 = game.renderer.playerPreview(game, game.ui, 100, 50, 49, 70);
      const pvKey1 = game.renderer.pv.lastKey;
      const pvCv2 = game.renderer.playerPreview(game, game.ui, 100, 50, 49, 70);
      if (pvCv1 !== pvCv2 || !pvKey1) {
        throw new Error('playerPreview should cache canvas when mouse and equipment are unchanged');
      }
      if (typeof World.prototype.propagateLocal !== 'function') {
        throw new Error('Missing World.prototype.propagateLocal lighting optimization');
      }

      // ---- Test 13b: 18 Gameplay, Worldgen, AI & Progression Fixes ----
      // 1. Weather vs Thunderstorm sleeping & Overworld-only rain
      await game.switchDimension('overworld', [0.5, 82, 0.5]);
      game.worldTime = 6000; // noon
      game.weather = 1.0;
      game.thunder = 0.0;
      game.world.setBlock(2, 81, 2, 1, 0);
      game.world.setBlock(3, 81, 2, 1, 0);
      game.world.setBlock(2, 82, 2, 179, 0);
      game.world.setBlock(3, 82, 2, 179, 4);
      game.player.pos = [2.5, 82, 2.5];
      game.trySleep(2, 82, 2);
      if (game.sleeping) throw new Error('Should NOT be able to sleep during daytime ordinary rain (thunder=0)');
      game.thunder = 1.0;
      game.trySleep(2, 82, 2);
      if (!game.sleeping) throw new Error('Should be able to sleep during daytime thunderstorm (thunder=1)');
      game.sleeping = null;
      game.thunder = 0; game.weather = 0;

      // 2. Carrots (544) & Potatoes (545) planting on farmland, bone meal growth, smelting potato -> baked_potato
      game.world.setBlock(5, 81, 5, 63, 7);
      game.world.setBlock(6, 81, 5, 63, 7);
      game.player.food = 10; // Hungry player should still plant carrot/potato when clicking farmland!
      game.player.inv.slots[0] = makeStack('carrot', 4);
      game.player.inv.sel = 0;
      game.target = { pos: [5, 81, 5], face: 3, id: 63, point: [5.5, 81.9, 5.5] };
      game.targetEntity = null;
      game.use();
      if (game.world.getBlock(5, 82, 5) !== 544) throw new Error('Right-clicking farmland with carrot should plant carrots (544)');
      game.player.inv.slots[0] = makeStack('potato', 4);
      game.target = { pos: [6, 81, 5], face: 3, id: 63, point: [6.5, 81.9, 5.5] };
      game.use();
      if (game.world.getBlock(6, 82, 5) !== 545) throw new Error('Right-clicking farmland with potato should plant potatoes (545)');
      if (!SMELTING[item('potato')] || SMELTING[item('potato')].result !== item('baked_potato')) {
        throw new Error('Smelting potato should produce baked_potato');
      }

      // 5. BlazeFireball zero knockback
      const bfbTarget = new Mob(game, 'zombie', 10.5, 82, 10.5);
      bfbTarget.vel = [0, 0, 0];
      game.entities.push(bfbTarget);
      const bfb = new BlazeFireball(game, 10.5, 82.5, 10.4, [0, 0, 0.1], null);
      bfb.tick();
      if (Math.hypot(bfbTarget.vel[0], bfbTarget.vel[2]) > 0.001) {
        throw new Error('BlazeFireball should apply zero horizontal knockback');
      }
      bfbTarget.dead = true;

      // 6. Ghast warning sound before shooting fireball
      const prevWarn = Sound.ghastWarnCount || 0;
      Sound.ghastWarn([0, 80, 0]);
      if ((Sound.ghastWarnCount || 0) <= prevWarn) throw new Error('Sound.ghastWarn should increment ghastWarnCount');

      // 7. Enderman stare sensitivity: looking at torso/legs should NOT aggro
      const eman = new Mob(game, 'enderman', 0.5, 82, -10.5);
      game.player.pos = [0.5, 82, 0.5];
      game.player.yaw = 0;
      game.player.pitch = -0.15; // looking down at feet/torso, not head (y+2.55)
      eman.age = 5;
      eman.tick();
      eman.age = 10;
      eman.tick();
      if (eman.target === game.player) throw new Error('Enderman should NOT aggro when player looks at its legs/torso');

      // 8. Infinity & all 19 enchantments rollable on Enchanting Table
      const rolledEnchs = new Set();
      const testItems = ['diamond_sword', 'diamond_pickaxe', 'bow', 'diamond_helmet', 'diamond_chestplate', 'diamond_boots'];
      for (const ik of testItems) {
        const st = makeStack(ik, 1);
        for (let seed = 1; seed <= 80; seed++) {
          game.player.enchantSeed = seed * 9973;
          const opts = Enchant.getTableOptions(game.player, st, 15);
          for (const o of opts) {
            if (o && o.ench) for (const k of Object.keys(o.ench)) rolledEnchs.add(k);
          }
        }
      }
      if (!rolledEnchs.has('infinity')) throw new Error('Bow must be able to roll infinity on Enchanting Table');
      if (rolledEnchs.size < 19) throw new Error('All 19 enchantments must be rollable on Enchanting Table, got: ' + rolledEnchs.size);

      // 13. Villager stops and faces player while TradingScreen is open
      farmer.pos = [4.5, 82, 4.5];
      game.player.pos = [4.5, 82, 7.5];
      farmer.wander = [20, 82, 20];
      game.ui.open(new TradingScreen(game, farmer));
      farmer.tick();
      if (farmer.wander !== null) throw new Error('Villager should clear wander while TradingScreen is open');
      game.ui.close();

      // 17. Golden Apple grants Regeneration II and Absorption I (+4 absorption HP)
      game.player.clearEffects();
      game.player.food = 20;
      const gaStack = makeStack('golden_apple', 2);
      game.player.inv.slots[0] = gaStack;
      game.player.inv.sel = 0;
      game.finishEating(gaStack);
      if (!game.player.hasEffect('regeneration') || !game.player.hasEffect('absorption') || (game.player.absorption || 0) < 4) {
        throw new Error('Eating golden_apple must grant regeneration, absorption, and >=4 absorption hearts');
      }
      game.player.clearEffects();

      // ---- Test 13: Worker Fallback to Main Thread ----
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
        shieldBlocks: Sound.shieldBlockCount,
        ascendVy: Number(ascendVy.toFixed(3)),
        diveVy: Number(diveVy.toFixed(3)),
        netherVerified: true,
        endVerified: true,
        playerXpAfterDragon: game.player.xp,
        netherMobs: wTypes.concat(fTypes.slice(0, 2)),
      };
    })()
  `;
  const res = await vm.runInContext(testCode, sandbox);
  console.log('[PASS] Full runtime verification passed:', JSON.stringify(res));
})().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
