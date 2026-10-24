import zipfile
import io
import json
import re
import base64
from PIL import Image

import glob
_zip_candidates = glob.glob('/working_dir/*/user_uploaded_files/ttl=63d/user_uploaded/Pixel Perfection Legacy 13.21.2.zip')
ZIP_PATH = _zip_candidates[0] if _zip_candidates else '/working_dir/c_6d0795a50601cd28/user_uploaded_files/ttl=63d/user_uploaded/Pixel Perfection Legacy 13.21.2.zip'
ORIG_JS = 'game/js/assets.vanilla.js'
OUT_JS = 'game/js/assets.js'

# Load original assets as fallback
with open(ORIG_JS, 'r', encoding='utf-8') as f:
    text = f.read()
m = re.search(r'window\.ASSETS\s*=\s*(\{.*\});', text, re.S)
orig_assets = json.loads(m.group(1))
orig_b64 = orig_assets['strip'].split(',', 1)[1]
orig_strip = Image.open(io.BytesIO(base64.b64decode(orig_b64))).convert('RGBA')
orig_tiles = orig_assets['tiles']
orig_anims = orig_assets['anims']
orig_images = orig_assets['images']

def get_orig_tile_frames(name):
    if name not in orig_tiles:
        return [Image.new('RGBA', (16, 16), (255, 0, 255, 255))]
    idx = orig_tiles[name]
    cnt = orig_anims.get(name, 1)
    frames = []
    for i in range(cnt):
        y = (idx + i) * 16
        frames.append(orig_strip.crop((0, y, 16, y + 16)))
    return frames

z = zipfile.ZipFile(ZIP_PATH, 'r')
namelist = set(z.namelist())

# Path mappings from modern names to legacy/pack names in Pixel Perfection
ALIASES = {
    # Blocks
    'block/grass_block_top': ['block/grass_block_top', 'blocks/grass_top'],
    'block/grass_block_side': ['block/grass_block_side', 'blocks/grass_side'],
    'block/grass_block_snow': ['block/grass_block_snow', 'blocks/grass_side_snowed'],
    'block/grass_block_side_overlay': ['block/grass_block_side_overlay', 'blocks/grass_side_overlay'],
    'block/azure_bluet': ['block/azure_bluet', 'blocks/flower_houstonia'],
    'block/orange_tulip': ['block/orange_tulip', 'blocks/flower_tulip_orange'],
    'block/oxeye_daisy': ['block/oxeye_daisy', 'blocks/flower_oxeye_daisy'],
    'block/cornflower': ['block/cornflower'],
    'block/lily_of_the_valley': ['block/lily_of_the_valley'],
    'block/netherrack': ['block/netherrack', 'blocks/netherrack'],
    'block/short_grass': ['block/short_grass', 'block/grass', 'blocks/tallgrass'],
    'block/dandelion': ['block/dandelion', 'blocks/flower_dandelion'],
    'block/poppy': ['block/poppy', 'blocks/flower_rose'],
    'block/blue_orchid': ['block/blue_orchid', 'blocks/flower_blue_orchid'],
    'block/allium': ['block/allium', 'blocks/flower_allium'],
    'block/red_tulip': ['block/red_tulip', 'blocks/flower_tulip_red'],
    'block/dead_bush': ['block/dead_bush', 'blocks/deadbush'],
    'block/sugar_cane': ['block/sugar_cane', 'block/reeds', 'blocks/reeds'],
    'block/lily_pad': ['block/lily_pad', 'blocks/waterlily'],
    'block/torch': ['block/torch', 'blocks/torch_on'],
    'block/redstone_torch': ['block/redstone_torch', 'blocks/redstone_torch_on'],
    'block/redstone_torch_off': ['block/redstone_torch_off', 'blocks/redstone_torch_off'],
    'block/redstone_lamp': ['block/redstone_lamp', 'blocks/redstone_lamp_off'],
    'block/redstone_lamp_on': ['block/redstone_lamp_on', 'blocks/redstone_lamp_on'],
    'block/repeater': ['block/repeater', 'blocks/repeater_off'],
    'block/repeater_on': ['block/repeater_on', 'blocks/repeater_on'],
    'block/comparator': ['block/comparator', 'blocks/comparator_off'],
    'block/comparator_on': ['block/comparator_on', 'blocks/comparator_on'],
    'block/observer_front': ['block/observer_front', 'blocks/observer_front'],
    'block/observer_back': ['block/observer_back', 'blocks/observer_back'],
    'block/observer_back_on': ['block/observer_back_on', 'blocks/observer_back_lit', 'blocks/observer_back_on'],
    'block/observer_side': ['block/observer_side', 'blocks/observer_side'],
    'block/observer_top': ['block/observer_top', 'blocks/observer_top'],
    'block/piston_bottom': ['block/piston_bottom', 'blocks/piston_bottom'],
    'block/piston_inner': ['block/piston_inner', 'blocks/piston_inner'],
    'block/piston_side': ['block/piston_side', 'blocks/piston_side'],
    'block/piston_top': ['block/piston_top', 'block/piston_top_normal', 'blocks/piston_top_normal'],
    'block/piston_top_sticky': ['block/piston_top_sticky', 'blocks/piston_top_sticky'],
    'block/brewing_stand': ['block/brewing_stand', 'blocks/brewing_stand'],
    'block/brewing_stand_base': ['block/brewing_stand_base', 'blocks/brewing_stand_base'],
    'block/cherry_log': ['block/cherry_log'],
    'block/cherry_log_top': ['block/cherry_log_top'],
    'block/cherry_leaves': ['block/cherry_leaves'],
    'block/cherry_sapling': ['block/cherry_sapling'],
    'block/pink_petals': ['block/pink_petals', 'item/pink_petals'],
    'block/cherry_door_top': ['block/cherry_door_top'],
    'block/cherry_door_bottom': ['block/cherry_door_bottom'],
    'block/farmland': ['block/farmland', 'blocks/farmland_dry'],
    'block/farmland_moist': ['block/farmland_moist', 'blocks/farmland_wet'],
    'block/cobweb': ['block/cobweb', 'blocks/web'],
    'block/spawner': ['block/spawner', 'blocks/mob_spawner'],
    'block/dirt_path_top': ['block/dirt_path_top', 'block/grass_path_top', 'blocks/grass_path_top'],
    'block/dirt_path_side': ['block/dirt_path_side', 'block/grass_path_side', 'blocks/grass_path_side'],
    'block/terracotta': ['block/terracotta', 'blocks/hardened_clay'],
    'block/orange_terracotta': ['block/orange_terracotta', 'blocks/hardened_clay_stained_orange'],
    'block/blue_terracotta': ['block/blue_terracotta', 'blocks/hardened_clay_stained_blue'],
    'block/quartz_block_side': ['block/quartz_block_side', 'blocks/quartz_block_side'],
    'block/quartz_block_top': ['block/quartz_block_top', 'blocks/quartz_block_top'],
    'block/smooth_stone': ['block/smooth_stone', 'blocks/stone_slab_top'],
    'block/smooth_stone_slab_side': ['block/smooth_stone_slab_side', 'blocks/stone_slab_side'],
    'block/bricks': ['block/bricks', 'blocks/brick'],
    'block/stone_bricks': ['block/stone_bricks', 'blocks/stonebrick'],
    'block/mossy_stone_bricks': ['block/mossy_stone_bricks', 'blocks/stonebrick_mossy'],
    'block/cracked_stone_bricks': ['block/cracked_stone_bricks', 'blocks/stonebrick_cracked'],
    'block/nether_portal': ['block/nether_portal', 'blocks/portal'],
    'block/soul_sand': ['block/soul_sand', 'blocks/soul_sand'],
    'block/nether_quartz_ore': ['block/nether_quartz_ore', 'blocks/quartz_ore'],
    'block/nether_gold_ore': ['block/nether_gold_ore'],
    'block/nether_bricks': ['block/nether_bricks', 'blocks/nether_brick'],
    'block/nether_wart_stage0': ['block/nether_wart_stage0', 'blocks/nether_wart_stage_0'],
    'block/nether_wart_stage1': ['block/nether_wart_stage1', 'blocks/nether_wart_stage_1'],
    'block/nether_wart_stage2': ['block/nether_wart_stage2', 'blocks/nether_wart_stage_2'],
    'block/end_portal_frame_top': ['block/end_portal_frame_top', 'blocks/endframe_top'],
    'block/end_portal_frame_side': ['block/end_portal_frame_side', 'blocks/endframe_side'],
    'block/end_portal_frame_bottom': ['block/end_portal_frame_bottom', 'block/end_stone', 'blocks/end_stone'],
    'block/end_portal_frame_eye': ['block/end_portal_frame_eye', 'blocks/endframe_eye'],
    'block/end_stone': ['block/end_stone', 'blocks/end_stone'],
    'block/end_stone_bricks': ['block/end_stone_bricks', 'blocks/end_bricks'],
    'block/dragon_egg': ['block/dragon_egg', 'blocks/dragon_egg'],
    'block/iron_bars': ['block/iron_bars', 'blocks/iron_bars'],
    'item/ender_eye': ['item/ender_eye', 'items/ender_eye'],
    'item/end_crystal': ['item/end_crystal', 'items/end_crystal'],
    'item/dragon_breath': ['item/dragon_breath', 'items/dragon_breath'],
    # Items
    'item/wooden_pickaxe': ['item/wooden_pickaxe', 'items/wood_pickaxe'],
    'item/wooden_axe': ['item/wooden_axe', 'items/wood_axe'],
    'item/wooden_shovel': ['item/wooden_shovel', 'items/wood_shovel'],
    'item/wooden_sword': ['item/wooden_sword', 'items/wood_sword'],
    'item/wooden_hoe': ['item/wooden_hoe', 'items/wood_hoe'],
    'item/golden_pickaxe': ['item/golden_pickaxe', 'items/gold_pickaxe'],
    'item/golden_axe': ['item/golden_axe', 'items/gold_axe'],
    'item/golden_shovel': ['item/golden_shovel', 'items/gold_shovel'],
    'item/golden_sword': ['item/golden_sword', 'items/gold_sword'],
    'item/golden_hoe': ['item/golden_hoe', 'items/gold_hoe'],
    'item/golden_apple': ['item/golden_apple', 'items/apple_golden'],
    'item/golden_carrot': ['item/golden_carrot', 'items/carrot_golden'],
    'item/porkchop': ['item/porkchop', 'items/porkchop_raw'],
    'item/cooked_porkchop': ['item/cooked_porkchop', 'items/porkchop_cooked'],
    'item/beef': ['item/beef', 'items/beef_raw'],
    'item/cooked_beef': ['item/cooked_beef', 'items/beef_cooked'],
    'item/mutton': ['item/mutton', 'items/mutton_raw'],
    'item/cooked_mutton': ['item/cooked_mutton', 'items/mutton_cooked'],
    'item/chicken': ['item/chicken', 'items/chicken_raw'],
    'item/cooked_chicken': ['item/cooked_chicken', 'items/chicken_cooked'],
    'item/cod': ['item/cod', 'items/fish_cod_raw'],
    'item/cooked_cod': ['item/cooked_cod', 'items/fish_cod_cooked'],
    'item/wheat_seeds': ['item/wheat_seeds', 'items/seeds_wheat'],
    'item/sugar_cane': ['item/sugar_cane', 'items/reeds'],
    'item/melon_slice': ['item/melon_slice', 'items/melon'],
    'item/slime_ball': ['item/slime_ball', 'items/slimeball'],
    'item/redstone': ['item/redstone', 'items/redstone_dust'],
    'item/oak_door': ['item/oak_door', 'items/door_wood'],
    'item/spruce_door': ['item/spruce_door', 'items/door_spruce'],
    # Entities
    'entity/pig/pig_temperate': ['entity/pig/pig_temperate', 'entity/pig/pig'],
    'entity/cow/cow_temperate': ['entity/cow/cow_temperate', 'entity/cow/cow'],
    'entity/chicken/chicken_temperate': ['entity/chicken/chicken_temperate', 'entity/chicken'],
    'entity/player/wide/steve': ['entity/player/wide/steve', 'entity/steve'],
    'entity/projectiles/arrow': ['entity/projectiles/arrow', 'entity/arrow'],
    'entity/enchanting_table_book': ['entity/enchanting_table_book'],
    'entity/blaze': ['entity/blaze'],
    'entity/skeleton/wither_skeleton': ['entity/skeleton/wither_skeleton'],
    'entity/ghast/ghast': ['entity/ghast/ghast'],
    'entity/ghast/ghast_shooting': ['entity/ghast/ghast_shooting'],
    'entity/zombie_pigman': ['entity/zombie_pigman', 'entity/piglin/zombified_piglin'],
    'entity/enderman/enderman': ['entity/enderman/enderman'],
    'entity/enderman/enderman_eyes': ['entity/enderman/enderman_eyes'],
    # Environment
    'environment/celestial/sun': ['environment/celestial/sun', 'environment/sun'],
    'gui/title/edition': ['gui/title/edition'],
}

def resolve_path(p):
    candidates = [p]
    if p in ALIASES:
        candidates = ALIASES[p] + [p]
    if p.startswith('block/'):
        name = p[6:]
        candidates.append('blocks/' + name)
    elif p.startswith('item/'):
        name = p[5:]
        candidates.append('items/' + name)
    for c in candidates:
        full = 'assets/minecraft/textures/' + c + '.png'
        if full in namelist:
            return full
    return None

def load_img(p):
    full = resolve_path(p)
    if not full:
        return None
    return Image.open(io.BytesIO(z.read(full))).convert('RGBA')

def load_meta(p):
    full = resolve_path(p)
    if not full:
        return None
    meta_full = full + '.mcmeta'
    if meta_full in namelist:
        try:
            return json.loads(z.read(meta_full).decode('utf-8'))
        except Exception:
            return None
    return None

def to16(im):
    return im if im.size == (16, 16) else im.resize((16, 16), Image.NEAREST)

def uri(im):
    b = io.BytesIO()
    im.save(b, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()

BLOCK_TEX = '''stone dirt grass_block_top grass_block_side grass_block_side_overlay grass_block_snow cobblestone bedrock sand red_sand gravel clay
oak_log oak_log_top birch_log birch_log_top spruce_log spruce_log_top
oak_planks birch_planks spruce_planks
oak_leaves birch_leaves spruce_leaves
glass water_still lava_still snow ice packed_ice
coal_ore iron_ore gold_ore diamond_ore redstone_ore lapis_ore emerald_ore
deepslate deepslate_top deepslate_coal_ore deepslate_iron_ore deepslate_gold_ore deepslate_diamond_ore deepslate_redstone_ore
sandstone sandstone_top sandstone_bottom cactus_side cactus_top cactus_bottom dead_bush sugar_cane
short_grass fern dandelion poppy blue_orchid allium azure_bluet red_tulip orange_tulip oxeye_daisy cornflower lily_of_the_valley
crafting_table_front crafting_table_side crafting_table_top furnace_front furnace_front_on furnace_side furnace_top
torch bricks stone_bricks mossy_stone_bricks cracked_stone_bricks mossy_cobblestone bookshelf tnt_side tnt_top tnt_bottom
glowstone obsidian iron_block gold_block diamond_block coal_block emerald_block lapis_block redstone_block
pumpkin_side pumpkin_top jack_o_lantern carved_pumpkin melon_side melon_top smooth_stone smooth_stone_slab_side
farmland farmland_moist wheat_stage0 wheat_stage1 wheat_stage2 wheat_stage3 wheat_stage4 wheat_stage5 wheat_stage6 wheat_stage7
oak_sapling birch_sapling spruce_sapling oak_door_top oak_door_bottom ladder red_mushroom brown_mushroom
andesite diorite granite polished_andesite polished_diorite polished_granite terracotta
white_wool orange_wool magenta_wool light_blue_wool yellow_wool lime_wool pink_wool gray_wool light_gray_wool cyan_wool
purple_wool blue_wool brown_wool green_wool red_wool black_wool
white_stained_glass orange_stained_glass light_blue_stained_glass yellow_stained_glass lime_stained_glass pink_stained_glass
cyan_stained_glass purple_stained_glass blue_stained_glass red_stained_glass black_stained_glass green_stained_glass
white_concrete orange_concrete yellow_concrete lime_concrete light_blue_concrete blue_concrete red_concrete black_concrete gray_concrete
quartz_block_side quartz_block_top sea_lantern prismarine dark_prismarine prismarine_bricks oak_trapdoor
mud_bricks moss_block hay_block_side hay_block_top spruce_door_top spruce_door_bottom fire_0 lily_pad
destroy_stage_0 destroy_stage_1 destroy_stage_2 destroy_stage_3 destroy_stage_4 destroy_stage_5 destroy_stage_6 destroy_stage_7 destroy_stage_8 destroy_stage_9
bone_block_side bone_block_top magma netherrack glass_pane_top note_block jukebox_side jukebox_top
dark_oak_planks jungle_planks acacia_planks cherry_planks mangrove_planks
red_bed_head_up red_bed_head_east red_bed_head_west red_bed_foot_up red_bed_foot_south red_bed_foot_east red_bed_foot_west bed_head_north bed_down
redstone_dust_dot redstone_dust_line0 redstone_dust_line1 redstone_torch redstone_torch_off redstone_lamp redstone_lamp_on lever repeater repeater_on target_side target_top chiseled_sandstone cut_sandstone smooth_sandstone orange_terracotta blue_terracotta cobweb rail dirt_path_top dirt_path_side spawner bell_side bell_top bell_bottom enchanting_table_top enchanting_table_side enchanting_table_bottom anvil anvil_base anvil_side anvil_top hopper_top hopper_outside hopper_inside
comparator comparator_on observer_front observer_back observer_back_on observer_side observer_top piston_bottom piston_inner piston_side piston_top piston_top_sticky brewing_stand brewing_stand_base
cherry_log cherry_log_top cherry_leaves cherry_sapling pink_petals cherry_door_top cherry_door_bottom
nether_portal soul_sand nether_quartz_ore nether_gold_ore nether_bricks nether_wart_stage0 nether_wart_stage1 nether_wart_stage2
end_portal_frame_top end_portal_frame_side end_portal_frame_bottom end_portal_frame_eye end_stone end_stone_bricks dragon_egg iron_bars'''.split()

TRANSLUCENT_BLOCKS = {'water_still', 'ice', 'nether_portal'} | {
    n for n in BLOCK_TEX if 'stained_glass' in n or 'destroy_stage' in n
}

STATIC_MULTI_FRAME_BLOCKS = {'prismarine', 'observer_front', 'piston_bottom'}

def sanitize_tile_alpha(im, name, is_block=True):
    """
    Normalizes resource-pack PBR/shader emissive alpha channels (e.g. alpha=26 on redstone_lamp_on,
    alpha=51 on torch/sea_lantern/fire_0, alpha=128 on redstone_torch/repeater_on/observer_back_on, alpha=153 on jack_o_lantern)
    so WebGL alpha-testing (u_alphaTest = 0.35) never discards glowing pixels on solid or cutout blocks.
    """
    if is_block and name in TRANSLUCENT_BLOCKS:
        if name == 'ice':
            out = im.copy()
            out.putdata([(min(255, r + 12), min(255, g + 8), min(255, b + 6), max(a, 210)) for r, g, b, a in out.getdata()])
            return out
        if name == 'nether_portal':
            out = im.copy()
            out.putdata([(min(255, int(r * 1.25 + 25)), min(255, int(g * 1.15 + 10)), min(255, int(b * 1.3 + 35)), max(a, 185) if a > 0 else 0) for r, g, b, a in out.getdata()])
            return out
        return im
    out = im.copy()
    px = list(out.getdata())
    new_px = []
    for r, g, b, a in px:
        if a < 20:
            new_px.append((0, 0, 0, 0))
        elif is_block and name == 'redstone_lamp_on' and a < 255:
            # Boost shader-darkened emissive pixels on lit redstone lamp to warm glowing amber-gold
            nr = min(255, int(r * 1.45 + 35))
            ng = min(255, int(g * 1.65 + 45))
            nb = min(255, int(b * 1.35 + 20))
            new_px.append((nr, ng, nb, 255))
        elif is_block and name in ('redstone_torch', 'repeater_on', 'comparator_on', 'observer_back_on') and a < 255:
            # Boost shader-darkened emissive redstone torch/repeater/comparator/observer tips
            nr = min(255, int(r * 1.65 + 40))
            ng = min(255, int(g * 1.45 + 15))
            nb = min(255, int(b * 1.35 + 10))
            new_px.append((nr, ng, nb, 255))
        else:
            new_px.append((r, g, b, 255))
    out.putdata(new_px)
    return out

ITEM_TEX = '''stick coal charcoal raw_iron iron_ingot raw_gold gold_ingot diamond flint apple bread wheat wheat_seeds
porkchop cooked_porkchop beef cooked_beef mutton cooked_mutton chicken cooked_chicken rotten_flesh bone bone_meal
arrow bow bow_pulling_0 bow_pulling_1 bow_pulling_2 string gunpowder feather leather shears flint_and_steel
bucket water_bucket lava_bucket
wooden_pickaxe stone_pickaxe iron_pickaxe golden_pickaxe diamond_pickaxe
wooden_axe stone_axe iron_axe golden_axe diamond_axe
wooden_shovel stone_shovel iron_shovel golden_shovel diamond_shovel
wooden_sword stone_sword iron_sword golden_sword diamond_sword
wooden_hoe stone_hoe iron_hoe golden_hoe diamond_hoe
oak_door spruce_door sugar paper book sugar_cane clay_ball brick egg melon_slice cookie golden_apple snowball
iron_helmet iron_chestplate iron_leggings iron_boots diamond_helmet diamond_chestplate diamond_leggings diamond_boots
leather_helmet leather_chestplate leather_leggings leather_boots emerald lapis_lazuli redstone repeater pumpkin_pie
cooked_cod cod baked_potato potato carrot golden_carrot mushroom_stew bowl
pig_spawn_egg cow_spawn_egg sheep_spawn_egg chicken_spawn_egg zombie_spawn_egg skeleton_spawn_egg creeper_spawn_egg spider_spawn_egg bell enchanted_book hopper
comparator brewing_stand cherry_door pink_petals glass_bottle blaze_rod blaze_powder nether_wart glistering_melon_slice magma_cream
quartz gold_nugget ghast_tear ender_pearl ender_eye end_crystal dragon_breath nether_brick fire_charge'''.split()

PARTICLES = ['generic_%d' % i for i in range(8)] + ['big_smoke_%d' % i for i in range(12)] + \
    ['explosion_%d' % i for i in range(16)] + ['flame', 'lava', 'splash_0', 'splash_1', 'splash_2', 'splash_3',
    'critical_hit', 'heart', 'angry', 'bubble', 'note', 'damage', 'glint', 'effect_0', 'effect_1', 'effect_2',
    'leaf_0', 'leaf_1', 'leaf_2', 'enchanted_hit']

tiles = []
index = {}
anims = {}

stat_pack = 0
stat_fallback = 0

def add_tile_frames(name, frames, is_block=True):
    index[name] = len(tiles)
    if len(frames) > 1:
        anims[name] = len(frames)
    for f in frames:
        tiles.append(sanitize_tile_alpha(to16(f), name, is_block=is_block))

# 1. Blocks
print("Processing blocks...")
for n in BLOCK_TEX:
    im = load_img('block/' + n)
    if im:
        w, h = im.size
        m = load_meta('block/' + n)
        if h > w and n in STATIC_MULTI_FRAME_BLOCKS:
            add_tile_frames(n, [im.crop((0, 0, w, w))], is_block=True)
        elif h > w:
            frames = [im.crop((0, i * w, w, i * w + w)) for i in range(h // w)]
            m_anim = (m or {}).get('animation', {})
            order = m_anim.get('frames')
            if order:
                order = [f['index'] if isinstance(f, dict) else f for f in order]
                frames = [frames[i] for i in order if 0 <= i < len(frames)] or frames
            add_tile_frames(n, frames, is_block=True)
        else:
            add_tile_frames(n, [im], is_block=True)
        stat_pack += 1
    else:
        # Fallback
        frames = get_orig_tile_frames(n)
        add_tile_frames(n, frames, is_block=True)
        stat_fallback += 1

# 2. Items
print("Processing items...")
for n in ITEM_TEX:
    key = 'i_' + n
    im = load_img('item/' + n)
    if im:
        w, h = im.size
        if h > w:
            im = im.crop((0, 0, w, w))
        add_tile_frames(key, [im], is_block=False)
        stat_pack += 1
    else:
        frames = get_orig_tile_frames(key)
        add_tile_frames(key, frames, is_block=False)
        stat_fallback += 1

# Compose tinted potion sprites from item/potion + item/potion_overlay
potion_bottle = load_img('item/potion')
potion_overlay = load_img('item/potion_overlay')
POTION_TINTS = [
    ('water_bottle', (56, 93, 214)),
    ('awkward_potion', (78, 68, 224)),
    ('potion_healing', (248, 36, 35)),
    ('potion_fire_resistance', (228, 154, 58)),
    ('potion_swiftness', (124, 175, 198)),
    ('potion_night_vision', (36, 52, 185)),
]
for p_key, (tr, tg, tb) in POTION_TINTS:
    if potion_bottle and potion_overlay:
        comp = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
        ov = potion_overlay.copy()
        ov_px = []
        for r, g, b, a in ov.getdata():
            if a < 20:
                ov_px.append((0, 0, 0, 0))
            else:
                ov_px.append((
                    min(255, int(r * tr / 255 * 1.15)),
                    min(255, int(g * tg / 255 * 1.15)),
                    min(255, int(b * tb / 255 * 1.15)),
                    255
                ))
        ov.putdata(ov_px)
        comp = Image.alpha_composite(comp, ov)
        comp = Image.alpha_composite(comp, potion_bottle)
        add_tile_frames('i_' + p_key, [comp], is_block=False)
        stat_pack += 1
    else:
        add_tile_frames('i_' + p_key, [Image.new('RGBA', (16, 16), (tr, tg, tb, 255))], is_block=False)

# Compose tinted spawn egg icons for Nether & Villager mobs from item/spawn_egg + item/spawn_egg_overlay
egg_base = load_img('item/spawn_egg')
egg_overlay = load_img('item/spawn_egg_overlay')
SPAWN_EGG_TINTS = [
    ('villager_spawn_egg', (86, 60, 51), (189, 139, 114)),
    ('blaze_spawn_egg', (246, 178, 1), (255, 248, 126)),
    ('wither_skeleton_spawn_egg', (20, 20, 20), (71, 77, 77)),
    ('ghast_spawn_egg', (249, 249, 249), (188, 188, 188)),
    ('zombified_piglin_spawn_egg', (234, 147, 147), (76, 113, 41)),
    ('enderman_spawn_egg', (22, 22, 22), (204, 0, 250)),
]
for egg_key, (br, bg, bb), (sr, sg, sb) in SPAWN_EGG_TINTS:
    if egg_base and egg_overlay:
        comp = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
        b_im = to16(egg_base).copy()
        o_im = to16(egg_overlay).copy()
        b_im.putdata([(0, 0, 0, 0) if a < 20 else (min(255, int(r * br / 255 * 1.1)), min(255, int(g * bg / 255 * 1.1)), min(255, int(b * bb / 255 * 1.1)), 255) for r, g, b, a in b_im.getdata()])
        o_im.putdata([(0, 0, 0, 0) if a < 20 else (min(255, int(r * sr / 255 * 1.1)), min(255, int(g * sg / 255 * 1.1)), min(255, int(b * sb / 255 * 1.1)), 255) for r, g, b, a in o_im.getdata()])
        comp = Image.alpha_composite(comp, b_im)
        comp = Image.alpha_composite(comp, o_im)
        add_tile_frames('i_' + egg_key, [comp], is_block=False)
        stat_pack += 1
    else:
        add_tile_frames('i_' + egg_key, [Image.new('RGBA', (16, 16), (br, bg, bb, 255))], is_block=False)

# Compose 16x16 i_shield icon from entity/shield_base_nopattern front plate (12x22 at x=1..13, y=1..23)
shield_ent = load_img('entity/shield_base_nopattern') or load_img('entity/shield_base')
if shield_ent:
    front_plate = shield_ent.crop((1, 1, 13, 23))
    scaled_plate = front_plate.resize((10, 16), Image.NEAREST)
    sh_icon = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    sh_icon.paste(scaled_plate, (3, 0))
    add_tile_frames('i_shield', [sh_icon], is_block=False)
    stat_pack += 1
else:
    add_tile_frames('i_shield', [Image.new('RGBA', (16, 16), (160, 120, 70, 255))], is_block=False)
    stat_fallback += 1

# 3. Particles
print("Processing particles...")
for n in PARTICLES:
    key = 'p_' + n
    im = load_img('particle/' + n)
    if im:
        add_tile_frames(key, [im], is_block=False)
        stat_pack += 1
    else:
        frames = get_orig_tile_frames(key)
        add_tile_frames(key, frames, is_block=False)
        stat_fallback += 1

# 4. Composed Tiles
print("Processing composed tiles (chest, grass side)...")
chest = load_img('entity/chest/normal')
if chest:
    def chest_tile(side_x, with_latch):
        t = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
        lid = chest.crop((side_x, 14, side_x + 14, 19))
        base = chest.crop((side_x, 33, side_x + 14, 43))
        t.paste(lid, (1, 2))
        t.paste(base, (1, 6))
        if with_latch:
            latch = chest.crop((1, 1, 3, 5))
            t.paste(latch, (7, 4))
        return t
    top = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    top.paste(chest.crop((28, 0, 42, 14)), (1, 1))
    add_tile_frames('chest_top', [top], is_block=True)
    add_tile_frames('chest_front', [chest_tile(42, True)], is_block=True)
    add_tile_frames('chest_side', [chest_tile(0, False)], is_block=True)
    stat_pack += 3
else:
    for cn in ['chest_top', 'chest_front', 'chest_side']:
        add_tile_frames(cn, get_orig_tile_frames(cn), is_block=True)
        stat_fallback += 1

# Composite dirt_path_side over dirt so there are no transparent pixels
if 'dirt_path_side' in index and 'dirt' in index:
    dps_idx = index['dirt_path_side']
    dirt_idx = index['dirt']
    comp_dps = tiles[dirt_idx].copy()
    comp_dps.paste(tiles[dps_idx], (0, 0), tiles[dps_idx])
    tiles[dps_idx] = comp_dps

gs = load_img('block/grass_block_side')
if gs:
    add_tile_frames('grass_side_base', [gs], is_block=True)
    stat_pack += 1
else:
    add_tile_frames('grass_side_base', get_orig_tile_frames('grass_side_base'), is_block=True)
    stat_fallback += 1

# Compose 8-frame animated starry void end_portal tile from entity/end_portal (used as fallback/particle & animated tile)
ep_im = load_img('entity/end_portal')
if ep_im:
    ep_frames = []
    for f_idx in range(8):
        ep_crop = Image.new('RGBA', (16, 16), (3, 9, 14, 255))
        ep_px = []
        for y_px in range(16):
            for x_px in range(16):
                # Sample multiple drifted layers from the 256x256 starfield
                s1 = ep_im.getpixel(((x_px * 7 + f_idx * 13) % 256, (y_px * 7 + f_idx * 9) % 256))[0]
                s2 = ep_im.getpixel(((x_px * 11 - f_idx * 7) % 256, (y_px * 11 + f_idx * 17) % 256))[0]
                s3 = ep_im.getpixel(((x_px * 17 + f_idx * 5) % 256, (y_px * 17 - f_idx * 11) % 256))[0]
                r_c = min(255, int(4 + s1 * 0.35 + s2 * 0.85 + s3 * 0.25))
                g_c = min(255, int(10 + s1 * 0.95 + s2 * 0.35 + s3 * 1.15))
                b_c = min(255, int(16 + s1 * 1.15 + s2 * 1.05 + s3 * 1.45))
                ep_px.append((r_c, g_c, b_c, 255))
        ep_crop.putdata(ep_px)
        ep_frames.append(ep_crop)
    add_tile_frames('end_portal', ep_frames, is_block=True)
    stat_pack += 1
else:
    add_tile_frames('end_portal', [Image.new('RGBA', (16, 16), (12, 16, 32, 255))], is_block=True)
    stat_fallback += 1

if 'i_ender_eye' in index:
    index['i_eye_of_ender'] = index['i_ender_eye']

add_tile_frames('white', [Image.new('RGBA', (16, 16), (255, 255, 255, 255))], is_block=True)

# 5. Build Strip
print(f"Total tiles assembled: {len(tiles)}")
strip = Image.new('RGBA', (16, 16 * len(tiles)))
for i, t in enumerate(tiles):
    strip.paste(t, (0, i * 16))

# 6. IMAGES
print("Processing images (GUI, entities, environment)...")
IMAGES = {
    'font': 'font/ascii',
    'hotbar': 'gui/sprites/hud/hotbar', 'hotbar_sel': 'gui/sprites/hud/hotbar_selection',
    'crosshair': 'gui/sprites/hud/crosshair',
    'heart_container': 'gui/sprites/hud/heart/container', 'heart_container_blink': 'gui/sprites/hud/heart/container_blinking',
    'heart_full': 'gui/sprites/hud/heart/full', 'heart_half': 'gui/sprites/hud/heart/half',
    'heart_full_blink': 'gui/sprites/hud/heart/full_blinking', 'heart_half_blink': 'gui/sprites/hud/heart/half_blinking',
    'heart_poison_full': 'gui/sprites/hud/heart/poisoned_full',
    'heart_wither_full': 'gui/sprites/hud/heart/withered_full',
    'heart_wither_half': 'gui/sprites/hud/heart/withered_half',
    'heart_wither_full_blink': 'gui/sprites/hud/heart/withered_full_blinking',
    'heart_wither_half_blink': 'gui/sprites/hud/heart/withered_half_blinking',
    'food_empty': 'gui/sprites/hud/food_empty', 'food_full': 'gui/sprites/hud/food_full', 'food_half': 'gui/sprites/hud/food_half',
    'food_empty_hunger': 'gui/sprites/hud/food_empty_hunger', 'food_full_hunger': 'gui/sprites/hud/food_full_hunger', 'food_half_hunger': 'gui/sprites/hud/food_half_hunger',
    'armor_empty': 'gui/sprites/hud/armor_empty', 'armor_full': 'gui/sprites/hud/armor_full', 'armor_half': 'gui/sprites/hud/armor_half',
    'air': 'gui/sprites/hud/air', 'air_bursting': 'gui/sprites/hud/air_bursting', 'air_empty': 'gui/sprites/hud/air_empty',
    'xp_bg': 'gui/sprites/hud/experience_bar_background', 'xp_fg': 'gui/sprites/hud/experience_bar_progress',
    'inventory': 'gui/container/inventory', 'crafting_table': 'gui/container/crafting_table',
    'furnace': 'gui/container/furnace', 'generic_54': 'gui/container/generic_54',
    'enchanting_table_gui': 'gui/container/enchanting_table',
    'enchant_slot': 'gui/sprites/container/enchanting_table/enchantment_slot',
    'enchant_slot_dis': 'gui/sprites/container/enchanting_table/enchantment_slot_disabled',
    'enchant_slot_hl': 'gui/sprites/container/enchanting_table/enchantment_slot_highlighted',
    'enchant_lvl_1': 'gui/sprites/container/enchanting_table/level_1',
    'enchant_lvl_2': 'gui/sprites/container/enchanting_table/level_2',
    'enchant_lvl_3': 'gui/sprites/container/enchanting_table/level_3',
    'enchant_lvl_1_dis': 'gui/sprites/container/enchanting_table/level_1_disabled',
    'enchant_lvl_2_dis': 'gui/sprites/container/enchanting_table/level_2_disabled',
    'enchant_lvl_3_dis': 'gui/sprites/container/enchanting_table/level_3_disabled',
    'slot_lapis': 'item/empty_slot_lapis_lazuli',
    'anvil_gui': 'gui/container/anvil',
    'hopper_gui': 'gui/container/hopper',
    'brewing_stand_gui': 'gui/container/brewing_stand',
    'brew_progress': 'gui/sprites/container/brewing_stand/brew_progress',
    'brew_bubbles': 'gui/sprites/container/brewing_stand/bubbles',
    'brew_fuel': 'gui/sprites/container/brewing_stand/fuel_length',
    'effect_bg': 'gui/sprites/hud/effect_background',
    'eff_instant_health': 'mob_effect/instant_health',
    'eff_fire_resistance': 'mob_effect/fire_resistance',
    'eff_speed': 'mob_effect/speed',
    'eff_night_vision': 'mob_effect/night_vision',
    'eff_wither': 'mob_effect/wither',
    'anvil_error': 'gui/sprites/container/anvil/error',
    'anvil_field': 'gui/sprites/container/anvil/text_field',
    'anvil_field_dis': 'gui/sprites/container/anvil/text_field_disabled',
    'enchant_book': 'entity/enchanting_table_book',

    'tab_items': 'gui/container/creative_inventory/tab_items', 'tab_item_search': 'gui/container/creative_inventory/tab_item_search',
    'tab_inventory': 'gui/container/creative_inventory/tab_inventory',
    'scroller': 'gui/sprites/container/creative_inventory/scroller', 'scroller_disabled': 'gui/sprites/container/creative_inventory/scroller_disabled',
    'burn_progress': 'gui/sprites/container/furnace/burn_progress', 'lit_progress': 'gui/sprites/container/furnace/lit_progress',
    'slot_helmet': 'gui/sprites/container/slot/helmet', 'slot_chestplate': 'gui/sprites/container/slot/chestplate',
    'slot_leggings': 'gui/sprites/container/slot/leggings', 'slot_boots': 'gui/sprites/container/slot/boots',
    'slot_shield': 'item/empty_armor_slot_shield',
    'hotbar_offhand_left': 'gui/sprites/hud/hotbar_offhand_left',
    'shield': 'entity/shield_base_nopattern',
    'button': 'gui/sprites/widget/button', 'button_hl': 'gui/sprites/widget/button_highlighted', 'button_dis': 'gui/sprites/widget/button_disabled',
    'slider': 'gui/sprites/widget/slider', 'slider_handle': 'gui/sprites/widget/slider_handle', 'slider_handle_hl': 'gui/sprites/widget/slider_handle_highlighted',
    'text_field': 'gui/sprites/widget/text_field', 'text_field_hl': 'gui/sprites/widget/text_field_highlighted',
    'rb_button': 'gui/sprites/recipe_book/button', 'rb_button_hl': 'gui/sprites/recipe_book/button_highlighted',
    'logo': 'gui/title/minecraft', 'edition': 'gui/title/edition',
    'toast': 'gui/sprites/toast/advancement', 'menu_bg': 'gui/menu_background', 'options_bg': 'gui/inworld_menu_background',
    'header_sep': 'gui/header_separator', 'footer_sep': 'gui/footer_separator',
    'sun': 'environment/celestial/sun', 'clouds': 'environment/clouds', 'rain': 'environment/rain', 'snowfall': 'environment/snow',
    'grass_color': 'colormap/grass', 'foliage_color': 'colormap/foliage',
    'pig': 'entity/pig/pig_temperate', 'cow': 'entity/cow/cow_temperate', 'sheep': 'entity/sheep/sheep',
    'sheep_wool': 'entity/sheep/sheep_wool', 'chicken': 'entity/chicken/chicken_temperate',
    'zombie': 'entity/zombie/zombie', 'skeleton': 'entity/skeleton/skeleton', 'creeper': 'entity/creeper/creeper',
    'spider': 'entity/spider/spider', 'spider_eyes': 'entity/spider/spider_eyes', 'steve': 'entity/player/wide/steve',
    'blaze': 'entity/blaze',
    'wither_skeleton': 'entity/skeleton/wither_skeleton',
    'ghast': 'entity/ghast/ghast',
    'ghast_shooting': 'entity/ghast/ghast_shooting',
    'zombified_piglin': 'entity/zombie_pigman',
    'enderman': 'entity/enderman/enderman',
    'enderman_eyes': 'entity/enderman/enderman_eyes',
    'end_crystal': 'entity/end_crystal/end_crystal',
    'ender_dragon': 'entity/enderdragon/dragon',
    'dragon_eyes': 'entity/enderdragon/dragon_eyes',
    'dragon_fireball': 'entity/enderdragon/dragon_fireball',
    'end_beam': 'entity/end_gateway_beam',
    'end_portal': 'entity/end_portal',
    'boss_bar_bg': 'gui/sprites/boss_bar/pink_background',
    'boss_bar_fg': 'gui/sprites/boss_bar/pink_progress',
    'arrow_entity': 'entity/projectiles/arrow',
    'shadow': 'misc/shadow', 'vignette': 'misc/vignette', 'underwater': 'misc/underwater', 'pumpkinblur': 'misc/pumpkinblur',
}
for i in range(1, 8):
    IMAGES['tab_top_selected_%d' % i] = 'gui/sprites/container/creative_inventory/tab_top_selected_%d' % i
    IMAGES['tab_top_unselected_%d' % i] = 'gui/sprites/container/creative_inventory/tab_top_unselected_%d' % i

def sanitize_image(im, key, path):
    if key == 'vignette':
        # Convert Minecraft's inverted white-corner mask (intended for GL_ZERO, GL_ONE_MINUS_SRC_COLOR)
        # into a true black-corner alpha vignette for Canvas2D overlay rendering.
        out = im.copy()
        out.putdata([(0, 0, 0, max(r, g, b)) for r, g, b, a in out.getdata()])
        return out
    if key == 'enchant_book':
        out = im.copy()
        # Fill transparent back-faces of page blocks (x=1..5 and x=19..23, y=11..18) with page texture (x=13..17, y=11..18)
        page_patch = out.crop((13, 11, 18, 19))
        out.paste(page_patch, (1, 11))
        out.paste(page_patch, (19, 11))
        out.putdata([(0, 0, 0, 0) if a < 20 else (r, g, b, 255) for r, g, b, a in out.getdata()])
        return out
    if key == 'shield':
        out = im.copy()
        w, h = out.size
        px = out.load()
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a < 20 or (x >= 26 and r == 0 and g == 0 and b == 0):
                    px[x, y] = (0, 0, 0, 0)
                else:
                    px[x, y] = (r, g, b, 255)
        return out
    if key in ('button', 'button_hl'):
        out = im.copy()
        w, h = out.size
        px = out.load()
        for y in range(4, h - 4):
            for x in range(4, w - 4):
                r, g, b, a = px[x, y]
                if a < 200:
                    if key == 'button':
                        px[x, y] = (86, 72, 62, 255) if y == 4 else ((52, 42, 36, 255) if y == h - 5 else (68, 56, 48, 255))
                    else:
                        px[x, y] = (110, 122, 148, 255) if y == 4 else ((68, 76, 96, 255) if y == h - 5 else (88, 98, 122, 255))
        return out
    if key == 'toast':
        out = Image.new('RGBA', im.size, (94, 89, 87, 255))
        w, h = out.size
        px = out.load()
        for y in range(h):
            for x in range(w):
                if x == 0 or x == w - 1 or y == 0 or y == h - 1:
                    px[x, y] = (142, 140, 136, 255)
                elif x == 1 or x == w - 2 or y == 1 or y == h - 2:
                    px[x, y] = (89, 78, 71, 255)
                else:
                    px[x, y] = (94, 89, 87, 255)
        for cx, cy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
            px[cx, cy] = (0, 0, 0, 0)
        return out
    if path.startswith('entity/') and key not in ('spider_eyes', 'enderman_eyes', 'dragon_eyes'):
        out = im.copy()
        out.putdata([(0, 0, 0, 0) if a < 20 else (r, g, b, 255) for r, g, b, a in out.getdata()])
        return out
    return im

# Check moon phases
moon_phases_img = None
if 'assets/minecraft/textures/environment/moon_phases.png' in namelist:
    moon_phases_img = Image.open(io.BytesIO(z.read('assets/minecraft/textures/environment/moon_phases.png'))).convert('RGBA')

img_stat_pack = 0
img_stat_fallback = 0
images = {}

# Moon phases
for i, ph in enumerate(['full_moon', 'waning_gibbous', 'third_quarter', 'waning_crescent', 'new_moon', 'waxing_crescent', 'first_quarter', 'waxing_gibbous']):
    key = 'moon%d' % i
    im = load_img('environment/celestial/moon/' + ph)
    if im:
        images[key] = uri(im)
        img_stat_pack += 1
    elif moon_phases_img:
        mw, mh = moon_phases_img.size
        cw, ch = mw // 4, mh // 2
        col, row = i % 4, i // 4
        crop_phase = moon_phases_img.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch))
        images[key] = uri(crop_phase)
        img_stat_pack += 1
    elif key in orig_images:
        images[key] = orig_images[key]
        img_stat_fallback += 1

# Player 3D Armor layer textures (leather, iron, diamond: layer_1 & layer_2)
for mat in ['iron', 'diamond']:
    for layer in [1, 2]:
        key = f'armor_{mat}_{layer}'
        im = load_img(f'models/armor/{mat}_layer_{layer}')
        if im:
            out = im.copy()
            out.putdata([(0, 0, 0, 0) if a < 20 else (r, g, b, 255) for r, g, b, a in out.getdata()])
            images[key] = uri(out)
            img_stat_pack += 1

for layer in [1, 2]:
    key = f'armor_leather_{layer}'
    base_im = load_img(f'models/armor/leather_layer_{layer}')
    ov_im = load_img(f'models/armor/leather_layer_{layer}_overlay')
    if base_im:
        out = Image.new('RGBA', base_im.size, (0, 0, 0, 0))
        tinted = base_im.copy()
        t_px = []
        for r, g, b, a in tinted.getdata():
            if a < 20:
                t_px.append((0, 0, 0, 0))
            else:
                t_px.append((
                    min(255, int(r * 160 / 255 * 1.15)),
                    min(255, int(g * 101 / 255 * 1.15)),
                    min(255, int(b * 64 / 255 * 1.15)),
                    255
                ))
        tinted.putdata(t_px)
        out = Image.alpha_composite(out, tinted)
        if ov_im:
            ov_clean = ov_im.copy()
            ov_clean.putdata([(0, 0, 0, 0) if a < 20 else (r, g, b, 255) for r, g, b, a in ov_clean.getdata()])
            out = Image.alpha_composite(out, ov_clean)
        images[key] = uri(out)
        img_stat_pack += 1

# Villager composite texture (base + plains outfit)
v_base = load_img('entity/villager/villager')
v_plains = load_img('entity/villager/type/plains')
if v_base:
    if v_plains and v_plains.size == v_base.size:
        v_base = Image.alpha_composite(v_base, v_plains)
    images['villager'] = uri(sanitize_image(v_base, 'villager', 'entity/villager/villager'))
    img_stat_pack += 1
    for prof_key, prof_tex in [('villager_farmer', 'farmer'), ('villager_librarian', 'librarian'), ('villager_smith', 'weaponsmith')]:
        v_prof = load_img('entity/villager/profession/' + prof_tex)
        if v_prof and v_prof.size == v_base.size:
            comp = Image.alpha_composite(v_base, v_prof)
            images[prof_key] = uri(sanitize_image(comp, prof_key, 'entity/villager/villager'))
            img_stat_pack += 1

# Other images
for k, p in IMAGES.items():
    im = load_img(p)
    if im:
        images[k] = uri(sanitize_image(im, k, p))
        img_stat_pack += 1
    elif k in orig_images:
        b64 = orig_images[k].split(',', 1)[1]
        im_orig = Image.open(io.BytesIO(base64.b64decode(b64))).convert('RGBA')
        images[k] = uri(sanitize_image(im_orig, k, p))
        img_stat_fallback += 1
    else:
        print(f"Warning: image {k} ({p}) missing in both pack and fallback!")

print(f"Tiles: {stat_pack} from pack, {stat_fallback} fallback")
print(f"Images: {img_stat_pack} from pack, {img_stat_fallback} fallback")

# 7. Write to game/js/assets.js
js = '// Generated from Pixel Perfection Legacy with fallback to original assets.\n'
js += 'const ASSETS = window.ASSETS = ' + json.dumps({
    'strip': uri(strip),
    'tiles': index,
    'anims': anims,
    'count': len(tiles),
    'images': images,
}, separators=(',', ':')) + ';\n'

with open(OUT_JS, 'w', encoding='utf-8') as f:
    f.write(js)

print(f"Successfully generated {OUT_JS} (size: {len(js)} bytes)")
