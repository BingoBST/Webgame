'use strict';
// ---------------------------------------------------------------------------
// Enchanting System (Enchantment Registry, Enchanting Table, Anvil, Effects)
// Reference:
//   - https://minecraft.fandom.com/wiki/Enchanting
//   - https://minecraft.fandom.com/wiki/Enchanting_Table
//   - https://minecraft.fandom.com/wiki/Anvil_mechanics
// ---------------------------------------------------------------------------

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

const ENCHANTS = {
  // ---- Melee Weapons (Sword & Axe) ----------------------------------------
  sharpness: {
    key: 'sharpness', cn: '锋利', max: 5, weight: 10, anvilCost: 1,
    conflict: 'damage',
    tableItems: ['sword'],
    anvilItems: ['sword', 'axe'],
    minE: (l) => 1 + (l - 1) * 11,
    maxE: (l) => 21 + (l - 1) * 11,
  },
  smite: {
    key: 'smite', cn: '亡灵杀手', max: 5, weight: 5, anvilCost: 2,
    conflict: 'damage',
    tableItems: ['sword'],
    anvilItems: ['sword', 'axe'],
    minE: (l) => 5 + (l - 1) * 8,
    maxE: (l) => 25 + (l - 1) * 8,
  },
  bane_of_arthropods: {
    key: 'bane_of_arthropods', cn: '节肢杀手', max: 5, weight: 5, anvilCost: 2,
    conflict: 'damage',
    tableItems: ['sword'],
    anvilItems: ['sword', 'axe'],
    minE: (l) => 5 + (l - 1) * 8,
    maxE: (l) => 25 + (l - 1) * 8,
  },
  knockback: {
    key: 'knockback', cn: '击退', max: 2, weight: 5, anvilCost: 2,
    tableItems: ['sword'],
    anvilItems: ['sword'],
    minE: (l) => 5 + (l - 1) * 20,
    maxE: (l) => 55 + (l - 1) * 20,
  },
  fire_aspect: {
    key: 'fire_aspect', cn: '火焰附加', max: 2, weight: 2, anvilCost: 4,
    tableItems: ['sword'],
    anvilItems: ['sword'],
    minE: (l) => 10 + (l - 1) * 20,
    maxE: (l) => 60 + (l - 1) * 20,
  },
  looting: {
    key: 'looting', cn: '抢夺', max: 3, weight: 2, anvilCost: 4,
    tableItems: ['sword'],
    anvilItems: ['sword'],
    minE: (l) => 15 + (l - 1) * 9,
    maxE: (l) => 65 + (l - 1) * 9,
  },

  // ---- Mining Tools (Pickaxe, Axe, Shovel, Hoe, Shears) --------------------
  efficiency: {
    key: 'efficiency', cn: '效率', max: 5, weight: 10, anvilCost: 1,
    tableItems: ['pickaxe', 'axe', 'shovel', 'hoe'],
    anvilItems: ['pickaxe', 'axe', 'shovel', 'hoe', 'shears'],
    minE: (l) => 1 + (l - 1) * 10,
    maxE: (l) => 51 + (l - 1) * 10,
  },
  silk_touch: {
    key: 'silk_touch', cn: '精准采集', max: 1, weight: 1, anvilCost: 8,
    conflict: 'mine_drop',
    tableItems: ['pickaxe', 'axe', 'shovel', 'hoe'],
    anvilItems: ['pickaxe', 'axe', 'shovel', 'hoe'],
    minE: () => 15,
    maxE: () => 65,
  },
  fortune: {
    key: 'fortune', cn: '时运', max: 3, weight: 2, anvilCost: 4,
    conflict: 'mine_drop',
    tableItems: ['pickaxe', 'axe', 'shovel', 'hoe'],
    anvilItems: ['pickaxe', 'axe', 'shovel', 'hoe'],
    minE: (l) => 15 + (l - 1) * 9,
    maxE: (l) => 65 + (l - 1) * 9,
  },

  // ---- Universal Durability -----------------------------------------------
  unbreaking: {
    key: 'unbreaking', cn: '耐久', max: 3, weight: 5, anvilCost: 2,
    tableItems: ['sword', 'pickaxe', 'axe', 'shovel', 'hoe', 'bow', 'helmet', 'chestplate', 'leggings', 'boots'],
    anvilItems: ['sword', 'pickaxe', 'axe', 'shovel', 'hoe', 'bow', 'shears', 'flint_and_steel', 'helmet', 'chestplate', 'leggings', 'boots'],
    minE: (l) => 5 + (l - 1) * 8,
    maxE: (l) => 55 + (l - 1) * 8,
  },

  // ---- Armor ---------------------------------------------------------------
  protection: {
    key: 'protection', cn: '保护', max: 4, weight: 10, anvilCost: 1,
    conflict: 'protect',
    tableItems: ['helmet', 'chestplate', 'leggings', 'boots'],
    anvilItems: ['helmet', 'chestplate', 'leggings', 'boots'],
    minE: (l) => 1 + (l - 1) * 11,
    maxE: (l) => 12 + (l - 1) * 11,
  },
  fire_protection: {
    key: 'fire_protection', cn: '火焰保护', max: 4, weight: 5, anvilCost: 2,
    conflict: 'protect',
    tableItems: ['helmet', 'chestplate', 'leggings', 'boots'],
    anvilItems: ['helmet', 'chestplate', 'leggings', 'boots'],
    minE: (l) => 10 + (l - 1) * 8,
    maxE: (l) => 18 + (l - 1) * 8,
  },
  blast_protection: {
    key: 'blast_protection', cn: '爆炸保护', max: 4, weight: 2, anvilCost: 4,
    conflict: 'protect',
    tableItems: ['helmet', 'chestplate', 'leggings', 'boots'],
    anvilItems: ['helmet', 'chestplate', 'leggings', 'boots'],
    minE: (l) => 5 + (l - 1) * 8,
    maxE: (l) => 13 + (l - 1) * 8,
  },
  projectile_protection: {
    key: 'projectile_protection', cn: '弹射物保护', max: 4, weight: 5, anvilCost: 2,
    conflict: 'protect',
    tableItems: ['helmet', 'chestplate', 'leggings', 'boots'],
    anvilItems: ['helmet', 'chestplate', 'leggings', 'boots'],
    minE: (l) => 3 + (l - 1) * 6,
    maxE: (l) => 9 + (l - 1) * 6,
  },
  feather_falling: {
    key: 'feather_falling', cn: '摔落缓冲', max: 4, weight: 5, anvilCost: 2,
    tableItems: ['boots'],
    anvilItems: ['boots'],
    minE: (l) => 5 + (l - 1) * 6,
    maxE: (l) => 11 + (l - 1) * 6,
  },
  respiration: {
    key: 'respiration', cn: '水下呼吸', max: 3, weight: 2, anvilCost: 4,
    tableItems: ['helmet'],
    anvilItems: ['helmet'],
    minE: (l) => 10 * l,
    maxE: (l) => 10 * l + 30,
  },
  aqua_affinity: {
    key: 'aqua_affinity', cn: '水下速掘', max: 1, weight: 2, anvilCost: 4,
    tableItems: ['helmet'],
    anvilItems: ['helmet'],
    minE: () => 1,
    maxE: () => 41,
  },
  depth_strider: {
    key: 'depth_strider', cn: '深海探索者', max: 3, weight: 2, anvilCost: 4,
    tableItems: ['boots'],
    anvilItems: ['boots'],
    minE: (l) => 10 * l,
    maxE: (l) => 10 * l + 15,
  },
  thorns: {
    key: 'thorns', cn: '荆棘', max: 3, weight: 1, anvilCost: 8,
    tableItems: ['chestplate'],
    anvilItems: ['helmet', 'chestplate', 'leggings', 'boots'],
    minE: (l) => 10 + 20 * (l - 1),
    maxE: (l) => 60 + 20 * (l - 1),
  },

  // ---- Bow -----------------------------------------------------------------
  power: {
    key: 'power', cn: '力量', max: 5, weight: 10, anvilCost: 1,
    tableItems: ['bow'],
    anvilItems: ['bow'],
    minE: (l) => 1 + (l - 1) * 10,
    maxE: (l) => 16 + (l - 1) * 10,
  },
  punch: {
    key: 'punch', cn: '冲击', max: 2, weight: 2, anvilCost: 4,
    tableItems: ['bow'],
    anvilItems: ['bow'],
    minE: (l) => 12 + (l - 1) * 20,
    maxE: (l) => 37 + (l - 1) * 20,
  },
  flame: {
    key: 'flame', cn: '火矢', max: 1, weight: 2, anvilCost: 4,
    tableItems: ['bow'],
    anvilItems: ['bow'],
    minE: () => 20,
    maxE: () => 50,
  },
  infinity: {
    key: 'infinity', cn: '无限', max: 1, weight: 1, anvilCost: 8,
    tableItems: ['bow'],
    anvilItems: ['bow'],
    minE: () => 20,
    maxE: () => 50,
  },
};

const GALACTIC_WORDS = [
  'klaatu', 'berata', 'niktu', 'xyzzy', 'fhtagn', 'elder', 'scrolls', 'elementary',
  'galactic', 'arcane', 'mystic', 'ether', 'void', 'nexus', 'astral', 'spirit',
  'sphere', 'cthulhu', 'ignite', 'daemon', 'glyph', 'sigil', 'chant', 'curse'
];

const Enchant = {
  ENCHANTS,
  ROMAN,

  // Return item category ('sword', 'pickaxe', 'helmet', 'bow', 'book', etc.)
  itemCategory(id) {
    const d = ITEMS[id];
    if (!d) return null;
    if (d.tool) return d.tool.type;
    if (d.armor) return ['helmet', 'chestplate', 'leggings', 'boots'][d.armor.slot];
    if (d.key === 'bow' || d.key === 'book' || d.key === 'enchanted_book' || d.key === 'shears' || d.key === 'flint_and_steel') return d.key;
    return null;
  },

  // Return official Minecraft Wiki enchantability value for an item
  enchantability(id) {
    const d = ITEMS[id];
    if (!d) return 0;
    const k = d.key;
    if (k === 'book' || k === 'bow') return 1;
    if (k.startsWith('wooden_')) return 15;
    if (k.startsWith('stone_')) return 5;
    if (k.startsWith('iron_')) return d.armor ? 9 : 14;
    if (k.startsWith('golden_')) return d.armor ? 25 : 22;
    if (k.startsWith('diamond_')) return 10;
    if (k.startsWith('leather_')) return 15;
    return 0;
  },

  canTableEnchant(stack) {
    if (!stack || stack.count !== 1) return false;
    if (stack.ench && Object.keys(stack.ench).length > 0) return false;
    return this.enchantability(stack.id) > 0;
  },

  canApplyTable(enchKey, id) {
    const e = ENCHANTS[enchKey];
    if (!e) return false;
    const cat = this.itemCategory(id);
    if (cat === 'book') return true;
    return e.tableItems.includes(cat);
  },

  canApplyAnvil(enchKey, id) {
    const e = ENCHANTS[enchKey];
    if (!e) return false;
    const cat = this.itemCategory(id);
    if (cat === 'enchanted_book') return true;
    return e.anvilItems.includes(cat);
  },

  conflicts(enchA, enchB) {
    if (enchA === enchB) return false;
    const a = ENCHANTS[enchA], b = ENCHANTS[enchB];
    if (!a || !b) return false;
    return !!(a.conflict && a.conflict === b.conflict);
  },

  hasEnch(stack) {
    if (!stack) return false;
    if (ITEMS[stack.id] && ITEMS[stack.id].key === 'enchanted_book') return true;
    return !!(stack.ench && Object.keys(stack.ench).length > 0);
  },

  level(stack, key) {
    return (stack && stack.ench && stack.ench[key]) || 0;
  },

  formatEnch(key, lvl) {
    const e = ENCHANTS[key];
    if (!e) return key + ' ' + lvl;
    if (e.max === 1) return e.cn;
    return e.cn + ' ' + (ROMAN[lvl] || lvl);
  },

  // Clone stack preserving ench, name, and cost
  cloneStack(stack, countOverride) {
    if (!stack) return null;
    const out = { id: stack.id, count: countOverride ?? stack.count, dmg: stack.dmg || 0 };
    if (stack.ench && Object.keys(stack.ench).length > 0) out.ench = { ...stack.ench };
    if (stack.name) out.name = stack.name;
    if (stack.cost) out.cost = stack.cost;
    return out;
  },

  sameStackMeta(a, b) {
    if (!a || !b || a.id !== b.id) return false;
    if ((a.name || '') !== (b.name || '')) return false;
    const ea = a.ench ? Object.keys(a.ench) : [];
    const eb = b.ench ? Object.keys(b.ench) : [];
    if (ea.length !== eb.length) return false;
    for (const k of ea) if (a.ench[k] !== b.ench[k]) return false;
    return true;
  },

  // Count bookshelves around an Enchanting Table at (x, y, z), max 15
  // Official Wiki: 16 horizontal positions at Chebyshev distance 2, dy = 0 or 1,
  // with air required at the intermediate block between the table and bookshelf.
  countBookshelves(world, x, y, z) {
    let count = 0;
    const positions = [];
    for (let dy = 0; dy <= 1; dy++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== 2) continue;
          if (world.getBlock(x + dx, y + dy, z + dz) !== 25) continue; // 25 = bookshelf
          // Check intermediate air block
          const mx = x + Math.trunc(dx / 2), mz = z + Math.trunc(dz / 2);
          if (world.getBlock(mx, y + dy, mz) !== 0) continue;
          positions.push([x + dx, y + dy, z + dz]);
          count++;
        }
      }
    }
    return { count: Math.min(15, count), positions };
  },

  // Generate the 3 Enchanting Table options for a given item stack and bookshelf count (0..15)
  getTableOptions(player, stack, bookshelves) {
    if (!this.canTableEnchant(stack)) return [null, null, null];
    const b = clamp(bookshelves, 0, 15);
    const seedBase = (player.enchantSeed || (player.enchantSeed = 1337)) ^ (stack.id * 7919);
    const r = RNG(seedBase);
    const base = 1 + r.int(8) + Math.floor(b / 2) + r.int(b + 1);
    const slotLevels = [
      Math.max(Math.floor(base / 3), 1),
      Math.floor(base * 2 / 3) + 1,
      Math.max(base, b * 2),
    ];
    return slotLevels.map((reqLevel, slotIdx) => {
      const sr = RNG(seedBase + (slotIdx + 1) * 104729 + reqLevel * 31);
      const ench = this.rollEnchantments(sr, stack.id, reqLevel);
      const keys = Object.keys(ench);
      if (!keys.length) return null;
      const firstKey = keys[0];
      const w1 = GALACTIC_WORDS[sr.int(GALACTIC_WORDS.length)];
      const w2 = GALACTIC_WORDS[sr.int(GALACTIC_WORDS.length)];
      return {
        slot: slotIdx,
        reqLevel,
        lapisCost: slotIdx + 1,
        ench,
        preview: this.formatEnch(firstKey, ench[firstKey]) + ' … ?',
        words: w1 + ' ' + w2,
      };
    });
  },

  rollEnchantments(r, id, level) {
    const E = this.enchantability(id);
    if (E <= 0) return {};
    // Modified enchantment level
    const randEnch = 1 + r.int(Math.floor(E / 4) + 1) + r.int(Math.floor(E / 4) + 1);
    const k = level + randEnch;
    const bonus = 1 + (r() + r() - 1) * 0.15;
    let m = Math.max(1, Math.round(k * bonus));

    const getCandidates = (modLvl) => {
      const list = [];
      for (const ek in ENCHANTS) {
        if (!this.canApplyTable(ek, id)) continue;
        const def = ENCHANTS[ek];
        let bestLvl = 0;
        for (let l = def.max; l >= 1; l--) {
          if (modLvl >= def.minE(l) && modLvl <= def.maxE(l)) { bestLvl = l; break; }
        }
        // Fallback if modified level exceeds maxE of highest power: allow max level at high table levels
        if (!bestLvl && modLvl > def.maxE(def.max) && modLvl <= def.maxE(def.max) + 25) bestLvl = def.max;
        if (bestLvl > 0) list.push({ key: ek, lvl: bestLvl, weight: def.weight });
      }
      return list;
    };

    let cands = getCandidates(m);
    if (!cands.length) {
      // Ensure at least one valid basic enchantment is offered
      const fallback = Object.keys(ENCHANTS).filter(ek => this.canApplyTable(ek, id));
      if (!fallback.length) return {};
      const pick = fallback[r.int(fallback.length)];
      return { [pick]: 1 };
    }

    const pickWeighted = (list) => {
      let total = 0;
      for (const c of list) total += c.weight;
      let roll = r() * total;
      for (const c of list) {
        roll -= c.weight;
        if (roll <= 0) return c;
      }
      return list[list.length - 1];
    };

    const chosen = {};
    const first = pickWeighted(cands);
    chosen[first.key] = first.lvl;

    // Extra enchantments loop: P = (m + 1) / 50, then m = floor(m / 2)
    while (r.int(50) <= m) {
      cands = cands.filter(c => !chosen[c.key] && !Object.keys(chosen).some(ck => this.conflicts(c.key, ck)));
      if (!cands.length) break;
      const next = pickWeighted(cands);
      chosen[next.key] = next.lvl;
      m = Math.floor(m / 2);
    }

    // On books, if multiple enchantments were rolled, keep at most 1-2 as per vanilla behavior
    if (ITEMS[id] && ITEMS[id].key === 'book') {
      const ks = Object.keys(chosen);
      if (ks.length > 2) delete chosen[ks[r.int(ks.length)]];
    }
    return chosen;
  },

  // Repair material lookup for unit repair on Anvil
  isRepairMaterial(itemId, matId) {
    const d = ITEMS[itemId], m = ITEMS[matId];
    if (!d || !m || !d.durability) return false;
    const k = d.key, mk = m.key;
    if (k.startsWith('wooden_')) return mk.endsWith('_planks');
    if (k.startsWith('stone_')) return mk === 'cobblestone';
    if (k.startsWith('iron_') || k === 'shears' || k === 'flint_and_steel') return mk === 'iron_ingot';
    if (k.startsWith('golden_')) return mk === 'gold_ingot';
    if (k.startsWith('diamond_')) return mk === 'diamond';
    if (k.startsWith('leather_')) return mk === 'leather';
    return false;
  },

  priorPenalty(ops) {
    return ops > 0 ? (1 << Math.min(10, ops)) - 1 : 0;
  },

  // Compute Anvil output, XP level cost, and right-slot consumption
  computeAnvil(left, right, customName, creative = false) {
    if (!left) return null;
    const def = ITEMS[left.id];
    if (!def) return null;

    const out = this.cloneStack(left);
    let opCost = 0;
    let takeRight = 0;
    const leftOps = left.cost || 0;
    const rightOps = (right && right.cost) || 0;
    const penalty = this.priorPenalty(leftOps) + (right ? this.priorPenalty(rightOps) : 0);

    const trimmedName = (customName ?? '').trim();
    const defaultName = def.cn;
    const curName = left.name || defaultName;
    const renamed = trimmedName !== curName && !(trimmedName === '' && !left.name);

    if (right) {
      const rDef = ITEMS[right.id];
      const isBook = rDef && rDef.key === 'enchanted_book';

      if (this.isRepairMaterial(left.id, right.id)) {
        // Unit repair with material (25% max durability per unit)
        if ((out.dmg || 0) <= 0) return null;
        const step = Math.max(1, Math.ceil(def.durability / 4));
        let dmg = out.dmg || 0;
        let used = 0;
        while (dmg > 0 && used < right.count) {
          dmg = Math.max(0, dmg - step);
          used++;
          opCost += 1;
        }
        out.dmg = dmg;
        takeRight = used;
      } else if (right.id === left.id && def.durability) {
        // Combining two identical damageable items (+12% max durability bonus)
        if ((out.dmg || 0) > 0) {
          const leftRem = def.durability - (out.dmg || 0);
          const rightRem = def.durability - (right.dmg || 0);
          const bonus = Math.floor(def.durability * 0.12);
          const newRem = Math.min(def.durability, leftRem + rightRem + bonus);
          if (newRem > leftRem) {
            out.dmg = def.durability - newRem;
            opCost += 2;
          }
        }
        takeRight = 1;
        // Also merge enchantments from right
        if (right.ench) {
          const mergeRes = this.mergeEnchants(out, right.ench, false);
          if (!mergeRes.any && opCost === 0 && !renamed) return { error: true, cost: 0 };
          opCost += mergeRes.cost;
        }
      } else if (isBook && right.ench && Object.keys(right.ench).length > 0) {
        // Applying an Enchanted Book to target item (or combining two Enchanted Books)
        const mergeRes = this.mergeEnchants(out, right.ench, true);
        if (!mergeRes.any) return { error: true, cost: 0 };
        opCost += mergeRes.cost;
        takeRight = 1;
      } else {
        return { error: true, cost: 0 };
      }
    }

    if (renamed) {
      opCost += 1;
      if (trimmedName === '' || trimmedName === defaultName) delete out.name;
      else out.name = trimmedName;
    }

    if (opCost <= 0) return null;

    let totalCost = opCost + penalty;
    if (renamed && opCost === 1 && !right && totalCost >= 40) totalCost = 39;
    if (!creative && totalCost >= 40) return { error: true, cost: totalCost, tooExpensive: true };

    out.cost = (right ? Math.max(leftOps, rightOps) : leftOps) + 1;
    return { out, cost: totalCost, takeRight };
  },

  mergeEnchants(targetStack, rightEnch, fromBook) {
    if (!targetStack.ench) targetStack.ench = {};
    const outEnch = targetStack.ench;
    let cost = 0;
    let any = false;
    for (const ek in rightEnch) {
      const def = ENCHANTS[ek];
      if (!def) continue;
      if (!this.canApplyAnvil(ek, targetStack.id)) continue;
      const conflict = Object.keys(outEnch).some(ck => this.conflicts(ek, ck));
      if (conflict) {
        cost += 1;
        continue;
      }
      const lLvl = outEnch[ek] || 0;
      const rLvl = rightEnch[ek];
      const newLvl = (lLvl === rLvl) ? Math.min(def.max, rLvl + 1) : Math.max(lLvl, rLvl);
      if (newLvl !== lLvl || lLvl > 0) {
        if (newLvl > lLvl) any = true;
        else if (lLvl === rLvl && lLvl === def.max) any = true;
        outEnch[ek] = newLvl;
        const mult = fromBook ? Math.max(1, def.anvilCost >> 1) : def.anvilCost;
        cost += newLvl * mult;
      }
    }
    return { cost, any };
  },

  // Create an Enchanted Book stack with given enchantments
  makeBook(enchObj) {
    return { id: item('enchanted_book'), count: 1, dmg: 0, ench: { ...enchObj } };
  },

  // Roll a random Enchanted Book for structure loot chests
  randomLootBook(r) {
    const keys = Object.keys(ENCHANTS);
    const ek = keys[r.int(keys.length)];
    const def = ENCHANTS[ek];
    const lvl = 1 + r.int(def.max);
    return this.makeBook({ [ek]: lvl });
  },

  // ---- Gameplay Effect Helpers ---------------------------------------------
  // Bonus melee damage from Sharpness / Smite / Bane of Arthropods
  meleeBonus(stack, targetMob) {
    if (!stack || !stack.ench) return 0;
    let bonus = 0;
    const sharp = stack.ench.sharpness || 0;
    if (sharp > 0) bonus += 0.5 * sharp + 0.5;
    const type = targetMob && targetMob.type;
    const smite = stack.ench.smite || 0;
    if (smite > 0 && (type === 'zombie' || type === 'skeleton')) bonus += 2.5 * smite;
    const bane = stack.ench.bane_of_arthropods || 0;
    if (bane > 0 && type === 'spider') bonus += 2.5 * bane;
    return bonus;
  },

  // Total EPF (Enchantment Protection Factor, capped at 20 -> 80% reduction) across worn armor
  armorEPF(inv, src) {
    const type = src && src.type;
    if (type === 'void' || type === 'starve' || type === 'drown') return 0;
    let epf = 0;
    for (let i = 36; i < 40; i++) {
      const s = inv.slots[i];
      if (!s || !s.ench) continue;
      if (s.ench.protection) epf += s.ench.protection;
      if (s.ench.fire_protection && (type === 'fire' || type === 'lava')) epf += s.ench.fire_protection * 2;
      if (s.ench.blast_protection && type === 'explosion') epf += s.ench.blast_protection * 2;
      if (s.ench.projectile_protection && type === 'arrow') epf += s.ench.projectile_protection * 2;
      if (s.ench.feather_falling && type === 'fall') epf += s.ench.feather_falling * 3;
    }
    return Math.min(20, epf);
  },

  maxArmorEnch(inv, key) {
    let best = 0;
    for (let i = 36; i < 40; i++) {
      const s = inv.slots[i];
      if (s && s.ench && s.ench[key] > best) best = s.ench[key];
    }
    return best;
  },

  // Unbreaking durability check: returns how many durability points to actually consume
  rollDurabilityLoss(stack, amount, isArmor = false) {
    const unb = this.level(stack, 'unbreaking');
    if (unb <= 0) return amount;
    let loss = 0;
    for (let i = 0; i < amount; i++) {
      if (isArmor) {
        if (Math.random() < 0.6 + 0.4 / (unb + 1)) loss++;
      } else {
        if (Math.random() < 1 / (unb + 1)) loss++;
      }
    }
    return loss;
  },
};

if (typeof window !== 'undefined') {
  window.Enchant = Enchant;
  window.ENCHANTS = ENCHANTS;
}
