'use strict';

// ---------------------------------------------------------------------------
// Game: state, main loop, chunk streaming, interaction, rendering glue
// ---------------------------------------------------------------------------
const ADVANCEMENTS = {
  wood: ['获得木头', 'oak_log'], crafting_table: ['这是？工作台！', 'crafting_table'], pickaxe: ['采矿时间到！', 'wooden_pickaxe'],
  stone_pickaxe: ['获得升级', 'stone_pickaxe'], furnace: ['热腾腾的', 'furnace'], iron: ['来硬的', 'iron_ingot'],
  diamond: ['钻石！', 'diamond'], redstone: ['红石工程师', 'redstone'], bread: ['烤面包', 'bread'], kill: ['怪物猎人', 'iron_sword'], armor: ['整装上阵', 'iron_chestplate'],
  tnt: ['轰隆隆！', 'tnt'], deep: ['深入地底', 'deepslate'], night: ['活过第一夜', 'torch'], build: ['建筑师', 'bricks'], farm: ['开始耕作', 'wheat'],
  cook: ['美味佳肴', 'cooked_beef'], bow: ['狙击手', 'bow'], sleep: ['甜蜜的梦', 'red_bed'], enchant: ['附魔师', 'enchanting_table'],
  brew: ['本地酿造厂', 'brewing_stand'],
  nether: ['我们需要再深入些', 'obsidian'],
  eye_spy: ['隔墙有眼', 'eye_of_ender'],
  the_end: ['结束了？', 'end_stone'],
  end_dragon: ['解放末地', 'dragon_egg'],
};

const TUTORIAL = [
  { title: '移动', text: '使用 W A S D 键四处走走', icon: 'grass_block', done: (g) => g.tutStat.moved > 8 },
  { title: '获取木头', text: '对着树干按住鼠标左键', icon: 'oak_log', done: (g) => g.adv.wood },
  { title: '打开物品栏', text: '按 E 键打开物品栏', icon: 'chest', done: (g) => g.tutStat.inv },
  { title: '合成木板', text: '用左侧配方书或 2x2 合成格', icon: 'oak_planks', done: (g) => g.tutStat.planks },
  { title: '制作工作台', text: '用 4 个木板合成工作台', icon: 'crafting_table', done: (g) => g.adv.crafting_table },
  { title: '制作木镐', text: '放下工作台，右键打开它', icon: 'wooden_pickaxe', done: (g) => g.adv.pickaxe },
];

class Game {
  constructor() {
    this.settings = Object.assign({ fov: 70, renderDist: 8, sens: 0.5, volume: 0.8, music: 0.45, gamma: 0.5, guiScale: 0, clouds: true, bobbing: true, advTooltips: false, resScale: 1 }, this.loadSettings());
    this.state = 'boot';
    this.mode = 'survival';
    this.worldSessionId = 0;
    this.worker = null;
    this.entities = []; this.blockEntities = new Map();
    this.keys = {}; this.mouseBtn = [false, false, false];
    this.tickCount = 0; this.worldTime = 1000; this.fps = 0;
    this.perspective = 0;
    this.weather = 0; this.rainTarget = 0; this.weatherTimer = 12000 + Math.random() * 24000;
    this.breaking = null; this.useCd = 0; this.attackCd = 0;
    this.stats = { kills: 0, placed: 0, mined: 0 };
    this.adv = {};
    this.lastTap = {};
    this.sleepFade = 0;
  }
  loadSettings() { try { return JSON.parse(localStorage.getItem('mcjs-settings') || '{}'); } catch (e) { return {}; } }
  saveSettings() { try { localStorage.setItem('mcjs-settings', JSON.stringify(this.settings)); } catch (e) { } }

  async init() {
    this.canvas = document.getElementById('gl');
    this.renderer = new Renderer(this.canvas);
    this.renderer.resScale = this.settings.resScale;
    await this.renderer.init();
    Font.init(this.renderer.images.font);
    this.renderer.buildIcons();
    if (typeof WorldWorker !== 'undefined') this.worker = new WorldWorker(this);
    this.ui = new UI(this, document.getElementById('ui'));
    this.particles = new Particles(this);
    this.applySettings();
    await DB.open();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    bindInput(this);
    this.startTitle();
    let last = performance.now(), acc = 0, frames = 0, fpsT = last;
    const loop = (now) => {
      requestAnimationFrame(loop);
      let dt = now - last; last = now;
      if (dt > 250) dt = 250;
      acc += dt;
      frames++;
      if (now - fpsT > 1000) { this.fps = frames; frames = 0; fpsT = now; }
      if (this.debugPause) { try { this.render(1, now); } catch (e) { console.error(e); } return; }
      try {
        this.frame(dt, now);
        let n = 0;
        while (acc >= 50 && n < 5) {
          acc -= 50; n++;
          try { this.tick(); } catch (te) { console.error(te); this.showError(te); }
        }
        if (n === 5) acc = 0;
        this.render(acc / 50, now);
      } catch (e) { console.error(e); this.showError(e); }
    };
    requestAnimationFrame(loop);
  }
  showError(e) {
    if (this._errShown) return; this._errShown = true;
    this.ui.message('错误: ' + (e && e.message || e), '#FF5555');
  }
  applySettings() {
    const s = this.settings;
    this.renderer.renderDist = s.renderDist; this.renderer.gamma = s.gamma; this.renderer.showClouds = s.clouds;
    Sound.setVolume(s.volume); Sound.setMusic(s.music);
    if (this.renderer.resScale !== s.resScale) { this.renderer.resScale = s.resScale; this.resize(); }
  }
  resize() { this.renderer.resize(); if (this.ui) this.ui.resize(); }

  // ---- worlds -----------------------------------------------------------------
  setupWorld(seed, dimension = 'overworld') {
    this.worldSessionId = (this.worldSessionId || 0) + 1;
    if (this.world) this.unloadAll();
    if (typeof Structures !== 'undefined' && Structures.clearCaches) Structures.clearCaches();
    this.world = new World(seed, dimension);
    this.world.grassMap = this.renderer.grassMap; this.world.foliageMap = this.renderer.foliageMap;
    this.world.listener = this;
    this.entities = []; this.blockEntities = new Map(); this.particles.list = [];
    this.genQueue = []; this.meshQueue = [];
    this._loadingPromises = new Map();
    this.spawnedChunks = new Set();
    if (this.worker) this.worker.resetSession(this.worldSessionId, this.world);
  }
  unloadAll() {
    for (const ch of this.world.chunks.values()) this.renderer.dropChunk(ch.cx, ch.cz);
    this.world.chunks.clear();
    this.renderer.sections.clear();
  }
  startTitle() {
    this.state = 'title';
    this.setupWorld(hashStr('panorama' + ((Math.random() * 8) | 0)), 'overworld');
    const sp = this.findInland();
    this.player = new Player(this, sp[0], sp[1] + 6, sp[2]);
    this.titleCam = [sp[0] + 0.5, sp[1] + 16, sp[2] + 0.5];
    this.worldTime = 2000; this.weather = 0; this.rainTarget = 0;
    this.ui.open(new TitleScreen(this));
  }
  findInland() {
    const w = this.world;
    for (let r = 0; r < 3000; r += 48) for (let a = 0; a < 12; a++) {
      const x = Math.round(Math.cos(a / 12 * Math.PI * 2) * r), z = Math.round(Math.sin(a / 12 * Math.PI * 2) * r);
      const c = w.column(x, z);
      if (c.h < SEA + 4 || c.h > 105) continue;
      let ok = true;
      for (let k = 0; k < 8 && ok; k++) { const cc = w.column(x + Math.cos(k / 8 * Math.PI * 2) * 56, z + Math.sin(k / 8 * Math.PI * 2) * 56); if (cc.h <= SEA + 1) ok = false; }
      if (ok) { let top = c.h; for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) top = Math.max(top, w.column(x + dx, z + dz).h + (w.biomeOf(w.column(x + dx, z + dz)) === BI.FOREST ? 7 : 0)); return [x, top, z]; }
      if (r === 0) break;
    }
    return this.findSpawn();
  }
  findSpawn() {
    const w = this.world;
    if (w.flat) return [0, 61, 0];
    for (let r = 0; r < 400; r += 8) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(Math.cos(a / 16 * Math.PI * 2) * r), z = Math.round(Math.sin(a / 16 * Math.PI * 2) * r);
        const c = w.column(x, z), b = w.biomeOf(c);
        if (c.h > SEA + 1 && c.h < 100 && b !== BI.OCEAN && b !== BI.RIVER && b !== BI.BEACH) return [x, c.h + 1, z];
        if (r === 0) break;
      }
    }
    return [0, 80, 0];
  }
  async createWorld(name, seedStr, mode, flat) {
    let seed = parseInt(seedStr, 10);
    if (!seedStr) seed = (Math.random() * 2 ** 31) | 0;
    else if (isNaN(seed) || String(seed) !== seedStr.trim()) seed = hashStr(seedStr);
    const id = 'w' + Date.now().toString(36);
    const meta = { id, name: name || '新的世界', seed, mode, flat: !!flat, dimension: 'overworld', dimensions: {}, created: Date.now(), lastPlayed: Date.now(), time: 1000, player: null, schemaVersion: 2, blockBits: 16, modifiedChunkKeys: [] };
    await DB.putWorld(meta);
    return this.loadWorld(id);
  }
  async loadWorld(id) {
    const meta = await DB.getWorld(id);
    if (!meta) return;
    this.ui.open(new LoadingScreen(this, '正在载入世界…'));
    this.worldMeta = meta;
    if (!meta.dimensions) meta.dimensions = {};
    const initDim = (meta.player && meta.player.dimension) || meta.dimension || 'overworld';
    this.setupWorld(meta.seed, initDim);
    this.world.flat = (initDim === 'overworld') && !!meta.flat;
    if (this.worker) this.worker.resetSession(this.worldSessionId, this.world);
    const loadedChunks = await DB.loadChunks(id, meta.blockBits, initDim);
    this.dirtySaved = new Set();
    const dimMeta = meta.dimensions[initDim] || (initDim === 'overworld' ? meta : {});
    this.world.setSavedChunks(loadedChunks, dimMeta.modifiedChunkKeys || []);
    this.mode = meta.mode;
    this.worldTime = meta.time || 1000;
    this.weather = meta.weather || 0; this.rainTarget = meta.rainTarget || 0;
    this.adv = meta.adv || {}; this.stats = meta.stats || { kills: 0, placed: 0, mined: 0 };
    this.tutorial = meta.tutorial ?? (meta.mode === 'survival' ? 0 : -1); this.tutStat = { moved: 0 };
    let sp = meta.spawn || this.findSpawn();
    const p = this.player = new Player(this, sp[0] + 0.5, sp[1], sp[2] + 0.5);
    p.spawn = sp;
    if (meta.player) {
      const d = meta.player;
      p.pos = [...d.pos]; p.prev = [...d.pos]; p.yaw = d.yaw; p.pitch = d.pitch;
      p.health = d.health; p.food = d.food; p.saturation = d.sat; p.xp = d.xp || 0; p.flying = !!d.flying;
      p.enchantSeed = d.enchantSeed || 1337;
      p.inv.slots = d.inv.map(s => s ? { ...s, ench: s.ench ? { ...s.ench } : undefined } : null); while (p.inv.slots.length < 41) p.inv.slots.push(null);
      p.inv.sel = d.sel || 0;
      p.air = 300;
      p.effects = {};
      if (d.effects && typeof d.effects === 'object') {
        for (const [ek, ev] of Object.entries(d.effects)) {
          if (ev && ev.ticks > 0) {
            const ticks = ev.ticks | 0;
            const maxTicks = (ev.maxTicks || ev.duration || ticks) | 0;
            const amp = ev.amp !== undefined ? (ev.amp | 0) : 0;
            p.effects[ek] = { id: ek, ticks, maxTicks, duration: maxTicks, amp, level: amp + 1 };
          }
        }
      }
    } else {
      p.needsGround = true;
      p.enchantSeed = ((Math.random() * 0x7FFFFFFF) | 0) || 1337;
      if (this.mode === 'creative') this.giveCreativeKit();
    }
    this.world.evictColdChunks(Math.floor(p.pos[0]) >> 4, Math.floor(p.pos[2]) >> 4, this.dirtySaved);
    for (const [k, v] of Object.entries(dimMeta.blockEntities || {})) this.blockEntities.set(k, v);
    this.pendingMobs = (dimMeta.mobs || []).map(m => ({
      ...m,
      pos: [...m.pos],
      trades: Array.isArray(m.trades) && typeof Trading !== 'undefined' ? m.trades.map(t => Trading.cloneTrade(t)) : m.trades,
    }));
    this.spawnedChunks = new Set(dimMeta.spawnedChunks || []);
    this._dragonKilled = !!meta.dragonKilled;
    this.state = 'loading';
    this.loadStart = performance.now();
    if (initDim === 'end') {
      if (Array.isArray(dimMeta.crystals)) {
        for (const cPos of dimMeta.crystals) {
          this.entities.push(new EndCrystal(this, cPos[0], cPos[1], cPos[2]));
        }
      }
      this.initEndBossFight(Array.isArray(dimMeta.crystals));
    }
  }
  giveCreativeKit() {
    const inv = this.player.inv;
    ['grass_block', 'stone', 'oak_planks', 'redstone', 'redstone_torch', 'repeater', 'lever', 'redstone_lamp', 'tnt'].forEach((k, i) => inv.slots[i] = makeStack(k, 64));
  }
  serializeMob(e) {
    const out = { type: e.type, pos: [...e.pos], yaw: e.yaw, health: e.health, sheared: !!e.sheared, wool: e.woolColor || 0, baby: e.baby ? e.growT : 0 };
    if (e.profession !== undefined) out.profession = e.profession;
    if (e.trades !== undefined) {
      out.trades = Array.isArray(e.trades) && typeof Trading !== 'undefined'
        ? e.trades.map(t => Trading.cloneTrade(t))
        : e.trades;
    }
    if (e.xp !== undefined) out.xp = e.xp;
    if (e.level !== undefined) out.level = e.level;
    if (e.restockDay !== undefined) out.restockDay = e.restockDay;
    return out;
  }
  evictColdSavedChunks() {
    const w = this.world;
    if (!w || !w.savedChunks || w.savedChunks.size <= 128) return;
    const center = this.state === 'title' ? (this.titleCam || [0, 0, 0]) : (this.player ? this.player.pos : [0, 0, 0]);
    const pcx = Math.floor(center[0]) >> 4, pcz = Math.floor(center[2]) >> 4;
    w.evictColdChunks(pcx, pcz, this.dirtySaved, 128);
    if (w.savedChunks.size > 128 && this.dirtySaved && this.dirtySaved.size > 0 && !this._flushingDirty) {
      this.flushDirtySavedChunks();
    }
  }
  async flushDirtySavedChunks() {
    if (!this.worldMeta || !this.dirtySaved || !this.dirtySaved.size || this._flushingDirty) return;
    this._flushingDirty = true;
    const w = this.world;
    const curDim = (w && w.dimension) || 'overworld';
    const dirtyKeys = [...this.dirtySaved];
    const list = [];
    for (const k of dirtyKeys) {
      const rec = w.savedChunks.get(k);
      if (rec) {
        const cx = Math.floor(k / 65536) - 32768, cz = (k % 65536) - 32768;
        list.push([cx, cz, rec]);
      }
    }
    try {
      await DB.putChunks(this.worldMeta.id, list, curDim);
      for (const k of dirtyKeys) this.dirtySaved.delete(k);
      if (this.world === w) {
        const center = this.player ? this.player.pos : [0, 0, 0];
        w.evictColdChunks(Math.floor(center[0]) >> 4, Math.floor(center[2]) >> 4, this.dirtySaved, 128);
      }
    } catch (e) {
      console.error('flushDirtySavedChunks error', e);
    } finally {
      this._flushingDirty = false;
    }
  }
  async saveWorld(quiet) {
    if (!this.worldMeta || (this.state !== 'play' && this.state !== 'loading')) return;
    const w = this.world, p = this.player, list = [], modChunks = [];
    const curDim = (w && w.dimension) || 'overworld';
    for (const ch of w.chunks.values()) if (ch.modified) {
      const k = ckey(ch.cx, ch.cz);
      const rec = encodeChunk(ch);
      w.savedChunks.set(k, rec);
      w.modifiedChunkKeys.add(k);
      list.push([ch.cx, ch.cz, rec]);
      modChunks.push(ch);
    }
    const dirtyKeys = [...(this.dirtySaved || [])];
    for (const k of dirtyKeys) {
      const rec = w.savedChunks.get(k);
      if (rec) { const cx = Math.floor(k / 65536) - 32768, cz = (k % 65536) - 32768; list.push([cx, cz, rec]); }
    }
    const m = this.worldMeta;
    m.schemaVersion = 2; m.blockBits = 16;
    m.lastPlayed = Date.now(); m.time = this.worldTime; m.mode = this.mode; m.weather = this.weather; m.rainTarget = this.rainTarget;
    m.dimension = curDim;
    m.dragonKilled = !!this._dragonKilled;
    m.spawn = p.spawn; m.adv = this.adv; m.stats = this.stats; m.tutorial = this.tutorial;
    const savedEffects = {};
    if (p.effects) {
      for (const [ek, ev] of Object.entries(p.effects)) {
        if (ev && ev.ticks > 0) {
          const ticks = ev.ticks | 0;
          const maxTicks = (ev.maxTicks || ev.duration || ticks) | 0;
          const amp = ev.amp !== undefined ? (ev.amp | 0) : 0;
          savedEffects[ek] = { id: ek, ticks, maxTicks, duration: maxTicks, amp, level: amp + 1 };
        }
      }
    }
    m.player = { pos: [...p.pos], dimension: curDim, yaw: p.yaw, pitch: p.pitch, health: p.health, food: p.food, sat: p.saturation, xp: p.xp, enchantSeed: p.enchantSeed || 1337, inv: p.inv.slots.map(s => s ? { ...s, ench: s.ench ? { ...s.ench } : undefined } : null), sel: p.inv.sel, flying: p.flying, effects: savedEffects };
    const dimBlockEntities = Object.fromEntries(this.blockEntities);
    const activeMobs = this.entities.filter(e => e instanceof Mob && e.persistent && !e.dead && !e.deathTime && e.health > 0).map(e => this.serializeMob(e));
    const dimMobs = [...(this.pendingMobs || []), ...activeMobs];
    const dimSpawned = [...(this.spawnedChunks || [])];
    const dimModKeys = [...w.modifiedChunkKeys];
    if (!m.dimensions) m.dimensions = {};
    const dimCrystals = curDim === 'end'
      ? this.entities.filter(e => e instanceof EndCrystal && !e.dead).map(e => [...e.pos])
      : undefined;
    m.dimensions[curDim] = {
      blockEntities: dimBlockEntities,
      mobs: dimMobs,
      spawnedChunks: dimSpawned,
      modifiedChunkKeys: dimModKeys,
      portals: (m.dimensions[curDim] && m.dimensions[curDim].portals) || [],
      ...(dimCrystals !== undefined ? { crystals: dimCrystals } : {}),
    };
    if (curDim === 'overworld') {
      m.blockEntities = dimBlockEntities;
      m.mobs = dimMobs;
      m.spawnedChunks = dimSpawned;
      m.modifiedChunkKeys = dimModKeys;
    }
    try {
      await DB.putChunks(m.id, list, curDim);
      await DB.putWorld(m);
      for (const ch of modChunks) ch.modified = false;
      if (this.dirtySaved) for (const k of dirtyKeys) this.dirtySaved.delete(k);
      w.evictColdChunks(Math.floor(p.pos[0]) >> 4, Math.floor(p.pos[2]) >> 4, this.dirtySaved, 128);
      if (!quiet) this.ui.message('世界已保存', '#AAAAAA');
    } catch (e) { this.ui.message('保存失败: ' + e.message, '#FF5555'); }
  }

  // ---- Guard Rule #5: Single-Active-Dimension Switching & 8:1 Portal Scaling ----
  tryIgnitePortal(x, y, z) {
    const w = this.world;
    if (!w || y <= 1 || y >= HEIGHT - 4) return false;
    const cur = w.getBlock(x, y, z);
    if (cur !== 0 && cur !== 537) return false;

    for (const axis of [0, 1]) {
      const dx = axis === 0 ? 1 : 0, dz = axis === 1 ? 1 : 0;
      // 1. Scan downward to find bottom obsidian frame
      let bottomY = y;
      while (bottomY > 1 && (w.getBlock(x, bottomY - 1, z) === 0 || w.getBlock(x, bottomY - 1, z) === 537) && (y - bottomY) <= 21) {
        bottomY--;
      }
      if (w.getBlock(x, bottomY - 1, z) !== 28) continue;

      // 2. Scan left (-dir) and right (+dir) along bottomY
      let left = 0;
      while (left < 22) {
        const bid = w.getBlock(x - dx * (left + 1), bottomY, z - dz * (left + 1));
        if (bid === 0 || bid === 537) left++;
        else break;
      }
      let right = 0;
      while (right < 22) {
        const bid = w.getBlock(x + dx * (right + 1), bottomY, z + dz * (right + 1));
        if (bid === 0 || bid === 537) right++;
        else break;
      }
      const width = left + right + 1;
      if (width < 2 || width > 21) continue;
      const startX = x - dx * left, startZ = z - dz * left;
      if (w.getBlock(startX - dx, bottomY, startZ - dz) !== 28) continue;
      if (w.getBlock(startX + dx * width, bottomY, startZ + dz * width) !== 28) continue;

      // 3. Scan upward to find height H (3..21)
      let height = 0;
      let validFrame = true;
      while (height < 22) {
        const cy = bottomY + height;
        if (cy >= HEIGHT - 1) { validFrame = false; break; }
        // Check if this row is the top obsidian border
        let allTopObsidian = true;
        for (let i = 0; i < width; i++) {
          if (w.getBlock(startX + dx * i, cy, startZ + dz * i) !== 28) { allTopObsidian = false; break; }
        }
        if (allTopObsidian) break;
        // Otherwise check left & right obsidian walls and empty interior
        if (w.getBlock(startX - dx, cy, startZ - dz) !== 28 || w.getBlock(startX + dx * width, cy, startZ + dz * width) !== 28) {
          validFrame = false;
          break;
        }
        for (let i = 0; i < width; i++) {
          const bid = w.getBlock(startX + dx * i, cy, startZ + dz * i);
          if (bid !== 0 && bid !== 537) { validFrame = false; break; }
        }
        if (!validFrame) break;
        height++;
      }
      if (!validFrame || height < 3 || height > 21) continue;

      // 4. Verify bottom obsidian border and top obsidian border
      for (let i = 0; i < width; i++) {
        if (w.getBlock(startX + dx * i, bottomY - 1, startZ + dz * i) !== 28) { validFrame = false; break; }
        if (w.getBlock(startX + dx * i, bottomY + height, startZ + dz * i) !== 28) { validFrame = false; break; }
      }
      if (!validFrame) continue;

      // 5. Fill interior with nether_portal (528, meta = axis) without triggering intermediate cascade breaks
      for (let py = bottomY; py < bottomY + height; py++) {
        for (let i = 0; i < width; i++) {
          w.setBlock(startX + dx * i, py, startZ + dz * i, 528, axis, 0);
        }
      }
      for (let py = bottomY; py < bottomY + height; py++) {
        for (let i = 0; i < width; i++) {
          w.markBlock(w.getChunk((startX + dx * i) >> 4, (startZ + dz * i) >> 4), (startX + dx * i) & 15, py, (startZ + dz * i) & 15);
        }
      }
      const centerPos = [startX + dx * (width / 2), bottomY, startZ + dz * (width / 2)];
      if (this.worldMeta) {
        const curDim = w.dimension || 'overworld';
        if (!this.worldMeta.dimensions) this.worldMeta.dimensions = {};
        if (!this.worldMeta.dimensions[curDim]) this.worldMeta.dimensions[curDim] = {};
        if (!this.worldMeta.dimensions[curDim].portals) this.worldMeta.dimensions[curDim].portals = [];
        this.worldMeta.dimensions[curDim].portals.push({ x: Math.floor(centerPos[0]), y: bottomY, z: Math.floor(centerPos[2]), axis });
      }
      if (typeof Sound !== 'undefined' && Sound.tone) Sound.tone(centerPos, { freq: 180, end: 360, dur: 0.35, vol: 0.3, type: 'sine' });
      this.flushMesh();
      return true;
    }
    return false;
  }

  findOrCreateDestinationPortal(tx, ty, tz, preferredAxis = 0) {
    const w = this.world;
    const isNether = w.dimension === 'nether';
    // Ensure 3x3 chunks around (tx, tz) are generated/loaded synchronously
    const tcx = tx >> 4, tcz = tz >> 4;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = tcx + dx, cz = tcz + dz;
        const ck = ckey(cx, cz);
        if (!w.chunks.has(ck)) {
          const saved = w.savedChunks && w.savedChunks.get(ck);
          const ch = saved ? this._buildChunkFromSaved(cx, cz, saved) : w.generate(cx, cz);
          this._mountLoadedChunk(cx, cz, ch, !!saved);
        }
      }
    }

    // 1. Search within +-20 blocks horizontally for an existing nether_portal (528) block
    const minY = isNether ? 32 : 50, maxY = isNether ? 114 : 120;
    let bestPortal = null, bestDist = Infinity;
    for (let dz = -20; dz <= 20; dz++) {
      for (let dx = -20; dx <= 20; dx++) {
        const sx = tx + dx, sz = tz + dz;
        if (!w.isLoaded(sx, sz)) continue;
        for (let sy = minY; sy <= maxY; sy++) {
          if (w.getBlock(sx, sy, sz) === 528 && w.getBlock(sx, sy - 1, sz) === 28) {
            const d = dx * dx + dz * dz + (sy - ty) * (sy - ty);
            if (d < bestDist) {
              bestDist = d;
              bestPortal = [sx + 0.5, sy, sz + 0.5];
            }
          }
        }
      }
    }
    if (bestPortal) return bestPortal;

    // 2. Otherwise find a safe floor y near (tx, tz); only build an obsidian side-pad if suspended over water/lava/air!
    let px = tx, pz = tz, py = isNether ? 64 : Math.max(SEA + 1, w.surfaceY(tx, tz) + 1);
    let foundLand = false;
    if (isNether) {
      for (let r = 0; r <= 12 && !foundLand; r += 2) {
        for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
          const cx = tx + ox, cz = tz + oz;
          if (!w.isLoaded(cx, cz)) continue;
          for (let y = 34; y <= 102; y++) {
            const g = w.getBlock(cx, y - 1, cz);
            if (g && g !== 6 && g !== LAVA && BLOCKS[g] && BLOCKS[g].solid && w.getBlock(cx, y, cz) === 0 && w.getBlock(cx, y + 1, cz) === 0 && w.getBlock(cx, y + 2, cz) === 0 && w.getBlock(cx, y + 3, cz) === 0) {
              px = cx; py = y; pz = cz;
              foundLand = true;
              break;
            }
          }
          if (foundLand) break;
        }
      }
    } else {
      // Overworld: check if the terrain at (px, py - 1, pz) is solid dry land (not water/lava/air)
      const g0 = w.getBlock(px, py - 1, pz), g1 = w.getBlock(px + 1, py - 1, pz);
      if (g0 && !IS_FLUID[g0] && BLOCKS[g0] && BLOCKS[g0].solid && g1 && !IS_FLUID[g1] && BLOCKS[g1] && BLOCKS[g1].solid) {
        foundLand = true;
      }
    }

    // 3. Per Minecraft Wiki: only generate the 4x3 Obsidian standing ledge if no solid land was found (e.g. over Ocean/Lava/Air);
    // on solid land, only clear the 4x4x3 air pocket so the player does not suffocate, leaving only the 4x5 Obsidian frame!
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 2; dx++) {
        if (!foundLand && (dz !== 0)) {
          w.setBlock(px + dx, py - 1, pz + dz, 28, 0, 0);
        }
        for (let dy = 0; dy <= 3; dy++) {
          w.setBlock(px + dx, py + dy, pz + dz, 0, 0, 0);
        }
      }
    }

    // 4. Build standard 4x5 Obsidian frame along X (dx = -1..2, dy = -1..3 at pz) with 2x3 nether_portal (528) interior
    for (let dx = -1; dx <= 2; dx++) {
      w.setBlock(px + dx, py - 1, pz, 28, 0, 0);
      w.setBlock(px + dx, py + 3, pz, 28, 0, 0);
    }
    for (let dy = 0; dy <= 2; dy++) {
      w.setBlock(px - 1, py + dy, pz, 28, 0, 0);
      w.setBlock(px + 2, py + dy, pz, 28, 0, 0);
      w.setBlock(px, py + dy, pz, 528, 0, 0);
      w.setBlock(px + 1, py + dy, pz, 528, 0, 0);
    }
    // Re-init lighting on affected chunks
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ch = w.getChunk((px >> 4) + dx, (pz >> 4) + dz);
        if (ch) { w.initLight(ch); ch.bumpMask(0xFFFF); }
      }
    }
    return [px + 0.5, py, pz + 0.5];
  }

  async triggerNetherPortal() {
    if (this._switchingDim || !this.world) return;
    const targetDim = this.world.dimension === 'nether' ? 'overworld' : 'nether';
    await this.switchDimension(targetDim);
  }

  checkActivateEndPortal(fx, fy, fz) {
    const w = this.world;
    if (!w) return false;
    // Search all possible 3x3 interior centers (cx, fy, cz) within +-2 blocks of the frame at (fx, fy, fz)
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const cx = fx + dx, cz = fz + dz;
        let all12Filled = true;
        for (let i = -1; i <= 1 && all12Filled; i++) {
          // North (cz-2), South (cz+2), West (cx-2), East (cx+2)
          for (const [rx, rz] of [[cx + i, cz - 2], [cx + i, cz + 2], [cx - 2, cz + i], [cx + 2, cz + i]]) {
            if (w.getBlock(rx, fy, rz) !== 538 || !(w.getMeta(rx, fy, rz) & 4)) {
              all12Filled = false;
              break;
            }
          }
        }
        if (all12Filled) {
          for (let pz = -1; pz <= 1; pz++) {
            for (let px = -1; px <= 1; px++) {
              w.setBlock(cx + px, fy, cz + pz, 539, 0, 0);
              if (this.particles) {
                for (let k = 0; k < 6; k++) {
                  this.particles.spawn('portal', cx + px + Math.random(), fy + 0.8, cz + pz + Math.random(), (Math.random() - 0.5) * 0.1, 0.05, (Math.random() - 0.5) * 0.1);
                }
              }
            }
          }
          for (let pz = -1; pz <= 1; pz++) {
            for (let px = -1; px <= 1; px++) {
              const ch = w.getChunk((cx + px) >> 4, (cz + pz) >> 4);
              if (ch) { w.initLight(ch); ch.bumpMask(0xFFFF); }
            }
          }
          if (typeof Sound !== 'undefined' && Sound.tone) {
            Sound.tone([cx, fy, cz], { freq: 140, end: 420, dur: 0.6, vol: 0.4, type: 'triangle' });
          }
          this.flushMesh(true);
          return true;
        }
      }
    }
    return false;
  }

  teleportDragonEgg(x, y, z) {
    const w = this.world;
    if (!w || w.getBlock(x, y, z) !== 541) return false;
    for (let attempt = 0; attempt < 64; attempt++) {
      const nx = x + Math.floor((Math.random() - 0.5) * 15);
      const ny = clamp(y + Math.floor((Math.random() - 0.5) * 7), 2, HEIGHT - 2);
      const nz = z + Math.floor((Math.random() - 0.5) * 15);
      if (nx === x && ny === y && nz === z) continue;
      if (!w.isLoaded(nx, nz)) continue;
      if (w.getBlock(nx, ny, nz) === 0 && SOLIDCUBE[w.getBlock(nx, ny - 1, nz)]) {
        w.setBlock(x, y, z, 0, 0);
        w.setBlock(nx, ny, nz, 541, 0);
        if (this.particles) {
          for (let i = 0; i < 24; i++) {
            const t = i / 24;
            this.particles.spawn('portal', lerp(x + 0.5, nx + 0.5, t) + (Math.random() - 0.5) * 0.3, lerp(y + 0.5, ny + 0.5, t) + (Math.random() - 0.5) * 0.3, lerp(z + 0.5, nz + 0.5, t) + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.08, 0.02, (Math.random() - 0.5) * 0.08);
          }
        }
        if (typeof Sound !== 'undefined' && Sound.tone) Sound.tone([nx + 0.5, ny + 0.5, nz + 0.5], { freq: 300, end: 620, dur: 0.15, vol: 0.28, type: 'sine' });
        this.flushMesh();
        return true;
      }
    }
    return false;
  }

  initEndBossFight(hadSavedCrystals = false, isRespawn = false) {
    const w = this.world;
    if (!w || w.dimension !== 'end') return;
    // Ensure main island chunks (-3..3, -3..3) are loaded so pillars and fountain exist
    for (let cz = -3; cz <= 3; cz++) {
      for (let cx = -3; cx <= 3; cx++) {
        this.loadChunk(cx, cz);
      }
    }
    const dragonKilled = !!(this._dragonKilled || (this.worldMeta && this.worldMeta.dragonKilled));
    if (dragonKilled && !isRespawn) {
      this.activateEndExitPortal(false);
      return;
    }
    if (isRespawn) {
      // Extinguish Exit Portal (539 -> 0) and rebuild all 8 Obsidian Pillar tops, cages & crystals per vanilla EndDragonFight.respawnDragon
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (w.getBlock(dx, 59, dz) === 539) w.setBlock(dx, 59, dz, 0, 0, 0);
        }
      }
      this.entities = this.entities.filter(e => !(e instanceof EndCrystal) && !(e instanceof Mob && e.type === 'ender_dragon'));
      for (const pil of w.getEndPillars()) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const wx = pil.x + dx, wz = pil.z + dz;
            const onCageWall = Math.abs(dx) === 2 || Math.abs(dz) === 2;
            for (let dy = 1; dy <= 4; dy++) {
              const cy = pil.topY + dy;
              if (pil.caged && (dy === 4 || onCageWall)) w.setBlock(wx, cy, wz, 542, 0, 0);
              else w.setBlock(wx, cy, wz, 0, 0, 0);
            }
          }
        }
        w.setBlock(pil.x, pil.topY, pil.z, 6, 0, 0);
        const [cx, cy, cz] = pil.crystalPos;
        this.entities.push(new EndCrystal(this, cx, cy, cz));
      }
      for (let cz = -3; cz <= 3; cz++) {
        for (let cx = -3; cx <= 3; cx++) {
          const ch = w.getChunk(cx, cz);
          if (ch) { w.initLight(ch); ch.bumpMask(0xFFFF); }
        }
      }
      this.flushMesh(true);
    } else {
      // Spawn EndCrystal on each of the 8 Obsidian Pillars only on initial fight (not if player already destroyed all 8 in a saved session)
      const hasCrystals = this.entities.some(e => e instanceof EndCrystal && !e.dead);
      if (!hasCrystals && !hadSavedCrystals) {
        for (const pil of w.getEndPillars()) {
          const [cx, cy, cz] = pil.crystalPos;
          this.entities.push(new EndCrystal(this, cx, cy, cz));
        }
      }
    }
    // If a saved ender_dragon is still in pendingMobs (e.g., saved outside chunk -3..3), restore it immediately into entities
    if (this.pendingMobs && this.pendingMobs.length) {
      const idx = this.pendingMobs.findIndex(m => m.type === 'ender_dragon');
      if (idx >= 0) {
        const m = this.pendingMobs.splice(idx, 1)[0];
        const e = new Mob(this, m.type, m.pos[0], m.pos[1], m.pos[2]);
        e.yaw = m.yaw || 0;
        e.health = m.health || 200;
        e.persistent = true;
        e.orbitAngle = Math.atan2(e.pos[2] - 0.5, e.pos[0] - 0.5);
        this.entities.push(e);
      }
    }
    // Spawn Ender Dragon Boss if not already present in entities
    const hasDragon = this.entities.some(e => e instanceof Mob && !e.dead && !e.deathTime && e.type === 'ender_dragon');
    if (!hasDragon) {
      const dragon = new Mob(this, 'ender_dragon', 0.5, 75, 28.5);
      dragon.orbitAngle = Math.PI / 2;
      dragon.persistent = true;
      this.entities.push(dragon);
    }
  }

  activateEndExitPortal(placeEgg = true) {
    const w = this.world;
    if (!w || w.dimension !== 'end') return;
    this.loadChunk(0, 0);
    this.loadChunk(-1, 0);
    this.loadChunk(0, -1);
    this.loadChunk(-1, -1);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const ax = Math.abs(dx), az = Math.abs(dz);
        if (ax === 2 && az === 2) continue;
        if (dx === 0 && dz === 0) continue; // central bedrock column
        w.setBlock(dx, 59, dz, 539, 0, 0);
      }
    }
    if (placeEgg) {
      w.setBlock(0, 63, 0, 541, 0, 1); // Dragon Egg (541) atop central bedrock pillar!
    }
    for (const [cx, cz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      const ch = w.getChunk(cx, cz);
      if (ch) { w.initLight(ch); ch.bumpMask(0xFFFF); }
    }
    this.flushMesh(true);
  }

  completeEndFight(dragon) {
    this._dragonKilled = true;
    if (this.worldMeta) this.worldMeta.dragonKilled = true;
    this.grant('end_dragon');
    // Award 12,000 XP per Minecraft Wiki first-kill reward
    this.player.xp = (this.player.xp || 0) + 12000;
    if (typeof Sound !== 'undefined' && Sound.levelup) Sound.levelup();
    if (this.particles && dragon) {
      for (let i = 0; i < 40; i++) {
        this.particles.spawn('explosion', dragon.pos[0] + (Math.random() - 0.5) * 6, dragon.pos[1] + (Math.random() - 0.5) * 4, dragon.pos[2] + (Math.random() - 0.5) * 6, 0, 0, 0);
        this.particles.spawn('portal', (Math.random() - 0.5) * 5, 60 + Math.random() * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 0.15, 0.08, (Math.random() - 0.5) * 0.15);
      }
    }
    this.activateEndExitPortal(true);
    if (this.ui) {
      this.ui.message('✨ 末影龙已被击败！中央返回传送门与龙蛋已在 (0, 63, 0) 显现！', '#55FFFF');
    }
  }

  async triggerEndPortal() {
    if (this._switchingDim || !this.world) return;
    if (this.world.dimension === 'end') {
      // Victory return from The End Exit Portal to Overworld spawn!
      const sp = (this.player && this.player.spawn) || (this.worldMeta && this.worldMeta.spawn) || [0, 80, 0];
      this.player.health = this.player.maxHealth || 20;
      this.player.food = 20;
      await this.switchDimension('overworld', [sp[0] + 0.5, sp[1], sp[2] + 0.5]);
      if (this.ui) {
        this.ui.toast('恭喜通关！', '击败末影龙，重返主世界', item('dragon_egg'));
        this.ui.message('🎉 恭喜通关！你已从末地返回传送门回到主世界出生点！', '#FFFF55');
      }
    } else {
      await this.switchDimension('end', [42.5, 50, 0.5]);
    }
  }

  async switchDimension(targetDim, explicitPos = null) {
    if (this._switchingDim || !this.world) return null;
    const curDim = this.world.dimension || 'overworld';
    if (targetDim === curDim && !explicitPos) return this.player.pos;
    this._switchingDim = true;
    try {
      const p = this.player;
      const oldX = p.pos[0], oldY = p.pos[1], oldZ = p.pos[2];
      // 1. Flush & save current dimension state to IndexedDB
      if (this.worldMeta) await this.saveWorld(true);

      // 2. Compute 8:1 scaled coordinates per Minecraft Wiki
      let tx, ty, tz;
      if (explicitPos) {
        [tx, ty, tz] = explicitPos.map(Math.floor);
      } else if (curDim === 'overworld' && targetDim === 'nether') {
        tx = Math.floor(oldX / 8);
        tz = Math.floor(oldZ / 8);
        ty = clamp(Math.floor(oldY), 38, 100);
      } else if (curDim === 'nether' && targetDim === 'overworld') {
        tx = Math.floor(oldX * 8);
        tz = Math.floor(oldZ * 8);
        ty = clamp(Math.floor(oldY), 64, 96);
      } else {
        tx = Math.floor(oldX); ty = Math.floor(oldY); tz = Math.floor(oldZ);
      }

      // 3. Guard Rule #5: Unload all current dimension chunks/VAOs/entities and switch world.dimension
      const seed = this.worldMeta ? this.worldMeta.seed : this.world.seed;
      this.setupWorld(seed, targetDim);
      this.world.flat = (targetDim === 'overworld') && !!(this.worldMeta && this.worldMeta.flat);
      if (this.worker) this.worker.resetSession(this.worldSessionId, this.world);

      // 4. Load target dimension saved chunks & metadata
      this.dirtySaved = new Set();
      if (this.worldMeta) {
        const loadedChunks = await DB.loadChunks(this.worldMeta.id, this.worldMeta.blockBits, targetDim);
        const dimMeta = (this.worldMeta.dimensions && this.worldMeta.dimensions[targetDim]) || {};
        this.world.setSavedChunks(loadedChunks, dimMeta.modifiedChunkKeys || []);
        for (const [k, v] of Object.entries(dimMeta.blockEntities || {})) this.blockEntities.set(k, v);
        this.pendingMobs = (dimMeta.mobs || []).map(m => ({ ...m, pos: [...m.pos] }));
        this.spawnedChunks = new Set(dimMeta.spawnedChunks || []);
        if (targetDim === 'end' && Array.isArray(dimMeta.crystals)) {
          for (const cPos of dimMeta.crystals) {
            this.entities.push(new EndCrystal(this, cPos[0], cPos[1], cPos[2]));
          }
        }
      }

      // 5. Locate or construct destination portal / End spawn platform and place player inside
      let dest;
      if (targetDim === 'end') {
        const hadSavedCrystals = !!(this.worldMeta && this.worldMeta.dimensions && this.worldMeta.dimensions.end && Array.isArray(this.worldMeta.dimensions.end.crystals));
        dest = explicitPos ? [explicitPos[0], explicitPos[1], explicitPos[2]] : [42.5, 50, 0.5];
        this.initEndBossFight(hadSavedCrystals);
        this.grant('the_end');
      } else if (explicitPos) {
        this.loadChunk(Math.floor(explicitPos[0]) >> 4, Math.floor(explicitPos[2]) >> 4);
        dest = [explicitPos[0], explicitPos[1], explicitPos[2]];
      } else {
        dest = this.findOrCreateDestinationPortal(tx, ty, tz);
      }
      p.world = this.world;
      p.pos = [dest[0], dest[1], dest[2]];
      p.prev = [...p.pos];
      p.vel = [0, 0, 0];
      p.fallDist = 0;
      p.portalCooldown = 100;
      p.portalTime = 0;
      this._lastCC = null;

      if (targetDim === 'nether') this.grant('nether');
      if (typeof Sound !== 'undefined' && Sound.tone) Sound.tone(p.pos, { freq: 220, end: 110, dur: 0.45, vol: 0.35, type: 'sine' });
      if (this.worldMeta) await this.saveWorld(true);
      this.flushMesh(true);
      return p.pos;
    } finally {
      this._switchingDim = false;
    }
  }
  async exportWorld(id) {
    if (this.worldMeta && this.worldMeta.id === id && (this.state === 'play' || this.state === 'loading')) {
      await this.saveWorld(true);
    }
    const data = await DB.exportWorldData(id);
    const json = JSON.stringify(data);
    try {
      if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL && typeof document !== 'undefined' && document.body) {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const safeName = String((data.world && data.world.name) || id).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'world';
        a.href = url;
        a.download = safeName + '.json';
        document.body.appendChild(a);
        if (typeof a.click === 'function') a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) { console.warn('Download trigger skipped:', e); }
    if (this.ui) this.ui.message(`已导出存档 “${data.world.name}” (.json)`, '#55FF55');
    return data;
  }
  async importWorldData(raw) {
    const meta = await DB.importWorldData(raw);
    if (this.ui) this.ui.message(`已导入存档 “${meta.name}”`, '#55FF55');
    return meta;
  }
  importWorldFromFile(onDone) {
    if (typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (input.parentNode) input.parentNode.removeChild(input);
      if (!file) return;
      try {
        const text = typeof file.text === 'function' ? await file.text() : await new Promise((res, rej) => {
          const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file);
        });
        const meta = await this.importWorldData(text);
        if (onDone) onDone(meta);
      } catch (e) {
        if (this.ui) this.ui.message('导入存档失败: ' + e.message, '#FF5555');
      }
    };
    if (document.body) document.body.appendChild(input);
    input.click();
  }
  async quitToTitle() {
    await this.saveWorld(true);
    this.worldMeta = null;
    this.ui.cursor = null;
    this.startTitle();
  }

  // ---- chunk streaming ------------------------------------------------------------
  updateChunks(budgetMs) {
    const w = this.world, R = this.state === 'title' ? 6 : this.settings.renderDist;
    const center = this.state === 'title' ? this.titleCam : this.player.pos;
    const pcx = Math.floor(center[0]) >> 4, pcz = Math.floor(center[2]) >> 4;
    const t0 = performance.now();
    const useWorker = !!(this.worker && this.worker.isReady());

    // generation queue: nearest missing chunks within R+1
    const ccKey = pcx + ',' + pcz + ',' + R;
    if (this._lastCC !== ccKey) {
      this._lastCC = ccKey;
      const q = [];
      for (let dx = -R - 1; dx <= R + 1; dx++) for (let dz = -R - 1; dz <= R + 1; dz++) {
        if (dx * dx + dz * dz > (R + 1.5) * (R + 1.5)) continue;
        const ck = ckey(pcx + dx, pcz + dz);
        if (!w.chunks.has(ck) && !w.loadingChunks.has(ck) && !(w.generatingChunks && w.generatingChunks.has(ck))) {
          q.push([pcx + dx, pcz + dz, dx * dx + dz * dz]);
        }
      }
      q.sort((a, b) => b[2] - a[2]);
      this.genQueue = q;
    }
    this.genQueueLen = this.genQueue.length + (w.generatingChunks ? w.generatingChunks.size : 0);

    let gen = 0;
    while (this.genQueue.length && (useWorker ? gen < 8 : (performance.now() - t0 < budgetMs * 0.5 || gen === 0))) {
      const [cx, cz, distSq] = this.genQueue.pop();
      const ck = ckey(cx, cz);
      if (w.chunks.has(ck) || w.loadingChunks.has(ck) || (w.generatingChunks && w.generatingChunks.has(ck))) continue;
      if (useWorker && !(w.savedChunks && w.savedChunks.has(ck)) && !(w.modifiedChunkKeys && w.modifiedChunkKeys.has(ck))) {
        this.worker.enqueueGenerate(cx, cz, distSq);
      } else {
        this.loadChunk(cx, cz);
      }
      gen++;
    }

    // meshing: dirty chunks whose neighbours exist
    const cand = [];
    for (const ch of w.chunks.values()) {
      if (!ch.dirty) continue;
      const dx = ch.cx - pcx, dz = ch.cz - pcz;
      if (dx * dx + dz * dz > (R + 0.5) * (R + 0.5)) continue;
      let ok = true;
      for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1; b++) if (!w.chunks.has(ckey(ch.cx + a, ch.cz + b))) { ok = false; break; }
      if (ok) cand.push([ch, dx * dx + dz * dz]);
    }
    cand.sort((a, b) => a[1] - b[1]);
    if (useWorker) {
      let queuedSections = 0;
      for (const [ch, distSq] of cand) {
        for (let sy = 0; sy < SECTIONS; sy++) {
          if (!(ch.dirty & (1 << sy))) continue;
          if (!ch.sectionCount[sy]) {
            const key = ckey(ch.cx, ch.cz) * 16 + sy;
            const s = this.renderer.sections.get(key);
            if (s) { this.renderer.freeSection(s); this.renderer.sections.delete(key); }
            ch.dirty &= ~(1 << sy);
            ch.meshingMask &= ~(1 << sy);
            continue;
          }
          if (!(ch.meshingMask & (1 << sy))) {
            this.worker.enqueueMesh(ch.cx, sy, ch.cz, distSq, false);
            queuedSections++;
          }
        }
        if (queuedSections >= 16) break;
      }
    } else {
      for (const [ch] of cand) {
        if (performance.now() - t0 > budgetMs) break;
        this.meshChunk(ch);
      }
    }
    this.meshPending = cand.length;

    // unload far chunks & evict cold savedChunks > 128
    const maxLoadedRadiusSq = (R + 2) * (R + 2);
    if (this.tickCount % 20 === 0 || w.chunks.size > 300) {
      for (const ch of [...w.chunks.values()]) {
        const dx = ch.cx - pcx, dz = ch.cz - pcz;
        if (dx * dx + dz * dz > maxLoadedRadiusSq) {
          const k = ckey(ch.cx, ch.cz);
          if (ch.modified && w.savedChunks && (this.state === 'play' || this.state === 'loading')) {
            w.savedChunks.set(k, encodeChunk(ch));
            w.modifiedChunkKeys.add(k);
            this.dirtySaved.add(k);
          }
          if (this.state === 'play' && this.entities.length) {
            this.entities = this.entities.filter(e => {
              if (e.dead) return false;
              if (typeof EndCrystal !== 'undefined' && e instanceof EndCrystal && w.dimension === 'end') return true;
              const ecx = Math.floor(e.pos[0]) >> 4, ecz = Math.floor(e.pos[2]) >> 4;
              if (ecx !== ch.cx || ecz !== ch.cz) return true;
              if (e instanceof Mob && e.persistent && !e.deathTime && e.health > 0) {
                if (!this.pendingMobs) this.pendingMobs = [];
                this.pendingMobs.push(this.serializeMob(e));
              }
              return false;
            });
          }
          this.renderer.dropChunk(ch.cx, ch.cz);
          w.chunks.delete(k);
        }
      }
    }
    if (w.savedChunks && w.savedChunks.size > 128) this.evictColdSavedChunks();
  }
  meshChunk(ch) {
    const w = this.world;
    for (let sy = 0; sy < SECTIONS; sy++) {
      if (!(ch.dirty & (1 << sy))) continue;
      const key = ckey(ch.cx, ch.cz) * 16 + sy;
      if (!ch.sectionCount[sy]) {
        const s = this.renderer.sections.get(key);
        if (s) { this.renderer.freeSection(s); this.renderer.sections.delete(key); }
        continue;
      }
      const res = Mesher.build(w, ch.cx, sy, ch.cz);
      this.renderer.setSection(key, ch.cx, sy, ch.cz, res);
    }
    ch.dirty = 0;
    if (ch.meshingMask !== undefined) ch.meshingMask = 0;
  }
  _buildChunkFromSaved(cx, cz, saved) {
    const w = this.world;
    const ch = new Chunk(cx, cz);
    decodeChunk(saved, ch, this.worldMeta && this.worldMeta.blockBits);
    if (w.dimension === 'end') {
      for (let i = 0; i < 256; i++) {
        ch.biome[i] = BI.THE_END;
        const ti = i * 3;
        ch.grass[ti] = 142; ch.grass[ti + 1] = 185; ch.grass[ti + 2] = 113;
        ch.foliage[ti] = 114; ch.foliage[ti + 1] = 167; ch.foliage[ti + 2] = 85;
      }
    } else if (w.dimension === 'nether') {
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const i = z * 16 + x, ti = i * 3;
        ch.biome[i] = w.netherBiomeAt(cx * 16 + x, cz * 16 + z);
        ch.grass[ti] = 190; ch.grass[ti + 1] = 155; ch.grass[ti + 2] = 85;
        ch.foliage[ti] = 165; ch.foliage[ti + 1] = 125; ch.foliage[ti + 2] = 60;
      }
    } else {
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const c = w.flat ? { temp: 0.3, humid: 0.2, h: 60, river: 0, cont: 0.3, mount: 0 } : w.column(cx * 16 + x, cz * 16 + z);
        const bi = w.biomeOf(c);
        ch.biome[z * 16 + x] = bi;
        if (bi === BI.CHERRY_GROVE) {
          w.tintFor(w.grassMap, 0.45, 0.65, ch.grass, (z * 16 + x) * 3);
          w.tintFor(w.foliageMap, c.temp, c.humid, ch.foliage, (z * 16 + x) * 3);
        } else {
          w.tintFor(w.grassMap, c.temp, c.humid, ch.grass, (z * 16 + x) * 3);
          w.tintFor(w.foliageMap, c.temp, c.humid, ch.foliage, (z * 16 + x) * 3);
        }
      }
    }
    ch.recount();
    return ch;
  }
  _mountLoadedChunk(cx, cz, ch, isSaved) {
    const w = this.world;
    const ck = ckey(cx, cz);
    if (w.generatingChunks) w.generatingChunks.delete(ck);
    w.chunks.set(ck, ch);
    w.initLight(ch);
    ch.bumpMask(0xFFFF);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const n = w.getChunk(cx + a, cz + b);
      if (n && n !== ch && n.dirty !== 0xFFFF) n.bumpMask(0xFFFF);
    }
    this._nearbyScanned = false;
    if (this.state === 'play' || this.state === 'loading') {
      // restore saved mobs
      if (this.pendingMobs && this.pendingMobs.length) {
        this.pendingMobs = this.pendingMobs.filter(m => {
          if ((Math.floor(m.pos[0]) >> 4) === cx && (Math.floor(m.pos[2]) >> 4) === cz) {
            const e = new Mob(this, m.type, m.pos[0], m.pos[1], m.pos[2]);
            e.yaw = m.yaw; e.health = m.health; e.sheared = m.sheared; e.woolColor = m.wool || 0;
            e.persistent = true;
            if (m.profession !== undefined) e.profession = m.profession;
            if (m.trades !== undefined) {
              e.trades = Array.isArray(m.trades) && typeof Trading !== 'undefined'
                ? m.trades.map(t => Trading.cloneTrade(t))
                : m.trades;
            }
            if (m.xp !== undefined) e.xp = m.xp;
            if (m.level !== undefined) e.level = m.level;
            if (m.restockDay !== undefined) e.restockDay = m.restockDay;
            if (e.type === 'villager' && typeof Trading !== 'undefined') Trading.ensureVillager(e, this, e.profession);
            if (m.baby) { e.makeBaby(); e.growT = m.baby; }
            this.entities.push(e); return false;
          }
          return true;
        });
      }
      if (!isSaved && !(this.worldMeta && this.worldMeta.noAnimals) && (!this.spawnedChunks || !this.spawnedChunks.has(ck))) {
        if (this.spawnedChunks) this.spawnedChunks.add(ck);
        this.spawnAnimals(ch);
      }
    }
    return ch;
  }
  loadChunk(cx, cz) {
    const w = this.world;
    const ck = ckey(cx, cz);
    if (w.chunks.has(ck)) return w.chunks.get(ck);
    if (this.worker) this.worker.cancelGenerate(cx, cz);
    if (w.generatingChunks) w.generatingChunks.delete(ck);
    const saved = w.savedChunks && w.savedChunks.get(ck);
    if (saved) {
      const ch = this._buildChunkFromSaved(cx, cz, saved);
      return this._mountLoadedChunk(cx, cz, ch, true);
    }
    if (w.modifiedChunkKeys && w.modifiedChunkKeys.has(ck)) {
      if (!this._loadingPromises) this._loadingPromises = new Map();
      if (this._loadingPromises.has(ck)) return this._loadingPromises.get(ck);
      w.loadingChunks.add(ck);
      const worldId = this.worldMeta ? this.worldMeta.id : '';
      const fallbackBits = this.worldMeta ? this.worldMeta.blockBits : 16;
      const p = DB.getChunk(worldId, cx, cz, fallbackBits, w.dimension || 'overworld').then((rec) => {
        w.loadingChunks.delete(ck);
        this._loadingPromises.delete(ck);
        if (this.world !== w) return null;
        if (w.chunks.has(ck)) return w.chunks.get(ck);
        if (rec) {
          if (w.savedChunks) {
            w.savedChunks.set(ck, rec);
            this.evictColdSavedChunks();
          }
          const ch = this._buildChunkFromSaved(cx, cz, rec);
          return this._mountLoadedChunk(cx, cz, ch, true);
        }
        w.modifiedChunkKeys.delete(ck);
        const ch = w.generate(cx, cz);
        return this._mountLoadedChunk(cx, cz, ch, false);
      }).catch((err) => {
        w.loadingChunks.delete(ck);
        this._loadingPromises.delete(ck);
        console.error('Failed to async load modified chunk from DB:', cx, cz, err);
        return null;
      });
      this._loadingPromises.set(ck, p);
      return p;
    }
    const ch = w.generate(cx, cz);
    return this._mountLoadedChunk(cx, cz, ch, false);
  }
  spawnAnimals(ch) {
    if (this.world && this.world.dimension !== 'overworld') return;
    if (ch.village && !ch.villageSpawned) {
      ch.villageSpawned = true;
      const [vx, vy, vz] = ch.village.pos;
      const offsets = [[-2, -2], [2, -2], [-2, 2], [2, 2]];
      const profs = ['farmer', 'librarian', 'smith', 'farmer'];
      offsets.forEach(([ox, oz], idx) => {
        const m = new Mob(this, 'villager', vx + ox + 0.5, vy, vz + oz + 0.5);
        m.persistent = true;
        m.profession = profs[idx % profs.length];
        m.trades = null;
        if (typeof Trading !== 'undefined') Trading.ensureVillager(m, this, m.profession);
        this.entities.push(m);
      });
    }
    const r = RNG(hashStr('animals' + this.world.seed + ch.cx + ':' + ch.cz));
    if (r() > 0.1) return;
    const types = ['pig', 'cow', 'sheep', 'sheep', 'chicken'];
    const t = types[r.int(types.length)];
    const n = 2 + r.int(3);
    for (let i = 0; i < n; i++) {
      const x = ch.cx * 16 + r.int(16), z = ch.cz * 16 + r.int(16);
      for (let y = HEIGHT - 2; y > SEA; y--) {
        const id = ch.blocks[(y << 8) | ((z & 15) << 4) | (x & 15)];
        if (id === 0 || !BLOCKS[id].solid) continue;
        if (id === 2) this.entities.push(new Mob(this, t, x + 0.5, y + 1, z + 0.5));
        break;
      }
    }
  }

  // ---- per-frame update ---------------------------------------------------------------
  frame(dt, now) {
    if (!this.world) return;
    if (this.state === 'title') {
      this.titleYaw = (this.titleYaw || 0) + dt * 0.00004;
      this.updateChunks(8);
      return;
    }
    if (this.state === 'loading') {
      this.updateChunks(30);
      const p = this.player, pcx = Math.floor(p.pos[0]) >> 4, pcz = Math.floor(p.pos[2]) >> 4;
      let ready = 0, need = 0;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { need++; const ch = this.world.getChunk(pcx + dx, pcz + dz); if (ch && !ch.dirty) ready++; }
      this.loadProgress = ready / need;
      if (ready === need) {
        if (p.needsGround) {
          const x = Math.floor(p.pos[0]), z = Math.floor(p.pos[2]);
          let y = HEIGHT - 2;
          while (y > 0 && !BLOCKS[this.world.getBlock(x, y, z)].solid && !IS_FLUID[this.world.getBlock(x, y, z)]) y--;
          p.pos[1] = y + 1; p.prev[1] = y + 1; p.spawn = [x, y + 1, z]; p.needsGround = false;
          this.worldMeta.spawn = p.spawn;
        }
        this.state = 'play';
        this.ui.close();
        this.ui.message(`欢迎来到 ${this.worldMeta.name}！按 H 查看操作说明。`, '#FFFF55');
        this.lastSave = now;
        Sound.init();
      }
      return;
    }
    if (this.state !== 'play') return;
    this.updateChunks(6);
    if (now - this.lastSave > 45000) { this.lastSave = now; this.saveWorld(true); }
    Sound.updateMusic(true);
    // mouse look handled in input; continuous mining handled in tick
  }

  // ---- 20 TPS tick ---------------------------------------------------------------------------
  tick() {
    if (!this.world) return;
    if (this.state === 'title') { this.worldTime += 1; this.world.time++; return; }
    if (this.state !== 'play') return;
    if (this.ui.screen && this.ui.screen.pauses) return;
    this.tickCount++;
    this.world.time++;
    this.worldTime++;
    const p = this.player;
    // weather
    if (--this.weatherTimer < 0) { this.rainTarget = this.rainTarget ? 0 : 1; this.weatherTimer = this.rainTarget ? 6000 + Math.random() * 12000 : 12000 + Math.random() * 36000; }
    this.weather += clamp(this.rainTarget - this.weather, -0.01, 0.01);
    const input = this.ui.screen ? { fwd: 0, strafe: 0, jump: false, sneak: false, sprint: false } : this.readInput();
    if (this.tickSleep()) { }
    else if (!p.loadedHere()) { p.savePrev(); }
    else p.tick(input);
    if (p.pos[1] < SEA - 30 && !this.adv.deep && p.pos[1] < 16) this.grant('deep');
    this.handleInteraction();
    // entities
    for (const e of this.entities) {
      if (e.dead) continue;
      if (!this.world.isLoaded(Math.floor(e.pos[0]), Math.floor(e.pos[2])) || !this.world.isLoaded(Math.floor(e.pos[0]) + 16, Math.floor(e.pos[2])) || !this.world.isLoaded(Math.floor(e.pos[0]) - 16, Math.floor(e.pos[2]))) { e.savePrev(); continue; }
      e.tick();
    }
    this.entities = this.entities.filter(e => !e.dead);
    this.particles.tick();
    this.world.tickScheduled();
    Redstone.tickPressurePlates(this);
    this.world.randomTick(Math.floor(p.pos[0]), Math.floor(p.pos[2]), this.rng || (this.rng = RNG(12345)));
    this.tickFurnaces();
    this.tickHoppers();
    this.tickBrewingStands();
    this.tickSpawners();
    if (this.tickCount % 20 === 0) this.spawnMobs();
    if (this.tutorial >= 0) {
      this.tutStat.moved += Math.hypot(p.pos[0] - p.prev[0], p.pos[2] - p.prev[2]);
      if (this.ui.screen instanceof ContainerScreen) this.tutStat.inv = true;
      if (TUTORIAL[this.tutorial].done(this)) { Sound.toast(); this.tutorial++; if (this.tutorial >= TUTORIAL.length) this.tutorial = -1; }
    }
    if (this.tickCount % 20 === 0 && !this.adv.armor && p.inv.slots.slice(36).some(s => s && ITEMS[s.id].key.startsWith('iron_'))) this.grant('armor');
    // first night advancement
    if (!this.adv.night && this.mode === 'survival' && this.dayTime() > 23500 && this.worldTime > 20000) this.grant('night');
    // rain splashes
    if (this.weather > 0.2 && this.tickCount % 2 === 0) this.rainParticles();
    // eye in fluid
    const eyeY = p.pos[1] + p.eye();
    const eb = this.world.getBlock(Math.floor(p.pos[0]), Math.floor(eyeY), Math.floor(p.pos[2]));
    this.headInWater = eb === WATER; this.headInLava = eb === LAVA;
    if (this.headInWater && Math.random() < 0.1) this.particles.spawn('bubble', p.pos[0] + (Math.random() - 0.5), eyeY - 0.5, p.pos[2] + (Math.random() - 0.5), 0, 0.05, 0);
    // torch / lava / redstone ambient particles near player
    this.ambientParticles();
    Sound.listener = { x: p.pos[0], y: p.pos[1] + 1.6, z: p.pos[2], yaw: p.yaw };
  }
  readInput() {
    const k = this.keys;
    return {
      fwd: (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), strafe: (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0),
      jump: !!k.Space, sneak: !!(k.ShiftLeft || k.ShiftRight), sprint: !!(k.ControlLeft || k.ControlRight || this.sprintToggle),
    };
  }
  ambientParticles() {
    const p = this.player, w = this.world;
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(p.pos[0] + (Math.random() - 0.5) * 24), y = Math.floor(p.pos[1] + (Math.random() - 0.5) * 16), z = Math.floor(p.pos[2] + (Math.random() - 0.5) * 24);
      const id = w.getBlock(x, y, z);
      if (id === 21) {
        const m = w.getMeta(x, y, z);
        let fx = x + 0.5, fy = y + 0.7, fz = z + 0.5;
        if (m) { const sd = m === 6 ? 0 : (m & 7); fx = x + 0.5 + DIRS[sd][0] * 0.38 - DIRS[sd][0] * 0.32 * 0.6; fz = z + 0.5 + DIRS[sd][2] * 0.38 - DIRS[sd][2] * 0.32 * 0.6; fy = y + 0.92; }
        this.particles.spawn('flame', fx, fy, fz, 0, 0.002, 0).life = 12;
        this.particles.spawn('smoke', fx, fy + 0.05, fz, 0, 0.01, 0).size = 0.06;
      } else if (id === 120) {
        const m = w.getMeta(x, y, z);
        let fx = x + 0.5, fy = y + 0.72, fz = z + 0.5;
        if (m) { const sd = m === 6 ? 0 : (m & 7); fx = x + 0.5 + DIRS[sd][0] * 0.19; fz = z + 0.5 + DIRS[sd][2] * 0.19; fy = y + 0.9; }
        this.particles.spawn('reddust', fx + (Math.random() - 0.5) * 0.1, fy, fz + (Math.random() - 0.5) * 0.1, 0, 0.004, 0, { col: [255, 25, 25] });
      } else if (id === 119) {
        const pw = w.getMeta(x, y, z) & 15;
        if (pw > 0) {
          const f = pw / 15;
          this.particles.spawn('reddust', x + 0.2 + Math.random() * 0.6, y + 0.08, z + 0.2 + Math.random() * 0.6, 0, 0.005, 0, { col: [Math.round(110 + f * 145), Math.round(f * 30), 0] });
        }
      } else if (id === 122 && (w.getMeta(x, y, z) & 8)) {
        this.particles.spawn('reddust', x + 0.5 + (Math.random() - 0.5) * 0.2, y + 0.5, z + 0.5 + (Math.random() - 0.5) * 0.2, 0, 0.004, 0, { col: [240, 20, 20] });
      } else if (id === 156 || (id === 514 && (w.getMeta(x, y, z) & 8))) {
        this.particles.spawn('reddust', x + 0.5 + (Math.random() - 0.5) * 0.3, y + 0.35, z + 0.5 + (Math.random() - 0.5) * 0.3, 0, 0.004, 0, { col: [255, 30, 20] });
      } else if (id === 520 && w.getBlock(x, y - 1, z) === 0 && Math.random() < 0.38) {
        this.particles.spawn('cherry_petal', x + Math.random(), y - 0.05, z + Math.random(), (Math.random() - 0.5) * 0.02, -0.02, (Math.random() - 0.5) * 0.02);
      } else if (id === 528 || id === 539 || id === 541) {
        this.particles.spawn('portal', x + Math.random(), y + Math.random(), z + Math.random(), (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.08);
      } else if (id === 537) {
        this.particles.spawn('smoke', x + 0.2 + Math.random() * 0.6, y + 0.3 + Math.random() * 0.5, z + 0.2 + Math.random() * 0.6, 0, 0.015, 0).size = 0.08;
      } else if (id === 182) {
        this.particles.spawn('flame', x + 0.2 + Math.random() * 0.6, y + 0.2 + Math.random() * 0.6, z + 0.2 + Math.random() * 0.6, 0, 0.005, 0).life = 14;
        this.particles.spawn('smoke', x + 0.2 + Math.random() * 0.6, y + 0.3 + Math.random() * 0.5, z + 0.2 + Math.random() * 0.6, 0, 0.01, 0).size = 0.07;
      } else if (id === LAVA && w.getBlock(x, y + 1, z) === 0 && Math.random() < 0.05) {
        this.particles.spawn('lava', x + Math.random(), y + 1, z + Math.random(), (Math.random() - 0.5) * 0.1, 0.25, (Math.random() - 0.5) * 0.1);
        if (Math.random() < 0.3) Sound.noise([x, y, z], { type: 'bandpass', freq: 400, q: 2, dur: 0.1, vol: 0.3 });
      }
    }
    // Continuous flame & smoke particles for nearby monster spawners (ID 182), enchanting tables (ID 185) & end portals (ID 539)
    const px = Math.floor(p.pos[0]), py = Math.floor(p.pos[1]), pz = Math.floor(p.pos[2]);
    const posKey = `${px >> 1},${py >> 1},${pz >> 1}`;
    if (!this._nearbyScanned || this._nearbyPosKey !== posKey || (this.tickCount % 10 === 0)) {
      this._nearbyScanned = true;
      this._nearbyPosKey = posKey;
      this.nearbySpawners = [];
      this.nearbyEnchantTables = [];
      this.nearbyEndPortals = [];
      const yMin = Math.max(1, py - 6), yMax = Math.min(HEIGHT - 1, py + 6);
      const xMin = px - 14, xMax = px + 14, zMin = pz - 14, zMax = pz + 14;
      const cx0 = xMin >> 4, cx1 = xMax >> 4, cz0 = zMin >> 4, cz1 = zMax >> 4;
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const ch = w.getChunk(cx, cz);
          if (!ch) continue;
          const B = ch.blocks;
          const lx0 = Math.max(0, xMin - (cx << 4)), lx1 = Math.min(15, xMax - (cx << 4));
          const lz0 = Math.max(0, zMin - (cz << 4)), lz1 = Math.min(15, zMax - (cz << 4));
          for (let y = yMin; y <= yMax; y++) {
            if (!ch.sectionCount[y >> 4]) { y = ((y >> 4) << 4) + 15; continue; }
            const yOff = y << 8;
            for (let lz = lz0; lz <= lz1; lz++) {
              const rowOff = yOff | (lz << 4);
              for (let lx = lx0; lx <= lx1; lx++) {
                const bid = B[rowOff | lx];
                if (bid === 185) this.nearbyEnchantTables.push([(cx << 4) + lx, y, (cz << 4) + lz]);
                else if (bid === 539) this.nearbyEndPortals.push([(cx << 4) + lx, y, (cz << 4) + lz]);
                else if (bid === 182) this.nearbySpawners.push([(cx << 4) + lx, y, (cz << 4) + lz]);
              }
            }
          }
        }
      }
    }
    for (const [tx, y, tz] of this.nearbyEnchantTables) {
      if (typeof Enchant !== 'undefined' && Math.random() < 0.45) {
        const bs = Enchant.countBookshelves(w, tx, y, tz);
        if (bs.positions.length) {
          const [bx, by, bz] = bs.positions[(Math.random() * bs.positions.length) | 0];
          const sx = bx + 0.5 + (Math.random() - 0.5) * 0.4, sy = by + 0.5 + Math.random() * 0.4, sz = bz + 0.5 + (Math.random() - 0.5) * 0.4;
          this.particles.spawn('glint', sx, sy, sz, (tx + 0.5 - sx) * 0.05, (y + 0.9 - sy) * 0.05, (tz + 0.5 - sz) * 0.05);
        }
      }
    }
    for (const [sx, y, sz] of this.nearbySpawners) {
      if (Math.random() < 0.65) {
        this.particles.spawn('flame', sx + 0.2 + Math.random() * 0.6, y + 0.2 + Math.random() * 0.6, sz + 0.2 + Math.random() * 0.6, 0, 0.006, 0).life = 14;
      }
      if (Math.random() < 0.45) {
        this.particles.spawn('smoke', sx + 0.2 + Math.random() * 0.6, y + 0.3 + Math.random() * 0.5, sz + 0.2 + Math.random() * 0.6, 0, 0.012, 0).size = 0.07;
      }
    }
  }

  tickSpawners() {
    if (this.tickCount % 80 !== 0) return; // check every 4 seconds
    const list = this.nearbySpawners;
    if (!list || !list.length) return;
    const w = this.world;
    for (const [sx, sy, sz] of list) {
      if (w.getBlock(sx, sy, sz) !== 182) continue;
      const isBlaze = (w.getMeta(sx, sy, sz) === 1 || w.dimension === 'nether');
      const sType = isBlaze ? 'blaze' : 'spider';
      let nearby = 0;
      for (const e of this.entities) {
        if (!e.dead && e instanceof Mob && e.type === sType && Math.hypot(e.pos[0] - (sx + 0.5), e.pos[1] - sy, e.pos[2] - (sz + 0.5)) < 9) nearby++;
      }
      if (nearby >= 4) continue;
      const toSpawn = 1 + (Math.random() < 0.4 ? 1 : 0);
      let spawned = 0;
      for (let attempt = 0; attempt < 12 && spawned < toSpawn; attempt++) {
        const mx = sx + Math.floor((Math.random() - 0.5) * 7);
        const my = sy + Math.floor(Math.random() * 3) - 1;
        const mz = sz + Math.floor((Math.random() - 0.5) * 7);
        if (my < 1 || my >= HEIGHT - 2) continue;
        const b0 = w.getBlock(mx, my, mz), bAbove = w.getBlock(mx, my + 1, mz);
        if ((b0 !== 0 && b0 !== 177) || (bAbove !== 0 && bAbove !== 177)) continue;
        if (!isBlaze && !BLOCKS[w.getBlock(mx, my - 1, mz)].solid && !BLOCKS[w.getBlock(mx, my - 2, mz)].solid) continue;
        const mob = new Mob(this, sType, mx + 0.5, my, mz + 0.5);
        if (mob.collides(mob.box())) continue;
        this.entities.push(mob);
        spawned++;
        for (let k = 0; k < 12; k++) {
          this.particles.spawn('flame', sx + 0.5 + (Math.random() - 0.5) * 0.6, sy + 0.5 + (Math.random() - 0.5) * 0.6, sz + 0.5 + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.04, 0.02, (Math.random() - 0.5) * 0.04);
          this.particles.spawn('poof', mx + 0.5 + (Math.random() - 0.5) * 0.8, my + 0.4 + Math.random() * 0.5, mz + 0.5 + (Math.random() - 0.5) * 0.8, 0, 0.02, 0);
        }
      }
    }
  }
  rainParticles() {
    const p = this.player, w = this.world;
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(p.pos[0] + (Math.random() - 0.5) * 20), z = Math.floor(p.pos[2] + (Math.random() - 0.5) * 20);
      const ch = w.getChunk(x >> 4, z >> 4); if (!ch) continue;
      if (this.isCold(x, z)) continue;
      let y = Math.floor(p.pos[1]) + 10;
      while (y > p.pos[1] - 10 && !BLOCKS[w.getBlock(x, y, z)].solid && !IS_FLUID[w.getBlock(x, y, z)]) y--;
      if (y > p.pos[1] - 10) this.particles.spawn('rain', x + Math.random(), y + 1.05, z + Math.random(), 0, 0.05, 0);
    }
  }
  isCold(x, z) {
    const ch = this.world.getChunk(x >> 4, z >> 4);
    if (!ch) return false;
    const b = ch.biome[((z & 15) << 4) | (x & 15)];
    return b === BI.SNOWY || b === BI.SNOWPEAK || b === BI.FROZEN_OCEAN;
  }
  tintAt(x, z, kind) {
    const ch = this.world.getChunk(x >> 4, z >> 4);
    if (!ch) return [124, 189, 107];
    const i = (((z & 15) << 4) | (x & 15)) * 3, a = kind === 'foliage' ? ch.foliage : ch.grass;
    if (kind === 'birch') return [128, 167, 85]; if (kind === 'spruce') return [97, 153, 97]; if (kind === 'water') return [63, 118, 228];
    return [a[i], a[i + 1], a[i + 2]];
  }

  // ---- time ---------------------------------------------------------------------------
  dayTime() { return ((this.worldTime % 24000) + 24000) % 24000; }
  celestial() {
    const f0 = this.dayTime() / 24000 - 0.25;
    const f = f0 - Math.floor(f0);
    const g = 0.5 - Math.cos(f * Math.PI) / 2;
    return f + (g - f) / 3;
  }
  isDay() { const c = Math.cos(this.celestial() * Math.PI * 2); return c > 0.0; }
  daylight() { const c = Math.cos(this.celestial() * Math.PI * 2); return clamp(c * 2 + 0.5, 0, 1); }

  // ---- XP ----------------------------------------------------------------------------
  xpNeeded(l) { return l >= 30 ? 112 + (l - 30) * 9 : l >= 15 ? 37 + (l - 15) * 5 : 7 + l * 2; }
  xpTotalFor(l) { let t = 0; for (let i = 0; i < l; i++) t += this.xpNeeded(i); return t; }
  xpLevel() { let l = 0, t = 0, x = this.player.xp; while (t + this.xpNeeded(l) <= x) { t += this.xpNeeded(l); l++; } return l; }
  deductXpLevels(n) {
    if (n <= 0) return;
    const curLvl = this.xpLevel();
    const curNeed = this.xpNeeded(curLvl);
    const frac = clamp((this.player.xp - this.xpTotalFor(curLvl)) / curNeed, 0, 0.999);
    const newLvl = Math.max(0, curLvl - n);
    this.player.xp = this.xpTotalFor(newLvl) + Math.floor(frac * this.xpNeeded(newLvl));
  }
  addXp(n) {
    if (this.mode === 'creative' || n <= 0) return;
    const before = this.xpLevel();
    this.player.xp += n;
    Sound.tone(null, { freq: 1200 + Math.random() * 400, dur: 0.12, vol: 0.12, type: 'sine' });
    const after = this.xpLevel();
    if (after > before && after % 5 === 0) Sound.levelup();
  }

  grant(key) {
    if (this.adv[key] || this.state !== 'play') return;
    this.adv[key] = Date.now();
    const a = ADVANCEMENTS[key];
    this.ui.toast('进度达成！', a[0], item(a[1]));
    this.ui.message(`玩家取得了进度 [${a[0]}]`, '#55FF55');
  }

  // ---- hooks from world/entities ------------------------------------------------------------
  onBlockChanged(x, y, z, old, id, oldMeta) {
    if (old !== id) {
      const k = `${x},${y},${z}`;
      const be = this.blockEntities.get(k);
      if (be && id !== 52 && id !== 20 && id !== 117 && id !== 513 && id !== 527) {
        const drops = (be.type === 'chest' || be.type === 'hopper')
          ? be.slots
          : be.type === 'brewing'
            ? [...(be.bottles || []), be.ingredient, be.fuel]
            : [be.input, be.fuel, be.output];
        for (const s of drops) if (s) this.dropItem(x + 0.5, y + 0.5, z + 0.5, { ...s });
        this.blockEntities.delete(k);
        if (this.ui.screen && this.ui.screen.be === be) this.ui.close();
      }
    }
    Redstone.propagateFromSource(this, x, y, z);
    if (typeof Redstone !== 'undefined') {
      if (Redstone.checkObserversWatching) Redstone.checkObserversWatching(this, x, y, z);
      if (Redstone.updateComparatorsNear) Redstone.updateComparatorsNear(this, x, y, z);
    }
  }
  onBlockMetaChanged(x, y, z, id, oldMeta, newMeta) {
    if (typeof Redstone !== 'undefined') {
      if (Redstone.checkObserversWatching) Redstone.checkObserversWatching(this, x, y, z);
      if (id === 52 || id === 20 || id === 117 || id === 513 || id === 527) {
        if (Redstone.updateComparatorsNear) Redstone.updateComparatorsNear(this, x, y, z);
      }
    }
  }
  onNeighborUpdate(x, y, z, id) {
    const w = this.world, b = BLOCKS[id];
    if (!b) return;
    if (id === 528) {
      // Nether portal cascade break if any in-plane adjacent frame/portal block is broken
      const meta = w.getMeta(x, y, z) & 1;
      const dx = meta === 0 ? 1 : 0, dz = meta === 1 ? 1 : 0;
      const n1 = w.getBlock(x - dx, y, z - dz), n2 = w.getBlock(x + dx, y, z + dz);
      const n3 = w.getBlock(x, y - 1, z), n4 = w.getBlock(x, y + 1, z);
      const valid = (bid) => bid === 28 || bid === 528;
      if (!valid(n1) || !valid(n2) || !valid(n3) || !valid(n4)) {
        w.setBlock(x, y, z, 0, 0, 1);
        this.flushMesh();
      }
      return;
    }
    if (b.gravity) {
      const below = w.getBlock(x, y - 1, z);
      if (y > 0 && (below === 0 || REPLACEABLE[below] || IS_FLUID[below]) && w.isLoaded(x, z)) {
        const meta = w.getMeta(x, y, z);
        w.setBlock(x, y, z, 0, 0);
        this.entities.push(new FallingBlock(this, x, y, z, id, meta));
      }
      return;
    }
    if (b.needsSupport || b.door) {
      if (!this.supported(x, y, z, id, w.getMeta(x, y, z))) { this.breakBlock(x, y, z, true); return; }
    }
    Redstone.notifyRedstoneAt(this, x, y, z);
  }
  onScheduledTick(x, y, z, id) {
    Redstone.onScheduledTick(this, x, y, z, id);
    this.flushMesh();
  }
  supported(x, y, z, id, meta) {
    const b = BLOCKS[id];
    if (!b) return true;
    const w = this.world, below = w.getBlock(x, y - 1, z), bb = BLOCKS[below];
    const solidBelow = SOLIDCUBE[below] || (bb && bb.slab && (w.getMeta(x, y - 1, z) & 3) !== 0) || (bb && bb.stairs && (w.getMeta(x, y - 1, z) & 4) === 0) || below === 63;
    switch (b.key) {
      case 'torch': case 'redstone_torch': case 'redstone_torch_off': {
        if (!meta) return solidBelow;
        const sd = meta === 6 ? 0 : (meta & 7);
        return !!SOLIDCUBE[w.getBlock(x + DIRS[sd][0], y, z + DIRS[sd][2])];
      }
      case 'lever': case 'stone_button': case 'oak_button': {
        const sd = meta & 7;
        if (sd === 2) return solidBelow;
        return !!SOLIDCUBE[w.getBlock(x + DIRS[sd][0], y + DIRS[sd][1], z + DIRS[sd][2])];
      }
      case 'redstone_wire': case 'stone_pressure_plate': case 'oak_pressure_plate': case 'repeater': case 'lit_repeater': case 'comparator':
        return solidBelow;
      case 'ladder': return !!SOLIDCUBE[w.getBlock(x + DIRS[meta][0], y, z + DIRS[meta][2])];
      case 'wheat': return below === 63;
      case 'nether_wart_crop': return below === 530;
      case 'sugar_cane': return below === 38 || below === 2 || below === 3 || below === 9 || below === 97;
      case 'cactus': return below === 37 || below === 9 || below === 97;
      case 'dead_bush': return below === 9 || below === 97 || below === 3 || below === 2 || below === 83;
      case 'snow': return !!SOLIDCUBE[below] && below !== 35 && below !== 96;
      case 'oak_door': case 'cherry_door': return (meta & 8) ? w.getBlock(x, y - 1, z) === id : (SOLIDCUBE[below] && w.getBlock(x, y + 1, z) === id);
      case 'red_mushroom': case 'brown_mushroom': return !!SOLIDCUBE[below];
    }
    if (b.needsSupport) return below === 2 || below === 3 || below === 63 || below === 88;
    return true;
  }
  onFizz(x, y, z) { Sound.fizz([x, y, z]); for (let i = 0; i < 6; i++) this.particles.spawn('smoke', x + Math.random(), y + 1, z + Math.random(), 0, 0.05, 0); }
  onFluidDestroy(x, y, z, id) {
    const b = BLOCKS[id];
    if (b && !REPLACEABLE[id] && this.mode !== 'creative') this.dropBlockLoot(x, y, z, id, this.world.getMeta(x, y, z), null);
    else if (b && b.drops && id !== 39 && id !== 40) this.dropBlockLoot(x, y, z, id, 0, null);
  }
  onRandomTick(x, y, z, id, ch) {
    const w = this.world;
    switch (id) {
      case 2: {
        const above = w.getBlock(x, y + 1, z);
        if (SOLIDCUBE[above] || IS_FLUID[above]) { w.setBlock(x, y, z, 3, 0); break; }
        if (w.skyAt(x, y + 1, z) >= 9 || w.blockLightAt(x, y + 1, z) >= 9) {
          const nx = x + ((Math.random() * 3) | 0) - 1, ny = y + ((Math.random() * 5) | 0) - 3, nz = z + ((Math.random() * 3) | 0) - 1;
          if (w.getBlock(nx, ny, nz) === 3 && !SOLIDCUBE[w.getBlock(nx, ny + 1, nz)] && !IS_FLUID[w.getBlock(nx, ny + 1, nz)] && (w.getLight(nx, ny + 1, nz) >> 4) >= 4) w.setBlock(nx, ny, nz, 2, 0);
        }
        break;
      }
      case 64: {
        const m = w.getMeta(x, y, z);
        if (m < 7 && Math.max(w.skyAt(x, y, z) * this.daylight(), w.blockLightAt(x, y, z)) >= 9 && Math.random() < (w.getMeta(x, y - 1, z) ? 0.5 : 0.25)) w.setMeta(x, y, z, m + 1);
        break;
      }
      case 536: {
        const m = w.getMeta(x, y, z) & 3;
        if (m < 3 && Math.random() < 0.18) w.setMeta(x, y, z, m + 1);
        break;
      }
      case 537: {
        if (w.getBlock(x, y - 1, z) !== 529 && Math.random() < 0.35) w.setBlock(x, y, z, 0, 0);
        break;
      }
      case 65: case 66: case 67: case 521:
        if (Math.random() < 0.15 && (w.skyAt(x, y, z) >= 9 || w.blockLightAt(x, y, z) >= 9)) this.growTree(x, y, z, id);
        break;
      case 63: {
        let wet = false;
        for (let dx = -4; dx <= 4 && !wet; dx++) for (let dz = -4; dz <= 4 && !wet; dz++) for (let dy = 0; dy <= 1; dy++) if (w.getBlock(x + dx, y + dy, z + dz) === WATER) { wet = true; break; }
        const m = w.getMeta(x, y, z);
        if (wet && !m) w.setMeta(x, y, z, 1);
        else if (!wet) { if (m) w.setMeta(x, y, z, 0); else if (w.getBlock(x, y + 1, z) !== 64 && Math.random() < 0.3) w.setBlock(x, y, z, 3, 0); }
        break;
      }
      case 38: case 37: {
        if (w.getBlock(x, y + 1, z) === 0 && Math.random() < 0.08) {
          let h = 1; while (w.getBlock(x, y - h, z) === id) h++;
          if (h < 3) w.setBlock(x, y + 1, z, id, 0);
        }
        break;
      }
      case 15: case 47: case 50: case 520: {
        if (w.getMeta(x, y, z) & 4) break; // player placed
        if (!this.nearLog(x, y, z)) this.breakBlock(x, y, z, true, true);
        break;
      }
      case 34: case 35:
        if (w.blockLightAt(x, y, z) > 11 || (id === 35 && w.blockLightAt(x, y + 1, z) > 11)) { if (id === 35) w.setBlock(x, y, z, WATER, 0); else w.setBlock(x, y, z, 0, 0); }
        break;
    }
  }
  nearLog(x, y, z) {
    const w = this.world, seen = new Set([`${x},${y},${z}`]), q = [[x, y, z, 0]];
    while (q.length) {
      const [a, b, c, d] = q.shift();
      for (const D of DIRS) {
        const nx = a + D[0], ny = b + D[1], nz = c + D[2], k = `${nx},${ny},${nz}`;
        if (seen.has(k)) continue; seen.add(k);
        if (!w.isLoaded(nx, nz)) return true;
        const id = w.getBlock(nx, ny, nz);
        if (id === 14 || id === 46 || id === 49 || id === 519) return true;
        if ((id === 15 || id === 47 || id === 50 || id === 520) && d < 4) q.push([nx, ny, nz, d + 1]);
      }
    }
    return false;
  }
  growTree(x, y, z, sap) {
    const w = this.world;
    const type = sap === 66 ? 'birch' : sap === 67 ? 'spruce' : sap === 521 ? 'cherry' : (Math.random() < 0.1 ? 'big' : 'oak');
    const h = 4 + ((Math.random() * 3) | 0);
    for (let dy = 1; dy <= h + 1; dy++) { const id = w.getBlock(x, y + dy, z); if (id && !BLOCKS[id].replaceable && id !== 15 && id !== 47 && id !== 50 && id !== 520) return false; }
    w.setBlock(x, y, z, 0, 0, 0);
    this.world.placeTree((wx, wy, wz, id, meta, force) => {
      const cur = w.getBlock(wx, wy, wz);
      if (force ? cur !== 6 : (cur === 0 || REPLACEABLE[cur])) w.setBlock(wx, wy, wz, id, meta);
    }, { x, y, z, type, h, seed: (Math.random() * 1e9) | 0 });
    return true;
  }

  // ---- mob spawning ----------------------------------------------------------------------
  pickNetherMobType(x, y, z, r = Math.random()) {
    const w = this.world;
    const inFortress = typeof Structures !== 'undefined' && Structures.isInsideNetherFortress && Structures.isInsideNetherFortress(x, y, z, w);
    if (inFortress) {
      // Nether Fortress: Blaze (35%), Wither Skeleton (35%), Zombified Piglin (20%), Skeleton (10%)
      return r < 0.35 ? 'blaze' : r < 0.70 ? 'wither_skeleton' : r < 0.90 ? 'zombified_piglin' : 'skeleton';
    }
    // Nether Wastes: Zombified Piglin (55%), Ghast (25%), Enderman (14% small amount), Skeleton (6% very small amount)
    return r < 0.55 ? 'zombified_piglin' : r < 0.80 ? 'ghast' : r < 0.94 ? 'enderman' : 'skeleton';
  }
  spawnMobs() {
    if (this.mode === 'creative' && !this.settings.creativeMobs) { }
    const p = this.player, w = this.world;
    if (w.dimension === 'end') {
      const endermanCount = this.entities.filter(e => e instanceof Mob && !e.dead && e.type === 'enderman').length;
      if (endermanCount >= 14) return;
      for (let attempt = 0; attempt < 4; attempt++) {
        const a = Math.random() * Math.PI * 2, d = 14 + Math.random() * 28;
        const x = Math.floor(p.pos[0] + Math.sin(a) * d), z = Math.floor(p.pos[2] + Math.cos(a) * d);
        if (!w.isLoaded(x, z)) continue;
        const y = w.surfaceY(x, z) + 1;
        if (y <= 20 || w.getBlock(x, y - 1, z) !== 540) continue;
        if (w.getBlock(x, y, z) !== 0 || w.getBlock(x, y + 1, z) !== 0 || w.getBlock(x, y + 2, z) !== 0) continue;
        const m = new Mob(this, 'enderman', x + 0.5, y, z + 0.5);
        m.persistent = false;
        if (!m.collides(m.box())) this.entities.push(m);
      }
      return;
    }
    if (w.dimension === 'nether') {
      const netherCount = this.entities.filter(e => e instanceof Mob && !e.dead).length;
      const ghastCount = this.entities.filter(e => e instanceof Mob && !e.dead && e.type === 'ghast').length;
      if (netherCount >= 26) return;
      for (let attempt = 0; attempt < 4; attempt++) {
        const a = Math.random() * Math.PI * 2, d = 20 + Math.random() * 38;
        const x = Math.floor(p.pos[0] + Math.sin(a) * d), z = Math.floor(p.pos[2] + Math.cos(a) * d);
        if (!w.isLoaded(x, z)) continue;
        // Find a valid cavern floor y in 32..108
        let y = w.surfaceY(x, z) + 1;
        const ry = 33 + Math.floor(Math.random() * 72);
        if (w.getBlock(x, ry, z) === 0 && w.getBlock(x, ry + 1, z) === 0 && SOLIDCUBE[w.getBlock(x, ry - 1, z)]) {
          y = ry;
        }
        if (w.getBlock(x, y, z) !== 0 || w.getBlock(x, y + 1, z) !== 0 || !SOLIDCUBE[w.getBlock(x, y - 1, z)]) continue;
        let type = this.pickNetherMobType(x, y, z, Math.random());
        if (type === 'ghast' && ghastCount >= 4) type = 'zombified_piglin';
        const sy = type === 'ghast' ? Math.min(104, y + 6) : y;
        const m = new Mob(this, type, x + 0.5, sy, z + 0.5);
        m.persistent = false;
        if (!m.collides(m.box())) this.entities.push(m);
      }
      return;
    }
    const hostiles = this.entities.filter(e => e instanceof Mob && e.T.hostile).length;
    const passives = this.entities.filter(e => e instanceof Mob && e.T.passive && e.distTo(p) < 96).length;
    const day = this.daylight();
    for (let attempt = 0; attempt < 3; attempt++) {
      const a = Math.random() * Math.PI * 2, d = 24 + Math.random() * 40;
      const x = Math.floor(p.pos[0] + Math.sin(a) * d), z = Math.floor(p.pos[2] + Math.cos(a) * d);
      if (!w.isLoaded(x, z)) continue;
      const surface = w.surfaceY(x, z);
      // choose y: surface or random cave spot
      let y = surface + 1;
      if (Math.random() < 0.5) {
        const ty = 8 + Math.floor(Math.random() * Math.max(1, surface - 10));
        if (w.getBlock(x, ty, z) === 0 && w.getBlock(x, ty + 1, z) === 0 && BLOCKS[w.getBlock(x, ty - 1, z)].solid) y = ty;
      }
      if (w.getBlock(x, y, z) !== 0 || w.getBlock(x, y + 1, z) !== 0 || !SOLIDCUBE[w.getBlock(x, y - 1, z)]) continue;
      const l = w.getLight(x, y, z), sky = (l >> 4) * day, blk = l & 15;
      if (blk === 0 && sky <= 7 && hostiles < 22 && Math.random() < 0.6 && Math.hypot(x - p.pos[0], z - p.pos[2]) > 24) {
        const r = Math.random();
        const type = r < 0.35 ? 'zombie' : r < 0.6 ? 'skeleton' : r < 0.85 ? 'creeper' : 'spider';
        const m = new Mob(this, type, x + 0.5, y, z + 0.5);
        m.persistent = false;
        if (!m.collides(m.box())) this.entities.push(m);
      } else if (passives < 12 && day > 0.8 && w.getBlock(x, y - 1, z) === 2 && sky >= 9 && Math.random() < 0.02) {
        const t = ['pig', 'cow', 'sheep', 'chicken'][(Math.random() * 4) | 0];
        for (let i = 0; i < 2 + Math.random() * 2; i++) this.entities.push(new Mob(this, t, x + 0.5 + Math.random(), y, z + 0.5 + Math.random()));
      }
    }
  }

  // ---- furnaces & hoppers ----------------------------------------------------------------
  tickFurnaces() {
    for (const [k, be] of this.blockEntities) {
      if (be.type !== 'furnace') continue;
      const [x, y, z] = be.pos;
      if (!this.world.isLoaded(x, z)) continue;
      const wasBurning = be.burn > 0;
      if (be.burn > 0) be.burn--;
      const rec = be.input && SMELTING[be.input.id];
      const canSmelt = rec && (!be.output || (be.output.id === rec.result && be.output.count < maxStack(rec.result)));
      if (be.burn === 0 && canSmelt && be.fuel) {
        const f = fuelValue(be.fuel.id);
        if (f) {
          be.burn = be.burnMax = f;
          if (be.fuel.id === item('lava_bucket')) be.fuel = makeStack('bucket');
          else { be.fuel.count--; if (!be.fuel.count) be.fuel = null; }
        }
      }
      let slotChanged = false;
      if (be.burn === 0 && canSmelt && be.fuel) slotChanged = true;
      if (be.burn > 0 && canSmelt) {
        if (++be.cook >= 200) {
          be.cook = 0;
          if (be.output) be.output.count++; else be.output = { id: rec.result, count: 1, dmg: 0 };
          be.xp = (be.xp || 0) + rec.xp;
          be.input.count--; if (!be.input.count) be.input = null;
          slotChanged = true;
        }
      } else if (be.cook > 0) be.cook = Math.max(0, be.cook - 2);
      const burning = be.burn > 0;
      if (burning !== wasBurning) {
        const meta = this.world.getMeta(x, y, z);
        this.world.setBlock(x, y, z, burning ? 117 : 20, meta, 0);
      }
      if (slotChanged && typeof Redstone !== 'undefined' && Redstone.updateComparatorsNear) {
        Redstone.updateComparatorsNear(this, x, y, z);
      }
    }
  }
  tickHoppers() {
    if (typeof Hopper !== 'undefined') Hopper.tickAll(this);
  }
  tickBrewingStands() {
    if (typeof Brewing === 'undefined') return;
    for (const [, be] of this.blockEntities) {
      if (be.type !== 'brewing') continue;
      const [x, y, z] = be.pos;
      if (!this.world.isLoaded(x, z)) continue;
      if (!Array.isArray(be.bottles) || be.bottles.length < 3) be.bottles = [null, null, null];
      let slotChanged = false;
      // Top up blaze powder fuel charges when empty
      if ((be.fuelCharges || 0) <= 0 && be.fuel && Brewing.isFuel(be.fuel)) {
        be.fuelCharges = 20;
        be.fuel.count--;
        if (be.fuel.count <= 0) be.fuel = null;
        slotChanged = true;
      }
      const canBrew = (be.fuelCharges || 0) > 0 && Brewing.canBrew(be);
      if (canBrew) {
        be.brewTime = (be.brewTime || 0) + 1;
        if (be.brewTime >= 400) {
          be.brewTime = 0;
          be.fuelCharges = Math.max(0, (be.fuelCharges || 0) - 1);
          for (let i = 0; i < 3; i++) {
            const outKey = Brewing.match(be.bottles[i], be.ingredient);
            if (outKey) be.bottles[i] = makeStack(outKey, 1);
          }
          be.ingredient.count--;
          if (be.ingredient.count <= 0) be.ingredient = null;
          Sound.splash([x + 0.5, y + 0.5, z + 0.5]);
          this.grant('brew');
          slotChanged = true;
        }
      } else if (be.brewTime > 0) {
        be.brewTime = 0;
      }
      // Sync bottle presence mask (0..7) to block metadata so 3D model updates
      const mask = (be.bottles[0] ? 1 : 0) | (be.bottles[1] ? 2 : 0) | (be.bottles[2] ? 4 : 0);
      if (this.world.getBlock(x, y, z) === 527 && (this.world.getMeta(x, y, z) & 7) !== mask) {
        this.world.setMeta(x, y, z, mask);
      }
      if (slotChanged && typeof Redstone !== 'undefined' && Redstone.updateComparatorsNear) {
        Redstone.updateComparatorsNear(this, x, y, z);
      }
    }
  }
  markBlockEntity(be) {
    if (be && be.pos && typeof Redstone !== 'undefined' && Redstone.updateComparatorsNear) {
      Redstone.updateComparatorsNear(this, be.pos[0], be.pos[1], be.pos[2]);
    }
  }
  getBlockEntity(x, y, z, type) {
    const k = `${x},${y},${z}`;
    let be = this.blockEntities.get(k);
    if (!be) {
      if (type === 'chest') be = { type, pos: [x, y, z], slots: new Array(27).fill(null) };
      else if (type === 'hopper') be = { type, pos: [x, y, z], slots: new Array(5).fill(null), cd: 0 };
      else if (type === 'brewing') be = { type, pos: [x, y, z], bottles: [null, null, null], ingredient: null, fuel: null, brewTime: 0, fuelCharges: 0 };
      else be = { type, pos: [x, y, z], input: null, fuel: null, output: null, burn: 0, burnMax: 0, cook: 0 };
      this.blockEntities.set(k, be);
    }
    return be;
  }
  trySleep(x, y, z) {
    const p = this.player, w = this.world;
    const meta = w.getMeta(x, y, z);
    let hx = x, hz = z;
    if (!(meta & 4)) { const D2 = DIRS[[4, 1, 5, 0][meta & 3]]; hx += D2[0]; hz += D2[2]; }
    if (w.dimension !== 'overworld') {
      // Attempting to sleep in a bed in the Nether triggers a power 5 explosion!
      const R = [4, 1, 5, 0][meta & 3], D2 = DIRS[(meta & 4) ? OPP[R] : R];
      const ox = x + D2[0], oz = z + D2[2];
      w.setBlock(x, y, z, 0, 0, 1);
      if (w.getBlock(ox, y, oz) === 118) w.setBlock(ox, y, oz, 0, 0, 1);
      this.explode(x + 0.5, y + 0.5, z + 0.5, 5, null);
      for (let i = 0; i < 8; i++) {
        const fx = x + ((Math.random() * 7) | 0) - 3, fy = y + ((Math.random() * 5) | 0) - 2, fz = z + ((Math.random() * 7) | 0) - 3;
        if (fy > 1 && fy < HEIGHT - 1 && w.getBlock(fx, fy, fz) === 0 && SOLIDCUBE[w.getBlock(fx, fy - 1, fz)]) {
          w.setBlock(fx, fy, fz, 537, 0);
        }
      }
      this.flushMesh();
      return;
    }
    p.spawn = [hx, y + 1, hz];
    const t = this.dayTime();
    if (t > 1000 && t < 12542 && this.weather < 0.8) { this.ui.actionBar = { text: '你只能在夜间或雷暴中入睡（已设置重生点）', t: performance.now() }; return; }
    if (Math.hypot(p.pos[0] - hx - 0.5, p.pos[2] - hz - 0.5) > 3) { this.ui.actionBar = { text: '你离床太远了', t: performance.now() }; return; }
    const danger = this.entities.some(e => e instanceof Mob && e.T.hostile && e.deathTime === 0 && Math.abs(e.pos[0] - hx) < 8 && Math.abs(e.pos[1] - y) < 5 && Math.abs(e.pos[2] - hz) < 8);
    if (danger) { this.ui.actionBar = { text: '你现在不能休息，周围有怪物在游荡', t: performance.now(), color: '#FF5555' }; return; }
    this.sleeping = { x: hx + 0.5, y: y + 0.5625, z: hz + 0.5, t: 0, rot: meta & 3 };
    p.vel = [0, 0, 0];
    this.ui.message('正在睡觉…（按 Shift 起床）', '#AAAAAA');
  }
  tickSleep() {
    const s = this.sleeping, p = this.player;
    if (!s) { if (this.sleepFade > 0) this.sleepFade = Math.max(0, this.sleepFade - 0.05); return false; }
    s.t++;
    p.pos = [s.x, s.y, s.z]; p.prev = [...p.pos]; p.vel = [0, 0, 0]; p.fallDist = 0;
    this.sleepFade = Math.min(1, s.t / 80);
    const wake = this.keys.ShiftLeft || this.keys.ShiftRight || p.hurtTime > 0;
    if (s.t >= 100) {
      this.worldTime = (Math.floor(this.worldTime / 24000) + 1) * 24000;
      if (this.rainTarget) { this.rainTarget = 0; this.weather = 0; }
      this.ui.message('早上好！', '#FFFF55'); this.grant('sleep');
    }
    if (s.t >= 100 || wake) {
      this.sleeping = null;
      p.pos = [s.x, s.y + 0.5, s.z]; p.prev = [...p.pos];
      while (p.collides(p.box()) && p.pos[1] < HEIGHT) p.pos[1] += 1;
      p.prev = [...p.pos];
    }
    return true;
  }
  fillLoot(be, x, y, z, lootType = 0) {
    const r = RNG(hashStr('loot' + this.world.seed + ':' + x + ':' + y + ':' + z + ':' + lootType));
    const tables = [
      // 0: Dungeon
      [['bread', 1, 3, 0.5], ['wheat', 1, 4, 0.5], ['iron_ingot', 1, 4, 0.55], ['gold_ingot', 1, 3, 0.35], ['coal', 3, 8, 0.5], ['string', 1, 4, 0.4],
       ['bone', 2, 6, 0.5], ['rotten_flesh', 2, 5, 0.5], ['gunpowder', 1, 4, 0.4], ['diamond', 1, 2, 0.2], ['golden_apple', 1, 1, 0.12], ['bucket', 1, 1, 0.15],
       ['iron_pickaxe', 1, 1, 0.08], ['apple', 1, 3, 0.3], ['redstone', 2, 6, 0.25], ['emerald', 1, 2, 0.12], ['wheat_seeds', 2, 5, 0.3], ['iron_chestplate', 1, 1, 0.06], ['bow', 1, 1, 0.1], ['arrow', 4, 12, 0.25]],
      // 1: Desert Pyramid (Minecraft Wiki desert_pyramid table)
      [['bone', 4, 6, 0.7], ['rotten_flesh', 3, 7, 0.7], ['gunpowder', 2, 6, 0.6], ['sand', 2, 8, 0.55], ['string', 2, 6, 0.55],
       ['gold_ingot', 2, 7, 0.45], ['iron_ingot', 1, 5, 0.4], ['emerald', 1, 3, 0.35], ['diamond', 1, 3, 0.25], ['golden_apple', 1, 1, 0.25],
       ['leather', 1, 5, 0.3], ['tnt', 1, 2, 0.2], ['book', 1, 2, 0.25]],
      // 2: Mineshaft (Minecraft Wiki mineshaft table)
      [['rail', 4, 8, 0.78], ['torch', 4, 16, 0.66], ['coal', 3, 8, 0.5], ['iron_ingot', 1, 5, 0.45], ['gold_ingot', 1, 3, 0.28],
       ['redstone', 4, 9, 0.35], ['lapis_lazuli', 4, 9, 0.35], ['bread', 1, 3, 0.45], ['golden_apple', 1, 1, 0.28],
       ['iron_pickaxe', 1, 1, 0.22], ['diamond', 1, 2, 0.18], ['wheat_seeds', 2, 4, 0.35]],
      // 3: Village Blacksmith / House (Minecraft Wiki village_weaponsmith & house tables)
      [['bread', 1, 4, 0.65], ['apple', 1, 5, 0.55], ['iron_ingot', 1, 5, 0.6], ['gold_ingot', 1, 3, 0.3],
       ['iron_pickaxe', 1, 1, 0.35], ['iron_sword', 1, 1, 0.35], ['iron_helmet', 1, 1, 0.25], ['iron_chestplate', 1, 1, 0.25],
       ['iron_leggings', 1, 1, 0.25], ['iron_boots', 1, 1, 0.25], ['obsidian', 3, 7, 0.25], ['oak_sapling', 3, 7, 0.3],
       ['emerald', 1, 4, 0.35], ['diamond', 1, 3, 0.22], ['baked_potato', 1, 4, 0.35], ['carrot', 1, 4, 0.35]],
      // 4: Nether Fortress (Minecraft Wiki nether_bridge table)
      [['diamond', 1, 3, 0.35], ['iron_ingot', 1, 5, 0.45], ['gold_ingot', 1, 3, 0.65], ['golden_sword', 1, 1, 0.35],
       ['flint_and_steel', 1, 1, 0.45], ['nether_wart', 3, 7, 0.55], ['obsidian', 2, 4, 0.3], ['golden_apple', 1, 1, 0.28],
       ['iron_chestplate', 1, 1, 0.25]],
      // 5: Stronghold Altar Chest (Minecraft Wiki stronghold_crossing / corridor table)
      [['ender_pearl', 1, 3, 0.75], ['diamond', 1, 3, 0.35], ['iron_ingot', 1, 5, 0.55], ['gold_ingot', 1, 3, 0.4],
       ['bread', 1, 3, 0.6], ['apple', 1, 3, 0.5], ['iron_pickaxe', 1, 1, 0.35], ['iron_sword', 1, 1, 0.35],
       ['golden_apple', 1, 1, 0.25], ['redstone', 4, 9, 0.35]],
    ];
    const table = tables[lootType] || tables[0];
    for (const [k, mn, mx, ch] of table) {
      if (r() > ch) continue;
      let slot = r.int(27); let guard = 0;
      while (be.slots[slot] && guard++ < 30) slot = r.int(27);
      be.slots[slot] = makeStack(k, mn + r.int(mx - mn + 1));
    }
    if (typeof Enchant !== 'undefined' && (lootType === 0 || lootType === 1 || lootType === 2)) {
      const bookChance = lootType === 1 ? 0.65 : 0.45;
      if (r() < bookChance) {
        let slot = r.int(27); let guard = 0;
        while (be.slots[slot] && guard++ < 30) slot = r.int(27);
        be.slots[slot] = Enchant.randomLootBook(r);
      }
    }
  }
  onSmeltTake(st, be) {
    const id = st.id;
    if (id === item('iron_ingot')) this.grant('iron');
    if (['cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken'].some(k => item(k) === id)) this.grant('cook');
    if (be.xp) { this.addXp(Math.floor(be.xp + Math.random())); be.xp = 0; }
  }
  onCraft(id, count) {
    const k = ITEMS[id].key;
    if (k.endsWith('_planks') && this.tutStat) this.tutStat.planks = true;
    if (k === 'crafting_table') this.grant('crafting_table');
    if (k === 'wooden_pickaxe') this.grant('pickaxe');
    if (k === 'stone_pickaxe') this.grant('stone_pickaxe');
    if (k === 'furnace') this.grant('furnace');
    if (k === 'bread') this.grant('bread');
    if (k === 'bow') this.grant('bow');
    if (['redstone_torch', 'repeater', 'comparator', 'observer', 'piston', 'sticky_piston', 'redstone_lamp', 'lever', 'target', 'hopper'].includes(k)) this.grant('redstone');
    if (k === 'brewing_stand') this.grant('brew');
  }
  onPickup(id, n) {
    const k = ITEMS[id].key;
    if (k.endsWith('_log')) this.grant('wood');
    if (k === 'diamond') this.grant('diamond');
    if (k === 'redstone') this.grant('redstone');
    if (k === 'wheat') this.grant('farm');
  }
  onMobKilled(m, src) {
    if (src && (src.attacker === this.player || src.player)) {
      if (m.T.hostile) { this.grant('kill'); this.addXp(5); } else this.addXp(1 + ((Math.random() * 3) | 0));
    }
  }
  onPlayerHurt(src) { this.hurtTilt = 1; }
  onPlayerDeath(src) {
    const p = this.player;
    const msgs = { fall: '从高处摔了下来', lava: '试图在熔岩里游泳', fire: '被烧死了', drown: '淹死了', starve: '饿死了', mob: '被杀死了', arrow: '被射杀', explosion: '爆炸了', cactus: '被戳死了', void: '掉出了这个世界' };
    let msg = msgs[src && src.type] || '死了';
    if (src && src.attacker && src.attacker.T) msg = (src.type === 'arrow' ? '被' + src.attacker.T.cn + '射杀' : '被' + src.attacker.T.cn + '杀死了');
    if (src && src.type === 'explosion' && src.attacker && src.attacker.T) msg = '被' + src.attacker.T.cn + '炸死了';
    this.deathMsg = '玩家' + msg;
    this.ui.message(this.deathMsg, '#FFFFFF');
    // drop inventory
    for (let i = 0; i < 41; i++) { const s = p.inv.slots[i]; if (s) { this.dropItem(p.pos[0], p.pos[1] + 1, p.pos[2], s, [(Math.random() - 0.5) * 0.5, 0.3, (Math.random() - 0.5) * 0.5]); p.inv.slots[i] = null; } }
    this.deathScore = p.xp; p.xp = 0;
    setTimeout(() => { if (this.state === 'play') this.ui.open(new DeathScreen(this)); }, 1000);
  }
  async respawn() {
    const p = this.player, s = p.spawn || [0, 80, 0];
    p.health = 20; p.food = 20; p.saturation = 5; p.deathTime = 0; p.fire = 0; p.air = 300; p.fallDist = 0; p.dead = false;
    if (p.clearEffects) p.clearEffects();
    this.ui.close();
    if (this.world && this.world.dimension !== 'overworld') {
      await this.switchDimension('overworld', [s[0] + 0.5, s[1], s[2] + 0.5]);
      return;
    }
    this.loadChunk(s[0] >> 4, s[2] >> 4);
    p.pos = [s[0] + 0.5, s[1], s[2] + 0.5]; p.prev = [...p.pos]; p.vel = [0, 0, 0];
    let y = s[1];
    while (p.collides(p.box()) && y < HEIGHT) { y++; p.pos[1] = y; }
    p.prev = [...p.pos];
  }

  // ---- items & drops ---------------------------------------------------------------------
  dropItem(x, y, z, stack, vel) {
    if (!stack || stack.count <= 0) return;
    const cloned = typeof Enchant !== 'undefined' ? Enchant.cloneStack(stack) : { id: stack.id, count: stack.count, dmg: stack.dmg || 0 };
    const e = new ItemEntity(this, x, y, z, cloned, vel);
    this.entities.push(e);
    return e;
  }
  dropFromPlayer(stack) {
    const p = this.player;
    const dir = this.lookDir();
    const e = this.dropItem(p.pos[0], p.pos[1] + p.eye() - 0.3, p.pos[2], stack, [dir[0] * 0.3, dir[1] * 0.3 + 0.1, dir[2] * 0.3]);
    if (e) e.pickup = 40;
  }
  addEntity(e) { this.entities.push(e); }
  dropBlockLoot(x, y, z, id, meta, tool) {
    const b = BLOCKS[id];
    const silk = tool && typeof Enchant !== 'undefined' ? Enchant.level(tool, 'silk_touch') : 0;
    const fortune = tool && typeof Enchant !== 'undefined' ? Enchant.level(tool, 'fortune') : 0;
    const SILK_SET = new Set(['stone', 'grass_block', 'coal_ore', 'deepslate_coal_ore', 'diamond_ore', 'deepslate_diamond_ore', 'redstone_ore', 'deepslate_redstone_ore', 'lapis_ore', 'emerald_ore', 'iron_ore', 'deepslate_iron_ore', 'gold_ore', 'deepslate_gold_ore', 'nether_quartz_ore', 'nether_gold_ore', 'glass', 'ice', 'packed_ice', 'bookshelf', 'glowstone', 'sea_lantern', 'melon', 'clay', 'snow_block', 'oak_leaves', 'birch_leaves', 'spruce_leaves', 'cherry_leaves', 'cobweb']);
    let drops;
    if (tool && ITEMS[tool.id].key === 'shears' && (b.key.endsWith('leaves') || id === 39 || id === 40 || id === 45)) {
      drops = [[id, 1]];
    } else if (silk > 0 && (SILK_SET.has(b.key) || b.key.endsWith('_stained_glass')) && !b.noItem) {
      drops = [[id, 1]];
    } else if (id === 10 && fortune > 0) {
      // Gravel with Fortune: 14% / 25% / 100% flint chance
      const ch = fortune === 1 ? 0.14 : fortune === 2 ? 0.25 : 1.0;
      drops = [[Math.random() < ch ? 'flint' : 'gravel', 1]];
    } else if (b.drops) {
      drops = b.drops(meta, Math.random, tool);
      if (fortune > 0) {
        const FORTUNE_MULT = new Set(['coal', 'diamond', 'emerald', 'lapis_lazuli', 'raw_iron', 'raw_gold', 'quartz', 'gold_nugget']);
        drops = drops.map(([k, n]) => {
          if (FORTUNE_MULT.has(k)) {
            const mult = 1 + Math.max(0, Math.floor(Math.random() * (fortune + 2)) - 1);
            return [k, n * mult];
          }
          if (k === 'redstone' || k === 'wheat_seeds') {
            return [k, n + Math.floor(Math.random() * (fortune + 1))];
          }
          if (k === 'melon_slice') {
            return [k, Math.min(9, n + Math.floor(Math.random() * (fortune + 1)))];
          }
          return [k, n];
        });
      }
    } else if (!b.noItem) {
      drops = [[id, 1]];
    } else {
      drops = [];
    }
    for (const [k, n] of drops) if (n > 0) this.dropItem(x + 0.5 + (Math.random() - 0.5) * 0.3, y + 0.3, z + 0.5 + (Math.random() - 0.5) * 0.3, makeStack(k, n));
  }

  // ---- explosions ----------------------------------------------------------------------------
  explode(x, y, z, power, source, inWater) {
    const w = this.world;
    Sound.explode([x, y, z]);
    if (source instanceof PrimedTNT) this.grant('tnt');
    const destroy = new Set();
    if (!inWater) {
      const r = Math.random;
      for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) {
        if (i > 0 && i < 15 && j > 0 && j < 15 && k > 0 && k < 15) continue;
        let dx = i / 15 * 2 - 1, dy = j / 15 * 2 - 1, dz = k / 15 * 2 - 1;
        const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
        let s = power * (0.7 + r() * 0.6), px = x, py = y, pz = z;
        while (s > 0) {
          const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
          const id = w.getBlock(bx, by, bz);
          if (id) {
            const b = BLOCKS[id];
            const res = b.hardness < 0 ? 3600000 : IS_FLUID[id] ? 100 : b.hardness >= 50 ? 1200 : (b.tool === 'pickaxe' ? b.hardness * 4 : b.hardness);
            s -= (res + 0.3) * 0.3;
            if (s > 0 && by >= 0) destroy.add(bx + ',' + by + ',' + bz);
          }
          px += dx * 0.3; py += dy * 0.3; pz += dz * 0.3; s -= 0.225;
        }
      }
    }
    for (const k of destroy) {
      const [bx, by, bz] = k.split(',').map(Number);
      const id = w.getBlock(bx, by, bz), meta = w.getMeta(bx, by, bz);
      if (!id || IS_FLUID[id]) continue;
      if (id === 26) { w.setBlock(bx, by, bz, 0, 0); this.entities.push(new PrimedTNT(this, bx, by, bz, 10 + ((Math.random() * 20) | 0))); continue; }
      const b = BLOCKS[id];
      if (b && b.door) { const oy = (meta & 8) ? by - 1 : by + 1; if (w.getBlock(bx, oy, bz) === id) w.setBlock(bx, oy, bz, 0, 0, 1); }
      if ((id === 516 || id === 517) && (meta & 8)) {
        const dir = meta & 7, D = DIRS[dir];
        if (w.getBlock(bx + D[0], by + D[1], bz + D[2]) === 518) w.setBlock(bx + D[0], by + D[1], bz + D[2], 0, 0, 1);
      }
      if (id === 518) {
        const dir = meta & 7, B = DIRS[OPP[dir]];
        const baseId = w.getBlock(bx + B[0], by + B[1], bz + B[2]);
        if (baseId === 516 || baseId === 517) w.setBlock(bx + B[0], by + B[1], bz + B[2], 0, 0, 1);
      }
      if (b && b.bed) {
        const R2 = [4, 1, 5, 0][meta & 3], D2 = DIRS[(meta & 4) ? OPP[R2] : R2];
        if (w.getBlock(bx + D2[0], by, bz + D2[2]) === id) w.setBlock(bx + D2[0], by, bz + D2[2], 0, 0, 1);
      }
      if (Math.random() < 1 / power && this.mode !== 'creative') this.dropBlockLoot(bx, by, bz, id, meta, null);
      w.setBlock(bx, by, bz, 0, 0);
    }
    // damage entities
    const R = power * 2;
    for (const e of [...this.entities, this.player]) {
      if (e === source || e.dead) continue;
      if (e instanceof Mob && e.type === 'ender_dragon' && typeof EndCrystal !== 'undefined' && source instanceof EndCrystal) continue;
      const d = Math.hypot(e.pos[0] - x, e.pos[1] + e.h / 2 - y, e.pos[2] - z);
      if (d > R) continue;
      const imp = 1 - d / R;
      const dir = [(e.pos[0] - x) / (d || 1), (e.pos[1] + e.h / 2 - y) / (d || 1), (e.pos[2] - z) / (d || 1)];
      const expSrc = { type: 'explosion', attacker: source && source.T ? source : null, sourcePos: [x, y, z], knockFrom: [x, y, z] };
      const blockedExp = e === this.player && e.isBlocking && e.isBlocking() && e.isBlockedFromFront(expSrc);
      if (e instanceof Living) e.hurt(Math.floor((imp * imp + imp) / 2 * 7 * R + 1), expSrc);
      else if (typeof EndCrystal !== 'undefined' && e instanceof EndCrystal) { e.hurt(1, expSrc); continue; }
      const kImp = blockedExp ? imp * 0.15 : imp;
      e.vel[0] += dir[0] * kImp; e.vel[1] += dir[1] * kImp + (blockedExp ? 0.02 : 0.1); e.vel[2] += dir[2] * kImp;
    }
    for (let i = 0; i < 24; i++) this.particles.spawn('explosion', x + (Math.random() - 0.5) * power * 1.5, y + (Math.random() - 0.5) * power * 1.5, z + (Math.random() - 0.5) * power * 1.5, 0, 0, 0);
    for (let i = 0; i < 40; i++) this.particles.spawn('smoke', x + (Math.random() - 0.5) * power * 2, y + (Math.random() - 0.5) * power * 2, z + (Math.random() - 0.5) * power * 2, (Math.random() - 0.5) * 0.3, Math.random() * 0.2, (Math.random() - 0.5) * 0.3);
    const p = this.player;
    const pd = Math.hypot(p.pos[0] - x, p.pos[1] - y, p.pos[2] - z);
    if (pd < 30) this.shake = Math.max(this.shake || 0, (1 - pd / 30) * power / 4);
    this.flushMesh();
  }

  // ---- raycasting ----------------------------------------------------------------------------
  lookDir() { const p = this.player, cp = Math.cos(p.pitch); return [-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp]; }
  selBoxes(x, y, z, id) {
    const b = BLOCKS[id], m = this.world.getMeta(x, y, z);
    if (b.shape === SH_BOXES || b.shape === SH_MODEL || b.shape === SH_WIRE) return b.boxes(m).map(a => a.map(v => v / 16));
    if (b.shape === SH_CROSS || b.shape === SH_CROP) return [[0.15, 0, 0.15, 0.85, b.key === 'wheat' ? 0.25 + (m & 7) / 10 : 0.8, 0.85]];
    if (b.shape === SH_TORCH) {
      if (!m) return [[0.4, 0, 0.4, 0.6, 0.6, 0.6]];
      const D = DIRS[m === 6 ? 0 : (m & 7)]; const cx = 0.5 + D[0] * 0.35, cz = 0.5 + D[2] * 0.35;
      return [[cx - 0.15, 0.2, cz - 0.15, cx + 0.15, 0.8, cz + 0.15]];
    }
    if (b.shape === SH_CACTUS) return [[1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16]];
    return [[0, 0, 0, 1, 1, 1]];
  }
  raycast(origin, dir, maxD, fluids) {
    const w = this.world;
    let x = Math.floor(origin[0]), y = Math.floor(origin[1]), z = Math.floor(origin[2]);
    const sx = Math.sign(dir[0]), sy = Math.sign(dir[1]), sz = Math.sign(dir[2]);
    const tdx = Math.abs(1 / dir[0]), tdy = Math.abs(1 / dir[1]), tdz = Math.abs(1 / dir[2]);
    let tx = (sx > 0 ? x + 1 - origin[0] : origin[0] - x) * tdx, ty = (sy > 0 ? y + 1 - origin[1] : origin[1] - y) * tdy, tz = (sz > 0 ? z + 1 - origin[2] : origin[2] - z) * tdz;
    for (let i = 0; i < 200; i++) {
      const id = w.getBlock(x, y, z);
      if (id && (!IS_FLUID[id] || (fluids && w.getMeta(x, y, z) === 0))) {
        const boxes = IS_FLUID[id] ? [[0, 0, 0, 1, 0.9, 1]] : this.selBoxes(x, y, z, id);
        let best = null;
        for (const bx of boxes) {
          const hit = rayBox(origin, dir, x + bx[0], y + bx[1], z + bx[2], x + bx[3], y + bx[4], z + bx[5]);
          if (hit && (!best || hit.t < best.t)) best = { ...hit, box: bx };
        }
        if (best && best.t <= maxD) return { pos: [x, y, z], face: best.face, t: best.t, point: [origin[0] + dir[0] * best.t, origin[1] + dir[1] * best.t, origin[2] + dir[2] * best.t], id, box: best.box };
      }
      if (tx < ty && tx < tz) { if (tx > maxD) break; x += sx; tx += tdx; }
      else if (ty < tz) { if (ty > maxD) break; y += sy; ty += tdy; }
      else { if (tz > maxD) break; z += sz; tz += tdz; }
    }
    return null;
  }
  rayEntity(origin, dir, maxD) {
    let best = null;
    for (const e of this.entities) {
      if ((!(e instanceof Living) && !(e instanceof GhastFireball) && !(e instanceof EndCrystal)) || e.deathTime > 0) continue;
      const effMaxD = (e instanceof Mob && e.type === 'ender_dragon') ? Math.max(maxD, 4.5) : maxD;
      const boxes = typeof e.subBoxes === 'function' ? e.subBoxes() : [e.box()];
      for (const b of boxes) {
        const hit = rayBox(origin, dir, b[0] - 0.1, b[1] - 0.1, b[2] - 0.1, b[3] + 0.1, b[4] + 0.1, b[5] + 0.1);
        if (hit && hit.t <= effMaxD && (!best || hit.t < best.t)) best = { e, t: hit.t };
      }
    }
    return best;
  }

  // ---- interaction ---------------------------------------------------------------------------
  reach() { return this.mode === 'creative' ? 5 : 4.5; }
  updateTarget() {
    const p = this.player;
    const eye = [p.pos[0], p.pos[1] + p.eye(), p.pos[2]];
    const dir = this.lookDir();
    this.target = this.raycast(eye, dir, this.reach(), false);
    const ent = this.rayEntity(eye, dir, this.mode === 'creative' ? 5 : 3);
    this.targetEntity = ent && (!this.target || ent.t < this.target.t) ? ent.e : null;
    return { eye, dir };
  }
  handleInteraction() {
    const p = this.player;
    if (this.ui.screen || p.deathTime > 0) { this.breaking = null; p.usingItem = null; return; }
    this.updateTarget();
    if (this.useCd > 0) this.useCd--;
    if (this.attackCd > 0) this.attackCd--;
    // continuous using (eating / potion / bow / shield)
    if (p.usingItem) {
      const held = p.inv.held;
      const uDef = ITEMS[p.usingItem];
      if (uDef && uDef.shield) {
        const hasShield = (held && ITEMS[held.id] && ITEMS[held.id].shield) || (p.inv.offhand && ITEMS[p.inv.offhand.id] && ITEMS[p.inv.offhand.id].shield);
        if (!this.mouseBtn[2] || !hasShield) {
          p.usingItem = null; p.blocking = false; p.useT = 0;
        } else {
          p.useT++; p.blocking = true;
        }
      } else if (!this.mouseBtn[2] || !held || held.id !== p.usingItem) {
        if (p.usingItem === item('bow') && held && held.id === p.usingItem) this.releaseBow();
        p.usingItem = null; p.blocking = false; p.useT = 0;
      } else {
        p.useT++;
        const def = ITEMS[held.id];
        if (def.food) {
          if (p.useT % 4 === 0 && p.useT > 6) { Sound.eat(p.pos); this.foodParticles(held.id); }
          if (p.useT >= 32) this.finishEating(held);
        } else if (def.potion) {
          if (p.useT % 4 === 0 && p.useT > 6) Sound.splash(p.pos);
          if (p.useT >= 32) this.finishDrinking(held);
        }
      }
    }
    // breaking
    if (this.mouseBtn[0]) {
      if (this.targetEntity) {
        if (this.attackCd <= 0) this.attack(this.targetEntity);
        this.breaking = null;
      } else if (this.target) {
        const t = this.target;
        if (this.mode === 'creative') {
          if (this.attackCd <= 0) {
            const held = p.inv.held;
            if (!(held && ITEMS[held.id].tool && ITEMS[held.id].tool.type === 'sword')) this.breakBlock(...t.pos, false);
            this.attackCd = 5; p.swingT = 6;
          }
        } else if (t.id === 541) {
          // Left-clicking Dragon Egg in survival teleports it!
          if (this.attackCd <= 0) {
            this.teleportDragonEgg(...t.pos);
            this.attackCd = 5; p.swingT = 6;
          }
          this.breaking = null;
        } else {
          const key = t.pos.join(',');
          if (!this.breaking || this.breaking.key !== key) this.breaking = { key, pos: t.pos, progress: 0, id: t.id };
          const b = BLOCKS[t.id];
          if (b.hardness < 0 || this.attackCd > 0) { if (b.hardness < 0) this.breaking.progress = 0; }
          else {
            this.breaking.progress += this.breakSpeed(t.id);
            if (p.swingT <= 0) p.swingT = 6;
            if (this.tickCount % 4 === 0) { Sound.block('hit', b.sound, [t.pos[0] + 0.5, t.pos[1] + 0.5, t.pos[2] + 0.5]); this.particles.blockHit(...t.pos, t.face, t.id, this.world.getMeta(...t.pos)); }
            if (this.breaking.progress >= 1) { this.breakBlock(...t.pos, false); this.breaking = null; this.attackCd = 5; }
          }
        }
      } else { this.breaking = null; if (this.mouseClicked0) p.swingT = 6; }
    } else this.breaking = null;
    this.mouseClicked0 = false;
    // using / placing (hold to repeat)
    if (this.mouseBtn[2] && this.useCd <= 0 && !p.usingItem) {
      this.use();
    }
  }
  breakSpeed(id) {
    const p = this.player, b = BLOCKS[id];
    if (b.hardness === 0) return 1;
    const held = p.inv.held, def = held && ITEMS[held.id];
    let speed = 1, canHarvest = !b.needsTool;
    if (def && def.tool) {
      const t = def.tool;
      if (t.type === b.tool) { speed = t.speed; if (t.level >= b.level) canHarvest = true; }
      if (t.type === 'sword' && (b.key.endsWith('leaves') || b.key === 'cactus' || b.key === 'pumpkin' || b.key === 'melon' || b.key === 'cobweb')) speed = b.key === 'cobweb' ? 15 : 1.5;
    }
    if (def && def.key === 'shears' && (b.key.endsWith('leaves') || b.key.endsWith('wool') || b.key === 'cobweb')) { speed = b.key.endsWith('wool') ? 5 : 15; canHarvest = true; }
    if (b.tool === 'shears') canHarvest = true;
    if (speed > 1 && held && typeof Enchant !== 'undefined') {
      const eff = Enchant.level(held, 'efficiency');
      if (eff > 0) speed += eff * eff + 1;
    }
    let s = speed / b.hardness / (canHarvest ? 30 : 100);
    const aqua = typeof Enchant !== 'undefined' ? Enchant.maxArmorEnch(p.inv, 'aqua_affinity') : 0;
    if (p.eyeInWater && aqua <= 0) s /= 5;
    if (!p.onGround && !p.flying) s /= 5;
    return s;
  }
  canHarvest(id, held) {
    const b = BLOCKS[id];
    if (!b.needsTool) return true;
    const def = held && ITEMS[held.id];
    if (b.tool === 'shears') return true;
    return !!(def && def.tool && def.tool.type === b.tool && def.tool.level >= b.level);
  }
  breakBlock(x, y, z, natural, silent) {
    const w = this.world, id = w.getBlock(x, y, z), meta = w.getMeta(x, y, z);
    if (!id || IS_FLUID[id]) return;
    const b = BLOCKS[id];
    const p = this.player, held = natural ? null : p.inv.held;
    const silk = held && typeof Enchant !== 'undefined' ? Enchant.level(held, 'silk_touch') : 0;
    if (!silent) { Sound.block('break', b.sound, [x + 0.5, y + 0.5, z + 0.5]); this.particles.blockBreak(x, y, z, id, meta); }
    else this.particles.blockBreak(x, y, z, id, meta);
    if (this.mode !== 'creative' || natural) {
      if (natural || this.canHarvest(id, held)) this.dropBlockLoot(x, y, z, id, meta, held);
      if (!natural) {
        p.exhaust(0.005);
        if (held && ITEMS[held.id].durability && b.hardness > 0) this.damageHeld(1);
        const xp = { coal_ore: [0, 2], deepslate_coal_ore: [0, 2], diamond_ore: [3, 7], deepslate_diamond_ore: [3, 7], redstone_ore: [1, 5], deepslate_redstone_ore: [1, 5], lapis_ore: [2, 5], emerald_ore: [3, 7], nether_quartz_ore: [2, 5], nether_gold_ore: [0, 1] }[b.key];
        if (xp && silk <= 0 && this.canHarvest(id, held)) this.addXp(xp[0] + Math.floor(Math.random() * (xp[1] - xp[0] + 1)));
        this.stats.mined++;
      }
    }
    // door: remove other half
    if (b.door) { const oy = (meta & 8) ? y - 1 : y + 1; if (w.getBlock(x, oy, z) === id) w.setBlock(x, oy, z, 0, 0, 1); }
    // extended piston: remove its piston_head
    if ((id === 516 || id === 517) && (meta & 8)) {
      const dir = meta & 7, D = DIRS[dir];
      const hx = x + D[0], hy = y + D[1], hz = z + D[2];
      if (w.getBlock(hx, hy, hz) === 518 && (w.getMeta(hx, hy, hz) & 7) === dir) w.setBlock(hx, hy, hz, 0, 0, 1);
    }
    // piston_head: break its base piston
    if (id === 518) {
      const dir = meta & 7, B = DIRS[OPP[dir]];
      const bx = x + B[0], by = y + B[1], bz = z + B[2];
      const baseId = w.getBlock(bx, by, bz);
      if (baseId === 516 || baseId === 517) {
        if (this.mode !== 'creative' || natural) this.dropBlockLoot(bx, by, bz, baseId, 0, null);
        w.setBlock(bx, by, bz, 0, 0, 1);
      }
    }
    if (b.bed) {
      const R = [4, 1, 5, 0][meta & 3], D2 = DIRS[(meta & 4) ? OPP[R] : R];
      const ox = x + D2[0], oz = z + D2[2];
      if (w.getBlock(ox, y, oz) === id) { if ((meta & 4) && this.mode !== 'creative' && !natural) this.dropBlockLoot(ox, y, oz, id, 0, null); w.setBlock(ox, y, oz, 0, 0, 1); }
    }
    w.setBlock(x, y, z, 0, 0);
    if (id === 35 && w.getBlock(x, y - 1, z) !== 0 && this.mode !== 'creative' && !natural && silk <= 0) w.setBlock(x, y, z, WATER, 0);
    if (!natural) this.flushMesh();
  }
  damageHeld(n) {
    const p = this.player, h = p.inv.held;
    if (!h || this.mode === 'creative') return;
    const loss = typeof Enchant !== 'undefined' ? Enchant.rollDurabilityLoss(h, n, false) : n;
    if (loss <= 0) return;
    h.dmg = (h.dmg || 0) + loss;
    if (h.dmg >= ITEMS[h.id].durability) { p.inv.slots[p.inv.sel] = null; Sound.block('break', 'wood', p.pos); this.ui.actionBar = { text: (h.name || ITEMS[h.id].cn) + ' 损坏了', t: performance.now(), color: '#FF5555' }; }
  }
  flushMesh(sync = false) {
    this._nearbyScanned = false;
    // remesh dirty sections near the player immediately or via urgent Tier-0 Worker tasks
    const p = this.player, pcx = Math.floor(p.pos[0]) >> 4, pcz = Math.floor(p.pos[2]) >> 4;
    const useWorker = !sync && !!(this.worker && this.worker.isReady());
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const ch = this.world.getChunk(pcx + a, pcz + b);
      if (!ch || !ch.dirty) continue;
      let ok = true;
      for (let i = -1; i <= 1 && ok; i++) for (let j = -1; j <= 1; j++) if (!this.world.getChunk(ch.cx + i, ch.cz + j)) { ok = false; break; }
      if (!ok) continue;
      if (useWorker) {
        const distSq = a * a + b * b;
        for (let sy = 0; sy < SECTIONS; sy++) {
          if (ch.dirty & (1 << sy)) {
            this.worker.enqueueMesh(ch.cx, sy, ch.cz, distSq, true);
          }
        }
      } else {
        this.meshChunk(ch);
      }
    }
  }
  attack(e) {
    const p = this.player, held = p.inv.held, def = held && ITEMS[held.id];
    let dmg = def && def.attack ? def.attack : 1;
    const crit = p.vel[1] < -0.05 && !p.onGround && !p.inWater;
    if (crit) { dmg *= 1.5; for (let i = 0; i < 12; i++) this.particles.spawn('crit', e.pos[0] + (Math.random() - 0.5) * e.w, e.pos[1] + Math.random() * e.h, e.pos[2] + (Math.random() - 0.5) * e.w, (Math.random() - 0.5) * 0.3, Math.random() * 0.3, (Math.random() - 0.5) * 0.3); }
    const enchBonus = typeof Enchant !== 'undefined' ? Enchant.meleeBonus(held, e) : 0;
    dmg += enchBonus;
    if (enchBonus > 0) {
      for (let i = 0; i < 10; i++) this.particles.spawn('enchant_hit', e.pos[0] + (Math.random() - 0.5) * e.w, e.pos[1] + Math.random() * e.h, e.pos[2] + (Math.random() - 0.5) * e.w, (Math.random() - 0.5) * 0.25, Math.random() * 0.25, (Math.random() - 0.5) * 0.25);
    }
    const kbLvl = typeof Enchant !== 'undefined' ? Enchant.level(held, 'knockback') : 0;
    const knock = (p.sprinting ? 0.8 : 0.4) + kbLvl * 0.35;
    const fireLvl = typeof Enchant !== 'undefined' ? Enchant.level(held, 'fire_aspect') : 0;
    const looting = typeof Enchant !== 'undefined' ? Enchant.level(held, 'looting') : 0;
    if (e.hurt(dmg, { type: 'player', attacker: p, knockFrom: p.pos, knock, player: true, looting })) {
      if (fireLvl > 0) e.fire = Math.max(e.fire || 0, fireLvl * 80);
      if (def && def.durability) this.damageHeld(def.tool && def.tool.type === 'sword' ? 1 : 2);
      p.exhaust(0.1);
      if (p.sprinting) p.sprinting = false;
    }
    p.swingT = 6;
    this.attackCd = 10;
  }
  foodParticles(id) {
    const p = this.player, d = this.lookDir();
    for (let i = 0; i < 3; i++) {
      const pa = this.particles.spawn('block', p.pos[0] + d[0] * 0.5, p.pos[1] + p.eye() - 0.2, p.pos[2] + d[2] * 0.5, (Math.random() - 0.5) * 0.1, 0.1, (Math.random() - 0.5) * 0.1, { id: 1, layer: ITEMS[id].tex });
    }
  }
  finishEating(held) {
    const p = this.player, def = ITEMS[held.id];
    p.food = Math.min(20, p.food + def.food[0]);
    p.saturation = Math.min(p.food, p.saturation + def.food[1]);
    if (def.heal) p.health = Math.min(20, p.health + def.heal);
    if (def.key === 'rotten_flesh' && Math.random() < 0.8) p.food = Math.max(0, p.food - 1);
    Sound.burp(p.pos);
    if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
    p.usingItem = null; p.useT = 0;
    this.useCd = 4;
  }
  finishDrinking(held) {
    const p = this.player, def = ITEMS[held.id];
    if (!def || !def.potion) return;
    if (def.potion !== 'water' && def.potion !== 'awkward') {
      const dur = def.potionDuration ?? (def.effect && def.effect.duration) ?? 0;
      const amp = (def.effect && def.effect.amp) ?? 0;
      p.applyEffect(def.potion, dur, amp);
    }
    Sound.burp(p.pos);
    if (this.mode !== 'creative') {
      held.count--;
      const emptyBottle = makeStack('glass_bottle', 1);
      if (held.count <= 0) {
        p.inv.slots[p.inv.sel] = emptyBottle;
      } else if (p.inv.add(emptyBottle)) {
        this.dropFromPlayer(emptyBottle);
      }
    }
    p.usingItem = null; p.useT = 0;
    this.useCd = 4;
  }
  releaseBow() {
    const p = this.player, t = p.useT, held = p.inv.held;
    let f = t / 20; f = (f * f + f * 2) / 3; if (f > 1) f = 1;
    if (f < 0.1) return;
    const has = this.mode === 'creative' || p.inv.count(item('arrow')) > 0;
    if (!has) return;
    const infLvl = typeof Enchant !== 'undefined' ? Enchant.level(held, 'infinity') : 0;
    if (this.mode !== 'creative' && infLvl <= 0) p.inv.remove(item('arrow'), 1);
    const d = this.lookDir(), sp = f * 3;
    const a = new Arrow(this, p.pos[0] + d[0] * 0.3, p.pos[1] + p.eye() - 0.1, p.pos[2] + d[2] * 0.3, [d[0] * sp, d[1] * sp, d[2] * sp], p);
    if (typeof Enchant !== 'undefined' && held) {
      a.powerLvl = Enchant.level(held, 'power');
      a.punchLvl = Enchant.level(held, 'punch');
      if (Enchant.level(held, 'flame') > 0) a.flame = true;
      if (infLvl > 0) a.noPickup = true;
    }
    this.entities.push(a);
    Sound.bow(p.pos);
    this.damageHeld(1);
  }
  use() {
    const p = this.player, w = this.world, held = p.inv.held, def = held && ITEMS[held.id];
    const t = this.target;
    this.useCd = 4;
    // Right-click Villager -> open TradingScreen (works with empty hand or holding items)
    if (this.targetEntity && this.targetEntity.type === 'villager' && !p.sneaking) {
      if (typeof Trading !== 'undefined') Trading.ensureVillager(this.targetEntity, this);
      this.ui.open(new TradingScreen(this, this.targetEntity));
      Sound.mob('villager', 'idle', this.targetEntity.pos);
      p.swingT = 6;
      return;
    }
    // entity interaction
    if (this.targetEntity && held) {
      const e = this.targetEntity;
      if (def.key === 'shears' && e.type === 'sheep' && !e.sheared) {
        e.sheared = true;
        for (let i = 0, n = 1 + ((Math.random() * 3) | 0); i < n; i++) this.dropItem(e.pos[0], e.pos[1] + 1, e.pos[2], makeStack(128 + e.woolColor, 1));
        Sound.noise(e.pos, { freq: 3000, q: 3, dur: 0.15, vol: 0.4 });
        this.damageHeld(1); p.swingT = 6; return;
      }
      if (e.T && e.T.food && held.id === item(e.T.food) && !e.loveT && !e.baby) {
        e.loveT = 600;
        for (let i = 0; i < 6; i++) this.particles.spawn('heart', e.pos[0] + (Math.random() - 0.5), e.pos[1] + e.h + Math.random() * 0.5, e.pos[2] + (Math.random() - 0.5), 0, 0.02, 0);
        if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
        // breed with a nearby partner in love
        const mate = this.entities.find(o => o !== e && o instanceof Mob && o.type === e.type && o.loveT > 0 && o.distTo(e) < 8);
        if (mate) {
          e.loveT = 0; mate.loveT = 0;
          const baby = new Mob(this, e.type, (e.pos[0] + mate.pos[0]) / 2, e.pos[1], (e.pos[2] + mate.pos[2]) / 2).makeBaby();
          this.entities.push(baby);
          for (let i = 0; i < 8; i++) this.particles.spawn('heart', baby.pos[0] + (Math.random() - 0.5), baby.pos[1] + 1 + Math.random() * 0.5, baby.pos[2] + (Math.random() - 0.5), 0, 0.02, 0);
          this.addXp(1 + ((Math.random() * 7) | 0));
        }
        p.swingT = 6; return;
      }
    }
    // block interaction
    if (t && !p.sneaking) {
      const b = BLOCKS[t.id];
      const [x, y, z] = t.pos;
      if (b.onUse === 'crafting') { this.ui.open(new CraftingScreen(this, 3)); return; }
      if (b.onUse === 'enchanting') { this.ui.open(new EnchantingScreen(this, [x, y, z])); return; }
      if (b.onUse === 'anvil') { this.ui.open(new AnvilScreen(this, [x, y, z])); return; }
      if (b.onUse === 'furnace') { this.ui.open(new FurnaceScreen(this, this.getBlockEntity(x, y, z, 'furnace'))); return; }
      if (b.onUse === 'hopper') { this.ui.open(new HopperScreen(this, this.getBlockEntity(x, y, z, 'hopper'))); return; }
      if (b.onUse === 'brewing') { this.ui.open(new BrewingScreen(this, this.getBlockEntity(x, y, z, 'brewing'))); return; }
      if (b.onUse === 'chest') {
        const be = this.getBlockEntity(x, y, z, 'chest');
        const cm = w.getMeta(x, y, z);
        if (cm & 8) { this.fillLoot(be, x, y, z, (cm >> 4) & 7); w.setMeta(x, y, z, cm & 7); }
        this.ui.open(new ChestScreen(this, be)); Sound.door([x, y, z], true); return;
      }
      if (b.onUse === 'dragon_egg') {
        this.teleportDragonEgg(x, y, z);
        p.swingT = 6;
        return;
      }
      if (t.id === 538 && def && def.key === 'eye_of_ender') {
        const curMeta = w.getMeta(x, y, z);
        if (!(curMeta & 4)) {
          w.setMeta(x, y, z, curMeta | 4);
          if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
          if (typeof Sound !== 'undefined' && Sound.tone) Sound.tone([x + 0.5, y + 0.8, z + 0.5], { freq: 520, end: 780, dur: 0.14, vol: 0.3, type: 'sine' });
          if (typeof Redstone !== 'undefined' && Redstone.updateComparatorsNear) Redstone.updateComparatorsNear(this, x, y, z);
          this.checkActivateEndPortal(x, y, z);
          p.swingT = 6;
          this.flushMesh();
          return;
        }
      }
      if (b.onUse === 'bell') {
        Sound.note([x, y, z], 20); Sound.note([x, y, z], 8);
        this.particles.spawn('note', x + 0.5, y + 1.2, z + 0.5, 0, 0.02, 0, { col: [255, 215, 40] });
        p.swingT = 6; return;
      }
      if (b.onUse === 'note') {
        const cur = w.getMeta(x, y, z), pitch = ((cur & 31) + 1) % 25;
        w.setMeta(x, y, z, pitch | (cur & 32));
        Sound.note([x, y, z], pitch);
        this.particles.spawn('note', x + 0.5, y + 1.2, z + 0.5, 0, 0.02, 0, { col: [255, Math.round(pitch * 10), Math.round(255 - pitch * 10)] });
        p.swingT = 6; return;
      }
      if (b.onUse === 'lever') {
        const nm = w.getMeta(x, y, z) ^ 8;
        w.setMeta(x, y, z, nm);
        Sound.click();
        Redstone.propagateFromSource(this, x, y, z);
        p.swingT = 6; this.flushMesh(); return;
      }
      if (b.onUse === 'button') {
        const cur = w.getMeta(x, y, z);
        if (!(cur & 8)) {
          w.setMeta(x, y, z, cur | 8);
          Sound.click();
          w.schedule(x, y, z, b.key === 'oak_button' ? 30 : 20);
          Redstone.propagateFromSource(this, x, y, z);
          this.flushMesh();
        }
        p.swingT = 6; return;
      }
      if (b.onUse === 'repeater') {
        const cur = w.getMeta(x, y, z);
        const delay = (((cur >> 2) & 3) + 1) & 3;
        w.setMeta(x, y, z, (cur & 3) | (delay << 2));
        Sound.click();
        p.swingT = 6; this.flushMesh(); return;
      }
      if (b.onUse === 'comparator') {
        const cur = w.getMeta(x, y, z) ^ 4;
        w.setMeta(x, y, z, cur);
        Sound.click();
        if (typeof Redstone !== 'undefined') {
          Redstone.updateComparator(this, x, y, z);
          Redstone.propagateFromSource(this, x, y, z);
        }
        p.swingT = 6; this.flushMesh(); return;
      }
      if (t.id === 522 && def && def.block === 522 && (w.getMeta(x, y, z) & 3) < 3) {
        w.setMeta(x, y, z, w.getMeta(x, y, z) + 1);
        Sound.block('place', 'grass', [x + 0.5, y + 0.5, z + 0.5]);
        if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
        p.swingT = 6; this.flushMesh(); return;
      }
      if (b.door) {
        const m = w.getMeta(x, y, z), base = (m & 8) ? y - 1 : y;
        const bm = w.getMeta(x, base, z) ^ 4;
        const tm = (bm | 8) | (w.getMeta(x, base + 1, z) & 16);
        w.setMeta(x, base, z, bm); w.setMeta(x, base + 1, z, tm);
        Sound.door([x, y, z], !!(bm & 4)); p.swingT = 6; this.flushMesh(); return;
      }
      if (b.bed) { this.trySleep(x, y, z); p.swingT = 6; return; }
      if (b.trapdoor) { w.setMeta(x, y, z, w.getMeta(x, y, z) ^ 4); Sound.door([x, y, z], true); p.swingT = 6; this.flushMesh(); return; }
      if (t.id === 26 && def && def.key === 'flint_and_steel') { w.setBlock(x, y, z, 0, 0); this.entities.push(new PrimedTNT(this, x, y, z)); this.damageHeld(1); p.swingT = 6; return; }
    }
    const tryOffhandShield = () => {
      const oh = p.inv.offhand;
      if (oh && ITEMS[oh.id] && ITEMS[oh.id].shield) {
        p.usingItem = oh.id; p.blocking = true; p.useT = 0;
        return true;
      }
      return false;
    };
    if (!held) { tryOffhandShield(); return; }
    if (def.shield) { p.usingItem = held.id; p.blocking = true; p.useT = 0; return; }
    if (def.armor) {
      const slot = 36 + def.armor.slot;
      const cur = p.inv.slots[slot];
      p.inv.slots[slot] = held; p.inv.slots[p.inv.sel] = cur;
      Sound.block('place', 'metal', p.pos); p.swingT = 6;
      if (def.key.startsWith('iron')) this.grant('armor');
      return;
    }
    // food & potions
    if (def.food) { if (p.food < 20 || this.mode === 'creative' || def.key === 'golden_apple') { p.usingItem = held.id; p.useT = 0; } else tryOffhandShield(); return; }
    if (def.potion) { p.usingItem = held.id; p.useT = 0; return; }
    if (def.key === 'glass_bottle') {
      // Check if player is near an active DragonBreathCloud (vanilla Dragon's Breath collection)
      if (typeof DragonBreathCloud !== 'undefined') {
        const cloud = this.entities.find(e => e instanceof DragonBreathCloud && !e.dead && Math.hypot(e.pos[0] - p.pos[0], e.pos[1] - p.pos[1], e.pos[2] - p.pos[2]) < 4.5);
        if (cloud) {
          const filled = makeStack('dragon_breath', 1);
          if (this.mode !== 'creative') {
            held.count--;
            if (!held.count) p.inv.slots[p.inv.sel] = filled;
            else if (p.inv.add(filled)) this.dropFromPlayer(filled);
          } else {
            if (p.inv.add(filled)) this.dropFromPlayer(filled);
          }
          cloud.duration = Math.max(20, cloud.duration - 40);
          if (typeof Sound !== 'undefined' && Sound.pop) Sound.pop(cloud.pos);
          p.swingT = 6;
          return;
        }
      }
      const ft = this.raycast([p.pos[0], p.pos[1] + p.eye(), p.pos[2]], this.lookDir(), this.reach(), true);
      if (ft && ft.id === WATER) {
        const filled = makeStack('water_bottle', 1);
        if (this.mode !== 'creative') {
          held.count--;
          if (!held.count) p.inv.slots[p.inv.sel] = filled;
          else if (p.inv.add(filled)) this.dropFromPlayer(filled);
        } else {
          if (p.inv.add(filled)) this.dropFromPlayer(filled);
        }
        Sound.splash(ft.pos); p.swingT = 6;
      }
      return;
    }
    if (def.key === 'bow') { if (this.mode === 'creative' || p.inv.count(item('arrow')) > 0) { p.usingItem = held.id; p.useT = 0; } return; }
    if (def.key === 'snowball' || def.key === 'egg') {
      const d = this.lookDir();
      const a = new Arrow(this, p.pos[0], p.pos[1] + p.eye() - 0.1, p.pos[2], [d[0] * 1.5, d[1] * 1.5, d[2] * 1.5], p);
      a.snowball = held.id; this.entities.push(a);
      if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
      Sound.bow(p.pos); p.swingT = 6; return;
    }
    if (def.key === 'ender_pearl') {
      if ((p.pearlCooldown || 0) > 0) return;
      p.pearlCooldown = 20; // 1-second (20 ticks) Ender Pearl cooldown per Minecraft Wiki
      const d = this.lookDir();
      const ep = new EnderPearlEntity(this, p.pos[0], p.pos[1] + p.eye() - 0.1, p.pos[2], [d[0] * 1.5, d[1] * 1.5 + 0.05, d[2] * 1.5], p);
      this.entities.push(ep);
      if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
      Sound.bow(p.pos); p.swingT = 6; return;
    }
    if (def.key === 'eye_of_ender') {
      if (w.dimension !== 'overworld') {
        if (this.ui) this.ui.actionBar = { text: '末影之眼只能在主世界感应要塞', t: performance.now(), color: '#FF8888' };
        return;
      }
      const sh = (typeof Structures !== 'undefined' && Structures.locateNearest)
        ? Structures.locateNearest(w, 'stronghold', Math.floor(p.pos[0]), Math.floor(p.pos[2]))
        : { x: 168, y: 31, z: -157 };
      const tx = sh ? sh.x : 168, ty = sh ? sh.y : 31, tz = sh ? sh.z : -157;
      const eyeEnt = new EyeOfEnderEntity(this, p.pos[0], p.pos[1] + p.eye() - 0.1, p.pos[2], tx, ty, tz);
      this.entities.push(eyeEnt);
      this.grant('eye_spy');
      if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
      Sound.bow(p.pos);
      p.swingT = 6;
      return;
    }
    if (def.key === 'end_crystal' && t && (t.id === 28 || t.id === 6)) {
      const [cx, cy, cz] = t.pos;
      if (w.getBlock(cx, cy + 1, cz) === 0) {
        this.entities.push(new EndCrystal(this, cx + 0.5, cy + 1, cz + 0.5));
        if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
        Sound.block('place', 'glass', [cx + 0.5, cy + 1, cz + 0.5]);
        p.swingT = 6;
        // If in The End and 4 EndCrystals are placed around the Exit Portal, respawn Ender Dragon!
        if (w.dimension === 'end' && !this.entities.some(e => e instanceof Mob && !e.dead && !e.deathTime && e.type === 'ender_dragon')) {
          const portalCrystals = this.entities.filter(e => e instanceof EndCrystal && !e.dead && Math.hypot(e.pos[0], e.pos[2]) < 6);
          if (portalCrystals.length >= 4) {
            for (const pc of portalCrystals) {
              pc.dead = true;
              if (this.particles) {
                for (let k = 0; k < 16; k++) {
                  this.particles.spawn('explosion', pc.pos[0] + (Math.random() - 0.5), pc.pos[1] + 0.5 + (Math.random() - 0.5), pc.pos[2] + (Math.random() - 0.5), 0, 0, 0);
                }
              }
            }
            this._dragonKilled = false;
            if (this.worldMeta) this.worldMeta.dragonKilled = false;
            this.initEndBossFight(false, true);
            if (this.ui) this.ui.message('⚡ 末影龙已重新召唤！8 根黑曜石柱顶端的末影水晶已全部恢复！', '#FF55FF');
          }
        }
        return;
      }
    }
    // buckets
    if (def.key === 'bucket') {
      const ft = this.raycast([p.pos[0], p.pos[1] + p.eye(), p.pos[2]], this.lookDir(), this.reach(), true);
      if (ft && IS_FLUID[ft.id] && w.getMeta(...ft.pos) === 0) {
        w.setBlock(...ft.pos, 0, 0);
        const filled = makeStack(ft.id === WATER ? 'water_bucket' : 'lava_bucket');
        if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = filled; else if (p.inv.add(filled)) this.dropFromPlayer(filled); }
        Sound.splash(ft.pos); p.swingT = 6; this.flushMesh();
      }
      return;
    }
    if (!t) { tryOffhandShield(); return; }
    const [x, y, z] = t.pos, D = DIRS[t.face];
    // tools acting on blocks
    if (def.tool && def.tool.type === 'hoe' && (t.id === 2 || t.id === 3 || t.id === 181) && w.getBlock(x, y + 1, z) === 0) {
      w.setBlock(x, y, z, 63, 0); Sound.block('step', 'gravel', [x, y, z]); this.damageHeld(1); p.swingT = 6; this.flushMesh(); return;
    }
    if (def.tool && def.tool.type === 'shovel' && (t.id === 2 || t.id === 3) && w.getBlock(x, y + 1, z) === 0) {
      w.setBlock(x, y, z, 181, 0); Sound.block('step', 'gravel', [x, y, z]); this.damageHeld(1); p.swingT = 6; this.flushMesh(); return;
    }
    if (def.key === 'bone_meal') {
      let ok = false;
      if (t.id === 64 && w.getMeta(x, y, z) < 7) { w.setMeta(x, y, z, Math.min(7, w.getMeta(x, y, z) + 2 + ((Math.random() * 3) | 0))); ok = true; }
      else if ((t.id >= 65 && t.id <= 67) || t.id === 521) { if (Math.random() < 0.45) this.growTree(x, y, z, t.id); ok = true; }
      else if (t.id === 522) {
        if ((w.getMeta(x, y, z) & 3) < 3) w.setMeta(x, y, z, w.getMeta(x, y, z) + 1);
        else this.dropItem(x + 0.5, y + 0.3, z + 0.5, makeStack('pink_petals', 1));
        ok = true;
      }
      else if (t.id === 2) {
        for (let i = 0; i < 40; i++) {
          const nx = x + ((Math.random() * 7) | 0) - 3, nz = z + ((Math.random() * 7) | 0) - 3;
          if (w.getBlock(nx, y, nz) === 2 && w.getBlock(nx, y + 1, nz) === 0) w.setBlock(nx, y + 1, nz, Math.random() < 0.85 ? 39 : FLOWER_IDS[(Math.random() * 4) | 0], 0);
        }
        ok = true;
      }
      if (ok) {
        for (let i = 0; i < 12; i++) this.particles.spawn('bone_meal', x + Math.random(), y + 1 + Math.random() * 0.5, z + Math.random(), 0, 0.02, 0);
        if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
        p.swingT = 6; this.flushMesh();
      }
      return;
    }
    if (def.key === 'flint_and_steel' || def.key === 'fire_charge') {
      const fx = x + D[0], fy = y + D[1], fz = z + D[2];
      if (this.tryIgnitePortal(fx, fy, fz)) {
        if (def.key === 'flint_and_steel') this.damageHeld(1);
        else if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
        p.swingT = 6;
        return;
      }
      if (fy > 0 && fy < HEIGHT && w.getBlock(fx, fy, fz) === 0 && SOLIDCUBE[w.getBlock(fx, fy - 1, fz)]) {
        w.setBlock(fx, fy, fz, 537, 0);
        this.tryIgnitePortal(fx, fy, fz);
        if (typeof Sound !== 'undefined' && Sound.fizz) Sound.fizz([fx, fy, fz]);
        if (def.key === 'flint_and_steel') this.damageHeld(1);
        else if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
        p.swingT = 6;
        this.flushMesh();
      }
      return;
    }
    if (def.spawnEgg) {
      const m = new Mob(this, def.spawnEgg, x + D[0] + 0.5, y + Math.max(0, D[1]) + (D[1] < 0 ? -2 : 0), z + D[2] + 0.5);
      m.persistent = true; m.yaw = m.bodyYaw = p.yaw + Math.PI;
      this.entities.push(m);
      for (let i = 0; i < 8; i++) this.particles.spawn('poof', m.pos[0] + (Math.random() - 0.5), m.pos[1] + Math.random(), m.pos[2] + (Math.random() - 0.5), 0, 0.05, 0);
      if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
      p.swingT = 6; return;
    }
    // placement
    let placeId = null;
    if (def.block !== undefined && BLOCKS[def.block]) placeId = def.block;
    else if (def.places) placeId = BID[def.places];
    if (placeId == null) { tryOffhandShield(); return; }
    const pb = BLOCKS[placeId];
    // slab merging
    if (pb.slab && t.id === placeId) {
      const m = w.getMeta(x, y, z) & 3;
      if ((m === 0 && t.face === 3) || (m === 1 && t.face === 2)) { this.placeAt(x, y, z, placeId, 2, held, true); return; }
    }
    let px = x, py = y, pz = z;
    const tb = BLOCKS[t.id];
    if (!(tb.replaceable && !IS_FLUID[t.id] && t.id !== placeId)) { px += D[0]; py += D[1]; pz += D[2]; }
    if (py < 0 || py >= HEIGHT) return;
    const cur = w.getBlock(px, py, pz);
    if (pb.slab && cur === placeId) {
      const m = w.getMeta(px, py, pz) & 3;
      if (m !== 2) { this.placeAt(px, py, pz, placeId, 2, held, true); return; }
    }
    if (cur && !REPLACEABLE[cur]) return;
    if (IS_FLUID[placeId] && cur && IS_FLUID[cur] && w.getMeta(px, py, pz) === 0 && cur === placeId) return;
    // meta from placement context
    let meta = 0;
    const look = this.lookDir();
    const hdir = Math.abs(look[0]) > Math.abs(look[2]) ? (look[0] > 0 ? 1 : 0) : (look[2] > 0 ? 5 : 4);
    if (pb.facing) meta = OPP[hdir];
    if (pb.hopper) meta = (t.face === 2 || t.face === 3) ? 2 : OPP[t.face];
    if (pb.axis) meta = (t.face === 0 || t.face === 1) ? 1 : (t.face === 4 || t.face === 5) ? 2 : 0;
    if (pb.slab) { const fy = t.point[1] - Math.floor(t.point[1]); meta = t.face === 2 || (t.face !== 3 && fy > 0.5) ? 1 : 0; }
    if (pb.stairs) {
      meta = { 1: 0, 0: 1, 5: 2, 4: 3 }[hdir];
      const fy = t.point[1] - Math.floor(t.point[1]);
      if (t.face === 2 || (t.face !== 3 && fy > 0.5)) meta |= 4;
    }
    if (pb.trapdoor) { const fy = t.point[1] - Math.floor(t.point[1]); if (t.face === 2 || (t.face !== 3 && fy > 0.5)) meta |= 8; }
    if (placeId === 21 || placeId === 120) { if (t.face === 2) return; meta = t.face === 3 ? 0 : (OPP[t.face] === 0 ? 6 : OPP[t.face]); }
    if (pb.lever || pb.button) { meta = OPP[t.face]; }
    if (pb.repeater || pb.comparator) { meta = { 4: 0, 1: 1, 5: 2, 0: 3 }[hdir]; }
    if (placeId === 538) { meta = { 4: 2, 1: 3, 5: 0, 0: 1 }[hdir]; }
    if (pb.piston) { meta = Math.abs(look[1]) > 0.65 ? (look[1] > 0 ? 2 : 3) : OPP[hdir]; }
    if (pb.observer) { meta = Math.abs(look[1]) > 0.65 ? (look[1] > 0 ? 3 : 2) : hdir; }
    if (pb.ladder) { if (t.face === 2 || t.face === 3) return; meta = OPP[t.face]; }
    if (pb.key.endsWith('leaves')) meta = 4;
    if (pb.bed) {
      const rot = { 4: 0, 1: 1, 5: 2, 0: 3 }[hdir];
      const D2 = DIRS[hdir], hx = px + D2[0], hz = pz + D2[2];
      const hcur = w.getBlock(hx, py, hz);
      if (hcur && !REPLACEABLE[hcur]) return;
      if (!SOLIDCUBE[w.getBlock(px, py - 1, pz)] || !SOLIDCUBE[w.getBlock(hx, py - 1, hz)]) return;
      w.setBlock(hx, py, hz, placeId, rot | 4, 0);
      this.placeAt(px, py, pz, placeId, rot, held, false);
      return;
    }
    if (pb.door) {
      if (w.getBlock(px, py + 1, pz) !== 0 && !REPLACEABLE[w.getBlock(px, py + 1, pz)]) return;
      meta = { 1: 0, 0: 1, 5: 2, 4: 3 }[hdir];
    }
    if (pb.needsSupport || pb.door) { if (!this.supportedForPlace(px, py, pz, placeId, meta)) return; }
    // collision with entities
    if (pb.solid) {
      const boxes = (pb.shape === SH_BOXES || pb.shape === SH_MODEL) ? pb.boxes(meta) : [[0, 0, 0, 16, 16, 16]];
      for (const e of [p, ...this.entities]) {
        if (!(e instanceof Living) || e.deathTime > 0) continue;
        const eb = e.box();
        for (const bx of boxes) {
          if (eb[0] < px + bx[3] / 16 && eb[3] > px + bx[0] / 16 && eb[1] < py + bx[4] / 16 && eb[4] > py + bx[1] / 16 && eb[2] < pz + bx[5] / 16 && eb[5] > pz + bx[2] / 16) return;
        }
      }
    }
    if (IS_FLUID[placeId]) {
      if (placeId === WATER && w.dimension === 'nether') {
        // Water evaporates immediately in the Nether with smoke and fizz!
        if (this.mode !== 'creative') p.inv.slots[p.inv.sel] = makeStack('bucket');
        this.onFizz(px, py, pz);
        p.swingT = 6;
        return;
      }
      if (cur && !IS_FLUID[cur]) this.dropBlockLoot(px, py, pz, cur, w.getMeta(px, py, pz), null);
      w.setBlock(px, py, pz, placeId, 0);
      if (this.mode !== 'creative') p.inv.slots[p.inv.sel] = makeStack('bucket');
      Sound.splash([px, py, pz]); p.swingT = 6; this.flushMesh();
      return;
    }
    if (pb.door) w.setBlock(px, py + 1, pz, placeId, meta | 8, 0);
    this.placeAt(px, py, pz, placeId, meta, held, false);
  }
  supportedForPlace(x, y, z, id, meta) {
    const w = this.world;
    if (BLOCKS[id].door) return !!SOLIDCUBE[w.getBlock(x, y - 1, z)];
    return this.supported(x, y, z, id, meta);
  }
  placeAt(x, y, z, id, meta, held, merge) {
    const p = this.player, w = this.world;
    w.setBlock(x, y, z, id, meta);
    if (id === 513) this.getBlockEntity(x, y, z, 'hopper');
    else if (id === 527) this.getBlockEntity(x, y, z, 'brewing');
    else if (id === 52) this.getBlockEntity(x, y, z, 'chest');
    else if (id === 20 || id === 117) this.getBlockEntity(x, y, z, 'furnace');
    Sound.block('place', BLOCKS[id].sound, [x + 0.5, y + 0.5, z + 0.5]);
    if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
    p.swingT = 6;
    this.stats.placed++;
    if (this.stats.placed >= 100) this.grant('build');
    if (BLOCKS[id].redstone || id === 513) this.grant('redstone');
    if (BLOCKS[id].gravity) this.onNeighborUpdate(x, y, z, id);
    Redstone.notifyRedstoneAt(this, x, y, z);
    Redstone.propagateFromSource(this, x, y, z);
    this.flushMesh();
  }
  pickBlock() {
    const t = this.target; if (!t) return;
    let id = t.id;
    const map = { 2: 2, 117: 20, 64: 'wheat_seeds', 69: 'oak_door', 525: 'cherry_door', 38: 'sugar_cane', 63: 3, 119: 'redstone', 121: 120, 126: 125, 127: 'repeater', 156: 'repeater', 158: 80, 518: 516 };
    if (map[id] !== undefined) id = typeof map[id] === 'string' ? item(map[id]) : map[id];
    if (!ITEMS[id]) return;
    const inv = this.player.inv;
    for (let i = 0; i < 9; i++) if (inv.slots[i] && inv.slots[i].id === id) { inv.sel = i; return; }
    if (this.mode === 'creative') {
      let slot = inv.slots.findIndex((s, i) => i < 9 && !s);
      if (slot < 0) slot = inv.sel;
      inv.slots[slot] = { id, count: maxStack(id), dmg: 0 }; inv.sel = slot;
    } else {
      const i = inv.slots.findIndex((s, j) => j >= 9 && j < 36 && s && s.id === id);
      if (i >= 0) { const tmp = inv.slots[inv.sel]; inv.slots[inv.sel] = inv.slots[i]; inv.slots[i] = tmp; }
    }
  }

  // ---- rendering ---------------------------------------------------------------------------
  env(a) {
    const p = this.player;
    const R = this.renderer.renderDist * 16;
    const hasNightVision = !!(p && p.hasEffect && p.hasEffect('night_vision'));
    if (this.world && this.world.dimension === 'end') {
      const day = hasNightVision ? 0.96 : 0.80;
      const fog = [0.09, 0.04, 0.13];
      const sky = [0.04, 0.015, 0.07];
      return {
        tick: this.worldTime + a, day, fogColor: fog, skyColor: sky,
        sunDir: [0, 1, 0], sunset: [0, 0, 0, 0], voidColor: [0.02, 0.0, 0.04],
        celestial: 0.5, starBright: 0.65, sunAlpha: 0, rain: 0, moonPhase: 0,
        fogNear: R * 0.45, fogFar: R * 0.95, nightTint: [0.92, 0.84, 1.0], cloudColor: [0, 0, 0], isEnd: true,
      };
    }
    if (this.world && this.world.dimension === 'nether') {
      let day = hasNightVision ? 0.95 : 0.72;
      let fog = hasNightVision ? [0.45, 0.14, 0.14] : [0.33, 0.05, 0.05];
      let sky = [0.22, 0.03, 0.03];
      let fogNear = R * 0.22, fogFar = hasNightVision ? R * 0.9 : R * 0.65;
      if (this.headInLava) { fog = [0.6, 0.1, 0]; fogNear = 0; fogFar = 2; }
      return {
        tick: this.worldTime + a, day, fogColor: fog, skyColor: sky,
        sunDir: [0, 1, 0], sunset: [0, 0, 0, 0], voidColor: [0.18, 0.02, 0.02],
        celestial: 0.5, starBright: 0, sunAlpha: 0, rain: 0, moonPhase: 0,
        fogNear, fogFar, nightTint: [1.0, 0.85, 0.8], cloudColor: [0, 0, 0], isNether: true,
      };
    }
    const cel = this.celestial();
    const c = Math.cos(cel * Math.PI * 2);
    const br = clamp(c * 2 + 0.5, 0, 1);
    const rain = this.weather;
    let day = lerp(0.1, 1, br) * (1 - rain * 0.35);
    let sky = [0.47 * br, 0.65 * br, 1.0 * br].map((v, i) => v * (1 - rain * 0.6) + [0.01, 0.01, 0.03][i] * (1 - br));
    let fog = [0.72 * br + 0.02, 0.83 * br + 0.03, 1.0 * br + 0.06].map(v => v * (1 - rain * 0.4));
    if (rain > 0) { const g = (sky[0] + sky[1] + sky[2]) / 3; sky = sky.map(v => lerp(v, g, rain * 0.6)); const fg = (fog[0] + fog[1] + fog[2]) / 3; fog = fog.map(v => lerp(v, fg * 0.8, rain * 0.6)); }
    // sunrise / sunset tint
    const sunAlt = Math.cos(cel * Math.PI * 2);
    let sunsetA = 0;
    if (Math.abs(sunAlt) < 0.4) sunsetA = (1 - Math.abs(sunAlt) / 0.4) * 0.85;
    const sunset = [1.0, 0.45 + 0.2 * Math.max(0, sunAlt), 0.2, sunsetA * (1 - rain)];
    // fog color looks toward sun at sunset
    const sunDir = [-Math.sin(cel * Math.PI * 2), Math.cos(cel * Math.PI * 2), 0];
    if (sunsetA > 0) {
      const ld = this.lookDir();
      const facing = Math.max(0, ld[0] * Math.sign(sunDir[0]));
      fog = fog.map((v, i) => lerp(v, sunset[i], facing * sunsetA * 0.6));
    }
    let fogNear = R * 0.6, fogFar = R * 0.95;
    if (rain > 0) { fogNear *= 1 - rain * 0.4; fogFar *= 1 - rain * 0.2; }
    const nightTint = [0.55, 0.62, 0.95];
    if (this.headInWater) {
      const wl = Math.max(0.12, day * ((this.world.getLight(Math.floor(p.pos[0]), Math.floor(p.pos[1] + 1.6), Math.floor(p.pos[2])) >> 4) / 15));
      fog = [0.05 * wl, 0.18 * wl, 0.45 * wl]; fogNear = -4; fogFar = 28;
    } else if (this.headInLava) { fog = [0.6, 0.1, 0]; fogNear = 0; fogFar = 2; }
    if (hasNightVision) {
      day = Math.max(day, 0.94);
      fog = fog.map((v, i) => Math.max(v, [0.32, 0.38, 0.55][i]));
    }
    // cave darkness: below y=50 with little sky light, darken fog
    if (!this.headInWater && this.state === 'play' && !hasNightVision) {
      const sl = this.world.skyAt(Math.floor(p.pos[0]), Math.floor(p.pos[1] + 1.6), Math.floor(p.pos[2]));
      const k = clamp(sl / 10, 0.25, 1);
      fog = fog.map(v => v * k + (1 - k) * 0.02);
    }
    const moonPhase = Math.floor(this.worldTime / 24000) % 8;
    return {
      tick: this.worldTime + a, day, fogColor: fog, skyColor: sky, sunDir, sunset, voidColor: [fog[0] * 0.3, fog[1] * 0.3, fog[2] * 0.4],
      celestial: cel, starBright: clamp((0.25 - c) * 2, 0, 1) * 0.9 * (1 - rain), sunAlpha: 1 - rain, rain, moonPhase,
      fogNear, fogFar, nightTint, cloudColor: [lerp(0.15, 1, br) * (1 - rain * 0.4), lerp(0.15, 1, br) * (1 - rain * 0.4), lerp(0.2, 1, br) * (1 - rain * 0.35)],
    };
  }

  render(a, now) {
    const r = this.renderer, gl = r.gl;
    r.resize();
    gl.viewport(0, 0, r.canvas.width, r.canvas.height);
    if (!this.world || this.state === 'boot') { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); this.ui.draw(); return; }
    const p = this.player;
    let eye, yaw, pitch, fov = this.settings.fov;
    if (this.state === 'title' || this.state === 'loading') {
      eye = this.titleCam || [0, 100, 0]; yaw = this.titleYaw || 0; pitch = -0.15;
      if (this.state === 'loading') { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); this.ui.draw(); return; }
    } else {
      const ip = p.ipos(a);
      const eyeH = this.sleeping ? 0.2 : p.swimming ? 0.45 : p.sneaking && !p.flying ? 1.27 : 1.62;
      this.smoothEye = this.smoothEye == null ? eyeH : lerp(this.smoothEye, eyeH, 0.35);
      eye = [ip[0], ip[1] + this.smoothEye, ip[2]];
      yaw = p.yaw; pitch = p.pitch;
      if (this.sleeping) { yaw = [0, -Math.PI / 2, Math.PI, Math.PI / 2][this.sleeping.rot] + Math.PI; pitch = 0.5; }
      if (p.deathTime > 0) eye[1] -= Math.min(1.2, p.deathTime / 20);
      if (p.sprinting) fov *= 1.12;
      if (p.flying && p.sprinting) fov *= 1.05;
      if (p.hasEffect && p.hasEffect('speed')) fov *= 1 + 0.07 * p.effectLevel('speed');
      if (this.headInWater) fov *= 0.9;
      if (p.usingItem === item('bow')) fov *= 1 - Math.min(1, p.useT / 20) * 0.15;
    }
    this.curFov = lerp(this.curFov || fov, fov, 0.25);
    const env = this.env(a);
    // camera transform extras: hurt tilt, bobbing, shake, third person
    let camPos = eye;
    if (this.state === 'play' && this.perspective > 0) {
      const d = this.perspective === 1 ? 4 : -4;
      const look = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
      let dist = Math.abs(d);
      const hit = this.raycast(eye, [Math.sign(d) * -look[0], Math.sign(d) * -look[1], Math.sign(d) * -look[2]], dist, false);
      if (hit) dist = Math.max(0.5, hit.t - 0.3);
      camPos = [eye[0] - look[0] * dist * Math.sign(d), eye[1] - look[1] * dist * Math.sign(d), eye[2] - look[2] * dist * Math.sign(d)];
      if (this.perspective === 2) { yaw += Math.PI; pitch = -pitch; }
    }
    const shake = this.shake || 0;
    this.shake = shake * 0.9;
    r.setCamera(camPos, yaw + (Math.random() - 0.5) * shake * 0.05, pitch + (Math.random() - 0.5) * shake * 0.05, this.curFov, (v) => {
      if (this.state !== 'play') return;
      if (p.hurtTime > 0) { const h = (p.hurtTime - a) / 10; M4.rotZ(v, Math.sin(h * h * h * h * Math.PI) * 0.25); }
      if (p.deathTime > 0) M4.rotZ(v, Math.min(1, p.deathTime / 20) * 0.6);
      if (this.settings.bobbing && this.perspective === 0) {
        const bob = lerp(p.prevBob, p.bob, a) * Math.PI * 0.6, amt = lerp(p.prevBobAmt || 0, p.bobAmt, a);
        M4.translate(v, Math.sin(bob) * amt * 0.5, -Math.abs(Math.cos(bob) * amt), 0);
        M4.rotZ(v, Math.sin(bob) * amt * 0.05);
        M4.rotX(v, Math.abs(Math.cos(bob - 0.2) * amt) * 0.08);
      }
    });
    if (this.headInWater || this.headInLava) { gl.clearColor(env.fogColor[0], env.fogColor[1], env.fogColor[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
    else { gl.clear(gl.DEPTH_BUFFER_BIT); r.drawSky(env); }
    r.drawTerrain(env);
    this.drawEntities(a, env);
    if (this.state === 'play') this.drawSelection(env);
    // particles
    const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const up = [Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch)];
    this.particles.build(r.particleBuf, a, camPos, right, up);
    r.drawDynamic(r.particleBuf, r.particleGL, env, { noCull: true });
    r.drawTranslucent(env);
    r.drawClouds(env, camPos[0], camPos[2]);
    if (this.state === 'play') {
      this.drawWeather(env, a);
      if (this.perspective === 0 && p.deathTime === 0) this.drawHand(a, env);
    }
    this.ui.draw();
  }

  drawSelection(env) {
    const r = this.renderer, t = this.target;
    if (!t || this.ui.hideHud || this.perspective === 2) return;
    const [x, y, z] = t.pos;
    const v = [], e = 0.002;
    for (const bx of this.selBoxes(x, y, z, t.id)) {
      const x0 = x + bx[0] - e, y0 = y + bx[1] - e, z0 = z + bx[2] - e, x1 = x + bx[3] + e, y1 = y + bx[4] + e, z1 = z + bx[5] + e;
      const L = (a, b) => v.push(a[0], a[1], a[2], 0, 0, 0, 1, b[0], b[1], b[2], 0, 0, 0, 1);
      const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
      for (let i = 0; i < 4; i++) { L(c[i], c[(i + 1) % 4]); L(c[i + 4], c[(i + 1) % 4 + 4]); L(c[i], c[i + 4]); }
    }
    r.gl.enable(r.gl.DEPTH_TEST);
    r.drawLines(v, [0, 0, 0, 0.45]);
    // crack overlay
    if (this.breaking && this.breaking.progress > 0) {
      const stage = Math.min(9, Math.floor(this.breaking.progress * 10));
      const mb = r.miscBuf; mb.reset();
      const layer = T('destroy_stage_' + stage);
      const [bx, by, bz] = this.breaking.pos;
      for (const box of this.selBoxes(bx, by, bz, this.world.getBlock(bx, by, bz))) {
        for (let f = 0; f < 6; f++) {
          const F = FACES[f];
          for (const c of F.c) {
            const px = c[0] ? box[3] : box[0], py = c[1] ? box[4] : box[1], pz = c[2] ? box[5] : box[2];
            const uv = F.uv(px, py, pz);
            mb.v(bx + px + (c[0] ? 0.003 : -0.003), by + py + (c[1] ? 0.003 : -0.003), bz + pz + (c[2] ? 0.003 : -0.003), uv[0], uv[1], layer, 0, 255, 255, 255, 255, 255, 255, 0);
          }
        }
      }
      r.drawDynamic(mb, r.miscGL, { ...env, day: 1, fogNear: 1e8, fogFar: 2e8 }, { blend: 'mul', alphaTest: 0.01 });
    }
  }

  drawEntities(a, env) {
    const r = this.renderer, gl = r.gl;
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
    const cam = r.camPos;
    const list = this.entities.slice();
    if (this.state === 'play' && this.perspective > 0) list.push(this.player);
    for (const e of list) {
      const ip = e.ipos(a);
      const dx = ip[0] - cam[0], dz = ip[2] - cam[2];
      if (dx * dx + dz * dz > (r.renderDist * 16) ** 2) continue;
      const pad = (e instanceof Mob && e.type === 'ender_dragon') ? 8 : 2;
      if (r.planes && !aabbInFrustum(r.planes, ip[0] - pad, ip[1] - 2, ip[2] - pad, ip[0] + pad, ip[1] + pad + 2, ip[2] + pad)) continue;
      const l = e.lightAt();
      if (e instanceof Mob || e === this.player) this.drawMob(e, ip, a, env, l);
      else if (e instanceof EndCrystal && r.models.end_crystal) {
        const t = (this.tickCount + a) * 0.08 + (e.bobPhase || 0);
        const bob = Math.sin(t) * 0.18;
        const m = M4.create();
        M4.translate(m, ip[0], ip[1], ip[2]);
        const poses = {
          base: { ry: 0 },
          glass: { t: [0, bob, 0], ry: t * 1.1, rx: 0.6, rz: 0.6 },
          cube: { t: [0, bob, 0], ry: -t * 1.6, rx: 0.78, rz: -0.78 },
        };
        r.drawModel('end_crystal', 'end_crystal', m, poses, [1, 1], env, {});
      }
      else if (e instanceof ItemEntity) {
        const st = e.stack;
        const t = (e.age + a) / 20;
        const bob = Math.sin(t * 2 + e.bobOff) * 0.1 + 0.1;
        const n = st.count > 16 ? 3 : st.count > 1 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const m = M4.create(); M4.translate(m, ip[0] + i * 0.06, ip[1] + bob + 0.05 + i * 0.03, ip[2] + i * 0.04); M4.rotY(m, t + e.bobOff);
          this.drawItemModel(st.id, m, l, env, 'ground');
        }
      } else if (e instanceof FallingBlock || e instanceof PrimedTNT) {
        const id = e instanceof PrimedTNT ? 26 : e.blockId;
        const mb = this.blockMesh(id, e.meta || 0);
        const m = M4.create();
        let s = 1;
        if (e instanceof PrimedTNT && e.fuse < 10) s = 1 + (1 - e.fuse / 10) * 0.2;
        M4.translate(m, ip[0], ip[1] + 0.49, ip[2]); M4.scale(m, s, s, s); M4.translate(m, -0.5, -0.49, -0.5);
        r.drawMesh(mb, m, env, l);
        if (e instanceof PrimedTNT && (e.fuse / 5 | 0) % 2 === 0) {
          gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthFunc(gl.LEQUAL);
          r.drawMesh(mb, m, env, [1, 1], { color: [1, 1, 1, 0.5] });
          gl.disable(gl.BLEND); gl.depthFunc(gl.LESS);
        }
      } else if (e instanceof Arrow) {
        const m = M4.create(); M4.translate(m, ip[0], ip[1], ip[2]);
        M4.rotY(m, e.yaw + Math.PI / 2); M4.rotZ(m, e.pitch - Math.PI / 4);
        M4.scale(m, 0.7, 0.7, 0.7); M4.translate(m, -0.5, -0.5, 0);
        const lay = e.snowball ? ITEMS[e.snowball].tex : T('i_arrow');
        r.drawMesh(this.spriteMesh(lay), m, env, l);
      } else if (e instanceof GhastFireball || e instanceof BlazeFireball || e instanceof EnderPearlEntity || e instanceof EyeOfEnderEntity || e instanceof DragonFireball) {
        const m = M4.create(); M4.translate(m, ip[0], ip[1] + 0.3, ip[2]);
        M4.rotY(m, (this.tickCount + a) * 0.25);
        const sc = (e instanceof GhastFireball || e instanceof DragonFireball) ? 0.9 : 0.55;
        M4.scale(m, sc, sc, sc); M4.translate(m, -0.5, -0.5, 0);
        const lay = e instanceof EnderPearlEntity
          ? T('i_ender_pearl')
          : e instanceof EyeOfEnderEntity
            ? T('i_ender_eye')
            : e instanceof DragonFireball
              ? T('i_dragon_breath')
              : T('i_fire_charge');
        r.drawMesh(this.spriteMesh(lay), m, env, [1, 1]);
      }
    }
    // Render floating 3D open book above nearby Enchanting Tables (ID 185)
    if (this.nearbyEnchantTables && this.nearbyEnchantTables.length && r.models.enchant_book) {
      const t = this.tickCount + a;
      for (const [tx, ty, tz] of this.nearbyEnchantTables) {
        if (this.world.getBlock(tx, ty, tz) !== 185) continue;
        const m = M4.create();
        const bob = Math.sin(t * 0.1 + tx * 0.7 + tz * 1.3) * 0.05;
        const dx = this.player.pos[0] - (tx + 0.5), dz = this.player.pos[2] - (tz + 0.5);
        const dist = Math.hypot(dx, dz);
        const faceYaw = dist < 6.5 ? Math.atan2(-dx, -dz) : t * 0.04;
        const foldAngle = dist < 6.5 ? 0.24 : 1.15;
        M4.translate(m, tx + 0.5, ty + 1.0 + bob, tz + 0.5);
        M4.rotY(m, faceYaw);
        M4.rotX(m, 0.65);
        M4.scale(m, 0.8, 0.8, 0.8);
        const l = this.world.getLight(tx, ty + 1, tz);
        const flutter = Math.sin(t * 0.16) * 0.03;
        const poses = {
          cover_l: { ry: -foldAngle - flutter },
          cover_r: { ry: foldAngle + flutter },
          page_l: { ry: -foldAngle - 0.26 - Math.sin(t * 0.22) * 0.12 },
          page_r: { ry: foldAngle + 0.26 + Math.cos(t * 0.22) * 0.12 },
        };
        r.drawModel('enchant_book', 'enchant_book', m, poses, [(l >> 4) / 15, Math.max(0.5, (l & 15) / 15)], env, {});
      }
    }
    // Render dynamic multi-layer starry void shader on nearby End Portal blocks (ID 539)
    if (this.nearbyEndPortals && this.nearbyEndPortals.length && r.drawEndPortalBlocks) {
      r.drawEndPortalBlocks(this.nearbyEndPortals, env);
    }
    // Render spinning miniature spider inside nearby Monster Spawners (ID 182)
    if (this.nearbySpawners && this.nearbySpawners.length) {
      const spin = (this.tickCount + a) * 0.14;
      for (const [sx, sy, sz] of this.nearbySpawners) {
        if (this.world.getBlock(sx, sy, sz) !== 182) continue;
        const isBlaze = (this.world.getMeta(sx, sy, sz) === 1 || this.world.dimension === 'nether');
        const m = M4.create();
        M4.translate(m, sx + 0.5, sy + 0.25 + Math.sin(spin * 0.8) * 0.05, sz + 0.5);
        M4.rotY(m, spin);
        M4.scale(m, 0.36, 0.36, 0.36);
        r.drawModel(isBlaze ? 'blaze' : 'spider', isBlaze ? 'blaze' : 'spider', m, {}, [1, 1], env, {});
      }
    }
  }
  drawMob(e, ip, a, env, l) {
    const r = this.renderer, gl = r.gl;
    const isPlayer = e === this.player;
    const model = isPlayer ? 'steve' : e.T.model;
    const m = M4.create();
    M4.translate(m, ip[0], ip[1], ip[2]);
    let by = isPlayer ? e.yaw : e.bodyYaw;
    if (!isPlayer && e.prevBodyYaw !== undefined) { let d = e.bodyYaw - e.prevBodyYaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; by = e.prevBodyYaw + d * a; }
    M4.rotY(m, by);
    if (e.deathTime > 0) M4.rotZ(m, Math.min(1, Math.sqrt((e.deathTime + a) / 20)) * Math.PI / 2);
    const swim = isPlayer ? lerp(e.prevSwimAmt || 0, e.swimAmt !== undefined ? e.swimAmt : (e.swimming ? 1 : 0), a) : 0;
    if (swim > 0.01) {
      // Horizontal prone swimming posture in third-person, pitched along look direction
      M4.translate(m, 0, 0.32 * swim, 0);
      M4.rotX(m, (-Math.PI / 2 + e.pitch * 0.85) * swim);
      M4.translate(m, 0, -0.9 * swim, 0);
    }
    let sc = isPlayer ? 0.9375 : e.T.scale;
    if (e.type === 'creeper' && e.fuse >= 0) { const f = lerp(e.prevFuse, e.fuse, a) / 28; const s = 1 + Math.sin(f * 100) * f * 0.01; sc *= (1 + f * 0.4) * s; }
    if (e.baby) sc *= 0.5;
    M4.scale(m, sc, sc, sc);
    const poses = isPlayer ? this.playerPose(a) : e.pose(a);
    let overlay = e.hurtTime > 0 || e.deathTime > 0 ? [1, 0, 0, 0.4] : null;
    if (e.type === 'creeper' && e.fuse >= 0 && (e.fuse / 4 | 0) % 2 === 0) overlay = [1, 1, 1, 0.5];
    const lt = [l[0], l[1]];
    if (e.fire > 0) lt[1] = 1;
    let heldId = null, offhandId = null;
    if (isPlayer) {
      if (e.inv.held) heldId = e.inv.held.id;
      if (e.inv.offhand) offhandId = e.inv.offhand.id;
    } else if (e.type === 'skeleton') heldId = item('bow');
    else if (e.type === 'wither_skeleton') heldId = item('stone_sword');
    else if (e.type === 'zombified_piglin') heldId = item('golden_sword');
    if (e.type === 'blaze') { lt[0] = 1; lt[1] = 1; }
    const activeSh = isPlayer && e.getActiveShield ? e.getActiveShield() : null;
    const makeArmAttach = (itemId, isLeft) => (am) => {
      const def = ITEMS[itemId], b = def.block !== undefined ? BLOCKS[def.block] : null;
      if (def.shield && r.models.shield) {
        const blockingThisArm = !!(activeSh && ((isLeft && activeSh.hand === 'offhand') || (!isLeft && activeSh.hand === 'main')));
        if (blockingThisArm) {
          // Arm is raised with rx=1.05, ry=(isLeft ? -0.52 : 0.52).
          // Place shield directly in front of Steve's torso (x near 0, z=-0.49),
          // and undo arm rx/ry so shield stands upright facing straight forward (-Z) with handle (+Z) in hand!
          const armRx = 1.05, armRy = isLeft ? -0.52 : 0.52;
          M4.translate(am, isLeft ? 2.5 / 16 : -2.5 / 16, -9 / 16, -2.5 / 16);
          M4.rotX(am, -armRx + 0.12);
          M4.rotY(am, -armRy);
          M4.scale(am, 0.78, 0.78, 0.78);
        } else {
          // Idle at side of arm: handle (+Z in shield space) points INWARD toward hand,
          // and decorative shield plate (-Z in shield space) faces OUTWARD away from body!
          M4.translate(am, isLeft ? -3 / 16 : 3 / 16, -9 / 16, 0);
          M4.rotY(am, isLeft ? Math.PI / 2 : -Math.PI / 2);
          M4.scale(am, 0.75, 0.75, 0.75);
        }
        r.drawModel('shield', 'shield', am, null, lt, env, { overlay });
        return;
      }
      const flat = !b || def.flat || b.shape === SH_CROSS || b.shape === SH_TORCH || b.ladder || b.door;
      M4.translate(am, 0, -9 / 16, -1 / 16);
      if (flat) {
        if (def.key === 'bow') {
          // Vanilla bow.json thirdperson_righthand: wooden limb curves forward (-Z) away from arm, string at hand
          M4.translate(am, 0, -1 / 16, -2 / 16);
          M4.rotY(am, -Math.PI / 2);
          M4.rotZ(am, -0.75);
          M4.scale(am, 0.85, 0.85, 0.85);
          M4.translate(am, -0.45, -0.45, 0);
        } else {
          M4.rotY(am, Math.PI / 2);
          if (def.tool || def.key === 'stick') { M4.scale(am, 0.8, 0.8, 0.8); M4.translate(am, -0.3, -0.3, 0); }
          else { M4.scale(am, 0.5, 0.5, 0.5); M4.translate(am, -0.5, -0.4, 0); }
        }
      } else { M4.scale(am, 0.375, 0.375, 0.375); M4.translate(am, -0.5, -0.8, -0.5); }
      this.drawItemModel(itemId, am, lt, env, 'hand');
    };
    const attach = (heldId != null || offhandId != null) ? {} : null;
    if (heldId != null) attach.rarm = makeArmAttach(heldId, false);
    if (offhandId != null) attach.larm = makeArmAttach(offhandId, true);
    let texName = model === 'steve' ? 'steve' : e.type === 'sheep' ? 'sheep' : (e.T && e.T.tex) ? e.T.tex : model;
    if (e.type === 'ghast' && e.charging && r.entityTex.ghast_shooting) texName = 'ghast_shooting';
    if (e.type === 'villager' && e.profession) {
      const profTex = 'villager_' + e.profession;
      if (r.entityTex[profTex]) texName = profTex;
    }
    r.drawModel(model, texName, m, poses, lt, env, { overlay, attach });
    if (isPlayer) r.drawPlayerArmor(e, m, poses, lt, env, { overlay });
    if (e.type === 'sheep' && !e.sheared) {
      const col = WOOL_RGB[e.woolColor] || [1, 1, 1];
      r.drawModel('sheep_wool', 'sheep_wool', m, poses, lt, env, { overlay, tint: col });
    }
    if (e.type === 'spider') { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthFunc(gl.LEQUAL); r.drawModel('spider', 'spider_eyes', m, poses, [1, 1], env, {}); gl.disable(gl.BLEND); gl.depthFunc(gl.LESS); }
    if (e.type === 'enderman' && r.entityTex.enderman_eyes) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthFunc(gl.LEQUAL); r.drawModel('enderman', 'enderman_eyes', m, poses, [1, 1], env, {}); gl.disable(gl.BLEND); gl.depthFunc(gl.LESS); }
    if (e.type === 'ender_dragon' && r.entityTex.dragon_eyes) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthFunc(gl.LEQUAL);
      r.drawModel('ender_dragon', 'dragon_eyes', m, poses, [1, 1], env, {});
      gl.disable(gl.BLEND); gl.depthFunc(gl.LESS);
    }
    if (e.type === 'ender_dragon' && e.healingCrystal && !e.healingCrystal.dead) {
      const cp = e.healingCrystal.pos;
      const beamVerts = [
        cp[0], cp[1] + 0.9, cp[2], 1, 0.4, 1, 0.9,
        ip[0], ip[1] + 1.5, ip[2], 1, 0.8, 1, 0.9,
      ];
      r.drawLines(beamVerts, [1, 0.45, 1, 0.9]);
    }
    // shadow on the ground below
    if (e.deathTime === 0) {
      const fx = Math.floor(ip[0]), fz = Math.floor(ip[2]);
      let gy = Math.floor(ip[1] + 0.01);
      for (let k = 0; k < 4 && gy > 0 && !SOLIDCUBE[this.world.getBlock(fx, gy - 1, fz)] && !BLOCKS[this.world.getBlock(fx, gy - 1, fz)].solid; k++) gy--;
      const h = ip[1] - gy;
      if (h < 3) r.drawShadow(ip[0], gy, ip[2], e.w * 0.75 * (1 - h / 6), 0.55 * (1 - h / 3));
    }
  }
  playerPose(a) {
    const p = this.player;
    const swing = lerp(p.limbSwing - p.limbAmt, p.limbSwing, a) * 0.6662, amt = p.limbAmt;
    const l = Math.cos(swing) * 1.4 * amt, r = -l;
    const sw = p.swingT > 0 ? Math.sin((6 - p.swingT + a) / 6 * Math.PI) : 0;
    const pose = {
      head: { rx: p.pitch },
      rarm: { rx: r * 0.7 + sw * 1.2, ry: 0, rz: 0 },
      larm: { rx: l * 0.7, ry: 0, rz: 0 },
      rleg: { rx: l },
      lleg: { rx: r },
      bodyPitch: 0,
    };
    const swim = lerp(p.prevSwimAmt || 0, p.swimAmt !== undefined ? p.swimAmt : (p.swimming ? 1 : 0), a);
    if (swim > 0.01) {
      const ph = (this.tickCount + a) * 0.42;
      pose.bodyPitch = (-Math.PI / 2 + p.pitch * 0.85) * swim;
      pose.head.rx = lerp(pose.head.rx, Math.PI * 0.42 + p.pitch * 0.25, swim);
      pose.rarm.rx = lerp(pose.rarm.rx, Math.PI * 0.82 + Math.sin(ph) * 0.65, swim);
      pose.rarm.rz = lerp(0, 0.22 + Math.cos(ph) * 0.18, swim);
      pose.larm.rx = lerp(pose.larm.rx, Math.PI * 0.82 - Math.sin(ph) * 0.65, swim);
      pose.larm.rz = lerp(0, -0.22 - Math.cos(ph) * 0.18, swim);
      pose.rleg.rx = lerp(pose.rleg.rx, Math.sin(ph * 1.6) * 0.45, swim);
      pose.lleg.rx = lerp(pose.lleg.rx, -Math.sin(ph * 1.6) * 0.45, swim);
    }
    if (p.usingItem && ITEMS[p.usingItem] && ITEMS[p.usingItem].key === 'bow') {
      pose.rarm.rx = Math.PI / 2 - p.pitch * 0.8;
      pose.rarm.ry = -0.1;
      pose.larm.rx = Math.PI / 2 - p.pitch * 0.8;
      pose.larm.ry = 0.45;
    }
    const sh = p.getActiveShield && p.getActiveShield();
    if (sh) {
      if (sh.hand === 'main') {
        pose.rarm.rx = 1.05;
        pose.rarm.ry = 0.52;
      } else {
        pose.larm.rx = 1.05;
        pose.larm.ry = -0.52;
      }
    }
    return pose;
  }
  blockMesh(id, meta) {
    if (!this._bm) this._bm = new Map();
    const k = id * 256 + meta;
    let m = this._bm.get(k);
    if (!m) { m = Mesher.single(id, meta); this._bm.set(k, m); }
    return m;
  }
  spriteMesh(layer) { return itemSpriteMesh(layer); }
  drawItemModel(id, m, l, env, ctx) {
    const def = ITEMS[id], r = this.renderer;
    if (def && def.shield && r.models.shield) {
      const mm = new Float32Array(m);
      if (ctx === 'ground') { M4.scale(mm, 0.45, 0.45, 0.45); M4.translate(mm, 0, 0.6, 0); }
      r.drawModel('shield', 'shield', mm, null, l, env, {});
      return;
    }
    const b = def.block !== undefined ? BLOCKS[def.block] : null;
    const flat = !b || def.flat || b.shape === SH_CROSS || b.shape === SH_TORCH || b.ladder || b.door;
    if (flat) {
      const layer = b ? (def.flat ? T(def.flat) : b.tex[0]) : def.tex;
      const mm = new Float32Array(m);
      if (ctx === 'ground') { M4.scale(mm, 0.5, 0.5, 0.5); M4.translate(mm, -0.5, 0, 0); }
      r.drawMesh(this.spriteMesh(layer), mm, env, l);
    } else {
      const mm = new Float32Array(m);
      if (ctx === 'ground') { M4.scale(mm, 0.25, 0.25, 0.25); M4.translate(mm, -0.5, 0, -0.5); }
      let meta = b.facing ? 5 : 0; if (b.stairs) meta = 1; if (b.hopper) meta = 2; if (b.piston) meta = 3; if (b.observer) meta = 5;
      if (b.bed) { r.drawMesh(this.bedMesh || (this.bedMesh = Mesher.multi([[def.block, 0, 0, 0, 0], [def.block, 4, 0, 0, -1]])), mm, env, l); return; }
      r.drawMesh(this.blockMesh(def.block, meta), mm, env, l);
    }
  }
  drawHand(a, env) {
    const r = this.renderer, gl = r.gl, p = this.player;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const proj = M4.create();
    M4.perspective(proj, 70 * Math.PI / 180, r.canvas.width / r.canvas.height, 0.05, 10);
    const savedVP = r.vp, savedCam = r.camPos;
    r.vp = proj; r.camPos = [0, 0, 0];
    const held = p.inv.held;
    const hid = held ? held.id : -1;
    if (this.lastHeld !== hid) { this.equipT = 1; this.lastHeld = hid; }
    this.equipT = Math.max(0, (this.equipT || 0) - 0.12);
    const eq = this.equipT;
    const sw = p.swingT > 0 ? clamp((6 - p.swingT + a) / 6, 0, 1) : 0;
    const D = Math.PI / 180, PI = Math.PI;
    const m = M4.create();
    // view bobbing applied to hand as in vanilla (slight)
    if (this.settings.bobbing) {
      const bob = lerp(p.prevBob, p.bob, a) * PI * 0.6, amt = lerp(p.prevBobAmt || 0, p.bobAmt, a);
      M4.translate(m, Math.sin(bob) * amt * 0.5, -Math.abs(Math.cos(bob) * amt), 0);
    }
    const lt = p.lightAt();
    const env2 = { ...env, fogNear: 1e8, fogFar: 2e8 };
    if (!held) {
      const f1 = Math.sqrt(sw);
      M4.translate(m, -0.3 * Math.sin(f1 * PI) + 0.64, 0.4 * Math.sin(f1 * PI * 2) - 0.6 - eq * 0.6, -0.4 * Math.sin(sw * PI) - 0.72);
      M4.rotY(m, 45 * D);
      M4.rotY(m, Math.sin(f1 * PI) * 70 * D);
      M4.rotZ(m, Math.sin(sw * sw * PI) * -20 * D);
      M4.translate(m, -1, 3.6, 3.5);
      M4.rotZ(m, 120 * D); M4.rotX(m, 200 * D); M4.rotY(m, -135 * D);
      M4.translate(m, 5.6, 0, 0);
      M4.translate(m, -6 / 16, 2 / 16, 0);
      M4.rotZ(m, PI);
      r.drawModel('arm', 'steve', m, null, lt, env2, { vp: proj });
    } else {
      const def = ITEMS[held.id];
      const b = def.block !== undefined ? BLOCKS[def.block] : null;
      const flat = !b || def.flat || b.shape === SH_CROSS || b.shape === SH_TORCH || b.ladder || b.door;
      const eating = p.usingItem && (def.food || def.potion);
      const bowing = p.usingItem && def.key === 'bow';
      const activeShield = p.getActiveShield && p.getActiveShield();
      const blockingMain = activeShield && activeShield.hand === 'main';
      if (def.shield && r.models.shield) {
        if (blockingMain) {
          M4.translate(m, 0.30, -0.26 - eq * 0.3, -0.58);
          M4.rotY(m, 165 * D);
          M4.rotX(m, -8 * D);
        } else {
          const f1 = Math.sqrt(sw);
          M4.translate(m, -0.25 * Math.sin(f1 * PI) + 0.56, 0.15 * Math.sin(f1 * PI * 2) - 0.52 - eq * 0.5, -0.72);
          M4.rotY(m, 145 * D);
        }
        M4.scale(m, 0.65, 0.65, 0.65);
        r.drawModel('shield', 'shield', m, null, lt, env2, { vp: proj });
      } else {
        if (eating) {
          const left = 32 - p.useT - a + 1, f1 = left / 32;
          if (f1 < 0.8) M4.translate(m, 0, Math.abs(Math.cos(left / 4 * PI) * 0.1), 0);
          const f3 = 1 - Math.pow(Math.max(0, f1), 27);
          M4.translate(m, f3 * 0.6, f3 * -0.5, 0);
          M4.rotY(m, f3 * 90 * D); M4.rotX(m, f3 * 10 * D); M4.rotZ(m, f3 * 30 * D);
          M4.translate(m, 0.56, -0.52 - eq * 0.6, -0.72);
        } else if (bowing) {
          M4.translate(m, 0.56, -0.52 - eq * 0.6, -0.72);
          M4.translate(m, -0.2785682, 0.18344387, 0.15731531);
          M4.rotX(m, -13.935 * D); M4.rotY(m, 35.3 * D); M4.rotZ(m, -9.785 * D);
          let f = (p.useT + a) / 20; f = (f * f + f * 2) / 3; if (f > 1) f = 1;
          if (f > 0.1) M4.translate(m, 0, Math.sin((p.useT - 0.1) * 1.3) * (f - 0.1) * 0.004, 0);
          M4.translate(m, 0, 0, f * 0.04);
          M4.scale(m, 1, 1, 1 + f * 0.2);
          M4.rotY(m, -45 * D);
        } else {
          const f1 = Math.sqrt(sw);
          M4.translate(m, -0.4 * Math.sin(f1 * PI), 0.2 * Math.sin(f1 * PI * 2), -0.2 * Math.sin(sw * PI));
          M4.translate(m, 0.56, -0.52 - eq * 0.6, -0.72);
          const f = Math.sin(sw * sw * PI);
          M4.rotY(m, (45 + f * -20) * D);
          M4.rotZ(m, f * -20 * D * Math.sin(f1 * PI));
          M4.rotX(m, Math.sin(f1 * PI) * -80 * D);
          M4.rotY(m, -45 * D);
        }
        if (flat) {
          M4.translate(m, 1.13 / 16, 3.2 / 16, 1.13 / 16);
          M4.rotX(m, 0); M4.rotY(m, -90 * D); M4.rotZ(m, 25 * D);
          M4.scale(m, 0.68, 0.68, 0.68);
          M4.translate(m, -0.5, -0.5, 0);
          let layer = b ? (def.flat ? T(def.flat) : b.tex[0]) : def.tex;
          if (bowing) { const f = p.useT; layer = T(f >= 18 ? 'i_bow_pulling_2' : f >= 13 ? 'i_bow_pulling_1' : 'i_bow_pulling_0'); }
          r.drawMesh(this.spriteMesh(layer), m, env2, lt);
        } else {
          M4.rotY(m, 45 * D);
          M4.scale(m, 0.4, 0.4, 0.4);
          M4.translate(m, -0.5, -0.5, -0.5);
          let meta = b.facing ? 5 : 0; if (b.stairs) meta = 1; if (b.hopper) meta = 2; if (b.piston) meta = 3; if (b.observer) meta = 5;
          if (b.bed) { M4.translate(m, 0.25, 0.2, 0.5); M4.scale(m, 0.6, 0.6, 0.6); r.drawMesh(this.bedMesh || (this.bedMesh = Mesher.multi([[def.block, 0, 0, 0, 0], [def.block, 4, 0, 0, -1]])), m, env2, lt); }
          else r.drawMesh(this.blockMesh(def.block, meta), m, env2, lt);
        }
      }
    }
    // Render offhand shield on left side of first-person view when equipped in slot 40
    const oh = p.inv.offhand;
    if (oh && ITEMS[oh.id] && ITEMS[oh.id].shield && r.models.shield) {
      const mOff = M4.create();
      if (this.settings.bobbing) {
        const bob = lerp(p.prevBob, p.bob, a) * PI * 0.6, amt = lerp(p.prevBobAmt || 0, p.bobAmt, a);
        M4.translate(mOff, Math.sin(bob) * amt * 0.5, -Math.abs(Math.cos(bob) * amt), 0);
      }
      const activeShield = p.getActiveShield && p.getActiveShield();
      const blockingOff = activeShield && activeShield.hand === 'offhand';
      if (blockingOff) {
        M4.translate(mOff, -0.28, -0.24, -0.58);
        M4.rotY(mOff, 195 * D);
        M4.rotX(mOff, -8 * D);
      } else {
        M4.translate(mOff, -0.54, -0.52, -0.72);
        M4.rotY(mOff, 215 * D);
      }
      M4.scale(mOff, 0.65, 0.65, 0.65);
      r.drawModel('shield', 'shield', mOff, null, lt, env2, { vp: proj });
    }
    r.vp = savedVP; r.camPos = savedCam;
  }
  drawWeather(env, a) {
    if (this.weather < 0.05) return;
    const r = this.renderer, gl = r.gl, p = this.player, w = this.world;
    const mb = r.miscBuf; mb.reset();
    const px = Math.floor(p.pos[0]), pz = Math.floor(p.pos[2]), py = p.pos[1];
    const t = (this.worldTime + a);
    const v = [];
    for (let dx = -10; dx <= 10; dx++) for (let dz = -10; dz <= 10; dz++) {
      if (dx * dx + dz * dz > 100) continue;
      const x = px + dx, z = pz + dz;
      let top = Math.floor(py) + 12;
      let y = top;
      while (y > py - 12 && !BLOCKS[w.getBlock(x, y, z)].solid && !IS_FLUID[w.getBlock(x, y, z)]) y--;
      const y0 = Math.max(y + 1, py - 8), y1 = py + 12;
      if (y0 >= y1) continue;
      const cold = this.isCold(x, z);
      v.push([x, z, y0, y1, cold]);
    }
    // draw as textured vertical quads facing the camera using the rain/snow textures
    const T2 = r.progTex;
    gl.useProgram(T2.p);
    gl.uniformMatrix4fv(T2.u.u_vp, false, r.vp);
    gl.uniformMatrix4fv(T2.u.u_model, false, r.identity);
    const data = [];
    for (const [x, z, y0, y1, cold] of v) {
      const cx = x + 0.5, cz = z + 0.5;
      const ddx = cx - p.pos[0], ddz = cz - p.pos[2], d = Math.hypot(ddx, ddz) || 1;
      const nx = -ddz / d * 0.5, nz = ddx / d * 0.5;
      const sp = cold ? 0.02 : 0.12;
      const off = (t * sp + (hash3(x, 0, z, 3) * 4)) % 4;
      const u0 = hash3(x, 1, z, 3) * 4;
      data.push([cx - nx, y0, cz - nz, u0, (y1 + off) / 4, cx + nx, y0, cz + nz, u0 + 0.25, (y1 + off) / 4, cx + nx, y1, cz + nz, u0 + 0.25, (y0 + off) / 4, cx - nx, y1, cz - nz, u0, (y0 + off) / 4, cold]);
    }
    for (const cold of [false, true]) {
      const arr = [];
      for (const d of data) if (d[20] === cold) {
        arr.push(d[0], d[1], d[2], d[3], cold ? d[4] * 0.3 : -d[4], d[5], d[6], d[7], d[8], cold ? d[9] * 0.3 : -d[9], d[10], d[11], d[12], d[13], cold ? d[14] * 0.3 : -d[14], d[15], d[16], d[17], d[18], cold ? d[19] * 0.3 : -d[19]);
      }
      if (!arr.length) continue;
      if (!this.weatherVao) {
        this.weatherVao = gl.createVertexArray(); gl.bindVertexArray(this.weatherVao);
        this.weatherBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.weatherBuf);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.quadIdx);
      }
      gl.bindVertexArray(this.weatherVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.weatherBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.DYNAMIC_DRAW);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, r.entityTex[cold ? 'snowfall' : 'rain']);
      const br = env.day;
      gl.uniform4f(T2.u.u_color, br, br, br, this.weather * 0.8);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE);
      gl.drawElements(gl.TRIANGLES, arr.length / 20 * 6, gl.UNSIGNED_INT, 0);
      gl.depthMask(true); gl.enable(gl.CULL_FACE); gl.disable(gl.BLEND);
    }
    // rain sound
    if (this.tickCount % 10 === 0 && this.weather > 0.3 && !this.isCold(px, pz)) Sound.noise(null, { type: 'highpass', freq: 2500, dur: 0.6, vol: 0.05 * this.weather, attack: 0.2 });
  }

  // ---- pointer -------------------------------------------------------------------------------
  capturePointer() {
    if (this.state !== 'play') return;
    const c = this.canvas, swallow = (p) => { if (p && p.catch) p.catch(() => { }); };
    try {
      const r = c.requestPointerLock({ unadjustedMovement: true });
      if (r && r.catch) r.catch(() => { try { swallow(c.requestPointerLock()); } catch (e) { } });
    } catch (e) { try { swallow(c.requestPointerLock()); } catch (e2) { } }
  }
  releasePointer() { if (document.pointerLockElement) document.exitPointerLock(); }
}

const WOOL_RGB = [[1, 1, 1], [0.95, 0.55, 0.2], [0.75, 0.3, 0.75], [0.4, 0.6, 0.85], [0.9, 0.85, 0.2], [0.5, 0.8, 0.2], [0.95, 0.6, 0.7], [0.3, 0.3, 0.3], [0.6, 0.6, 0.6], [0.2, 0.55, 0.6], [0.5, 0.25, 0.7], [0.2, 0.3, 0.65], [0.45, 0.3, 0.2], [0.35, 0.45, 0.2], [0.65, 0.2, 0.2], [0.1, 0.1, 0.1]];

Player.prototype.loadedHere = function () {
  const w = this.world, x = Math.floor(this.pos[0]), z = Math.floor(this.pos[2]);
  return w.isLoaded(x, z) && w.getChunk(x >> 4, z >> 4).lit;
};

function rayBox(o, d, x0, y0, z0, x1, y1, z1) {
  let tmin = -Infinity, tmax = Infinity, face = -1;
  const mins = [x0, y0, z0], maxs = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < mins[i] || o[i] > maxs[i]) return null; continue; }
    let t1 = (mins[i] - o[i]) / d[i], t2 = (maxs[i] - o[i]) / d[i];
    let f1 = i * 2, f2 = i * 2 + 1; // face indices: 0 -x,1 +x,2 -y,3 +y,4 -z,5 +z
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; const f = f1; f1 = f2; f2 = f; }
    if (t1 > tmin) { tmin = t1; face = f1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return { t: Math.max(0, tmin), face };
}