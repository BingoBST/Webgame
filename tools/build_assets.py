# Builds game/js/assets.js from the official Minecraft 26.2 jar textures.
# Usage: py tools/build_assets.py <path/to/26.2.jar>   (or set the MC_JAR environment variable)
import base64, io, json, os, sys, zipfile
from PIL import Image

JAR = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('MC_JAR')
if not JAR:
    sys.exit('Usage: py tools/build_assets.py <path/to/26.2.jar>  (or set MC_JAR)')
OUT = os.path.join(os.path.dirname(__file__), '..', 'game', 'js', 'assets.js')
T = 'assets/minecraft/textures/'

z = zipfile.ZipFile(JAR)

def load(path):
    return Image.open(io.BytesIO(z.read(T + path + '.png'))).convert('RGBA')

def meta(path):
    try:
        return json.loads(z.read(T + path + '.png.mcmeta'))
    except KeyError:
        return None

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
red_bed_head_up red_bed_head_east red_bed_head_west red_bed_foot_up red_bed_foot_south red_bed_foot_east red_bed_foot_west bed_head_north bed_down'''.split()

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
leather_helmet leather_chestplate leather_leggings leather_boots emerald lapis_lazuli redstone pumpkin_pie
cooked_cod cod baked_potato potato carrot golden_carrot mushroom_stew bowl
pig_spawn_egg cow_spawn_egg sheep_spawn_egg chicken_spawn_egg zombie_spawn_egg skeleton_spawn_egg creeper_spawn_egg spider_spawn_egg'''.split()

PARTICLES = ['generic_%d' % i for i in range(8)] + ['big_smoke_%d' % i for i in range(12)] + \
    ['explosion_%d' % i for i in range(16)] + ['flame', 'lava', 'splash_0', 'splash_1', 'splash_2', 'splash_3',
    'critical_hit', 'heart', 'angry', 'bubble', 'note', 'damage', 'glint', 'effect_0', 'effect_1', 'effect_2',
    'leaf_0', 'leaf_1', 'leaf_2']

tiles = []      # list of 16x16 RGBA images
index = {}      # name -> first layer
anims = {}      # name -> frame count

def to16(im):
    if im.size == (16, 16):
        return im
    if im.size[0] < 16:
        return im.resize((16, 16), Image.NEAREST)
    return im.resize((16, 16), Image.BOX)

def add_tile(name, im):
    w, h = im.size
    m = None
    if h > w:
        frames = [im.crop((0, i * w, w, i * w + w)) for i in range(h // w)]
        m = (meta_cache.get(name) or {}).get('animation', {})
        order = m.get('frames')
        if order:
            order = [f['index'] if isinstance(f, dict) else f for f in order]
            frames = [frames[i] for i in order]
        index[name] = len(tiles)
        anims[name] = len(frames)
        for f in frames:
            tiles.append(to16(f))
    else:
        index[name] = len(tiles)
        tiles.append(to16(im))

meta_cache = {}
missing = []
for n in BLOCK_TEX:
    try:
        meta_cache[n] = meta('block/' + n)
        add_tile(n, load('block/' + n))
    except KeyError:
        missing.append('block/' + n)
for n in ITEM_TEX:
    try:
        add_tile('i_' + n, load('item/' + n))
    except KeyError:
        missing.append('item/' + n)
for n in PARTICLES:
    try:
        add_tile('p_' + n, load('particle/' + n))
    except KeyError:
        missing.append('particle/' + n)

# --- composed tiles -------------------------------------------------------
chest = load('entity/chest/normal')
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
add_tile('chest_top', top)
add_tile('chest_front', chest_tile(42, True))
add_tile('chest_side', chest_tile(0, False))

# grass side base: dirt everywhere the overlay would be drawn, base keeps dirt
gs = load('block/grass_block_side')
add_tile('grass_side_base', gs)

# solid white tile (for untextured things like the selection overlay / sheep wool undercoat fallback)
add_tile('white', Image.new('RGBA', (16, 16), (255, 255, 255, 255)))

if missing:
    print('MISSING:', missing)

strip = Image.new('RGBA', (16, 16 * len(tiles)))
for i, t in enumerate(tiles):
    strip.paste(t, (0, i * 16))

def uri(im):
    b = io.BytesIO()
    im.save(b, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()

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
for i, ph in enumerate(['full_moon', 'waning_gibbous', 'third_quarter', 'waning_crescent', 'new_moon', 'waxing_crescent', 'first_quarter', 'waxing_gibbous']):
    IMAGES['moon%d' % i] = 'environment/celestial/moon/' + ph

images = {}
for k, p in IMAGES.items():
    try:
        images[k] = uri(load(p))
    except KeyError:
        missing.append(p)
        print('MISSING image', p)

js = '// Generated by tools/build_assets.py from the official Minecraft textures. Do not edit.\n'
js += 'window.ASSETS = ' + json.dumps({
    'strip': uri(strip), 'tiles': index, 'anims': anims, 'count': len(tiles), 'images': images,
}, separators=(',', ':')) + ';\n'
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'w', encoding='utf-8').write(js)
print('tiles', len(tiles), 'bytes', len(js))
