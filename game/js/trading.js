'use strict';
// ---------------------------------------------------------------------------
// Step 4 (W1): Villager 3-Profession Trading System & Hopper Automation
// - Professions: farmer (农民), librarian (图书管理员), smith (铁匠)
// - Fixed trade tables, finite stock (uses/maxUses), daily restock, XP/level
// - Hopper (ID 513): 5-slot container, 8-tick transfer cooldown, pull from
//   container above or ItemEntity above, push into chest/hopper/furnace/brewing
//   below or horizontally, and notify adjacent Redstone Comparators.
// ---------------------------------------------------------------------------

const VILLAGER_PROFESSIONS = {
  farmer: {
    key: 'farmer',
    cn: '农民',
    tex: 'villager_farmer',
  },
  librarian: {
    key: 'librarian',
    cn: '图书管理员',
    tex: 'villager_librarian',
  },
  smith: {
    key: 'smith',
    cn: '铁匠',
    tex: 'villager_smith',
  },
};

const VILLAGER_PROF_KEYS = ['farmer', 'librarian', 'smith'];
const VILLAGER_LEVEL_NAMES = ['新手', '学徒', '老手', '专家', '大师'];
const VILLAGER_LEVEL_THRESHOLDS = [0, 10, 30, 70, 150];
const VILLAGER_LEVELS = VILLAGER_LEVEL_THRESHOLDS.map((minXp, i) => ({
  level: i + 1,
  name: VILLAGER_LEVEL_NAMES[i],
  minXp,
}));

const Trading = {
  profDef(prof) {
    return VILLAGER_PROFESSIONS[prof] || VILLAGER_PROFESSIONS.farmer;
  },

  levelName(lvl) {
    const idx = clamp((lvl || 1) - 1, 0, VILLAGER_LEVEL_NAMES.length - 1);
    return VILLAGER_LEVEL_NAMES[idx];
  },

  levelForXp(xp) {
    let lvl = 1;
    for (let i = 0; i < VILLAGER_LEVEL_THRESHOLDS.length; i++) {
      if ((xp || 0) >= VILLAGER_LEVEL_THRESHOLDS[i]) lvl = i + 1;
    }
    return lvl;
  },

  xpProgress(xp, lvl) {
    const curLvl = clamp(lvl || 1, 1, 5);
    if (curLvl >= 5) return 1;
    const base = VILLAGER_LEVEL_THRESHOLDS[curLvl - 1];
    const next = VILLAGER_LEVEL_THRESHOLDS[curLvl];
    return clamp(((xp || 0) - base) / Math.max(1, next - base), 0, 1);
  },

  cloneStack(st) {
    if (!st) return null;
    const out = { id: st.id, count: st.count, dmg: st.dmg || 0 };
    if (st.name) out.name = st.name;
    if (st.ench) out.ench = { ...st.ench };
    return out;
  },

  cloneTrade(t) {
    if (!t) return null;
    return {
      costA: this.cloneStack(t.costA),
      costB: this.cloneStack(t.costB),
      result: this.cloneStack(t.result),
      uses: t.uses || 0,
      maxUses: t.maxUses || 12,
      xp: t.xp || 2,
    };
  },

  buildTrades(prof, seed = 1337) {
    const r = RNG(seed | 0);
    if (prof === 'librarian') {
      const enchKeys = ['sharpness', 'efficiency', 'unbreaking', 'protection', 'fortune', 'power', 'feather_falling', 'looting', 'silk_touch'];
      const ek1 = enchKeys[r.int(enchKeys.length)];
      const ek2 = enchKeys[(r.int(enchKeys.length - 1) + enchKeys.indexOf(ek1) + 1) % enchKeys.length];
      const def1 = (typeof ENCHANTS !== 'undefined' && ENCHANTS[ek1]) ? ENCHANTS[ek1] : { max: 3 };
      const def2 = (typeof ENCHANTS !== 'undefined' && ENCHANTS[ek2]) ? ENCHANTS[ek2] : { max: 3 };
      const lvl1 = Math.max(1, Math.min(def1.max, 1 + r.int(def1.max)));
      const lvl2 = Math.max(1, Math.min(def2.max, Math.ceil(def2.max * 0.75)));
      const cost1 = Math.min(32, 6 + lvl1 * 4);
      const cost2 = Math.min(40, 10 + lvl2 * 5);
      return [
        { costA: makeStack('paper', 24), costB: null, result: makeStack('emerald', 1), uses: 0, maxUses: 16, xp: 2 },
        { costA: makeStack('emerald', cost1), costB: makeStack('book', 1), result: { id: item('enchanted_book'), count: 1, dmg: 0, ench: { [ek1]: lvl1 } }, uses: 0, maxUses: 8, xp: 6 },
        { costA: makeStack('emerald', 3), costB: null, result: makeStack('bookshelf', 1), uses: 0, maxUses: 12, xp: 3 },
        { costA: makeStack('emerald', 1), costB: null, result: makeStack('glass', 4), uses: 0, maxUses: 12, xp: 2 },
        { costA: makeStack('emerald', 4), costB: null, result: makeStack('sea_lantern', 1), uses: 0, maxUses: 10, xp: 4 },
        { costA: makeStack('emerald', cost2), costB: makeStack('book', 1), result: { id: item('enchanted_book'), count: 1, dmg: 0, ench: { [ek2]: lvl2 } }, uses: 0, maxUses: 6, xp: 10 },
      ];
    }

    if (prof === 'smith') {
      const dSwordEnch = r() < 0.5 ? { sharpness: 2, unbreaking: 2 } : { sharpness: 3 };
      const dPickEnch = r() < 0.5 ? { efficiency: 2, unbreaking: 2 } : { efficiency: 3 };
      return [
        { costA: makeStack('coal', 15), costB: null, result: makeStack('emerald', 1), uses: 0, maxUses: 16, xp: 2 },
        { costA: makeStack('raw_iron', 4), costB: null, result: makeStack('emerald', 1), uses: 0, maxUses: 12, xp: 3 },
        { costA: makeStack('emerald', 3), costB: null, result: makeStack('iron_pickaxe', 1), uses: 0, maxUses: 8, xp: 4 },
        { costA: makeStack('emerald', 4), costB: null, result: makeStack('iron_sword', 1), uses: 0, maxUses: 8, xp: 4 },
        { costA: makeStack('emerald', 5), costB: null, result: makeStack('iron_chestplate', 1), uses: 0, maxUses: 8, xp: 5 },
        { costA: makeStack('emerald', 12), costB: null, result: { id: item('diamond_pickaxe'), count: 1, dmg: 0, ench: dPickEnch }, uses: 0, maxUses: 4, xp: 12 },
        { costA: makeStack('emerald', 14), costB: null, result: { id: item('diamond_sword'), count: 1, dmg: 0, ench: dSwordEnch }, uses: 0, maxUses: 4, xp: 12 },
      ];
    }

    // Default: farmer (农民)
    return [
      { costA: makeStack('wheat', 20), costB: null, result: makeStack('emerald', 1), uses: 0, maxUses: 16, xp: 2 },
      { costA: makeStack('carrot', 16), costB: null, result: makeStack('emerald', 1), uses: 0, maxUses: 16, xp: 2 },
      { costA: makeStack('emerald', 1), costB: null, result: makeStack('bread', 6), uses: 0, maxUses: 12, xp: 2 },
      { costA: makeStack('emerald', 1), costB: null, result: makeStack('pumpkin_pie', 4), uses: 0, maxUses: 12, xp: 3 },
      { costA: makeStack('emerald', 1), costB: null, result: makeStack('apple', 4), uses: 0, maxUses: 12, xp: 3 },
      { costA: makeStack('emerald', 3), costB: null, result: makeStack('golden_apple', 1), uses: 0, maxUses: 8, xp: 6 },
    ];
  },

  ensureVillager(mob, gameOrProf, explicitProf) {
    if (!mob || mob.type !== 'villager') return;
    let game = null;
    let profArg = explicitProf;
    if (typeof gameOrProf === 'string') profArg = gameOrProf;
    else if (gameOrProf && typeof gameOrProf === 'object') game = gameOrProf;
    if (!game && mob.game) game = mob.game;

    if (profArg && VILLAGER_PROFESSIONS[profArg]) {
      if (mob.profession !== profArg) {
        mob.profession = profArg;
        mob.trades = null;
      }
    }
    if (!mob.profession || !VILLAGER_PROFESSIONS[mob.profession]) {
      const h = Math.abs(hashStr(`${Math.floor(mob.pos[0])}:${Math.floor(mob.pos[2])}:${(game && game.world && game.world.seed) || 0}`));
      mob.profession = VILLAGER_PROF_KEYS[h % VILLAGER_PROF_KEYS.length];
    }
    // Verify trade table matches mob.profession (guards against setting mob.profession = 'smith' after new Mob())
    const expectedFirstId = mob.profession === 'librarian' ? item('paper')
      : mob.profession === 'smith' ? item('coal')
      : item('wheat');
    const firstTradeId = (Array.isArray(mob.trades) && mob.trades[0] && mob.trades[0].costA) ? mob.trades[0].costA.id : -1;
    if (!Array.isArray(mob.trades) || !mob.trades.length || mob._tradesProf !== mob.profession || firstTradeId !== expectedFirstId) {
      const seed = hashStr(`trade:${mob.profession}:${Math.floor(mob.pos[0])}:${Math.floor(mob.pos[2])}:${(game && game.world && game.world.seed) || 0}`);
      mob.trades = this.buildTrades(mob.profession, seed);
      mob._tradesProf = mob.profession;
    }
    if (mob.xp === undefined) mob.xp = 0;
    if (mob.level === undefined) mob.level = this.levelForXp(mob.xp);
    const curDay = game ? Math.floor((game.worldTime || 0) / 24000) : 0;
    if (mob.restockDay === undefined) mob.restockDay = curDay;
  },

  isOutOfStock(trade) {
    return !trade || (trade.uses || 0) >= (trade.maxUses || 12);
  },

  canFulfill(trade, payA, payB) {
    if (!trade || this.isOutOfStock(trade)) return false;
    if (!payA || payA.id !== trade.costA.id || payA.count < trade.costA.count) return false;
    if (trade.costB) {
      if (!payB || payB.id !== trade.costB.id || payB.count < trade.costB.count) return false;
    } else if (payB) {
      return false;
    }
    return true;
  },

  consumePayment(trade, getA, setA, getB, setB, villager, game) {
    if (!trade) return false;
    const a = getA(), b = getB();
    if (!this.canFulfill(trade, a, b)) return false;
    a.count -= trade.costA.count;
    if (a.count <= 0) setA(null);
    if (trade.costB && b) {
      b.count -= trade.costB.count;
      if (b.count <= 0) setB(null);
    }
    trade.uses = (trade.uses || 0) + 1;
    if (villager) {
      villager.xp = (villager.xp || 0) + (trade.xp || 2);
      villager.level = this.levelForXp(villager.xp);
      if (game && game.particles) {
        for (let i = 0; i < 6; i++) {
          game.particles.spawn('heart', villager.pos[0] + (Math.random() - 0.5) * 0.6, villager.pos[1] + 1.5 + Math.random() * 0.4, villager.pos[2] + (Math.random() - 0.5) * 0.6, 0, 0.02, 0);
        }
      }
    }
    if (game && typeof game.addXp === 'function') {
      game.addXp(1 + ((Math.random() * 3) | 0));
    }
    return true;
  },

  restock(villager, day) {
    if (!villager || !Array.isArray(villager.trades)) return false;
    let changed = false;
    for (const t of villager.trades) {
      if (t.uses > 0) {
        t.uses = 0;
        changed = true;
      }
    }
    if (day !== undefined) villager.restockDay = day;
    return changed;
  },

  checkRestock(villager, gameOrWorldTime) {
    if (!villager || villager.type !== 'villager') return false;
    const worldTime = typeof gameOrWorldTime === 'number'
      ? gameOrWorldTime
      : (gameOrWorldTime && typeof gameOrWorldTime.worldTime === 'number' ? gameOrWorldTime.worldTime : 0);
    const curDay = Math.floor(worldTime / 24000);
    if (villager.restockDay === undefined) {
      villager.restockDay = curDay;
      return false;
    }
    if (curDay > villager.restockDay) {
      const did = this.restock(villager, curDay);
      if (did && villager.game && villager.game.particles) {
        for (let i = 0; i < 5; i++) {
          villager.game.particles.spawn('glint', villager.pos[0] + (Math.random() - 0.5) * 0.6, villager.pos[1] + 1.2 + Math.random() * 0.5, villager.pos[2] + (Math.random() - 0.5) * 0.6, 0, 0.03, 0);
        }
      }
      return did;
    }
    return false;
  },
};

// ---------------------------------------------------------------------------
// Hopper (ID 513): 8-tick transfer loop (pushOut + pullIn)
// ---------------------------------------------------------------------------
const Hopper = {
  canMerge(a, b) {
    if (!a || !b || a.id !== b.id) return false;
    if (ITEMS[a.id] && ITEMS[a.id].durability) return false;
    if (typeof Enchant !== 'undefined' && !Enchant.sameStackMeta(a, b)) return false;
    return a.count < maxStack(a.id);
  },

  insertIntoSlots(slots, stack, count = 1) {
    if (!stack || stack.count <= 0) return 0;
    const toMove = Math.min(count, stack.count);
    // First try merging into existing stacks
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s && this.canMerge(s, stack)) {
        const room = maxStack(s.id) - s.count;
        const k = Math.min(toMove, room);
        if (k > 0) {
          s.count += k;
          stack.count -= k;
          return k;
        }
      }
    }
    // Otherwise place in first empty slot
    for (let i = 0; i < slots.length; i++) {
      if (!slots[i]) {
        const k = Math.min(toMove, maxStack(stack.id));
        slots[i] = Trading.cloneStack(stack);
        slots[i].count = k;
        stack.count -= k;
        return k;
      }
    }
    return 0;
  },

  insertIntoSingleSlot(getSlot, setSlot, stack, count = 1) {
    if (!stack || stack.count <= 0) return 0;
    const toMove = Math.min(count, stack.count);
    const cur = getSlot();
    if (!cur) {
      const k = Math.min(toMove, maxStack(stack.id));
      const cloned = Trading.cloneStack(stack);
      cloned.count = k;
      setSlot(cloned);
      stack.count -= k;
      return k;
    }
    if (this.canMerge(cur, stack)) {
      const k = Math.min(toMove, maxStack(cur.id) - cur.count);
      if (k > 0) {
        cur.count += k;
        stack.count -= k;
        return k;
      }
    }
    return 0;
  },

  notifyComparators(game, x, y, z) {
    if (typeof Redstone !== 'undefined' && Redstone.updateComparatorsNear) {
      Redstone.updateComparatorsNear(game, x, y, z);
    }
  },

  pushOut(game, be) {
    const w = game.world;
    const [x, y, z] = be.pos;
    if (!Array.isArray(be.slots)) be.slots = new Array(5).fill(null);
    const hasAny = be.slots.some(Boolean);
    if (!hasAny) return false;

    const meta = w.getMeta(x, y, z) & 7;
    const dir = (meta === 0 || meta === 1 || meta === 4 || meta === 5) ? meta : 2;
    const D = DIRS[dir];
    const tx = x + D[0], ty = y + D[1], tz = z + D[2];
    if (ty < 0 || ty >= HEIGHT) return false;

    const tid = w.getBlock(tx, ty, tz);
    if (tid === 52 || tid === 513) {
      const targetBe = game.getBlockEntity(tx, ty, tz, tid === 52 ? 'chest' : 'hopper');
      for (let i = 0; i < 5; i++) {
        const st = be.slots[i];
        if (!st) continue;
        if (this.insertIntoSlots(targetBe.slots, st, 1) > 0) {
          if (st.count <= 0) be.slots[i] = null;
          if (tid === 513 && (targetBe.cooldown || targetBe.cd || 0) <= 0) {
            targetBe.cooldown = targetBe.cd = 8;
          }
          this.notifyComparators(game, x, y, z);
          this.notifyComparators(game, tx, ty, tz);
          return true;
        }
      }
      return false;
    }

    if (tid === 20 || tid === 117) {
      const fbe = game.getBlockEntity(tx, ty, tz, 'furnace');
      for (let i = 0; i < 5; i++) {
        const st = be.slots[i];
        if (!st) continue;
        if (dir === 2) {
          // Pointing down into top of furnace: smeltable items -> input; pure fuel -> fuel
          if (SMELTING[st.id]) {
            if (this.insertIntoSingleSlot(() => fbe.input, (v) => { fbe.input = v; }, st, 1) > 0) {
              if (st.count <= 0) be.slots[i] = null;
              this.notifyComparators(game, x, y, z);
              this.notifyComparators(game, tx, ty, tz);
              return true;
            }
          } else if (fuelValue(st.id) > 0) {
            if (this.insertIntoSingleSlot(() => fbe.fuel, (v) => { fbe.fuel = v; }, st, 1) > 0) {
              if (st.count <= 0) be.slots[i] = null;
              this.notifyComparators(game, x, y, z);
              this.notifyComparators(game, tx, ty, tz);
              return true;
            }
          }
        } else {
          // Pointing horizontally into side of furnace: fuel -> fuel; smeltable -> input if not fuel
          if (fuelValue(st.id) > 0) {
            if (this.insertIntoSingleSlot(() => fbe.fuel, (v) => { fbe.fuel = v; }, st, 1) > 0) {
              if (st.count <= 0) be.slots[i] = null;
              this.notifyComparators(game, x, y, z);
              this.notifyComparators(game, tx, ty, tz);
              return true;
            }
          } else if (SMELTING[st.id]) {
            if (this.insertIntoSingleSlot(() => fbe.input, (v) => { fbe.input = v; }, st, 1) > 0) {
              if (st.count <= 0) be.slots[i] = null;
              this.notifyComparators(game, x, y, z);
              this.notifyComparators(game, tx, ty, tz);
              return true;
            }
          }
        }
      }
      return false;
    }

    if (tid === 527 && typeof Brewing !== 'undefined') {
      const bbe = game.getBlockEntity(tx, ty, tz, 'brewing');
      for (let i = 0; i < 5; i++) {
        const st = be.slots[i];
        if (!st) continue;
        if (dir === 2 && Brewing.isIngredient(st.id)) {
          if (this.insertIntoSingleSlot(() => bbe.ingredient, (v) => { bbe.ingredient = v; }, st, 1) > 0) {
            if (st.count <= 0) be.slots[i] = null;
            this.notifyComparators(game, x, y, z);
            this.notifyComparators(game, tx, ty, tz);
            return true;
          }
        } else if (Brewing.isFuel(st.id)) {
          if (this.insertIntoSingleSlot(() => bbe.fuel, (v) => { bbe.fuel = v; }, st, 1) > 0) {
            if (st.count <= 0) be.slots[i] = null;
            this.notifyComparators(game, x, y, z);
            this.notifyComparators(game, tx, ty, tz);
            return true;
          }
        } else if (Brewing.isBottle(st.id)) {
          for (let bi = 0; bi < 3; bi++) {
            if (!bbe.bottles[bi]) {
              bbe.bottles[bi] = { id: st.id, count: 1, dmg: st.dmg || 0 };
              st.count--;
              if (st.count <= 0) be.slots[i] = null;
              this.notifyComparators(game, x, y, z);
              this.notifyComparators(game, tx, ty, tz);
              return true;
            }
          }
        }
      }
    }

    return false;
  },

  pullIn(game, be) {
    const w = game.world;
    const [x, y, z] = be.pos;
    if (!Array.isArray(be.slots)) be.slots = new Array(5).fill(null);

    const uy = y + 1;
    if (uy >= HEIGHT) return false;
    const uid = w.getBlock(x, uy, z);

    // 1. Pull from container directly above (Chest 52 or Hopper 513)
    if (uid === 52 || uid === 513) {
      const srcBe = game.getBlockEntity(x, uy, z, uid === 52 ? 'chest' : 'hopper');
      if (uid === 52) {
        const cm = w.getMeta(x, uy, z);
        if (cm & 8) { game.fillLoot(srcBe, x, uy, z, (cm >> 4) & 3); w.setMeta(x, uy, z, cm & 7); }
      }
      for (let i = 0; i < srcBe.slots.length; i++) {
        const st = srcBe.slots[i];
        if (!st) continue;
        if (this.insertIntoSlots(be.slots, st, 1) > 0) {
          if (st.count <= 0) srcBe.slots[i] = null;
          this.notifyComparators(game, x, uy, z);
          this.notifyComparators(game, x, y, z);
          return true;
        }
      }
      return false;
    }

    // 2. Pull from Brewing Stand above (completed potions when not actively brewing)
    if (uid === 527 && typeof Brewing !== 'undefined') {
      const bbe = game.getBlockEntity(x, uy, z, 'brewing');
      if (bbe && Array.isArray(bbe.bottles) && !Brewing.canBrew(bbe)) {
        for (let i = 0; i < 3; i++) {
          const st = bbe.bottles[i];
          if (!st) continue;
          const d = ITEMS[st.id];
          if (d && d.potion && d.potion !== 'water' && d.potion !== 'awkward') {
            if (this.insertIntoSlots(be.slots, st, 1) > 0) {
              if (st.count <= 0) bbe.bottles[i] = null;
              this.notifyComparators(game, x, uy, z);
              this.notifyComparators(game, x, y, z);
              return true;
            }
          }
        }
      }
      return false;
    }

    // 2b. Pull from Furnace above (output slot or empty bucket from fuel slot)
    if (uid === 20 || uid === 117) {
      const fbe = game.getBlockEntity(x, uy, z, 'furnace');
      if (fbe.output) {
        if (this.insertIntoSlots(be.slots, fbe.output, 1) > 0) {
          if (fbe.output.count <= 0) fbe.output = null;
          this.notifyComparators(game, x, uy, z);
          this.notifyComparators(game, x, y, z);
          return true;
        }
      }
      if (fbe.fuel && fbe.fuel.id === item('bucket')) {
        if (this.insertIntoSlots(be.slots, fbe.fuel, 1) > 0) {
          if (fbe.fuel.count <= 0) fbe.fuel = null;
          this.notifyComparators(game, x, uy, z);
          this.notifyComparators(game, x, y, z);
          return true;
        }
      }
      return false;
    }

    // 3. Otherwise suck in dropped ItemEntity above the hopper
    if (!SOLIDCUBE[uid]) {
      for (const e of game.entities) {
        if (e.dead || !(e instanceof ItemEntity) || !e.stack || e.stack.count <= 0) continue;
        if (e.pos[0] >= x - 0.15 && e.pos[0] <= x + 1.15 &&
            e.pos[2] >= z - 0.15 && e.pos[2] <= z + 1.15 &&
            e.pos[1] >= y + 0.5 && e.pos[1] <= y + 2.0) {
          let movedAny = false;
          while (e.stack.count > 0) {
            const moved = this.insertIntoSlots(be.slots, e.stack, e.stack.count);
            if (moved <= 0) break;
            movedAny = true;
          }
          if (e.stack.count <= 0) e.dead = true;
          if (movedAny) {
            this.notifyComparators(game, x, y, z);
            return true;
          }
        }
      }
    }

    return false;
  },

  tickAll(game) {
    const w = game.world;
    if (!w) return;
    for (const [, be] of game.blockEntities) {
      if (!be || be.type !== 'hopper') continue;
      const [x, y, z] = be.pos;
      if (!w.isLoaded(x, z)) continue;
      if (w.getBlock(x, y, z) !== 513) continue;
      // Redstone lock: if powered by redstone, hopper pauses transfer
      if (typeof Redstone !== 'undefined' && Redstone.isBlockPowered(w, x, y, z)) continue;
      let cd = Math.max(be.cooldown || 0, be.cd || 0);
      if (cd > 0) {
        cd--;
        be.cooldown = be.cd = cd;
        if (cd > 0) continue;
      }
      const pushed = this.pushOut(game, be);
      const pulled = this.pullIn(game, be);
      if (pushed || pulled) {
        be.cooldown = be.cd = 8;
      }
    }
  },
};
