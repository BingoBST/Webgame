# Builds game/js/assets.js from a Minecraft resource pack (e.g. Pixel Perfection Legacy)
# with automatic fallback to original vanilla assets for any missing textures.

import base64
import io
import json
import os
import sys
import zipfile
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
HTG_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, '..'))
DEFAULT_PACK = os.path.join(HTG_DIR, 'Pixel Perfection Legacy 13.21.2.zip')
if not os.path.exists(DEFAULT_PACK):
    DEFAULT_PACK = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..', 'Pixel Perfection Legacy 13.21.2.zip'))
PACK_ZIP = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PACK
FALLBACK_JS = os.path.join(SCRIPT_DIR, '..', 'game', 'js', 'assets.vanilla.js')
OUT_JS = os.path.join(SCRIPT_DIR, '..', 'game', 'js', 'assets.js')

print(f"Loading resource pack: {PACK_ZIP}")
if not os.path.exists(PACK_ZIP):
    sys.exit(f"Error: Resource pack not found at {PACK_ZIP}")

if not os.path.exists(FALLBACK_JS):
    sys.exit(f"Error: Fallback assets not found at {FALLBACK_JS}")

# Load Fallback Assets
with open(FALLBACK_JS, 'r', encoding='utf-8') as f:
    orig_text = f.read()

orig_assets = json.loads(orig_text.split('window.ASSETS = ', 1)[1].rstrip(';\r\n'))
orig_strip_b64 = orig_assets['strip'].split(',', 1)[1]
orig_strip = Image.open(io.BytesIO(base64.b64decode(orig_strip_b64))).convert('RGBA')
orig_tiles = orig_assets['tiles']      # name -> index
orig_anims = orig_assets['anims']      # name -> frame count
orig_images = orig_assets['images']    # name -> data URI

def get_orig_tile_frames(name):
    if name not in orig_tiles:
        return [Image.new('RGBA', (16, 16), (255, 255, 255, 255))]
    idx = orig_tiles[name]
    cnt = orig_anims.get(name, 1)
    return [orig_strip.crop((0, (idx + f) * 16, 16, (idx + f + 1) * 16)) for f in range(cnt)]

z = zipfile.ZipFile(PACK_ZIP)
namelist = set(z.namelist())
T = 'assets/minecraft/textures/'

ALIASES = {
    'block/wheat_stage7': ['block/wheat_stage7', 'block/wheat_stage_full_7'],
    'environment/celestial/sun': ['environment/celestial/sun', 'environment/sun'],
    'entity/pig/pig_temperate': ['entity/pig/pig_temperate', 'entity/pig/pig'],
    'entity/cow/cow_temperate': ['entity/cow/cow_temperate', 'entity/cow/cow'],
    'entity/chicken/chicken_temperate': ['entity/chicken/chicken_temperate', 'entity/chicken/chicken', 'entity/chicken'],
    'entity/sheep/sheep_wool': ['entity/sheep/sheep_wool', 'entity/sheep/sheep_fur'],
    'entity/spider/spider_eyes': ['entity/spider/spider_eyes', 'entity/spider_eyes'],
    'gui/sprites/container/slot/helmet': ['gui/sprites/container/slot/helmet', 'item/empty_armor_slot_helmet'],
    'gui/sprites/container/slot/chestplate': ['gui/sprites/container/slot/chestplate', 'item/empty_armor_slot_chestplate'],
    'gui/sprites/container/slot/leggings': ['gui/sprites/container/slot/leggings', 'item/empty_armor_slot_leggings'],
    'gui/sprites/container/slot/boots': ['gui/sprites/container/slot/boots', 'item/empty_armor_slot_boots'],
    'gui/sprites/hud/air_empty': ['gui/sprites/hud/air_empty', 'gui/sprites/hud/air_bursting', 'gui/sprites/hud/air'],
}

def resolve_path(path):
    candidates = ALIASES.get(path, [path])
    for c in candidates:
        full = T + c + '.png'
        if full in namelist:
            return full
    return None

def load_img(path):
    rp = resolve_path(path)
    if rp:
        return Image.open(io.BytesIO(z.read(rp))).convert('RGBA')
    return None

def load_meta(path):
    rp = resolve_path(path)
    if rp:
        meta_name = rp + '.mcmeta'
        if meta_name in namelist:
            try:
                return json.loads(z.read(meta_name))
            except Exception:
                return None
    return None

def to16(im):
    if im.size == (16, 16):
        return im
    if im.size[0] < 16:
        return im.resize((16, 16), Image.NEAREST)
    return im.resize((16, 16), Image.BOX)

def uri(im):
    b = io.BytesIO()
    im.save(b, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()

BLOCK_TEX = '''stone cobblestone dirt grass_block_top grass_block_side grass_block_side_overlay grass_block_snow
bedrock sand gravel sandstone sandstone_top sandstone_bottom red_sand
oak_log oak_log_top oak_planks oak_leaves birch_log birch_log_top birch_planks birch_leaves
spruce_log spruce_log_top spruce_planks spruce_leaves glass
coal_ore iron_ore gold_ore diamond_ore redstone_ore lapis_ore emerald_ore copper_ore
deepslate deepslate_top deepslate_coal_ore deepslate_iron_ore deepslate_gold_ore deepslate_diamond_ore deepslate_redstone_ore
water_still lava_still snow ice packed_ice clay cactus_side cactus_top cactus_bottom sugar_cane dead_bush short_grass fern
dandelion poppy cornflower oxeye_daisy azure_bluet allium blue_orchid red_tulip orange_tulip lily_of_the_valley
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
cherry_log cherry_log_top cherry_leaves cherry_sapling pink_petals cherry_door_top cherry_door_bottom'''.split()

TRANSLUCENT_BLOCKS = {'water_still', 'ice'} | {
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
comparator brewing_stand cherry_door pink_petals glass_bottle blaze_rod blaze_powder nether_wart glistering_melon_slice magma_cream'''.split()

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
                frames = [frames[i] for i in order]
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
    if path.startswith('entity/') and key != 'spider_eyes':
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
