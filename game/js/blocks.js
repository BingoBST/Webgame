'use strict';
// ---------------------------------------------------------------------------
// Block & item registry, recipes, smelting, brewing
// ---------------------------------------------------------------------------
function T(name) {
  const l = ASSETS.tiles[name];
  if (l === undefined) { console.warn('missing tile', name); return ASSETS.tiles.white; }
  return l;
}

const MAX_BLOCK_ID = 1024;
const BLOCKS = new Array(MAX_BLOCK_ID).fill(null);
const ITEMS = [];          // id -> item def (blocks + items)
const ITEM_KEY = {};       // key -> id
const BID = {};            // block key -> id
let nextIconIdx = 0;       // compact 0..N-1 icon index for iconAtlas

// Shape constants
const SH_CUBE = 0, SH_CROSS = 1, SH_LIQUID = 2, SH_BOXES = 3, SH_TORCH = 4, SH_NONE = 5, SH_CROP = 6, SH_CACTUS = 7, SH_MODEL = 8, SH_WIRE = 9;

function defBlock(id, key, cn, o = {}) {
  if (!Number.isInteger(id) || id < 0 || id >= MAX_BLOCK_ID) throw new Error('Block ID out of range (0..' + (MAX_BLOCK_ID - 1) + '): ' + id);
  if (id >= 256 && id < 512) throw new Error('Block ID ' + id + ' conflicts with standalone item range 256..511; use >= 512');
  if (BLOCKS[id] && BLOCKS[id].key !== key && !o.allowOverride) throw new Error('Duplicate block ID: ' + id + ' (' + key + ')');
  const shape = o.shape ?? SH_CUBE;
  const b = {
    id, key, cn, shape,
    render: o.render || (shape === SH_CUBE ? 'opaque' : 'cutout'),
    solid: o.solid ?? (shape === SH_CUBE || shape === SH_BOXES || shape === SH_CACTUS || shape === SH_MODEL),
    model: o.model || null, bed: !!o.bed,
    opaque: false,
    light: o.light || 0,
    hardness: o.hardness ?? 1,
    tool: o.tool || null, level: o.level || 0, needsTool: o.needsTool ?? false,
    sound: o.sound || 'stone',
    tint: o.tint || null,
    gravity: !!o.gravity,
    replaceable: !!o.replaceable,
    cullSame: !!o.cullSame,
    drops: o.drops,
    boxes: o.boxes || null,
    climbable: !!o.climbable,
    facing: !!o.facing, axis: !!o.axis,
    needsSupport: !!o.needsSupport,
    onUse: o.onUse || null,
    flammable: !!o.flammable,
    texFn: o.texFn || null,
    fuel: o.fuel || 0,
    noItem: !!o.noItem,
    icon: o.icon || null,
    damage: o.damage || 0,
    slip: o.slip || 0.6,
    tex: [0, 0, 0, 0, 0, 0], overlay: [0, 0, 0, 0, 0, 0],
    particle: 0,
    slab: !!o.slab, stairs: !!o.stairs, door: !!o.door, trapdoor: !!o.trapdoor, ladder: !!o.ladder,
    redstone: !!o.redstone, button: !!o.button, plate: !!o.plate, lever: !!o.lever, repeater: !!o.repeater,
    comparator: !!o.comparator, observer: !!o.observer, piston: !!o.piston, sticky: !!o.sticky, pistonHead: !!o.pistonHead,
    fence: !!o.fence, rail: !!o.rail, web: !!o.web, hopper: !!o.hopper, brewing: !!o.brewing,
  };
  b.opaque = o.opaque ?? (shape === SH_CUBE && b.render === 'opaque');
  b.opacity = o.opacity ?? (b.opaque ? 15 : 0);
  const t = o.tex;
  if (typeof t === 'string') b.tex.fill(T(t));
  else if (t) {
    const side = t.side ? T(t.side) : 0;
    b.tex = [side, side, T(t.bottom || t.top || t.side), T(t.top || t.side), side, side];
    if (t.front) b.texFront = T(t.front);
    if (t.frontOn) b.texFrontOn = T(t.frontOn);
  }
  if (o.overlay) b.overlay = [T(o.overlay), T(o.overlay), 0, 0, T(o.overlay), T(o.overlay)];
  b.particle = o.particle ? T(o.particle) : b.tex[0];
  if (b.texFront && !o.texFn) {
    b.texFn = (face, meta) => (face === (meta & 7) ? ((meta & 8) && b.texFrontOn ? b.texFrontOn : b.texFront) : b.tex[face]);
  }
  BLOCKS[id] = b; BID[key] = id;
  if (!b.noItem) {
    if (ITEMS[id] && ITEMS[id].key !== key && !o.allowOverride) throw new Error('Item ID collision at ' + id + ' (' + key + ')');
    const iconIdx = (ITEMS[id] && ITEMS[id].iconIdx !== undefined) ? ITEMS[id].iconIdx : nextIconIdx++;
    ITEMS[id] = { id, key, cn, block: id, stack: o.stack || 64, fuel: b.fuel, flat: o.flatIcon || null, iconIdx };
    ITEM_KEY[key] = id;
  }
  if (typeof syncBlockProps === 'function') syncBlockProps(id);
  if (typeof window !== 'undefined' && window.game && window.game.worker && typeof window.game.worker.syncBlock === 'function') {
    window.game.worker.syncBlock(id);
  }
  return b;
}

// ---- helpers for drops -----------------------------------------------------
const drop = (key, n = 1) => () => [[key, n]];
const nothing = () => [];

// Axis textures: logs rotate their texture
function logTex(face, meta) {
  const a = meta & 3; // 0 y, 1 x, 2 z
  const b = this;
  if (a === 0) return b.tex[face];
  if (a === 1) return (face === 0 || face === 1) ? b.tex[3] : b.tex[0];
  return (face === 4 || face === 5) ? b.tex[3] : b.tex[0];
}

// Box shapes (units of 1/16)
const SLAB_BOXES = [[[0, 0, 0, 16, 8, 16]], [[0, 8, 0, 16, 16, 16]], [[0, 0, 0, 16, 16, 16]]];
function stairBoxes(meta) {
  const f = meta & 3, top = meta & 4;
  const base = top ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16];
  const y0 = top ? 0 : 8, y1 = top ? 8 : 16;
  // f: 0 = high side east(+x), 1 = west(-x), 2 = south(+z), 3 = north(-z)
  const step = [[8, y0, 0, 16, y1, 16], [0, y0, 0, 8, y1, 16], [0, y0, 8, 16, y1, 16], [0, y0, 0, 16, y1, 8]][f];
  return [base, step];
}
function doorBoxes(meta) {
  // meta: bits0-1 facing (0 E,1 W,2 S,3 N) bit2 open, bit3 upper
  let f = meta & 3;
  if (meta & 4) f = [2, 3, 1, 0][f];
  return [[[0, 0, 0, 3, 16, 16], [13, 0, 0, 16, 16, 16], [0, 0, 0, 16, 16, 3], [0, 0, 13, 16, 16, 16]][f]];
}
function ladderBoxes(meta) {
  // meta = dir index of the wall it's attached to
  return [{ 0: [0, 0, 0, 2, 16, 16], 1: [14, 0, 0, 16, 16, 16], 4: [0, 0, 0, 16, 16, 2], 5: [0, 0, 14, 16, 16, 16] }[meta] || [0, 0, 0, 16, 16, 2]];
}
function buttonBoxes(meta) {
  // bits 0-2: support dir (0 -x, 1 +x, 2 -y, 3 +y, 4 -z, 5 +z), bit 3: pressed
  const att = meta & 7, d = (meta & 8) ? 1 : 2;
  switch (att) {
    case 0: return [[0, 6, 5, d, 10, 11]];
    case 1: return [[16 - d, 6, 5, 16, 10, 11]];
    case 3: return [[5, 16 - d, 6, 11, 16, 10]];
    case 4: return [[5, 6, 0, 11, 10, d]];
    case 5: return [[5, 6, 16 - d, 11, 10, 16]];
    default: return [[5, 0, 6, 11, d, 10]]; // 2 = floor
  }
}
function leverBoxes(meta) {
  // bits 0-2: support dir (2 floor, 3 ceiling, 0 -x, 1 +x, 4 -z, 5 +z), bit 3: active (ON)
  const att = meta & 7, on = !!(meta & 8);
  switch (att) {
    case 0: return [[0, 4, 5, 3, 12, 11], on ? [3, 4, 7, 10, 6, 9] : [3, 10, 7, 10, 12, 9]];
    case 1: return [[13, 4, 5, 16, 12, 11], on ? [6, 4, 7, 13, 6, 9] : [6, 10, 7, 13, 12, 9]];
    case 3: return [[5, 13, 4, 11, 16, 12], on ? [7, 6, 9, 9, 13, 11] : [7, 6, 5, 9, 13, 7]];
    case 4: return [[5, 4, 0, 11, 12, 3], on ? [7, 4, 3, 9, 6, 10] : [7, 10, 3, 9, 12, 10]];
    case 5: return [[5, 4, 13, 11, 12, 16], on ? [7, 4, 6, 9, 6, 13] : [7, 10, 6, 9, 12, 13]];
    default: return [[5, 0, 4, 11, 3, 12], on ? [7, 3, 9, 9, 10, 11] : [7, 3, 5, 9, 10, 7]];
  }
}
function repeaterModel(meta, lit) {
  const rot = meta & 3;
  const delay = (meta >> 2) & 3; // 0..3 -> torch z position 5, 7, 9, 11
  const topTex = T(lit ? 'repeater_on' : 'repeater');
  const sideTex = T('smooth_stone_slab_side');
  const botTex = T('smooth_stone');
  const torchTex = T(lit ? 'redstone_torch' : 'redstone_torch_off');
  const zBack = 5 + delay * 2;
  const torchEl = (z0) => ({
    from: [7, 2, z0], to: [9, 7, z0 + 2],
    faces: {
      up: [7, 5, 9, 7, torchTex],
      north: [7, 6, 9, 11, torchTex],
      south: [7, 6, 9, 11, torchTex],
      west: [7, 6, 9, 11, torchTex],
      east: [7, 6, 9, 11, torchTex],
    }
  });
  return {
    rot,
    els: [
      {
        from: [0, 0, 0], to: [16, 2, 16],
        faces: {
          down: [0, 0, 16, 16, botTex],
          up: [0, 0, 16, 16, topTex],
          north: [0, 14, 16, 16, sideTex],
          south: [0, 14, 16, 16, sideTex],
          west: [0, 14, 16, 16, sideTex],
          east: [0, 14, 16, 16, sideTex],
        }
      },
      torchEl(1),
      torchEl(zBack),
    ]
  };
}
function comparatorModel(meta) {
  const rot = meta & 3;
  const sub = !!(meta & 4);
  const lit = !!(meta & 8) || ((meta >> 4) & 15) > 0;
  const topTex = T(lit ? 'comparator_on' : 'comparator');
  const sideTex = T('smooth_stone_slab_side');
  const botTex = T('smooth_stone');
  const frontTorchTex = T(sub ? 'redstone_torch' : 'redstone_torch_off');
  const backTorchTex = T(lit ? 'redstone_torch' : 'redstone_torch_off');
  const mkTorch = (x0, z0, y1, tex) => ({
    from: [x0, 2, z0], to: [x0 + 2, y1, z0 + 2],
    faces: {
      up: [7, 5, 9, 7, tex],
      north: [7, 6, 9, 11, tex],
      south: [7, 6, 9, 11, tex],
      west: [7, 6, 9, 11, tex],
      east: [7, 6, 9, 11, tex],
    }
  });
  return {
    rot,
    els: [
      {
        from: [0, 0, 0], to: [16, 2, 16],
        faces: {
          down: [0, 0, 16, 16, botTex],
          up: [0, 0, 16, 16, topTex],
          north: [0, 14, 16, 16, sideTex],
          south: [0, 14, 16, 16, sideTex],
          west: [0, 14, 16, 16, sideTex],
          east: [0, 14, 16, 16, sideTex],
        }
      },
      mkTorch(7, 2, sub ? 6 : 5, frontTorchTex),
      mkTorch(3, 11, 7, backTorchTex),
      mkTorch(11, 11, 7, backTorchTex),
    ]
  };
}
function observerTex(face, meta) {
  const f = meta & 7, b = [1, 0, 3, 2, 5, 4][f];
  if (face === f) return T('observer_front');
  if (face === b) return T((meta & 8) ? 'observer_back_on' : 'observer_back');
  if (face === 2 || face === 3) return T('observer_top');
  return T('observer_side');
}
function pistonBoxes(meta) {
  const dir = meta & 7, ext = !!(meta & 8);
  if (!ext) return [[0, 0, 0, 16, 16, 16]];
  if (dir === 0) return [[4, 0, 0, 16, 16, 16]];
  if (dir === 1) return [[0, 0, 0, 12, 16, 16]];
  if (dir === 2) return [[0, 4, 0, 16, 16, 16]];
  if (dir === 3) return [[0, 0, 0, 16, 12, 16]];
  if (dir === 4) return [[0, 0, 4, 16, 16, 16]];
  return [[0, 0, 0, 16, 16, 12]];
}
function pistonModel(meta, sticky) {
  const dir = meta & 7, ext = !!(meta & 8);
  const b = pistonBoxes(meta)[0];
  const tFront = ext ? T('piston_inner') : T(sticky ? 'piston_top_sticky' : 'piston_top');
  const tBack = T('piston_bottom'), tSide = T('piston_side');
  const opp = [1, 0, 3, 2, 5, 4][dir];
  const fTex = (f) => f === dir ? tFront : f === opp ? tBack : tSide;
  return {
    rot: 0,
    els: [{
      from: [b[0], b[1], b[2]], to: [b[3], b[4], b[5]],
      faces: {
        west: [0, 0, 16, 16, fTex(0)],
        east: [0, 0, 16, 16, fTex(1)],
        down: [0, 0, 16, 16, fTex(2)],
        up: [0, 0, 16, 16, fTex(3)],
        north: [0, 0, 16, 16, fTex(4)],
        south: [0, 0, 16, 16, fTex(5)],
      }
    }]
  };
}
function pistonHeadBoxes(meta) {
  const dir = meta & 7;
  const plate = dir === 0 ? [0, 0, 0, 4, 16, 16]
    : dir === 1 ? [12, 0, 0, 16, 16, 16]
    : dir === 2 ? [0, 0, 0, 16, 4, 16]
    : dir === 3 ? [0, 12, 0, 16, 16, 16]
    : dir === 4 ? [0, 0, 0, 16, 16, 4]
    : [0, 0, 12, 16, 16, 16];
  const shaft = dir === 0 ? [4, 6, 6, 16, 10, 10]
    : dir === 1 ? [0, 6, 6, 12, 10, 10]
    : dir === 2 ? [6, 4, 6, 10, 16, 10]
    : dir === 3 ? [6, 0, 6, 10, 12, 10]
    : dir === 4 ? [6, 6, 4, 10, 10, 16]
    : [6, 6, 0, 10, 10, 12];
  return [plate, shaft];
}
function pistonHeadModel(meta) {
  const dir = meta & 7, sticky = !!(meta & 8);
  const [plate, shaft] = pistonHeadBoxes(meta);
  const tFront = T(sticky ? 'piston_top_sticky' : 'piston_top');
  const tBack = T('piston_top'), tSide = T('piston_side');
  const opp = [1, 0, 3, 2, 5, 4][dir];
  const pTex = (f) => f === dir ? tFront : f === opp ? tBack : tSide;
  return {
    rot: 0,
    els: [
      {
        from: [plate[0], plate[1], plate[2]], to: [plate[3], plate[4], plate[5]],
        faces: {
          west: [0, 0, 16, 16, pTex(0)],
          east: [0, 0, 16, 16, pTex(1)],
          down: [0, 0, 16, 16, pTex(2)],
          up: [0, 0, 16, 16, pTex(3)],
          north: [0, 0, 16, 16, pTex(4)],
          south: [0, 0, 16, 16, pTex(5)],
        }
      },
      {
        from: [shaft[0], shaft[1], shaft[2]], to: [shaft[3], shaft[4], shaft[5]],
        faces: {
          west: [0, 0, 16, 4, tSide],
          east: [0, 0, 16, 4, tSide],
          down: [0, 0, 16, 4, tSide],
          up: [0, 0, 16, 4, tSide],
          north: [0, 0, 16, 4, tSide],
          south: [0, 0, 16, 4, tSide],
        }
      }
    ]
  };
}
function pinkPetalsModel(meta) {
  const t = T('pink_petals');
  const count = (meta & 3) + 1;
  const quads = [
    { from: [0, 0.4, 0], to: [10, 0.8, 10], faces: { up: [0, 0, 16, 16, t], down: [0, 0, 16, 16, t] } },
    { from: [6, 0.5, 6], to: [16, 0.9, 16], faces: { up: [16, 16, 0, 0, t], down: [16, 16, 0, 0, t] } },
    { from: [6, 0.6, 0], to: [16, 1.0, 10], faces: { up: [0, 16, 16, 0, t], down: [0, 16, 16, 0, t] } },
    { from: [0, 0.7, 6], to: [10, 1.1, 16], faces: { up: [16, 0, 0, 16, t], down: [16, 0, 0, 16, t] } },
  ];
  return {
    rot: 0,
    els: quads.slice(0, count),
  };
}
function brewingStandModel(meta) {
  const tStand = T('brewing_stand'), tBase = T('brewing_stand_base');
  const b0 = !!(meta & 1), b1 = !!(meta & 2), b2 = !!(meta & 4);
  const armU = (hasBottle) => hasBottle ? [0, 2, 7, 16, tStand] : [9, 2, 16, 16, tStand];
  const armFlipU = (hasBottle) => hasBottle ? [7, 2, 0, 16, tStand] : [16, 2, 9, 16, tStand];
  return {
    rot: 0,
    els: [
      { from: [7, 0, 7], to: [9, 14, 9], faces: { up: [7, 2, 9, 4, tStand], down: [7, 7, 9, 9, tStand], north: [7, 2, 9, 16, tStand], south: [7, 2, 9, 16, tStand], west: [7, 2, 9, 16, tStand], east: [7, 2, 9, 16, tStand] } },
      { from: [9, 0, 5], to: [15, 2, 11], faces: { up: [9, 5, 15, 11, tBase], down: [9, 5, 15, 11, tBase], north: [9, 14, 15, 16, tBase], south: [9, 14, 15, 16, tBase], west: [5, 14, 11, 16, tBase], east: [5, 14, 11, 16, tBase] } },
      { from: [2, 0, 1], to: [8, 2, 7], faces: { up: [2, 1, 8, 7, tBase], down: [2, 1, 8, 7, tBase], north: [2, 14, 8, 16, tBase], south: [2, 14, 8, 16, tBase], west: [1, 14, 7, 16, tBase], east: [1, 14, 7, 16, tBase] } },
      { from: [2, 0, 9], to: [8, 2, 15], faces: { up: [2, 9, 8, 15, tBase], down: [2, 9, 8, 15, tBase], north: [2, 14, 8, 16, tBase], south: [2, 14, 8, 16, tBase], west: [9, 14, 15, 16, tBase], east: [9, 14, 15, 16, tBase] } },
      // Arm 0 (+X East arm over [9,0,5..15,2,11])
      { from: [9, 2, 7.8], to: [16, 16, 8.2], faces: { north: armU(b0), south: armFlipU(b0) } },
      // Arm 1 (-X/North-West arm over [2,0,1..8,2,7])
      { from: [1, 2, 3.8], to: [7, 16, 4.2], faces: { north: armFlipU(b1), south: armU(b1) } },
      // Arm 2 (+Z/South-West arm over [2,0,9..8,2,15])
      { from: [4.8, 2, 9], to: [5.2, 16, 15], faces: { west: armU(b2), east: armFlipU(b2) } },
    ]
  };
}
function fenceBoxes(meta) {
  const out = [[6, 0, 6, 10, 16, 10]];
  if (meta & 1) out.push([7, 6, 0, 9, 9, 6], [7, 12, 0, 9, 15, 6]);
  if (meta & 2) out.push([7, 6, 10, 9, 9, 16], [7, 12, 10, 9, 15, 16]);
  if (meta & 4) out.push([0, 6, 7, 6, 9, 9], [0, 12, 7, 6, 15, 9]);
  if (meta & 8) out.push([10, 6, 7, 16, 9, 9], [10, 12, 7, 16, 15, 9]);
  return out;
}
function railModel(meta) {
  const t = T('rail');
  return {
    rot: (meta & 1) ? 1 : 0,
    els: [{
      from: [0, 0.5, 0], to: [16, 1.5, 16],
      faces: { up: [0, 0, 16, 16, t], down: [0, 0, 16, 16, t] }
    }]
  };
}
function anvilModel(meta) {
  const tTop = T('anvil_top'), tBody = T('anvil_base'), tSide = T('anvil_side');
  return {
    rot: (meta === 0 || meta === 1) ? 1 : 0,
    els: [
      { from: [2, 0, 2], to: [14, 3, 14], faces: { up: [2, 2, 14, 14, tBody], down: [2, 2, 14, 14, tBody], north: [2, 13, 14, 16, tSide], south: [2, 13, 14, 16, tSide], west: [2, 13, 14, 16, tSide], east: [2, 13, 14, 16, tSide] } },
      { from: [3, 3, 3], to: [13, 5, 13], faces: { up: [3, 3, 13, 13, tBody], north: [3, 11, 13, 13, tSide], south: [3, 11, 13, 13, tSide], west: [3, 11, 13, 13, tSide], east: [3, 11, 13, 13, tSide] } },
      { from: [5, 5, 4], to: [11, 10, 12], faces: { north: [5, 6, 11, 11, tSide], south: [5, 6, 11, 11, tSide], west: [4, 6, 12, 11, tSide], east: [4, 6, 12, 11, tSide] } },
      { from: [4, 10, 1], to: [12, 12, 15], faces: { down: [4, 1, 12, 15, tBody], north: [4, 4, 12, 6, tSide], south: [4, 4, 12, 6, tSide], west: [1, 4, 15, 6, tSide], east: [1, 4, 15, 6, tSide] } },
      { from: [3, 11, 0], to: [13, 16, 16], faces: { up: [3, 0, 13, 16, tTop], down: [3, 0, 13, 16, tBody], north: [3, 0, 13, 5, tSide], south: [3, 0, 13, 5, tSide], west: [0, 0, 16, 5, tSide], east: [0, 0, 16, 5, tSide] } },
    ]
  };
}
function bellModel(meta) {
  const tSide = T('bell_side'), tTop = T('bell_top'), tBot = T('bell_bottom');
  const tWood = T('dark_oak_planks'), tStone = T('stone_bricks');
  return {
    rot: meta & 3,
    els: [
      // Left & right stone support posts
      { from: [0, 0, 6], to: [2, 16, 10], faces: { up: [0, 0, 2, 4, tStone], down: [0, 0, 2, 4, tStone], north: [0, 0, 2, 16, tStone], south: [0, 0, 2, 16, tStone], west: [6, 0, 10, 16, tStone], east: [6, 0, 10, 16, tStone] } },
      { from: [14, 0, 6], to: [16, 16, 10], faces: { up: [0, 0, 2, 4, tStone], down: [0, 0, 2, 4, tStone], north: [0, 0, 2, 16, tStone], south: [0, 0, 2, 16, tStone], west: [6, 0, 10, 16, tStone], east: [6, 0, 10, 16, tStone] } },
      // Top wooden crossbar
      { from: [2, 13, 6], to: [14, 15, 10], faces: { up: [2, 6, 14, 10, tWood], down: [2, 6, 14, 10, tWood], north: [2, 1, 14, 3, tWood], south: [2, 1, 14, 3, tWood], west: [6, 1, 10, 3, tWood], east: [6, 1, 10, 3, tWood] } },
      // Bell upper body (6x7x6) mapped to opaque (1..7, 0..7) of bell_side and (1..7, 1..7) of bell_top/bottom
      { from: [5, 6, 5], to: [11, 13, 11], faces: { up: [1, 1, 7, 7, tTop], down: [1, 1, 7, 7, tBot], north: [1, 0, 7, 7, tSide], south: [1, 0, 7, 7, tSide], west: [1, 0, 7, 7, tSide], east: [1, 0, 7, 7, tSide] } },
      // Bell flared lower rim (8x2x8) mapped to opaque (0..8, 7..9) of bell_side and (0..8, 0..8) of bell_top/bottom
      { from: [4, 4, 4], to: [12, 6, 12], faces: { up: [0, 0, 8, 8, tTop], down: [0, 0, 8, 8, tBot], north: [0, 7, 8, 9, tSide], south: [0, 7, 8, 9, tSide], west: [0, 7, 8, 9, tSide], east: [0, 7, 8, 9, tSide] } },
    ]
  };
}
function hopperBoxes(meta) {
  const dir = meta & 7;
  const spout = dir === 0 ? [0, 4, 6, 4, 8, 10]
    : dir === 1 ? [12, 4, 6, 16, 8, 10]
    : dir === 4 ? [6, 4, 0, 10, 8, 4]
    : dir === 5 ? [6, 4, 12, 10, 8, 16]
    : [6, 0, 6, 10, 4, 10];
  return [[0, 10, 0, 16, 16, 16], [4, 4, 4, 12, 10, 12], spout];
}
function hopperModel(meta) {
  const tTop = T('hopper_top'), tOut = T('hopper_outside'), tIn = T('hopper_inside');
  const dir = meta & 7;
  const spout = dir === 0 ? [0, 4, 6, 4, 8, 10]
    : dir === 1 ? [12, 4, 6, 16, 8, 10]
    : dir === 4 ? [6, 4, 0, 10, 8, 4]
    : dir === 5 ? [6, 4, 12, 10, 8, 16]
    : [6, 0, 6, 10, 4, 10];
  return {
    rot: 0,
    els: [
      { from: [0, 10, 0], to: [16, 16, 16], faces: { up: [0, 0, 16, 16, tTop], down: [0, 0, 16, 16, tOut], north: [0, 0, 16, 6, tOut], south: [0, 0, 16, 6, tOut], west: [0, 0, 16, 6, tOut], east: [0, 0, 16, 6, tOut] } },
      { from: [0, 11, 2], to: [2, 16, 14], faces: { east: [2, 0, 14, 5, tOut] } },
      { from: [14, 11, 2], to: [16, 16, 14], faces: { west: [2, 0, 14, 5, tOut] } },
      { from: [2, 11, 0], to: [14, 16, 2], faces: { south: [2, 0, 14, 5, tOut] } },
      { from: [2, 11, 14], to: [14, 16, 16], faces: { north: [2, 0, 14, 5, tOut] } },
      { from: [2, 10, 2], to: [14, 11, 14], faces: { up: [2, 2, 14, 14, tIn] } },
      { from: [4, 4, 4], to: [12, 10, 12], faces: { down: [4, 4, 12, 12, tOut], north: [4, 6, 12, 12, tOut], south: [4, 6, 12, 12, tOut], west: [4, 6, 12, 12, tOut], east: [4, 6, 12, 12, tOut] } },
      { from: [spout[0], spout[1], spout[2]], to: [spout[3], spout[4], spout[5]], faces: { up: [6, 6, 10, 10, tOut], down: [6, 6, 10, 10, tOut], north: [6, 12, 10, 16, tOut], south: [6, 12, 10, 16, tOut], west: [6, 12, 10, 16, tOut], east: [6, 12, 10, 16, tOut] } },
    ]
  };
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------
defBlock(0, 'air', '空气', { shape: SH_NONE, solid: false, opaque: false, noItem: true, replaceable: true, hardness: 0 });
defBlock(1, 'stone', '石头', { tex: 'stone', hardness: 1.5, tool: 'pickaxe', needsTool: true, drops: drop('cobblestone') });
defBlock(2, 'grass_block', '草方块', { tex: { top: 'grass_block_top', bottom: 'dirt', side: 'grass_side_base' }, overlay: 'grass_block_side_overlay', tint: 'grass', hardness: 0.6, tool: 'shovel', sound: 'grass', drops: drop('dirt'), particle: 'dirt',
  texFn(face, meta) { return (meta & 1) && face !== 2 && face !== 3 ? T('grass_block_snow') : this.tex[face]; } });
defBlock(3, 'dirt', '泥土', { tex: 'dirt', hardness: 0.5, tool: 'shovel', sound: 'gravel' });
defBlock(4, 'cobblestone', '圆石', { tex: 'cobblestone', hardness: 2, tool: 'pickaxe', needsTool: true });
defBlock(5, 'oak_planks', '橡木木板', { tex: 'oak_planks', hardness: 2, tool: 'axe', sound: 'wood', fuel: 300, flammable: true });
defBlock(6, 'bedrock', '基岩', { tex: 'bedrock', hardness: -1 });
defBlock(7, 'water', '水', { shape: SH_LIQUID, tex: 'water_still', render: 'translucent', solid: false, opacity: 2, hardness: -1, replaceable: true, noItem: true, tint: 'water', cullSame: true });
defBlock(8, 'lava', '熔岩', { shape: SH_LIQUID, tex: 'lava_still', render: 'opaque', solid: false, opacity: 15, light: 15, hardness: -1, replaceable: true, noItem: true, cullSame: true });
defBlock(9, 'sand', '沙子', { tex: 'sand', hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true });
defBlock(10, 'gravel', '沙砾', { tex: 'gravel', hardness: 0.6, tool: 'shovel', sound: 'gravel', gravity: true, drops: (m, r) => [[r() < 0.1 ? 'flint' : 'gravel', 1]] });
defBlock(11, 'gold_ore', '金矿石', { tex: 'gold_ore', hardness: 3, tool: 'pickaxe', level: 2, needsTool: true, drops: drop('raw_gold') });
defBlock(12, 'iron_ore', '铁矿石', { tex: 'iron_ore', hardness: 3, tool: 'pickaxe', level: 1, needsTool: true, drops: drop('raw_iron') });
defBlock(13, 'coal_ore', '煤矿石', { tex: 'coal_ore', hardness: 3, tool: 'pickaxe', needsTool: true, drops: drop('coal'), xp: 1 });
defBlock(14, 'oak_log', '橡木原木', { tex: { top: 'oak_log_top', side: 'oak_log' }, hardness: 2, tool: 'axe', sound: 'wood', axis: true, texFn: logTex, fuel: 300, flammable: true });
defBlock(15, 'oak_leaves', '橡树树叶', { tex: 'oak_leaves', render: 'cutout', opaque: false, opacity: 1, hardness: 0.2, tool: 'hoe', sound: 'grass', tint: 'foliage',
  drops: (m, r) => { const d = []; if (r() < 0.05) d.push(['oak_sapling', 1]); if (r() < 0.02) d.push(['stick', 1 + (r() * 2 | 0)]); if (r() < 0.02) d.push(['apple', 1]); return d; } });
defBlock(16, 'glass', '玻璃', { tex: 'glass', render: 'cutout', opaque: false, hardness: 0.3, sound: 'glass', drops: nothing, cullSame: true });
defBlock(17, 'sandstone', '砂岩', { tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone' }, hardness: 0.8, tool: 'pickaxe', needsTool: true });
defBlock(18, 'diamond_ore', '钻石矿石', { tex: 'diamond_ore', hardness: 3, tool: 'pickaxe', level: 2, needsTool: true, drops: drop('diamond') });
defBlock(19, 'crafting_table', '工作台', { tex: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', front: 'crafting_table_front' }, facing: true, hardness: 2.5, tool: 'axe', sound: 'wood', fuel: 300, onUse: 'crafting' });
defBlock(20, 'furnace', '熔炉', { tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front', frontOn: 'furnace_front_on' }, facing: true, hardness: 3.5, tool: 'pickaxe', needsTool: true, onUse: 'furnace' });
defBlock(21, 'torch', '火把', { shape: SH_TORCH, tex: 'torch', solid: false, light: 14, hardness: 0, sound: 'wood', needsSupport: true, flatIcon: 'torch' });
defBlock(22, 'bricks', '砖块', { tex: 'bricks', hardness: 2, tool: 'pickaxe', needsTool: true });
defBlock(23, 'stone_bricks', '石砖', { tex: 'stone_bricks', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(24, 'mossy_cobblestone', '苔石', { tex: 'mossy_cobblestone', hardness: 2, tool: 'pickaxe', needsTool: true });
defBlock(25, 'bookshelf', '书架', { tex: { top: 'oak_planks', side: 'bookshelf' }, hardness: 1.5, tool: 'axe', sound: 'wood', drops: drop('book', 3), fuel: 300 });
defBlock(26, 'tnt', 'TNT', { tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' }, hardness: 0, sound: 'grass' });
defBlock(27, 'glowstone', '荧石', { tex: 'glowstone', light: 15, hardness: 0.3, sound: 'glass' });
defBlock(28, 'obsidian', '黑曜石', { tex: 'obsidian', hardness: 50, tool: 'pickaxe', level: 3, needsTool: true });
defBlock(29, 'iron_block', '铁块', { tex: 'iron_block', hardness: 5, tool: 'pickaxe', level: 1, needsTool: true, sound: 'metal' });
defBlock(30, 'gold_block', '金块', { tex: 'gold_block', hardness: 3, tool: 'pickaxe', level: 2, needsTool: true, sound: 'metal' });
defBlock(31, 'diamond_block', '钻石块', { tex: 'diamond_block', hardness: 5, tool: 'pickaxe', level: 2, needsTool: true, sound: 'metal' });
defBlock(32, 'coal_block', '煤炭块', { tex: 'coal_block', hardness: 5, tool: 'pickaxe', needsTool: true, fuel: 16000 });
defBlock(33, 'snow_block', '雪块', { tex: 'snow', hardness: 0.2, tool: 'shovel', needsTool: true, sound: 'snow', drops: drop('snowball', 4) });
defBlock(34, 'snow', '雪', { shape: SH_BOXES, boxes: () => [[0, 0, 0, 16, 2, 16]], tex: 'snow', render: 'opaque', solid: false, hardness: 0.1, tool: 'shovel', needsTool: true, sound: 'snow', replaceable: true, needsSupport: true, drops: drop('snowball') });
defBlock(35, 'ice', '冰', { tex: 'ice', render: 'translucent', opaque: false, opacity: 2, hardness: 0.5, tool: 'pickaxe', sound: 'glass', drops: nothing, cullSame: true, slip: 0.98 });
defBlock(36, 'clay', '黏土块', { tex: 'clay', hardness: 0.6, tool: 'shovel', sound: 'gravel', drops: drop('clay_ball', 4) });
defBlock(37, 'cactus', '仙人掌', { shape: SH_CACTUS, tex: { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' }, render: 'cutout', hardness: 0.4, sound: 'wool', needsSupport: true, damage: 1 });
defBlock(38, 'sugar_cane', '甘蔗', { shape: SH_CROSS, tex: 'sugar_cane', solid: false, hardness: 0, sound: 'grass', needsSupport: true, drops: drop('sugar_cane'), noItem: true });
defBlock(39, 'short_grass', '草', { shape: SH_CROSS, tex: 'short_grass', solid: false, hardness: 0, sound: 'grass', tint: 'grass', replaceable: true, needsSupport: true, drops: (m, r) => r() < 0.125 ? [['wheat_seeds', 1]] : [], flatIcon: 'short_grass' });
defBlock(40, 'fern', '蕨', { shape: SH_CROSS, tex: 'fern', solid: false, hardness: 0, sound: 'grass', tint: 'grass', replaceable: true, needsSupport: true, drops: (m, r) => r() < 0.125 ? [['wheat_seeds', 1]] : [], flatIcon: 'fern' });
const FLOWERS = [['dandelion', '蒲公英'], ['poppy', '虞美人'], ['cornflower', '矢车菊'], ['oxeye_daisy', '滨菊'], ['azure_bluet', '蓝花美耳草'], ['allium', '绒球葱'], ['blue_orchid', '兰花'], ['red_tulip', '红色郁金香'], ['lily_of_the_valley', '铃兰']];
const FLOWER_IDS = [41, 42, 43, 44, 98, 99, 100, 101, 102];
FLOWERS.forEach(([k, cn], i) => defBlock(FLOWER_IDS[i], k, cn, { shape: SH_CROSS, tex: k, solid: false, hardness: 0, sound: 'grass', needsSupport: true, flatIcon: k }));
defBlock(45, 'dead_bush', '枯死的灌木', { shape: SH_CROSS, tex: 'dead_bush', solid: false, hardness: 0, sound: 'grass', replaceable: true, needsSupport: true, drops: (m, r) => [['stick', r() * 3 | 0]], flatIcon: 'dead_bush' });
defBlock(46, 'birch_log', '白桦原木', { tex: { top: 'birch_log_top', side: 'birch_log' }, hardness: 2, tool: 'axe', sound: 'wood', axis: true, texFn: logTex, fuel: 300 });
defBlock(47, 'birch_leaves', '白桦树叶', { tex: 'birch_leaves', render: 'cutout', opaque: false, opacity: 1, hardness: 0.2, tool: 'hoe', sound: 'grass', tint: 'birch',
  drops: (m, r) => { const d = []; if (r() < 0.05) d.push(['birch_sapling', 1]); if (r() < 0.02) d.push(['stick', 1]); return d; } });
defBlock(48, 'birch_planks', '白桦木板', { tex: 'birch_planks', hardness: 2, tool: 'axe', sound: 'wood', fuel: 300 });
defBlock(49, 'spruce_log', '云杉原木', { tex: { top: 'spruce_log_top', side: 'spruce_log' }, hardness: 2, tool: 'axe', sound: 'wood', axis: true, texFn: logTex, fuel: 300 });
defBlock(50, 'spruce_leaves', '云杉树叶', { tex: 'spruce_leaves', render: 'cutout', opaque: false, opacity: 1, hardness: 0.2, tool: 'hoe', sound: 'grass', tint: 'spruce',
  drops: (m, r) => { const d = []; if (r() < 0.05) d.push(['spruce_sapling', 1]); if (r() < 0.02) d.push(['stick', 1]); return d; } });
defBlock(51, 'spruce_planks', '云杉木板', { tex: 'spruce_planks', hardness: 2, tool: 'axe', sound: 'wood', fuel: 300 });
defBlock(52, 'chest', '箱子', { shape: SH_BOXES, boxes: () => [[1, 0, 1, 15, 14, 15]], tex: { top: 'chest_top', side: 'chest_side', front: 'chest_front' }, render: 'opaque', facing: true, hardness: 2.5, tool: 'axe', sound: 'wood', onUse: 'chest', fuel: 300 });
defBlock(53, 'pumpkin', '南瓜', { tex: { top: 'pumpkin_top', side: 'pumpkin_side' }, hardness: 1, tool: 'axe', sound: 'wood' });
defBlock(54, 'jack_o_lantern', '南瓜灯', { tex: { top: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_o_lantern' }, facing: true, light: 15, hardness: 1, tool: 'axe', sound: 'wood' });
defBlock(55, 'melon', '西瓜', { tex: { top: 'melon_top', side: 'melon_side' }, hardness: 1, tool: 'axe', sound: 'wood', drops: (m, r) => [['melon_slice', 3 + (r() * 5 | 0)]] });
defBlock(56, 'smooth_stone', '平滑石头', { tex: 'smooth_stone', hardness: 2, tool: 'pickaxe', needsTool: true });
const slabDrop = (k) => (m) => [[k, (m & 3) === 2 ? 2 : 1]];
defBlock(57, 'smooth_stone_slab', '平滑石台阶', { shape: SH_BOXES, boxes: (m) => SLAB_BOXES[m & 3], tex: { top: 'smooth_stone', side: 'smooth_stone_slab_side' }, render: 'opaque', hardness: 2, tool: 'pickaxe', needsTool: true, slab: true, drops: slabDrop('smooth_stone_slab') });
defBlock(58, 'oak_slab', '橡木台阶', { shape: SH_BOXES, boxes: (m) => SLAB_BOXES[m & 3], tex: 'oak_planks', render: 'opaque', hardness: 2, tool: 'axe', sound: 'wood', slab: true, fuel: 150, drops: slabDrop('oak_slab') });
defBlock(59, 'cobblestone_slab', '圆石台阶', { shape: SH_BOXES, boxes: (m) => SLAB_BOXES[m & 3], tex: 'cobblestone', render: 'opaque', hardness: 2, tool: 'pickaxe', needsTool: true, slab: true, drops: slabDrop('cobblestone_slab') });
defBlock(60, 'oak_stairs', '橡木楼梯', { shape: SH_BOXES, boxes: stairBoxes, tex: 'oak_planks', render: 'opaque', hardness: 2, tool: 'axe', sound: 'wood', stairs: true, fuel: 300 });
defBlock(61, 'cobblestone_stairs', '圆石楼梯', { shape: SH_BOXES, boxes: stairBoxes, tex: 'cobblestone', render: 'opaque', hardness: 2, tool: 'pickaxe', needsTool: true, stairs: true });
defBlock(62, 'stone_brick_stairs', '石砖楼梯', { shape: SH_BOXES, boxes: stairBoxes, tex: 'stone_bricks', render: 'opaque', hardness: 1.5, tool: 'pickaxe', needsTool: true, stairs: true });
defBlock(63, 'farmland', '耕地', { shape: SH_BOXES, boxes: () => [[0, 0, 0, 16, 15, 16]], tex: { top: 'farmland', side: 'dirt' }, render: 'opaque', hardness: 0.6, tool: 'shovel', sound: 'gravel', drops: drop('dirt'),
  texFn(face, meta) { return face === 3 ? (meta ? T('farmland_moist') : T('farmland')) : this.tex[face]; } });
const WHEAT_TEX = [0, 1, 2, 3, 4, 5, 6, 7].map(i => 'wheat_stage' + i);
defBlock(64, 'wheat', '小麦', { shape: SH_CROP, tex: 'wheat_stage0', solid: false, hardness: 0, sound: 'grass', needsSupport: true, noItem: true,
  texFn(face, meta) { return T(WHEAT_TEX[meta & 7]); },
  drops: (m, r) => (m & 7) >= 7 ? [['wheat', 1], ['wheat_seeds', 1 + (r() * 3 | 0)]] : [['wheat_seeds', 1]] });
defBlock(65, 'oak_sapling', '橡树树苗', { shape: SH_CROSS, tex: 'oak_sapling', solid: false, hardness: 0, sound: 'grass', needsSupport: true, flatIcon: 'oak_sapling', fuel: 100 });
defBlock(66, 'birch_sapling', '白桦树苗', { shape: SH_CROSS, tex: 'birch_sapling', solid: false, hardness: 0, sound: 'grass', needsSupport: true, flatIcon: 'birch_sapling', fuel: 100 });
defBlock(67, 'spruce_sapling', '云杉树苗', { shape: SH_CROSS, tex: 'spruce_sapling', solid: false, hardness: 0, sound: 'grass', needsSupport: true, flatIcon: 'spruce_sapling', fuel: 100 });
defBlock(68, 'ladder', '梯子', { shape: SH_BOXES, boxes: ladderBoxes, tex: 'ladder', render: 'cutout', hardness: 0.4, tool: 'axe', sound: 'wood', climbable: true, flatIcon: 'ladder', fuel: 300, ladder: true });
defBlock(69, 'oak_door', '橡木门', { shape: SH_BOXES, boxes: doorBoxes, tex: 'oak_door_bottom', render: 'cutout', hardness: 3, tool: 'axe', sound: 'wood', noItem: true, door: true,
  texFn(face, meta) { return (meta & 8) ? T('oak_door_top') : T('oak_door_bottom'); }, drops: drop('oak_door') });
defBlock(70, 'red_mushroom', '红色蘑菇', { shape: SH_CROSS, tex: 'red_mushroom', solid: false, hardness: 0, sound: 'grass', needsSupport: true, flatIcon: 'red_mushroom' });
defBlock(71, 'brown_mushroom', '棕色蘑菇', { shape: SH_CROSS, tex: 'brown_mushroom', solid: false, hardness: 0, sound: 'grass', needsSupport: true, light: 1, flatIcon: 'brown_mushroom' });
defBlock(72, 'andesite', '安山岩', { tex: 'andesite', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(73, 'diorite', '闪长岩', { tex: 'diorite', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(74, 'granite', '花岗岩', { tex: 'granite', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(75, 'deepslate', '深板岩', { tex: { top: 'deepslate_top', side: 'deepslate' }, hardness: 3, tool: 'pickaxe', needsTool: true, sound: 'stone' });
defBlock(76, 'deepslate_coal_ore', '深层煤矿石', { tex: 'deepslate_coal_ore', hardness: 4.5, tool: 'pickaxe', needsTool: true, drops: drop('coal') });
defBlock(77, 'deepslate_iron_ore', '深层铁矿石', { tex: 'deepslate_iron_ore', hardness: 4.5, tool: 'pickaxe', level: 1, needsTool: true, drops: drop('raw_iron') });
defBlock(78, 'deepslate_gold_ore', '深层金矿石', { tex: 'deepslate_gold_ore', hardness: 4.5, tool: 'pickaxe', level: 2, needsTool: true, drops: drop('raw_gold') });
defBlock(79, 'deepslate_diamond_ore', '深层钻石矿石', { tex: 'deepslate_diamond_ore', hardness: 4.5, tool: 'pickaxe', level: 2, needsTool: true, drops: drop('diamond') });
defBlock(80, 'redstone_ore', '红石矿石', { tex: 'redstone_ore', hardness: 3, tool: 'pickaxe', level: 2, needsTool: true, drops: (m, r) => [['redstone', 4 + (r() * 2 | 0)]] });
defBlock(81, 'lapis_ore', '青金石矿石', { tex: 'lapis_ore', hardness: 3, tool: 'pickaxe', level: 1, needsTool: true, drops: (m, r) => [['lapis_lazuli', 4 + (r() * 5 | 0)]] });
defBlock(82, 'emerald_ore', '绿宝石矿石', { tex: 'emerald_ore', hardness: 3, tool: 'pickaxe', level: 2, needsTool: true, drops: drop('emerald') });
defBlock(83, 'terracotta', '陶瓦', { tex: 'terracotta', hardness: 1.25, tool: 'pickaxe', needsTool: true });
defBlock(84, 'quartz_block', '石英块', { tex: { top: 'quartz_block_top', side: 'quartz_block_side' }, hardness: 0.8, tool: 'pickaxe', needsTool: true });
defBlock(85, 'sea_lantern', '海晶灯', { tex: 'sea_lantern', light: 15, hardness: 0.3, sound: 'glass' });
defBlock(86, 'prismarine', '海晶石', { tex: 'prismarine', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(87, 'hay_block', '干草块', { tex: { top: 'hay_block_top', side: 'hay_block_side' }, hardness: 0.5, tool: 'hoe', sound: 'grass', drops: drop('wheat', 9), axis: true, texFn: logTex });
defBlock(88, 'moss_block', '苔藓块', { tex: 'moss_block', hardness: 0.1, tool: 'hoe', sound: 'grass' });
defBlock(89, 'mud_bricks', '泥砖', { tex: 'mud_bricks', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(90, 'polished_andesite', '磨制安山岩', { tex: 'polished_andesite', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(91, 'polished_diorite', '磨制闪长岩', { tex: 'polished_diorite', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(92, 'polished_granite', '磨制花岗岩', { tex: 'polished_granite', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(93, 'cracked_stone_bricks', '裂纹石砖', { tex: 'cracked_stone_bricks', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(94, 'mossy_stone_bricks', '苔石砖', { tex: 'mossy_stone_bricks', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(95, 'bone_block', '骨块', { tex: { top: 'bone_block_top', side: 'bone_block_side' }, hardness: 2, tool: 'pickaxe', needsTool: true });
defBlock(96, 'packed_ice', '浮冰', { tex: 'packed_ice', hardness: 0.5, tool: 'pickaxe', sound: 'glass', slip: 0.98, drops: nothing });
defBlock(97, 'red_sand', '红沙', { tex: 'red_sand', hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true });
defBlock(103, 'magma_block', '岩浆块', { tex: 'magma', light: 3, hardness: 0.5, tool: 'pickaxe', needsTool: true, damage: 1 });
defBlock(104, 'dark_oak_planks', '深色橡木木板', { tex: 'dark_oak_planks', hardness: 2, tool: 'axe', sound: 'wood', fuel: 300 });
defBlock(105, 'jungle_planks', '丛林木板', { tex: 'jungle_planks', hardness: 2, tool: 'axe', sound: 'wood', fuel: 300 });
defBlock(106, 'acacia_planks', '金合欢木板', { tex: 'acacia_planks', hardness: 2, tool: 'axe', sound: 'wood', fuel: 300 });
defBlock(107, 'cherry_planks', '樱花木板', { tex: 'cherry_planks', hardness: 2, tool: 'axe', sound: 'wood', fuel: 300 });
defBlock(108, 'lapis_block', '青金石块', { tex: 'lapis_block', hardness: 3, tool: 'pickaxe', level: 1, needsTool: true });
defBlock(109, 'emerald_block', '绿宝石块', { tex: 'emerald_block', hardness: 5, tool: 'pickaxe', level: 2, needsTool: true, sound: 'metal' });
defBlock(110, 'redstone_block', '红石块', { tex: 'redstone_block', hardness: 5, tool: 'pickaxe', needsTool: true, sound: 'metal', redstone: true });
defBlock(111, 'note_block', '音符盒', { tex: 'note_block', hardness: 0.8, tool: 'axe', sound: 'wood', onUse: 'note', fuel: 300 });
defBlock(112, 'oak_trapdoor', '橡木活板门', { shape: SH_BOXES, boxes: (m) => (m & 4) ? [[0, 0, 13, 16, 16, 16]] : (m & 8 ? [[0, 13, 0, 16, 16, 16]] : [[0, 0, 0, 16, 3, 16]]), tex: 'oak_trapdoor', render: 'cutout', hardness: 3, tool: 'axe', sound: 'wood', trapdoor: true, fuel: 300 });
defBlock(113, 'stone_brick_slab', '石砖台阶', { shape: SH_BOXES, boxes: (m) => SLAB_BOXES[m & 3], tex: 'stone_bricks', render: 'opaque', hardness: 1.5, tool: 'pickaxe', needsTool: true, slab: true, drops: slabDrop('stone_brick_slab') });
defBlock(114, 'brick_stairs', '砖楼梯', { shape: SH_BOXES, boxes: stairBoxes, tex: 'bricks', render: 'opaque', hardness: 2, tool: 'pickaxe', needsTool: true, stairs: true });
defBlock(115, 'spruce_stairs', '云杉木楼梯', { shape: SH_BOXES, boxes: stairBoxes, tex: 'spruce_planks', render: 'opaque', hardness: 2, tool: 'axe', sound: 'wood', stairs: true, fuel: 300 });
defBlock(117, 'lit_furnace', '熔炉', { tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front_on' }, facing: true, light: 13, hardness: 3.5, tool: 'pickaxe', needsTool: true, onUse: 'furnace', noItem: true, drops: drop('furnace') });
// Bed: vanilla template_bed_head / template_bed_foot elements (head points north at rotation 0)
const BED_HEAD = [
  { from: [0, 3, 0], to: [16, 9, 16], faces: { down: [0, 0, 16, 16, 'bed_down'], up: [0, 0, 16, 16, 'red_bed_head_up'], north: [0, 7, 16, 13, 'bed_head_north'], west: [0, 7, 16, 13, 'red_bed_head_west'], east: [0, 7, 16, 13, 'red_bed_head_east'] } },
  { from: [0, 0, 0], to: [3, 3, 3], faces: { down: [6, 13, 9, 16, 'red_bed_head_west'], north: [13, 13, 16, 16, 'bed_head_north'], south: [3, 13, 6, 16, 'red_bed_head_west'], west: [0, 13, 3, 16, 'red_bed_head_west'], east: [10, 13, 13, 16, 'bed_head_north'] } },
  { from: [13, 0, 0], to: [16, 3, 3], faces: { down: [7, 13, 10, 16, 'red_bed_head_east'], north: [0, 13, 3, 16, 'bed_head_north'], south: [10, 13, 13, 16, 'red_bed_head_east'], west: [3, 13, 6, 16, 'bed_head_north'], east: [13, 13, 16, 16, 'red_bed_head_east'] } },
];
const BED_FOOT = [
  { from: [0, 3, 0], to: [16, 9, 16], faces: { down: [0, 0, 16, 16, 'bed_down'], up: [0, 0, 16, 16, 'red_bed_foot_up'], south: [0, 7, 16, 13, 'red_bed_foot_south'], west: [0, 7, 16, 13, 'red_bed_foot_west'], east: [0, 7, 16, 13, 'red_bed_foot_east'] } },
  { from: [0, 0, 13], to: [3, 3, 16], faces: { down: [7, 13, 10, 16, 'red_bed_foot_west'], north: [10, 13, 13, 16, 'red_bed_foot_west'], south: [0, 13, 3, 16, 'red_bed_foot_south'], west: [13, 13, 16, 16, 'red_bed_foot_west'], east: [3, 13, 6, 16, 'red_bed_foot_south'] } },
  { from: [13, 0, 13], to: [16, 3, 16], faces: { down: [6, 13, 9, 16, 'red_bed_foot_east'], north: [3, 13, 6, 16, 'red_bed_foot_east'], south: [13, 13, 16, 16, 'red_bed_foot_south'], west: [10, 13, 13, 16, 'red_bed_foot_south'], east: [0, 13, 3, 16, 'red_bed_foot_east'] } },
];
for (const els of [BED_HEAD, BED_FOOT]) for (const e of els) for (const f in e.faces) e.faces[f][4] = T(e.faces[f][4]);
// meta: bits0-1 rotation (0 head north, 1 east, 2 south, 3 west), bit2 = head half
defBlock(118, 'red_bed', '红色的床', { shape: SH_MODEL, model: (m) => ({ els: (m & 4) ? BED_HEAD : BED_FOOT, rot: m & 3 }), boxes: () => [[0, 0, 0, 16, 9, 16]],
  tex: 'red_bed_foot_up', render: 'opaque', hardness: 0.2, sound: 'wool', bed: true, stack: 1, particle: 'red_bed_head_up', drops: (m) => (m & 4) ? [] : [['red_bed', 1]] });
defBlock(116, 'birch_slab', '白桦木台阶', { shape: SH_BOXES, boxes: (m) => SLAB_BOXES[m & 3], tex: 'birch_planks', render: 'opaque', hardness: 2, tool: 'axe', sound: 'wood', slab: true, fuel: 150, drops: slabDrop('birch_slab') });

// ---- Redstone Core Suite Blocks -------------------------------------------
defBlock(119, 'redstone_wire', '红石线', { shape: SH_WIRE, boxes: () => [[0, 0, 0, 16, 2, 16]], tex: 'redstone_dust_dot', render: 'cutout', solid: false, opaque: false, hardness: 0, sound: 'stone', needsSupport: true, noItem: true, redstone: true, drops: drop('redstone') });
defBlock(120, 'redstone_torch', '红石火把', { shape: SH_TORCH, tex: 'redstone_torch', solid: false, light: 7, hardness: 0, sound: 'wood', needsSupport: true, flatIcon: 'redstone_torch', redstone: true });
defBlock(121, 'redstone_torch_off', '红石火把', { shape: SH_TORCH, tex: 'redstone_torch_off', solid: false, light: 0, hardness: 0, sound: 'wood', needsSupport: true, noItem: true, redstone: true, drops: drop('redstone_torch') });
defBlock(122, 'lever', '拉杆', { shape: SH_BOXES, boxes: leverBoxes, tex: 'cobblestone', render: 'opaque', solid: false, opaque: false, hardness: 0.5, sound: 'wood', needsSupport: true, onUse: 'lever', flatIcon: 'lever', lever: true, redstone: true });
defBlock(123, 'stone_button', '石头按钮', { shape: SH_BOXES, boxes: buttonBoxes, tex: 'stone', render: 'opaque', solid: false, opaque: false, hardness: 0.5, tool: 'pickaxe', sound: 'stone', needsSupport: true, onUse: 'button', button: true, redstone: true });
defBlock(124, 'stone_pressure_plate', '石头压力板', { shape: SH_BOXES, boxes: (m) => [[1, 0, 1, 15, (m & 1) ? 0.5 : 1, 15]], tex: 'stone', render: 'opaque', solid: false, opaque: false, hardness: 0.5, tool: 'pickaxe', sound: 'stone', needsSupport: true, plate: true, redstone: true });
defBlock(125, 'redstone_lamp', '红石灯', { tex: 'redstone_lamp', hardness: 0.3, sound: 'glass', redstone: true });
defBlock(126, 'lit_redstone_lamp', '红石灯', { tex: 'redstone_lamp_on', light: 15, hardness: 0.3, sound: 'glass', noItem: true, redstone: true, drops: drop('redstone_lamp') });
defBlock(127, 'repeater', '红石中继器', { shape: SH_MODEL, model: (m) => repeaterModel(m, false), boxes: () => [[0, 0, 0, 16, 2, 16]], tex: 'repeater', render: 'opaque', solid: true, opaque: false, hardness: 0, sound: 'wood', needsSupport: true, onUse: 'repeater', noItem: true, repeater: true, redstone: true, drops: drop('repeater') });
defBlock(156, 'lit_repeater', '红石中继器', { shape: SH_MODEL, model: (m) => repeaterModel(m, true), boxes: () => [[0, 0, 0, 16, 2, 16]], tex: 'repeater_on', render: 'opaque', solid: true, opaque: false, light: 7, hardness: 0, sound: 'wood', needsSupport: true, onUse: 'repeater', noItem: true, repeater: true, redstone: true, drops: drop('repeater') });
defBlock(157, 'target', '标靶', { tex: { top: 'target_top', side: 'target_side' }, hardness: 0.5, tool: 'hoe', sound: 'grass', redstone: true });
defBlock(158, 'deepslate_redstone_ore', '深层红石矿石', { tex: 'deepslate_redstone_ore', hardness: 4.5, tool: 'pickaxe', level: 2, needsTool: true, drops: (m, r) => [['redstone', 4 + (r() * 2 | 0)]] });
defBlock(159, 'oak_button', '橡木按钮', { shape: SH_BOXES, boxes: buttonBoxes, tex: 'oak_planks', render: 'opaque', solid: false, opaque: false, hardness: 0.5, tool: 'axe', sound: 'wood', needsSupport: true, onUse: 'button', button: true, redstone: true, fuel: 100 });
defBlock(169, 'oak_pressure_plate', '橡木压力板', { shape: SH_BOXES, boxes: (m) => [[1, 0, 1, 15, (m & 1) ? 0.5 : 1, 15]], tex: 'oak_planks', render: 'opaque', solid: false, opaque: false, hardness: 0.5, tool: 'axe', sound: 'wood', needsSupport: true, plate: true, redstone: true, fuel: 300 });

const WOOLS = [['white', '白色'], ['orange', '橙色'], ['magenta', '品红色'], ['light_blue', '淡蓝色'], ['yellow', '黄色'], ['lime', '黄绿色'], ['pink', '粉红色'], ['gray', '灰色'], ['light_gray', '淡灰色'], ['cyan', '青色'], ['purple', '紫色'], ['blue', '蓝色'], ['brown', '棕色'], ['green', '绿色'], ['red', '红色'], ['black', '黑色']];
WOOLS.forEach(([c, cn], i) => defBlock(128 + i, c + '_wool', cn + '羊毛', { tex: c + '_wool', hardness: 0.8, sound: 'wool', tool: 'shears', fuel: 100 }));
const SGLASS = [['white', '白色'], ['orange', '橙色'], ['light_blue', '淡蓝色'], ['yellow', '黄色'], ['lime', '黄绿色'], ['pink', '粉红色'], ['cyan', '青色'], ['purple', '紫色'], ['blue', '蓝色'], ['red', '红色'], ['black', '黑色'], ['green', '绿色']];
SGLASS.forEach(([c, cn], i) => defBlock(144 + i, c + '_stained_glass', cn + '染色玻璃', { tex: c + '_stained_glass', render: 'translucent', opaque: false, hardness: 0.3, sound: 'glass', drops: nothing, cullSame: true }));
const CONCRETE = [['white', '白色'], ['orange', '橙色'], ['yellow', '黄色'], ['lime', '黄绿色'], ['light_blue', '淡蓝色'], ['blue', '蓝色'], ['red', '红色'], ['black', '黑色'], ['gray', '灰色']];
CONCRETE.forEach(([c, cn], i) => defBlock(160 + i, c + '_concrete', cn + '混凝土', { tex: c + '_concrete', hardness: 1.8, tool: 'pickaxe', needsTool: true }));

// ---- Structure Blocks (Desert Pyramid, Mineshaft, Village) ----------------
defBlock(170, 'chiseled_sandstone', '雕纹砂岩', { tex: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'chiseled_sandstone' }, hardness: 0.8, tool: 'pickaxe', needsTool: true });
defBlock(171, 'cut_sandstone', '切制砂岩', { tex: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'cut_sandstone' }, hardness: 0.8, tool: 'pickaxe', needsTool: true });
defBlock(172, 'smooth_sandstone', '平滑砂岩', { tex: 'smooth_sandstone', hardness: 2, tool: 'pickaxe', needsTool: true });
defBlock(173, 'sandstone_slab', '砂岩台阶', { shape: SH_BOXES, boxes: (m) => SLAB_BOXES[m & 3], tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone' }, render: 'opaque', hardness: 2, tool: 'pickaxe', needsTool: true, slab: true, drops: slabDrop('sandstone_slab') });
defBlock(174, 'sandstone_stairs', '砂岩楼梯', { shape: SH_BOXES, boxes: stairBoxes, tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone' }, render: 'opaque', hardness: 0.8, tool: 'pickaxe', needsTool: true, stairs: true });
defBlock(175, 'orange_terracotta', '橙色陶瓦', { tex: 'orange_terracotta', hardness: 1.25, tool: 'pickaxe', needsTool: true });
defBlock(176, 'blue_terracotta', '蓝色陶瓦', { tex: 'blue_terracotta', hardness: 1.25, tool: 'pickaxe', needsTool: true });
defBlock(177, 'cobweb', '蜘蛛网', { shape: SH_CROSS, tex: 'cobweb', render: 'cutout', solid: false, opaque: false, hardness: 4, tool: 'sword', sound: 'stone', flatIcon: 'cobweb', web: true, drops: drop('string') });
defBlock(178, 'rail', '铁轨', { shape: SH_MODEL, model: railModel, boxes: () => [[0, 0, 0, 16, 2, 16]], tex: 'rail', render: 'cutout', solid: false, opaque: false, hardness: 0.7, tool: 'pickaxe', sound: 'metal', needsSupport: true, flatIcon: 'rail', rail: true });
defBlock(179, 'oak_fence', '橡木栅栏', { shape: SH_BOXES, boxes: fenceBoxes, tex: 'oak_planks', render: 'opaque', opaque: false, hardness: 2, tool: 'axe', sound: 'wood', fence: true, fuel: 300 });
defBlock(180, 'spruce_fence', '云杉木栅栏', { shape: SH_BOXES, boxes: fenceBoxes, tex: 'spruce_planks', render: 'opaque', opaque: false, hardness: 2, tool: 'axe', sound: 'wood', fence: true, fuel: 300 });
defBlock(181, 'dirt_path', '土径', { shape: SH_BOXES, boxes: () => [[0, 0, 0, 16, 15, 16]], tex: { top: 'dirt_path_top', bottom: 'dirt', side: 'dirt_path_side' }, render: 'opaque', hardness: 0.65, tool: 'shovel', sound: 'gravel', drops: drop('dirt') });
defBlock(182, 'spawner', '刷怪笼', { tex: 'spawner', render: 'cutout', opaque: false, opacity: 1, hardness: 5, tool: 'pickaxe', needsTool: true, sound: 'metal', drops: nothing });
defBlock(183, 'bell', '钟', { shape: SH_MODEL, model: bellModel, boxes: () => [[0, 0, 4, 16, 16, 12]], tex: { top: 'bell_top', bottom: 'bell_bottom', side: 'bell_side' }, render: 'opaque', opaque: false, facing: true, hardness: 5, tool: 'pickaxe', needsTool: true, sound: 'metal', onUse: 'bell' });
defBlock(184, 'spruce_slab', '云杉木台阶', { shape: SH_BOXES, boxes: (m) => SLAB_BOXES[m & 3], tex: 'spruce_planks', render: 'opaque', hardness: 2, tool: 'axe', sound: 'wood', slab: true, fuel: 150, drops: slabDrop('spruce_slab') });
defBlock(185, 'enchanting_table', '附魔台', { shape: SH_BOXES, boxes: () => [[0, 0, 0, 16, 12, 16]], tex: { top: 'enchanting_table_top', bottom: 'enchanting_table_bottom', side: 'enchanting_table_side' }, render: 'opaque', opaque: false, light: 7, hardness: 5, tool: 'pickaxe', needsTool: true, sound: 'stone', onUse: 'enchanting' });
defBlock(186, 'anvil', '铁砧', { shape: SH_MODEL, model: anvilModel, boxes: (m) => (m === 0 || m === 1) ? [[0, 0, 2, 16, 16, 14]] : [[2, 0, 0, 14, 16, 16]], tex: { top: 'anvil_top', bottom: 'anvil_base', side: 'anvil_side' }, render: 'opaque', opaque: false, facing: true, hardness: 5, tool: 'pickaxe', level: 1, needsTool: true, sound: 'metal', gravity: true, onUse: 'anvil' });
defBlock(512, 'prismarine_bricks', '海晶石砖', { tex: 'prismarine_bricks', hardness: 1.5, tool: 'pickaxe', needsTool: true });
BID.test_block = 512; ITEM_KEY.test_block = 512;
defBlock(513, 'hopper', '漏斗', { shape: SH_MODEL, model: hopperModel, boxes: hopperBoxes, tex: { top: 'hopper_top', bottom: 'hopper_outside', side: 'hopper_outside' }, render: 'cutout', opaque: false, solid: true, hardness: 3, tool: 'pickaxe', needsTool: true, sound: 'metal', onUse: 'hopper', hopper: true });

// ---- W2 Redstone Automation Trio (IDs 514..518) ---------------------------
defBlock(514, 'comparator', '红石比较器', {
  shape: SH_MODEL, model: comparatorModel, boxes: () => [[0, 0, 0, 16, 2, 16]],
  tex: 'comparator', render: 'cutout', solid: true, opaque: false, hardness: 0,
  sound: 'wood', needsSupport: true, onUse: 'comparator', flatIcon: 'i_comparator',
  comparator: true, redstone: true
});
defBlock(515, 'observer', '侦测器', {
  tex: { top: 'observer_top', bottom: 'observer_top', side: 'observer_side', front: 'observer_front' },
  texFn: observerTex, hardness: 3, tool: 'pickaxe', needsTool: true, sound: 'stone',
  observer: true, redstone: true
});
defBlock(516, 'piston', '活塞', {
  shape: SH_MODEL, model: (m) => pistonModel(m, false), boxes: pistonBoxes,
  tex: { top: 'piston_top', bottom: 'piston_bottom', side: 'piston_side', front: 'piston_top' },
  render: 'opaque', solid: true, opaque: false, hardness: 1.5, tool: 'pickaxe', sound: 'stone',
  piston: true, redstone: true
});
defBlock(517, 'sticky_piston', '黏性活塞', {
  shape: SH_MODEL, model: (m) => pistonModel(m, true), boxes: pistonBoxes,
  tex: { top: 'piston_top_sticky', bottom: 'piston_bottom', side: 'piston_side', front: 'piston_top_sticky' },
  render: 'opaque', solid: true, opaque: false, hardness: 1.5, tool: 'pickaxe', sound: 'stone',
  piston: true, sticky: true, redstone: true
});
defBlock(518, 'piston_head', '活塞头', {
  shape: SH_MODEL, model: pistonHeadModel, boxes: pistonHeadBoxes,
  tex: 'piston_top', render: 'opaque', solid: true, opaque: false, hardness: 1.5,
  sound: 'stone', noItem: true, pistonHead: true, drops: nothing
});

// ---- 1.20 Cherry Grove & Cherry Wood Set (IDs 519..526) -------------------
defBlock(519, 'cherry_log', '樱花原木', {
  tex: { top: 'cherry_log_top', side: 'cherry_log' }, hardness: 2, tool: 'axe',
  sound: 'wood', axis: true, texFn: logTex, fuel: 300, flammable: true
});
defBlock(520, 'cherry_leaves', '樱花树叶', {
  tex: 'cherry_leaves', render: 'cutout', opaque: false, opacity: 1, hardness: 0.2,
  tool: 'hoe', sound: 'grass', flammable: true,
  drops: (m, r) => { const d = []; if (r() < 0.06) d.push(['cherry_sapling', 1]); if (r() < 0.03) d.push(['stick', 1 + (r() * 2 | 0)]); return d; }
});
defBlock(521, 'cherry_sapling', '樱花树苗', {
  shape: SH_CROSS, tex: 'cherry_sapling', solid: false, hardness: 0, sound: 'grass',
  needsSupport: true, flatIcon: 'cherry_sapling', fuel: 100
});
defBlock(522, 'pink_petals', '粉色花瓣簇', {
  shape: SH_MODEL, model: pinkPetalsModel, boxes: () => [[0, 0, 0, 16, 2, 16]],
  tex: 'pink_petals', render: 'cutout', solid: false, opaque: false, hardness: 0,
  sound: 'grass', needsSupport: true, flatIcon: 'i_pink_petals',
  drops: (m) => [['pink_petals', 1 + (m & 3)]]
});
defBlock(523, 'cherry_slab', '樱花木台阶', {
  shape: SH_BOXES, boxes: (m) => SLAB_BOXES[m & 3], tex: 'cherry_planks',
  render: 'opaque', hardness: 2, tool: 'axe', sound: 'wood', slab: true, fuel: 150,
  drops: slabDrop('cherry_slab')
});
defBlock(524, 'cherry_stairs', '樱花木楼梯', {
  shape: SH_BOXES, boxes: stairBoxes, tex: 'cherry_planks',
  render: 'opaque', hardness: 2, tool: 'axe', sound: 'wood', stairs: true, fuel: 300
});
defBlock(525, 'cherry_door', '樱花木门', {
  shape: SH_BOXES, boxes: doorBoxes, tex: 'cherry_door_bottom',
  render: 'cutout', hardness: 3, tool: 'axe', sound: 'wood', door: true,
  flatIcon: 'i_cherry_door', fuel: 200,
  texFn(face, meta) { return (meta & 8) ? T('cherry_door_top') : T('cherry_door_bottom'); },
  drops: (m) => (m & 8) ? [] : [['cherry_door', 1]]
});
defBlock(526, 'cherry_fence', '樱花木栅栏', {
  shape: SH_BOXES, boxes: fenceBoxes, tex: 'cherry_planks',
  render: 'opaque', opaque: false, hardness: 2, tool: 'axe', sound: 'wood', fence: true, fuel: 300
});

// ---- W1/W2 Brewing Stand (ID 527) -----------------------------------------
defBlock(527, 'brewing_stand', '酿造台', {
  shape: SH_MODEL, model: brewingStandModel,
  boxes: () => [[1, 0, 1, 15, 2, 15], [7, 0, 7, 9, 14, 9]],
  tex: { top: 'brewing_stand', bottom: 'brewing_stand_base', side: 'brewing_stand' },
  render: 'cutout', solid: true, opaque: false, light: 1, hardness: 0.5,
  tool: 'pickaxe', needsTool: true, sound: 'stone', onUse: 'brewing',
  flatIcon: 'i_brewing_stand', brewing: true
});

// ---- W3 Phase 1: Nether Dimension, Portal & Fortress Blocks (IDs 528..537) -
function netherPortalBoxes(m) {
  return (m & 1) ? [[6, 0, 0, 10, 16, 16]] : [[0, 0, 6, 16, 16, 10]];
}
const NETHER_WART_TEX = ['nether_wart_stage0', 'nether_wart_stage1', 'nether_wart_stage1', 'nether_wart_stage2'];
function netherWartTex(face, meta) {
  return T(NETHER_WART_TEX[meta & 3]);
}

defBlock(528, 'nether_portal', '下界传送门', {
  shape: SH_BOXES, boxes: netherPortalBoxes,
  tex: 'nether_portal', render: 'translucent', solid: false, opaque: false,
  light: 11, hardness: -1, sound: 'glass', noItem: true, cullSame: true, drops: nothing
});
defBlock(529, 'netherrack', '下界岩', {
  tex: 'netherrack', hardness: 0.4, tool: 'pickaxe', level: 0, needsTool: true, sound: 'stone'
});
defBlock(530, 'soul_sand', '灵魂沙', {
  tex: 'soul_sand', hardness: 0.5, tool: 'shovel', sound: 'sand', slip: 0.6
});
defBlock(531, 'nether_quartz_ore', '下界石英矿石', {
  tex: 'nether_quartz_ore', hardness: 3, tool: 'pickaxe', level: 0, needsTool: true,
  sound: 'stone', drops: drop('quartz')
});
defBlock(532, 'nether_gold_ore', '下界金矿石', {
  tex: 'nether_gold_ore', hardness: 3, tool: 'pickaxe', level: 0, needsTool: true,
  sound: 'stone', drops: (m, r) => [['gold_nugget', 2 + ((r() * 5) | 0)]]
});
defBlock(533, 'nether_bricks', '下界砖块', {
  tex: 'nether_bricks', hardness: 2, tool: 'pickaxe', level: 0, needsTool: true, sound: 'stone'
});
defBlock(534, 'nether_brick_fence', '下界砖栅栏', {
  shape: SH_BOXES, boxes: fenceBoxes, tex: 'nether_bricks',
  render: 'opaque', opaque: false, hardness: 2, tool: 'pickaxe', needsTool: true, sound: 'stone', fence: true
});
defBlock(535, 'nether_brick_stairs', '下界砖楼梯', {
  shape: SH_BOXES, boxes: stairBoxes, tex: 'nether_bricks',
  render: 'opaque', hardness: 2, tool: 'pickaxe', needsTool: true, sound: 'stone', stairs: true
});
defBlock(536, 'nether_wart_crop', '下界疣', {
  shape: SH_CROP, tex: 'nether_wart_stage0', texFn: netherWartTex,
  solid: false, hardness: 0, sound: 'grass', noItem: true, needsSupport: true,
  drops: (m, r) => [['nether_wart', (m & 3) === 3 ? 2 + ((r() * 3) | 0) : 1]]
});
defBlock(537, 'fire', '火', {
  shape: SH_CROSS, tex: 'fire_0', render: 'cutout',
  solid: false, opaque: false, replaceable: true, light: 15, hardness: 0,
  sound: 'wood', noItem: true, drops: nothing
});

// ---- W3 Phase 2: Stronghold, End Portal, The End & Dragon Egg (IDs 538..543) -
function endPortalFrameBoxes(meta) {
  return (meta & 4) ? [[0, 0, 0, 16, 13, 16], [4, 13, 4, 12, 16, 12]] : [[0, 0, 0, 16, 13, 16]];
}
function endPortalFrameModel(meta) {
  const tTop = T('end_portal_frame_top'), tBot = T('end_portal_frame_bottom'), tSide = T('end_portal_frame_side'), tEye = T('end_portal_frame_eye');
  // When empty, recess the 8x8 central socket (from y=9..13) as in the Pixel Perfection 3D block model
  if (!(meta & 4)) {
    const els = [
      {
        from: [0, 0, 0], to: [16, 9, 16],
        faces: {
          down: [0, 0, 16, 16, tBot],
          up: [0, 0, 16, 16, tTop],
          north: [0, 7, 16, 16, tSide],
          south: [0, 7, 16, 16, tSide],
          west: [0, 7, 16, 16, tSide],
          east: [0, 7, 16, 16, tSide],
        }
      },
      {
        from: [0, 9, 0], to: [4, 13, 16],
        faces: {
          up: [0, 0, 4, 16, tTop],
          north: [12, 3, 16, 7, tSide],
          south: [0, 3, 4, 7, tSide],
          west: [0, 3, 16, 7, tSide],
          east: [4, 3, 12, 7, tSide],
        }
      },
      {
        from: [12, 9, 0], to: [16, 13, 16],
        faces: {
          up: [12, 0, 16, 16, tTop],
          north: [0, 3, 4, 7, tSide],
          south: [12, 3, 16, 7, tSide],
          west: [4, 3, 12, 7, tSide],
          east: [0, 3, 16, 7, tSide],
        }
      },
      {
        from: [4, 9, 0], to: [12, 13, 4],
        faces: {
          up: [4, 0, 12, 4, tTop],
          north: [4, 3, 12, 7, tSide],
          south: [4, 3, 12, 7, tSide],
        }
      },
      {
        from: [4, 9, 12], to: [12, 13, 16],
        faces: {
          up: [4, 12, 12, 16, tTop],
          north: [4, 3, 12, 7, tSide],
          south: [4, 3, 12, 7, tSide],
        }
      },
    ];
    return { rot: meta & 3, els };
  }
  const els = [
    {
      from: [0, 0, 0], to: [16, 13, 16],
      faces: {
        up: [0, 0, 16, 16, tTop],
        down: [0, 0, 16, 16, tBot],
        north: [0, 3, 16, 16, tSide],
        south: [0, 3, 16, 16, tSide],
        west: [0, 3, 16, 16, tSide],
        east: [0, 3, 16, 16, tSide],
      }
    },
    {
      from: [4, 9, 4], to: [12, 16, 12],
      faces: {
        up: [4, 4, 12, 12, tEye],
        north: [4, 0, 12, 3, tEye],
        south: [4, 0, 12, 3, tEye],
        west: [4, 0, 12, 3, tEye],
        east: [4, 0, 12, 3, tEye],
      }
    }
  ];
  return { rot: meta & 3, els };
}

function ironBarsBoxes(m) {
  const b = [[7, 0, 7, 9, 16, 9]];
  if (m & 1) b.push([7, 0, 0, 9, 16, 7]);
  if (m & 2) b.push([7, 0, 9, 9, 16, 16]);
  if (m & 4) b.push([0, 0, 7, 7, 16, 9]);
  if (m & 8) b.push([9, 0, 7, 16, 16, 9]);
  return b;
}

function ironBarsModel(meta) {
  const t = T('iron_bars');
  const els = [
    {
      from: [7, 0, 7], to: [9, 16, 9],
      faces: {
        north: [7, 0, 9, 16, t],
        south: [7, 0, 9, 16, t],
        west: [7, 0, 9, 16, t],
        east: [7, 0, 9, 16, t],
        up: [7, 7, 9, 9, t],
        down: [7, 7, 9, 9, t],
      }
    }
  ];
  if (meta & 1) { // north (-z)
    els.push({
      from: [7.8, 0, 0], to: [8.2, 16, 8],
      faces: {
        west: [0, 0, 8, 16, t],
        east: [8, 0, 0, 16, t],
        north: [7, 0, 9, 16, t],
        up: [7, 0, 9, 8, t],
        down: [7, 0, 9, 8, t],
      }
    });
  }
  if (meta & 2) { // south (+z)
    els.push({
      from: [7.8, 0, 8], to: [8.2, 16, 16],
      faces: {
        west: [8, 0, 16, 16, t],
        east: [16, 0, 8, 16, t],
        south: [7, 0, 9, 16, t],
        up: [7, 8, 9, 16, t],
        down: [7, 8, 9, 16, t],
      }
    });
  }
  if (meta & 4) { // west (-x)
    els.push({
      from: [0, 0, 7.8], to: [8, 16, 8.2],
      faces: {
        north: [8, 0, 16, 16, t],
        south: [0, 0, 8, 16, t],
        west: [7, 0, 9, 16, t],
        up: [0, 7, 8, 9, t],
        down: [0, 7, 8, 9, t],
      }
    });
  }
  if (meta & 8) { // east (+x)
    els.push({
      from: [8, 0, 7.8], to: [16, 16, 8.2],
      faces: {
        north: [0, 0, 8, 16, t],
        south: [8, 0, 16, 16, t],
        east: [7, 0, 9, 16, t],
        up: [8, 7, 16, 9, t],
        down: [8, 7, 16, 9, t],
      }
    });
  }
  return { rot: 0, els };
}
function dragonEggModel() {
  const t = T('dragon_egg');
  const box = (x0, y0, z0, x1, y1, z1) => ({
    from: [x0, y0, z0], to: [x1, y1, z1],
    faces: {
      up: [x0, z0, x1, z1, t],
      down: [x0, z0, x1, z1, t],
      north: [x0, 16 - y1, x1, 16 - y0, t],
      south: [x0, 16 - y1, x1, 16 - y0, t],
      west: [z0, 16 - y1, z1, 16 - y0, t],
      east: [z0, 16 - y1, z1, 16 - y0, t],
    }
  });
  return {
    rot: 0,
    els: [
      box(3, 0, 3, 13, 2, 13),
      box(2, 2, 2, 14, 7, 14),
      box(3, 7, 3, 13, 11, 13),
      box(4, 11, 4, 12, 14, 12),
      box(6, 14, 6, 10, 16, 10),
    ]
  };
}

defBlock(538, 'end_portal_frame', '末地传送门框架', {
  shape: SH_MODEL, model: endPortalFrameModel, boxes: endPortalFrameBoxes,
  tex: { top: 'end_portal_frame_top', bottom: 'end_portal_frame_bottom', side: 'end_portal_frame_side' },
  render: 'cutout', solid: true, opaque: false, light: 1, hardness: -1, sound: 'stone', drops: nothing
});
defBlock(539, 'end_portal', '末地传送门', {
  shape: SH_BOXES, boxes: () => [[0, 0, 0, 16, 12, 16]],
  tex: 'end_portal', render: 'opaque', solid: false, opaque: false,
  light: 15, hardness: -1, sound: 'glass', noItem: true, cullSame: true, drops: nothing
});
defBlock(540, 'end_stone', '末地石', {
  tex: 'end_stone', hardness: 3, tool: 'pickaxe', level: 0, needsTool: true, sound: 'stone'
});
defBlock(541, 'dragon_egg', '龙蛋', {
  shape: SH_MODEL, model: dragonEggModel, boxes: () => [[1, 0, 1, 15, 16, 15]],
  tex: 'dragon_egg', render: 'cutout', solid: true, opaque: false,
  light: 1, hardness: 3, sound: 'stone', gravity: true, onUse: 'dragon_egg'
});
defBlock(542, 'iron_bars', '铁栏杆', {
  shape: SH_MODEL, model: ironBarsModel, boxes: ironBarsBoxes, tex: 'iron_bars',
  render: 'cutout', solid: true, opaque: false, hardness: 5, tool: 'pickaxe', level: 0, needsTool: true,
  sound: 'metal', fence: true, flatIcon: 'iron_bars'
});
defBlock(543, 'end_stone_bricks', '末地石砖', {
  tex: 'end_stone_bricks', hardness: 3, tool: 'pickaxe', level: 0, needsTool: true, sound: 'stone'
});

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------
let nextItem = 256;
function defItem(key, cn, o = {}) {
  if (nextItem >= 512 && nextItem < 1024) nextItem = 1024;
  const id = o.id !== undefined ? o.id : nextItem++;
  const iconIdx = (ITEMS[id] && ITEMS[id].iconIdx !== undefined) ? ITEMS[id].iconIdx : nextIconIdx++;
  const it = Object.assign({ id, key, cn, stack: 64, tex: T('i_' + (o.texKey || key)), iconIdx }, o);
  ITEMS[id] = it; ITEM_KEY[key] = id;
  return it;
}
const TOOL_MAT = { wooden: [0, 2, 59, '木'], stone: [1, 4, 131, '石'], iron: [2, 6, 250, '铁'], golden: [0, 12, 32, '金'], diamond: [3, 8, 1561, '钻石'] };
const TOOL_DMG = { sword: [4, 5, 6, 4, 7], axe: [7, 9, 9, 7, 9], pickaxe: [2, 3, 4, 2, 5], shovel: [2.5, 3.5, 4.5, 2.5, 5.5], hoe: [1, 1, 1, 1, 1] };
const TOOL_CN = { pickaxe: '镐', axe: '斧', shovel: '锹', sword: '剑', hoe: '锄' };

defItem('stick', '木棍', { fuel: 100 });
defItem('coal', '煤炭', { fuel: 1600 });
defItem('charcoal', '木炭', { fuel: 1600 });
defItem('raw_iron', '粗铁');
defItem('iron_ingot', '铁锭');
defItem('raw_gold', '粗金');
defItem('gold_ingot', '金锭');
defItem('diamond', '钻石');
defItem('emerald', '绿宝石');
defItem('lapis_lazuli', '青金石');
defItem('redstone', '红石粉', { places: 'redstone_wire' });
defItem('repeater', '红石中继器', { places: 'repeater' });
defItem('flint', '燧石');
defItem('apple', '苹果', { food: [4, 2.4] });
defItem('bread', '面包', { food: [5, 6] });
defItem('wheat', '小麦');
defItem('wheat_seeds', '小麦种子', { places: 'wheat' });
defItem('porkchop', '生猪排', { food: [3, 1.8] });
defItem('cooked_porkchop', '熟猪排', { food: [8, 12.8] });
defItem('beef', '生牛肉', { food: [3, 1.8] });
defItem('cooked_beef', '牛排', { food: [8, 12.8] });
defItem('mutton', '生羊肉', { food: [2, 1.2] });
defItem('cooked_mutton', '熟羊肉', { food: [6, 9.6] });
defItem('chicken', '生鸡肉', { food: [2, 1.2] });
defItem('cooked_chicken', '熟鸡肉', { food: [6, 7.2] });
defItem('rotten_flesh', '腐肉', { food: [4, 0.8] });
defItem('melon_slice', '西瓜片', { food: [2, 1.2] });
defItem('cookie', '曲奇', { food: [2, 0.4] });
defItem('pumpkin_pie', '南瓜派', { food: [8, 4.8] });
defItem('golden_apple', '金苹果', { food: [4, 9.6], heal: 4 });
defItem('baked_potato', '烤马铃薯', { food: [5, 6] });
defItem('carrot', '胡萝卜', { food: [3, 3.6] });
defItem('bone', '骨头');
defItem('bone_meal', '骨粉');
defItem('arrow', '箭');
defItem('bow', '弓', { stack: 1, durability: 384 });
defItem('shield', '盾牌', { stack: 1, durability: 336, shield: true, texKey: 'shield' });
defItem('string', '线');
defItem('gunpowder', '火药');
defItem('feather', '羽毛');
defItem('leather', '皮革');
defItem('egg', '鸡蛋', { stack: 16 });
defItem('snowball', '雪球', { stack: 16 });
defItem('shears', '剪刀', { stack: 1, durability: 238 });
defItem('flint_and_steel', '打火石', { stack: 1, durability: 64 });
defItem('bucket', '桶', { stack: 16 });
defItem('water_bucket', '水桶', { stack: 1, places: 'water' });
defItem('lava_bucket', '熔岩桶', { stack: 1, places: 'lava', fuel: 20000 });
for (const mat of ['wooden', 'stone', 'iron', 'golden', 'diamond']) {
  const [level, speed, dur, cn] = TOOL_MAT[mat];
  const mi = ['wooden', 'stone', 'iron', 'golden', 'diamond'].indexOf(mat);
  for (const t of ['pickaxe', 'axe', 'shovel', 'sword', 'hoe']) {
    defItem(mat + '_' + t, cn + TOOL_CN[t], { stack: 1, durability: dur, tool: { type: t, level, speed }, attack: TOOL_DMG[t][mi], fuel: mat === 'wooden' ? 200 : 0 });
  }
}
defItem('oak_door', '橡木门', { places: 'oak_door', fuel: 200 });
defItem('sugar_cane', '甘蔗', { places: 'sugar_cane' });
defItem('sugar', '糖');
defItem('paper', '纸');
defItem('book', '书');
defItem('enchanted_book', '附魔书', { stack: 1 });
defItem('clay_ball', '黏土球');
defItem('brick', '红砖');
const ARMOR_PTS = { leather: [1, 3, 2, 1], iron: [2, 6, 5, 2], diamond: [3, 8, 6, 3] };
const ARMOR_DUR = { leather: 80, iron: 240, diamond: 528 };
const ARMOR_CN = { leather: '皮革', iron: '铁', diamond: '钻石' };
for (const mat of ['leather', 'iron', 'diamond']) {
  ['helmet', 'chestplate', 'leggings', 'boots'].forEach((p, i) => {
    defItem(mat + '_' + p, ARMOR_CN[mat] + ['头盔', '胸甲', '护腿', '靴子'][i], { stack: 1, durability: ARMOR_DUR[mat], armor: { slot: i, points: ARMOR_PTS[mat][i] } });
  });
}

for (const [m, cn] of [['pig', '猪'], ['cow', '牛'], ['sheep', '羊'], ['chicken', '鸡'], ['zombie', '僵尸'], ['skeleton', '骷髅'], ['creeper', '苦力怕'], ['spider', '蜘蛛'], ['villager', '村民'], ['blaze', '烈焰人'], ['wither_skeleton', '凋零骷髅'], ['ghast', '恶魂'], ['zombified_piglin', '僵尸猪人'], ['enderman', '末影人']]) defItem(m + '_spawn_egg', cn + '刷怪蛋', { spawnEgg: m });

// ---- Brewing Ingredients & 4 Core Potions (1024+) -------------------------
defItem('golden_carrot', '金胡萝卜', { food: [6, 14.4] });
defItem('glass_bottle', '玻璃瓶', { stack: 64 });
defItem('blaze_rod', '烈焰棒', { fuel: 2400 });
defItem('blaze_powder', '烈焰粉');
defItem('nether_wart', '下界疣', { places: 'nether_wart_crop' });
defItem('quartz', '下界石英');
defItem('gold_nugget', '金粒');
defItem('ghast_tear', '恶魂之泪');
defItem('ender_pearl', '末影珍珠', { stack: 16 });
defItem('eye_of_ender', '末影之眼', { texKey: 'ender_eye' });
ITEM_KEY.ender_eye = ITEM_KEY.eye_of_ender;
defItem('end_crystal', '末影水晶', { texKey: 'end_crystal' });
defItem('dragon_breath', '龙息', { texKey: 'dragon_breath' });
defItem('nether_brick', '下界砖');
defItem('fire_charge', '火焰弹');
defItem('glistering_melon_slice', '闪烁的西瓜片');
defItem('magma_cream', '岩浆膏');
defItem('water_bottle', '水瓶', { stack: 1, potion: 'water', texKey: 'water_bottle' });
defItem('awkward_potion', '粗制的药水', { stack: 1, potion: 'awkward', texKey: 'awkward_potion' });
defItem('potion_healing', '瞬间治疗药水', {
  stack: 1, potion: 'instant_health', potionDuration: 0, potionLevel: 1, texKey: 'potion_healing',
  effect: { id: 'instant_health', cn: '瞬间治疗', duration: 0, amp: 0, heal: 8 }
});
defItem('potion_fire_resistance', '抗火药水', {
  stack: 1, potion: 'fire_resistance', potionDuration: 3600, potionLevel: 1, texKey: 'potion_fire_resistance',
  effect: { id: 'fire_resistance', cn: '抗火', duration: 3600, amp: 0 }
});
defItem('potion_swiftness', '迅捷药水', {
  stack: 1, potion: 'speed', potionDuration: 3600, potionLevel: 1, texKey: 'potion_swiftness',
  effect: { id: 'speed', cn: '迅捷', duration: 3600, amp: 0 }
});
defItem('potion_night_vision', '夜视药水', {
  stack: 1, potion: 'night_vision', potionDuration: 3600, potionLevel: 1, texKey: 'potion_night_vision',
  effect: { id: 'night_vision', cn: '夜视', duration: 3600, amp: 0 }
});

// Aliases for potion keys
ITEM_KEY.potion_water = ITEM_KEY.water_bottle;
ITEM_KEY.instant_health_potion = ITEM_KEY.potion_healing;
ITEM_KEY.healing_potion = ITEM_KEY.potion_healing;
ITEM_KEY.potion_instant_health = ITEM_KEY.potion_healing;
ITEM_KEY.fire_resistance_potion = ITEM_KEY.potion_fire_resistance;
ITEM_KEY.swiftness_potion = ITEM_KEY.potion_swiftness;
ITEM_KEY.speed_potion = ITEM_KEY.potion_swiftness;
ITEM_KEY.potion_speed = ITEM_KEY.potion_swiftness;
ITEM_KEY.night_vision_potion = ITEM_KEY.potion_night_vision;

const STATUS_EFFECTS = {
  instant_health: { id: 'instant_health', cn: '瞬间治疗', icon: 'eff_instant_health', color: '#F82423', instant: true },
  fire_resistance: { id: 'fire_resistance', cn: '抗火', icon: 'eff_fire_resistance', color: '#E49A3A' },
  speed: { id: 'speed', cn: '迅捷', icon: 'eff_speed', color: '#7CAFC6' },
  night_vision: { id: 'night_vision', cn: '夜视', icon: 'eff_night_vision', color: '#3F5FFF' },
  wither: { id: 'wither', cn: '凋零', icon: 'eff_wither', color: '#352A27' },
};

function item(key) { const id = ITEM_KEY[key]; if (id === undefined) throw new Error('no item ' + key); return id; }
function itemDef(id) { return ITEMS[id]; }
function makeStack(key, count = 1) { const id = typeof key === 'number' ? key : item(key); return { id, count, dmg: 0 }; }
function maxStack(id) { return ITEMS[id] ? ITEMS[id].stack : 64; }

const BREWING_RECIPES = [
  { base: 'water_bottle', ing: 'nether_wart', out: 'awkward_potion' },
  { base: 'awkward_potion', ing: 'glistering_melon_slice', out: 'potion_healing' },
  { base: 'awkward_potion', ing: 'magma_cream', out: 'potion_fire_resistance' },
  { base: 'awkward_potion', ing: 'sugar', out: 'potion_swiftness' },
  { base: 'awkward_potion', ing: 'golden_carrot', out: 'potion_night_vision' },
  // Direct convenience fallback from water_bottle
  { base: 'water_bottle', ing: 'glistering_melon_slice', out: 'potion_healing' },
  { base: 'water_bottle', ing: 'magma_cream', out: 'potion_fire_resistance' },
  { base: 'water_bottle', ing: 'sugar', out: 'potion_swiftness' },
  { base: 'water_bottle', ing: 'golden_carrot', out: 'potion_night_vision' },
];

const Brewing = {
  STATUS_EFFECTS,
  BREWING_RECIPES,
  isBottle(stOrId) {
    const id = stOrId && typeof stOrId === 'object' ? stOrId.id : stOrId;
    const d = ITEMS[id];
    return !!(d && d.potion);
  },
  isIngredient(stOrId) {
    const id = stOrId && typeof stOrId === 'object' ? stOrId.id : stOrId;
    return BREWING_RECIPES.some(r => item(r.ing) === id);
  },
  isFuel(stOrId) {
    const id = stOrId && typeof stOrId === 'object' ? stOrId.id : stOrId;
    return id === item('blaze_powder');
  },
  match(baseStOrId, ingStOrId) {
    const baseId = baseStOrId && typeof baseStOrId === 'object' ? baseStOrId.id : baseStOrId;
    const ingId = ingStOrId && typeof ingStOrId === 'object' ? ingStOrId.id : ingStOrId;
    if (!baseId || !ingId) return null;
    for (const r of BREWING_RECIPES) {
      if (item(r.base) === baseId && item(r.ing) === ingId) return item(r.out);
    }
    return null;
  },
  canBrew(be) {
    if (!be || !be.ingredient || !Array.isArray(be.bottles)) return false;
    return be.bottles.some(b => b && this.match(b, be.ingredient) !== null);
  },
  formatDuration(ticks) {
    const sec = Math.max(0, Math.ceil((ticks || 0) / 20));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  },
};

if (typeof window !== 'undefined') {
  window.STATUS_EFFECTS = STATUS_EFFECTS;
  window.BREWING_RECIPES = BREWING_RECIPES;
  window.Brewing = Brewing;
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------
const TAGS = {
  planks: ['oak_planks', 'birch_planks', 'spruce_planks', 'dark_oak_planks', 'jungle_planks', 'acacia_planks', 'cherry_planks'],
  coals: ['coal', 'charcoal'],
  stone_tool: ['cobblestone'],
  logs: ['oak_log', 'birch_log', 'spruce_log', 'cherry_log'],
  wool: ['white_wool', 'orange_wool', 'magenta_wool', 'light_blue_wool', 'yellow_wool', 'lime_wool', 'pink_wool', 'gray_wool', 'light_gray_wool', 'cyan_wool', 'purple_wool', 'blue_wool', 'brown_wool', 'green_wool', 'red_wool', 'black_wool'],
};
const RECIPES = [];
function shaped(result, count, pattern, keys) {
  const k = {};
  for (const c in keys) k[c] = (TAGS[keys[c]] || [keys[c]]).map(item);
  RECIPES.push({ type: 'shaped', result: item(result), count, pattern, keys: k, w: pattern[0].length, h: pattern.length });
}
function shapeless(result, count, ingredients) {
  RECIPES.push({ type: 'shapeless', result: item(result), count, ing: ingredients.map(i => (TAGS[i] || [i]).map(item)) });
}
shapeless('oak_planks', 4, ['oak_log']);
shapeless('birch_planks', 4, ['birch_log']);
shapeless('spruce_planks', 4, ['spruce_log']);
shapeless('cherry_planks', 4, ['cherry_log']);
shaped('stick', 4, ['#', '#'], { '#': 'planks' });
shaped('crafting_table', 1, ['##', '##'], { '#': 'planks' });
shaped('furnace', 1, ['###', '# #', '###'], { '#': 'cobblestone' });
shaped('chest', 1, ['###', '# #', '###'], { '#': 'planks' });
shaped('hopper', 1, ['I I', 'ICI', ' I '], { I: 'iron_ingot', C: 'chest' });
shaped('torch', 4, ['C', '#'], { C: 'coals', '#': 'stick' });
const TOOL_KEYS = { wooden: 'planks', stone: 'cobblestone', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
for (const m in TOOL_KEYS) {
  const X = TOOL_KEYS[m];
  shaped(m + '_pickaxe', 1, ['XXX', ' # ', ' # '], { X, '#': 'stick' });
  shaped(m + '_axe', 1, ['XX', 'X#', ' #'], { X, '#': 'stick' });
  shaped(m + '_shovel', 1, ['X', '#', '#'], { X, '#': 'stick' });
  shaped(m + '_sword', 1, ['X', 'X', '#'], { X, '#': 'stick' });
  shaped(m + '_hoe', 1, ['XX', ' #', ' #'], { X, '#': 'stick' });
}
for (const [m, X] of [['leather', 'leather'], ['iron', 'iron_ingot'], ['diamond', 'diamond']]) {
  shaped(m + '_helmet', 1, ['XXX', 'X X'], { X });
  shaped(m + '_chestplate', 1, ['X X', 'XXX', 'XXX'], { X });
  shaped(m + '_leggings', 1, ['XXX', 'X X', 'X X'], { X });
  shaped(m + '_boots', 1, ['X X', 'X X'], { X });
}
shaped('bow', 1, [' #S', '# S', ' #S'], { '#': 'stick', S: 'string' });
shaped('shield', 1, ['W#W', 'WWW', ' W '], { W: 'planks', '#': 'iron_ingot' });
shaped('arrow', 4, ['F', '#', 'E'], { F: 'flint', '#': 'stick', E: 'feather' });
shaped('bucket', 1, ['X X', ' X '], { X: 'iron_ingot' });
shaped('shears', 1, [' X', 'X '], { X: 'iron_ingot' });
shapeless('flint_and_steel', 1, ['iron_ingot', 'flint']);
for (const [b, i] of [['iron_block', 'iron_ingot'], ['gold_block', 'gold_ingot'], ['diamond_block', 'diamond'], ['coal_block', 'coal'], ['emerald_block', 'emerald'], ['lapis_block', 'lapis_lazuli'], ['redstone_block', 'redstone'], ['hay_block', 'wheat']]) {
  shaped(b, 1, ['XXX', 'XXX', 'XXX'], { X: i });
  shapeless(i, 9, [b]);
}
shaped('melon', 1, ['XXX', 'XXX', 'XXX'], { X: 'melon_slice' });
shaped('tnt', 1, ['#S#', 'S#S', '#S#'], { '#': 'gunpowder', S: 'sand' });
shaped('bread', 1, ['WWW'], { W: 'wheat' });
shapeless('sugar', 1, ['sugar_cane']);
shaped('paper', 3, ['###'], { '#': 'sugar_cane' });
shapeless('book', 1, ['paper', 'paper', 'paper', 'leather']);
shaped('bookshelf', 1, ['###', 'BBB', '###'], { '#': 'planks', B: 'book' });
shaped('enchanting_table', 1, [' B ', 'D#D', '###'], { B: 'book', D: 'diamond', '#': 'obsidian' });
shaped('anvil', 1, ['BBB', ' I ', 'III'], { B: 'iron_block', I: 'iron_ingot' });
shaped('bricks', 1, ['##', '##'], { '#': 'brick' });
shaped('clay', 1, ['##', '##'], { '#': 'clay_ball' });
shaped('stone_bricks', 4, ['##', '##'], { '#': 'stone' });
shaped('sandstone', 1, ['##', '##'], { '#': 'sand' });
shaped('snow_block', 1, ['##', '##'], { '#': 'snowball' });
shaped('white_wool', 1, ['##', '##'], { '#': 'string' });
shaped('polished_andesite', 4, ['##', '##'], { '#': 'andesite' });
shaped('polished_diorite', 4, ['##', '##'], { '#': 'diorite' });
shaped('polished_granite', 4, ['##', '##'], { '#': 'granite' });
shaped('smooth_stone_slab', 6, ['###'], { '#': 'smooth_stone' });
shaped('oak_slab', 6, ['###'], { '#': 'oak_planks' });
shaped('birch_slab', 6, ['###'], { '#': 'birch_planks' });
shaped('cherry_slab', 6, ['###'], { '#': 'cherry_planks' });
shaped('cobblestone_slab', 6, ['###'], { '#': 'cobblestone' });
shaped('stone_brick_slab', 6, ['###'], { '#': 'stone_bricks' });
shaped('oak_stairs', 4, ['#  ', '## ', '###'], { '#': 'oak_planks' });
shaped('spruce_stairs', 4, ['#  ', '## ', '###'], { '#': 'spruce_planks' });
shaped('cherry_stairs', 4, ['#  ', '## ', '###'], { '#': 'cherry_planks' });
shaped('cobblestone_stairs', 4, ['#  ', '## ', '###'], { '#': 'cobblestone' });
shaped('stone_brick_stairs', 4, ['#  ', '## ', '###'], { '#': 'stone_bricks' });
shaped('brick_stairs', 4, ['#  ', '## ', '###'], { '#': 'bricks' });
// Register cherry_door BEFORE generic planks oak_door so cherry_planks craft cherry_door
shaped('cherry_door', 3, ['##', '##', '##'], { '#': 'cherry_planks' });
shaped('oak_door', 3, ['##', '##', '##'], { '#': 'planks' });
shaped('oak_trapdoor', 2, ['###', '###'], { '#': 'planks' });
shaped('ladder', 3, ['# #', '###', '# #'], { '#': 'stick' });
shaped('red_bed', 1, ['WWW', 'PPP'], { W: 'wool', P: 'planks' });
shapeless('jack_o_lantern', 1, ['pumpkin', 'torch']);
shapeless('bone_meal', 3, ['bone']);
shaped('golden_apple', 1, ['GGG', 'GAG', 'GGG'], { G: 'gold_ingot', A: 'apple' });
shapeless('pumpkin_pie', 1, ['pumpkin', 'sugar', 'egg']);
shaped('mossy_cobblestone', 1, ['#M'], { '#': 'cobblestone', M: 'moss_block' });
shaped('sea_lantern', 1, ['LGL', 'GGG', 'LGL'], { L: 'lapis_lazuli', G: 'glass' });
shaped('note_block', 1, ['###', '#R#', '###'], { '#': 'planks', R: 'redstone' });
shaped('quartz_block', 1, ['##', '##'], { '#': 'quartz' });
shaped('nether_bricks', 1, ['##', '##'], { '#': 'nether_brick' });
shaped('nether_brick_stairs', 4, ['#  ', '## ', '###'], { '#': 'nether_bricks' });
shaped('nether_brick_fence', 6, ['B#B', 'B#B'], { B: 'nether_bricks', '#': 'nether_brick' });
shaped('gold_ingot', 1, ['###', '###', '###'], { '#': 'gold_nugget' });
shapeless('gold_nugget', 9, ['gold_ingot']);
// Redstone & Automation Trio recipes (using genuine Nether Quartz)
shaped('redstone_torch', 1, ['R', '#'], { R: 'redstone', '#': 'stick' });
shaped('lever', 1, ['#', 'S'], { '#': 'stick', S: 'cobblestone' });
shapeless('stone_button', 1, ['stone']);
shapeless('oak_button', 1, ['planks']);
shaped('stone_pressure_plate', 1, ['##'], { '#': 'stone' });
shaped('oak_pressure_plate', 1, ['##'], { '#': 'planks' });
shaped('redstone_lamp', 1, [' R ', 'RGR', ' R '], { R: 'redstone', G: 'glowstone' });
shaped('repeater', 1, ['TRT', 'SSS'], { T: 'redstone_torch', R: 'redstone', S: 'stone' });
shaped('comparator', 1, [' T ', 'TQT', 'SSS'], { T: 'redstone_torch', Q: 'quartz', S: 'stone' });
shaped('comparator', 1, [' T ', 'TQT', 'SSS'], { T: 'redstone_torch', Q: 'quartz_block', S: 'stone' });
shaped('observer', 1, ['###', 'RRQ', '###'], { '#': 'cobblestone', R: 'redstone', Q: 'quartz' });
shaped('observer', 1, ['###', 'RRQ', '###'], { '#': 'cobblestone', R: 'redstone', Q: 'quartz_block' });
shaped('piston', 1, ['PPP', '#I#', '#R#'], { P: 'planks', '#': 'cobblestone', I: 'iron_ingot', R: 'redstone' });
shapeless('sticky_piston', 1, ['piston', 'magma_cream']);
shapeless('sticky_piston', 1, ['piston', 'clay_ball']);
shaped('target', 1, [' R ', 'RHR', ' R '], { R: 'redstone', H: 'hay_block' });

// Brewing Stand & Brewing Ingredients recipes (blaze_rod & nether_wart come from Nether Fortress!)
shaped('glass_bottle', 3, ['# #', ' # '], { '#': 'glass' });
shaped('brewing_stand', 1, [' B ', '###'], { B: 'blaze_rod', '#': 'cobblestone' });
shapeless('blaze_powder', 2, ['blaze_rod']);
shaped('glistering_melon_slice', 1, ['###', '#M#', '###'], { '#': 'gold_nugget', M: 'melon_slice' });
shaped('glistering_melon_slice', 1, ['GGG', 'GMG', 'GGG'], { G: 'gold_ingot', M: 'melon_slice' });
shapeless('glistering_melon_slice', 1, ['melon_slice', 'gold_ingot']);
shaped('golden_carrot', 1, ['###', '#C#', '###'], { '#': 'gold_nugget', C: 'carrot' });
shaped('golden_carrot', 1, ['GGG', 'GCG', 'GGG'], { G: 'gold_ingot', C: 'carrot' });
shapeless('golden_carrot', 1, ['carrot', 'gold_ingot']);
shapeless('magma_cream', 1, ['blaze_powder', 'clay_ball']);
shapeless('magma_cream', 2, ['magma_block']);
shapeless('fire_charge', 3, ['blaze_powder', 'coals', 'gunpowder']);
shapeless('eye_of_ender', 1, ['ender_pearl', 'blaze_powder']);
shaped('end_stone_bricks', 4, ['##', '##'], { '#': 'end_stone' });
shaped('iron_bars', 16, ['###', '###'], { '#': 'iron_ingot' });
shaped('end_crystal', 1, ['GGG', 'GEG', 'GTG'], { G: 'glass', E: 'eye_of_ender', T: 'ghast_tear' });

// Match a crafting grid (array of stacks|null, width w) against recipes
function matchRecipe(grid, w) {
  const h = grid.length / w;
  // find bounding box
  let minX = w, minY = h, maxX = -1, maxY = -1, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grid[y * w + x]) { n++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  if (!n) return null;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  for (const r of RECIPES) {
    if (r.type === 'shaped') {
      if (r.w !== bw || r.h !== bh) continue;
      for (const mirror of [false, true]) {
        let ok = true;
        for (let y = 0; y < bh && ok; y++) for (let x = 0; x < bw && ok; x++) {
          const c = r.pattern[y][mirror ? bw - 1 - x : x];
          const s = grid[(minY + y) * w + minX + x];
          if (c === ' ' || c === undefined) { if (s) ok = false; }
          else if (!s || !r.keys[c].includes(s.id)) ok = false;
        }
        if (ok) return r;
      }
    } else {
      if (r.ing.length !== n) continue;
      const used = new Array(r.ing.length).fill(false);
      let ok = true;
      for (const s of grid) {
        if (!s) continue;
        let found = false;
        for (let i = 0; i < r.ing.length; i++) if (!used[i] && r.ing[i].includes(s.id)) { used[i] = true; found = true; break; }
        if (!found) { ok = false; break; }
      }
      if (ok) return r;
    }
  }
  return null;
}

const SMELTING = {};
function smelt(a, b, xp = 0.1) { SMELTING[item(a)] = { result: item(b), xp }; }
smelt('raw_iron', 'iron_ingot', 0.7); smelt('raw_gold', 'gold_ingot', 1); smelt('sand', 'glass'); smelt('red_sand', 'glass');
smelt('cobblestone', 'stone'); smelt('stone', 'smooth_stone'); smelt('clay_ball', 'brick', 0.3); smelt('clay', 'terracotta', 0.35);
smelt('oak_log', 'charcoal', 0.15); smelt('birch_log', 'charcoal', 0.15); smelt('spruce_log', 'charcoal', 0.15); smelt('cherry_log', 'charcoal', 0.15);
smelt('porkchop', 'cooked_porkchop', 0.35); smelt('beef', 'cooked_beef', 0.35); smelt('mutton', 'cooked_mutton', 0.35); smelt('chicken', 'cooked_chicken', 0.35);
smelt('stone_bricks', 'cracked_stone_bricks'); smelt('cactus', 'green_concrete' in ITEM_KEY ? 'green_concrete' : 'lime_concrete');
smelt('carrot', 'baked_potato', 0.35);
smelt('sandstone', 'smooth_sandstone', 0.1);
smelt('netherrack', 'nether_brick', 0.1);
smelt('nether_quartz_ore', 'quartz', 0.2);
smelt('nether_gold_ore', 'gold_ingot', 1.0);
shaped('cut_sandstone', 4, ['##', '##'], { '#': 'sandstone' });
shaped('chiseled_sandstone', 1, ['#', '#'], { '#': 'sandstone_slab' });
shaped('sandstone_slab', 6, ['###'], { '#': 'sandstone' });
shaped('sandstone_stairs', 4, ['#  ', '## ', '###'], { '#': 'sandstone' });
shaped('spruce_slab', 6, ['###'], { '#': 'spruce_planks' });
shaped('oak_fence', 3, ['W#W', 'W#W'], { W: 'oak_planks', '#': 'stick' });
shaped('spruce_fence', 3, ['W#W', 'W#W'], { W: 'spruce_planks', '#': 'stick' });
shaped('cherry_fence', 3, ['W#W', 'W#W'], { W: 'cherry_planks', '#': 'stick' });
shaped('rail', 16, ['I I', 'I#I', 'I I'], { I: 'iron_ingot', '#': 'stick' });

function fuelValue(id) { const d = ITEMS[id]; return d ? (d.fuel || (BLOCKS[id] && BLOCKS[id].fuel) || 0) : 0; }

// Creative inventory ordering
const CREATIVE_TABS = [
  { name: '建筑方块', icon: 'bricks', items: ['stone', 'cobblestone', 'mossy_cobblestone', 'smooth_stone', 'stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks', 'andesite', 'polished_andesite', 'diorite', 'polished_diorite', 'granite', 'polished_granite', 'deepslate',
    'oak_planks', 'birch_planks', 'spruce_planks', 'dark_oak_planks', 'jungle_planks', 'acacia_planks', 'cherry_planks', 'oak_log', 'birch_log', 'spruce_log', 'cherry_log',
    'bricks', 'mud_bricks', 'nether_bricks', 'sandstone', 'chiseled_sandstone', 'cut_sandstone', 'smooth_sandstone', 'terracotta', 'orange_terracotta', 'blue_terracotta', 'quartz_block', 'prismarine', 'prismarine_bricks', 'sea_lantern', 'glowstone', 'obsidian', 'end_stone', 'end_stone_bricks', 'bone_block',
    'smooth_stone_slab', 'oak_slab', 'spruce_slab', 'birch_slab', 'cherry_slab', 'cobblestone_slab', 'stone_brick_slab', 'sandstone_slab', 'oak_stairs', 'spruce_stairs', 'cherry_stairs', 'cobblestone_stairs', 'stone_brick_stairs', 'brick_stairs', 'nether_brick_stairs', 'sandstone_stairs', 'oak_fence', 'spruce_fence', 'cherry_fence', 'nether_brick_fence', 'iron_bars',
    'glass', ...SGLASS.map(s => s[0] + '_stained_glass'), ...WOOLS.map(w => w[0] + '_wool'), ...CONCRETE.map(c => c[0] + '_concrete'),
    'iron_block', 'gold_block', 'diamond_block', 'emerald_block', 'lapis_block', 'redstone_block', 'coal_block', 'hay_block'] },
  { name: '自然方块', icon: 'grass_block', items: ['grass_block', 'dirt', 'dirt_path', 'farmland', 'sand', 'red_sand', 'gravel', 'clay', 'snow_block', 'snow', 'ice', 'packed_ice', 'moss_block', 'netherrack', 'soul_sand', 'magma_block',
    'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'redstone_ore', 'lapis_ore', 'emerald_ore', 'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_gold_ore', 'deepslate_diamond_ore', 'deepslate_redstone_ore', 'nether_quartz_ore', 'nether_gold_ore',
    'oak_leaves', 'birch_leaves', 'spruce_leaves', 'cherry_leaves', 'oak_sapling', 'birch_sapling', 'spruce_sapling', 'cherry_sapling', 'pink_petals', 'short_grass', 'fern', 'dead_bush', ...FLOWERS.map(f => f[0]),
    'red_mushroom', 'brown_mushroom', 'nether_wart', 'cactus', 'sugar_cane', 'pumpkin', 'melon', 'bedrock'] },
  { name: '功能方块', icon: 'crafting_table', items: ['crafting_table', 'furnace', 'chest', 'hopper', 'brewing_stand', 'red_bed', 'torch', 'jack_o_lantern', 'bookshelf', 'ladder', 'oak_door', 'cherry_door', 'oak_trapdoor', 'tnt', 'note_block',
    'redstone', 'redstone_torch', 'redstone_block', 'repeater', 'comparator', 'observer', 'piston', 'sticky_piston', 'lever', 'stone_button', 'oak_button', 'stone_pressure_plate', 'oak_pressure_plate', 'redstone_lamp', 'target', 'rail', 'enchanting_table', 'anvil', 'bell', 'cobweb', 'spawner', 'end_portal_frame', 'dragon_egg', 'end_crystal'] },
  { name: '工具与战斗', icon: 'diamond_pickaxe', items: [] },
  { name: '食物与材料', icon: 'apple', items: [] },
  { name: '刷怪蛋', icon: 'creeper_spawn_egg', items: ['pig_spawn_egg', 'cow_spawn_egg', 'sheep_spawn_egg', 'chicken_spawn_egg', 'zombie_spawn_egg', 'skeleton_spawn_egg', 'creeper_spawn_egg', 'spider_spawn_egg', 'villager_spawn_egg', 'blaze_spawn_egg', 'wither_skeleton_spawn_egg', 'ghast_spawn_egg', 'zombified_piglin_spawn_egg', 'enderman_spawn_egg'] },
];
for (const m of ['wooden', 'stone', 'iron', 'golden', 'diamond']) for (const t of ['pickaxe', 'axe', 'shovel', 'hoe', 'sword']) CREATIVE_TABS[3].items.push(m + '_' + t);
CREATIVE_TABS[3].items.push('shield', 'bow', 'arrow', 'shears', 'flint_and_steel', 'bucket', 'water_bucket', 'lava_bucket');
for (const m of ['leather', 'iron', 'diamond']) for (const p of ['helmet', 'chestplate', 'leggings', 'boots']) CREATIVE_TABS[3].items.push(m + '_' + p);
CREATIVE_TABS[3].items.push('potion_healing', 'potion_fire_resistance', 'potion_swiftness', 'potion_night_vision');
CREATIVE_TABS[4].items.push('apple', 'golden_apple', 'golden_carrot', 'bread', 'porkchop', 'cooked_porkchop', 'beef', 'cooked_beef', 'mutton', 'cooked_mutton', 'chicken', 'cooked_chicken', 'rotten_flesh', 'melon_slice', 'cookie', 'pumpkin_pie', 'baked_potato', 'carrot',
  'wheat_seeds', 'wheat', 'egg', 'sugar', 'stick', 'coal', 'charcoal', 'raw_iron', 'iron_ingot', 'raw_gold', 'gold_ingot', 'diamond', 'emerald', 'lapis_lazuli', 'redstone', 'flint', 'bone', 'bone_meal', 'string', 'feather', 'gunpowder', 'leather', 'snowball', 'clay_ball', 'brick', 'paper', 'book', 'enchanted_book',
  'quartz', 'gold_nugget', 'nether_brick', 'ghast_tear', 'ender_pearl', 'eye_of_ender', 'end_crystal', 'dragon_breath', 'fire_charge', 'glass_bottle', 'water_bottle', 'awkward_potion', 'blaze_rod', 'blaze_powder', 'nether_wart', 'glistering_melon_slice', 'magma_cream', 'potion_healing', 'potion_fire_resistance', 'potion_swiftness', 'potion_night_vision');