'use strict';
// ---------------------------------------------------------------------------
// Distant Horizons (DH-Web) QuadTree Multi-Level LOD Terrain System
// - 4-Level QuadTree (L0=1:1 32x32, L1=2:1 64x64, L2=4:1 128x128, L3=8:1 256x256)
// - 16-Byte Compact Vertex Layout (aligned with DistantHorizons-3.3.4 LodQuadBuilder)
// - Exact Pixel Perfection Legacy Texture & CHUNK_FS Colormap Tint Multiplication
// - Deterministic Chunk Tree Canopy (world.treesFor) & Surface Structure Stamping
// - Seamless Depth-Offset + Horizontal Cylinder Bayer 4x4 Ordered Dithering
// ---------------------------------------------------------------------------

const LOD_VSTRIDE = 16;   // 16 bytes per vertex (64 bytes per quad)
const LOD_SEC_SIZE = 32;  // 32x32 sample columns per section (+1 border halo -> 34x34)
const LOD_PAD_SIZE = 34;  // 32 + 2 halo border
const LOD_LEVELS = 4;     // L0 (scale 1), L1 (scale 2), L2 (scale 4), L3 (scale 8)

// Material type constants encoded in a_meta bits [4..7]
const LOD_MAT_GRASS = 0;
const LOD_MAT_STONE = 1;
const LOD_MAT_SAND = 2;
const LOD_MAT_SNOW = 3;
const LOD_MAT_LEAVES = 4;
const LOD_MAT_WATER = 5;
const LOD_MAT_CUSTOM = 6;

// Collision-free 50-bit safe integer key for (level, sx, sz)
function lodKey(level, sx, sz) {
  return ((level & 3) * 4294967296) + (((sx + 32768) & 0xFFFF) * 65536) + ((sz + 32768) & 0xFFFF);
}

// Exact Pixel Perfection Legacy base texture RGBA averages (dynamically refreshed from ASSETS.strip)
const LOD_BASE_TEX = {
  grassTop: [142, 131, 113],
  grassSideBase: [89, 94, 63],
  grassSideOverlay: [153, 142, 123, 106],
  grassSnowSide: [149, 142, 140],
  oakLeaves: [139, 129, 112],
  birchLeaves: [88, 80, 21],     // birch_leaves (176,122,63) * Mesher birch tint (128,167,85) / 255
  spruceLeaves: [32, 75, 37],    // spruce_leaves (85,125,97) * Mesher spruce tint (97,153,97) / 255
  cherryLeaves: [244, 175, 194],
  pinkPetals: [245, 181, 199],
  stone: [133, 121, 114],
  dirt: [111, 85, 72],
  sand: [221, 171, 127],
  sandstoneTop: [201, 154, 121],
  sandstoneSide: [196, 149, 118],
  orangeTerracotta: [166, 96, 67],
  blueTerracotta: [69, 91, 143],
  gravel: [126, 104, 87],
  clay: [142, 71, 55],
  snow: [218, 235, 246],
  ice: [157, 227, 248, 210],
  packedIce: [156, 221, 239],
  water: [36, 67, 129, 185],     // water_still (144,144,144,185) * Mesher water tint (63,118,228) / 255
  endStone: [153, 139, 106],
  obsidian: [25, 22, 25],
  cobblestone: [128, 114, 108],
  oakPlanks: [125, 94, 74],
  sprucePlanks: [89, 65, 49],
  dirtPathTop: [117, 90, 75],
  dirtPathSide: [114, 89, 63],
};

// Representative RGB table per block ID: 6 bytes per block [topR, topG, topB, sideR, sideG, sideB]
const BLOCK_LOD_COLORS = new Uint8Array((typeof MAX_BLOCK_ID !== 'undefined' ? MAX_BLOCK_ID : 1024) * 6);

function initDefaultBlockLodColors() {
  const setC = (id, tr, tg, tb, sr = tr, sg = tg, sb = tb) => {
    const o = id * 6;
    if (o + 5 >= BLOCK_LOD_COLORS.length) return;
    BLOCK_LOD_COLORS[o] = tr; BLOCK_LOD_COLORS[o + 1] = tg; BLOCK_LOD_COLORS[o + 2] = tb;
    BLOCK_LOD_COLORS[o + 3] = sr; BLOCK_LOD_COLORS[o + 4] = sg; BLOCK_LOD_COLORS[o + 5] = sb;
  };
  for (let i = 1; i < 1024; i++) setC(i, 133, 121, 114);
  setC(1, 133, 121, 114);                      // stone
  setC(2, 46, 79, 36, 72, 90, 53);             // grass_block
  setC(3, 111, 85, 72);                        // dirt
  setC(4, 128, 114, 108);                      // cobblestone
  setC(5, 125, 94, 74);                        // oak_planks
  setC(6, 49, 49, 49);                         // bedrock
  setC(7, 36, 67, 129);                        // water
  setC(8, 193, 58, 3);                         // lava
  setC(9, 221, 171, 127);                      // sand
  setC(10, 126, 104, 87);                      // gravel
  setC(11, 139, 119, 101);                     // gold_ore
  setC(12, 142, 127, 119);                     // iron_ore
  setC(13, 110, 99, 93);                       // coal_ore
  setC(14, 123, 93, 73, 96, 75, 64);           // oak_log
  setC(15, 45, 77, 36);                        // oak_leaves
  setC(16, 181, 200, 231);                     // glass
  setC(17, 201, 154, 121, 196, 149, 118);      // sandstone
  setC(18, 129, 129, 126);                     // diamond_ore
  setC(19, 113, 85, 56, 126, 99, 79);          // crafting_table
  setC(20, 132, 119, 112, 116, 103, 97);       // furnace
  setC(22, 140, 88, 76);                       // bricks
  setC(23, 124, 111, 105);                     // stone_bricks
  setC(24, 119, 111, 98);                      // mossy_cobblestone
  setC(25, 125, 94, 74, 89, 71, 59);           // bookshelf
  setC(26, 126, 55, 57, 178, 106, 98);         // tnt
  setC(27, 203, 154, 97);                      // glowstone
  setC(28, 25, 22, 25);                        // obsidian
  setC(29, 129, 126, 122);                     // iron_block
  setC(30, 194, 130, 49);                      // gold_block
  setC(31, 85, 160, 200);                      // diamond_block
  setC(32, 52, 45, 42);                        // coal_block
  setC(33, 218, 235, 246);                     // snow_block
  setC(34, 218, 235, 246);                     // snow layer
  setC(35, 157, 227, 248);                     // ice
  setC(36, 142, 71, 55);                       // clay
  setC(37, 77, 100, 50, 88, 110, 57);          // cactus
  setC(46, 160, 138, 118, 199, 188, 178);      // birch_log
  setC(47, 88, 80, 21);                        // birch_leaves
  setC(48, 145, 119, 97);                      // birch_planks
  setC(49, 95, 68, 50, 65, 48, 41);            // spruce_log
  setC(50, 32, 75, 37);                        // spruce_leaves
  setC(51, 89, 65, 49);                        // spruce_planks
  setC(52, 100, 79, 65, 90, 72, 61);           // chest
  setC(53, 172, 87, 41, 187, 101, 43);         // pumpkin
  setC(54, 172, 87, 41, 191, 104, 48);         // jack_o_lantern
  setC(55, 46, 83, 34, 55, 98, 37);            // melon
  setC(56, 127, 114, 107);                     // smooth_stone
  setC(57, 127, 114, 107, 125, 113, 107);      // smooth_stone_slab
  setC(58, 125, 94, 74);                       // oak_slab
  setC(59, 128, 114, 108);                     // cobblestone_slab
  setC(60, 125, 94, 74);                       // oak_stairs
  setC(61, 128, 114, 108);                     // cobblestone_stairs
  setC(62, 124, 111, 105);                     // stone_brick_stairs
  setC(63, 100, 77, 65, 111, 85, 72);          // farmland
  setC(72, 117, 101, 95);                      // andesite
  setC(73, 153, 150, 147);                     // diorite
  setC(74, 136, 93, 80);                       // granite
  setC(75, 74, 72, 71, 70, 68, 68);            // deepslate
  setC(83, 144, 104, 88);                      // terracotta
  setC(84, 163, 149, 143);                     // quartz_block
  setC(85, 133, 151, 147);                     // sea_lantern
  setC(86, 95, 150, 138);                      // prismarine
  setC(87, 162, 117, 78, 148, 106, 73);        // hay_block
  setC(88, 80, 100, 50);                       // moss_block
  setC(89, 119, 88, 65);                       // mud_bricks
  setC(90, 118, 103, 96);                      // polished_andesite
  setC(91, 152, 148, 145);                     // polished_diorite
  setC(92, 135, 93, 80);                       // polished_granite
  setC(93, 122, 109, 103);                     // cracked_stone_bricks
  setC(94, 107, 106, 85);                      // mossy_stone_bricks
  setC(95, 221, 202, 170, 227, 208, 175);      // bone_block
  setC(96, 156, 221, 239);                     // packed_ice
  setC(97, 224, 130, 86);                      // red_sand
  setC(103, 128, 55, 24);                      // magma_block
  setC(104, 66, 46, 31);                       // dark_oak_planks
  setC(105, 121, 81, 58);                      // jungle_planks
  setC(106, 169, 94, 70);                      // acacia_planks
  setC(107, 226, 150, 146);                    // cherry_planks
  setC(108, 27, 84, 162);                      // lapis_block
  setC(109, 33, 128, 84);                      // emerald_block
  setC(110, 148, 41, 39);                      // redstone_block
  setC(113, 124, 111, 105);                    // stone_brick_slab
  setC(114, 140, 88, 76);                      // brick_stairs
  setC(115, 89, 65, 49);                       // spruce_stairs
  setC(116, 145, 119, 97);                     // birch_slab
  setC(170, 201, 154, 121, 199, 153, 120);     // chiseled_sandstone
  setC(171, 201, 154, 121, 192, 146, 117);     // cut_sandstone
  setC(172, 202, 155, 121);                    // smooth_sandstone
  setC(173, 201, 154, 121, 196, 149, 118);     // sandstone_slab
  setC(174, 201, 154, 121, 196, 149, 118);     // sandstone_stairs
  setC(175, 166, 96, 67);                      // orange_terracotta
  setC(176, 69, 91, 143);                      // blue_terracotta
  setC(181, 117, 90, 75, 114, 89, 63);         // dirt_path
  setC(184, 89, 65, 49);                       // spruce_slab
  setC(512, 111, 167, 153);                    // prismarine_bricks
  setC(519, 191, 125, 115, 70, 47, 48);        // cherry_log
  setC(520, 244, 175, 194);                    // cherry_leaves
  setC(522, 245, 181, 199);                    // pink_petals
  setC(523, 226, 150, 146);                    // cherry_slab
  setC(524, 226, 150, 146);                    // cherry_stairs
  setC(529, 90, 27, 27);                       // netherrack
  setC(530, 92, 70, 49);                        // soul_sand
  setC(533, 52, 25, 29);                        // nether_bricks
  setC(535, 52, 25, 29);                        // nether_brick_stairs
  setC(540, 153, 139, 106);                    // end_stone
  setC(543, 155, 143, 108);                    // end_stone_bricks
}
initDefaultBlockLodColors();

// Scan decoded 16x16 texture strip on main thread to populate exact block & base texture colors
function buildBlockLodPalette(tileData) {
  if (!tileData || typeof BLOCKS === 'undefined') return BLOCK_LOD_COLORS;
  const avgLayer = (layer) => {
    if (layer === undefined || layer === null) return [133, 121, 114, 255];
    let r = 0, g = 0, b = 0, w = 0, aSum = 0;
    const base = layer * 256 * 4;
    for (let i = 0; i < 256; i++) {
      const a = tileData[base + i * 4 + 3];
      aSum += a;
      if (a < 32) continue;
      r += tileData[base + i * 4] * a;
      g += tileData[base + i * 4 + 1] * a;
      b += tileData[base + i * 4 + 2] * a;
      w += a;
    }
    if (!w) return [133, 121, 114, 255];
    return [Math.round(r / w), Math.round(g / w), Math.round(b / w), Math.round(aSum / 256)];
  };

  if (typeof ASSETS !== 'undefined' && ASSETS.tiles) {
    const T = ASSETS.tiles;
    const rgb3 = (name, fb) => (T[name] !== undefined ? avgLayer(T[name]).slice(0, 3) : fb);
    const rgba4 = (name, fb) => (T[name] !== undefined ? avgLayer(T[name]) : fb);
    LOD_BASE_TEX.grassTop = rgb3('grass_block_top', LOD_BASE_TEX.grassTop);
    LOD_BASE_TEX.grassSideBase = rgb3('grass_side_base', LOD_BASE_TEX.grassSideBase);
    LOD_BASE_TEX.grassSideOverlay = rgba4('grass_block_side_overlay', LOD_BASE_TEX.grassSideOverlay);
    LOD_BASE_TEX.grassSnowSide = rgb3('grass_block_snow', LOD_BASE_TEX.grassSnowSide);
    LOD_BASE_TEX.oakLeaves = rgb3('oak_leaves', LOD_BASE_TEX.oakLeaves);
    const bl = rgb3('birch_leaves', [176, 122, 63]);
    LOD_BASE_TEX.birchLeaves = [Math.round(bl[0] * 128 / 255), Math.round(bl[1] * 167 / 255), Math.round(bl[2] * 85 / 255)];
    const sl = rgb3('spruce_leaves', [85, 125, 97]);
    LOD_BASE_TEX.spruceLeaves = [Math.round(sl[0] * 97 / 255), Math.round(sl[1] * 153 / 255), Math.round(sl[2] * 97 / 255)];
    LOD_BASE_TEX.cherryLeaves = rgb3('cherry_leaves', LOD_BASE_TEX.cherryLeaves);
    LOD_BASE_TEX.pinkPetals = rgb3('pink_petals', LOD_BASE_TEX.pinkPetals);
    LOD_BASE_TEX.stone = rgb3('stone', LOD_BASE_TEX.stone);
    LOD_BASE_TEX.dirt = rgb3('dirt', LOD_BASE_TEX.dirt);
    LOD_BASE_TEX.sand = rgb3('sand', LOD_BASE_TEX.sand);
    LOD_BASE_TEX.sandstoneTop = rgb3('sandstone_top', LOD_BASE_TEX.sandstoneTop);
    LOD_BASE_TEX.sandstoneSide = rgb3('sandstone', LOD_BASE_TEX.sandstoneSide);
    LOD_BASE_TEX.orangeTerracotta = rgb3('orange_terracotta', LOD_BASE_TEX.orangeTerracotta);
    LOD_BASE_TEX.blueTerracotta = rgb3('blue_terracotta', LOD_BASE_TEX.blueTerracotta);
    LOD_BASE_TEX.gravel = rgb3('gravel', LOD_BASE_TEX.gravel);
    LOD_BASE_TEX.clay = rgb3('clay', LOD_BASE_TEX.clay);
    LOD_BASE_TEX.snow = rgb3('snow', LOD_BASE_TEX.snow);
    LOD_BASE_TEX.ice = rgba4('ice', LOD_BASE_TEX.ice);
    LOD_BASE_TEX.packedIce = rgb3('packed_ice', LOD_BASE_TEX.packedIce);
    const wt = rgba4('water_still', [144, 144, 144, 185]);
    LOD_BASE_TEX.water = [Math.round(wt[0] * 63 / 255), Math.round(wt[1] * 118 / 255), Math.round(wt[2] * 228 / 255), wt[3]];
    LOD_BASE_TEX.endStone = rgb3('end_stone', LOD_BASE_TEX.endStone);
    LOD_BASE_TEX.obsidian = rgb3('obsidian', LOD_BASE_TEX.obsidian);
    LOD_BASE_TEX.cobblestone = rgb3('cobblestone', LOD_BASE_TEX.cobblestone);
    LOD_BASE_TEX.oakPlanks = rgb3('oak_planks', LOD_BASE_TEX.oakPlanks);
    LOD_BASE_TEX.sprucePlanks = rgb3('spruce_planks', LOD_BASE_TEX.sprucePlanks);
    LOD_BASE_TEX.dirtPathTop = rgb3('dirt_path_top', LOD_BASE_TEX.dirtPathTop);
    LOD_BASE_TEX.dirtPathSide = rgb3('dirt_path_side', LOD_BASE_TEX.dirtPathSide);
  }

  for (let id = 1; id < BLOCKS.length; id++) {
    const blk = BLOCKS[id];
    if (!blk || !blk.tex) continue;
    let [tr, tg, tb] = avgLayer(blk.tex[3] || blk.tex[0] || 0);
    let [sr, sg, sb] = avgLayer(blk.tex[0] || 0);
    if (blk.tint === 'grass') {
      // Default temperate grassMap tint (82, 153, 81) multiplied by texture RGB (matching CHUNK_FS)
      tr = Math.min(255, Math.round(tr * 82 / 255));
      tg = Math.min(255, Math.round(tg * 153 / 255));
      tb = Math.min(255, Math.round(tb * 81 / 255));
      if (id === 2) {
        const ov = LOD_BASE_TEX.grassSideOverlay;
        const ovA = (ov[3] || 106) / 255;
        sr = Math.round(sr * (1 - ovA) + (ov[0] * 82 / 255) * ovA);
        sg = Math.round(sg * (1 - ovA) + (ov[1] * 153 / 255) * ovA);
        sb = Math.round(sb * (1 - ovA) + (ov[2] * 81 / 255) * ovA);
      } else {
        sr = tr; sg = tg; sb = tb;
      }
    } else if (blk.tint === 'foliage') {
      tr = Math.min(255, Math.round(tr * 82 / 255));
      tg = Math.min(255, Math.round(tg * 153 / 255));
      tb = Math.min(255, Math.round(tb * 81 / 255));
      sr = tr; sg = tg; sb = tb;
    } else if (blk.tint === 'birch') {
      tr = Math.min(255, Math.round(tr * 128 / 255));
      tg = Math.min(255, Math.round(tg * 167 / 255));
      tb = Math.min(255, Math.round(tb * 85 / 255));
      sr = tr; sg = tg; sb = tb;
    } else if (blk.tint === 'spruce') {
      tr = Math.min(255, Math.round(tr * 97 / 255));
      tg = Math.min(255, Math.round(tg * 153 / 255));
      tb = Math.min(255, Math.round(tb * 97 / 255));
      sr = tr; sg = tg; sb = tb;
    } else if (blk.tint === 'water') {
      tr = Math.min(255, Math.round(tr * 63 / 255));
      tg = Math.min(255, Math.round(tg * 118 / 255));
      tb = Math.min(255, Math.round(tb * 228 / 255));
      sr = tr; sg = tg; sb = tb;
    }
    const o = id * 6;
    BLOCK_LOD_COLORS[o] = tr; BLOCK_LOD_COLORS[o + 1] = tg; BLOCK_LOD_COLORS[o + 2] = tb;
    BLOCK_LOD_COLORS[o + 3] = sr; BLOCK_LOD_COLORS[o + 4] = sg; BLOCK_LOD_COLORS[o + 5] = sb;
  }
  return BLOCK_LOD_COLORS;
}

// ---------------------------------------------------------------------------
// 16-Byte Compact Vertex Buffer for Distant Horizons Sections
// Layout:
//   0..5:   Int16 x 3 (lx, ly, lz)
//   6..7:   Uint16 meta ([0..3] dir, [4..7] mat, [8..13] microOffset)
//   8..11:  Uint8 x 4 (r, g, b, a)
//   12..15: Uint8 x 4 (sky, blk, valleyAO, noiseWeight)
// ---------------------------------------------------------------------------
class LodMeshBuffer {
  constructor(cap = 4096) {
    this.n = 0;
    this.alloc(cap);
  }
  alloc(cap) {
    this.cap = cap;
    const buf = new ArrayBuffer(cap * LOD_VSTRIDE);
    if (this.u8) new Uint8Array(buf).set(this.u8.subarray(0, this.n * LOD_VSTRIDE));
    this.buf = buf;
    this.i16 = new Int16Array(buf);
    this.u16 = new Uint16Array(buf);
    this.u8 = new Uint8Array(buf);
  }
  reset() {
    this.n = 0;
  }
  v(lx, ly, lz, meta, r, g, b, a, sky, blk, ao, nw) {
    if (this.n >= this.cap) this.alloc(this.cap * 2);
    const o16 = this.n * 8;
    const o8 = this.n * 16;
    const i16 = this.i16;
    i16[o16] = lx;
    i16[o16 + 1] = ly;
    i16[o16 + 2] = lz;
    this.u16[o16 + 3] = meta;
    const u8 = this.u8;
    u8[o8 + 8] = r;
    u8[o8 + 9] = g;
    u8[o8 + 10] = b;
    u8[o8 + 11] = a;
    u8[o8 + 12] = sky;
    u8[o8 + 13] = blk;
    u8[o8 + 14] = ao;
    u8[o8 + 15] = nw;
    this.n++;
  }
  slice() {
    const out = new Uint8Array(this.n * LOD_VSTRIDE);
    out.set(this.u8.subarray(0, this.n * LOD_VSTRIDE));
    return out;
  }
}

// ---------------------------------------------------------------------------
// Analytic 2D Column, Tree Canopy & Structure Sampler
// Samples a 34x34 grid (32x32 interior + 1-column halo on all 4 sides)
// ---------------------------------------------------------------------------
const LodColumnSampler = {
  yTop: new Int16Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  yBot: new Int16Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  waterY: new Int16Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  waterType: new Uint8Array(LOD_PAD_SIZE * LOD_PAD_SIZE), // 0=none, 1=water, 2=translucent ice
  colR: new Uint8Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  colG: new Uint8Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  colB: new Uint8Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  sideR: new Uint8Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  sideG: new Uint8Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  sideB: new Uint8Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  mat: new Uint8Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  blkLight: new Uint8Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  rawH: new Int16Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  tempArr: new Float32Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  humidArr: new Float32Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  biomeArr: new Uint8Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  folR: new Uint8Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  folG: new Uint8Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  folB: new Uint8Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  structMask: new Uint8Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  treeTop: new Int16Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  treeBot: new Int16Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  treeR: new Uint8Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  treeG: new Uint8Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  treeB: new Uint8Array(LOD_PAD_SIZE * LOD_PAD_SIZE),
  gCont: new Float32Array(100),
  gEro: new Float32Array(100),
  gTemp: new Float32Array(100),
  gHumid: new Float32Array(100),
  _rgbTmp: new Uint8Array(3),

  // Extract a compact 256-entry Uint32Array surface summary from a modified Chunk
  // Bits: [20..31] topBlockId (12b), [12..19] yTop (8b), [4..11] waterY (8b), [0..3] blkLight (4b)
  summarizeChunk(ch) {
    if (!ch || !ch.blocks) return null;
    const summary = new Uint32Array(256);
    const blocks = ch.blocks;
    const light = ch.light;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        let topId = 0, topY = 0, wY = 0, bLight = 0, sawSnow = false;
        for (let y = HEIGHT - 1; y >= 0; y--) {
          const idx = (y << 8) | (z << 4) | x;
          const id = blocks[idx];
          if (!id) continue;
          if (id === 34) {
            sawSnow = true;
            if (light) {
              const bl = light[idx] & 15;
              if (bl > bLight) bLight = bl;
            }
            continue;
          }
          if (id === 7 || id === 35) {
            if (!wY) {
              wY = y + 1;
              if (light) {
                const blW = (y + 1 < HEIGHT ? light[((y + 1) << 8) | (z << 4) | x] : light[idx]) & 15;
                if (blW > bLight) bLight = blW;
              }
            }
            continue;
          }
          const e = typeof EMIT !== 'undefined' ? EMIT[id] : 0;
          if (e > bLight) bLight = e;
          if (light) {
            const blHere = light[idx] & 15;
            if (blHere > bLight) bLight = blHere;
          }
          const b = typeof BLOCKS !== 'undefined' ? BLOCKS[id] : null;
          if (b && (b.shape === 1 || b.shape === 4 || b.shape === 5 || b.shape === 6 || b.shape === 9 || id === 522)) {
            continue;
          }
          if (light && y + 1 < HEIGHT) {
            const blAbove = light[((y + 1) << 8) | (z << 4) | x] & 15;
            if (blAbove > bLight) bLight = blAbove;
          }
          if (sawSnow) {
            topId = id === 1 ? 1022 : (id === 33 ? 33 : 34);
          } else {
            topId = id;
          }
          topY = y + 1;
          break;
        }
        summary[(z << 4) | x] = ((topId & 0xFFF) << 20) | ((topY & 0xFF) << 12) | ((wY & 0xFF) << 4) | (bLight & 0xF);
      }
    }
    return summary;
  },

  sampleSection(world, level, sx, sz, modSummaries) {
    const scale = 1 << level;
    const span = LOD_SEC_SIZE * scale;
    const originX = sx * span;
    const originZ = sz * span;
    const dim = world.dimension || 'overworld';
    this.treeTop.fill(0);
    this.treeBot.fill(0);

    if (dim === 'end') {
      this._sampleEnd(world, originX, originZ, scale, modSummaries);
      return;
    }
    this._sampleOverworld(world, level, originX, originZ, scale, modSummaries);
  },

  _sampleOverworld(world, level, originX, originZ, scale, modSummaries) {
    const yTop = this.yTop, yBot = this.yBot, waterY = this.waterY, waterType = this.waterType;
    const colR = this.colR, colG = this.colG, colB = this.colB;
    const sideR = this.sideR, sideG = this.sideG, sideB = this.sideB;
    const mat = this.mat, blkLight = this.blkLight;
    const rawH = this.rawH, tempArr = this.tempArr, humidArr = this.humidArr, biomeArr = this.biomeArr;
    const folR = this.folR, folG = this.folG, folB = this.folB;
    const structMask = this.structMask;
    const rgb = this._rgbTmp;
    const bt = LOD_BASE_TEX;
    const seed = world.seed || 0;
    const halfStep = scale >> 1;

    structMask.fill(0);

    if (world.flat) {
      let gr = 46, gg = 79, gb = 36;
      let gsr = 72, gsg = 90, gsb = 53;
      if (world.grassMap) {
        world.tintFor(world.grassMap, 0.3, 0.2, rgb, 0);
        gr = Math.round(rgb[0] * bt.grassTop[0] / 255);
        gg = Math.round(rgb[1] * bt.grassTop[1] / 255);
        gb = Math.round(rgb[2] * bt.grassTop[2] / 255);
        const ovA = (bt.grassSideOverlay[3] || 106) / 255;
        gsr = Math.round(bt.grassSideBase[0] * (1 - ovA) + (bt.grassSideOverlay[0] * rgb[0] / 255) * ovA);
        gsg = Math.round(bt.grassSideBase[1] * (1 - ovA) + (bt.grassSideOverlay[1] * rgb[1] / 255) * ovA);
        gsb = Math.round(bt.grassSideBase[2] * (1 - ovA) + (bt.grassSideOverlay[2] * rgb[2] / 255) * ovA);
      }
      for (let i = 0; i < LOD_PAD_SIZE * LOD_PAD_SIZE; i++) {
        yTop[i] = 61; yBot[i] = 58; waterY[i] = 0; waterType[i] = 0;
        colR[i] = gr; colG[i] = gg; colB[i] = gb;
        sideR[i] = gsr; sideG[i] = gsg; sideB[i] = gsb;
        mat[i] = LOD_MAT_GRASS; blkLight[i] = 0;
      }
      if (modSummaries && modSummaries.size) {
        this._applyModSummaries(world, originX, originZ, scale, modSummaries);
      }
      return;
    }

    // 1. Pass 1: Evaluate world.column(wx, wz) & world.biomeOf(c) directly at all LOD levels (L0..L3)
    // so every sample column has 100% exact terrain height, temperature, humidity, and biome with zero grid-interpolation artifacts.
    const nSurf = world.nSurf;
    for (let iz = 0; iz < LOD_PAD_SIZE; iz++) {
      const wz = originZ + (iz - 1) * scale + halfStep;
      const rowOff = iz * LOD_PAD_SIZE;
      for (let ix = 0; ix < LOD_PAD_SIZE; ix++) {
        const wx = originX + (ix - 1) * scale + halfStep;
        const c = world.column(wx, wz);
        const idx = rowOff + ix;
        rawH[idx] = c.h;
        tempArr[idx] = c.temp;
        humidArr[idx] = c.humid;
        biomeArr[idx] = world.biomeOf(c);
      }
    }

    // 2. Pass 2: Compute slope, mountain peak preservation, and exact Pixel Perfection Legacy surface colors
    const ovA = (bt.grassSideOverlay[3] || 106) / 255;
    for (let iz = 0; iz < LOD_PAD_SIZE; iz++) {
      const wz = originZ + (iz - 1) * scale + halfStep;
      const iz0 = Math.max(0, iz - 1), iz1 = Math.min(LOD_PAD_SIZE - 1, iz + 1);
      for (let ix = 0; ix < LOD_PAD_SIZE; ix++) {
        const wx = originX + (ix - 1) * scale + halfStep;
        const ix0 = Math.max(0, ix - 1), ix1 = Math.min(LOD_PAD_SIZE - 1, ix + 1);
        const idx = iz * LOD_PAD_SIZE + ix;

        const h = rawH[idx];
        const bi = biomeArr[idx];
        const temp = tempArr[idx];
        const humid = humidArr[idx];

        const hL = rawH[iz * LOD_PAD_SIZE + ix0];
        const hR = rawH[iz * LOD_PAD_SIZE + ix1];
        const hD = rawH[iz0 * LOD_PAD_SIZE + ix];
        const hU = rawH[iz1 * LOD_PAD_SIZE + ix];

        const minNb = Math.min(hL, hR, hD, hU, h);
        // Exact 2-block-span slope matching world.js line 584: max(|h(wx-1,wz)-h(wx+1,wz)|, |h(wx,wz-1)-h(wx,wz+1)|)
        let slope;
        if (scale === 1 && ix > 0 && ix < LOD_PAD_SIZE - 1 && iz > 0 && iz < LOD_PAD_SIZE - 1) {
          slope = Math.max(Math.abs(hR - hL), Math.abs(hU - hD));
        } else if (bi === BI.DESERT || bi === BI.BEACH || bi === BI.OCEAN || bi === BI.FROZEN_OCEAN || bi === BI.RIVER) {
          slope = 0;
        } else {
          const hxm = world.column(wx - 1, wz).h, hxp = world.column(wx + 1, wz).h;
          const hzm = world.column(wx, wz - 1).h, hzp = world.column(wx, wz + 1).h;
          slope = Math.max(Math.abs(hxp - hxm), Math.abs(hzp - hzm));
        }

        let topY = h + 1;
        let botY = Math.max(1, minNb - scale * 2);
        let wY = 0;
        let wType = 0;
        let mType = LOD_MAT_GRASS;

        // Sample grass & foliage colormap tint and multiply by base texture RGB (exact CHUNK_FS formula)
        let grCmap = 82, ggCmap = 153, gbCmap = 81;
        let frCmap = 82, fgCmap = 153, fbCmap = 81;
        if (world.grassMap) {
          if (bi === BI.CHERRY_GROVE) world.tintFor(world.grassMap, 0.45, 0.65, rgb, 0);
          else world.tintFor(world.grassMap, temp, humid, rgb, 0);
          grCmap = rgb[0]; ggCmap = rgb[1]; gbCmap = rgb[2];
        } else if (bi === BI.CHERRY_GROVE) {
          grCmap = 120; ggCmap = 191; gbCmap = 96;
        }
        if (world.foliageMap) {
          if (bi === BI.CHERRY_GROVE) world.tintFor(world.foliageMap, 0.45, 0.65, rgb, 0);
          else world.tintFor(world.foliageMap, temp, humid, rgb, 0);
          frCmap = rgb[0]; fgCmap = rgb[1]; fbCmap = rgb[2];
        }

        const gr = Math.round(grCmap * bt.grassTop[0] / 255);
        const gg = Math.round(ggCmap * bt.grassTop[1] / 255);
        const gb = Math.round(gbCmap * bt.grassTop[2] / 255);
        const gsr = Math.round(bt.grassSideBase[0] * (1 - ovA) + (bt.grassSideOverlay[0] * grCmap / 255) * ovA);
        const gsg = Math.round(bt.grassSideBase[1] * (1 - ovA) + (bt.grassSideOverlay[1] * ggCmap / 255) * ovA);
        const gsb = Math.round(bt.grassSideBase[2] * (1 - ovA) + (bt.grassSideOverlay[2] * gbCmap / 255) * ovA);

        const fr = Math.round(frCmap * bt.oakLeaves[0] / 255);
        const fg = Math.round(frCmap ? (fgCmap * bt.oakLeaves[1] / 255) : 77);
        const fb = Math.round(fbCmap * bt.oakLeaves[2] / 255);
        folR[idx] = fr; folG[idx] = fg; folB[idx] = fb;

        let tr = gr, tg = gg, tb = gb;
        let sr = gsr, sg = gsg, sb = gsb;

        // Match world.js lines 587-629 surface, seabed, and snow cover rules 1-for-1
        const isSteepStone = ((bi === BI.MOUNTAIN || bi === BI.SNOWPEAK) && slope > 3) || slope > 5;
        if (h < SEA) {
          if (bi === BI.DESERT || bi === BI.BEACH) {
            tr = bt.sand[0]; tg = bt.sand[1]; tb = bt.sand[2];
            sr = tr; sg = tg; sb = tb;
            mType = LOD_MAT_SAND;
          } else if (bi === BI.OCEAN || bi === BI.FROZEN_OCEAN || bi === BI.RIVER) {
            if (h < SEA - 1 && nSurf) {
              const ns = nSurf.n2(wx / 12, wz / 12);
              if (ns > 0.35) {
                tr = bt.gravel[0]; tg = bt.gravel[1]; tb = bt.gravel[2];
              } else if (ns < -0.5) {
                tr = bt.clay[0]; tg = bt.clay[1]; tb = bt.clay[2];
              } else {
                tr = bt.sand[0]; tg = bt.sand[1]; tb = bt.sand[2];
              }
            } else {
              tr = bt.sand[0]; tg = bt.sand[1]; tb = bt.sand[2];
            }
            sr = tr; sg = tg; sb = tb;
            mType = LOD_MAT_SAND;
          } else if (isSteepStone) {
            tr = bt.stone[0]; tg = bt.stone[1]; tb = bt.stone[2];
            sr = tr; sg = tg; sb = tb;
            mType = LOD_MAT_STONE;
          } else {
            tr = gr; tg = gg; tb = gb;
            sr = gsr; sg = gsg; sb = gsb;
            mType = LOD_MAT_GRASS;
          }
          wY = SEA + 1;
          wType = (bi === BI.FROZEN_OCEAN || (bi === BI.SNOWY && temp < -0.5)) ? 2 : 1;
        } else if (bi === BI.DESERT || bi === BI.BEACH || ((bi === BI.OCEAN || bi === BI.FROZEN_OCEAN || bi === BI.RIVER) && h >= SEA)) {
          tr = bt.sand[0]; tg = bt.sand[1]; tb = bt.sand[2];
          sr = bt.sand[0]; sg = bt.sand[1]; sb = bt.sand[2];
          mType = LOD_MAT_SAND;
        } else if (bi === BI.SNOWY || bi === BI.SNOWPEAK || (bi === BI.MOUNTAIN && h > 125)) {
          // In world.js lines 625-629, every column here with h >= SEA receives snow on top (either B[h]=33 snow_block or B[h+1]=34 snow layer, even when B[h]=1 stone on steep slopes!)
          tr = bt.snow[0]; tg = bt.snow[1]; tb = bt.snow[2];
          if ((bi === BI.MOUNTAIN || bi === BI.SNOWPEAK) && h > 135 + hash3(wx, 1, wz, seed) * 6) {
            // B[h] = 33 (snow_block): both top and side faces are pure snow
            sr = bt.snow[0]; sg = bt.snow[1]; sb = bt.snow[2];
          } else if (isSteepStone) {
            // B[h] = 1 (stone) with B[h + 1] = 34 (snow layer) on top: top is white snow, vertical step riser is stone
            sr = bt.stone[0]; sg = bt.stone[1]; sb = bt.stone[2];
          } else {
            // B[h] = 2 (grass_block with M=1 snowy side) and B[h + 1] = 34 (snow layer) on top
            sr = bt.grassSnowSide[0]; sg = bt.grassSnowSide[1]; sb = bt.grassSnowSide[2];
          }
          mType = LOD_MAT_SNOW;
        } else if (isSteepStone) {
          tr = bt.stone[0]; tg = bt.stone[1]; tb = bt.stone[2];
          sr = bt.stone[0]; sg = bt.stone[1]; sb = bt.stone[2];
          mType = LOD_MAT_STONE;
        } else {
          tr = gr; tg = gg; tb = gb;
          sr = gsr; sg = gsg; sb = gsb;
          mType = LOD_MAT_GRASS;
        }

        yTop[idx] = topY;
        yBot[idx] = botY;
        waterY[idx] = wY;
        waterType[idx] = wType;
        colR[idx] = tr; colG[idx] = tg; colB[idx] = tb;
        sideR[idx] = sr; sideG[idx] = sg; sideB[idx] = sb;
        mat[idx] = mType;
        blkLight[idx] = 0;
      }
    }

    // 3. For L0, L1, and L2 (1:1, 2:1, and 4:1 scales), stamp deterministic Surface Structures & exact Chunk Trees
    if (level <= 2) {
      this._stampStructures(world, originX, originZ, scale);
      this._stampExactTrees(world, originX, originZ, scale);
    }

    // 4. Apply player modified-chunk height & block overrides if present
    if (modSummaries && modSummaries.size) {
      this._applyModSummaries(world, originX, originZ, scale, modSummaries);
    }
  },

  // Stamp deterministic Desert Pyramids & Villages at L0..L2 and populate exact chunk-level hasSurfaceStructure mask
  _stampStructures(world, originX, originZ, scale) {
    if (typeof Structures === 'undefined') return;
    const bt = LOD_BASE_TEX;
    const yTop = this.yTop, yBot = this.yBot, waterY = this.waterY, waterType = this.waterType;
    const colR = this.colR, colG = this.colG, colB = this.colB;
    const sideR = this.sideR, sideG = this.sideG, sideB = this.sideB;
    const mat = this.mat, rawH = this.rawH, structMask = this.structMask;
    const halfStep = scale >> 1;

    const minWX = originX - scale;
    const maxWX = originX + (LOD_PAD_SIZE - 1) * scale;
    const minWZ = originZ - scale;
    const maxWZ = originZ + (LOD_PAD_SIZE - 1) * scale;
    const cx0 = minWX >> 4, cx1 = maxWX >> 4;
    const cz0 = minWZ >> 4, cz1 = maxWZ >> 4;

    const setBlockColor = (idx, blockId) => {
      const o = blockId * 6;
      colR[idx] = BLOCK_LOD_COLORS[o] || 133;
      colG[idx] = BLOCK_LOD_COLORS[o + 1] || 121;
      colB[idx] = BLOCK_LOD_COLORS[o + 2] || 114;
      sideR[idx] = BLOCK_LOD_COLORS[o + 3] || colR[idx];
      sideG[idx] = BLOCK_LOD_COLORS[o + 4] || colG[idx];
      sideB[idx] = BLOCK_LOD_COLORS[o + 5] || colB[idx];
      mat[idx] = LOD_MAT_CUSTOM;
    };

    // 1. Desert Pyramids (regions overlapping cx0-2..cx1+2, cz0-2..cz1+2)
    if (typeof Structures.pyramidInRegion === 'function') {
      const prx0 = Math.floor((cx0 - 2) / 18), prx1 = Math.floor((cx1 + 2) / 18);
      const prz0 = Math.floor((cz0 - 2) / 18), prz1 = Math.floor((cz1 + 2) / 18);
      for (let rz = prz0; rz <= prz1; rz++) {
        for (let rx = prx0; rx <= prx1; rx++) {
          const p = Structures.pyramidInRegion(world, rx, rz);
          if (!p) continue;
          // Any chunk [x0..x0+15, z0..z0+15] overlapping [p.wx-11..p.wx+11, p.wz-11..p.wz+11] has hasSurfaceStructure = true
          if (cx1 * 16 + 15 < p.wx - 11 || cx0 * 16 > p.wx + 11 || cz1 * 16 + 15 < p.wz - 11 || cz0 * 16 > p.wz + 11) continue;
          for (let iz = 0; iz < LOD_PAD_SIZE; iz++) {
            const wz = originZ + (iz - 1) * scale + halfStep;
            const ccz0 = (wz >> 4) * 16;
            if (ccz0 + 15 < p.wz - 11 || ccz0 > p.wz + 11) continue;
            const dz = wz - p.wz;
            for (let ix = 0; ix < LOD_PAD_SIZE; ix++) {
              const wx = originX + (ix - 1) * scale + halfStep;
              const ccx0 = (wx >> 4) * 16;
              if (ccx0 + 15 < p.wx - 11 || ccx0 > p.wx + 11) continue;
              const idx = iz * LOD_PAD_SIZE + ix;
              structMask[idx] = 1; // Exact chunk-level hasSurfaceStructure = true tree suppression!
              for (let lIdx = 0; lIdx < lamps.length; lIdx++) {
                const lDist = Math.abs(wx - lamps[lIdx][0]) + Math.abs(wz - lamps[lIdx][1]);
                if (lDist <= 11) {
                  const lv = 12 - lDist;
                  if (lv > this.blkLight[idx]) this.blkLight[idx] = lv;
                }
              }
              const dx = wx - p.wx;
              if (dx < -10 || dx > 10 || dz < -10 || dz > 10) continue;
              const ax = Math.abs(dx), az = Math.abs(dz);
              const rMax = Math.max(ax, az);
              let pyTop = p.y0 + 1 + Math.max(0, 11 - rMax);
              let isOrange = false;
              if (dz >= 6 && dz <= 10 && ((dx >= -10 && dx <= -6) || (dx >= 6 && dx <= 10))) {
                pyTop = p.y0 + 13;
                const tx0 = dx < 0 ? -8 : 8;
                if (dz === 10 && Math.abs(dx - tx0) <= 1) isOrange = true;
              } else if (dz >= 7 && dz <= 10 && ax <= 2) {
                pyTop = Math.max(pyTop, p.y0 + 6);
              }
              yTop[idx] = pyTop;
              yBot[idx] = Math.min(yBot[idx], p.y0);
              waterY[idx] = 0;
              waterType[idx] = 0;
              if (isOrange) {
                colR[idx] = bt.orangeTerracotta[0]; colG[idx] = bt.orangeTerracotta[1]; colB[idx] = bt.orangeTerracotta[2];
                sideR[idx] = bt.orangeTerracotta[0]; sideG[idx] = bt.orangeTerracotta[1]; sideB[idx] = bt.orangeTerracotta[2];
              } else {
                colR[idx] = bt.sandstoneTop[0]; colG[idx] = bt.sandstoneTop[1]; colB[idx] = bt.sandstoneTop[2];
                sideR[idx] = bt.sandstoneSide[0]; sideG[idx] = bt.sandstoneSide[1]; sideB[idx] = bt.sandstoneSide[2];
              }
              mat[idx] = LOD_MAT_CUSTOM;
            }
          }
        }
      }
    }

    // 2. Villages (regions overlapping cx0-3..cx1+3, cz0-3..cz1+3)
    if (typeof Structures.villageInRegion === 'function') {
      const vrx0 = Math.floor((cx0 - 7) / 16), vrx1 = Math.floor((cx1 + 7) / 16);
      const vrz0 = Math.floor((cz0 - 7) / 16), vrz1 = Math.floor((cz1 + 7) / 16);
      for (let rz = vrz0; rz <= vrz1; rz++) {
        for (let rx = vrx0; rx <= vrx1; rx++) {
          const v = Structures.villageInRegion(world, rx, rz);
          if (!v) continue;
          // Any chunk [x0..x0+15, z0..z0+15] overlapping [v.wx-38..v.wx+38, v.wz-38..v.wz+38] has hasSurfaceStructure = true
          if (cx1 * 16 + 15 < v.wx - 38 || cx0 * 16 > v.wx + 38 || cz1 * 16 + 15 < v.wz - 38 || cz0 * 16 > v.wz + 38) continue;
          const P = typeof Structures.villagePalette === 'function'
            ? Structures.villagePalette(v.style)
            : { log: 14, planks: 5, cobble: 4, roofStair: 60, roofSlab: 58, path: 181, bridge: 5, accent: 87, flatRoof: false };
          const vx = v.wx, vy = v.wy, vz = v.wz;
          const roads = v.roads || [];
          const buildings = v.buildings || [];
          const lamps = [
            [vx - 4, vz + 3], [vx + 3, vz + 3], [vx - 4, vz - 4],
            [vx - 14, vz - 2], [vx + 14, vz - 2], [vx - 2, vz - 14], [vx - 2, vz + 14]
          ];

          for (let iz = 0; iz < LOD_PAD_SIZE; iz++) {
            const wz = originZ + (iz - 1) * scale + halfStep;
            const ccz0 = (wz >> 4) * 16;
            if (ccz0 + 15 < vz - 38 || ccz0 > vz + 38) continue;
            for (let ix = 0; ix < LOD_PAD_SIZE; ix++) {
              const wx = originX + (ix - 1) * scale + halfStep;
              const ccx0 = (wx >> 4) * 16;
              if (ccx0 + 15 < vx - 38 || ccx0 > vx + 38) continue;
              const idx = iz * LOD_PAD_SIZE + ix;
              structMask[idx] = 1; // Exact chunk-level hasSurfaceStructure = true tree suppression!
              for (let lIdx = 0; lIdx < lamps.length; lIdx++) {
                const lDist = Math.abs(wx - lamps[lIdx][0]) + Math.abs(wz - lamps[lIdx][1]);
                if (lDist <= 11) {
                  const lv = 12 - lDist;
                  if (lv > this.blkLight[idx]) this.blkLight[idx] = lv;
                }
              }

              // A. Roads & Bridges over water
              for (let r = 0; r < roads.length; r++) {
                const rd = roads[r];
                if (wx >= rd.x0 && wx <= rd.x1 && wz >= rd.z0 && wz <= rd.z1) {
                  if (rawH[idx] < SEA) {
                    yTop[idx] = SEA + 1;
                    yBot[idx] = Math.min(yBot[idx], SEA);
                    waterY[idx] = 0;
                    waterType[idx] = 0;
                    setBlockColor(idx, P.bridge);
                  } else {
                    yTop[idx] = rawH[idx] + 1;
                    setBlockColor(idx, P.path);
                  }
                  break;
                }
              }

              // B. Central Well & Plaza (vx-4..vx+3, vz-4..vz+3)
              const dxW = wx - vx, dzW = wz - vz;
              if (dxW >= -4 && dxW <= 3 && dzW >= -4 && dzW <= 3) {
                yBot[idx] = Math.min(yBot[idx], vy);
                waterY[idx] = 0;
                waterType[idx] = 0;
                if (dxW >= -2 && dxW <= 1 && dzW >= -2 && dzW <= 1) {
                  yTop[idx] = vy + 5;
                  setBlockColor(idx, (dxW >= -1 && dxW <= 0 && dzW >= -1 && dzW <= 0) ? P.planks : P.roofSlab);
                } else {
                  yTop[idx] = vy + 1;
                  setBlockColor(idx, v.style === 'desert' ? P.path : 10);
                }
              }

              // C. Village Buildings
              for (let bIdx = 0; bIdx < buildings.length; bIdx++) {
                const b = buildings[bIdx];
                const kind = b.kind, bx = b.x, by = b.y, bz = b.z;
                let W = 5, D = 5, H = 4, hasGable = !P.flatRoof;
                if (kind === 'house_small') { W = 5; D = 5; H = 4; }
                else if (kind === 'house_med') { W = 7; D = 6; H = 4; }
                else if (kind === 'library') { W = 8; D = 6; H = 5; }
                else if (kind === 'smithy') { W = 9; D = 6; H = 4; hasGable = false; }
                else if (kind === 'temple') { W = 6; D = 6; H = 9; hasGable = false; }
                else if (kind === 'farm') { W = 9; D = 7; H = 1; hasGable = false; }
                else if (kind === 'hay_pen') { W = 7; D = 6; H = 1; hasGable = false; }

                const pad = hasGable ? 1 : 0;
                const lx = wx - bx, lz = wz - bz;
                if (lx < -pad || lx >= W + pad || lz < -pad || lz >= D + pad) continue;

                yBot[idx] = Math.min(yBot[idx], by);
                waterY[idx] = 0;
                waterType[idx] = 0;

                if (kind === 'farm') {
                  yTop[idx] = by + 1;
                  const border = lx === 0 || lx === W - 1 || lz === 0 || lz === D - 1;
                  if (border) setBlockColor(idx, P.log);
                  else if (lz === 3) {
                    yTop[idx] = by;
                    waterY[idx] = by + 1;
                    waterType[idx] = 1;
                    setBlockColor(idx, 3);
                  } else {
                    setBlockColor(idx, 87); // golden wheat / farmland tone
                  }
                } else if (kind === 'hay_pen') {
                  if (lx >= 4 && lx <= 5 && lz >= 1 && lz <= 2) {
                    yTop[idx] = by + (lx === 5 && lz === 1 ? 3 : 2);
                    setBlockColor(idx, P.accent);
                  } else {
                    const edge = lx === 0 || lx === W - 1 || lz === 0 || lz === D - 1;
                    yTop[idx] = by + (edge ? 2 : 1);
                    setBlockColor(idx, edge ? P.planks : (v.style === 'desert' ? 9 : 2));
                  }
                } else if (kind === 'temple') {
                  yTop[idx] = by + H + 1;
                  setBlockColor(idx, P.cobble);
                } else if (kind === 'smithy') {
                  yTop[idx] = by + H + 1;
                  const edge = lx === 0 || lx === W - 1 || lz === 0 || lz === D - 1;
                  setBlockColor(idx, edge ? 57 : P.planks);
                  const corner = (lx === 4 || lx === W - 1) && (lz === 0 || lz === D - 1);
                  const wallO = (corner ? P.log : (lx < 4 ? 23 : P.planks)) * 6;
                  sideR[idx] = BLOCK_LOD_COLORS[wallO + 3] || 125;
                  sideG[idx] = BLOCK_LOD_COLORS[wallO + 4] || 94;
                  sideB[idx] = BLOCK_LOD_COLORS[wallO + 5] || 74;
                } else if (hasGable) {
                  const dist = Math.max(0, Math.floor(Math.min(lz + 1, D - lz)));
                  yTop[idx] = by + H + dist + 1;
                  setBlockColor(idx, P.roofStair);
                  if (lx >= 0 && lx < W && lz >= 0 && lz < D) {
                    const corner = (lx === 0 || lx === W - 1) && (lz === 0 || lz === D - 1);
                    const wallO = (corner ? P.log : P.planks) * 6;
                    sideR[idx] = BLOCK_LOD_COLORS[wallO + 3] || sideR[idx];
                    sideG[idx] = BLOCK_LOD_COLORS[wallO + 4] || sideG[idx];
                    sideB[idx] = BLOCK_LOD_COLORS[wallO + 5] || sideB[idx];
                  }
                } else {
                  yTop[idx] = by + H + 1;
                  setBlockColor(idx, P.planks);
                }
                break;
              }
            }
          }
        }
      }
    }
  },

  // Deterministic chunk tree canopy stamper using world.treesFor(cx, cz) across L0, L1, and L2.
  // Stamps into separate treeTop/treeBot/treeR/treeG/treeB layers so the terrain ground yTop underneath trees remains 100% continuous!
  _stampExactTrees(world, originX, originZ, scale) {
    if (typeof world.treesFor !== 'function') return;
    const bt = LOD_BASE_TEX;
    const yTop = this.yTop;
    const folR = this.folR, folG = this.folG, folB = this.folB;
    const structMask = this.structMask;
    const treeTop = this.treeTop, treeBot = this.treeBot;
    const treeR = this.treeR, treeG = this.treeG, treeB = this.treeB;

    const minWX = originX - scale;
    const maxWX = originX + (LOD_PAD_SIZE - 1) * scale;
    const minWZ = originZ - scale;
    const maxWZ = originZ + (LOD_PAD_SIZE - 1) * scale;
    // Include 1-chunk margin around section so overhanging crowns from neighbor chunks match world.decorate()
    const cx0 = (minWX >> 4) - 1, cx1 = (maxWX >> 4) + 1;
    const cz0 = (minWZ >> 4) - 1, cz1 = (maxWZ >> 4) + 1;

    const stampCell = (wx, wz, topH, botH, lr, lg, lb, useFol) => {
      const ix = Math.floor((wx - originX) / scale) + 1;
      const iz = Math.floor((wz - originZ) / scale) + 1;
      if (ix < 0 || ix >= LOD_PAD_SIZE || iz < 0 || iz >= LOD_PAD_SIZE) return;
      const idx = iz * LOD_PAD_SIZE + ix;
      // Respect chunk-level hasSurfaceStructure suppression (matching if (ch.hasSurfaceStructure) continue in world.js)
      if (structMask[idx]) return;
      const gTop = yTop[idx];
      if (topH <= gTop) return;
      const bH = Math.max(gTop, botH);
      if (treeTop[idx] === 0) {
        treeTop[idx] = topH;
        treeBot[idx] = bH;
      } else {
        if (bH < treeBot[idx]) treeBot[idx] = bH;
        if (topH > treeTop[idx]) treeTop[idx] = topH;
      }
      if (topH >= treeTop[idx]) {
        treeR[idx] = useFol ? folR[idx] : lr;
        treeG[idx] = useFol ? folG[idx] : lg;
        treeB[idx] = useFol ? folB[idx] : lb;
      }
    };

    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const trees = world.treesFor(cx, cz);
        if (!trees || !trees.length) continue;
        for (let tIdx = 0; tIdx < trees.length; tIdx++) {
          const tr = trees[tIdx];
          const tx = tr.x, ty = tr.y, tz = tr.z, type = tr.type;
          if (tx + 3 < minWX || tx - 3 > maxWX || tz + 3 < minWZ || tz - 3 > maxWZ) continue;

          if (scale === 4) {
            // Coarse L2 (4:1 scale): stamp the 4x4 cell containing trunk + cardinal crown cells using exact tree from world.treesFor
            let h = tr.h, lr = 0, lg = 0, lb = 0, useFol = true, rad = 2, crownBot = ty + 2;
            if (type === 'birch') {
              h = tr.h + 1; useFol = false;
              lr = bt.birchLeaves[0]; lg = bt.birchLeaves[1]; lb = bt.birchLeaves[2];
              crownBot = ty + h - 3;
            } else if (type === 'big') {
              h = tr.h + 2;
              crownBot = ty + h - 3;
            } else if (type === 'spruce') {
              h = tr.h + 3; useFol = false;
              lr = bt.spruceLeaves[0]; lg = bt.spruceLeaves[1]; lb = bt.spruceLeaves[2];
              crownBot = ty + 2;
            } else if (type === 'cherry') {
              h = Math.max(5, tr.h); rad = 3; useFol = false;
              lr = bt.cherryLeaves[0]; lg = bt.cherryLeaves[1]; lb = bt.cherryLeaves[2];
              crownBot = ty + h - 2;
            } else {
              crownBot = ty + h - 3;
            }
            const crownTop = ty + h + 1;
            stampCell(tx, tz, crownTop, ty, lr, lg, lb, useFol);
            stampCell(tx - rad, tz, crownTop - 1, crownBot, lr, lg, lb, useFol);
            stampCell(tx + rad, tz, crownTop - 1, crownBot, lr, lg, lb, useFol);
            stampCell(tx, tz - rad, crownTop - 1, crownBot, lr, lg, lb, useFol);
            stampCell(tx, tz + rad, crownTop - 1, crownBot, lr, lg, lb, useFol);
            continue;
          }

          // L0 (1:1) & L1 (2:1): exact RNG(tr.seed) crown geometry matching world.placeTree() 1-for-1
          const r = RNG(tr.seed);
          if (type === 'oak' || type === 'birch' || type === 'big') {
            const h = type === 'birch' ? tr.h + 1 : tr.h + (type === 'big' ? 2 : 0);
            const isBirch = type === 'birch';
            const lr = isBirch ? bt.birchLeaves[0] : 0;
            const lg = isBirch ? bt.birchLeaves[1] : 0;
            const lb = isBirch ? bt.birchLeaves[2] : 0;
            const cBot = ty + h - 3;
            for (let dy = h - 3; dy <= h; dy++) {
              const rad = dy >= h - 1 ? 1 : 2;
              for (let dx = -rad; dx <= rad; dx++) {
                for (let dz = -rad; dz <= rad; dz++) {
                  if (Math.abs(dx) === rad && Math.abs(dz) === rad && (dy === h || r() < 0.5)) continue;
                  stampCell(tx + dx, tz + dz, ty + dy + 1, (dx === 0 && dz === 0) ? ty : cBot, lr, lg, lb, !isBirch);
                }
              }
            }
            if (type === 'big') {
              for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                  if (!dx || !dz) stampCell(tx + dx, tz + dz, ty + h + 2, (dx === 0 && dz === 0) ? ty : cBot, lr, lg, lb, true);
                }
              }
            }
          } else if (type === 'spruce') {
            const h = tr.h + 3;
            const lr = bt.spruceLeaves[0], lg = bt.spruceLeaves[1], lb = bt.spruceLeaves[2];
            let rad = 0;
            for (let dy = h; dy >= 2; dy--) {
              for (let dx = -rad; dx <= rad; dx++) {
                for (let dz = -rad; dz <= rad; dz++) {
                  if (Math.abs(dx) + Math.abs(dz) > rad + (rad > 1 ? 1 : 0)) continue;
                  stampCell(tx + dx, tz + dz, ty + dy + 1, (dx === 0 && dz === 0) ? ty : (ty + dy), lr, lg, lb, false);
                }
              }
              rad = rad >= 2 ? 1 : rad + 1;
              if (dy === h) rad = 1;
            }
            stampCell(tx, tz, ty + h + 2, ty, lr, lg, lb, false);
          } else if (type === 'cherry') {
            const h = Math.max(5, tr.h);
            const lr = bt.cherryLeaves[0], lg = bt.cherryLeaves[1], lb = bt.cherryLeaves[2];
            const cBot = ty + h - 2;
            for (let dy = h - 2; dy <= h + 1; dy++) {
              const rad = dy === h + 1 ? 2 : 3;
              const maxD2 = dy === h + 1 ? 5 : 11;
              for (let dx = -rad; dx <= rad; dx++) {
                for (let dz = -rad; dz <= rad; dz++) {
                  const d2 = dx * dx + dz * dz;
                  if (d2 > maxD2) continue;
                  if (d2 === maxD2 && r() < 0.35) continue;
                  stampCell(tx + dx, tz + dz, ty + dy + 1, (dx === 0 && dz === 0) ? ty : cBot, lr, lg, lb, false);
                }
              }
            }
            for (let dx = -3; dx <= 3; dx++) {
              for (let dz = -3; dz <= 3; dz++) {
                const d2 = dx * dx + dz * dz;
                if (d2 >= 4 && d2 <= 9 && r() < 0.38) {
                  stampCell(tx + dx, tz + dz, ty + h - 2, ty + h - 3, lr, lg, lb, false);
                }
              }
            }
            stampCell(tx, tz, ty + h + 2, ty, lr, lg, lb, false);
          }
        }
      }
    }
  },

  _sampleEnd(world, originX, originZ, scale, modSummaries) {
    const yTop = this.yTop, yBot = this.yBot, waterY = this.waterY, waterType = this.waterType;
    const colR = this.colR, colG = this.colG, colB = this.colB;
    const sideR = this.sideR, sideG = this.sideG, sideB = this.sideB;
    const mat = this.mat, blkLight = this.blkLight;
    const bt = LOD_BASE_TEX;
    const pillars = typeof world.getEndPillars === 'function' ? world.getEndPillars() : [];
    const halfStep = scale >> 1;

    for (let iz = 0; iz < LOD_PAD_SIZE; iz++) {
      const wz = originZ + (iz - 1) * scale + halfStep;
      for (let ix = 0; ix < LOD_PAD_SIZE; ix++) {
        const wx = originX + (ix - 1) * scale + halfStep;
        const idx = iz * LOD_PAD_SIZE + ix;
        waterY[idx] = 0;
        waterType[idx] = 0;
        blkLight[idx] = 0;

        const r = Math.hypot(wx, wz);
        const edgeR = 48 + world.nCont.n2(wx / 20, wz / 20) * 5.5 + world.nSurf.n2(wx / 8, wz / 8) * 2.0;
        let topY = 0, botY = 0;
        let tr = bt.endStone[0], tg = bt.endStone[1], tb = bt.endStone[2];
        let mType = LOD_MAT_STONE;

        if (r <= edgeR) {
          const plateau = clamp((r - 10) / 36, 0, 1);
          topY = 59 + Math.round(world.nHills.n2(wx / 26, wz / 26) * 3 * plateau);
          const frac = clamp(r / Math.max(1, edgeR), 0, 1);
          botY = Math.max(16, Math.round(22 + Math.pow(frac, 1.65) * 34 + Math.abs(world.nErosion.n2(wx / 14, wz / 14)) * 5));
        }

        for (let p = 0; p < pillars.length; p++) {
          const pil = pillars[p];
          const dx = wx - pil.x, dz = wz - pil.z;
          if (dx * dx + dz * dz <= (pil.rad + 0.6) * (pil.rad + 0.6)) {
            topY = Math.max(topY, pil.topY + 1);
            if (!botY) botY = 42;
            tr = bt.obsidian[0]; tg = bt.obsidian[1]; tb = bt.obsidian[2];
            mType = LOD_MAT_CUSTOM;
            break;
          }
        }

        if (wx >= 40 && wx <= 44 && wz >= -2 && wz <= 2 && topY < 50) {
          topY = 50;
          botY = 49;
          tr = bt.obsidian[0]; tg = bt.obsidian[1]; tb = bt.obsidian[2];
          mType = LOD_MAT_CUSTOM;
        }

        yTop[idx] = topY;
        yBot[idx] = botY;
        colR[idx] = tr; colG[idx] = tg; colB[idx] = tb;
        sideR[idx] = tr; sideG[idx] = tg; sideB[idx] = tb;
        mat[idx] = mType;
      }
    }

    if (modSummaries && modSummaries.size) {
      this._applyModSummaries(world, originX, originZ, scale, modSummaries);
    }
  },

  _applyModSummaries(world, originX, originZ, scale, modSummaries) {
    const yTop = this.yTop, waterY = this.waterY, waterType = this.waterType;
    const colR = this.colR, colG = this.colG, colB = this.colB;
    const sideR = this.sideR, sideG = this.sideG, sideB = this.sideB;
    const mat = this.mat, blkLight = this.blkLight;
    const folR = this.folR, folG = this.folG, folB = this.folB;
    const halfStep = scale >> 1;

    for (let iz = 0; iz < LOD_PAD_SIZE; iz++) {
      const wz = originZ + (iz - 1) * scale + halfStep;
      const cz = wz >> 4;
      for (let ix = 0; ix < LOD_PAD_SIZE; ix++) {
        const wx = originX + (ix - 1) * scale + halfStep;
        const cx = wx >> 4;
        const sum = modSummaries.get(ckey(cx, cz));
        if (!sum) continue;
        const lx = wx & 15, lz = wz & 15;
        const packed = sum[(lz << 4) | lx];
        if (!packed) continue;
        const topId = (packed >>> 20) & 0xFFF;
        const tY = (packed >>> 12) & 0xFF;
        const wY = (packed >>> 4) & 0xFF;
        const bL = packed & 0xF;
        const idx = iz * LOD_PAD_SIZE + ix;
        if (tY > 0) {
          const bt = LOD_BASE_TEX;
          if (topId === 15 || topId === 47 || topId === 50 || topId === 520) {
            this.treeTop[idx] = tY;
            if (!this.treeBot[idx] || this.treeBot[idx] >= tY) this.treeBot[idx] = Math.max(yTop[idx], tY - 3);
            if (topId === 15) {
              this.treeR[idx] = folR[idx]; this.treeG[idx] = folG[idx]; this.treeB[idx] = folB[idx];
            } else {
              const co = topId * 6;
              this.treeR[idx] = BLOCK_LOD_COLORS[co] || 80;
              this.treeG[idx] = BLOCK_LOD_COLORS[co + 1] || 120;
              this.treeB[idx] = BLOCK_LOD_COLORS[co + 2] || 70;
            }
            blkLight[idx] = bL;
            continue;
          }
          this.treeTop[idx] = 0;
          this.treeBot[idx] = 0;
          yTop[idx] = tY;
          waterY[idx] = wY;
          if (!wY) waterType[idx] = 0;
          else if (!waterType[idx]) waterType[idx] = 1;
          blkLight[idx] = bL;
          if (topId === 1022) {
            colR[idx] = bt.snow[0]; colG[idx] = bt.snow[1]; colB[idx] = bt.snow[2];
            sideR[idx] = bt.stone[0]; sideG[idx] = bt.stone[1]; sideB[idx] = bt.stone[2];
            mat[idx] = LOD_MAT_SNOW;
          } else if (topId === 34) {
            colR[idx] = bt.snow[0]; colG[idx] = bt.snow[1]; colB[idx] = bt.snow[2];
            sideR[idx] = bt.grassSnowSide[0]; sideG[idx] = bt.grassSnowSide[1]; sideB[idx] = bt.grassSnowSide[2];
            mat[idx] = LOD_MAT_SNOW;
          } else if (topId === 33) {
            colR[idx] = bt.snow[0]; colG[idx] = bt.snow[1]; colB[idx] = bt.snow[2];
            sideR[idx] = bt.snow[0]; sideG[idx] = bt.snow[1]; sideB[idx] = bt.snow[2];
            mat[idx] = LOD_MAT_SNOW;
          } else if (topId !== 2) {
            const co = topId * 6;
            colR[idx] = BLOCK_LOD_COLORS[co] || 133;
            colG[idx] = BLOCK_LOD_COLORS[co + 1] || 121;
            colB[idx] = BLOCK_LOD_COLORS[co + 2] || 114;
            sideR[idx] = BLOCK_LOD_COLORS[co + 3] || colR[idx];
            sideG[idx] = BLOCK_LOD_COLORS[co + 4] || colG[idx];
            sideB[idx] = BLOCK_LOD_COLORS[co + 5] || colB[idx];
            mat[idx] = LOD_MAT_CUSTOM;
          }
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------
// 2D Greedy Column Mesher + Skirt Stitching & Valley AO
// ---------------------------------------------------------------------------
const LodMesher = {
  opaqueBuf: new LodMeshBuffer(16384),
  transBuf: new LodMeshBuffer(4096),
  aoGrid: new Uint8Array(LOD_SEC_SIZE * LOD_SEC_SIZE),
  visited: new Uint8Array(LOD_SEC_SIZE * LOD_SEC_SIZE),

  build(sampler, level, dim = 'overworld') {
    const baseSky = dim === 'end' ? 10 : 15;
    const scale = 1 << level;
    const ob = this.opaqueBuf;
    const tb = this.transBuf;
    ob.reset();
    tb.reset();

    const yTop = sampler.yTop, yBot = sampler.yBot, waterY = sampler.waterY, waterType = sampler.waterType;
    const colR = sampler.colR, colG = sampler.colG, colB = sampler.colB;
    const sideR = sampler.sideR, sideG = sampler.sideG, sideB = sampler.sideB;
    const mat = sampler.mat, blkLight = sampler.blkLight;
    const treeTop = sampler.treeTop, treeBot = sampler.treeBot;
    const treeR = sampler.treeR, treeG = sampler.treeG, treeB = sampler.treeB;
    const aoGrid = this.aoGrid;
    const visited = this.visited;
    const bt = LOD_BASE_TEX;

    // 1. Precompute Valley AO on 32x32 interior from 3x3 height neighborhood
    for (let iz = 0; iz < LOD_SEC_SIZE; iz++) {
      const pz = iz + 1;
      for (let ix = 0; ix < LOD_SEC_SIZE; ix++) {
        const px = ix + 1;
        const pIdx = pz * LOD_PAD_SIZE + px;
        const h = yTop[pIdx];
        if (h <= 0 || mat[pIdx] === LOD_MAT_LEAVES) {
          aoGrid[iz * LOD_SEC_SIZE + ix] = 252;
          continue;
        }
        let higherSum = 0;
        for (let dz = -1; dz <= 1; dz++) {
          const rOff = (pz + dz) * LOD_PAD_SIZE + px;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            const nIdx = rOff + dx;
            if (mat[nIdx] === LOD_MAT_LEAVES) continue;
            const nh = yTop[nIdx];
            if (nh > h) higherSum += Math.min(6, (nh - h) / scale);
          }
        }
        let aoFactor = clamp(1.0 - higherSum * 0.006, 0.88, 1.0);
        // Subtle canopy shadow on ground beneath trees (matching mesher.js skylight attenuation under leaves)
        if (treeTop && treeTop[pIdx] > h) aoFactor *= 0.92;
        aoGrid[iz * LOD_SEC_SIZE + ix] = Math.round(aoFactor * 255);
      }
    }

    // 2. Pass 1: 2D Greedy Meshing for Top Faces (+Y, faceDir = 3)
    visited.fill(0);
    for (let iz = 0; iz < LOD_SEC_SIZE; iz++) {
      for (let ix = 0; ix < LOD_SEC_SIZE; ix++) {
        const gIdx = iz * LOD_SEC_SIZE + ix;
        if (visited[gIdx]) continue;
        const pIdx = (iz + 1) * LOD_PAD_SIZE + (ix + 1);
        const h = yTop[pIdx];
        if (h <= 0) {
          visited[gIdx] = 1;
          continue;
        }
        const r0 = colR[pIdx], g0 = colG[pIdx], b0 = colB[pIdx];
        const m0 = mat[pIdx], bl0 = blkLight[pIdx];
        const ao0 = aoGrid[gIdx];
        // Underwater sky light attenuation matches world.js initLight (OPACITY[water]=2, OPACITY[ice]=2)
        const sky0 = waterY[pIdx] > h ? Math.max(0, baseSky - (waterY[pIdx] - h) * 2) : baseSky;

        let w = 1;
        while (ix + w < LOD_SEC_SIZE) {
          const nx = ix + w, ngIdx = iz * LOD_SEC_SIZE + nx;
          if (visited[ngIdx]) break;
          const npIdx = (iz + 1) * LOD_PAD_SIZE + (nx + 1);
          if (yTop[npIdx] !== h || mat[npIdx] !== m0 || blkLight[npIdx] !== bl0) break;
          const nSky = waterY[npIdx] > h ? Math.max(0, baseSky - (waterY[npIdx] - h) * 2) : baseSky;
          if (nSky !== sky0) break;
          if (Math.abs(colR[npIdx] - r0) > 2 || Math.abs(colG[npIdx] - g0) > 2 || Math.abs(colB[npIdx] - b0) > 2) break;
          if (Math.abs(aoGrid[ngIdx] - ao0) > 10) break;
          w++;
        }

        let d = 1;
        while (iz + d < LOD_SEC_SIZE) {
          const nz = iz + d;
          let rowOk = true;
          for (let kx = 0; kx < w; kx++) {
            const nx = ix + kx, ngIdx = nz * LOD_SEC_SIZE + nx;
            if (visited[ngIdx]) { rowOk = false; break; }
            const npIdx = (nz + 1) * LOD_PAD_SIZE + (nx + 1);
            const nSky = waterY[npIdx] > h ? Math.max(0, baseSky - (waterY[npIdx] - h) * 2) : baseSky;
            if (yTop[npIdx] !== h || mat[npIdx] !== m0 || blkLight[npIdx] !== bl0 || nSky !== sky0 ||
                Math.abs(colR[npIdx] - r0) > 2 || Math.abs(colG[npIdx] - g0) > 2 || Math.abs(colB[npIdx] - b0) > 2 ||
                Math.abs(aoGrid[ngIdx] - ao0) > 10) {
              rowOk = false;
              break;
            }
          }
          if (!rowOk) break;
          d++;
        }

        for (let kz = 0; kz < d; kz++) {
          const rBase = (iz + kz) * LOD_SEC_SIZE + ix;
          for (let kx = 0; kx < w; kx++) visited[rBase + kx] = 1;
        }

        const x0 = ix * scale, x1 = (ix + w) * scale;
        const z0 = iz * scale, z1 = (iz + d) * scale;
        const skyByte = Math.round((sky0 / 15) * 255);
        const blkByte = Math.round((bl0 / 15) * 255);
        const nw = m0 === LOD_MAT_LEAVES ? 180 : (m0 === LOD_MAT_GRASS ? 110 : (m0 === LOD_MAT_SAND || m0 === LOD_MAT_SNOW ? 30 : 90));

        const baseMeta = 3 | ((m0 & 15) << 4);
        const mX0 = ix === 0 ? 1 : 0;
        const mX1 = (ix + w) === LOD_SEC_SIZE ? 2 : 0;
        const mZ0 = iz === 0 ? 16 : 0;
        const mZ1 = (iz + d) === LOD_SEC_SIZE ? 32 : 0;

        ob.v(x0, h, z0, baseMeta | ((mX0 | mZ0) << 8), r0, g0, b0, 255, skyByte, blkByte, ao0, nw);
        ob.v(x0, h, z1, baseMeta | ((mX0 | mZ1) << 8), r0, g0, b0, 255, skyByte, blkByte, ao0, nw);
        ob.v(x1, h, z1, baseMeta | ((mX1 | mZ1) << 8), r0, g0, b0, 255, skyByte, blkByte, ao0, nw);
        ob.v(x1, h, z0, baseMeta | ((mX1 | mZ0) << 8), r0, g0, b0, 255, skyByte, blkByte, ao0, nw);
      }
    }

    // 3. Pass 2: Four Cardinal Vertical Skirts (-X, +X, -Z, +Z)
    // Shade values match FACE_SHADE in mesher.js ([0.6, 0.6, 0.5, 1.0, 0.8, 0.8])
    const skirtDrop = scale * 4;
    for (let iz = 0; iz < LOD_SEC_SIZE; iz++) {
      for (let ix = 0; ix < LOD_SEC_SIZE; ix++) {
        const pIdx = (iz + 1) * LOD_PAD_SIZE + (ix + 1);
        const h = yTop[pIdx];
        if (h <= 0) continue;
        const bMin = yBot[pIdx];
        const mType = mat[pIdx];
        const sr0 = sideR[pIdx], sg0 = sideG[pIdx], sb0 = sideB[pIdx];
        const bL = blkLight[pIdx];
        const blkByte = Math.round((bL / 15) * 255);
        const aoTop = mType === LOD_MAT_LEAVES ? 248 : 242;
        const aoBot = mType === LOD_MAT_LEAVES ? 232 : 218;
        const nw = 155;
        const wY = waterY[pIdx];
        const sky0 = wY > h ? Math.max(0, baseSky - (wY - h) * 2) : baseSky;
        const skyByte = Math.round((sky0 / 15) * 255);

        const x0 = ix * scale, x1 = (ix + 1) * scale;
        const z0 = iz * scale, z1 = (iz + 1) * scale;

        for (let dir = 0; dir < 4; dir++) {
          let faceDir, nbIdx, onBorder, vx0, vz0, vx1, vz1, shade, mBit;
          if (dir === 0) {
            faceDir = 0; nbIdx = pIdx - 1; onBorder = ix === 0;
            vx0 = x0; vz0 = z0; vx1 = x0; vz1 = z1; shade = 0.6; mBit = onBorder ? 1 : 0;
          } else if (dir === 1) {
            faceDir = 1; nbIdx = pIdx + 1; onBorder = ix === LOD_SEC_SIZE - 1;
            vx0 = x1; vz0 = z1; vx1 = x1; vz1 = z0; shade = 0.6; mBit = onBorder ? 2 : 0;
          } else if (dir === 2) {
            faceDir = 4; nbIdx = pIdx - LOD_PAD_SIZE; onBorder = iz === 0;
            vx0 = x1; vz0 = z0; vx1 = x0; vz1 = z0; shade = 0.8; mBit = onBorder ? 16 : 0;
          } else {
            faceDir = 5; nbIdx = pIdx + LOD_PAD_SIZE; onBorder = iz === LOD_SEC_SIZE - 1;
            vx0 = x0; vz0 = z1; vx1 = x1; vz1 = z1; shade = 0.8; mBit = onBorder ? 32 : 0;
          }

          const nbH = yTop[nbIdx];
          if (nbH >= h) continue;
          const baseBot = nbH > 0 ? nbH : bMin;
          const y0 = onBorder ? Math.max(0, Math.min(baseBot, bMin) - skirtDrop) : Math.max(0, baseBot);
          const y1 = h;
          if (y1 <= y0) continue;

          let wr = sr0, wg = sg0, wb = sb0;
          const stepPerBlock = (y1 - y0) / scale;
          if (stepPerBlock >= 5 && (mType === LOD_MAT_GRASS || mType === LOD_MAT_SNOW)) {
            wr = bt.stone[0]; wg = bt.stone[1]; wb = bt.stone[2];
          } else if (stepPerBlock >= 4 && mType === LOD_MAT_SAND) {
            wr = bt.sandstoneSide[0]; wg = bt.sandstoneSide[1]; wb = bt.sandstoneSide[2];
          } else if (stepPerBlock >= 2 && mType === LOD_MAT_GRASS) {
            wr = bt.dirt[0]; wg = bt.dirt[1]; wb = bt.dirt[2];
          }
          wr = Math.round(wr * shade);
          wg = Math.round(wg * shade);
          wb = Math.round(wb * shade);

          const metaTop = faceDir | ((mType & 15) << 4) | (mBit << 8);
          const metaBot = faceDir | ((mType & 15) << 4) | ((mBit | 4) << 8);

          ob.v(vx0, y0, vz0, metaBot, wr, wg, wb, 255, skyByte, blkByte, aoBot, nw);
          ob.v(vx1, y0, vz1, metaBot, wr, wg, wb, 255, skyByte, blkByte, aoBot, nw);
          ob.v(vx1, y1, vz1, metaTop, wr, wg, wb, 255, skyByte, blkByte, aoTop, nw);
          ob.v(vx0, y1, vz0, metaTop, wr, wg, wb, 255, skyByte, blkByte, aoTop, nw);
        }

        // Floating island underside (-Y, faceDir = 2) for The End
        if (bMin > 12 && (yTop[pIdx - 1] === 0 || yTop[pIdx + 1] === 0 || yTop[pIdx - LOD_PAD_SIZE] === 0 || yTop[pIdx + LOD_PAD_SIZE] === 0)) {
          const br = Math.round(sr0 * 0.5), bg = Math.round(sg0 * 0.5), bb = Math.round(sb0 * 0.5);
          const metaDown = 2 | ((mType & 15) << 4);
          const uSky = dim === 'end' ? Math.round((10 / 15) * 255) : 220;
          ob.v(x0, bMin, z0, metaDown, br, bg, bb, 255, uSky, blkByte, 180, nw);
          ob.v(x1, bMin, z0, metaDown, br, bg, bb, 255, uSky, blkByte, 180, nw);
          ob.v(x1, bMin, z1, metaDown, br, bg, bb, 255, uSky, blkByte, 180, nw);
          ob.v(x0, bMin, z1, metaDown, br, bg, bb, 255, uSky, blkByte, 180, nw);
        }
      }
    }

    // 3b. Pass 2b: Closed 3D Tree Canopies & Trunks (Top +Y, Bottom -Y underside, and 4 Side Skirts)
    // Keeping trees in a dedicated layer above continuous ground yTop prevents any ground holes under trees at the seam!
    if (treeTop) {
      const leafMetaUp = 3 | ((LOD_MAT_LEAVES & 15) << 4);
      const leafMetaDown = 2 | ((LOD_MAT_LEAVES & 15) << 4);
      for (let iz = 0; iz < LOD_SEC_SIZE; iz++) {
        for (let ix = 0; ix < LOD_SEC_SIZE; ix++) {
          const pIdx = (iz + 1) * LOD_PAD_SIZE + (ix + 1);
          const tTop = treeTop[pIdx];
          if (tTop <= 0) continue;
          const gTop = yTop[pIdx];
          const tBot = Math.max(gTop, treeBot[pIdx]);
          if (tTop <= tBot) continue;

          const lr = treeR[pIdx], lg = treeG[pIdx], lb = treeB[pIdx];
          const tBlkByte = Math.round((blkLight[pIdx] / 15) * 255);
          const x0 = ix * scale, x1 = (ix + 1) * scale;
          const z0 = iz * scale, z1 = (iz + 1) * scale;
          const nw = 180;

          // Canopy Top (+Y)
          ob.v(x0, tTop, z0, leafMetaUp, lr, lg, lb, 255, 255, tBlkByte, 252, nw);
          ob.v(x0, tTop, z1, leafMetaUp, lr, lg, lb, 255, 255, tBlkByte, 252, nw);
          ob.v(x1, tTop, z1, leafMetaUp, lr, lg, lb, 255, 255, tBlkByte, 252, nw);
          ob.v(x1, tTop, z0, leafMetaUp, lr, lg, lb, 255, 255, tBlkByte, 252, nw);

          // Canopy Underside (-Y) when suspended above ground (seals trees when viewed from water/lower elevation)
          if (tBot > gTop) {
            const br = Math.round(lr * 0.55), bg = Math.round(lg * 0.55), bb = Math.round(lb * 0.55);
            ob.v(x0, tBot, z0, leafMetaDown, br, bg, bb, 255, 235, tBlkByte, 220, nw);
            ob.v(x1, tBot, z0, leafMetaDown, br, bg, bb, 255, 235, tBlkByte, 220, nw);
            ob.v(x1, tBot, z1, leafMetaDown, br, bg, bb, 255, 235, tBlkByte, 220, nw);
            ob.v(x0, tBot, z1, leafMetaDown, br, bg, bb, 255, 235, tBlkByte, 220, nw);
          }

          // Four Cardinal Canopy/Trunk Side Walls
          for (let dir = 0; dir < 4; dir++) {
            let faceDir, nbIdx, vx0, vz0, vx1, vz1, shade;
            if (dir === 0) {
              faceDir = 0; nbIdx = pIdx - 1;
              vx0 = x0; vz0 = z0; vx1 = x0; vz1 = z1; shade = 0.6;
            } else if (dir === 1) {
              faceDir = 1; nbIdx = pIdx + 1;
              vx0 = x1; vz0 = z1; vx1 = x1; vz1 = z0; shade = 0.6;
            } else if (dir === 2) {
              faceDir = 4; nbIdx = pIdx - LOD_PAD_SIZE;
              vx0 = x1; vz0 = z0; vx1 = x0; vz1 = z0; shade = 0.8;
            } else {
              faceDir = 5; nbIdx = pIdx + LOD_PAD_SIZE;
              vx0 = x0; vz0 = z1; vx1 = x1; vz1 = z1; shade = 0.8;
            }

            const nbTTop = treeTop[nbIdx];
            const nbTBot = nbTTop > 0 ? Math.max(yTop[nbIdx], treeBot[nbIdx]) : 32767;
            const wr = Math.round(lr * shade), wg = Math.round(lg * shade), wb = Math.round(lb * shade);
            const metaSide = faceDir | ((LOD_MAT_LEAVES & 15) << 4);

            if (nbTTop <= tBot || nbTBot >= tTop) {
              // Disjoint or no neighbor tree: emit full vertical face [tBot, tTop]
              ob.v(vx0, tBot, vz0, metaSide, wr, wg, wb, 255, 255, tBlkByte, 232, nw);
              ob.v(vx1, tBot, vz1, metaSide, wr, wg, wb, 255, 255, tBlkByte, 232, nw);
              ob.v(vx1, tTop, vz1, metaSide, wr, wg, wb, 255, 255, tBlkByte, 248, nw);
              ob.v(vx0, tTop, vz0, metaSide, wr, wg, wb, 255, 255, tBlkByte, 248, nw);
            } else {
              if (tTop > nbTTop) {
                const y0 = Math.max(tBot, nbTTop);
                ob.v(vx0, y0, vz0, metaSide, wr, wg, wb, 255, 255, tBlkByte, 238, nw);
                ob.v(vx1, y0, vz1, metaSide, wr, wg, wb, 255, 255, tBlkByte, 238, nw);
                ob.v(vx1, tTop, vz1, metaSide, wr, wg, wb, 255, 255, tBlkByte, 248, nw);
                ob.v(vx0, tTop, vz0, metaSide, wr, wg, wb, 255, 255, tBlkByte, 248, nw);
              }
              if (tBot < nbTBot) {
                const y1 = Math.min(tTop, nbTBot);
                ob.v(vx0, tBot, vz0, metaSide, wr, wg, wb, 255, 255, tBlkByte, 228, nw);
                ob.v(vx1, tBot, vz1, metaSide, wr, wg, wb, 255, 255, tBlkByte, 228, nw);
                ob.v(vx1, y1, vz1, metaSide, wr, wg, wb, 255, 255, tBlkByte, 238, nw);
                ob.v(vx0, y1, vz0, metaSide, wr, wg, wb, 255, 255, tBlkByte, 238, nw);
              }
            }
          }
        }
      }
    }

    // 4. Pass 3: 2D Greedy Meshing for Translucent Water & Ice Surface
    visited.fill(0);
    for (let iz = 0; iz < LOD_SEC_SIZE; iz++) {
      for (let ix = 0; ix < LOD_SEC_SIZE; ix++) {
        const gIdx = iz * LOD_SEC_SIZE + ix;
        if (visited[gIdx]) continue;
        const pIdx = (iz + 1) * LOD_PAD_SIZE + (ix + 1);
        const wY = waterY[pIdx];
        const wType = waterType[pIdx] || 1;
        const wBl = blkLight[pIdx];
        const h = yTop[pIdx];
        if (!wY || wY <= h) {
          visited[gIdx] = 1;
          continue;
        }

        let w = 1;
        while (ix + w < LOD_SEC_SIZE) {
          const nx = ix + w, ngIdx = iz * LOD_SEC_SIZE + nx;
          if (visited[ngIdx]) break;
          const npIdx = (iz + 1) * LOD_PAD_SIZE + (nx + 1);
          if (waterY[npIdx] !== wY || (waterType[npIdx] || 1) !== wType || blkLight[npIdx] !== wBl || waterY[npIdx] <= yTop[npIdx]) break;
          w++;
        }

        let d = 1;
        while (iz + d < LOD_SEC_SIZE) {
          const nz = iz + d;
          let rowOk = true;
          for (let kx = 0; kx < w; kx++) {
            const nx = ix + kx, ngIdx = nz * LOD_SEC_SIZE + nx;
            if (visited[ngIdx]) { rowOk = false; break; }
            const npIdx = (nz + 1) * LOD_PAD_SIZE + (nx + 1);
            if (waterY[npIdx] !== wY || (waterType[npIdx] || 1) !== wType || blkLight[npIdx] !== wBl || waterY[npIdx] <= yTop[npIdx]) { rowOk = false; break; }
          }
          if (!rowOk) break;
          d++;
        }

        for (let kz = 0; kz < d; kz++) {
          const rBase = (iz + kz) * LOD_SEC_SIZE + ix;
          for (let kx = 0; kx < w; kx++) visited[rBase + kx] = 1;
        }

        const x0 = ix * scale, x1 = (ix + w) * scale;
        const z0 = iz * scale, z1 = (iz + d) * scale;
        const baseMeta = 3 | (((wType === 2 ? LOD_MAT_SNOW : LOD_MAT_WATER) & 15) << 4);
        const mX0 = ix === 0 ? 1 : 0;
        const mX1 = (ix + w) === LOD_SEC_SIZE ? 2 : 0;
        const mZ0 = iz === 0 ? 16 : 0;
        const mZ1 = (iz + d) === LOD_SEC_SIZE ? 32 : 0;

        const wr = wType === 2 ? bt.ice[0] : bt.water[0];
        const wg = wType === 2 ? bt.ice[1] : bt.water[1];
        const wb = wType === 2 ? bt.ice[2] : bt.water[2];
        const wa = wType === 2 ? (bt.ice[3] || 210) : (bt.water[3] || 185);
        const nw = wType === 2 ? 15 : 0;
        const wSkyByte = Math.round((baseSky / 15) * 255);
        const wBlkByte = Math.round((wBl / 15) * 255);

        tb.v(x0, wY, z0, baseMeta | ((mX0 | mZ0) << 8), wr, wg, wb, wa, wSkyByte, wBlkByte, 255, nw);
        tb.v(x0, wY, z1, baseMeta | ((mX0 | mZ1) << 8), wr, wg, wb, wa, wSkyByte, wBlkByte, 255, nw);
        tb.v(x1, wY, z1, baseMeta | ((mX1 | mZ1) << 8), wr, wg, wb, wa, wSkyByte, wBlkByte, 255, nw);
        tb.v(x1, wY, z0, baseMeta | ((mX1 | mZ0) << 8), wr, wg, wb, wa, wSkyByte, wBlkByte, 255, nw);
      }
    }

    return {
      opaque: ob.n ? ob.slice() : null,
      trans: tb.n ? tb.slice() : null,
      nOpaque: ob.n,
      nTrans: tb.n,
    };
  },
};

// ---------------------------------------------------------------------------
// Main-Thread QuadTree Coordinator (LodManager)
// ---------------------------------------------------------------------------
class LodManager {
  constructor(game) {
    this.game = game;
    this.nodes = new Map();             // lodKey -> LodNode
    this.modSummaries = new Map();      // ckey(cx,cz) -> Uint32Array(256)
    this.modSummaryCoords = new Map();  // ckey(cx,cz) -> [cx, cz]
    this.dirtyNodes = new Map();        // lodKey -> timestamp
    this.visibleNodes = [];             // active nodes for current frame
    this.stats = {
      active: 0,
      byLevel: [0, 0, 0, 0],
      tris: 0,
      queued: 0,
      cached: 0,
    };
    this._lastUpdatePos = [1e9, 1e9];
    this._lastTick = -1;
    this._needsTreeRefresh = true;
  }

  isEnabled() {
    const g = this.game;
    if (!g || !g.world || !g.settings) return false;
    if (g.settings.distantHorizons === false) return false;
    const dim = g.world.dimension || 'overworld';
    // Disabled in Nether due to enclosed bedrock ceiling
    return dim === 'overworld' || dim === 'end';
  }

  reset() {
    const r = this.game && this.game.renderer;
    if (r) {
      for (const node of this.nodes.values()) {
        r.freeLodNode(node);
      }
    }
    this.nodes.clear();
    this.modSummaries.clear();
    this.modSummaryCoords.clear();
    this.dirtyNodes.clear();
    this.visibleNodes.length = 0;
    this._lastUpdatePos = [1e9, 1e9];
  }

  // Called when a modified chunk is mounted or edited so distant LODs reflect player builds
  syncChunkSummary(ch) {
    if (!ch || !this.game || !this.game.world) return;
    const ck = ckey(ch.cx, ch.cz);
    const sum = LodColumnSampler.summarizeChunk(ch);
    if (!sum) return;
    this.modSummaries.set(ck, sum);
    this.modSummaryCoords.set(ck, [ch.cx, ch.cz]);
    if (this.game.worker && this.game.worker.isReady()) {
      this.game.worker.syncLodChunkSummary(ch.cx, ch.cz, sum);
    }
  }

  onBlockChanged(x, y, z) {
    const g = this.game, w = g && g.world;
    if (!w) return;
    const bcx = x >> 4, bcz = z >> 4;
    const ch = w.getChunk(bcx, bcz);
    if (ch) this.syncChunkSummary(ch);
    // Block light propagates up to 14 blocks across chunk boundaries; sync affected neighboring chunks too
    const lx = x & 15, lz = z & 15;
    for (let dz = -1; dz <= 1; dz++) {
      if (dz === -1 && lz > 14) continue;
      if (dz === 1 && lz < 1) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        if (dx === -1 && lx > 14) continue;
        if (dx === 1 && lx < 1) continue;
        const nch = w.getChunk(bcx + dx, bcz + dz);
        if (nch) this.syncChunkSummary(nch);
      }
    }
    const now = performance.now();
    for (let lvl = 0; lvl < LOD_LEVELS; lvl++) {
      const span = LOD_SEC_SIZE << lvl;
      const sx = Math.floor(x / span);
      const sz = Math.floor(z / span);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const k = lodKey(lvl, sx + dx, sz + dz);
          const node = this.nodes.get(k);
          if (node) {
            node.dirty = true;
            this.dirtyNodes.set(k, now);
          }
        }
      }
    }
  }

  _getOrCreateNode(level, sx, sz) {
    const k = lodKey(level, sx, sz);
    let node = this.nodes.get(k);
    if (!node) {
      const span = LOD_SEC_SIZE << level;
      node = {
        key: k,
        level,
        sx,
        sz,
        x: sx * span,
        z: sz * span,
        span,
        scale: 1 << level,
        ready: false,
        building: false,
        dirty: false,
        rev: 1,
        o: null,
        t: null,
        n: 0,
        tn: 0,
        lastUsed: this.game.tickCount || 0,
        d: 0,
      };
      this.nodes.set(k, node);
    }
    return node;
  }

  onSectionBuilt(msg) {
    const k = lodKey(msg.level, msg.sx, msg.sz);
    const node = this.nodes.get(k);
    if (!node) return;
    node.building = false;
    if (msg.rev !== node.rev) {
      if (node.dirty) this._requestBuild(node, node.d || 0, false);
      return;
    }
    const r = this.game && this.game.renderer;
    if (!r) return;
    r.uploadLodNode(node, msg);
    node.ready = true;
    node.dirty = false;
    this._needsTreeRefresh = true;
  }

  _buildSync(node) {
    const g = this.game, w = g && g.world;
    if (!w) return false;
    node.building = false;
    node.dirty = false;
    node.rev = (node.rev || 0) + 1;
    LodColumnSampler.sampleSection(w, node.level, node.sx, node.sz, this.modSummaries);
    const res = LodMesher.build(LodColumnSampler, node.level, w.dimension || 'overworld');
    this.onSectionBuilt({
      level: node.level,
      sx: node.sx,
      sz: node.sz,
      rev: node.rev,
      opaque: res.opaque,
      trans: res.trans,
      nOpaque: res.nOpaque,
      nTrans: res.nTrans,
    });
    return true;
  }

  _requestBuild(node, distSq, forceSync = false) {
    if (node.building && !node.dirty && !forceSync) return false;
    const g = this.game, w = g && g.world;
    if (!w) return false;
    if (forceSync || !(g.worker && g.worker.isReady())) {
      return this._buildSync(node);
    }
    node.building = true;
    node.dirty = false;
    node.rev = (node.rev || 0) + 1;
    g.worker.enqueueLodBuild(node.level, node.sx, node.sz, node.rev, distSq);
    return true;
  }

  // Drain debounced block-change rebuilds (150ms coalesce window)
  _drainDirtyNodes() {
    if (!this.dirtyNodes.size) return;
    const now = performance.now();
    for (const [k, ts] of this.dirtyNodes.entries()) {
      if (now - ts < 150) continue;
      this.dirtyNodes.delete(k);
      const node = this.nodes.get(k);
      if (node && node.dirty) {
        this._requestBuild(node, node.d || 0, false);
      }
    }
  }

  // Top-down QuadTree selection from L3 (256x256) -> L2 (128x128) -> L1 (64x64) -> L0 (32x32)
  update(camPos, syncBudget = 1) {
    if (!this.isEnabled()) {
      this.visibleNodes.length = 0;
      return;
    }
    this._drainDirtyNodes();

    const g = this.game;
    const px = camPos[0], pz = camPos[2];
    const R = Math.max(2, g.settings.renderDist || 8);
    const lodR = Math.max(R + 16, g.settings.lodRenderDist || 64);

    this._lastUpdatePos[0] = px;
    this._lastUpdatePos[1] = pz;
    this._needsTreeRefresh = false;

    // Near-chunk exclusion radius (1.5-chunk safety overlap inside renderDist so L0 always covers the seam collar)
    const innerHoleR = Math.max(0, (R - 2.25) * 16);
    const innerHoleSq = innerHoleR * innerHoleR;
    const maxDist = lodR * 16;
    const maxDistSq = (maxDist + 160) * (maxDist + 160);
    // Seam ring radius: inside this radius, ONLY L0 (1:1 scale) is allowed to render so coarse L1/L2/L3 never touch near chunks
    const seamRingR = (R + 2.5) * 16;
    const seamRingSq = seamRingR * seamRingR;

    // Monotonically increasing split distance thresholds for L1..L3 (guaranteed L0 < L1 < L2 < L3 by distance)
    const r0 = Math.max((R + 10) * 16, Math.min(288, maxDist * 0.35));
    const r1 = Math.max(r0 + 160, (R + 22) * 16, Math.min(576, maxDist * 0.62));
    const r2 = Math.max(r1 + 256, (R + 38) * 16, Math.min(960, maxDist * 0.88));
    const splitR = [0, r0, r1, r2];

    const vis = [];
    const byLevel = [0, 0, 0, 0];
    let tris = 0;
    const toBuild = [];
    const queuedKeys = new Set();
    const tick = g.tickCount || 0;

    const w = g.world, r = g.renderer;
    const isBoxCoveredByNearChunks = (bx0, bz0, bx1, bz1) => {
      if (innerHoleSq <= 0) return false;
      const bfx = Math.max(Math.abs(bx0 - px), Math.abs(bx1 - px));
      const bfz = Math.max(Math.abs(bz0 - pz), Math.abs(bz1 - pz));
      if (bfx * bfx + bfz * bfz >= innerHoleSq) return false;
      const cx0 = bx0 >> 4, cx1 = (bx1 - 1) >> 4;
      const cz0 = bz0 >> 4, cz1 = (bz1 - 1) >> 4;
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const ch = w.getChunk(cx, cz);
          if (!ch || !ch.lit) return false;
          if (r && typeof r.isChunkRenderReady === "function" && !r.isChunkRenderReady(ch)) return false;
        }
      }
      return true;
    };

    const enqueueNode = (n) => {
      if (!n.ready && !n.building && !queuedKeys.has(n.key)) {
        queuedKeys.add(n.key);
        toBuild.push(n);
      }
    };

    // Recursively check if a quadrant is covered by ready target-level leaf nodes (even when intermediate L1/L2 levels were skipped!)
    const isSubtreeCovered = (lvl, xIdx, zIdx) => {
      const sp = LOD_SEC_SIZE << lvl;
      const bx0 = xIdx * sp, bz0 = zIdx * sp;
      const bx1 = bx0 + sp, bz1 = bz0 + sp;
      const bcx = clamp(px, bx0, bx1), bcz = clamp(pz, bz0, bz1);
      const bMinSq = (bcx - px) * (bcx - px) + (bcz - pz) * (bcz - pz);
      if (bMinSq > maxDistSq) return true;
      if (isBoxCoveredByNearChunks(bx0, bz0, bx1, bz1)) return true;

      const n = this._getOrCreateNode(lvl, xIdx, zIdx);
      n.lastUsed = tick;
      if (lvl > 0 && bMinSq < splitR[lvl] * splitR[lvl]) {
        let allChildrenCovered = true;
        for (let dz = 0; dz < 2; dz++) {
          for (let dx = 0; dx < 2; dx++) {
            if (!isSubtreeCovered(lvl - 1, xIdx * 2 + dx, zIdx * 2 + dz)) {
              allChildrenCovered = false;
              break;
            }
          }
          if (!allChildrenCovered) break;
        }
        if (allChildrenCovered) return true;
        return n.ready && bMinSq >= seamRingSq;
      }
      return n.ready;
    };

    // Queue only the exact target leaf level for a subtree (never wasting worker cycles on intermediate L2/L1 parents)
    const queueTargetLeaves = (lvl, xIdx, zIdx) => {
      const sp = LOD_SEC_SIZE << lvl;
      const bx0 = xIdx * sp, bz0 = zIdx * sp;
      const bx1 = bx0 + sp, bz1 = bz0 + sp;
      const bcx = clamp(px, bx0, bx1), bcz = clamp(pz, bz0, bz1);
      const bMinSq = (bcx - px) * (bcx - px) + (bcz - pz) * (bcz - pz);
      if (bMinSq > maxDistSq) return;
      if (isBoxCoveredByNearChunks(bx0, bz0, bx1, bz1)) return;

      if (lvl > 0 && bMinSq < splitR[lvl] * splitR[lvl]) {
        for (let dz = 0; dz < 2; dz++) {
          for (let dx = 0; dx < 2; dx++) {
            queueTargetLeaves(lvl - 1, xIdx * 2 + dx, zIdx * 2 + dz);
          }
        }
        return;
      }
      const leaf = this._getOrCreateNode(lvl, xIdx, zIdx);
      leaf.lastUsed = tick;
      const lmx = bx0 + sp * 0.5 - px;
      const lmz = bz0 + sp * 0.5 - pz;
      leaf.d = lmx * lmx + lmz * lmz;
      leaf.minDistSq = bMinSq;
      enqueueNode(leaf);
    };

    const visit = (level, sx, sz) => {
      const span = LOD_SEC_SIZE << level;
      const x0 = sx * span, z0 = sz * span;
      const x1 = x0 + span, z1 = z0 + span;

      // Closest point on section AABB to camera
      const cx = clamp(px, x0, x1);
      const cz = clamp(pz, z0, z1);
      const dxMin = cx - px, dzMin = cz - pz;
      const minDistSq = dxMin * dxMin + dzMin * dzMin;
      if (minDistSq > maxDistSq) return;

      if (isBoxCoveredByNearChunks(x0, z0, x1, z1)) return; // Completely inside ready near-chunk hole

      const midX = x0 + span * 0.5 - px;
      const midZ = z0 + span * 0.5 - pz;
      const centerDistSq = midX * midX + midZ * midZ;

      const wantSplit = level > 0 && minDistSq < splitR[level] * splitR[level];
      const node = this._getOrCreateNode(level, sx, sz);
      node.lastUsed = tick;
      node.d = centerDistSq;
      node.minDistSq = minDistSq;

      if (wantSplit) {
        // Always recurse if parent isn't ready, or is in the near-chunk seam ring, or all 4 child subtrees are covered!
        let allSubtreesCovered = true;
        if (node.ready && minDistSq >= seamRingSq) {
          for (let dz = 0; dz < 2; dz++) {
            for (let dx = 0; dx < 2; dx++) {
              if (!isSubtreeCovered(level - 1, sx * 2 + dx, sz * 2 + dz)) {
                allSubtreesCovered = false;
                break;
              }
            }
            if (!allSubtreesCovered) break;
          }
        }
        if (!node.ready || minDistSq < seamRingSq || allSubtreesCovered) {
          for (let dz = 0; dz < 2; dz++) {
            for (let dx = 0; dx < 2; dx++) {
              visit(level - 1, sx * 2 + dx, sz * 2 + dz);
            }
          }
          return;
        }
        // Keep rendering ready parent temporarily while queuing missing target leaf descendants
        queueTargetLeaves(level, sx, sz);
      }

      if (node.ready) {
        vis.push(node);
        byLevel[level]++;
        tris += (node.n + node.tn) * 0.5;
      } else {
        enqueueNode(node);
      }
    };

    const rootSpan = LOD_SEC_SIZE << (LOD_LEVELS - 1); // 256 blocks
    const minSX = Math.floor((px - maxDist - 64) / rootSpan);
    const maxSX = Math.floor((px + maxDist + 64) / rootSpan);
    const minSZ = Math.floor((pz - maxDist - 64) / rootSpan);
    const maxSZ = Math.floor((pz + maxDist + 64) / rootSpan);

    for (let sz = minSZ; sz <= maxSZ; sz++) {
      for (let sx = minSX; sx <= maxSX; sx++) {
        visit(LOD_LEVELS - 1, sx, sz);
      }
    }

    if (toBuild.length) {
      // Strictly prioritize closer sections (minDistSq) first so nearer terrain ALWAYS refines before farther terrain!
      toBuild.sort((a, b) => ((a.minDistSq ?? a.d) - (b.minDistSq ?? b.d)) || (a.level - b.level) || (a.d - b.d));
      let syncRemaining = Math.max(syncBudget, 3);
      const maxEnqueue = 64;
      for (let i = 0; i < Math.min(toBuild.length, maxEnqueue); i++) {
        const n = toBuild[i];
        // Build L0 seam sections synchronously if needed so the near-chunk boundary is 100% L0 with zero holes
        const urgentSeam = syncRemaining > 0 && n.level === 0 && (n.minDistSq ?? n.d) < seamRingSq;
        if (urgentSeam || !(g.worker && g.worker.isReady() && syncRemaining <= 0)) {
          if (urgentSeam) {
            this._requestBuild(n, n.d, true);
            syncRemaining--;
            if (n.ready) {
              vis.push(n);
              byLevel[n.level]++;
              tris += (n.n + n.tn) * 0.5;
            }
            continue;
          }
        }
        this._requestBuild(n, n.d, false);
      }
    }

    // Periodic LRU cache eviction so GPU VBO count stays bounded (< 2048 nodes)
    if (this.nodes.size > 2048 && tick !== this._lastTick) {
      this._lastTick = tick;
      this._evictLRU(tick);
    }

    this.visibleNodes = vis;
    this.stats.active = vis.length;
    this.stats.byLevel = byLevel;
    this.stats.tris = tris;
    this.stats.queued = toBuild.length;
    this.stats.cached = this.nodes.size;
  }

  _evictLRU(tick) {
    const entries = [];
    for (const node of this.nodes.values()) {
      if (node.lastUsed < tick - 40 && !node.building) {
        entries.push(node);
      }
    }
    if (!entries.length) return;
    entries.sort((a, b) => a.lastUsed - b.lastUsed);
    const r = this.game && this.game.renderer;
    const dropCount = Math.min(entries.length, Math.max(32, this.nodes.size - 1800));
    for (let i = 0; i < dropCount; i++) {
      const node = entries[i];
      if (r) r.freeLodNode(node);
      this.nodes.delete(node.key);
    }
  }
}

if (typeof window !== 'undefined') {
  window.LOD_VSTRIDE = LOD_VSTRIDE;
  window.LOD_SEC_SIZE = LOD_SEC_SIZE;
  window.LOD_PAD_SIZE = LOD_PAD_SIZE;
  window.LOD_LEVELS = LOD_LEVELS;
  window.LOD_BASE_TEX = LOD_BASE_TEX;
  window.BLOCK_LOD_COLORS = BLOCK_LOD_COLORS;
  window.lodKey = lodKey;
  window.initDefaultBlockLodColors = initDefaultBlockLodColors;
  window.buildBlockLodPalette = buildBlockLodPalette;
  window.LodMeshBuffer = LodMeshBuffer;
  window.LodColumnSampler = LodColumnSampler;
  window.LodMesher = LodMesher;
  window.LodManager = LodManager;
}
