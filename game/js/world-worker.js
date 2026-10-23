'use strict';
// ---------------------------------------------------------------------------
// Step 3 (W0-C): Single Inline Blob Worker for Mesher.build & World.generate
// - Automatic seamless fallback to main-thread sync execution if Blob Worker
//   fails to construct or times out (e.g. strict file:// Same-Origin policies).
// - Strict inFlight <= 1 inside Worker; main thread maintains deduplicated
//   priority queue ordered by tier & distance.
// - Guarded by worldSessionId & per-section secRev to discard stale results.
// - Strict boundary: Worker ONLY runs Mesher.buildFromSnapshot (18^3 copy) and
//   pure single-chunk World.generate(cx, cz); cross-chunk initLight(ch),
//   mob spawning, and WebGL makeVao remain on the main thread.
// ---------------------------------------------------------------------------

class WorldWorker {
  constructor(game) {
    this.game = game;
    this.worker = null;
    this.ready = false;
    this.fallback = false;
    this.fallbackReason = '';
    this.inFlight = 0;
    this.maxInFlight = 1;
    this.worldSessionId = game.worldSessionId || 1;
    this.dimension = 'overworld';
    this.queue = [];            // priority-sorted array of tasks
    this.taskByKey = new Map(); // key -> task object for O(1) deduplication/upgrade
    this.activeTask = null;
    this._taskTimer = null;
    this._initTimer = null;
    this._initWorker();
  }

  isReady() {
    return this.ready && !this.fallback && !!this.worker;
  }

  isAvailable() {
    return this.isReady();
  }

  syncBlock(id) {
    if (!this.worker || this.fallback || !BLOCKS[id]) return;
    const b = BLOCKS[id];
    const d = {
      id: b.id, key: b.key, cn: b.cn, shape: b.shape, render: b.render,
      solid: b.solid, bed: b.bed, opaque: b.opaque, opacity: b.opacity,
      light: b.light, hardness: b.hardness, tool: b.tool, level: b.level,
      needsTool: b.needsTool, sound: b.sound, tint: b.tint, gravity: b.gravity,
      replaceable: b.replaceable, cullSame: b.cullSame, climbable: b.climbable,
      facing: b.facing, axis: b.axis, needsSupport: b.needsSupport,
      flammable: b.flammable, fuel: b.fuel, noItem: b.noItem,
      damage: b.damage, slip: b.slip, tex: b.tex, overlay: b.overlay,
      texFront: b.texFront, texFrontOn: b.texFrontOn, particle: b.particle,
      slab: b.slab, stairs: b.stairs, door: b.door, trapdoor: b.trapdoor,
      ladder: b.ladder, redstone: b.redstone, button: b.button, plate: b.plate,
      lever: b.lever, repeater: b.repeater, comparator: b.comparator,
      observer: b.observer, piston: b.piston, sticky: b.sticky,
      pistonHead: b.pistonHead, fence: b.fence, rail: b.rail, web: b.web,
      hopper: b.hopper, brewing: b.brewing
    };
    const it = ITEMS[id] ? { id: ITEMS[id].id, key: ITEMS[id].key, cn: ITEMS[id].cn, block: ITEMS[id].block, stack: ITEMS[id].stack } : null;
    try {
      this.worker.postMessage({ type: 'syncBlock', block: d, item: it });
    } catch (_) {}
  }

  _buildWorkerScript() {
    const fnList = [
      clamp, lerp, smoothstep, mod, hash3, hashStr, RNG,
      rleEncode, rleDecode, ckey, T, syncBlockProps, defBlock, defItem,
      item, itemDef, makeStack, maxStack, logTex, stairBoxes, doorBoxes,
      ladderBoxes, buttonBoxes, leverBoxes, repeaterModel, comparatorModel,
      observerTex, pistonBoxes, pistonModel, pistonHeadBoxes, pistonHeadModel,
      pinkPetalsModel, brewingStandModel, fenceBoxes, railModel, anvilModel,
      bellModel, hopperModel, hopperBoxes, initAnimTable
    ];

    const lines = [
      `'use strict';`,
      `const CHUNK = ${CHUNK}, HEIGHT = ${HEIGHT}, SECTIONS = ${SECTIONS}, SEA = ${SEA};`,
      `const MAX_BLOCK_ID = ${MAX_BLOCK_ID}, BLOCK_CAP = ${BLOCK_CAP};`,
      `const SH_CUBE = 0, SH_CROSS = 1, SH_LIQUID = 2, SH_BOXES = 3, SH_TORCH = 4, SH_NONE = 5, SH_CROP = 6, SH_CACTUS = 7, SH_MODEL = 8, SH_WIRE = 9;`,
      `const AIR = 0, WATER = 7, LAVA = 8;`,
      `const VSTRIDE = ${VSTRIDE};`,
      `const DIRS = ${JSON.stringify(DIRS)};`,
      `const OPP = ${JSON.stringify(OPP)};`,
      `const SLAB_BOXES = ${JSON.stringify(SLAB_BOXES)};`,
      `const FLOWER_IDS = ${JSON.stringify(FLOWER_IDS)};`,
      `const WHEAT_TEX = ${JSON.stringify(WHEAT_TEX)};`,
      `const BIOMES = ${JSON.stringify(BIOMES)};`,
      `const BI = ${JSON.stringify(BI)};`,
      `const FACE_SHADE = ${JSON.stringify(FACE_SHADE)};`,
      `const AO_CURVE = ${JSON.stringify(AO_CURVE)};`,
      `const ASSETS = { tiles: ${JSON.stringify(ASSETS.tiles)}, anims: ${JSON.stringify(ASSETS.anims)} };`,
      `const BLOCKS = new Array(MAX_BLOCK_ID).fill(null);`,
      `const ITEMS = []; const ITEM_KEY = {}; const BID = {}; let nextIconIdx = 0; let nextItem = 256;`,
      `const OPACITY = new Uint8Array(BLOCK_CAP), EMIT = new Uint8Array(BLOCK_CAP), SOLIDCUBE = new Uint8Array(BLOCK_CAP);`,
      `const IS_FLUID = new Uint8Array(BLOCK_CAP), REPLACEABLE = new Uint8Array(BLOCK_CAP);`,
      `const OPAQUE = SOLIDCUBE, LIGHT_EMIT = EMIT;`,
      `const ANIM_FRAMES = new Uint8Array(1024);`,
      `const FACES = [`,
      `  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], uv: (x, y, z) => [z, 1 - y] },`,
      `  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], uv: (x, y, z) => [1 - z, 1 - y] },`,
      `  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: (x, y, z) => [x, 1 - z] },`,
      `  { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], uv: (x, y, z) => [x, z] },`,
      `  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], uv: (x, y, z) => [1 - x, 1 - y] },`,
      `  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], uv: (x, y, z) => [x, 1 - y] },`,
      `];`,
      `const BED_HEAD = ${JSON.stringify(BED_HEAD)};`,
      `const BED_FOOT = ${JSON.stringify(BED_FOOT)};`,
      Noise.toString(),
      `Noise.grad3 = new Float32Array(${JSON.stringify(Array.from(Noise.grad3))});`,
      Chunk.toString(),
      World.toString(),
      MeshBuffer.toString(),
    ];

    for (const fn of fnList) {
      if (typeof fn === 'function') lines.push(fn.toString());
    }

    // Serialize Structures if present
    if (typeof Structures !== 'undefined') {
      const sProps = [];
      for (const k of Object.keys(Structures)) {
        const v = Structures[k];
        if (typeof v === 'function') {
          const fs = v.toString().trim();
          sProps.push((fs.startsWith('function') || fs.startsWith('(')) ? `${k}: ${fs}` : fs);
        }
        else if (v instanceof Map) sProps.push(`${k}: new Map()`);
        else sProps.push(`${k}: ${JSON.stringify(v)}`);
      }
      lines.push(`const Structures = {\n${sProps.join(',\n')}\n};`);
    }

    // Serialize Mesher object
    const mProps = [];
    for (const k of Object.keys(Mesher)) {
      const v = Mesher[k];
      if (typeof v === 'function') {
        const fs = v.toString().trim();
        mProps.push((fs.startsWith('function') || fs.startsWith('(')) ? `${k}: ${fs}` : fs);
      }
    }
    lines.push(`const Mesher = {
      ids: new Uint16Array(18 * 18 * 18),
      metas: new Uint8Array(18 * 18 * 18),
      lights: new Uint8Array(18 * 18 * 18),
      tints: new Uint8Array(18 * 18 * 6),
      opaqueBuf: new MeshBuffer(65536),
      transBuf: new MeshBuffer(16384),
      transBotBuf: new MeshBuffer(8192),
      transTopBuf: new MeshBuffer(8192),
      ${mProps.join(',\n')}
    };`);

    // Reconstruct BLOCKS table inside Worker so Mesher & World.generate have identical block definitions
    lines.push(`initAnimTable();`);
    lines.push(`
      let workerWorld = null;
      let workerSessionId = 0;

      function applyBlocksBootstrap(blockDefs, itemDefs) {
        for (const d of blockDefs) {
          if (!d) continue;
          const b = Object.assign({}, d);
          if (b.key === 'grass_block') {
            b.texFn = function(face, meta) { return (meta & 1) && face !== 2 && face !== 3 ? T('grass_block_snow') : this.tex[face]; };
          } else if (b.axis) {
            b.texFn = logTex;
          } else if (b.key === 'farmland') {
            b.texFn = function(face, meta) { return face === 3 ? (meta ? T('farmland_moist') : T('farmland')) : this.tex[face]; };
          } else if (b.key === 'wheat') {
            b.texFn = function(face, meta) { return T(WHEAT_TEX[meta & 7]); };
          } else if (b.key === 'oak_door') {
            b.texFn = function(face, meta) { return (meta & 8) ? T('oak_door_top') : T('oak_door_bottom'); };
          } else if (b.key === 'cherry_door') {
            b.texFn = function(face, meta) { return (meta & 8) ? T('cherry_door_top') : T('cherry_door_bottom'); };
          } else if (b.key === 'observer') {
            b.texFn = observerTex;
          } else if (b.texFront) {
            b.texFn = (face, meta) => (face === (meta & 7) ? ((meta & 8) && b.texFrontOn ? b.texFrontOn : b.texFront) : b.tex[face]);
          }
          if (b.slab) b.boxes = (m) => SLAB_BOXES[m & 3];
          else if (b.stairs) b.boxes = stairBoxes;
          else if (b.door) b.boxes = doorBoxes;
          else if (b.ladder) b.boxes = ladderBoxes;
          else if (b.button) b.boxes = buttonBoxes;
          else if (b.lever) b.boxes = leverBoxes;
          else if (b.fence) b.boxes = fenceBoxes;
          else if (b.plate) b.boxes = (m) => [[1, 0, 1, 15, (m & 1) ? 0.5 : 1, 15]];
          else if (b.trapdoor) b.boxes = (m) => (m & 4) ? [[0, 0, 13, 16, 16, 16]] : (m & 8 ? [[0, 13, 0, 16, 16, 16]] : [[0, 0, 0, 16, 3, 16]]);
          else if (b.key === 'snow') b.boxes = () => [[0, 0, 0, 16, 2, 16]];
          else if (b.key === 'chest') b.boxes = () => [[1, 0, 1, 15, 14, 15]];
          else if (b.key === 'farmland' || b.key === 'dirt_path') b.boxes = () => [[0, 0, 0, 16, 15, 16]];
          else if (b.key === 'red_bed') { b.model = (m) => ({ els: (m & 4) ? BED_HEAD : BED_FOOT, rot: m & 3 }); b.boxes = () => [[0, 0, 0, 16, 9, 16]]; }
          else if (b.key === 'repeater') { b.model = (m) => repeaterModel(m, false); b.boxes = () => [[0, 0, 0, 16, 2, 16]]; }
          else if (b.key === 'lit_repeater') { b.model = (m) => repeaterModel(m, true); b.boxes = () => [[0, 0, 0, 16, 2, 16]]; }
          else if (b.key === 'comparator') { b.model = comparatorModel; b.boxes = () => [[0, 0, 0, 16, 2, 16]]; }
          else if (b.key === 'piston') { b.model = (m) => pistonModel(m, false); b.boxes = pistonBoxes; }
          else if (b.key === 'sticky_piston') { b.model = (m) => pistonModel(m, true); b.boxes = pistonBoxes; }
          else if (b.key === 'piston_head') { b.model = pistonHeadModel; b.boxes = pistonHeadBoxes; }
          else if (b.key === 'pink_petals') { b.model = pinkPetalsModel; b.boxes = () => [[0, 0, 0, 16, 2, 16]]; }
          else if (b.key === 'brewing_stand') { b.model = brewingStandModel; b.boxes = () => [[1, 0, 1, 15, 2, 15], [7, 0, 7, 9, 14, 9]]; }
          else if (b.key === 'rail') { b.model = railModel; b.boxes = () => [[0, 0, 0, 16, 2, 16]]; }
          else if (b.key === 'bell') { b.model = bellModel; b.boxes = () => [[0, 0, 4, 16, 16, 12]]; }
          else if (b.key === 'enchanting_table') { b.boxes = () => [[0, 0, 0, 16, 12, 16]]; }
          else if (b.key === 'anvil') { b.model = anvilModel; b.boxes = (m) => (m === 0 || m === 1) ? [[0, 0, 2, 16, 16, 14]] : [[2, 0, 0, 14, 16, 16]]; }
          else if (b.key === 'hopper') { b.model = hopperModel; b.boxes = hopperBoxes; }
          else if (b.key === 'redstone_wire') { b.boxes = () => [[0, 0, 0, 16, 2, 16]]; }
          BLOCKS[b.id] = b;
          BID[b.key] = b.id;
          syncBlockProps(b.id);
        }
        BID.test_block = 512;
        for (const it of itemDefs) {
          if (!it) continue;
          ITEMS[it.id] = it;
          ITEM_KEY[it.key] = it.id;
        }
        ITEM_KEY.test_block = 512;
      }

      self.onmessage = function(ev) {
        const msg = ev.data;
        if (!msg) return;
        try {
          if (msg.type === 'bootstrap') {
            applyBlocksBootstrap(msg.blocks, msg.items);
            self.postMessage({ type: 'ready' });
            return;
          }
          if (msg.type === 'syncBlock') {
            applyBlocksBootstrap(msg.block ? [msg.block] : [], msg.item ? [msg.item] : []);
            return;
          }
          if (msg.type === 'initWorld') {
            workerSessionId = msg.worldSessionId;
            if (typeof Structures !== 'undefined' && Structures.clearCaches) Structures.clearCaches();
            workerWorld = new World(msg.seed);
            workerWorld.flat = !!msg.flat;
            workerWorld.dimension = msg.dimension || 'overworld';
            workerWorld.grassMap = msg.grassMap;
            workerWorld.foliageMap = msg.foliageMap;
            return;
          }
          if (msg.type === 'generate') {
            if (!workerWorld || msg.worldSessionId !== workerSessionId) {
              self.postMessage({ type: 'aborted', taskId: msg.taskId, worldSessionId: msg.worldSessionId });
              return;
            }
            const ch = workerWorld.generate(msg.cx, msg.cz);
            const transfer = [
              ch.blocks.buffer,
              ch.meta.buffer,
              ch.grass.buffer,
              ch.foliage.buffer,
              ch.biome.buffer,
              ch.sectionCount.buffer
            ];
            self.postMessage({
              type: 'generated',
              taskId: msg.taskId,
              worldSessionId: msg.worldSessionId,
              dimension: msg.dimension || 'overworld',
              cx: msg.cx,
              cz: msg.cz,
              blocks: ch.blocks,
              meta: ch.meta,
              grass: ch.grass,
              foliage: ch.foliage,
              biome: ch.biome,
              sectionCount: ch.sectionCount,
              hasSurfaceStructure: !!ch.hasSurfaceStructure,
              village: ch.village || null,
              dungeon: ch.dungeon || null
            }, transfer);
            return;
          }
          if (msg.type === 'mesh') {
            if (msg.worldSessionId !== workerSessionId) {
              self.postMessage({ type: 'aborted', taskId: msg.taskId, worldSessionId: msg.worldSessionId });
              return;
            }
            Mesher.ids.set(msg.ids);
            Mesher.metas.set(msg.metas);
            Mesher.lights.set(msg.lights);
            Mesher.tints.set(msg.tints);
            const ob = Mesher.opaqueBuf, tb = Mesher.transBuf, tbb = Mesher.transBotBuf, ttb = Mesher.transTopBuf;
            ob.reset(); tb.reset(); tbb.reset(); ttb.reset();
            const ids = Mesher.ids;
            const ox = msg.cx * 16, oy = msg.sy * 16, oz = msg.cz * 16;
            for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
              const id = ids[((y + 1) * 18 + (z + 1)) * 18 + (x + 1)];
              if (!id) continue;
              Mesher.block(id, x, y, z, ox, oy, oz);
            }
            const opaque = ob.n ? ob.slice() : null;
            const nTrans = tb.n + tbb.n + ttb.n;
            let trans = null;
            if (nTrans) {
              trans = new Uint8Array(nTrans * VSTRIDE);
              let off = 0;
              if (tb.n) { trans.set(tb.u8.subarray(0, tb.n * VSTRIDE), off); off += tb.n * VSTRIDE; }
              if (tbb.n) { trans.set(tbb.u8.subarray(0, tbb.n * VSTRIDE), off); off += tbb.n * VSTRIDE; }
              if (ttb.n) { trans.set(ttb.u8.subarray(0, ttb.n * VSTRIDE), off); }
            }
            const transfer = [];
            if (opaque) transfer.push(opaque.buffer);
            if (trans) transfer.push(trans.buffer);
            self.postMessage({
              type: 'meshed',
              taskId: msg.taskId,
              worldSessionId: msg.worldSessionId,
              dimension: msg.dimension || 'overworld',
              cx: msg.cx,
              sy: msg.sy,
              cz: msg.cz,
              secRev: msg.secRev,
              opaque,
              trans,
              nOpaque: ob.n,
              nTrans
            }, transfer);
            return;
          }
        } catch (err) {
          self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
        }
      };
    `);

    return lines.join('\n');
  }

  _serializeBlocksForBootstrap() {
    const blockDefs = [];
    for (let i = 0; i < BLOCKS.length; i++) {
      const b = BLOCKS[i];
      if (!b) continue;
      blockDefs.push({
        id: b.id, key: b.key, cn: b.cn, shape: b.shape, render: b.render,
        solid: b.solid, bed: b.bed, opaque: b.opaque, opacity: b.opacity,
        light: b.light, hardness: b.hardness, tool: b.tool, level: b.level,
        needsTool: b.needsTool, sound: b.sound, tint: b.tint, gravity: b.gravity,
        replaceable: b.replaceable, cullSame: b.cullSame, climbable: b.climbable,
        facing: b.facing, axis: b.axis, needsSupport: b.needsSupport,
        flammable: b.flammable, fuel: b.fuel, noItem: b.noItem,
        damage: b.damage, slip: b.slip, tex: b.tex, overlay: b.overlay,
        texFront: b.texFront, texFrontOn: b.texFrontOn, particle: b.particle,
        slab: b.slab, stairs: b.stairs, door: b.door, trapdoor: b.trapdoor,
        ladder: b.ladder, redstone: b.redstone, button: b.button, plate: b.plate,
        lever: b.lever, repeater: b.repeater, comparator: b.comparator,
        observer: b.observer, piston: b.piston, sticky: b.sticky,
        pistonHead: b.pistonHead, fence: b.fence, rail: b.rail, web: b.web,
        hopper: b.hopper, brewing: b.brewing
      });
    }
    const itemDefs = [];
    for (let i = 0; i < ITEMS.length; i++) {
      const it = ITEMS[i];
      if (!it) continue;
      itemDefs.push({ id: it.id, key: it.key, cn: it.cn, block: it.block, stack: it.stack });
    }
    return { blockDefs, itemDefs };
  }

  _initWorker() {
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof Worker === 'undefined' || !URL.createObjectURL) {
      this._enterFallback('Worker API or Blob URL unavailable');
      return;
    }
    let blobUrl = null;
    try {
      const code = this._buildWorkerScript();
      const blob = new Blob([code], { type: 'application/javascript' });
      blobUrl = URL.createObjectURL(blob);
      this.worker = new Worker(blobUrl);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (_) {} }
      this._enterFallback('Worker construction failed: ' + (e && e.message ? e.message : e));
      return;
    }

    this._initTimer = setTimeout(() => {
      if (!this.ready && !this.fallback) {
        this._enterFallback('Worker handshake timeout (1500ms)');
      }
    }, 1500);

    this.worker.onmessage = (ev) => this._onMessage(ev.data);
    this.worker.onerror = (err) => {
      this._enterFallback('Worker runtime error: ' + (err && err.message ? err.message : 'unknown'));
    };

    try {
      const { blockDefs, itemDefs } = this._serializeBlocksForBootstrap();
      this.worker.postMessage({ type: 'bootstrap', blocks: blockDefs, items: itemDefs });
    } catch (e) {
      this._enterFallback('Worker bootstrap failed: ' + e.message);
    }
  }

  _enterFallback(reason) {
    if (this.fallback) return;
    this.fallback = true;
    this.ready = false;
    this.fallbackReason = reason || 'fallback';
    if (this._initTimer) { clearTimeout(this._initTimer); this._initTimer = null; }
    if (this._taskTimer) { clearTimeout(this._taskTimer); this._taskTimer = null; }
    if (this.worker) {
      try { this.worker.terminate(); } catch (_) {}
      this.worker = null;
    }
    const pending = [...this.queue];
    if (this.activeTask) pending.unshift(this.activeTask);
    this.queue.length = 0;
    this.taskByKey.clear();
    this.activeTask = null;
    this.inFlight = 0;

    // Drain any pending generate/mesh tasks synchronously on main thread
    const g = this.game, w = g && g.world;
    if (!w) return;
    for (const t of pending) {
      if (t.worldSessionId !== this.worldSessionId) continue;
      if (t.type === 'generate') {
        const ck = ckey(t.cx, t.cz);
        if (w.generatingChunks) w.generatingChunks.delete(ck);
        if (!w.chunks.has(ck)) {
          const ch = g.loadChunk(t.cx, t.cz);
          if (t.resolve) t.resolve(ch);
        }
      } else if (t.type === 'mesh') {
        const ch = w.getChunk(t.cx, t.cz);
        if (ch) {
          ch.meshingMask &= ~(1 << t.sy);
          g.meshChunk(ch);
        }
      }
    }
  }

  resetSession(worldSessionId, world) {
    this.worldSessionId = worldSessionId;
    this.dimension = (world && world.dimension) || 'overworld';
    // Clear pending queue from previous world session
    for (const t of this.queue) {
      if (t.resolve) t.resolve(null);
    }
    this.queue.length = 0;
    this.taskByKey.clear();
    if (this.activeTask && this.activeTask.resolve) {
      this.activeTask.resolve(null);
    }
    if (world && !world.generatingChunks) {
      world.generatingChunks = new Set();
    }
    if (this.isReady() && world) {
      this._sendInitWorld(world);
    }
  }

  _sendInitWorld(world) {
    if (!this.worker || !world) return;
    this.worker.postMessage({
      type: 'initWorld',
      worldSessionId: this.worldSessionId,
      seed: world.seed,
      flat: !!world.flat,
      dimension: world.dimension || 'overworld',
      grassMap: new Uint8Array(world.grassMap || new Uint8Array(256 * 256 * 4)),
      foliageMap: new Uint8Array(world.foliageMap || new Uint8Array(256 * 256 * 4)),
    });
  }

  cancelGenerate(cx, cz) {
    const key = `gen:${cx}:${cz}`;
    const existing = this.taskByKey.get(key);
    if (existing) {
      this.taskByKey.delete(key);
      const idx = this.queue.indexOf(existing);
      if (idx >= 0) this.queue.splice(idx, 1);
      if (existing.resolve) existing.resolve(null);
    }
    if (this.game && this.game.world && this.game.world.generatingChunks) {
      this.game.world.generatingChunks.delete(ckey(cx, cz));
    }
  }

  enqueueGenerate(cx, cz, distSq = 0) {
    const g = this.game, w = g.world;
    if (!this.isReady() || !w) {
      return Promise.resolve(g.loadChunk(cx, cz));
    }
    const ck = ckey(cx, cz);
    if (w.chunks.has(ck)) return Promise.resolve(w.chunks.get(ck));
    if (!w.generatingChunks) w.generatingChunks = new Set();

    const key = `gen:${cx}:${cz}`;
    const tier = distSq <= 16 ? 1 : 3;
    const existing = this.taskByKey.get(key);
    if (existing) {
      if (tier < existing.tier || (tier === existing.tier && distSq < existing.distSq)) {
        existing.tier = tier;
        existing.distSq = distSq;
        this._sortQueue();
      }
      return existing.promise;
    }

    w.generatingChunks.add(ck);
    let resolveFn;
    const promise = new Promise((res) => { resolveFn = res; });
    const task = {
      taskId: (this._nextTaskId = (this._nextTaskId || 0) + 1),
      type: 'generate',
      key,
      tier,
      distSq,
      cx,
      cz,
      worldSessionId: this.worldSessionId,
      dimension: w.dimension || 'overworld',
      promise,
      resolve: resolveFn,
    };
    this.taskByKey.set(key, task);
    this.queue.push(task);
    this._sortQueue();
    this._pump();
    return promise;
  }

  enqueueMesh(cx, sy, cz, distSq = 0, urgent = false) {
    const g = this.game, w = g.world;
    if (!w) return;
    const ch = w.getChunk(cx, cz);
    if (!ch) return;
    if (!this.isReady()) {
      g.meshChunk(ch);
      return;
    }
    const key = `mesh:${cx}:${sy}:${cz}`;
    const tier = urgent ? 0 : 2;
    const secRev = ch.secRev ? ch.secRev[sy] : 0;
    ch.meshingMask |= (1 << sy);

    const existing = this.taskByKey.get(key);
    if (existing) {
      existing.secRev = secRev;
      if (tier < existing.tier || (tier === existing.tier && distSq < existing.distSq)) {
        existing.tier = tier;
        existing.distSq = distSq;
        this._sortQueue();
      }
      return;
    }

    const task = {
      taskId: (this._nextTaskId = (this._nextTaskId || 0) + 1),
      type: 'mesh',
      key,
      tier,
      distSq,
      cx,
      sy,
      cz,
      secRev,
      worldSessionId: this.worldSessionId,
      dimension: w.dimension || 'overworld',
    };
    this.taskByKey.set(key, task);
    this.queue.push(task);
    this._sortQueue();
    this._pump();
  }

  _sortQueue() {
    this.queue.sort((a, b) => (a.tier - b.tier) || (a.distSq - b.distSq));
  }

  _pump() {
    if (!this.isReady() || this.inFlight >= this.maxInFlight || !this.queue.length) return;
    const g = this.game, w = g && g.world;
    if (!w) return;

    while (this.queue.length) {
      const task = this.queue.shift();
      this.taskByKey.delete(task.key);
      if (task.worldSessionId !== this.worldSessionId) {
        if (task.resolve) task.resolve(null);
        continue;
      }

      if (task.type === 'generate') {
        const ck = ckey(task.cx, task.cz);
        if (w.chunks.has(ck) || w.loadingChunks.has(ck) || (w.savedChunks && w.savedChunks.has(ck)) || (w.modifiedChunkKeys && w.modifiedChunkKeys.has(ck))) {
          if (w.generatingChunks) w.generatingChunks.delete(ck);
          if (task.resolve) task.resolve(w.chunks.get(ck) || null);
          continue;
        }
        this.inFlight = 1;
        this.activeTask = task;
        this._armTaskTimeout();
        this.worker.postMessage({
          type: 'generate',
          taskId: task.taskId,
          worldSessionId: task.worldSessionId,
          dimension: task.dimension,
          cx: task.cx,
          cz: task.cz,
        });
        return;
      }

      if (task.type === 'mesh') {
        const ch = w.getChunk(task.cx, task.cz);
        if (!ch || !(ch.dirty & (1 << task.sy))) {
          if (ch) ch.meshingMask &= ~(1 << task.sy);
          continue;
        }
        if (!ch.sectionCount[task.sy]) {
          const skey = ckey(ch.cx, ch.cz) * 16 + task.sy;
          const s = g.renderer.sections.get(skey);
          if (s) { g.renderer.freeSection(s); g.renderer.sections.delete(skey); }
          ch.dirty &= ~(1 << task.sy);
          ch.meshingMask &= ~(1 << task.sy);
          continue;
        }
        // Check 3x3 neighbors are still loaded
        let ok = true;
        for (let a = -1; a <= 1 && ok; a++) {
          for (let b = -1; b <= 1; b++) {
            if (!w.chunks.has(ckey(task.cx + a, task.cz + b))) { ok = false; break; }
          }
        }
        if (!ok) {
          ch.meshingMask &= ~(1 << task.sy);
          continue;
        }
        // Gather a fresh 18^3 neighborhood copy on main thread so Transferable NEVER touches ch.blocks!
        const snap = Mesher.gatherSnapshot(w, task.cx, task.sy, task.cz);
        const curRev = ch.secRev ? ch.secRev[task.sy] : 0;
        task.secRev = curRev;
        this.inFlight = 1;
        this.activeTask = task;
        this._armTaskTimeout();
        this.worker.postMessage({
          type: 'mesh',
          taskId: task.taskId,
          worldSessionId: task.worldSessionId,
          dimension: task.dimension,
          cx: task.cx,
          sy: task.sy,
          cz: task.cz,
          secRev: curRev,
          ids: snap.ids,
          metas: snap.metas,
          lights: snap.lights,
          tints: snap.tints,
        }, [snap.ids.buffer, snap.metas.buffer, snap.lights.buffer, snap.tints.buffer]);
        return;
      }
    }
  }

  _armTaskTimeout() {
    if (this._taskTimer) clearTimeout(this._taskTimer);
    this._taskTimer = setTimeout(() => {
      if (this.inFlight > 0 && !this.fallback) {
        this._enterFallback('Worker task timeout (3000ms)');
      }
    }, 3000);
  }

  _onMessage(msg) {
    if (!msg) return;
    if (msg.type === 'ready') {
      if (this._initTimer) { clearTimeout(this._initTimer); this._initTimer = null; }
      this.ready = true;
      if (this.game && this.game.world) {
        this._sendInitWorld(this.game.world);
      }
      this._pump();
      return;
    }
    if (msg.type === 'error') {
      this._enterFallback('Worker reported error: ' + msg.message);
      return;
    }

    if (this._taskTimer) { clearTimeout(this._taskTimer); this._taskTimer = null; }
    const doneTask = this.activeTask;
    this.activeTask = null;
    this.inFlight = 0;

    const g = this.game, w = g && g.world;
    if (!w || msg.worldSessionId !== this.worldSessionId) {
      if (doneTask && doneTask.resolve) doneTask.resolve(null);
      this._pump();
      return;
    }

    if (msg.type === 'generated') {
      const ck = ckey(msg.cx, msg.cz);
      if (w.generatingChunks) w.generatingChunks.delete(ck);
      if (w.chunks.has(ck) || w.loadingChunks.has(ck) || (w.savedChunks && w.savedChunks.has(ck)) || (w.modifiedChunkKeys && w.modifiedChunkKeys.has(ck))) {
        if (doneTask && doneTask.resolve) doneTask.resolve(w.chunks.get(ck) || null);
        this._pump();
        return;
      }
      const ch = new Chunk(msg.cx, msg.cz);
      ch.blocks = msg.blocks;
      ch.meta = msg.meta;
      ch.grass = msg.grass;
      ch.foliage = msg.foliage;
      ch.biome = msg.biome;
      ch.sectionCount = msg.sectionCount;
      ch.hasSurfaceStructure = !!msg.hasSurfaceStructure;
      if (msg.village) ch.village = msg.village;
      if (msg.dungeon) ch.dungeon = msg.dungeon;
      g._mountLoadedChunk(msg.cx, msg.cz, ch, false);
      if (doneTask && doneTask.resolve) doneTask.resolve(ch);
      this._pump();
      return;
    }

    if (msg.type === 'meshed') {
      const ch = w.getChunk(msg.cx, msg.cz);
      if (ch) {
        ch.meshingMask &= ~(1 << msg.sy);
        const curRev = ch.secRev ? ch.secRev[msg.sy] : 0;
        if (msg.secRev === curRev) {
          const skey = ckey(msg.cx, msg.cz) * 16 + msg.sy;
          g.renderer.setSection(skey, msg.cx, msg.sy, msg.cz, {
            opaque: msg.opaque,
            trans: msg.trans,
            nOpaque: msg.nOpaque,
            nTrans: msg.nTrans,
          });
          ch.dirty &= ~(1 << msg.sy);
        } else {
          // Section was modified while Worker was meshing; re-enqueue if still dirty
          if (ch.dirty & (1 << msg.sy)) {
            this.enqueueMesh(msg.cx, msg.sy, msg.cz, 0, true);
          }
        }
      }
      this._pump();
      return;
    }

    if (doneTask && doneTask.resolve) doneTask.resolve(null);
    this._pump();
  }
}
