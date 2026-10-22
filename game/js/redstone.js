'use strict';
// ---------------------------------------------------------------------------
// Redstone circuit engine: signal propagation, strong/weak power, scheduled
// component ticks (torches, repeaters, buttons, pressure plates, lamps, targets)
// and effector triggers (TNT, doors, trapdoors, note blocks).
// ---------------------------------------------------------------------------

var Redstone = window.Redstone = {
  updatingWires: false,
  burnout: new Map(), // key "x,y,z" -> array of world.time timestamps when torch turned off

  // Direction index (0..5) where a torch/redstone_torch is attached
  torchSupportDir(meta) {
    if (!meta) return 2; // attached to block below (y - 1)
    const m = meta & 7;
    return m === 6 ? 0 : m;
  },

  // Output direction (0,1,4,5) for a repeater with given meta
  repeaterOutDir(meta) {
    return [4, 1, 5, 0][meta & 3];
  },

  // Check if a block at (nx, ny, nz) visually/logically connects to redstone wire along horizontal dir
  wireConnects(id, meta, dir) {
    if (!id) return false;
    if (id === 119 || id === 110 || id === 120 || id === 121 || id === 122 || id === 123 || id === 159 || id === 124 || id === 169 || id === 157) return true;
    if (id === 127 || id === 156) {
      const outDir = this.repeaterOutDir(meta);
      return dir === outDir || dir === OPP[outDir];
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
    // 2. Active lever/button attached to (x,y,z), pressure plate on top (y + 1), or repeater pointing into (x,y,z)
    for (let d = 0; d < 6; d++) {
      const D = DIRS[d], nx = x + D[0], ny = y + D[1], nz = z + D[2];
      if (ignorePos && ignorePos[0] === nx && ignorePos[1] === ny && ignorePos[2] === nz) continue;
      const nid = w.getBlock(nx, ny, nz);
      if (!nid) continue;
      const nm = w.getMeta(nx, ny, nz);
      if ((nid === 122 || nid === 123 || nid === 159) && (nm & 8) && (nm & 7) === OPP[d]) return 15;
      if (d === 3 && (nid === 124 || nid === 169) && (nm & 1)) return 15;
      if (nid === 156 && this.repeaterOutDir(nm) === OPP[d]) return 15;
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

  // Check if a block at (x,y,z) is powered by Redstone (used by lamps, TNT, doors, trapdoors, note blocks)
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
      case 69: { // oak_door -> open/close on redstone edge
        const base = (meta & 8) ? y - 1 : y;
        if (w.getBlock(x, base, z) !== 69) break;
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
