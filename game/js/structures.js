'use strict';
// ---------------------------------------------------------------------------
// World Structures: Desert Pyramid (沙漠神殿), Mineshaft (废弃矿井), Village (村庄)
// Deterministic region-based multi-chunk generator following Minecraft Wiki specs.
// ---------------------------------------------------------------------------

const Structures = {
  _pyramidCache: new Map(),
  _mineshaftCache: new Map(),
  _villageCache: new Map(),
  _fortressCache: new Map(),
  _strongholdCache: new Map(),

  clearCaches() {
    this._pyramidCache.clear();
    this._mineshaftCache.clear();
    this._villageCache.clear();
    this._fortressCache.clear();
    this._strongholdCache.clear();
  },

  // Helper: bounded chunk-local block setter
  makeSetter(ch) {
    const B = ch.blocks, M = ch.meta, mask = ch.structureMask;
    const x0 = ch.cx * 16, z0 = ch.cz * 16;
    const set = (wx, wy, wz, id, meta = 0, markMask = true) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || wy < 1 || wy >= HEIGHT) return;
      const i = (wy << 8) | (lz << 4) | lx;
      if (B[i] === 6) return; // never overwrite bedrock
      B[i] = id;
      M[i] = meta;
      if (markMask && mask) mask[(lz << 4) | lx] = 1;
    };
    const get = (wx, wy, wz) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || wy < 0 || wy >= HEIGHT) return -1;
      return B[(wy << 8) | (lz << 4) | lx];
    };
    // Fill downward from wy to solid ground inside current chunk
    const fillDown = (wx, wy, wz, id, meta = 0) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15) return;
      for (let y = Math.min(wy, HEIGHT - 1); y >= 1; y--) {
        const i = (y << 8) | (lz << 4) | lx;
        const cur = B[i];
        if (cur !== 0 && cur !== 7 && cur !== 8 && cur !== 34 && cur !== 35 && cur !== 39 && cur !== 40 && !REPLACEABLE[cur]) {
          // Replace top grass/sand with foundation block too if at wy
          if (y === wy) { B[i] = id; M[i] = meta; }
          break;
        }
        B[i] = id;
        M[i] = meta;
      }
    };
    return { set, get, fillDown, x0, z0 };
  },

  // =========================================================================
  // 1. DESERT PYRAMID (沙漠神殿) — 21x21 sandstone pyramid + 4-chest TNT trap
  // =========================================================================
  pyramidInRegion(world, rx, rz) {
    const key = `${ world.seed }:${ rx }:${ rz }`;
    if (this._pyramidCache.has(key)) return this._pyramidCache.get(key);
    const r = RNG(hashStr('pyramid_reg:' + key));
    const REG = 18; // 18x18 chunks per region (vanilla-like spacing)
    let found = null;
    const allowRegion = (rx === 0 && rz === 0) || r() < 0.55;
    // Try up to 10 deterministic candidate chunks in eligible desert regions
    for (let attempt = 0; allowRegion && attempt < 10; attempt++) {
      const cx = rx * REG + 1 + r.int(REG - 2);
      const cz = rz * REG + 1 + r.int(REG - 2);
      const wx = cx * 16 + 8, wz = cz * 16 + 8;
      const c0 = world.column(wx, wz);
      if (world.biomeOf(c0) !== BI.DESERT) continue;
      if (c0.h < SEA + 1 || c0.h > 92) continue;
      // Check 4 corners of 21x21 footprint
      let minH = c0.h, maxH = c0.h, ok = true;
      for (const [dx, dz] of [[-10, -10], [10, -10], [-10, 10], [10, 10], [0, 10], [0, -10]]) {
        const cn = world.column(wx + dx, wz + dz);
        const bi = world.biomeOf(cn);
        if (cn.h <= SEA || (bi !== BI.DESERT && bi !== BI.BEACH && bi !== BI.PLAINS)) { ok = false; break; }
        if (cn.h < minH) minH = cn.h;
        if (cn.h > maxH) maxH = cn.h;
      }
      if (!ok || maxH - minH > 9) continue;
      const y0 = Math.max(SEA + 2, minH);
      found = { wx, y0, wz, cx, cz };
      break;
    }
    if (this._pyramidCache.size > 1000) this._pyramidCache.clear();
    this._pyramidCache.set(key, found);
    return found;
  },

  buildDesertPyramid(world, ch, p) {
    const { wx: cx0, y0, wz: cz0 } = p;
    const { x0, z0, set, fillDown } = this.makeSetter(ch);
    // Quick AABB reject against chunk [x0..x0+15, z0..z0+15]
    if (x0 + 15 < cx0 - 11 || x0 > cx0 + 11 || z0 + 15 < cz0 - 11 || z0 > cz0 + 11) return;
    ch.hasSurfaceStructure = true;

    const SANDSTONE = 17, CHISELED = 170, CUT = 171, SMOOTH = 172, SLAB = 173, STAIRS = 174;
    const ORANGE = 175, BLUE = 176, TNT_ID = 26, PLATE = 124, CHEST = 52;

    // 1. Foundation under 21x21 footprint + clear interior/above air
    for (let dz = -10; dz <= 10; dz++) {
      for (let dx = -10; dx <= 10; dx++) {
        const X = cx0 + dx, Z = cz0 + dz;
        fillDown(X, y0 - 1, Z, SANDSTONE, 0);
        // Clear sand dunes inside/above the pyramid
        for (let dy = 0; dy <= 14; dy++) set(X, y0 + dy, Z, AIR, 0, true);
        // Base floor at dy = 0
        set(X, y0, Z, SANDSTONE, 0, true);
      }
    }

    // 2. Floor Wind-Rose Terracotta Pattern (dx, dz in -4..4)
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) {
        const ax = Math.abs(dx), az = Math.abs(dz);
        let id = SANDSTONE;
        if (ax === 0 && az === 0) id = BLUE;
        else if ((ax === 1 && az === 0) || (ax === 0 && az === 1)) id = ORANGE;
        else if (ax === 2 && az === 2) id = ORANGE;
        else if ((ax === 3 && az <= 1) || (az === 3 && ax <= 1)) id = (ax === 3 && az === 0) || (az === 3 && ax === 0) ? SANDSTONE : ORANGE;
        else if ((ax === 4 && az === 0) || (az === 4 && ax === 0)) id = ORANGE;
        set(cx0 + dx, y0, cz0 + dz, id, 0, true);
      }
    }

    // 3. Stepped Pyramid Shell (dy = 1..10)
    for (let dy = 1; dy <= 10; dy++) {
      const r = 10 - (dy - 1); // 10 at dy=1 .. 1 at dy=10
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const onOuter = Math.abs(dx) === r || Math.abs(dz) === r;
          if (dy === 10) {
            // Top cap with 1x1 skylight window at (0, 0)
            if (dx === 0 && dz === 0) set(cx0, y0 + 10, cz0, AIR, 0, true);
            else {
              set(cx0 + dx, y0 + 10, cz0 + dz, SMOOTH, 0, true);
              set(cx0 + dx, y0 + 11, cz0 + dz, SLAB, 0, true);
            }
          } else if (onOuter) {
            const isCorner = Math.abs(dx) === r && Math.abs(dz) === r;
            set(cx0 + dx, y0 + dy, cz0 + dz, isCorner ? CUT : SANDSTONE, 0, true);
          }
        }
      }
    }

    // 4. Interior Pillars & Upper Gallery (dy = 1..5)
    for (const [px, pz] of [[-3, -3], [3, -3], [-3, 3], [3, 3], [-5, 0], [5, 0], [0, -5]]) {
      for (let dy = 1; dy <= 4; dy++) {
        set(cx0 + px, y0 + dy, cz0 + pz, dy === 2 || dy === 3 ? CHISELED : CUT, 0, true);
      }
    }
    // Upper walkway gallery at dy = 5
    for (let dz = -5; dz <= 5; dz++) {
      for (let dx = -5; dx <= 5; dx++) {
        const ax = Math.abs(dx), az = Math.abs(dz);
        if (ax <= 2 && az <= 2) {
          if (ax === 2 || az === 2) set(cx0 + dx, y0 + 5, cz0 + dz, SLAB, 0, true);
        } else {
          set(cx0 + dx, y0 + 5, cz0 + dz, SMOOTH, 0, true);
        }
      }
    }

    // 5. Twin Front Towers on South side (dz = 6..10, dx = -10..-6 and dx = 6..10, dy = 1..12)
    for (const tx0 of [-8, 8]) {
      for (let dy = 1; dy <= 11; dy++) {
        for (let dz = 6; dz <= 10; dz++) {
          for (let dx = tx0 - 2; dx <= tx0 + 2; dx++) {
            const wall = dx === tx0 - 2 || dx === tx0 + 2 || dz === 6 || dz === 10;
            if (dy === 11) {
              set(cx0 + dx, y0 + dy, cz0 + dz, SMOOTH, 0, true);
              if (wall && ((dx + dz) & 1) === 0) set(cx0 + dx, y0 + 12, cz0 + dz, SLAB, 0, true);
            } else if (wall) {
              const corner = (dx === tx0 - 2 || dx === tx0 + 2) && (dz === 6 || dz === 10);
              let bid = corner ? CUT : SANDSTONE;
              // Iconic Orange Terracotta Ankh symbol on front facade (dz === 10)
              if (dz === 10) {
                const lx = dx - tx0;
                if ((dy >= 3 && dy <= 5 && lx === 0) ||
                    (dy === 6 && Math.abs(lx) <= 1) ||
                    ((dy === 7 || dy === 8) && Math.abs(lx) === 1) ||
                    (dy === 9 && lx === 0)) {
                  bid = ORANGE;
                } else if (dy === 7 && lx === 0) {
                  bid = CHISELED;
                } else if (dy === 2 || dy === 10) {
                  bid = CHISELED;
                }
              }
              set(cx0 + dx, y0 + dy, cz0 + dz, bid, 0, true);
            } else {
              set(cx0 + dx, y0 + dy, cz0 + dz, AIR, 0, true);
            }
          }
        }
      }
      // Doorway connecting tower base to main hall at dz = 6, dx = tx0, dy = 1..2
      set(cx0 + tx0, y0 + 1, cz0 + 6, AIR, 0, true);
      set(cx0 + tx0, y0 + 2, cz0 + 6, AIR, 0, true);
      // Internal stairs up the tower (dy = 1..5)
      set(cx0 + tx0 - 1, y0 + 1, cz0 + 9, STAIRS, 1, true);
      set(cx0 + tx0 - 1, y0 + 2, cz0 + 8, STAIRS, 3, true);
      set(cx0 + tx0, y0 + 3, cz0 + 7, STAIRS, 0, true);
      set(cx0 + tx0 + 1, y0 + 4, cz0 + 8, STAIRS, 2, true);
      set(cx0 + tx0 + 1, y0 + 5, cz0 + 9, SMOOTH, 0, true);
      // Upper doorway from tower to gallery at dy = 6..7
      set(cx0 + tx0, y0 + 6, cz0 + 6, AIR, 0, true);
      set(cx0 + tx0, y0 + 7, cz0 + 6, AIR, 0, true);
    }

    // 6. Front Entrance Portal (dx = -2..2, dz = 7..10, dy = 1..5)
    for (let dy = 1; dy <= 5; dy++) {
      for (let dz = 7; dz <= 10; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const wall = Math.abs(dx) === 2 || dz === 10 || dy === 5;
          if (wall) {
            let bid = (Math.abs(dx) === 2 && dz === 10) ? CUT : SANDSTONE;
            if (dz === 10 && dy === 4 && Math.abs(dx) <= 1) bid = ORANGE;
            if (dz === 10 && dy === 3 && Math.abs(dx) === 1) bid = CHISELED;
            set(cx0 + dx, y0 + dy, cz0 + dz, bid, 0, true);
          } else {
            set(cx0 + dx, y0 + dy, cz0 + dz, AIR, 0, true);
          }
        }
      }
    }
    // Carve front entrance doorway (dx = -1..1, dz = 5..10, dy = 1..3)
    for (let dz = 5; dz <= 10; dz++) {
      for (let dy = 1; dy <= 3; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dz === 10 && (Math.abs(dx) === 1 && dy === 3)) continue;
          set(cx0 + dx, y0 + dy, cz0 + dz, AIR, 0, true);
        }
      }
    }
    // Side upper entrances at dy = 6..7 (dx = +-5, dz = 0)
    for (const sx of [-5, -4, 4, 5]) {
      set(cx0 + sx, y0 + 6, cz0, AIR, 0, true);
      set(cx0 + sx, y0 + 7, cz0, AIR, 0, true);
    }

    // 7. Hidden Underground Treasure Room & TNT Trap (dy = -13 .. -1)
    for (let dy = -13; dy <= -1; dy++) {
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          const ax = Math.abs(dx), az = Math.abs(dz);
          const X = cx0 + dx, Y = y0 + dy, Z = cz0 + dz;
          if (dy === -13) {
            set(X, Y, Z, SANDSTONE, 0, true);
          } else if (dy === -12) {
            // 3x3 TNT grid directly beneath the chamber floor
            set(X, Y, Z, (ax <= 1 && az <= 1) ? TNT_ID : SANDSTONE, 0, true);
          } else if (dy === -11) {
            set(X, Y, Z, (ax <= 2 && az <= 2) ? CUT : SANDSTONE, 0, true);
          } else {
            // Vertical shaft (-1..1, -1..1) + 4 chest alcoves at dy = -10..-9
            const inShaft = ax <= 1 && az <= 1;
            const inAlcove = (dy === -10 || dy === -9) && ((ax === 2 && az === 0) || (az === 2 && ax === 0));
            if (inShaft || inAlcove) {
              set(X, Y, Z, AIR, 0, true);
            } else if (ax <= 3 && az <= 3) {
              set(X, Y, Z, (dy % 3 === 0) ? CHISELED : CUT, 0, true);
            }
          }
        }
      }
    }
    // Stone pressure plate in the center of the treasure chamber floor (0, -10, 0)
    set(cx0, y0 - 10, cz0, PLATE, 0, true);
    // 4 Loot Chests in the 4 cardinal alcoves (lootType = 1 -> bits 4..5 = 16)
    const PYR_LOOT = 8 | (1 << 4);
    set(cx0, y0 - 10, cz0 - 2, CHEST, 5 | PYR_LOOT, true); // North chest facing South (+z = 5)
    set(cx0, y0 - 10, cz0 + 2, CHEST, 4 | PYR_LOOT, true); // South chest facing North (-z = 4)
    set(cx0 - 2, y0 - 10, cz0, CHEST, 1 | PYR_LOOT, true); // West chest facing East (+x = 1)
    set(cx0 + 2, y0 - 10, cz0, CHEST, 0 | PYR_LOOT, true); // East chest facing West (-x = 0)
  },

  // =========================================================================
  // 2. MINESHAFT (废弃矿井) — Underground branching corridors, rails, cobwebs
  // =========================================================================
  mineshaftInRegion(world, rx, rz) {
    const key = `${ world.seed }:${ rx }:${ rz }`;
    if (this._mineshaftCache.has(key)) return this._mineshaftCache.get(key);
    const r = RNG(hashStr('mineshaft_reg:' + key));
    const REG = 7; // 7x7 chunks per mineshaft region
    const cx = rx * REG + 2 + r.int(REG - 4);
    const cz = rz * REG + 2 + r.int(REG - 4);
    // Avoid (0,0) chunk per Minecraft Wiki trivia, or shift by 1
    const ocx = (cx === 0 && cz === 0) ? 1 : cx;
    const ocz = cz;
    const wx = ocx * 16 + 8, wz = ocz * 16 + 8;
    const c0 = world.column(wx, wz);
    const maxY = Math.max(24, Math.min(42, c0.h - 16));
    const wy = 16 + r.int(Math.max(1, maxY - 16));

    const pieces = [];
    // 1. Central 9x5x9 Parlor Room
    pieces.push({ type: 'room', x: wx, y: wy, z: wz, r: 4, h: 4 });

    // 2. Branching corridors in 4 directions (0: -z North, 1: +x East, 2: +z South, 3: -x West)
    const DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0];
    for (let dir = 0; dir < 4; dir++) {
      if (dir > 1 && r() < 0.2) continue; // 3 to 4 main exits
      const len1 = 16 + r.int(12); // 16..27 blocks
      const sx = wx + DX[dir] * 5, sz = wz + DZ[dir] * 5;
      pieces.push({
        type: 'corridor', x: sx, y: wy, z: sz, dir, len: len1,
        seed: r.int(1 << 30), hasChest: r() < 0.65, spawner: false
      });

      // Crossing or turn at end of primary corridor
      const ex = sx + DX[dir] * len1, ez = sz + DZ[dir] * len1;
      if (r() < 0.6) {
        pieces.push({ type: 'crossing', x: ex, y: wy, z: ez });
      }
      // 1 or 2 perpendicular secondary branches
      for (const turn of [-1, 1]) {
        const forceSpawner = (dir === 0 && turn === 1);
        if (!forceSpawner && r() < 0.35) continue;
        const bdir = (dir + turn + 4) & 3;
        const stepAlong = forceSpawner ? (6 + r.int(5)) : (8 + r.int(Math.max(1, len1 - 10)));
        const bx = sx + DX[dir] * stepAlong + DX[bdir] * 2;
        const bz = sz + DZ[dir] * stepAlong + DZ[bdir] * 2;
        const blen = forceSpawner ? 11 : (12 + r.int(12));
        const isSpawner = forceSpawner || r() < 0.25;
        pieces.push({
          type: 'corridor', x: bx, y: wy, z: bz, dir: bdir, len: blen,
          seed: r.int(1 << 30), hasChest: r() < 0.55, spawner: isSpawner
        });
      }
    }

    const plan = { wx, wy, wz, cx: ocx, cz: ocz, pieces };
    if (this._mineshaftCache.size > 1000) this._mineshaftCache.clear();
    this._mineshaftCache.set(key, plan);
    return plan;
  },

  buildMineshaft(world, ch, plan) {
    const { x0, z0, set, get, fillDown } = this.makeSetter(ch);
    const { wx: mx0, wz: mz0, pieces } = plan;
    if (x0 + 15 < mx0 - 44 || x0 > mx0 + 44 || z0 + 15 < mz0 - 44 || z0 > mz0 + 44) return;

    const PLANKS = 5, LOG = 14, FENCE = 179, TORCH = 21, COBWEB = 177, RAIL = 178, CHEST = 52, SPAWNER = 182;
    const MINE_LOOT = 8 | (2 << 4);
    const DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0];

    for (const p of pieces) {
      if (p.type === 'room') {
        const R = p.r;
        if (x0 + 15 < p.x - R - 1 || x0 > p.x + R + 1 || z0 + 15 < p.z - R - 1 || z0 > p.z + R + 1) continue;
        for (let dz = -R - 1; dz <= R + 1; dz++) {
          for (let dx = -R - 1; dx <= R + 1; dx++) {
            const X = p.x + dx, Z = p.z + dz;
            const onWall = Math.abs(dx) === R + 1 || Math.abs(dz) === R + 1;
            if (onWall) {
              // Seal any water/lava on walls
              for (let dy = 0; dy <= p.h; dy++) {
                const cur = get(X, p.y + dy, Z);
                if (cur === WATER || cur === LAVA) set(X, p.y + dy, Z, 1, 0, false);
              }
              continue;
            }
            // Dirt floor in central parlor
            set(X, p.y - 1, Z, 3, 0, false);
            fillDown(X, p.y - 2, Z, PLANKS, 0);
            const archH = (Math.abs(dx) === R || Math.abs(dz) === R) ? p.h - 1 : p.h;
            for (let dy = 0; dy <= archH; dy++) set(X, p.y + dy, Z, AIR, 0, false);
            // Corner oak log pillars
            if (Math.abs(dx) === R && Math.abs(dz) === R) {
              for (let dy = 0; dy <= p.h - 1; dy++) set(X, p.y + dy, Z, LOG, 0, false);
            }
          }
        }
        // Torches in central room
        set(p.x - R + 1, p.y + 1, p.z - R + 1, TORCH, 0, false);
        set(p.x + R - 1, p.y + 1, p.z + R - 1, TORCH, 0, false);
      } else if (p.type === 'crossing') {
        const R = 2;
        if (x0 + 15 < p.x - R || x0 > p.x + R || z0 + 15 < p.z - R || z0 > p.z + R) continue;
        for (let dz = -R; dz <= R; dz++) {
          for (let dx = -R; dx <= R; dx++) {
            const X = p.x + dx, Z = p.z + dz;
            const curFloor = get(X, p.y - 1, Z);
            if (curFloor === 0 || curFloor === WATER || curFloor === LAVA) set(X, p.y - 1, Z, PLANKS, 0, false);
            for (let dy = 0; dy <= 4; dy++) set(X, p.y + dy, Z, AIR, 0, false);
            // 4 wooden support columns at (+-1, +-1)
            if (Math.abs(dx) === 1 && Math.abs(dz) === 1) {
              for (let dy = 0; dy <= 4; dy++) set(X, p.y + dy, Z, PLANKS, 0, false);
            } else if (Math.abs(dx) <= 1 || Math.abs(dz) <= 1) {
              // Second floor walkway planks at dy = 3
              if (Math.abs(dx) === 2 || Math.abs(dz) === 2) set(X, p.y + 3, Z, PLANKS, 0, false);
            }
          }
        }
      } else if (p.type === 'corridor') {
        const dx = DX[p.dir], dz = DZ[p.dir];
        const px = -dz, pz = dx; // perpendicular unit vector
        const minX = Math.min(p.x, p.x + dx * p.len) - 2;
        const maxX = Math.max(p.x, p.x + dx * p.len) + 2;
        const minZ = Math.min(p.z, p.z + dz * p.len) - 2;
        const maxZ = Math.max(p.z, p.z + dz * p.len) + 2;
        if (x0 + 15 < minX || x0 > maxX || z0 + 15 < minZ || z0 > maxZ) continue;

        const r = RNG(p.seed);
        const railMeta = (dx !== 0) ? 1 : 0; // 1 = East-West, 0 = North-South
        const chestStep = p.hasChest ? (4 + r.int(Math.max(1, p.len - 7))) : -1;
        const spawnerStep = p.spawner ? Math.floor(p.len / 2) : -1;

        for (let s = 0; s < p.len; s++) {
          const cx = p.x + dx * s, cz = p.z + dz * s;
          const isSupport = (s % 4 === 1);

          // 1. Seal adjacent water/lava in 1-block shell around 3x3 corridor
          for (let w = -2; w <= 2; w++) {
            for (let dy = -1; dy <= 3; dy++) {
              if (Math.abs(w) <= 1 && dy >= 0 && dy <= 2) continue;
              const wx = cx + px * w, wz = cz + pz * w, wy = p.y + dy;
              const cur = get(wx, wy, wz);
              if (cur === WATER || cur === LAVA) set(wx, wy, wz, 1, 0, false);
            }
          }

          // 2. Carve 3x3 corridor & lay wooden bridge over caves
          for (let w = -1; w <= 1; w++) {
            const wx = cx + px * w, wz = cz + pz * w;
            const fl = get(wx, p.y - 1, wz);
            if (fl === 0 || fl === WATER || fl === LAVA || !SOLIDCUBE[fl]) {
              set(wx, p.y - 1, wz, PLANKS, 0, false);
              if (isSupport && w === 0) fillDown(wx, p.y - 2, wz, LOG, 0);
            }
            for (let dy = 0; dy <= 2; dy++) {
              set(wx, p.y + dy, wz, AIR, 0, false);
            }
          }

          // 3. Wooden support arches every 4 blocks (Oak Fence posts + Oak Planks beam)
          if (isSupport) {
            for (let dy = 0; dy <= 1; dy++) {
              set(cx - px, p.y + dy, cz - pz, FENCE, 0, false);
              set(cx + px, p.y + dy, cz + pz, FENCE, 0, false);
            }
            for (let w = -1; w <= 1; w++) {
              if (w === 0 && r() < 0.15) continue; // occasional weathered gap in beam
              set(cx + px * w, p.y + 2, cz + pz * w, PLANKS, 0, false);
            }
            // Torch mounted on the side of the oak support pillar
            if (r() < 0.55) {
              const tMeta = dx !== 0 ? (dx > 0 ? 6 : 1) : (dz > 0 ? 4 : 5);
              if (s + 1 < p.len) set(cx - px + dx, p.y + 2, cz - pz + dz, TORCH, tMeta, false);
            }
          } else {
            // Cobwebs in upper corners (connected to ceiling/walls or spawner area)
            const webChance = (p.spawner && Math.abs(s - spawnerStep) <= 3) ? 0.55 : 0.14;
            for (const w of [-1, 1]) {
              if (r() < webChance) {
                const wy = (r() < 0.65) ? p.y + 2 : p.y + 1;
                set(cx + px * w, wy, cz + pz * w, COBWEB, 0, false);
              }
            }
            if (p.spawner && Math.abs(s - spawnerStep) <= 2 && r() < 0.45) {
              set(cx, p.y + 2, cz, COBWEB, 0, false);
            }
          }

          // 4. Incomplete Rail line down the center (w = 0, dy = 0)
          if (r() < 0.72 && s !== spawnerStep) {
            set(cx, p.y, cz, RAIL, railMeta, false);
          }

          // 5. Cave Spider Spawner & Loot Chests
          if (s === spawnerStep) {
            set(cx, p.y, cz, SPAWNER, 0, false);
            set(cx - px, p.y, cz - pz, COBWEB, 0, false);
            set(cx + px, p.y, cz + pz, COBWEB, 0, false);
            set(cx, p.y + 1, cz, COBWEB, 0, false);
          } else if (s === chestStep) {
            const side = r() < 0.5 ? -1 : 1;
            const cFace = px !== 0 ? (side < 0 ? 1 : 0) : (side < 0 ? 5 : 4);
            set(cx + px * side, p.y, cz + pz * side, CHEST, cFace | MINE_LOOT, false);
          }
        }
      }
    }
  },

  // =========================================================================
  // 3. VILLAGE (村庄) — Plains, Desert, and Snowy/Taiga biome-styled villages
  // =========================================================================
  villageInRegion(world, rx, rz) {
    const key = `${ world.seed }:${ rx }:${ rz }`;
    if (this._villageCache.has(key)) return this._villageCache.get(key);
    const r = RNG(hashStr('village_reg:' + key));
    const REG = 16; // 16x16 chunks per village region (vanilla-like spacing)
    let found = null;
    const allowRegion = (rx === 0 && rz === 0) || r() < 0.60;

    // Region (0,0) probes extra candidates near spawn so a village is always easy to reach
    const maxAttempts = !allowRegion ? 0 : ((rx === 0 && rz === 0) ? 32 : 12);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const cx = (rx === 0 && rz === 0 && attempt < 12)
        ? (-4 + r.int(9))
        : (rx * REG + 2 + r.int(REG - 4));
      const cz = (rx === 0 && rz === 0 && attempt < 12)
        ? (-4 + r.int(9))
        : (rz * REG + 2 + r.int(REG - 4));
      const wx = cx * 16 + 8, wz = cz * 16 + 8;
      const c0 = world.column(wx, wz);
      const bi = world.biomeOf(c0);
      if (c0.h <= SEA + 1 || c0.h > 88) continue;
      const validBiome = bi === BI.PLAINS || bi === BI.DESERT || bi === BI.SNOWY || bi === BI.TAIGA ||
                         (rx === 0 && rz === 0 && attempt >= 10 && (bi === BI.FOREST || bi === BI.BIRCH));
      if (!validBiome) continue;

      // Ensure village never overlaps a Desert Pyramid within 64 blocks
      const prx = Math.floor(cx / 18), prz = Math.floor(cz / 18);
      let nearPyr = false;
      for (let pdz = -1; pdz <= 1; pdz++) for (let pdx = -1; pdx <= 1; pdx++) {
        const pyr = this.pyramidInRegion(world, prx + pdx, prz + pdz);
        if (pyr && Math.hypot(pyr.wx - wx, pyr.wz - wz) < 64) nearPyr = true;
      }
      if (nearPyr) continue;

      // Check slope around village center
      let minH = c0.h, maxH = c0.h;
      for (const [dx, dz] of [[-12, 0], [12, 0], [0, -12], [0, 12]]) {
        const cn = world.column(wx + dx, wz + dz);
        if (cn.h < minH) minH = cn.h;
        if (cn.h > maxH) maxH = cn.h;
      }
      if (minH <= SEA - 2 || maxH - minH > 10) continue;

      const style = bi === BI.DESERT ? 'desert' : (bi === BI.SNOWY || bi === BI.TAIGA ? 'snowy' : 'plains');
      const roadLenN = 24 + r.int(8), roadLenS = 24 + r.int(8);
      const roadLenW = 24 + r.int(8), roadLenE = 24 + r.int(8);

      // Place buildings along the 4 cardinal roads outside the central well plaza
      // Each building has { kind, x, z, dir } where dir is the direction it faces (0 N, 1 E, 2 S, 3 W)
      const buildings = [
        // North & South of the East-West road
        { kind: 'smithy', x: wx - 16, z: wz - 9, dir: 2 },
        { kind: 'library', x: wx + 10, z: wz - 9, dir: 2 },
        { kind: 'house_med', x: wx - 16, z: wz + 5, dir: 0 },
        { kind: 'farm', x: wx + 10, z: wz + 5, dir: 0 },
        // East & West of the North-South road
        { kind: 'temple', x: wx + 5, z: wz - 20, dir: 3 },
        { kind: 'house_small', x: wx - 10, z: wz - 19, dir: 1 },
        { kind: 'house_small', x: wx - 10, z: wz + 14, dir: 1 },
        { kind: 'hay_pen', x: wx + 5, z: wz + 14, dir: 3 },
      ];

      // Filter out any building whose center is underwater
      const validBlds = [];
      for (const b of buildings) {
        const bc = world.column(b.x + 3, b.z + 3);
        if (bc.h >= SEA && bc.h <= 94) {
          b.y = Math.max(SEA + 1, bc.h);
          validBlds.push(b);
        }
      }

      found = {
        wx, wy: c0.h, wz, cx, cz, style,
        roads: [
          { x0: wx - 1, z0: wz - roadLenN, x1: wx + 1, z1: wz + roadLenS },
          { x0: wx - roadLenW, z0: wz - 1, x1: wx + roadLenE, z1: wz + 1 },
        ],
        buildings: validBlds,
      };
      break;
    }

    if (this._villageCache.size > 1000) this._villageCache.clear();
    this._villageCache.set(key, found);
    return found;
  },

  // Biome material palette for Village styles (Plains, Desert, Snowy/Taiga)
  villagePalette(style) {
    if (style === 'desert') {
      return {
        log: 171,       // cut_sandstone
        planks: 172,    // smooth_sandstone
        cobble: 17,     // sandstone
        roofStair: 174, // sandstone_stairs
        roofSlab: 173,  // sandstone_slab
        fence: 179,     // oak_fence
        path: 172,      // smooth_sandstone road (per Minecraft Wiki)
        bridge: 172,    // smooth_sandstone bridge
        ground: 9,      // sand foundation
        accent: 175,    // orange_terracotta
        chiseled: 170,  // chiseled_sandstone
        flatRoof: true,
      };
    }
    if (style === 'snowy') {
      return {
        log: 49,        // spruce_log
        planks: 51,     // spruce_planks
        cobble: 4,      // cobblestone
        roofStair: 115, // spruce_stairs
        roofSlab: 184,  // spruce_slab
        fence: 180,     // spruce_fence
        path: 181,      // dirt_path
        bridge: 51,     // spruce_planks bridge over water
        ground: 3,      // dirt foundation
        accent: 96,     // packed_ice
        chiseled: 23,   // stone_bricks
        flatRoof: false,
      };
    }
    return {
      log: 14,          // oak_log
      planks: 5,        // oak_planks
      cobble: 4,        // cobblestone
      roofStair: 60,    // oak_stairs
      roofSlab: 58,     // oak_slab
      fence: 179,       // oak_fence
      path: 181,        // dirt_path
      bridge: 5,        // oak_planks bridge over water
      ground: 3,        // dirt foundation
      accent: 87,       // hay_block
      chiseled: 90,     // polished_andesite
      flatRoof: false,
    };
  },

  buildVillage(world, ch, v) {
    const { x0, z0, set, get, fillDown } = this.makeSetter(ch);
    const { wx: vx, wy: vy, wz: vz, style, roads, buildings } = v;
    if (x0 + 15 < vx - 38 || x0 > vx + 38 || z0 + 15 < vz - 38 || z0 > vz + 38) return;
    ch.hasSurfaceStructure = true;
    const P = this.villagePalette(style);
    const VIL_LOOT = 8 | (3 << 4);

    // 1. Terrain-following Village Roads & Wooden Bridges over water
    for (const rd of roads) {
      const rx0 = Math.max(x0, rd.x0), rx1 = Math.min(x0 + 15, rd.x1);
      const rz0 = Math.max(z0, rd.z0), rz1 = Math.min(z0 + 15, rd.z1);
      for (let wz = rz0; wz <= rz1; wz++) {
        for (let wx = rx0; wx <= rx1; wx++) {
          // Skip central 6x6 well footprint
          if (wx >= vx - 3 && wx <= vx + 2 && wz >= vz - 3 && wz <= vz + 2) continue;
          const col = world.column(wx, wz);
          if (col.h < SEA) {
            // Water crossing -> build plank/sandstone bridge at SEA level
            set(wx, SEA, wz, P.bridge, 0, true);
            for (let dy = 1; dy <= 3; dy++) set(wx, SEA + dy, wz, AIR, 0, true);
          } else {
            const h = col.h;
            set(wx, h, wz, P.path, 0, true);
            set(wx, h - 1, wz, P.ground, 0, true);
            for (let dy = 1; dy <= 3; dy++) set(wx, h + dy, wz, AIR, 0, true);
          }
        }
      }
    }

    // 2. Central Meeting Point: Village Well + Gathering Bell + Plaza
    for (let dz = -4; dz <= 3; dz++) {
      for (let dx = -4; dx <= 3; dx++) {
        const X = vx + dx, Z = vz + dz;
        fillDown(X, vy - 1, Z, P.cobble, 0);
        for (let dy = 1; dy <= 6; dy++) set(X, vy + dy, Z, AIR, 0, true);
        const inWater = dx >= -1 && dx <= 0 && dz >= -1 && dz <= 0;
        const onRim = dx >= -2 && dx <= 1 && dz >= -2 && dz <= 1 && !inWater;
        if (inWater) {
          for (let dy = -4; dy <= 0; dy++) set(X, vy + dy, Z, dy === -4 ? P.cobble : WATER, 0, true);
        } else if (onRim) {
          for (let dy = -4; dy <= 1; dy++) set(X, vy + dy, Z, P.cobble, 0, true);
          // 4 corner fence posts & roof canopy
          if ((dx === -2 || dx === 1) && (dz === -2 || dz === 1)) {
            set(X, vy + 2, Z, P.fence, 0, true);
            set(X, vy + 3, Z, P.fence, 0, true);
          }
          set(X, vy + 4, Z, P.roofSlab, 0, true);
        } else {
          set(X, vy, Z, style === 'desert' ? P.path : 10, 0, true); // gravel/sandstone plaza
        }
      }
    }
    for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) {
      set(vx + dx, vy + 4, vz + dz, P.planks, 0, true);
    }
    // Village Gathering Bell next to well
    set(vx + 3, vy + 1, vz - 3, P.fence, 0, true);
    set(vx + 3, vy + 2, vz - 3, 183, 0, true); // Bell (ID 183)

    // 3. Street Lamp Posts along the roads
    for (const [lx, lz] of [
      [vx - 4, vz + 3], [vx + 3, vz + 3], [vx - 4, vz - 4],
      [vx - 14, vz - 2], [vx + 14, vz - 2], [vx - 2, vz - 14], [vx - 2, vz + 14]
    ]) {
      const lc = world.column(lx, lz);
      if (lc.h < SEA) continue;
      const ly = lc.h;
      fillDown(lx, ly, lz, P.cobble, 0);
      set(lx, ly + 1, lz, P.fence, 0, true);
      set(lx, ly + 2, lz, P.fence, 0, true);
      set(lx, ly + 3, lz, P.fence, 0, true);
      set(lx, ly + 4, lz, 27, 0, true); // glowstone lamp head
      set(lx, ly + 5, lz, P.roofSlab, 0, true);
    }

    // 4. Village Buildings
    for (const b of buildings) {
      this.buildVillagePiece(ch, b, P, style, VIL_LOOT, set, fillDown);
    }
  },

  buildVillagePiece(ch, b, P, style, VIL_LOOT, set, fillDown) {
    const { kind, x: bx, y: by, z: bz, dir } = b;
    // Helper for pitched or desert-flat roofs over a [0..W-1, 0..D-1] footprint at base height H
    const buildRoof = (W, D, H) => {
      if (P.flatRoof) {
        for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
          set(bx + x, by + H, bz + z, P.planks, 0, true);
          const edge = x === 0 || x === W - 1 || z === 0 || z === D - 1;
          if (edge && ((x + z) & 1) === 0) set(bx + x, by + H + 1, bz + z, P.roofSlab, 0, true);
        }
        return;
      }
      // Pitched gable roof along X axis (sloping up from z = -1..D)
      const mid = (D - 1) / 2;
      for (let z = -1; z <= D; z++) {
        const dist = Math.floor(Math.min(z + 1, D - z));
        const ry = by + H + dist;
        const isRidge = Math.abs(z - mid) < 0.6;
        // stair meta: 2 = high side south (+z), 3 = high side north (-z)
        const sMeta = z < mid ? 2 : 3;
        for (let x = -1; x <= W; x++) {
          if (isRidge) {
            set(bx + x, ry, bz + z, P.roofSlab, 0, true);
          } else {
            set(bx + x, ry, bz + z, P.roofStair, sMeta, true);
          }
          // Fill gable triangle on x = 0 and x = W - 1
          if ((x === 0 || x === W - 1) && dist > 0) {
            for (let fy = by + H; fy < ry; fy++) set(bx + x, fy, bz + z, P.planks, 0, true);
          }
        }
      }
    };

    const prepFootprint = (W, D, H, floorId) => {
      for (let z = -1; z <= D; z++) for (let x = -1; x <= W; x++) {
        for (let dy = 1; dy <= H + 4; dy++) set(bx + x, by + dy, bz + z, AIR, 0, true);
        if (x >= 0 && x < W && z >= 0 && z < D) {
          fillDown(bx + x, by - 1, bz + z, P.cobble, 0);
          set(bx + x, by, bz + z, floorId, 0, true);
        }
      }
    };

    if (kind === 'house_small') {
      const W = 5, D = 5, H = 4;
      prepFootprint(W, D, H, P.cobble);
      for (let dy = 1; dy < H; dy++) {
        for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
          const corner = (x === 0 || x === W - 1) && (z === 0 || z === D - 1);
          const wall = x === 0 || x === W - 1 || z === 0 || z === D - 1;
          if (corner) set(bx + x, by + dy, bz + z, P.log, 0, true);
          else if (wall) {
            const isWin = dy === 2 && ((x === 2 && (z === 0 || z === D - 1)) || (z === 2 && x === 0));
            set(bx + x, by + dy, bz + z, isWin ? 16 : (dy === 1 ? P.cobble : P.planks), 0, true);
          }
        }
      }
      // Door on East wall (x = W - 1, z = 2) or South wall
      const dx = dir === 1 ? W - 1 : 2, dz = dir === 1 ? 2 : (dir === 2 ? D - 1 : 0);
      set(bx + dx, by + 1, bz + dz, 69, dir === 1 ? 1 : 2, true);
      set(bx + dx, by + 2, bz + dz, 69, (dir === 1 ? 1 : 2) | 8, true);
      if (dir === 1) set(bx + W, by, bz + 2, P.roofStair, 1, true);
      // Interior: Red Bed (foot + head), Torch, Crafting Table
      set(bx + 1, by + 1, bz + 2, 118, 0, true); // bed foot
      set(bx + 1, by + 1, bz + 1, 118, 4, true); // bed head (north)
      set(bx + 3, by + 1, bz + 1, 19, 0, true);  // crafting table
      set(bx + 1, by + 2, bz + 1, 21, 4, true);  // wall torch attached to solid North wall (z = 0)
      buildRoof(W, D, H);
    } else if (kind === 'house_med') {
      const W = 7, D = 6, H = 4;
      prepFootprint(W, D, H, P.planks);
      for (let dy = 1; dy < H; dy++) {
        for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
          const corner = (x === 0 || x === W - 1) && (z === 0 || z === D - 1);
          const wall = x === 0 || x === W - 1 || z === 0 || z === D - 1;
          if (corner) set(bx + x, by + dy, bz + z, P.log, 0, true);
          else if (wall) {
            const isWin = dy === 2 && ((z === D - 1 && (x === 2 || x === 4)) || (x === 0 && z === 3) || (x === W - 1 && z === 3));
            set(bx + x, by + dy, bz + z, isWin ? 16 : (dy === 1 ? P.cobble : P.planks), 0, true);
          }
        }
      }
      // Door on North wall (x = 3, z = 0)
      set(bx + 3, by + 1, bz, 69, 2, true);
      set(bx + 3, by + 2, bz, 69, 2 | 8, true);
      set(bx + 3, by, bz - 1, P.roofStair, 2, true);
      // Two beds, chest, table
      set(bx + 1, by + 1, bz + 3, 118, 2, true);
      set(bx + 1, by + 1, bz + 4, 118, 2 | 4, true);
      set(bx + 5, by + 1, bz + 3, 118, 2, true);
      set(bx + 5, by + 1, bz + 4, 118, 2 | 4, true);
      set(bx + 5, by + 1, bz + 1, 52, 4 | VIL_LOOT, true); // House loot chest
      set(bx + 1, by + 1, bz + 1, P.fence, 0, true);
      set(bx + 1, by + 2, bz + 1, 169, 0, true); // oak_pressure_plate tabletop
      set(bx + 2, by + 2, bz + 1, 21, 4, true); // wall torch attached to solid North wall (z = 0)
      set(bx + 4, by + 2, bz + 1, 21, 4, true);
      buildRoof(W, D, H);
    } else if (kind === 'library') {
      const W = 8, D = 6, H = 5;
      prepFootprint(W, D, H, P.planks);
      for (let dy = 1; dy < H; dy++) {
        for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
          const corner = (x === 0 || x === W - 1) && (z === 0 || z === D - 1);
          const wall = x === 0 || x === W - 1 || z === 0 || z === D - 1;
          if (corner) set(bx + x, by + dy, bz + z, P.log, 0, true);
          else if (wall) {
            const isWin = (dy === 2 || dy === 3) && ((z === 0 && (x >= 2 && x <= 5)) || (x === 0 && z === 3) || (x === W - 1 && z === 3));
            set(bx + x, by + dy, bz + z, isWin ? 16 : (dy === 1 ? P.cobble : P.planks), 0, true);
          }
        }
      }
      // Door on South wall (x = 2, z = D - 1)
      set(bx + 2, by + 1, bz + D - 1, 69, 3, true);
      set(bx + 2, by + 2, bz + D - 1, 69, 3 | 8, true);
      set(bx + 2, by, bz + D, P.roofStair, 3, true);
      // Bookshelves along North wall (z = 1, x = 1..6, dy = 2..3)
      for (let x = 1; x <= 6; x++) {
        set(bx + x, by + 1, bz + 1, 25, 0, true);
        set(bx + x, by + 2, bz + 1, 25, 0, true);
      }
      set(bx + 6, by + 1, bz + 4, 19, 0, true); // crafting table
      set(bx + 4, by + 1, bz + 3, P.fence, 0, true);
      set(bx + 4, by + 2, bz + 3, 169, 0, true);
      set(bx + 4, by + 3, bz + D - 2, 21, 5, true); // wall torches attached to solid South wall (z = D - 1)
      set(bx + 6, by + 3, bz + D - 2, 21, 5, true);
      buildRoof(W, D, H);
    } else if (kind === 'smithy') {
      // Classic Minecraft Village Blacksmith (9x6x7) with open forge patio, lava basin, furnace & loot chest
      const W = 9, D = 6, H = 4;
      prepFootprint(W, D, H, 4); // cobblestone floor
      // Flat stone-slab roof with cobblestone trim
      for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
        const edge = x === 0 || x === W - 1 || z === 0 || z === D - 1;
        set(bx + x, by + H, bz + z, edge ? 57 : P.planks, 0, true); // smooth_stone_slab rim
      }
      // Left half (x = 0..3): open patio with fence posts, furnace, lava pool, and anvil
      set(bx, by + 1, bz + D - 1, P.fence, 0, true);
      set(bx, by + 2, bz + D - 1, P.fence, 0, true);
      set(bx, by + 3, bz + D - 1, P.fence, 0, true);
      set(bx + 3, by + 1, bz + D - 1, P.fence, 0, true);
      set(bx + 3, by + 2, bz + D - 1, P.fence, 0, true);
      set(bx + 3, by + 3, bz + D - 1, P.fence, 0, true);
      // North wall behind patio (z = 0, x = 0..3): stone bricks + furnaces
      for (let dy = 1; dy < H; dy++) for (let x = 0; x <= 3; x++) {
        set(bx + x, by + dy, bz, 23, 0, true);
      }
      set(bx + 2, by + 1, bz + 1, 20, 5, true); // Furnace facing South
      // Enclosed lava basin at x = 0..1, z = 1..2 (stone bricks surrounding lava so wood never catches fire)
      for (let z = 0; z <= 3; z++) for (let x = 0; x <= 2; x++) {
        set(bx + x, by + 1, bz + z, 23, 0, true);
      }
      set(bx + 1, by + 1, bz + 1, LAVA, 0, true);
      set(bx + 1, by + 1, bz + 2, LAVA, 0, true);
      // Double smooth stone slab anvil bench at (x = 2, z = 4)
      set(bx + 2, by + 1, bz + 4, 57, 2, true);

      // Right half (x = 4..8, z = 0..5): enclosed smithy room with Blacksmith Loot Chest!
      for (let dy = 1; dy < H; dy++) {
        for (let z = 0; z < D; z++) for (let x = 4; x < W; x++) {
          const corner = (x === 4 || x === W - 1) && (z === 0 || z === D - 1);
          const wall = x === 4 || x === W - 1 || z === 0 || z === D - 1;
          if (corner) set(bx + x, by + dy, bz + z, P.log, 0, true);
          else if (wall) {
            const isWin = dy === 2 && ((x === W - 1 && z === 3) || (z === 0 && x === 6));
            set(bx + x, by + dy, bz + z, isWin ? 16 : P.planks, 0, true);
          }
        }
      }
      // Door from patio into smithy room at (x = 4, z = 3)
      set(bx + 4, by + 1, bz + 3, 69, 0, true);
      set(bx + 4, by + 2, bz + 3, 69, 8, true);
      // Blacksmith Loot Chest at (x = 7, z = 1) + Iron Block at (x = 7, z = 4)
      set(bx + 7, by + 1, bz + 1, 52, 5 | VIL_LOOT, true);
      set(bx + 7, by + 1, bz + 4, 29, 0, true); // iron_block
      set(bx + 6, by + 2, bz + D - 2, 21, 5, true); // wall torch attached to solid South wall (z = D - 1)
    } else if (kind === 'temple') {
      // 3-story Village Church / Watchtower (6x9x6)
      const W = 6, D = 6, H = 9;
      prepFootprint(W, D, H, P.cobble);
      for (let dy = 1; dy <= H; dy++) {
        for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
          const corner = (x === 0 || x === W - 1) && (z === 0 || z === D - 1);
          const wall = x === 0 || x === W - 1 || z === 0 || z === D - 1;
          if (dy === H) {
            // Crenellated rooftop battlements
            if (wall && ((x + z) & 1) === 0) set(bx + x, by + dy, bz + z, P.cobble, 0, true);
          } else if (dy === H - 1) {
            if (!(x === W - 2 && z === 1)) set(bx + x, by + dy, bz + z, P.cobble, 0, true);
          } else if (wall) {
            const isWin = (dy === 3 || dy === 6) && ((x === 2 || x === 3) || (z === 2 || z === 3)) && !corner;
            set(bx + x, by + dy, bz + z, isWin ? 147 : (corner ? P.chiseled : P.cobble), 0, true); // yellow_stained_glass windows
          }
        }
      }
      // Door on West wall (x = 0, z = 2)
      set(bx, by + 1, bz + 2, 69, 0, true);
      set(bx, by + 2, bz + 2, 69, 8, true);
      set(bx - 1, by, bz + 2, P.roofStair, 0, true);
      // Ladder up the solid East interior wall column (x = W - 2, z = 1, dy = 1..H-1, meta = 1 attached to +x wall)
      for (let dy = 1; dy < H; dy++) {
        set(bx + W - 2, by + dy, bz + 1, 68, 1, true);
      }
      // Wall torches mounted on solid North (z = 0, meta = 4) and South (z = D - 1, meta = 5) walls
      set(bx + 1, by + 3, bz + 1, 21, 4, true);
      set(bx + 4, by + 3, bz + D - 2, 21, 5, true);
      set(bx + 1, by + 6, bz + 1, 21, 4, true);
      set(bx + 4, by + 6, bz + D - 2, 21, 5, true);
    } else if (kind === 'farm') {
      // Irrigated Village Farm (9x7): log border, central water channel, moist farmland & wheat
      const W = 9, D = 7;
      prepFootprint(W, D, 2, 3);
      for (let z = 0; z < D; z++) {
        for (let x = 0; x < W; x++) {
          const border = x === 0 || x === W - 1 || z === 0 || z === D - 1;
          if (border) {
            set(bx + x, by, bz + z, P.log, 0, true);
          } else if (z === 3) {
            set(bx + x, by - 1, bz + z, 3, 0, true);
            set(bx + x, by, bz + z, WATER, 0, true);
          } else {
            set(bx + x, by, bz + z, 63, 7, true); // moist farmland
            const stage = 5 + ((x + z) % 3);      // mature crop stages 5..7
            const cropId = z < 3 ? (x <= 4 ? 64 : 544) : (x <= 4 ? 545 : (((bx + bz) & 1) ? 544 : 64));
            set(bx + x, by + 1, bz + z, cropId, stage, true);
          }
        }
      }
    } else if (kind === 'hay_pen') {
      // Fenced Animal Pen + Hay Bale / Melon / Pumpkin Pile
      const W = 7, D = 6;
      prepFootprint(W, D, 2, style === 'desert' ? 9 : 2);
      for (let z = 0; z < D; z++) {
        for (let x = 0; x < W; x++) {
          const edge = x === 0 || x === W - 1 || z === 0 || z === D - 1;
          if (edge && !(x === 0 && z === 3)) {
            set(bx + x, by + 1, bz + z, P.fence, 0, true);
          }
        }
      }
      // Corner hay bale stack & water trough
      set(bx + 5, by + 1, bz + 1, P.accent, 0, true);
      set(bx + 5, by + 2, bz + 1, P.accent, 0, true);
      set(bx + 4, by + 1, bz + 1, P.accent, 1, true);
      set(bx + 5, by + 1, bz + 2, P.accent, 2, true);
      set(bx + 1, by, bz + 4, WATER, 0, true);
      set(bx + 2, by, bz + 4, WATER, 0, true);
    }
  },

  // =========================================================================
  // 4. NETHER FORTRESS (下界要塞) — Bridges, Pillars, Wart Staircase & Blaze Spawner
  // =========================================================================
  netherFortressInRegion(world, rx, rz) {
    const key = `${ world.seed }:nether:${ rx }:${ rz }`;
    if (this._fortressCache.has(key)) return this._fortressCache.get(key);
    const r = RNG(hashStr('fortress_reg:' + key));
    const REG = 12; // 12x12 chunks per Nether region
    let found = null;
    if (rx === 0 && rz === 0) {
      // Guarantee a Nether Fortress near origin (cx=2, cz=2 -> wx=40, wz=40)
      found = { wx: 40, wy: 50, wz: 40, cx: 2, cz: 2, seed: r.int(1 << 30) };
    } else if (r() < 0.65) {
      const cx = rx * REG + 3 + r.int(REG - 6);
      const cz = rz * REG + 3 + r.int(REG - 6);
      const wx = cx * 16 + 8, wz = cz * 16 + 8;
      found = { wx, wy: 48 + r.int(7), wz, cx, cz, seed: r.int(1 << 30) };
    }
    if (this._fortressCache.size > 1000) this._fortressCache.clear();
    this._fortressCache.set(key, found);
    return found;
  },

  isInsideNetherFortress(wx, wy, wz, world) {
    if (!world || world.dimension !== 'nether') return false;
    const cx = wx >> 4, cz = wz >> 4;
    const rx0 = Math.floor((cx - 4) / 12), rx1 = Math.floor((cx + 4) / 12);
    const rz0 = Math.floor((cz - 4) / 12), rz1 = Math.floor((cz + 4) / 12);
    for (let rz = rz0; rz <= rz1; rz++) {
      for (let rx = rx0; rx <= rx1; rx++) {
        const f = this.netherFortressInRegion(world, rx, rz);
        if (!f) continue;
        const ax = Math.abs(wx - f.wx), az = Math.abs(wz - f.wz);
        if (wy >= f.wy - 6 && wy <= f.wy + 14 && ((ax <= 9 && az <= 9) || (ax <= 5 && az <= 46) || (az <= 5 && ax <= 46))) {
          return true;
        }
      }
    }
    return false;
  },

  buildNetherFortress(world, ch, f) {
    const { wx: fx, wy, wz: fz } = f;
    const { x0, z0, set, fillDown } = this.makeSetter(ch);
    // Quick AABB reject against [fx-46..fx+46, fz-46..fz+46]
    if (x0 + 15 < fx - 46 || x0 > fx + 46 || z0 + 15 < fz - 46 || z0 > fz + 46) return;
    ch.hasSurfaceStructure = true;

    const NBRICK = 533;   // nether_bricks
    const NFENCE = 534;   // nether_brick_fence
    const NSTAIRS = 535;  // nether_brick_stairs
    const SOUL_SAND = 530;
    const WART = 536;     // nether_wart_crop
    const SPAWNER = 182;  // meta = 1 -> Blaze Spawner
    const CHEST = 52;
    const FORT_LOOT = 8 | (4 << 4); // lootType 4 = Nether Fortress

    // 1. Central Keep & Nether Wart Staircase Hall (fx-7..fx+7, fz-7..fz+7)
    if (!(x0 + 15 < fx - 7 || x0 > fx + 7 || z0 + 15 < fz - 7 || z0 > fz + 7)) {
      for (let dz = -7; dz <= 7; dz++) {
        for (let dx = -7; dx <= 7; dx++) {
          const X = fx + dx, Z = fz + dz;
          const ax = Math.abs(dx), az = Math.abs(dz);
          // 4 massive 3x3 corner support pillars extending down into lava sea / floor
          if (ax >= 5 && az >= 5) {
            fillDown(X, wy - 1, Z, NBRICK, 0);
          }
          // Solid floor & roof
          set(X, wy, Z, NBRICK, 0, true);
          set(X, wy + 7, Z, NBRICK, 0, true);
          for (let dy = 1; dy <= 6; dy++) {
            const onWall = ax === 7 || az === 7;
            const isDoorway = (ax <= 1 && az === 7 && dy <= 4) || (az <= 1 && ax === 7 && dy <= 4);
            const isWindow = onWall && !isDoorway && (dy === 3 || dy === 4) && ((ax === 7 && (az === 3 || az === 4)) || (az === 7 && (ax === 3 || ax === 4)));
            if (onWall && !isDoorway) {
              set(X, wy + dy, Z, isWindow ? NFENCE : NBRICK, 0, true);
            } else {
              set(X, wy + dy, Z, AIR, 0, true);
            }
          }
          // Roof battlements
          if ((ax === 7 || az === 7) && ((dx + dz) & 1) === 0) {
            set(X, wy + 8, Z, NFENCE, 0, true);
          }
        }
      }
      // Soul Sand & Nether Wart Gardens flanking central staircase (dx in -5..-3 and 3..5, dz in -4..2)
      for (const side of [-1, 1]) {
        for (let dz = -4; dz <= 2; dz++) {
          for (let w = 3; w <= 5; w++) {
            const X = fx + side * w, Z = fz + dz;
            set(X, wy + 1, Z, SOUL_SAND, 0, true);
            const stage = (Math.abs(w + dz) % 4); // stages 0..3 (3 = mature)
            set(X, wy + 2, Z, WART, stage, true);
          }
          // Staircase rim holding the soul sand bed (high back side against soul sand: meta 1 for West, meta 0 for East)
          set(fx + side * 2, wy + 1, fz + dz, NSTAIRS, side < 0 ? 1 : 0, true);
        }
      }
      // Central Nether Brick Staircase ascending North (dz = 2..-1) to a raised balcony (dz = -5..-2, dy = 4)
      for (let s = 0; s < 4; s++) {
        const sz = fz + 2 - s, sy = wy + 1 + s;
        for (let dx = -1; dx <= 1; dx++) {
          set(fx + dx, sy, sz, NSTAIRS, 3, true); // ascending toward -Z (North = meta 3)
          for (let fillY = wy + 1; fillY < sy; fillY++) set(fx + dx, fillY, sz, NBRICK, 0, true);
        }
      }
      for (let dz = -5; dz <= -2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(fx + dx, wy + 4, fz + dz, NBRICK, 0, true);
        }
      }
      // 2 Fortress Loot Chests inside the Keep alcoves
      set(fx - 6, wy + 1, fz + 5, CHEST, 1 | FORT_LOOT, true);
      set(fx + 6, wy + 1, fz + 5, CHEST, 0 | FORT_LOOT, true);
    }

    // 2. Four Cardinal Bridges & Corridors (len = 30 blocks from offset 8..37)
    const DIRS4 = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N, E, S, W
    for (let dir = 0; dir < 4; dir++) {
      const [dx, dz] = DIRS4[dir];
      const px = -dz, pz = dx;
      const enclosed = (dir === 1 || dir === 3); // East & West arms have roofed corridor sections
      for (let step = 8; step <= 37; step++) {
        const cx = fx + dx * step, cz = fz + dz * step;
        if (cx + 3 < x0 || cx - 3 > x0 + 15 || cz + 3 < z0 || cz - 3 > z0 + 15) continue;
        const isPier = (step === 14 || step === 24 || step === 34);
        const isRoofed = enclosed && step <= 22;

        for (let w = -2; w <= 2; w++) {
          const X = cx + px * w, Z = cz + pz * w;
          // Deck & under-arch
          set(X, wy, Z, NBRICK, 0, true);
          if (Math.abs(w) <= 1 || isPier) set(X, wy - 1, Z, NBRICK, 0, true);
          if (isPier && Math.abs(w) <= 1) {
            fillDown(X, wy - 2, Z, NBRICK, 0);
          }
          // Clear walkway air
          for (let dy = 1; dy <= 5; dy++) set(X, wy + dy, Z, AIR, 0, true);

          // Side walls / parapets
          if (Math.abs(w) === 2) {
            if (isRoofed) {
              for (let dy = 1; dy <= 4; dy++) {
                const win = (dy === 2 || dy === 3) && (step % 3 === 0);
                set(X, wy + dy, Z, win ? NFENCE : NBRICK, 0, true);
              }
            } else {
              set(X, wy + 1, Z, NBRICK, 0, true);
              if (step % 2 === 0 || isPier) set(X, wy + 2, Z, NFENCE, 0, true);
            }
          }
          if (isRoofed) {
            set(X, wy + 5, Z, NBRICK, 0, true);
          }
        }
        // Corridor loot chest at step 18 on enclosed arms
        if (isRoofed && step === 18) {
          set(cx + px, wy + 1, cz + pz, CHEST, (dir === 1 ? 4 : 5) | FORT_LOOT, true);
        }
      }

      // 3. Blaze Spawner Platforms at the end of North (dir=0) and East (dir=1) bridges (step = 41)
      if (dir === 0 || dir === 1) {
        const sx = fx + dx * 41, sz = fz + dz * 41;
        if (!(x0 + 15 < sx - 4 || x0 > sx + 4 || z0 + 15 < sz - 4 || z0 > sz + 4)) {
          for (let oz = -4; oz <= 4; oz++) {
            for (let ox = -4; ox <= 4; ox++) {
              const X = sx + ox, Z = sz + oz;
              set(X, wy, Z, NBRICK, 0, true);
              set(X, wy + 1, Z, NBRICK, 0, true);
              if (Math.abs(ox) >= 3 && Math.abs(oz) >= 3) {
                fillDown(X, wy - 1, Z, NBRICK, 0);
              }
              for (let dy = 2; dy <= 6; dy++) set(X, wy + dy, Z, AIR, 0, true);
              const edge = Math.abs(ox) === 4 || Math.abs(oz) === 4;
              const entrance = (ox * (-dx) + oz * (-dz)) === 4 && Math.abs(ox * px + oz * pz) <= 1;
              if (edge && !entrance) {
                set(X, wy + 2, Z, NFENCE, 0, true);
                if ((ox + oz) % 2 === 0) set(X, wy + 3, Z, NFENCE, 0, true);
              } else if (entrance) {
                set(X, wy + 1, Z, NSTAIRS, dir === 0 ? 3 : 0, true);
              }
            }
          }
          // Central pedestal + Blaze Spawner (ID 182, meta = 1)
          for (let oz = -1; oz <= 1; oz++) {
            for (let ox = -1; ox <= 1; ox++) {
              set(sx + ox, wy + 1, sz + oz, NBRICK, 0, true);
            }
          }
          set(sx, wy + 2, sz, SPAWNER, 1, true);
        }
      }
    }
  },


  // =========================================================================
  // 5. STRONGHOLD PORTAL ROOM (要塞末地传送门房间) — Weathered Stone Bricks,
  //    Iron Bars, Lava Pools, Silverfish/Skeleton Spawner & 12 End Portal Frames
  // =========================================================================
  strongholdInRegion(world, rx, rz) {
    const key = `${ world.seed }:stronghold:${ rx }:${ rz }`;
    if (this._strongholdCache.has(key)) return this._strongholdCache.get(key);
    const r = RNG(hashStr('stronghold_reg:' + key));
    const REG = 16; // 16x16 chunks per Stronghold region
    let found = null;
    if (rx === 0 && rz === -1) {
      // Primary Stronghold at (cx=10, cz=-10 -> wx=168, wz=-152, wy=28, portalPos=[168, 31, -157])
      const cx = 10, cz = -10;
      const wx = cx * 16 + 8, wz = cz * 16 + 8, wy = 28;
      found = { wx, wy, wz, cx, cz, portalPos: [wx, wy + 3, wz - 5], seed: r.int(1 << 30) };
    } else if ((rx !== 0 || rz !== 0) && r() < 0.55) {
      const cx = rx * REG + 4 + r.int(REG - 8);
      const cz = rz * REG + 4 + r.int(REG - 8);
      const wx = cx * 16 + 8, wz = cz * 16 + 8, wy = 24 + r.int(10);
      found = { wx, wy, wz, cx, cz, portalPos: [wx, wy + 3, wz - 5], seed: r.int(1 << 30) };
    }
    if (this._strongholdCache.size > 1000) this._strongholdCache.clear();
    this._strongholdCache.set(key, found);
    return found;
  },

  buildStronghold(world, ch, s) {
    const { wx: sx, wy: sy, wz: sz } = s;
    const { x0, z0, set } = this.makeSetter(ch);
    // Quick AABB reject against [sx-10..sx+10, sz-12..sz+14]
    if (x0 + 15 < sx - 10 || x0 > sx + 10 || z0 + 15 < sz - 12 || z0 > sz + 14) return;

    const SBRICK = 23;     // stone_bricks
    const CRACKED = 93;    // cracked_stone_bricks
    const MOSSY = 94;      // mossy_stone_bricks
    const SSTAIRS = 62;    // stone_brick_stairs
    const IBARS = 542;     // iron_bars
    const FRAME = 538;     // end_portal_frame
    const SPAWNER = 182;   // monster spawner
    const TORCH = 21;
    const CHEST = 52;
    const STRONGHOLD_LOOT = 8 | (5 << 4); // lootType 5 = Stronghold

    const pickBrick = (wx, wy, wz) => {
      const h = hash3(wx, wy, wz, s.seed);
      return h < 0.20 ? MOSSY : h < 0.35 ? CRACKED : SBRICK;
    };

    // 1. Main Portal Chamber: dx in -7..7, dz in -9..8, dy in 0..8
    for (let dy = 0; dy <= 8; dy++) {
      for (let dz = -9; dz <= 8; dz++) {
        for (let dx = -7; dx <= 7; dx++) {
          const X = sx + dx, Y = sy + dy, Z = sz + dz;
          const onWall = Math.abs(dx) === 7 || dz === -9 || dz === 8;
          const isEntrance = dz === 8 && Math.abs(dx) <= 1 && dy >= 1 && dy <= 4;
          if (dy === 0 || dy === 8) {
            set(X, Y, Z, pickBrick(X, Y, Z), 0, false);
          } else if (onWall && !isEntrance) {
            // Iron bars windows along side walls & back wall
            const isGrate = (dy >= 3 && dy <= 5) && (
              (Math.abs(dx) === 7 && (dz === -5 || dz === -1 || dz === 3)) ||
              (dz === -9 && Math.abs(dx) === 3)
            );
            set(X, Y, Z, isGrate ? IBARS : pickBrick(X, Y, Z), 0, false);
          } else {
            set(X, Y, Z, AIR, 0, false);
          }
        }
      }
    }

    // 2. Two Side Lava Basins (dx in -6..-4 and 4..6, dz in -2..2, dy = 0..1)
    for (const side of [-1, 1]) {
      for (let dz = -3; dz <= 3; dz++) {
        for (let w = 3; w <= 6; w++) {
          const X = sx + side * w, Z = sz + dz;
          const rim = w === 3 || w === 6 || dz === -3 || dz === 3;
          set(X, sy + 1, Z, rim ? pickBrick(X, sy + 1, Z) : LAVA, 0, false);
        }
      }
    }

    // 3. Raised End Portal Platform & 3x3 Sub-Portal Lava Pool (dx in -3..3, dz in -8..-2)
    for (let dz = -8; dz <= -2; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const X = sx + dx, Z = sz + dz;
        const inInner3x3 = Math.abs(dx) <= 1 && dz >= -6 && dz <= -4;
        const onFrameRing = (Math.abs(dx) <= 1 && (dz === -7 || dz === -3)) || (Math.abs(dx) === 2 && dz >= -6 && dz <= -4);
        for (let dy = 1; dy <= 2; dy++) {
          if (inInner3x3) {
            set(X, sy + dy, Z, dy === 1 ? LAVA : AIR, 0, false);
          } else {
            set(X, sy + dy, Z, pickBrick(X, sy + dy, Z), 0, false);
          }
        }
        if (onFrameRing) {
          // Determine inward facing rotation (0=North, 1=East, 2=South, 3=West)
          const rot = dz === -7 ? 2 : dz === -3 ? 0 : dx === -2 ? 1 : 3;
          // Each frame has a deterministic 10% chance of pre-containing an Eye of Ender (meta bit 4)
          const hasEye = hash3(X, sy + 3, Z, s.seed + 911) < 0.10 ? 4 : 0;
          set(X, sy + 3, Z, FRAME, rot | hasEye, false);
        }
      }
    }

    // 4. Staircase leading up to Portal Ring (dx in -1..1, dz = 0..-2) & Spawner at (0, 2, -1)
    for (let dx = -1; dx <= 1; dx++) {
      set(sx + dx, sy + 1, sz, SSTAIRS, 3, false);
      set(sx + dx, sy + 1, sz - 1, pickBrick(sx + dx, sy + 1, sz - 1), 0, false);
      set(sx + dx, sy + 2, sz - 1, SSTAIRS, 3, false);
      set(sx + dx, sy + 2, sz - 2, pickBrick(sx + dx, sy + 2, sz - 2), 0, false);
      set(sx + dx, sy + 3, sz - 2, SSTAIRS, 3, false);
    }
    // Silverfish / Dungeon Spawner embedded in the staircase before the End Portal
    set(sx, sy + 2, sz - 1, SPAWNER, 0, false);

    // 5. Entrance Antechamber, Iron Bar Gate, Loot Chest & Surface Access Stairwell (dz = 8..13)
    for (let dz = 8; dz <= 13; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const X = sx + dx, Z = sz + dz;
        for (let dy = 0; dy <= 5; dy++) {
          const wall = Math.abs(dx) === 3 || dz === 13 || dy === 0 || dy === 5;
          set(X, sy + dy, Z, wall ? pickBrick(X, sy + dy, Z) : AIR, 0, false);
        }
      }
    }
    // Iron bars archway at dz = 8
    for (const dx of [-2, 2]) {
      for (let dy = 1; dy <= 4; dy++) set(sx + dx, sy + dy, sz + 8, IBARS, 0, false);
    }
    // Stronghold Altar Loot Chest inside the Portal Chamber (sx + 5, sy + 1, sz + 6)
    set(sx + 5, sy + 1, sz + 6, pickBrick(sx + 5, sy + 1, sz + 6), 0, false);
    set(sx + 5, sy + 2, sz + 6, CHEST, 4 | STRONGHOLD_LOOT, false);
    // Wall torches illuminating the portal chamber
    set(sx - 6, sy + 4, sz - 5, TORCH, 1, false);
    set(sx + 6, sy + 4, sz - 5, TORCH, 6, false);
    set(sx - 6, sy + 4, sz + 4, TORCH, 1, false);
    set(sx + 6, sy + 4, sz + 4, TORCH, 6, false);

    // Vertical stairwell shaft with ladder from (sx, sy + 1, sz + 11) up to y = 68 so players can climb down/up
    for (let y = sy + 1; y <= 68; y++) {
      for (let oz = -1; oz <= 1; oz++) {
        for (let ox = -1; ox <= 1; ox++) {
          const X = sx + ox, Z = sz + 11 + oz;
          const isShell = Math.abs(ox) === 1 || Math.abs(oz) === 1;
          if (isShell) {
            if (y <= sy + 4 && oz === -1 && ox === 0) set(X, y, Z, AIR, 0, false);
            else set(X, y, Z, pickBrick(X, y, Z), 0, false);
          } else {
            // Central shaft with ladder attached to +Z wall (meta = 5)
            set(X, y, Z, 68, 5, false);
          }
        }
      }
    }
  },

  // =========================================================================
  // Master Chunk Entry Point & /locate Finder
  // =========================================================================
  applyToChunk(world, ch) {
    if (world.flat) return;
    if (!ch.structureMask) ch.structureMask = new Uint8Array(256);

    const cx = ch.cx, cz = ch.cz;

    if (world.dimension === 'end') return;
    if (world.dimension === 'nether') {
      const frx0 = Math.floor((cx - 4) / 12), frx1 = Math.floor((cx + 4) / 12);
      const frz0 = Math.floor((cz - 4) / 12), frz1 = Math.floor((cz + 4) / 12);
      for (let rz = frz0; rz <= frz1; rz++) {
        for (let rx = frx0; rx <= frx1; rx++) {
          const f = this.netherFortressInRegion(world, rx, rz);
          if (f) {
            this.buildNetherFortress(world, ch, f);
            if (f.cx === cx && f.cz === cz) ch.fortress = [f.wx, f.wy + 1, f.wz];
          }
        }
      }
      return;
    }

    // 1. Mineshafts (check 7x7 regions overlapping +-3 chunks around (cx, cz))
    const mrx0 = Math.floor((cx - 3) / 7), mrx1 = Math.floor((cx + 3) / 7);
    const mrz0 = Math.floor((cz - 3) / 7), mrz1 = Math.floor((cz + 3) / 7);
    for (let rz = mrz0; rz <= mrz1; rz++) {
      for (let rx = mrx0; rx <= mrx1; rx++) {
        const plan = this.mineshaftInRegion(world, rx, rz);
        if (plan) {
          this.buildMineshaft(world, ch, plan);
          if (plan.cx === cx && plan.cz === cz) ch.mineshaft = [plan.wx, plan.wy, plan.wz];
        }
      }
    }

    // 2. Desert Pyramids (check 18x18 regions overlapping +-2 chunks around (cx, cz))
    const prx0 = Math.floor((cx - 2) / 18), prx1 = Math.floor((cx + 2) / 18);
    const prz0 = Math.floor((cz - 2) / 18), prz1 = Math.floor((cz + 2) / 18);
    for (let rz = prz0; rz <= prz1; rz++) {
      for (let rx = prx0; rx <= prx1; rx++) {
        const p = this.pyramidInRegion(world, rx, rz);
        if (p) {
          this.buildDesertPyramid(world, ch, p);
          if (p.cx === cx && p.cz === cz) ch.pyramid = [p.wx, p.y0 + 1, p.wz];
        }
      }
    }

    // 3. Villages (check 16x16 regions overlapping +-3 chunks around (cx, cz))
    const vrx0 = Math.floor((cx - 3) / 16), vrx1 = Math.floor((cx + 3) / 16);
    const vrz0 = Math.floor((cz - 3) / 16), vrz1 = Math.floor((cz + 3) / 16);
    for (let rz = vrz0; rz <= vrz1; rz++) {
      for (let rx = vrx0; rx <= vrx1; rx++) {
        const v = this.villageInRegion(world, rx, rz);
        if (v) {
          // Do not overlap if a desert pyramid is right on top of the village center
          this.buildVillage(world, ch, v);
          if (v.cx === cx && v.cz === cz) ch.village = { pos: [v.wx, v.wy + 1, v.wz], style: v.style };
        }
      }
    }

    // 4. Stronghold Portal Rooms (check 16x16 regions overlapping +-2 chunks around (cx, cz))
    const srx0 = Math.floor((cx - 2) / 16), srx1 = Math.floor((cx + 2) / 16);
    const srz0 = Math.floor((cz - 2) / 16), srz1 = Math.floor((cz + 2) / 16);
    for (let rz = srz0; rz <= srz1; rz++) {
      for (let rx = srx0; rx <= srx1; rx++) {
        const s = this.strongholdInRegion(world, rx, rz);
        if (s) {
          this.buildStronghold(world, ch, s);
          if (s.cx === cx && s.cz === cz) ch.stronghold = [...s.portalPos];
        }
      }
    }
  },

  // Find the nearest structure of type ('village' | 'desert_pyramid' | 'mineshaft') around world (px, pz)
  locateNearest(world, type, px, pz) {
    const pcx = px >> 4, pcz = pz >> 4;
    let best = null, bestDist = Infinity;

    if (type === 'village' || type === '村庄') {
      const rx0 = Math.floor(pcx / 16), rz0 = Math.floor(pcz / 16);
      for (let r = 0; r <= 10; r++) {
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const v = this.villageInRegion(world, rx0 + dx, rz0 + dz);
          if (!v) continue;
          const d = Math.hypot(v.wx - px, v.wz - pz);
          if (d < bestDist) {
            bestDist = d;
            best = { type: 'village', cn: '村庄 (' + ({ plains: '平原', desert: '沙漠', snowy: '雪原/针叶林' }[v.style] || '平原') + ')', x: v.wx, y: v.wy + 1, z: v.wz, dist: Math.round(d) };
          }
        }
        if (best && r >= 1) break;
      }
    } else if (type === 'desert_pyramid' || type === 'pyramid' || type === 'temple' || type === '沙漠神殿') {
      const rx0 = Math.floor(pcx / 18), rz0 = Math.floor(pcz / 18);
      for (let r = 0; r <= 12; r++) {
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const p = this.pyramidInRegion(world, rx0 + dx, rz0 + dz);
          if (!p) continue;
          const d = Math.hypot(p.wx - px, p.wz - pz);
          if (d < bestDist) {
            bestDist = d;
            best = { type: 'desert_pyramid', cn: '沙漠神殿', x: p.wx, y: p.y0 + 1, z: p.wz, dist: Math.round(d) };
          }
        }
        if (best && r >= 1) break;
      }
    } else if (type === 'nether_fortress' || type === 'fortress' || type === '下界要塞') {
      const rx0 = Math.floor(pcx / 12), rz0 = Math.floor(pcz / 12);
      for (let r = 0; r <= 6; r++) {
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const f = this.netherFortressInRegion(world, rx0 + dx, rz0 + dz);
          if (!f) continue;
          const d = Math.hypot(f.wx - px, f.wz - pz);
          if (d < bestDist) {
            bestDist = d;
            best = { type: 'nether_fortress', cn: '下界要塞', x: f.wx, y: f.wy + 1, z: f.wz, dist: Math.round(d) };
          }
        }
        if (best && r >= 1) break;
      }
    } else if (type === 'mineshaft' || type === '废弃矿井') {
      const rx0 = Math.floor(pcx / 7), rz0 = Math.floor(pcz / 7);
      for (let r = 0; r <= 6; r++) {
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const m = this.mineshaftInRegion(world, rx0 + dx, rz0 + dz);
          if (!m) continue;
          const d = Math.hypot(m.wx - px, m.wz - pz);
          if (d < bestDist) {
            bestDist = d;
            best = { type: 'mineshaft', cn: '废弃矿井', x: m.wx, y: m.wy, z: m.wz, dist: Math.round(d) };
          }
        }
        if (best && r >= 1) break;
      }
    } else if (type === 'stronghold' || type === 'end_portal' || type === '要塞') {
      const rx0 = Math.floor(pcx / 16), rz0 = Math.floor(pcz / 16);
      for (let r = 0; r <= 6; r++) {
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const s = this.strongholdInRegion(world, rx0 + dx, rz0 + dz);
          if (!s) continue;
          const [tx, ty, tz] = s.portalPos || [s.wx, s.wy + 3, s.wz - 5];
          const d = Math.hypot(tx - px, tz - pz);
          if (d < bestDist) {
            bestDist = d;
            best = { type: 'stronghold', cn: '要塞 (末地传送门)', x: tx, y: ty, z: tz, dist: Math.round(d) };
          }
        }
        if (best && r >= 1) break;
      }
    }
    return best;
  },
};

if (typeof window !== 'undefined') window.Structures = Structures;
