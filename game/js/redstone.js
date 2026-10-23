'use strict';
// ---------------------------------------------------------------------------
// Redstone circuit engine: signal propagation, strong/weak power, scheduled
// component ticks (torches, repeaters, comparators, observers, pistons,
// buttons, pressure plates, lamps, targets) and effector triggers (TNT,
// doors, trapdoors, note blocks).
// ---------------------------------------------------------------------------

var Redstone = window.Redstone = {
  updatingWires: false,
  burnout: new Map(), // key "x,y,z" -> array of world.time timestamps when torch turned off
  _updatingPistons: new Set(),

  // Direction index (0..5) where a torch/redstone_torch is attached
  torchSupportDir(meta) {
    if (!meta) return 2; // attached to block below (y - 1)
    const m = meta & 7;
    return m === 6 ? 0 : m;
  },

  // Output direction (0,1,4,5) for a repeater or comparator with given meta
  repeaterOutDir(meta) {
    return [4, 1, 5, 0][meta & 3];
  },

  // Check if a block at (nx, ny, nz) visually/logically connects to redstone wire along horizontal dir
  wireConnects(id, meta, dir) {
    if (!id) return false;
    if (id === 119 || id === 110 || id === 120 || id === 121 || id === 122 || id === 123 || id === 159 || id === 124 || id === 169 || id === 157 || id === 514) return true;
    if (id === 127 || id === 156) {
      const outDir = this.repeaterOutDir(meta);
      return dir === outDir || dir === OPP[outDir];
    }
    if (id === 515) {
      const backDir = OPP[meta & 7];
      return dir === OPP[backDir];
    }
    return false;
  },

  // Check if redstone_wire at (wx, wy, wz) points horizontally in direction `targetDir` (0, 1, 4, 5)
  wirePointsDir(w, wx, wy, wz, targetDir) {
    if (w.getBlock(wx, wy, wz) !== 119) return false;
    const above = w.getBlock(wx, wy + 1, wz);
    const canClimb = !SOLIDCUBE[above];
    const hasConn = (dir) => {
      const D = DIRS[dir], nx = wx + D[0], nz = wz + D[2];
      const nid = w.getBlock(nx, wy, nz), nm = w.getMeta(nx, wy, nz);
      if (this.wireConnects(nid, nm, dir)) return true;
      if (canClimb && SOLIDCUBE[nid] && w.getBlock(nx, wy + 1, nz) === 119) return true;
      if (!SOLIDCUBE[nid] && w.getBlock(nx, wy - 1, nz) === 119) return true;
      return false;
    };
    // Perpendicular horizontal directions
    const perp = (targetDir === 0 || targetDir === 1) ? [4, 5] : [0, 1];
    if (hasConn(perp[0]) || hasConn(perp[1])) return false;
    return true;
  },

  // Direct signal (0..15) emitted by non-wire component at (x,y,z) toward direction `toDir`
  getComponentSignal(w, x, y, z, toDir) {
    const id = w.getBlock(x, y, z);
    if (!id) return 0;
    const meta = w.getMeta(x, y, z);
    switch (id) {
      case 110: return 15; // redstone_block
      case 120: { // lit redstone_torch: powers all directions except its attachment side
        const sd = this.torchSupportDir(meta);
        return toDir === sd ? 0 : 15;
      }
      case 122: // lever
      case 123: // stone_button
      case 159: // oak_button
        return (meta & 8) ? 15 : 0;
      case 124: // stone_pressure_plate
      case 169: // oak_pressure_plate
        return (meta & 1) ? 15 : 0;
      case 156: // lit_repeater: only outputs forward along outDir
        return toDir === this.repeaterOutDir(meta) ? 15 : 0;
      case 514: // comparator: outputs 0..15 stored in bits 4..7 along outDir
        return toDir === this.repeaterOutDir(meta) ? ((meta >> 4) & 15) : 0;
      case 515: { // observer: outputs 15 at rear (OPP[frontDir]) when pulsing (meta & 8)
        const backDir = OPP[meta & 7];
        return ((meta & 8) && toDir === backDir) ? 15 : 0;
      }
      case 157: // target block
        return meta & 15;
      default:
        return 0;
    }
  },

  // Strong power (0..15) injected into an opaque solid block at (x,y,z) by components
  // (can power adjacent redstone_wire!)
  getStrongPower(w, x, y, z, ignorePos = null) {
    const id = w.getBlock(x, y, z);
    if (!SOLIDCUBE[id] || id === 110) return 0;
    let maxP = 0;
    // 1. Lit redstone torch directly below (y - 1) strongly powers the solid block above it
    if (!(ignorePos && ignorePos[0] === x && ignorePos[1] === y - 1 && ignorePos[2] === z)) {
      if (w.getBlock(x, y - 1, z) === 120) return 15;
    }
    // 2. Active lever/button attached to (x,y,z), pressure plate on top (y + 1), repeater, comparator, or observer pointing into (x,y,z)
    for (let d = 0; d < 6; d++) {
      const D = DIRS[d], nx = x + D[0], ny = y + D[1], nz = z + D[2];
      if (ignorePos && ignorePos[0] === nx && ignorePos[1] === ny && ignorePos[2] === nz) continue;
      const nid = w.getBlock(nx, ny, nz);
      if (!nid) continue;
      const nm = w.getMeta(nx, ny, nz);
      if ((nid === 122 || nid === 123 || nid === 159) && (nm & 8) && (nm & 7) === OPP[d]) return 15;
      if (d === 3 && (nid === 124 || nid === 169) && (nm & 1)) return 15;
      if (nid === 156 && this.repeaterOutDir(nm) === OPP[d]) return 15;
      if (nid === 514 && this.repeaterOutDir(nm) === OPP[d]) {
        const cp = (nm >> 4) & 15;
        if (cp > maxP) maxP = cp;
      }
      if (nid === 515 && (nm & 8) && OPP[nm & 7] === OPP[d]) return 15;
    }
    return maxP;
  },

  // Total power (strong or weak, 0..15) inside a solid block at (x,y,z)
  getSolidBlockPower(w, x, y, z, ignorePos = null) {
    const id = w.getBlock(x, y, z);
    if (!SOLIDCUBE[id]) return 0;
    if (id === 110) return 15;
    let p = this.getStrongPower(w, x, y, z, ignorePos);
    if (p >= 15) return 15;
    // Weak power from redstone_wire on top of (x, y + 1, z)
    if (w.getBlock(x, y + 1, z) === 119) {
      p = Math.max(p, w.getMeta(x, y + 1, z) & 15);
    }
    // Weak power from horizontal redstone_wire pointing into (x, y, z)
    for (const d of [0, 1, 4, 5]) {
      const D = DIRS[d], nx = x + D[0], nz = z + D[2];
      if (w.getBlock(nx, y, nz) === 119) {
        const wp = w.getMeta(nx, y, nz) & 15;
        if (wp > p && this.wirePointsDir(w, nx, y, nz, OPP[d])) p = wp;
      }
    }
    // Weak power from adjacent components (e.g. redstone_block or torch next to solid block)
    for (let d = 0; d < 6; d++) {
      const D = DIRS[d], nx = x + D[0], ny = y + D[1], nz = z + D[2];
      if (ignorePos && ignorePos[0] === nx && ignorePos[1] === ny && ignorePos[2] === nz) continue;
      const sig = this.getComponentSignal(w, nx, ny, nz, OPP[d]);
      if (sig > p) p = sig;
    }
    return p;
  },

  // Check if a block at (x,y,z) is powered by Redstone (used by lamps, TNT, doors, trapdoors, note blocks, hoppers)
  isBlockPowered(w, x, y, z) {
    for (let d = 0; d < 6; d++) {
      const D = DIRS[d], nx = x + D[0], ny = y + D[1], nz = z + D[2];
      if (this.getComponentSignal(w, nx, ny, nz, OPP[d]) > 0) return true;
      const nid = w.getBlock(nx, ny, nz);
      if (nid === 119) {
        const wp = w.getMeta(nx, ny, nz) & 15;
        if (wp > 0) {
          if (d === 3) return true; // wire on top
          if (d !== 2 && this.wirePointsDir(w, nx, ny, nz, OPP[d])) return true;
        }
      }
      if (SOLIDCUBE[nid] && this.getSolidBlockPower(w, nx, ny, nz) > 0) return true;
    }
    return false;
  },

  // Check if a piston at (x,y,z) facing `faceDir` receives power from any of the 5 non-front sides
  isPistonPowered(w, x, y, z, faceDir) {
    for (let d = 0; d < 6; d++) {
      if (d === faceDir) continue;
      const D = DIRS[d], nx = x + D[0], ny = y + D[1], nz = z + D[2];
      if (this.getComponentSignal(w, nx, ny, nz, OPP[d]) > 0) return true;
      const nid = w.getBlock(nx, ny, nz);
      if (nid === 119) {
        const wp = w.getMeta(nx, ny, nz) & 15;
        if (wp > 0) {
          if (d === 3) return true;
          if (d !== 2 && this.wirePointsDir(w, nx, ny, nz, OPP[d])) return true;
        }
      }
      if (SOLIDCUBE[nid] && this.getSolidBlockPower(w, nx, ny, nz) > 0) return true;
    }
    return false;
  },

  // ---- Comparator Container Reading & Signal Calculation (ID 514) -----------
  isContainerBlock(id) {
    return id === 52 || id === 20 || id === 117 || id === 513 || id === 527;
  },

  getContainerSignal(game, x, y, z, id) {
    if (!game || !game.blockEntities) return 0;
    const bid = id || game.world.getBlock(x, y, z);
    if (!this.isContainerBlock(bid)) return 0;
    const type = bid === 52 ? 'chest' : bid === 513 ? 'hopper' : bid === 527 ? 'brewing' : 'furnace';
    const be = game.blockEntities.get(`${x},${y},${z}`) || game.getBlockEntity(x, y, z, type);
    if (!be) return 0;
    let slots;
    if (bid === 52 || bid === 513) {
      slots = be.slots || [];
    } else if (bid === 20 || id === 117) {
      slots = [be.input, be.fuel, be.output];
    } else if (bid === 527) {
      const b = Array.isArray(be.bottles) ? be.bottles : [null, null, null];
      slots = [be.ingredient, b[0], b[1], b[2]];
    } else {
      return 0;
    }
    const n = slots.length;
    if (!n) return 0;
    let sumRatio = 0;
    let hasItem = false;
    for (let i = 0; i < n; i++) {
      const s = slots[i];
      if (s && s.count > 0) {
        hasItem = true;
        const ms = Math.max(1, maxStack(s.id));
        sumRatio += clamp(s.count / ms, 0, 1);
      }
    }
    if (!hasItem) return 0;
    return Math.min(15, 1 + Math.floor((sumRatio / n) * 14));
  },

  computeComparatorSignal(game, x, y, z, meta) {
    const w = game.world;
    const outDir = this.repeaterOutDir(meta), inDir = OPP[outDir];
    const bx = x + DIRS[inDir][0], by = y, bz = z + DIRS[inDir][2];
    const bid = w.getBlock(bx, by, bz);

    let rearSig = 0;
    if (this.isContainerBlock(bid)) {
      rearSig = this.getContainerSignal(game, bx, by, bz, bid);
    } else {
      if (bid === 119) rearSig = Math.max(rearSig, w.getMeta(bx, by, bz) & 15);
      rearSig = Math.max(rearSig, this.getComponentSignal(w, bx, by, bz, outDir));
      if (SOLIDCUBE[bid]) {
        rearSig = Math.max(rearSig, this.getSolidBlockPower(w, bx, by, bz, [x, y, z]));
        const bbx = bx + DIRS[inDir][0], bbz = bz + DIRS[inDir][2];
        const bbid = w.getBlock(bbx, by, bbz);
        if (rearSig < 15 && this.isContainerBlock(bbid)) {
          rearSig = Math.max(rearSig, this.getContainerSignal(game, bbx, by, bbz, bbid));
        }
      }
    }

    // Side inputs
    const sideDirs = (outDir === 0 || outDir === 1) ? [4, 5] : [0, 1];
    let sideSig = 0;
    for (const sd of sideDirs) {
      const sx = x + DIRS[sd][0], sy = y, sz = z + DIRS[sd][2];
      const sid = w.getBlock(sx, sy, sz);
      if (sid === 119) sideSig = Math.max(sideSig, w.getMeta(sx, sy, sz) & 15);
      sideSig = Math.max(sideSig, this.getComponentSignal(w, sx, sy, sz, OPP[sd]));
    }

    const subtractMode = !!(meta & 4);
    if (subtractMode) {
      return Math.max(0, rearSig - sideSig);
    }
    return rearSig >= sideSig ? rearSig : 0;
  },

  updateComparator(game, x, y, z) {
    const w = game.world;
    if (w.getBlock(x, y, z) !== 514) return false;
    const meta = w.getMeta(x, y, z);
    const sig = this.computeComparatorSignal(game, x, y, z, meta);
    const newMeta = (meta & 7) | (sig > 0 ? 8 : 0) | ((sig & 15) << 4);
    if (newMeta !== meta) {
      w.setMeta(x, y, z, newMeta);
      this.propagateFromSource(game, x, y, z);
      return true;
    }
    return false;
  },

  updateComparatorsNear(game, cx, cy, cz) {
    const w = game && game.world;
    if (!w) return;
    for (const d of [0, 1, 4, 5]) {
      for (const step of [1, 2]) {
        const nx = cx + DIRS[d][0] * step, nz = cz + DIRS[d][2] * step;
        if (w.getBlock(nx, cy, nz) === 514) {
          this.updateComparator(game, nx, cy, nz);
        }
      }
    }
  },

  // ---- Observer Front Change Detection (ID 515) -----------------------------
  checkObserversWatching(game, cx, cy, cz) {
    const w = game && game.world;
    if (!w) return;
    for (let d = 0; d < 6; d++) {
      const ox = cx + DIRS[d][0], oy = cy + DIRS[d][1], oz = cz + DIRS[d][2];
      if (oy < 0 || oy >= HEIGHT || !w.isLoaded(ox, oz)) continue;
      if (w.getBlock(ox, oy, oz) !== 515) continue;
      const om = w.getMeta(ox, oy, oz);
      const frontDir = om & 7;
      // Observer at (ox, oy, oz) watches (ox + DIRS[frontDir][0], oy + DIRS[frontDir][1], oz + DIRS[frontDir][2])
      if (ox + DIRS[frontDir][0] === cx && oy + DIRS[frontDir][1] === cy && oz + DIRS[frontDir][2] === cz) {
        this.triggerObserver(game, ox, oy, oz, om);
      }
    }
  },

  triggerObserver(game, ox, oy, oz, om) {
    const w = game.world;
    const frontDir = om & 7;
    const backDir = OPP[frontDir];
    const wasOn = !!(om & 8);
    if (!wasOn) {
      w.setMeta(ox, oy, oz, frontDir | 8);
    }
    // Schedule turn-off after 2 ticks
    w.ticks.set(`${ox},${oy},${oz}`, { x: ox, y: oy, z: oz, t: w.time + 2 });
    if (!wasOn) {
      this.propagateFromSource(game, ox, oy, oz);
      const bx = ox + DIRS[backDir][0], by = oy + DIRS[backDir][1], bz = oz + DIRS[backDir][2];
      this.propagateFromSource(game, bx, by, bz);
    }
  },

  // ---- Piston & Sticky Piston (IDs 516, 517, 518) ---------------------------
  // Guard Rule #4: Immovable block blacklist
  isImmovable(game, x, y, z, id, meta) {
    if (y <= 0 || y >= HEIGHT || !game.world.isLoaded(x, z)) return true;
    const b = BLOCKS[id];
    if (!b || b.hardness < 0) return true;
    if (game.blockEntities && game.blockEntities.has(`${x},${y},${z}`)) return true;
    // BlockEntity containers & spawner: chest(52), furnace(20/117), hopper(513), spawner(182), brewing_stand(527)
    if (id === 52 || id === 20 || id === 117 || id === 513 || id === 182 || id === 527) return true;
    // Enchanting table(185), anvil(186), obsidian(28), bedrock(6)
    if (id === 185 || id === 186 || id === 28 || id === 6) return true;
    // Doors, beds, piston_head, and already-extended pistons
    if (b.door || b.bed || id === 518) return true;
    if ((id === 516 || id === 517) && (meta & 8)) return true;
    return false;
  },

  // Fragile blocks in piston push path that break and drop items via breakBlock
  isFragileOnPush(id) {
    if (!id || IS_FLUID[id]) return false;
    const b = BLOCKS[id];
    if (!b) return false;
    if (b.needsSupport || b.ladder || b.web || b.repeater || b.comparator || b.button || b.lever || b.plate) return true;
    if (b.shape === SH_CROSS || b.shape === SH_CROP || b.shape === SH_TORCH || b.shape === SH_WIRE) return true;
    if (id === 53 || id === 54 || id === 55) return true; // pumpkin, jack_o_lantern, melon
    return false;
  },

  updatePiston(game, x, y, z) {
    const w = game.world;
    if (y < 0 || y >= HEIGHT || !w.isLoaded(x, z)) return false;
    const id = w.getBlock(x, y, z);
    if (id !== 516 && id !== 517) return false;
    const pKey = `${x},${y},${z}`;
    if (this._updatingPistons.has(pKey)) return false;

    const meta = w.getMeta(x, y, z);
    const dir = meta & 7;
    const ext = !!(meta & 8);
    const powered = this.isPistonPowered(w, x, y, z, dir);
    const D = DIRS[dir];

    if (powered && !ext) {
      // Scan up to 12 blocks in front of the piston
      const toPush = [];
      let canExtend = false;
      let destroyPos = null;
      for (let step = 1; step <= 13; step++) {
        const nx = x + D[0] * step, ny = y + D[1] * step, nz = z + D[2] * step;
        if (ny <= 0 || ny >= HEIGHT || !w.isLoaded(nx, nz)) {
          canExtend = false;
          break;
        }
        const nid = w.getBlock(nx, ny, nz);
        const nm = w.getMeta(nx, ny, nz);
        if (nid === 0 || IS_FLUID[nid]) {
          canExtend = true;
          break;
        }
        if (this.isFragileOnPush(nid)) {
          canExtend = true;
          destroyPos = [nx, ny, nz];
          break;
        }
        if (this.isImmovable(game, nx, ny, nz, nid, nm)) {
          canExtend = false;
          break;
        }
        if (step > 12) {
          // Exceeds 12-block push limit
          canExtend = false;
          break;
        }
        toPush.push({ x: nx, y: ny, z: nz, id: nid, meta: nm });
      }
      if (!canExtend) return false;

      this._updatingPistons.add(pKey);
      try {
        // 1. If push chain terminates in a fragile block, break it so it drops items
        if (destroyPos) {
          game.breakBlock(destroyPos[0], destroyPos[1], destroyPos[2], true, true);
        }
        // 2. Break any fragile blocks sitting on top of or attached to moved blocks that would be displaced
        for (let i = toPush.length - 1; i >= 0; i--) {
          const b = toPush[i];
          const tx = b.x + D[0], ty = b.y + D[1], tz = b.z + D[2];
          const tid = w.getBlock(tx, ty, tz);
          if (tid && this.isFragileOnPush(tid)) {
            game.breakBlock(tx, ty, tz, true, true);
          }
        }
        // 3. Shift pushed blocks from furthest to nearest
        for (let i = toPush.length - 1; i >= 0; i--) {
          const b = toPush[i];
          w.setBlock(b.x + D[0], b.y + D[1], b.z + D[2], b.id, b.meta);
        }
        // 4. Place piston_head (518) at step 1 and mark piston base extended
        const hx = x + D[0], hy = y + D[1], hz = z + D[2];
        w.setBlock(hx, hy, hz, 518, dir | (id === 517 ? 8 : 0));
        w.setMeta(x, y, z, dir | 8);
        // 5. Nudge entities standing in the piston head or pushed destinations
        const list = [game.player, ...(game.entities || [])];
        for (const e of list) {
          if (!e || e.dead) continue;
          const eb = e.box();
          const checkCells = [[hx, hy, hz], ...toPush.map(b => [b.x + D[0], b.y + D[1], b.z + D[2]])];
          for (const [cx, cy, cz] of checkCells) {
            if (eb[3] > cx && eb[0] < cx + 1 && eb[4] > cy && eb[1] < cy + 1 && eb[5] > cz && eb[2] < cz + 1) {
              e.pos[0] += D[0] * 1.02;
              e.pos[1] += D[1] * 1.02;
              e.pos[2] += D[2] * 1.02;
              break;
            }
          }
        }
        if (typeof Sound !== 'undefined' && Sound.block) Sound.block('step', 'stone', [x + 0.5, y + 0.5, z + 0.5]);
      } finally {
        this._updatingPistons.delete(pKey);
      }
      return true;
    }

    if (!powered && ext) {
      this._updatingPistons.add(pKey);
      try {
        const hx = x + D[0], hy = y + D[1], hz = z + D[2];
        w.setMeta(x, y, z, dir);
        if (w.getBlock(hx, hy, hz) === 518) {
          w.setBlock(hx, hy, hz, 0, 0);
        }
        // Sticky Piston (517): pull back 1 movable non-fragile block from 2 blocks in front
        if (id === 517) {
          const px = x + D[0] * 2, py = y + D[1] * 2, pz = z + D[2] * 2;
          if (py > 0 && py < HEIGHT && w.isLoaded(px, pz)) {
            const pid = w.getBlock(px, py, pz);
            const pm = w.getMeta(px, py, pz);
            if (pid && !IS_FLUID[pid] && !this.isImmovable(game, px, py, pz, pid, pm) && !this.isFragileOnPush(pid)) {
              w.setBlock(px, py, pz, 0, 0);
              w.setBlock(hx, hy, hz, pid, pm);
            }
          }
        }
        if (typeof Sound !== 'undefined' && Sound.block) Sound.block('step', 'stone', [x + 0.5, y + 0.5, z + 0.5]);
      } finally {
        this._updatingPistons.delete(pKey);
      }
      return true;
    }

    return false;
  },

  // Check if the support block of a redstone torch at (x,y,z) is powered
  isTorchSupportPowered(w, x, y, z, meta) {
    const sd = this.torchSupportDir(meta);
    const sx = x + DIRS[sd][0], sy = y + DIRS[sd][1], sz = z + DIRS[sd][2];
    return this.getSolidBlockPower(w, sx, sy, sz, [x, y, z]) > 0;
  },

  // Check if a repeater at (x,y,z) receives input power from behind
  isRepeaterPowered(w, x, y, z, meta) {
    const outDir = this.repeaterOutDir(meta), inDir = OPP[outDir];
    const bx = x + DIRS[inDir][0], by = y, bz = z + DIRS[inDir][2];
    const bid = w.getBlock(bx, by, bz);
    if (!bid) return false;
    if (bid === 119) return (w.getMeta(bx, by, bz) & 15) > 0;
    if (this.getComponentSignal(w, bx, by, bz, outDir) > 0) return true;
    if (SOLIDCUBE[bid] && this.getSolidBlockPower(w, bx, by, bz) > 0) return true;
    return false;
  },

  // External non-wire power (0..15) feeding a single redstone_wire block at (x,y,z)
  getWireExternalPower(w, x, y, z) {
    let maxP = 0;
    for (let d = 0; d < 6; d++) {
      const D = DIRS[d], nx = x + D[0], ny = y + D[1], nz = z + D[2];
      const sig = this.getComponentSignal(w, nx, ny, nz, OPP[d]);
      if (sig > maxP) maxP = sig;
      const nid = w.getBlock(nx, ny, nz);
      if (SOLIDCUBE[nid]) {
        const sp = this.getStrongPower(w, nx, ny, nz);
        if (sp > maxP) maxP = sp;
      }
      if (maxP >= 15) return 15;
    }
    return maxP;
  },

  // Connected-wire neighbors of a redstone_wire at (x,y,z) for signal propagation
  getWireNeighbors(w, x, y, z) {
    const out = [];
    const aboveSelf = w.getBlock(x, y + 1, z);
    const canClimb = !SOLIDCUBE[aboveSelf];
    for (const d of [0, 1, 4, 5]) {
      const D = DIRS[d], nx = x + D[0], nz = z + D[2];
      const nid = w.getBlock(nx, y, nz);
      if (nid === 119) out.push([nx, y, nz]);
      // Climb up onto solid neighbor if block above self is not solid
      if (canClimb && SOLIDCUBE[nid] && w.getBlock(nx, y + 1, nz) === 119) {
        out.push([nx, y + 1, nz]);
      }
      // Drop down if horizontal neighbor is not a solid cube ( prevents diagonal cutting )
      if (!SOLIDCUBE[nid] && w.getBlock(nx, y - 1, nz) === 119) {
        out.push([nx, y - 1, nz]);
      }
    }
    return out;
  },

  // Recompute signal strength across all connected redstone_wire blocks near (sx,sy,sz)
  updateWireNetwork(game, sx, sy, sz) {
    if (this.updatingWires) return;
    const w = game.world;
    // Collect seed wires within 2 blocks of (sx,sy,sz)
    const seeds = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 3) continue;
          const x = sx + dx, y = sy + dy, z = sz + dz;
          if (y >= 0 && y < HEIGHT && w.getBlock(x, y, z) === 119) {
            seeds.push([x, y, z]);
          }
        }
      }
    }
    if (!seeds.length) return;

    this.updatingWires = true;
    try {
      // 1. Discover the entire connected component of redstone_wire (capped at 1024 blocks)
      const nodes = new Map(); // key "x,y,z" -> {x, y, z, oldP, newP}
      const q = [];
      for (const [x, y, z] of seeds) {
        const k = `${x},${y},${z}`;
        if (!nodes.has(k)) {
          nodes.set(k, { x, y, z, oldP: w.getMeta(x, y, z) & 15, newP: 0 });
          q.push([x, y, z]);
        }
      }
      let head = 0;
      while (head < q.length && nodes.size < 1024) {
        const [x, y, z] = q[head++];
        for (const [nx, ny, nz] of this.getWireNeighbors(w, x, y, z)) {
          const nk = `${nx},${ny},${nz}`;
          if (!nodes.has(nk)) {
            nodes.set(nk, { x: nx, y: ny, z: nz, oldP: w.getMeta(nx, ny, nz) & 15, newP: 0 });
            q.push([nx, ny, nz]);
          }
        }
      }

      // 2. Compute external power for each wire node and bucket by level 15..1
      const buckets = Array.from({ length: 16 }, () => []);
      for (const node of nodes.values()) {
        const ext = this.getWireExternalPower(w, node.x, node.y, node.z);
        node.newP = ext;
        if (ext > 0) buckets[ext].push(node);
      }

      // 3. Propagate from highest power (15) down to 2
      for (let p = 15; p >= 2; p--) {
        const b = buckets[p];
        for (let i = 0; i < b.length; i++) {
          const node = b[i];
          if (node.newP > p) continue;
          for (const [nx, ny, nz] of this.getWireNeighbors(w, node.x, node.y, node.z)) {
            const nNode = nodes.get(`${nx},${ny},${nz}`);
            if (nNode && nNode.newP < p - 1) {
              nNode.newP = p - 1;
              buckets[p - 1].push(nNode);
            }
          }
        }
      }

      // 4. Apply changed meta values and collect neighbor positions to notify
      const changed = [];
      for (const node of nodes.values()) {
        if (node.oldP !== node.newP) {
          w.setMeta(node.x, node.y, node.z, node.newP);
          changed.push(node);
        }
      }

      // 5. Notify neighbors of all changed wires (plus the origin neighborhood)
      const notified = new Set();
      const notifyAround = (cx, cy, cz) => {
        for (let d = 0; d < 6; d++) {
          const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1], nz = cz + DIRS[d][2];
          const k = `${nx},${ny},${nz}`;
          if (!notified.has(k)) {
            notified.add(k);
            this.notifyRedstoneAt(game, nx, ny, nz);
          }
          // Also notify neighbors of solid blocks adjacent to the wire (weak power through block)
          if (SOLIDCUBE[w.getBlock(nx, ny, nz)]) {
            for (let d2 = 0; d2 < 6; d2++) {
              const nnx = nx + DIRS[d2][0], nny = ny + DIRS[d2][1], nnz = nz + DIRS[d2][2];
              const k2 = `${nnx},${nny},${nnz}`;
              if (!notified.has(k2)) {
                notified.add(k2);
                this.notifyRedstoneAt(game, nnx, nny, nnz);
              }
            }
          }
        }
      };
      for (const node of changed) notifyAround(node.x, node.y, node.z);
    } finally {
      this.updatingWires = false;
    }
  },

  // Notify a single block at (x,y,z) and its adjacent blocks through solid blocks
  propagateFromSource(game, x, y, z) {
    const w = game.world;
    this.updateWireNetwork(game, x, y, z);
    const notified = new Set();
    const trigger = (tx, ty, tz) => {
      const k = `${tx},${ty},${tz}`;
      if (notified.has(k)) return;
      notified.add(k);
      this.notifyRedstoneAt(game, tx, ty, tz);
    };
    trigger(x, y, z);
    for (let d = 0; d < 6; d++) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
      trigger(nx, ny, nz);
      // If neighbor is a solid block, components attached to or adjacent to that solid block also get notified
      if (SOLIDCUBE[w.getBlock(nx, ny, nz)]) {
        for (let d2 = 0; d2 < 6; d2++) {
          trigger(nx + DIRS[d2][0], ny + DIRS[d2][1], nz + DIRS[d2][2]);
        }
      }
    }
    this.updateComparatorsNear(game, x, y, z);
  },

  // Evaluate a block's response to a change in redstone power
  notifyRedstoneAt(game, x, y, z) {
    const w = game.world;
    if (y < 0 || y >= HEIGHT || !w.isLoaded(x, z)) return;
    const id = w.getBlock(x, y, z);
    if (!id) return;
    const meta = w.getMeta(x, y, z);

    switch (id) {
      case 119: // redstone_wire
        this.updateWireNetwork(game, x, y, z);
        break;
      case 120: // lit redstone_torch -> schedule turn-off in 2 ticks if support is powered
        if (this.isTorchSupportPowered(w, x, y, z, meta)) {
          w.schedule(x, y, z, 2);
        }
        break;
      case 121: // unlit redstone_torch -> schedule turn-on in 2 ticks if support is unpowered
        if (!this.isTorchSupportPowered(w, x, y, z, meta)) {
          w.schedule(x, y, z, 2);
        }
        break;
      case 127: { // unlit repeater -> schedule turn-on after delay
        if (this.isRepeaterPowered(w, x, y, z, meta)) {
          const delay = (((meta >> 2) & 3) + 1) * 2;
          w.schedule(x, y, z, delay);
        }
        break;
      }
      case 156: { // lit repeater -> schedule turn-off after delay
        if (!this.isRepeaterPowered(w, x, y, z, meta)) {
          const delay = (((meta >> 2) & 3) + 1) * 2;
          w.schedule(x, y, z, delay);
        }
        break;
      }
      case 514: { // comparator -> update signal (and schedule 2-tick verification)
        this.updateComparator(game, x, y, z);
        w.schedule(x, y, z, 2);
        break;
      }
      case 516: // piston
      case 517: { // sticky_piston
        this.updatePiston(game, x, y, z);
        break;
      }
      case 125: // unlit redstone_lamp -> turn on immediately when powered
        if (this.isBlockPowered(w, x, y, z)) {
          w.setBlock(x, y, z, 126, 0);
        }
        break;
      case 126: // lit redstone_lamp -> schedule turn-off in 4 ticks when unpowered
        if (!this.isBlockPowered(w, x, y, z)) {
          w.schedule(x, y, z, 4);
        }
        break;
      case 26: // TNT -> ignite immediately when powered!
        if (this.isBlockPowered(w, x, y, z)) {
          w.setBlock(x, y, z, 0, 0);
          game.entities.push(new PrimedTNT(game, x, y, z));
        }
        break;
      case 69: // oak_door
      case 525: { // cherry_door -> open/close on redstone edge
        const base = (meta & 8) ? y - 1 : y;
        if (w.getBlock(x, base, z) !== id) break;
        const powered = this.isBlockPowered(w, x, base, z) || this.isBlockPowered(w, x, base + 1, z);
        const topMeta = w.getMeta(x, base + 1, z);
        const wasPowered = !!(topMeta & 16);
        if (powered !== wasPowered) {
          const bm = (w.getMeta(x, base, z) & ~4) | (powered ? 4 : 0);
          const tm = (bm | 8) | (powered ? 16 : 0);
          w.setMeta(x, base, z, bm);
          w.setMeta(x, base + 1, z, tm);
          Sound.door([x, base, z], powered);
        }
        break;
      }
      case 112: { // oak_trapdoor -> open/close on redstone edge
        const powered = this.isBlockPowered(w, x, y, z);
        const wasPowered = !!(meta & 16);
        if (powered !== wasPowered) {
          const nm = (meta & ~(4 | 16)) | (powered ? (4 | 16) : 0);
          w.setMeta(x, y, z, nm);
          Sound.door([x, y, z], powered);
        }
        break;
      }
      case 111: { // note_block -> play note on rising edge
        const powered = this.isBlockPowered(w, x, y, z);
        const wasPowered = !!(meta & 32);
        if (powered !== wasPowered) {
          const pitch = meta & 31;
          w.setMeta(x, y, z, pitch | (powered ? 32 : 0));
          if (powered && w.getBlock(x, y + 1, z) === 0) {
            Sound.note([x, y, z], pitch);
            game.particles.spawn('note', x + 0.5, y + 1.2, z + 0.5, 0, 0.02, 0, { col: [255, Math.round(pitch * 10), Math.round(255 - pitch * 10)] });
          }
        }
        break;
      }
    }
  },

  // Execute scheduled block tick from World.tickScheduled()
  onScheduledTick(game, x, y, z, id) {
    const w = game.world;
    const meta = w.getMeta(x, y, z);
    switch (id) {
      case 120: { // lit redstone_torch -> turn off if still powered
        if (this.isTorchSupportPowered(w, x, y, z, meta)) {
          // Burnout check (> 8 turn-offs within 60 ticks)
          const k = `${x},${y},${z}`;
          let hist = this.burnout.get(k);
          if (!hist) { hist = []; this.burnout.set(k, hist); }
          while (hist.length && w.time - hist[0] > 60) hist.shift();
          hist.push(w.time);
          w.setBlock(x, y, z, 121, meta);
          this.propagateFromSource(game, x, y, z);
          if (hist.length >= 8) {
            game.onFizz(x, y, z);
          }
        }
        break;
      }
      case 121: { // unlit redstone_torch -> turn on if support is unpowered and not burned out
        if (!this.isTorchSupportPowered(w, x, y, z, meta)) {
          const k = `${x},${y},${z}`;
          const hist = this.burnout.get(k);
          if (hist) {
            while (hist.length && w.time - hist[0] > 60) hist.shift();
            if (hist.length >= 8) {
              w.schedule(x, y, z, 40);
              return;
            }
          }
          w.setBlock(x, y, z, 120, meta);
          this.propagateFromSource(game, x, y, z);
        }
        break;
      }
      case 127: { // unlit repeater -> turn on
        if (this.isRepeaterPowered(w, x, y, z, meta)) {
          w.setBlock(x, y, z, 156, meta);
          this.propagateFromSource(game, x, y, z);
          // If input already dropped while waiting, schedule turn-off
          if (!this.isRepeaterPowered(w, x, y, z, meta)) {
            w.schedule(x, y, z, (((meta >> 2) & 3) + 1) * 2);
          }
        }
        break;
      }
      case 156: { // lit repeater -> turn off
        if (!this.isRepeaterPowered(w, x, y, z, meta)) {
          w.setBlock(x, y, z, 127, meta);
          this.propagateFromSource(game, x, y, z);
        }
        break;
      }
      case 514: { // comparator scheduled update
        this.updateComparator(game, x, y, z);
        break;
      }
      case 515: { // observer -> end 2-tick pulse
        if (meta & 8) {
          const frontDir = meta & 7;
          const backDir = OPP[frontDir];
          w.setMeta(x, y, z, frontDir);
          this.propagateFromSource(game, x, y, z);
          this.propagateFromSource(game, x + DIRS[backDir][0], y + DIRS[backDir][1], z + DIRS[backDir][2]);
        }
        break;
      }
      case 516: // piston
      case 517: { // sticky_piston
        this.updatePiston(game, x, y, z);
        break;
      }
      case 126: { // lit redstone_lamp -> turn off
        if (!this.isBlockPowered(w, x, y, z)) {
          w.setBlock(x, y, z, 125, 0);
        }
        break;
      }
      case 123: // stone_button
      case 159: { // oak_button
        if (meta & 8) {
          w.setMeta(x, y, z, meta & 7);
          Sound.click();
          this.propagateFromSource(game, x, y, z);
        }
        break;
      }
      case 124: // stone_pressure_plate
      case 169: { // oak_pressure_plate
        if (meta & 1) {
          if (this.hasEntityOnPlate(game, x, y, z, id === 169)) {
            w.schedule(x, y, z, 10);
          } else {
            w.setMeta(x, y, z, 0);
            Sound.click();
            this.propagateFromSource(game, x, y, z);
          }
        }
        break;
      }
      case 157: { // target block -> reset signal to 0
        if (meta > 0) {
          w.setMeta(x, y, z, 0);
          this.propagateFromSource(game, x, y, z);
        }
        break;
      }
    }
  },

  hasEntityOnPlate(game, x, y, z, allEntities) {
    const list = [game.player, ...game.entities];
    for (const e of list) {
      if (!e || e.dead || (e.deathTime && e.deathTime > 0)) continue;
      if (!allEntities && !(e instanceof Living)) continue;
      const b = e.box();
      if (b[3] > x + 0.125 && b[0] < x + 0.875 && b[4] > y && b[1] < y + 0.25 && b[5] > z + 0.125 && b[2] < z + 0.875) {
        return true;
      }
    }
    return false;
  },

  // Check if any entity steps onto a pressure plate each tick
  tickPressurePlates(game) {
    const w = game.world;
    const list = [game.player, ...game.entities];
    for (const e of list) {
      if (!e || e.dead || (e.deathTime && e.deathTime > 0)) continue;
      const bx = Math.floor(e.pos[0]), by = Math.floor(e.pos[1] + 0.05), bz = Math.floor(e.pos[2]);
      const id = w.getBlock(bx, by, bz);
      if (id === 124 || id === 169) {
        if (id === 124 && !(e instanceof Living)) continue;
        const m = w.getMeta(bx, by, bz);
        if (!(m & 1)) {
          w.setMeta(bx, by, bz, 1);
          Sound.click();
          this.propagateFromSource(game, bx, by, bz);
          game.flushMesh();
        }
        w.schedule(bx, by, bz, 10);
      }
    }
  },
};

if (typeof window !== "undefined") window.Redstone = Redstone;
