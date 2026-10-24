'use strict';
// ---------------------------------------------------------------------------
// Entities, physics, mobs, particles, explosions, status effects
// ---------------------------------------------------------------------------
function blockBoxes(world, x0, y0, z0, x1, y1, z1, out) {
  out.length = 0;
  const ix0 = Math.floor(x0), iy0 = Math.floor(y0) - 1, iz0 = Math.floor(z0);
  const ix1 = Math.floor(x1), iy1 = Math.floor(y1), iz1 = Math.floor(z1);
  for (let x = ix0; x <= ix1; x++) for (let z = iz0; z <= iz1; z++) {
    if (!world.isLoaded(x, z)) { out.push([x, -1e3, z, x + 1, 1e3, z + 1]); continue; }
    for (let y = iy0; y <= iy1; y++) {
      const id = world.getBlock(x, y, z);
      if (!id) continue;
      const b = BLOCKS[id];
      if (!b.solid) continue;
      if (b.shape === SH_BOXES || b.shape === SH_MODEL) {
        if (b.door && (world.getMeta(x, y, z) & 4) && false) continue;
        for (const bx of b.boxes(world.getMeta(x, y, z))) out.push([x + bx[0] / 16, y + bx[1] / 16, z + bx[2] / 16, x + bx[3] / 16, y + bx[4] / 16 * (b.key === 'snow' ? 0 : 1), z + bx[5] / 16]);
      } else if (b.shape === SH_CACTUS) out.push([x + 1 / 16, y, z + 1 / 16, x + 15 / 16, y + 1, z + 15 / 16]);
      else if (id === 530) out.push([x, y, z, x + 1, y + 14 / 16, z + 1]);
      else out.push([x, y, z, x + 1, y + 1, z + 1]);
    }
  }
  return out;
}
const _boxes = [];

class Entity {
  constructor(game, x, y, z, w, h) {
    this.game = game; this.world = game.world;
    this.pos = [x, y, z]; this.prev = [x, y, z]; this.vel = [0, 0, 0];
    this.w = w; this.h = h;
    this.yaw = 0; this.pitch = 0; this.prevYaw = 0;
    this.onGround = false; this.collidedH = false; this.inWater = false; this.inLava = false; this.eyeInWater = false;
    this.dead = false; this.age = 0; this.fallDist = 0; this.stepHeight = 0;
    this.id = Entity.nextId++;
  }
  box() { const w = this.w / 2; return [this.pos[0] - w, this.pos[1], this.pos[2] - w, this.pos[0] + w, this.pos[1] + this.h, this.pos[2] + w]; }
  savePrev() { this.prev[0] = this.pos[0]; this.prev[1] = this.pos[1]; this.prev[2] = this.pos[2]; this.prevYaw = this.yaw; this.prevBodyYaw = this.bodyYaw; }
  ipos(a) { return [lerp(this.prev[0], this.pos[0], a), lerp(this.prev[1], this.pos[1], a), lerp(this.prev[2], this.pos[2], a)]; }

  collides(bb) {
    blockBoxes(this.world, bb[0], bb[1], bb[2], bb[3], bb[4], bb[5], _boxes);
    for (const b of _boxes) if (bb[0] < b[3] && bb[3] > b[0] && bb[1] < b[4] && bb[4] > b[1] && bb[2] < b[5] && bb[5] > b[2]) return true;
    return false;
  }

  static clip(bb, boxes, d, axis) {
    const a = axis, o1 = (axis + 1) % 3, o2 = (axis + 2) % 3;
    for (const b of boxes) {
      if (bb[o1] >= b[o1 + 3] || bb[o1 + 3] <= b[o1] || bb[o2] >= b[o2 + 3] || bb[o2 + 3] <= b[o2]) continue;
      if (d > 0 && bb[a + 3] <= b[a] + 1e-7) { const m = b[a] - bb[a + 3]; if (m < d) d = m; }
      else if (d < 0 && bb[a] >= b[a + 3] - 1e-7) { const m = b[a + 3] - bb[a]; if (m > d) d = m; }
    }
    return d;
  }

  move(dx, dy, dz) {
    if (this.noClip) { this.pos[0] += dx; this.pos[1] += dy; this.pos[2] += dz; return; }
    // sneaking: don't walk off edges
    if (this.sneakEdge && this.onGround && !this.flying) {
      const step = 0.05;
      const test = (ddx, ddz) => { const b = this.box(); return this.collides([b[0] + ddx, b[1] - 0.6, b[2] + ddz, b[3] + ddx, b[1], b[5] + ddz]); };
      while (dx !== 0 && !test(dx, 0)) { if (Math.abs(dx) < step) dx = 0; else dx -= Math.sign(dx) * step; }
      while (dz !== 0 && !test(0, dz)) { if (Math.abs(dz) < step) dz = 0; else dz -= Math.sign(dz) * step; }
      while (dx !== 0 && dz !== 0 && !test(dx, dz)) {
        if (Math.abs(dx) < step) dx = 0; else dx -= Math.sign(dx) * step;
        if (Math.abs(dz) < step) dz = 0; else dz -= Math.sign(dz) * step;
      }
    }
    const ox = dx, oy = dy, oz = dz;
    const bb = this.box();
    blockBoxes(this.world, Math.min(bb[0], bb[0] + dx) - 0.01, Math.min(bb[1], bb[1] + dy) - 0.01, Math.min(bb[2], bb[2] + dz) - 0.01,
      Math.max(bb[3], bb[3] + dx) + 0.01, Math.max(bb[4], bb[4] + dy) + 0.01, Math.max(bb[5], bb[5] + dz) + 0.01, _boxes);
    const boxes = _boxes.slice();
    dy = Entity.clip(bb, boxes, dy, 1); bb[1] += dy; bb[4] += dy;
    dx = Entity.clip(bb, boxes, dx, 0); bb[0] += dx; bb[3] += dx;
    dz = Entity.clip(bb, boxes, dz, 2); bb[2] += dz; bb[5] += dz;
    const grounded = this.onGround || (oy !== dy && oy < 0);
    if (this.stepHeight > 0 && grounded && (dx !== ox || dz !== oz)) {
      const sb = this.box();
      blockBoxes(this.world, Math.min(sb[0], sb[0] + ox) - 0.01, sb[1] - 0.01, Math.min(sb[2], sb[2] + oz) - 0.01,
        Math.max(sb[3], sb[3] + ox) + 0.01, sb[4] + this.stepHeight + 0.01, Math.max(sb[5], sb[5] + oz) + 0.01, _boxes);
      const b2 = _boxes.slice();
      let sy = Entity.clip(sb, b2, this.stepHeight, 1); sb[1] += sy; sb[4] += sy;
      let sx = Entity.clip(sb, b2, ox, 0); sb[0] += sx; sb[3] += sx;
      let sz = Entity.clip(sb, b2, oz, 2); sb[2] += sz; sb[5] += sz;
      let down = Entity.clip(sb, b2, -sy, 1); sb[1] += down; sb[4] += down;
      if (sx * sx + sz * sz > dx * dx + dz * dz + 1e-6) {
        for (let i = 0; i < 6; i++) bb[i] = sb[i];
        dx = sx; dz = sz; dy = sy + down;
        this.stepped = true;
      }
    }
    this.collidedH = Math.abs(dx - ox) > 1e-6 || Math.abs(dz - oz) > 1e-6;
    this.onGround = oy < 0 && Math.abs(dy - oy) > 1e-7 || (this.stepped && oy <= 0 && this.onGround);
    this.stepped = false;
    if (Math.abs(dy - oy) > 1e-7) this.vel[1] = 0;
    if (Math.abs(dx - ox) > 1e-7) this.vel[0] = 0;
    if (Math.abs(dz - oz) > 1e-7) this.vel[2] = 0;
    this.pos[0] = (bb[0] + bb[3]) / 2; this.pos[1] = bb[1]; this.pos[2] = (bb[2] + bb[5]) / 2;
    // fall distance
    if (this.onGround) {
      if (this.fallDist > 0) this.onLand(this.fallDist);
      this.fallDist = 0;
    } else if (dy < 0) this.fallDist -= dy;
  }
  onLand(d) { }

  updateFluids() {
    const b = this.box();
    this.inWater = false; this.inLava = false;
    const x0 = Math.floor(b[0] + 0.001), x1 = Math.floor(b[3] - 0.001), y0 = Math.floor(b[1] + 0.001), y1 = Math.floor(b[4] - 0.001), z0 = Math.floor(b[2] + 0.001), z1 = Math.floor(b[5] - 0.001);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const id = this.world.getBlock(x, y, z);
      if (id === WATER) { this.inWater = true; this.fallDist = 0; }
      else if (id === LAVA) this.inLava = true;
    }
    const ey = this.pos[1] + (this.eyeH || this.h * 0.85);
    const eid = this.world.getBlock(Math.floor(this.pos[0]), Math.floor(ey), Math.floor(this.pos[2]));
    this.eyeInWater = eid === WATER && ey < Math.floor(ey) + 0.9;
  }

  lightAt() {
    const l = this.world.getLight(Math.floor(this.pos[0]), Math.floor(this.pos[1] + this.h * 0.5), Math.floor(this.pos[2]));
    return [(l >> 4) / 15, (l & 15) / 15];
  }
  distTo(e) { return Math.hypot(this.pos[0] - e.pos[0], this.pos[1] - e.pos[1], this.pos[2] - e.pos[2]); }
}
Entity.nextId = 1;

// ---------------------------------------------------------------------------
// Living entities
// ---------------------------------------------------------------------------
class Living extends Entity {
  constructor(game, x, y, z, w, h, hp) {
    super(game, x, y, z, w, h);
    this.health = hp; this.maxHealth = hp;
    this.hurtTime = 0; this.invuln = 0; this.deathTime = 0;
    this.fire = 0; this.air = 300;
    this.limbSwing = 0; this.limbAmt = 0; this.bodyYaw = 0; this.headYaw = 0;
    this.stepHeight = 0.6; this.slowFall = false;
    this.effects = {};
  }
  applyEffect(id, duration = 0, amp = 0) {
    if (!id) return;
    if (this.T && this.T.witherImmune && id === 'wither') return;
    if (id === 'instant_health') {
      const healAmt = 8 << (amp || 0);
      this.health = Math.min(this.maxHealth || 20, this.health + healAmt);
      if (this.game && this.game.particles) {
        for (let i = 0; i < 8; i++) {
          this.game.particles.spawn('heart', this.pos[0] + (Math.random() - 0.5) * 0.8, this.pos[1] + 0.8 + Math.random() * 0.8, this.pos[2] + (Math.random() - 0.5) * 0.8, 0, 0.03, 0);
        }
      }
      return;
    }
    if (!this.effects) this.effects = {};
    const cur = this.effects[id];
    const ticks = Math.max(cur ? cur.ticks : 0, duration);
    const maxTicks = Math.max(cur ? (cur.maxTicks || 0) : 0, duration);
    this.effects[id] = { id, ticks, maxTicks, amp: Math.max(cur ? (cur.amp || 0) : 0, amp) };
    if (id === 'fire_resistance') this.fire = 0;
  }
  hasEffect(id) {
    return !!(this.effects && this.effects[id] && this.effects[id].ticks > 0);
  }
  effectLevel(id) {
    return this.hasEffect(id) ? ((this.effects[id].amp || 0) + 1) : 0;
  }
  clearEffects() {
    this.effects = {};
  }
  tickEffects() {
    if (!this.effects) return;
    const keys = Object.keys(this.effects);
    for (const k of keys) {
      const eff = this.effects[k];
      if (!eff || eff.ticks <= 0) {
        delete this.effects[k];
        continue;
      }
      if (k === 'wither') {
        const interval = Math.max(10, 40 >> (eff.amp || 0));
        if (eff.ticks % interval === 0) this.hurt(1, { type: 'wither' });
      }
      eff.ticks--;
      if (eff.ticks <= 0) delete this.effects[k];
    }
    if (keys.length && this.age % 8 === 0 && this.game && this.game.particles) {
      const firstKey = Object.keys(this.effects)[0];
      const def = (typeof STATUS_EFFECTS !== 'undefined' && STATUS_EFFECTS[firstKey]) || null;
      let col = [140, 180, 255];
      if (def && def.color) {
        const hex = parseInt(def.color.slice(1), 16);
        col = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
      }
      this.game.particles.spawn('potion', this.pos[0] + (Math.random() - 0.5) * 0.6, this.pos[1] + 0.5 + Math.random() * 1.1, this.pos[2] + (Math.random() - 0.5) * 0.6, 0, 0.02, 0, { col });
    }
  }
  hurt(amount, source) {
    if (this.dead || this.deathTime > 0) return false;
    if (source && (source.type === 'fire' || source.type === 'lava') && (this.hasEffect('fire_resistance') || (this.T && this.T.fireImmune))) return false;
    if (source && source.type === 'wither' && this.T && this.T.witherImmune) return false;
    if (this.invuln > 10 && amount <= this.lastDamage) return false;
    const actual = this.invuln > 10 ? amount - this.lastDamage : amount;
    const reduced = this.reduceDamage ? this.reduceDamage(actual, source) : actual;
    if (reduced <= 0) return false;
    this.lastDamage = amount; this.invuln = 20; this.hurtTime = 10;
    this.health -= reduced;
    if (source && source.knockFrom) {
      const dx = this.pos[0] - source.knockFrom[0], dz = this.pos[2] - source.knockFrom[2];
      const d = Math.hypot(dx, dz) || 1, k = source.knock ?? 0.4;
      this.vel[0] = this.vel[0] / 2 + dx / d * k; this.vel[2] = this.vel[2] / 2 + dz / d * k;
      if (this.onGround) this.vel[1] = Math.min(0.4, this.vel[1] / 2 + 0.36);
    }
    this.onHurt(source);
    if (this.health <= 0) { this.health = 0; this.die(source); }
    return true;
  }
  onHurt() { }
  die() { this.deathTime = 1; }
  baseTick() {
    this.age++;
    this.tickEffects();
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invuln > 0) this.invuln--;
    this.updateFluids();
    const fireRes = this.hasEffect('fire_resistance') || !!(this.T && this.T.fireImmune);
    if (this.inLava) {
      if (!fireRes) { this.hurt(4, { type: 'lava' }); this.fire = 300; }
      else this.fire = 0;
    }
    const footBid = this.world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] + 0.05), Math.floor(this.pos[2]));
    if (footBid === 537 && !fireRes) {
      this.hurt(1, { type: 'fire' });
      this.fire = Math.max(this.fire, 160);
    }
    if (this.fire > 0) {
      if (fireRes || this.inWater) {
        this.fire = 0;
      } else {
        const fp = (this.inv && typeof Enchant !== 'undefined') ? Enchant.maxArmorEnch(this.inv, 'fire_protection') : 0;
        this.fire -= (fp > 0 && Math.random() < fp * 0.15) ? 2 : 1;
        if (this.fire < 0) this.fire = 0;
        if (this.fire > 0 && this.fire % 20 === 0) this.hurt(1, { type: 'fire' });
        if (Math.random() < 0.3) this.game.particles.spawn('flame', this.pos[0] + (Math.random() - 0.5) * this.w, this.pos[1] + Math.random() * this.h, this.pos[2] + (Math.random() - 0.5) * this.w, 0, 0.02, 0);
      }
    }
    if (this.eyeInWater && !this.waterBreather) {
      const resp = (this.inv && typeof Enchant !== 'undefined') ? Enchant.maxArmorEnch(this.inv, 'respiration') : 0;
      if (resp <= 0 || Math.random() < 1 / (resp + 1)) this.air--;
      if (this.air <= -20) { this.air = 0; this.hurt(2, { type: 'drown' }); }
    } else this.air = Math.min(300, this.air + 4);
    // contact damage (cactus, magma)
    const b = this.box();
    for (const [x, y, z] of [[b[0] - 0.01, b[1] + 0.3, this.pos[2]], [b[3] + 0.01, b[1] + 0.3, this.pos[2]], [this.pos[0], b[1] + 0.3, b[2] - 0.01], [this.pos[0], b[1] + 0.3, b[5] + 0.01]]) {
      if (this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) === 37) { this.hurt(1, { type: 'cactus' }); break; }
    }
    if (!fireRes && this.onGround && this.world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] - 0.1), Math.floor(this.pos[2])) === 103 && !this.sneaking) this.hurt(1, { type: 'fire' });
    if (this.pos[1] < -40) this.hurt(4, { type: 'void' });
  }
  onLand(d) {
    if (this.slowFall) return;
    const id = this.world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] - 0.2), Math.floor(this.pos[2]));
    if (d > 1.5 && id && BLOCKS[id].shape !== SH_LIQUID) {
      const n = Math.min(30, Math.floor(d * 3));
      for (let i = 0; i < n; i++) this.game.particles.spawn('block', this.pos[0] + (Math.random() - 0.5) * this.w, this.pos[1] + 0.1, this.pos[2] + (Math.random() - 0.5) * this.w, (Math.random() - 0.5) * 0.3, 0.1 + Math.random() * 0.1, (Math.random() - 0.5) * 0.3, { id, meta: 0, tint: BLOCKS[id].tint ? this.game.tintAt(Math.floor(this.pos[0]), Math.floor(this.pos[2]), BLOCKS[id].tint) : null });
      if (d > 3) Sound.block('step', BLOCKS[id].sound, this.pos);
    }
    if (d > 3.0 && !this.inWater && id !== 87) {
      this.hurt(Math.ceil(d - 3), { type: 'fall' });
      if (BLOCKS[id]) Sound.block('break', BLOCKS[id].sound, this.pos);
    }
  }
  // MC-like movement physics; fwd/strafe in [-1,1] relative to yaw
  travel(fwd, strafe, speed, jump) {
    const v = this.vel;
    if (this.inWater || this.inLava) {
      const isSwim = !!(this.swimming && this.inWater);
      const isFastSwim = !!(isSwim && this.sprinting);
      const drag = this.inWater ? (isFastSwim ? 0.88 : isSwim ? 0.83 : 0.8) : 0.5;
      if (isSwim) {
        const swimAccel = (isFastSwim ? 0.042 : 0.022) * (this.waterSpeed || 1);
        const cp = Math.cos(this.pitch || 0), sp = Math.sin(this.pitch || 0);
        this.accel(fwd * Math.max(0.25, cp), strafe, swimAccel);
        if (fwd > 0) {
          const lookY = sp * fwd;
          const vThrust = isFastSwim ? 0.055 : 0.032;
          const vMax = isFastSwim ? 0.28 : 0.16;
          v[1] += lookY * (vThrust * (this.waterSpeed || 1)) + 0.005;
          const targetVy = lookY * vMax + (jump ? 0.06 : 0) - (this.sneaking ? 0.06 : 0);
          v[1] += (targetVy - v[1]) * 0.28;
        } else {
          if (jump) v[1] += 0.035;
          if (this.sneaking) v[1] -= 0.035;
        }
      } else {
        this.accel(fwd, strafe, 0.02 * (this.waterSpeed || 1));
        if (jump) v[1] += 0.04;
      }
      const inWeb = this.world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] + 0.1), Math.floor(this.pos[2])) === 177 ||
                  this.world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] + this.h * 0.6), Math.floor(this.pos[2])) === 177;
      if (inWeb) { v[0] *= 0.25; v[1] = Math.max(-0.05, v[1] * 0.15); v[2] *= 0.25; this.fallDist = 0; }
      this.move(v[0], v[1], v[2]);
      v[0] *= drag; v[1] *= drag; v[2] *= drag;
      if (!isSwim) v[1] -= 0.02;
      else v[1] -= 0.005;
      if (this.collidedH && jump) {
        const b = this.box();
        if (!this.collides([b[0] + v[0], b[1] + 0.6, b[2] + v[2], b[3] + v[0], b[4] + 0.6, b[5] + v[2]])) v[1] = 0.3;
      }
      return;
    }
    const bx = Math.floor(this.pos[0]), bz = Math.floor(this.pos[2]);
    const below = this.world.getBlock(bx, Math.floor(this.pos[1] - 0.5), bz);
    const onSoulSand = this.onGround && (below === 530 || this.world.getBlock(bx, Math.floor(this.pos[1] + 0.05), bz) === 530);
    const slip = this.onGround ? (BLOCKS[below] ? BLOCKS[below].slip : 0.6) : 1;
    const fr = this.onGround ? slip * 0.91 : 0.91;
    const soulMult = onSoulSand ? 0.45 : 1;
    const a = this.onGround ? speed * soulMult * (0.21600002 / (slip * slip * slip)) : (this.airSpeed || 0.02);
    this.accel(fwd, strafe, a);
    if (this.onLadder()) {
      v[0] = clamp(v[0], -0.15, 0.15); v[2] = clamp(v[2], -0.15, 0.15);
      v[1] = Math.max(v[1], -0.15);
      if (this.sneaking && v[1] < 0) v[1] = 0;
      this.fallDist = 0;
    }
    this.move(v[0], v[1], v[2]);
    if (this.onLadder() && (this.collidedH || jump)) v[1] = 0.2;
    v[1] -= 0.08; v[1] *= 0.98;
    if (this.slowFall && v[1] < -0.1) { v[1] = -0.1; this.fallDist = 0; }
    if (onSoulSand) { v[0] *= 0.72; v[2] *= 0.72; }
    v[0] *= fr; v[2] *= fr;
  }
  accel(fwd, strafe, a) {
    let l = fwd * fwd + strafe * strafe;
    if (l < 1e-4) return;
    l = Math.sqrt(l); if (l < 1) l = 1;
    fwd *= a / l; strafe *= a / l;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.vel[0] += -s * fwd + c * strafe;
    this.vel[2] += -c * fwd - s * strafe;
  }
  onLadder() {
    const id = this.world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1]), Math.floor(this.pos[2]));
    return id && BLOCKS[id].climbable;
  }
  animate() {
    const dx = this.pos[0] - this.prev[0], dz = this.pos[2] - this.prev[2];
    const sp = Math.min(1, Math.hypot(dx, dz) * 4);
    this.limbAmt += (sp - this.limbAmt) * 0.4;
    this.limbSwing += this.limbAmt;
  }
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------
class Inventory {
  constructor() { this.slots = new Array(41).fill(null); this.sel = 0; }
  get held() { return this.slots[this.sel]; }
  get offhand() { return this.slots[40] || null; }
  set offhand(s) { this.slots[40] = s; }
  canFit(stack) {
    if (!stack) return true;
    let n = stack.count;
    const ms = maxStack(stack.id);
    for (let i = 0; i < 36; i++) {
      const s = this.slots[i];
      if (!s) { n -= ms; if (n <= 0) return true; }
      else if (s.id === stack.id && s.count < ms && !ITEMS[s.id].durability && (typeof Enchant === 'undefined' || Enchant.sameStackMeta(s, stack))) {
        n -= (ms - s.count);
        if (n <= 0) return true;
      }
    }
    return n <= 0;
  }
  add(stack) {
    if (!stack) return 0;
    let n = stack.count;
    const ms = maxStack(stack.id);
    const order = [];
    for (let i = 0; i < 36; i++) order.push(i);
    for (const i of order) {
      const s = this.slots[i];
      if (s && s.id === stack.id && s.count < ms && !ITEMS[s.id].durability && (typeof Enchant === 'undefined' || Enchant.sameStackMeta(s, stack))) { const k = Math.min(n, ms - s.count); s.count += k; n -= k; if (!n) return 0; }
    }
    for (const i of order) {
      if (!this.slots[i]) { const k = Math.min(n, ms); this.slots[i] = typeof Enchant !== 'undefined' ? Enchant.cloneStack(stack, k) : { id: stack.id, count: k, dmg: stack.dmg || 0 }; n -= k; if (!n) return 0; }
    }
    return n;
  }
  count(id) { let n = 0; for (let i = 0; i < 36; i++) if (this.slots[i] && this.slots[i].id === id) n += this.slots[i].count; return n; }
  remove(id, n) {
    for (let i = 0; i < 36 && n > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) { const k = Math.min(n, s.count); s.count -= k; n -= k; if (!s.count) this.slots[i] = null; }
    }
  }
  armorPoints() {
    let p = 0;
    for (let i = 36; i < 40; i++) { const s = this.slots[i]; if (s && ITEMS[s.id].armor) p += ITEMS[s.id].armor.points; }
    return p;
  }
  toJSON() { return { slots: this.slots, sel: this.sel }; }
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
class Player extends Living {
  constructor(game, x, y, z) {
    super(game, x, y, z, 0.6, 1.8, 20);
    this.eyeH = 1.62;
    this.inv = new Inventory();
    this.food = 20; this.saturation = 5; this.exhaustion = 0; this.foodTimer = 0;
    this.flying = false; this.sprinting = false; this.sneaking = false;
    this.swimming = false; this.swimAmt = 0; this.prevSwimAmt = 0;
    this.blocking = false;
    this.spawn = [x, y, z];
    this.bob = 0; this.prevBob = 0; this.bobAmt = 0;
    this.swing = 0; this.swingT = 0; this.useT = 0;
    this.xp = 0;
    this.distWalked = 0;
  }
  get creative() { return this.game.mode === 'creative'; }
  eye() { return this.swimming ? 0.45 : (this.sneaking && !this.flying ? 1.27 : 1.62); }
  canFitHeight(h) {
    const r = this.w / 2;
    return !this.collides([this.pos[0] - r, this.pos[1], this.pos[2] - r, this.pos[0] + r, this.pos[1] + h, this.pos[2] + r]);
  }
  getActiveShield() {
    const isUsingShield = this.blocking || (this.usingItem != null && ITEMS[this.usingItem] && ITEMS[this.usingItem].shield);
    if (!isUsingShield) return null;
    const mh = this.inv.held;
    if (mh && ITEMS[mh.id] && ITEMS[mh.id].shield) return { stack: mh, slotIdx: this.inv.sel, hand: 'main' };
    const oh = this.inv.offhand;
    if (oh && ITEMS[oh.id] && ITEMS[oh.id].shield) return { stack: oh, slotIdx: 40, hand: 'offhand' };
    return null;
  }
  isBlocking() {
    return !!this.getActiveShield();
  }
  isBlockedFromFront(src) {
    if (!src) return false;
    const t = src.type;
    if (t !== 'mob' && t !== 'player' && t !== 'arrow' && t !== 'explosion') return false;
    const origin = src.sourcePos || (src.attacker && src.attacker.pos) || src.knockFrom;
    if (!origin) return true;
    const dx = origin[0] - this.pos[0], dz = origin[2] - this.pos[2];
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return true;
    const lx = -Math.sin(this.yaw), lz = -Math.cos(this.yaw);
    const dot = (dx * lx + dz * lz) / dist;
    return dot > -0.05;
  }
  damageShield(amount) {
    const sh = this.getActiveShield();
    if (!sh || this.creative) return;
    const n = Math.max(1, Math.floor(amount || 1));
    const loss = typeof Enchant !== 'undefined' ? Enchant.rollDurabilityLoss(sh.stack, n, false) : n;
    if (loss <= 0) return;
    sh.stack.dmg = (sh.stack.dmg || 0) + loss;
    if (sh.stack.dmg >= ITEMS[sh.stack.id].durability) {
      this.inv.slots[sh.slotIdx] = null;
      this.usingItem = null;
      this.blocking = false;
      this.useT = 0;
      if (typeof Sound !== 'undefined' && Sound.shieldBreak) Sound.shieldBreak(this.pos);
    }
  }
  reduceDamage(a, src) {
    if (this.creative && src && src.type !== 'void') return 0;
    const type = src && src.type;
    if ((type === 'fire' || type === 'lava') && this.hasEffect('fire_resistance')) return 0;
    if (type === 'drown' || type === 'starve' || type === 'void' || type === 'wither') return a;
    let dmg = a;
    if (type !== 'fall' && type !== 'fire') {
      const armor = this.inv.armorPoints();
      if (armor) {
        for (let i = 36; i < 40; i++) {
          const s = this.inv.slots[i];
          if (!s) continue;
          const loss = typeof Enchant !== 'undefined' ? Enchant.rollDurabilityLoss(s, 1, true) : 1;
          s.dmg = (s.dmg || 0) + loss;
          // Thorns reflection
          if (typeof Enchant !== 'undefined' && s.ench && s.ench.thorns && src && src.attacker && src.attacker instanceof Living && src.attacker !== this) {
            if (Math.random() < 0.15 * s.ench.thorns) {
              src.attacker.hurt(1 + Math.floor(Math.random() * 4), { type: 'thorns', attacker: this });
              s.dmg += 2;
            }
          }
          if (s.dmg >= ITEMS[s.id].durability) { this.inv.slots[i] = null; Sound.block('break', 'metal', this.pos); }
        }
      }
      dmg *= (1 - Math.min(20, armor) / 25);
    }
    if (typeof Enchant !== 'undefined') {
      const epf = Enchant.armorEPF(this.inv, src);
      if (epf > 0) dmg *= (1 - epf * 0.04);
    }
    return dmg;
  }
  hurt(a, src) {
    if (this.creative && (!src || src.type !== 'void')) return false;
    if (this.game.gameOver) return false;
    if (src && (src.type === 'fire' || src.type === 'lava') && this.hasEffect('fire_resistance')) return false;
    if (this.isBlocking() && this.isBlockedFromFront(src)) {
      if (typeof Sound !== 'undefined' && Sound.shieldBlock) Sound.shieldBlock(this.pos);
      this.damageShield(Math.max(1, Math.ceil(a * 0.5)));
      if ((src.type === 'mob' || src.type === 'player') && src.attacker && src.attacker.vel) {
        const dx = src.attacker.pos[0] - this.pos[0], dz = src.attacker.pos[2] - this.pos[2];
        const d = Math.hypot(dx, dz) || 1;
        src.attacker.vel[0] += (dx / d) * 0.4;
        src.attacker.vel[2] += (dz / d) * 0.4;
        if (src.attacker.onGround) src.attacker.vel[1] = Math.min(0.36, src.attacker.vel[1] + 0.25);
      }
      return false;
    }
    const r = super.hurt(a, src);
    if (r) { this.exhaust(0.1); Sound.hurt(null); this.game.onPlayerHurt(src); }
    return r;
  }
  die(src) {
    super.die(src);
    this.game.onPlayerDeath(src);
  }
  exhaust(x) { if (!this.creative) this.exhaustion += x; }
  tick(input) {
    this.savePrev();
    this.prevSwimAmt = this.swimAmt || 0;
    this.baseTick();
    if (this.deathTime > 0) { this.deathTime++; this.swimming = false; return; }
    const cr = this.creative;
    if (!cr && this.flying) this.flying = false;
    const wasSwimming = !!this.swimming || this.h <= 0.65;
    this.sneaking = input.sneak && !this.flying;
    // sprinting & underwater sprint-swimming (with official MC 1-block ceiling pose restriction)
    const canSprint = cr || this.food > 6;
    const blocking = this.isBlocking();
    if (input.sprint && input.fwd > 0 && canSprint && !this.sneaking && !blocking) this.sprinting = true;
    if (!input.sprint && this.inWater) this.sprinting = false;
    if (input.fwd <= 0 || (this.collidedH && !this.inWater) || !canSprint || this.sneaking || blocking) this.sprinting = false;

    const canCrouch = this.canFitHeight(1.5);
    const canStand = this.canFitHeight(1.8);
    const activeWaterSwim = this.inWater && !this.flying && !this.inLava && this.sprinting && input.fwd > 0 && canSprint && !this.sneaking && !blocking;
    const restrictedByCeiling = !this.flying && !canCrouch && wasSwimming;

    if (activeWaterSwim) {
      this.swimming = true;
      this.sprinting = true;
    } else if (restrictedByCeiling) {
      // Blocked by a 1-block-high ceiling (< 1.5m): stay in prone 0.6m swimming/crawling state (slow swim if sprint released)
      this.swimming = true;
    } else {
      this.swimming = false;
    }

    if (this.swimming) {
      this.h = 0.6;
    } else if (this.sneaking || !canStand) {
      if (canCrouch) {
        this.h = 1.5;
        this.sneaking = true;
      } else {
        this.swimming = true;
        this.h = 0.6;
      }
    } else {
      this.h = 1.8;
    }

    this.swimAmt = (this.swimAmt || 0) + ((this.swimming ? 1 : 0) - (this.swimAmt || 0)) * 0.28;
    if (this.swimAmt < 0.005) this.swimAmt = 0;
    this.sneakEdge = this.sneaking && !this.swimming;
    const speedMult = 1 + 0.2 * this.effectLevel('speed');
    const sp = (this.sprinting ? 0.13 : 0.1) * speedMult;
    let fwd = input.fwd * 0.98, str = input.strafe * 0.98;
    if ((this.sneaking && !this.swimming) || (this.swimming && !this.inWater)) { fwd *= 0.3; str *= 0.3; }
    if ((this.useT > 0 && this.usingItem) || blocking) { fwd *= 0.2; str *= 0.2; }
    if (this.swimming && this.age % 3 === 0 && this.game && this.game.particles) {
      this.game.particles.spawn('bubble', this.pos[0] + (Math.random() - 0.5) * 0.5, this.pos[1] + 0.25, this.pos[2] + (Math.random() - 0.5) * 0.5, -this.vel[0] * 0.3, 0.02, -this.vel[2] * 0.3);
    }
    this.airSpeed = (this.sprinting ? 0.026 : 0.02) * speedMult;
    this.waterSpeed = (1 + (typeof Enchant !== 'undefined' ? Enchant.maxArmorEnch(this.inv, 'depth_strider') * 0.65 : 0)) * speedMult;
    this.slowFall = false;
    if (this.flying) {
      const v = this.vel;
      this.accel(fwd, str, this.sprinting ? 0.1 : 0.05);
      let ty = 0; if (input.jump) ty += 0.375; if (input.sneak) ty -= 0.375;
      v[1] += (ty - v[1]) * 0.4;
      this.move(v[0], v[1], v[2]);
      v[0] *= 0.91; v[2] *= 0.91; v[1] *= 0.6;
      if (this.onGround && input.sneak) this.flying = false;
      this.fallDist = 0;
    } else {
      if (input.jump && this.onGround && !this.inWater && !this.inLava) {
        this.vel[1] = 0.42;
        if (this.sprinting) { this.vel[0] += -Math.sin(this.yaw) * 0.2; this.vel[2] += -Math.cos(this.yaw) * 0.2; this.exhaust(0.2); }
        else this.exhaust(0.05);
        this.jumpT = 0;
      }
      const wasGround = this.onGround;
      this.travel(fwd, str, sp, input.jump);
    }
    // walking distance & footsteps
    const dx = this.pos[0] - this.prev[0], dz = this.pos[2] - this.prev[2];
    if (this.sprinting && this.onGround && !this.inWater) {
      const bid = this.world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] - 0.2), Math.floor(this.pos[2]));
      if (bid && BLOCKS[bid].shape !== SH_LIQUID) this.game.particles.spawn('block', this.pos[0] + (Math.random() - 0.5) * 0.6, this.pos[1] + 0.1, this.pos[2] + (Math.random() - 0.5) * 0.6, -dx * 2, 0.15, -dz * 2, { id: bid, meta: this.world.getMeta(Math.floor(this.pos[0]), Math.floor(this.pos[1] - 0.2), Math.floor(this.pos[2])), tint: BLOCKS[bid].tint ? this.game.tintAt(Math.floor(this.pos[0]), Math.floor(this.pos[2]), BLOCKS[bid].tint) : null });
    }
    const dist = Math.hypot(dx, dz);
    if (this.onGround && !this.flying) {
      this.distWalked += dist;
      if (this.sprinting) this.exhaust(0.1 * dist);
      if (this.distWalked > 1.7 && !this.sneaking) {
        this.distWalked = 0;
        const id = this.world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] - 0.2), Math.floor(this.pos[2]));
        if (id && BLOCKS[id]) Sound.block('step', BLOCKS[id].sound, [this.pos[0], this.pos[1], this.pos[2]]);
      }
    } else if (this.inWater && dist > 0.05 && this.age % 12 === 0) Sound.splash(null);
    // view bobbing
    this.prevBob = this.bob; this.prevBobAmt = this.bobAmt;
    const target = this.onGround && !this.flying ? Math.min(0.1, dist) : 0;
    this.bobAmt += (target - this.bobAmt) * 0.4;
    this.bob += dist;
    // hunger
    if (!cr) {
      if (this.exhaustion >= 4) { this.exhaustion -= 4; if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1); else this.food = Math.max(0, this.food - 1); }
      this.foodTimer++;
      if (this.food >= 18 && this.health < this.maxHealth) {
        if (this.foodTimer >= (this.saturation > 0 && this.food === 20 ? 10 : 80)) { this.health = Math.min(this.maxHealth, this.health + 1); this.exhaust(6); this.foodTimer = 0; }
      } else if (this.food <= 0) {
        if (this.foodTimer >= 80) { if (this.health > 1) this.hurt(1, { type: 'starve' }); this.foodTimer = 0; }
      } else this.foodTimer = 0;
    } else { this.food = 20; this.health = this.maxHealth; this.air = 300; this.fire = 0; }
    if (this.swingT > 0) this.swingT--;
    if ((this.pearlCooldown || 0) > 0) this.pearlCooldown--;
    // Nether portal (ID 528) & End portal (ID 539) collision
    const pb = this.box();
    let inPortal = false, inEndPortal = false;
    for (let px = Math.floor(pb[0]); px <= Math.floor(pb[3] - 0.001); px++) {
      for (let py = Math.floor(pb[1]); py <= Math.floor(pb[4] - 0.001); py++) {
        for (let pz = Math.floor(pb[2]); pz <= Math.floor(pb[5] - 0.001); pz++) {
          const bid = this.world.getBlock(px, py, pz);
          if (bid === 528) inPortal = true;
          else if (bid === 539) inEndPortal = true;
        }
      }
    }
    if (inEndPortal && (this.portalCooldown || 0) <= 0 && this.game && this.game.triggerEndPortal && !this.game._switchingDim) {
      this.portalCooldown = 100;
      this.portalTime = 0;
      this.game.triggerEndPortal();
    }
    if (inPortal) {
      if ((this.portalCooldown || 0) > 0) {
        this.portalTime = 0;
      } else {
        this.portalTime = (this.portalTime || 0) + 1;
        if (Math.random() < 0.35 && this.game && this.game.particles) {
          this.game.particles.spawn('portal', this.pos[0] + (Math.random() - 0.5) * 0.8, this.pos[1] + Math.random() * 1.6, this.pos[2] + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.06);
        }
        const need = cr ? 1 : 80;
        if (this.portalTime >= need && this.game && this.game.triggerNetherPortal && !this.game._switchingDim) {
          this.portalTime = 0;
          this.portalCooldown = 100;
          this.game.triggerNetherPortal();
        }
      }
    } else {
      this.portalTime = Math.max(0, (this.portalTime || 0) - 4);
      if ((this.portalCooldown || 0) > 0) this.portalCooldown--;
    }
    this.animate();
  }
}

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------
const MOB_TYPES = {
  pig: { cn: '猪', hp: 10, w: 0.9, h: 0.9, speed: 0.25, model: 'pig', passive: true, food: 'carrot', drops: [['porkchop', 1, 3, 'cooked_porkchop']], scale: 1 },
  cow: { cn: '牛', hp: 10, w: 0.9, h: 1.4, speed: 0.2, model: 'cow', passive: true, food: 'wheat', drops: [['beef', 1, 3, 'cooked_beef'], ['leather', 0, 2]], scale: 1 },
  sheep: { cn: '羊', hp: 8, w: 0.9, h: 1.3, speed: 0.23, model: 'sheep', passive: true, food: 'wheat', drops: [['mutton', 1, 2, 'cooked_mutton']], scale: 1 },
  chicken: { cn: '鸡', hp: 4, w: 0.4, h: 0.7, speed: 0.25, model: 'chicken', passive: true, food: 'wheat_seeds', drops: [['chicken', 1, 1, 'cooked_chicken'], ['feather', 0, 2]], scale: 1 },
  zombie: { cn: '僵尸', hp: 20, w: 0.6, h: 1.95, speed: 0.23, model: 'zombie', hostile: true, attack: 3, burns: true, drops: [['rotten_flesh', 0, 2]], scale: 0.9375 },
  skeleton: { cn: '骷髅', hp: 20, w: 0.6, h: 1.99, speed: 0.25, model: 'skeleton', hostile: true, burns: true, ranged: true, drops: [['bone', 0, 2], ['arrow', 0, 2]], scale: 0.9375 },
  creeper: { cn: '苦力怕', hp: 20, w: 0.6, h: 1.7, speed: 0.25, model: 'creeper', hostile: true, drops: [['gunpowder', 0, 2]], scale: 1 },
  spider: { cn: '蜘蛛', hp: 16, w: 1.4, h: 0.9, speed: 0.3, model: 'spider', hostile: true, attack: 2, climbs: true, drops: [['string', 0, 2]], scale: 1 },
  villager: { cn: '村民', hp: 20, w: 0.6, h: 1.95, speed: 0.22, model: 'villager', passive: true, drops: [], scale: 0.9375 },
  blaze: { cn: '烈焰人', hp: 20, w: 0.6, h: 1.8, speed: 0.23, model: 'blaze', tex: 'blaze', hostile: true, attack: 6, fireImmune: true, flyingMob: true, drops: [], scale: 1 },
  wither_skeleton: { cn: '凋零骷髅', hp: 20, w: 0.7, h: 2.4, speed: 0.27, model: 'skeleton', tex: 'wither_skeleton', hostile: true, attack: 5, fireImmune: true, witherImmune: true, drops: [['coal', 0, 1], ['bone', 0, 2]], scale: 1.18 },
  ghast: { cn: '恶魂', hp: 10, w: 4.0, h: 4.0, speed: 0.18, model: 'ghast', tex: 'ghast', hostile: true, fireImmune: true, flyingMob: true, drops: [['ghast_tear', 0, 1], ['gunpowder', 0, 2]], scale: 2.25 },
  zombified_piglin: { cn: '僵尸猪人', hp: 20, w: 0.6, h: 1.95, speed: 0.25, model: 'zombie', tex: 'zombified_piglin', hostile: false, neutral: true, attack: 5, fireImmune: true, drops: [['rotten_flesh', 0, 1], ['gold_nugget', 0, 1]], scale: 0.9375 },
  enderman: { cn: '末影人', hp: 40, w: 0.6, h: 2.9, speed: 0.3, model: 'enderman', tex: 'enderman', hostile: false, neutral: true, attack: 7, drops: [['ender_pearl', 0, 1]], scale: 1 },
  ender_dragon: { cn: '末影龙', hp: 200, w: 6.0, h: 3.6, speed: 0.45, model: 'ender_dragon', tex: 'ender_dragon', hostile: true, attack: 10, fireImmune: true, witherImmune: true, flyingMob: true, boss: true, drops: [], scale: 1.0 },
};

class Mob extends Living {
  constructor(game, type, x, y, z, prof) {
    const T = MOB_TYPES[type];
    super(game, x, y, z, T.w, T.h, T.hp);
    this.type = type; this.T = T;
    this.yaw = Math.random() * Math.PI * 2; this.bodyYaw = this.yaw;
    this.target = null; this.wander = null; this.wanderT = 0; this.panic = 0; this.attackCd = 0;
    this.fuse = -1; this.prevFuse = -1; this.sheared = false; this.woolColor = 0;
    this.persistent = !!(T.passive || T.boss);
    if (type === 'ender_dragon') {
      this.phase = 'circling';
      this.phaseTicks = 0;
      this.orbitAngle = 0;
      this.perchDamageTaken = 0;
      this.healingCrystal = null;
      this.chargeTarget = null;
      this.cycleCount = 0;
    }
    this.idleSound = 100 + Math.random() * 300;
    this.stuck = 0; this.eggT = 6000 + Math.random() * 6000;
    this.waterSpeed = 1.5;
    if (type === 'chicken' || T.flyingMob) this.slowFall = true;
    this.angerTicks = 0;
    this.charging = false;
    this.blazeBurst = 0;
    this.blazeBurstCd = 0;
    this.flyTarget = null;
    if (type === 'sheep') { const r = Math.random(); this.woolColor = r < 0.05 ? 15 : r < 0.1 ? 7 : r < 0.15 ? 8 : r < 0.18 ? 12 : r < 0.182 ? 6 : 0; }
    if (prof) this.profession = prof;
    if (type === 'villager' && typeof Trading !== 'undefined') Trading.ensureVillager(this, game, prof);
  }
  subBoxes() {
    if (this.type !== 'ender_dragon') return [this.box()];
    const [x, y, z] = this.pos;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    return [
      // Central body + hanging legs (extends down to y - 2.2 so perched dragon at y=63 is easily hittable from fountain floor/rim)
      [x - 3.0, y - 2.2, z - 3.0, x + 3.0, y + 3.6, z + 3.0],
      // Neck segment in front of body
      [x + fx * 3.0 - 1.6, y - 0.8, z + fz * 3.0 - 1.6, x + fx * 3.0 + 1.6, y + 2.2, z + fz * 3.0 + 1.6],
      // Head & jaw in front of neck
      [x + fx * 5.2 - 1.6, y - 0.8, z + fz * 5.2 - 1.6, x + fx * 5.2 + 1.6, y + 2.2, z + fz * 5.2 + 1.6],
      // Right & left wings
      [x + rx * 4.0 - 2.0, y - 0.5, z + rz * 4.0 - 2.0, x + rx * 4.0 + 2.0, y + 2.2, z + rz * 4.0 + 2.0],
      [x - rx * 4.0 - 2.0, y - 0.5, z - rz * 4.0 - 2.0, x - rx * 4.0 + 2.0, y + 2.2, z - rz * 4.0 + 2.0],
      // Tail segment behind body
      [x - fx * 4.0 - 1.6, y - 0.5, z - fz * 4.0 - 1.6, x - fx * 4.0 + 1.6, y + 2.2, z - fz * 4.0 + 1.6],
    ];
  }
  teleportRandomly(range = 16) {
    const w = this.world;
    for (let attempt = 0; attempt < 16; attempt++) {
      const tx = this.pos[0] + (Math.random() - 0.5) * range * 2;
      const ty = Math.floor(this.pos[1] + (Math.random() - 0.5) * range);
      const tz = this.pos[2] + (Math.random() - 0.5) * range * 2;
      const bx = Math.floor(tx), bz = Math.floor(tz);
      if (ty < 2 || ty >= HEIGHT - 4 || !w.isLoaded(bx, bz)) continue;
      const ground = w.getBlock(bx, ty - 1, bz);
      if (!ground || !BLOCKS[ground].solid || IS_FLUID[ground]) continue;
      if (w.getBlock(bx, ty, bz) !== 0 || w.getBlock(bx, ty + 1, bz) !== 0 || w.getBlock(bx, ty + 2, bz) !== 0) continue;
      if (this.game && this.game.particles) {
        for (let i = 0; i < 12; i++) {
          this.game.particles.spawn('portal', this.pos[0] + (Math.random() - 0.5) * 0.8, this.pos[1] + Math.random() * this.h, this.pos[2] + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.1, 0.02, (Math.random() - 0.5) * 0.1);
        }
      }
      this.pos[0] = bx + 0.5; this.pos[1] = ty; this.pos[2] = bz + 0.5;
      this.prev[0] = this.pos[0]; this.prev[1] = this.pos[1]; this.prev[2] = this.pos[2];
      this.vel[0] = 0; this.vel[1] = 0; this.vel[2] = 0;
      if (this.game && this.game.particles) {
        for (let i = 0; i < 12; i++) {
          this.game.particles.spawn('portal', this.pos[0] + (Math.random() - 0.5) * 0.8, this.pos[1] + Math.random() * this.h, this.pos[2] + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.1, 0.02, (Math.random() - 0.5) * 0.1);
        }
      }
      if (typeof Sound !== 'undefined' && Sound.tone) Sound.tone(this.pos, { freq: 240, end: 520, dur: 0.16, vol: 0.25, type: 'sine' });
      return true;
    }
    return false;
  }
  hurt(a, src) {
    if (this.type === 'enderman' && src && src.type === 'arrow') {
      this.teleportRandomly(16);
      return false;
    }
    if (this.type === 'ender_dragon' && this.phase === 'perching' && src && src.type === 'arrow') {
      // Per Minecraft Wiki: Ender Dragon is immune to arrows while perched on the Exit Portal!
      return false;
    }
    if (this.type === 'blaze' && src && src.snowball) a = Math.max(a, 3);
    const r = super.hurt(a, src);
    if (r) {
      Sound.mob(this.type, 'hurt', this.pos);
      if (this.T.passive) this.panic = 100;
      if (src && src.attacker && !this.T.passive) {
        this.target = src.attacker;
        if (this.type === 'zombified_piglin') {
          this.angerTicks = 400 + ((Math.random() * 400) | 0);
          // Alert all Zombified Piglins within 32 blocks (Minecraft group aggro)
          for (const e of this.game.entities) {
            if (e instanceof Mob && !e.dead && e.type === 'zombified_piglin' && this.distTo(e) <= 32) {
              e.angerTicks = 400 + ((Math.random() * 400) | 0);
              e.target = src.attacker;
            }
          }
        } else if (this.type === 'enderman') {
          this.angerTicks = 600;
          if (Math.random() < 0.35) this.teleportRandomly(12);
        }
      }
      if (this.type === 'spider' && src && src.attacker) this.target = src.attacker;
      if (this.type === 'ender_dragon' && (this.phase === 'perching' || this.phase === 'landing')) {
        this.perchDamageTaken = (this.perchDamageTaken || 0) + a;
        if (this.perchDamageTaken >= 50) {
          this.phase = 'circling';
          this.phaseTicks = 0;
          this.perchDamageTaken = 0;
          this.orbitAngle = Math.atan2(this.pos[2] - 0.5, this.pos[0] - 0.5);
        }
      }
    }
    return r;
  }
  die(src) {
    super.die(src);
    const byPlayer = !!(src && (src.attacker === this.game.player || src.player));
    if (byPlayer) this.game.stats.kills++;
    const r = Math.random;
    const looting = (src && src.looting) || 0;
    if (!this.baby) for (const [k, mn, mx, cooked] of this.T.drops) {
      const bonus = looting > 0 ? Math.floor(r() * (looting + 1)) : 0;
      const n = mn + Math.floor(r() * (mx - mn + 1)) + bonus;
      if (n > 0) this.game.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], makeStack(this.fire > 0 && cooked ? cooked : k, n));
    }
    // Blaze native drop: Blaze Rod (replaces W1 transitional recipe)
    if (this.type === 'blaze') {
      const bonus = looting > 0 ? Math.floor(r() * (looting + 1)) : 0;
      const count = 1 + bonus;
      this.game.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], makeStack('blaze_rod', count));
    }
    // Wither Skeleton rare drop: stone_sword (8.5% chance; NO wither skeleton skull per spec)
    if (this.type === 'wither_skeleton') {
      if (r() < 0.085 + looting * 0.01 || (src && src.forceRareDrop)) {
        this.game.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], makeStack('stone_sword', 1));
      }
    }
    // Zombified Piglin rare drops: gold_ingot (2.5%) & golden_sword (8.5%)
    if (this.type === 'zombified_piglin' && byPlayer) {
      if (r() < 0.025 + looting * 0.01) this.game.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], makeStack('gold_ingot', 1));
      if (r() < 0.085 + looting * 0.01) this.game.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], makeStack('golden_sword', 1));
    }
    if (this.type === 'sheep' && !this.sheared) this.game.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], makeStack(128 + this.woolColor, 1));
    if (this.type === 'creeper' && src && src.type === 'arrow' && Math.random() < 0.2) this.game.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], makeStack('tnt', 1));
    if (this.type === 'ender_dragon' && this.game && this.game.completeEndFight) {
      this.game.completeEndFight(this);
    }
    this.game.onMobKilled(this, src);
  }
  tick() {
    this.savePrev();
    this.baseTick();
    if (this.deathTime > 0) {
      this.deathTime++;
      if (this.type !== 'ender_dragon') this.travel(0, 0, 0, false);
      if (this.deathTime > 20) {
        this.dead = true;
        for (let i = 0; i < 12; i++) this.game.particles.spawn('poof', this.pos[0] + (Math.random() - 0.5) * this.w, this.pos[1] + Math.random() * this.h, this.pos[2] + (Math.random() - 0.5) * this.w, (Math.random() - 0.5) * 0.1, Math.random() * 0.1, (Math.random() - 0.5) * 0.1);
      }
      return;
    }
    if (this.type === 'villager' && typeof Trading !== 'undefined' && this.age % 20 === 0) {
      Trading.checkRestock(this, this.game);
    }
    const g = this.game, p = g.player, T = this.T;
    let fwd = 0, jump = false, mod = 1;
    let lookAt = null;
    const dP = this.distTo(p);
    const day = g.isDay();
    // despawn hostiles far away
    if (!this.persistent && (dP > 100 || (dP > 40 && this.age > 600 && Math.random() < 0.001))) { this.dead = true; return; }
    // burn in daylight
    if (T.burns && day && !this.inWater && this.age % 20 === 0) {
      const sky = this.world.skyAt(Math.floor(this.pos[0]), Math.floor(this.pos[1] + this.h), Math.floor(this.pos[2]));
      if (sky >= 15 && g.weather < 0.5) this.fire = Math.max(this.fire, 160);
    }
    if (--this.idleSound < 0) { this.idleSound = 200 + Math.random() * 400; if (dP < 20) Sound.mob(this.type, 'idle', this.pos); }
    if (this.attackCd > 0) this.attackCd--;
    // Ambient particles & water allergy for Blaze / Enderman
    if (this.type === 'blaze') {
      if (this.inWater && this.age % 20 === 0) this.hurt(1, { type: 'drown' });
      if (this.game && this.game.particles && this.age % 3 === 0) {
        this.game.particles.spawn('smoke', this.pos[0] + (Math.random() - 0.5) * 0.5, this.pos[1] + 0.3 + Math.random() * 1.2, this.pos[2] + (Math.random() - 0.5) * 0.5, 0, 0.02, 0);
        if (this.charging || Math.random() < 0.35) {
          this.game.particles.spawn('flame', this.pos[0] + (Math.random() - 0.5) * 0.6, this.pos[1] + 0.4 + Math.random() * 1.1, this.pos[2] + (Math.random() - 0.5) * 0.6, 0, 0.015, 0);
        }
      }
    } else if (this.type === 'enderman') {
      if (this.inWater && this.age % 20 === 0) {
        this.hurt(1, { type: 'drown' });
        this.teleportRandomly(16);
      }
      if (this.game && this.game.particles && this.age % 2 === 0) {
        this.game.particles.spawn('portal', this.pos[0] + (Math.random() - 0.5) * 0.7, this.pos[1] + Math.random() * 2.6, this.pos[2] + (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.04);
      }
    }

    const playerOk = p.deathTime === 0 && !p.creative;
    const aggroRange = this.type === 'ghast' ? 48 : this.type === 'blaze' ? 28 : 16;
    if (this.angerTicks > 0) {
      this.angerTicks--;
      if (this.angerTicks <= 0 && T.neutral) this.target = null;
    }
    if (this.type === 'enderman' && !this.target && playerOk && dP < 32 && this.age % 5 === 0) {
      // Check if player is staring directly at the Enderman's head
      const ld = g.lookDir ? g.lookDir() : [0, 0, -1];
      const vx = this.pos[0] - p.pos[0], vy = (this.pos[1] + 2.5) - (p.pos[1] + p.eye()), vz = this.pos[2] - p.pos[2];
      const vl = Math.hypot(vx, vy, vz) || 1;
      const dot = (vx * ld[0] + vy * ld[1] + vz * ld[2]) / vl;
      if (dot > 0.992 && this.canSee(p)) {
        this.target = p;
        this.angerTicks = 600;
      }
    }
    if (T.hostile) {
      if (this.type === 'spider' && day && !this.target) { }
      else if (playerOk && dP < aggroRange && (!this.target || this.target === p)) this.target = p;
      if (this.target && (this.target.dead || this.target.deathTime > 0 || (this.target === p && (!playerOk || dP > aggroRange + 12)))) this.target = null;
      if (this.type === 'spider' && day && this.target && !this.provoked && this.age % 100 === 0) this.target = null;
    } else if (T.neutral && this.target) {
      if (this.target.dead || this.target.deathTime > 0 || (this.target === p && (!playerOk || dP > 40))) {
        this.target = null;
        this.angerTicks = 0;
      }
    }

    // Ender Dragon Boss AI (HoldingPattern -> StrafeFireball / ChargingPlayer -> LandingApproach -> Landing -> Sitting Perch -> TakeOff)
    if (this.type === 'ender_dragon') {
      this.phaseTicks = (this.phaseTicks || 0) + 1;
      // 1. Link to nearest alive EndCrystal within 32 blocks and heal +1 HP every 10 ticks (2 HP/s)
      let nearestCrystal = null, bestCDist = 32, aliveCrystalCount = 0;
      for (const e of g.entities) {
        if (e instanceof EndCrystal && !e.dead) {
          aliveCrystalCount++;
          const cd = this.distTo(e);
          if (cd < bestCDist) { bestCDist = cd; nearestCrystal = e; }
        }
      }
      this.healingCrystal = nearestCrystal;
      if (nearestCrystal) {
        if (this.age % 10 === 0 && this.health < this.maxHealth) {
          this.health = Math.min(this.maxHealth, this.health + 1);
        }
        if (g.particles && this.age % 2 === 0) {
          const tFrac = Math.random();
          const bx = lerp(nearestCrystal.pos[0], this.pos[0], tFrac);
          const by = lerp(nearestCrystal.pos[1] + 0.8, this.pos[1] + 1.5, tFrac);
          const bz = lerp(nearestCrystal.pos[2], this.pos[2], tFrac);
          g.particles.spawn('portal', bx, by, bz, 0, 0.02, 0);
        }
      }

      // Helper: re-sync orbitAngle to current dragon position when returning to circling so it never rubber-bands across the island!
      const enterCircling = () => {
        this.phase = 'circling';
        this.phaseTicks = 0;
        this.perchDamageTaken = 0;
        this.orbitAngle = Math.atan2(this.pos[2] - 0.5, this.pos[0] - 0.5);
      };

      // 2. Perching / Landing / Sitting on Central Bedrock Pillar (0.5, 63.0, 0.5)
      if (this.phase === 'landing' || this.phase === 'perching') {
        const px = 0.5, py = 63.0, pz = 0.5;
        const dx = px - this.pos[0], dy = py - this.pos[1], dz = pz - this.pos[2];
        const dist = Math.hypot(dx, dy, dz);
        if (dist > 0.45) {
          // Smooth constant-speed descent (0.38 blocks/tick = 7.6 blocks/sec) instead of proportional teleporting!
          const step = Math.min(dist, 0.38);
          this.vel = [(dx / dist) * step, (dy / dist) * step, (dz / dist) * step];
          this.pos[0] += this.vel[0];
          this.pos[1] += this.vel[1];
          this.pos[2] += this.vel[2];
          this.turnTo(Math.atan2(-dx, -dz), 0.14);
          // Do not expire sitting timer while still flying toward the pillar
          if (this.phase === 'landing' && dist <= 0.45) {
            this.phase = 'perching';
            this.phaseTicks = 0;
          }
        } else {
          if (this.phase === 'landing') {
            this.phase = 'perching';
            this.phaseTicks = 0;
          }
          this.pos[0] = px; this.pos[1] = py; this.pos[2] = pz;
          this.vel = [0, 0, 0];
          const pdx = p.pos[0] - this.pos[0], pdz = p.pos[2] - this.pos[2];
          this.turnTo(Math.atan2(-pdx, -pdz), 0.12);
          // Breathe purple dragon breath particles in front of head & damage player if standing in breath cone
          if (g.particles && this.age % 2 === 0) {
            const fx = this.pos[0] - Math.sin(this.yaw) * 3.2, fz = this.pos[2] - Math.cos(this.yaw) * 3.2;
            g.particles.spawn('portal', fx + (Math.random() - 0.5) * 1.4, this.pos[1] + 0.8 + (Math.random() - 0.5) * 0.5, fz + (Math.random() - 0.5) * 1.4, -Math.sin(this.yaw) * 0.14, -0.02, -Math.cos(this.yaw) * 0.14);
          }
          if (playerOk && this.phaseTicks > 20 && this.phaseTicks % 15 === 0) {
            const bx = this.pos[0] - Math.sin(this.yaw) * 3.0, bz = this.pos[2] - Math.cos(this.yaw) * 3.0;
            if (Math.hypot(p.pos[0] - bx, p.pos[2] - bz) < 2.8 && Math.abs(p.pos[1] - this.pos[1]) < 3.0) {
              p.hurt(4, { type: 'magic', attacker: this });
            }
          }
          // Sit for 120 ticks (6 seconds) on the pillar (or leave early if >= 50 HP damage taken)
          if (this.phaseTicks >= 120) {
            enterCircling();
          }
        }
        this.bodyYaw = this.yaw;
        return;
      }

      if (this.phase === 'charging') {
        if (!this.chargeTarget) this.chargeTarget = [p.pos[0], Math.max(59, p.pos[1] + 0.5), p.pos[2]];
        const [tx, ty, tz] = this.chargeTarget;
        const dx = tx - this.pos[0], dy = ty - this.pos[1], dz = tz - this.pos[2];
        const dist = Math.hypot(dx, dy, dz) || 1;
        const sp = Math.min(dist, 0.55);
        this.vel = [(dx / dist) * sp, (dy / dist) * sp, (dz / dist) * sp];
        this.pos[0] += this.vel[0];
        this.pos[1] += this.vel[1];
        this.pos[2] += this.vel[2];
        this.turnTo(Math.atan2(-dx, -dz), 0.22);
        this.bodyYaw = this.yaw;
        if (playerOk && this.distTo(p) < 3.8 && this.attackCd <= 0) {
          this.attackCd = 25;
          p.hurt(this.T.attack, { type: 'mob', attacker: this, knockFrom: this.pos, knock: 1.1 });
        }
        if (dist < 2.0 || this.phaseTicks >= 80) {
          this.chargeTarget = null;
          enterCircling();
        }
        return;
      }

      // Default Phase: 'circling' (HoldingPatternPhase) around (0.5, 76, 0.5) at radius 28
      if (this.orbitAngle === undefined) {
        this.orbitAngle = Math.atan2(this.pos[2] - 0.5, this.pos[0] - 0.5);
      }
      // Advance orbitAngle only when close to current waypoint so the dragon follows the ring smoothly
      const ox = 0.5 + Math.cos(this.orbitAngle) * 28;
      const oy = 75 + Math.sin(this.orbitAngle * 2) * 3.5;
      const oz = 0.5 + Math.sin(this.orbitAngle) * 28;
      const dx = ox - this.pos[0], dy = oy - this.pos[1], dz = oz - this.pos[2];
      const dist = Math.hypot(dx, dy, dz) || 1;
      if (dist < 6.0) {
        this.orbitAngle += 0.022;
      }
      const sp = Math.min(dist, 0.42);
      const tvx = (dx / dist) * sp, tvy = (dy / dist) * sp, tvz = (dz / dist) * sp;
      this.vel[0] = lerp(this.vel[0] || 0, tvx, 0.18);
      this.vel[1] = lerp(this.vel[1] || 0, tvy, 0.18);
      this.vel[2] = lerp(this.vel[2] || 0, tvz, 0.18);
      this.pos[0] += this.vel[0];
      this.pos[1] += this.vel[1];
      this.pos[2] += this.vel[2];
      this.turnTo(Math.atan2(-this.vel[0], -this.vel[2]), 0.12);
      this.bodyYaw = this.yaw;

      // Shoot DragonFireball at player every 110 ticks while circling
      if (playerOk && dP < 64 && this.phaseTicks % 110 === 60) {
        this.shootDragonFireball(p);
      }

      // Evaluate phase transition every 280 ticks (14 seconds) per vanilla HoldingPatternPhase:
      // Perch chance increases as End Crystals are destroyed: 1 / (3 + aliveCrystalCount)
      if (this.phaseTicks >= 280) {
        this.cycleCount = (this.cycleCount || 0) + 1;
        const perchChance = 1 / (3 + aliveCrystalCount);
        if (Math.random() < perchChance || this.cycleCount >= 3 + Math.min(2, aliveCrystalCount)) {
          this.phase = 'landing';
          this.phaseTicks = 0;
          this.perchDamageTaken = 0;
          this.cycleCount = 0;
        } else {
          this.phase = 'charging';
          this.phaseTicks = 0;
          this.chargeTarget = [p.pos[0], Math.max(59, p.pos[1] + 0.5), p.pos[2]];
        }
      }
      return;
    }

    // Ghast 3D floating flight & fireball shooting
    if (this.type === 'ghast') {
      if (!this.flyTarget || this.age % 60 === 0 || Math.hypot(this.flyTarget[0] - this.pos[0], this.flyTarget[1] - this.pos[1], this.flyTarget[2] - this.pos[2]) < 2.5) {
        const tx = this.pos[0] + (Math.random() - 0.5) * 24;
        const ty = clamp(this.pos[1] + (Math.random() - 0.5) * 14, 38, 106);
        const tz = this.pos[2] + (Math.random() - 0.5) * 24;
        this.flyTarget = [tx, ty, tz];
      }
      const fx = this.flyTarget[0] - this.pos[0], fy = this.flyTarget[1] - this.pos[1], fz = this.flyTarget[2] - this.pos[2];
      const fd = Math.hypot(fx, fy, fz) || 1;
      this.vel[0] = this.vel[0] * 0.9 + (fx / fd) * 0.018;
      this.vel[1] = this.vel[1] * 0.9 + (fy / fd) * 0.015;
      this.vel[2] = this.vel[2] * 0.9 + (fz / fd) * 0.018;
      this.move(this.vel[0], this.vel[1], this.vel[2]);
      if (this.target && dP < 48 && this.canSee(this.target)) {
        const t = this.target;
        const dx = t.pos[0] - this.pos[0], dz = t.pos[2] - this.pos[2];
        this.turnTo(Math.atan2(-dx, -dz), 0.25);
        if (this.attackCd <= 0) this.attackCd = 60;
        this.charging = this.attackCd <= 20;
        if (this.attackCd === 1) {
          this.shootGhastFireball(t);
          this.attackCd = 65;
          this.charging = false;
        }
      } else {
        this.charging = false;
        this.turnTo(Math.atan2(-this.vel[0], -this.vel[2]), 0.15);
      }
      this.bodyYaw = this.yaw;
      return;
    }

    if (this.target) {
      const t = this.target;
      const dx = t.pos[0] - this.pos[0], dz = t.pos[2] - this.pos[2], d = Math.hypot(dx, dz);
      const want = Math.atan2(-dx, -dz);
      lookAt = t;
      if (this.type === 'blaze') {
        this.turnTo(want, 0.35);
        if (d > 10) fwd = 1; else if (d < 4) fwd = -0.4;
        // Hover toward player's eye level + 0.8
        const wantY = t.pos[1] + 0.8;
        if (this.pos[1] < wantY) this.vel[1] = Math.min(0.14, this.vel[1] + 0.035);
        if (this.blazeBurst > 0) {
          this.charging = true;
          if (--this.blazeBurstCd <= 0) {
            this.shootBlazeFireball(t);
            this.blazeBurst--;
            this.blazeBurstCd = 6;
            if (this.blazeBurst <= 0) { this.charging = false; this.attackCd = 80; }
          }
        } else if (this.attackCd <= 0 && d < 24 && this.canSee(t)) {
          this.charging = true;
          this.blazeBurst = 3;
          this.blazeBurstCd = 20;
        }
      } else if (T.ranged) {
        this.turnTo(want, 0.3);
        if (d > 10) fwd = 1; else if (d < 5) fwd = -0.6;
        if (this.attackCd <= 0 && d < 16 && this.canSee(t)) { this.shoot(t); this.attackCd = 40 + Math.floor(Math.random() * 20); }
      } else if (this.type === 'creeper') {
        this.turnTo(want, 0.4);
        if (dP < 3 && this.canSee(t)) { if (this.fuse < 0) { this.fuse = 0; Sound.fuse(this.pos); } }
        else if (dP > 7 && this.fuse >= 0) this.fuse = Math.max(-1, this.fuse - 2);
        if (this.fuse < 0) fwd = 1;
      } else {
        this.turnTo(want, 0.4);
        fwd = 1;
        if (this.type === 'zombified_piglin' || this.type === 'enderman') mod = 1.35;
        if (this.type === 'enderman' && d > 14 && Math.random() < 0.025) this.teleportRandomly(12);
        if (this.type === 'spider' && this.onGround && d < 4 && d > 1.5 && Math.random() < 0.1) { this.vel[1] = 0.4; this.vel[0] += dx / d * 0.3; this.vel[2] += dz / d * 0.3; }
        const reach = this.w / 2 + t.w / 2 + 0.65;
        if (d < reach && Math.abs(t.pos[1] - this.pos[1]) < 2.2 && this.attackCd <= 0) {
          this.attackCd = 20; this.swingT = 6;
          const hit = t.hurt(T.attack, { type: 'mob', attacker: this, knockFrom: this.pos });
          if (hit && this.type === 'wither_skeleton' && t.applyEffect) {
            t.applyEffect('wither', 200, 0); // 10 seconds of Wither I
          }
        }
      }
    } else if (this.panic > 0) {
      this.panic--;
      mod = 1.6;
      if (!this.wander || this.wanderT <= 0 || this.age % 20 === 0) this.pickWander(6);
    } else {
      // follow player holding food
      const held = p.inv.held;
      if (T.passive && held && T.food && held.id === item(T.food) && dP < 8 && dP > 2) {
        lookAt = p;
        this.turnTo(Math.atan2(-(p.pos[0] - this.pos[0]), -(p.pos[2] - this.pos[2])), 0.3);
        fwd = 1;
      } else if (dP < 8 && Math.random() < 0.02) lookAt = p;
    }
    if (this.creeperTick()) return;
    if (!this.target && fwd === 0) {
      if (this.wander) {
        this.wanderT--;
        const dx = this.wander[0] - this.pos[0], dz = this.wander[2] - this.pos[2];
        if (Math.hypot(dx, dz) < 0.8 || this.wanderT <= 0) this.wander = null;
        else { this.turnTo(Math.atan2(-dx, -dz), 0.25); fwd = 1; }
      } else if (Math.random() < (this.panic > 0 ? 1 : 0.008)) this.pickWander(10);
    }
    // obstacle avoidance: don't walk off cliffs or into lava
    if (fwd > 0) {
      const ax = this.pos[0] - Math.sin(this.yaw) * (this.w / 2 + 0.5), az = this.pos[2] - Math.cos(this.yaw) * (this.w / 2 + 0.5);
      const fx = Math.floor(ax), fz = Math.floor(az), fy = Math.floor(this.pos[1]);
      let drop = 0;
      while (drop < 5 && !BLOCKS[this.world.getBlock(fx, fy - 1 - drop, fz)].solid && !IS_FLUID[this.world.getBlock(fx, fy - 1 - drop, fz)]) drop++;
      const danger = this.world.getBlock(fx, fy - 1 - drop, fz) === LAVA || this.world.getBlock(fx, fy, fz) === LAVA;
      if (danger || (drop > 3 && !this.target)) { fwd = 0; this.wander = null; }
      if (this.collidedH && this.onGround) jump = true;
      if (this.collidedH && T.climbs) { this.vel[1] = 0.2; this.fallDist = 0; }
    }
    if (this.inWater && (this.vel[1] < 0.02 || this.collidedH)) jump = true;
    // stuck detection
    if (fwd > 0 && Math.hypot(this.pos[0] - this.prev[0], this.pos[2] - this.prev[2]) < 0.01) { if (++this.stuck > 30) { this.yaw += (Math.random() - 0.5) * 2; this.stuck = 0; this.wander = null; } }
    else this.stuck = 0;
    if (jump && this.onGround) this.vel[1] = 0.42;
    const speed = T.speed * T.speed * mod * (this.fuse >= 0 ? 0.4 : 1);
    this.travel(fwd, 0, speed, jump);
    // body/head rotation
    let d = this.yaw - this.bodyYaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    this.bodyYaw += d * 0.3;
    if (lookAt) {
      const dx = lookAt.pos[0] - this.pos[0], dz = lookAt.pos[2] - this.pos[2];
      let hy = Math.atan2(-dx, -dz) - this.bodyYaw; while (hy > Math.PI) hy -= Math.PI * 2; while (hy < -Math.PI) hy += Math.PI * 2;
      this.headYaw += (clamp(hy, -1.2, 1.2) - this.headYaw) * 0.3;
      const dy = (lookAt.pos[1] + (lookAt.eyeH || 1)) - (this.pos[1] + this.h * 0.85);
      this.pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.8, 0.8);
    } else { this.headYaw *= 0.9; this.pitch *= 0.9; }
    // chickens lay eggs
    if (this.type === 'chicken' && --this.eggT < 0) { this.eggT = 6000 + Math.random() * 6000; this.game.dropItem(this.pos[0], this.pos[1] + 0.3, this.pos[2], makeStack('egg', 1)); Sound.pop(this.pos); }
    // sheep eat grass to regrow wool
    if (this.type === 'sheep' && this.sheared && Math.random() < 0.002) {
      const bx = Math.floor(this.pos[0]), by = Math.floor(this.pos[1] - 0.5), bz = Math.floor(this.pos[2]);
      if (this.world.getBlock(bx, by, bz) === 2) { this.world.setBlock(bx, by, bz, 3, 0); this.sheared = false; this.eatT = 40; }
    }
    if (this.eatT > 0) this.eatT--;
    if (this.loveT > 0) { this.loveT--; if (this.age % 10 === 0) this.game.particles.spawn('heart', this.pos[0] + (Math.random() - 0.5) * this.w, this.pos[1] + this.h, this.pos[2] + (Math.random() - 0.5) * this.w, 0, 0.02, 0); }
    if (this.baby && --this.growT <= 0) { this.baby = false; this.w = this.T.w; this.h = this.T.h; }
    if (this.swingT > 0) this.swingT--;
    this.animate();
  }
  makeBaby() { this.baby = true; this.growT = 6000; this.w = this.T.w * 0.5; this.h = this.T.h * 0.5; return this; }
  creeperTick() {
    if (this.type !== 'creeper' || this.fuse < 0) { this.prevFuse = this.fuse; return false; }
    this.prevFuse = this.fuse;
    this.fuse++;
    if (this.fuse >= 30) {
      this.dead = true;
      this.game.explode(this.pos[0], this.pos[1] + 0.8, this.pos[2], 3, this);
      return true;
    }
    return false;
  }
  turnTo(a, rate) {
    let d = a - this.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += clamp(d, -rate, rate);
  }
  pickWander(r) {
    const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * r;
    this.wander = [this.pos[0] + Math.sin(a) * d, this.pos[1], this.pos[2] + Math.cos(a) * d];
    this.wanderT = 120;
  }
  canSee(t) {
    const a = [this.pos[0], this.pos[1] + this.h * 0.85, this.pos[2]], b = [t.pos[0], t.pos[1] + (t.eyeH || 1), t.pos[2]];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.ceil(d * 2);
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const id = this.world.getBlock(Math.floor(lerp(a[0], b[0], k)), Math.floor(lerp(a[1], b[1], k)), Math.floor(lerp(a[2], b[2], k)));
      if (SOLIDCUBE[id]) return false;
    }
    return true;
  }
  shoot(t) {
    const sx = this.pos[0], sy = this.pos[1] + 1.5, sz = this.pos[2];
    const dx = t.pos[0] - sx, dz = t.pos[2] - sz, dist = Math.hypot(dx, dz);
    const dy = t.pos[1] + 1.2 - sy + dist * 0.2 * 0.5;
    const l = Math.hypot(dx, dy, dz);
    const sp = 1.6, err = 0.08;
    const a = new Arrow(this.game, sx, sy, sz, [dx / l * sp + (Math.random() - 0.5) * err, dy / l * sp + (Math.random() - 0.5) * err, dz / l * sp + (Math.random() - 0.5) * err], this);
    this.game.addEntity(a);
    Sound.bow(this.pos);
    this.swingT = 6;
  }
  shootBlazeFireball(t) {
    const sx = this.pos[0], sy = this.pos[1] + 1.1, sz = this.pos[2];
    const dx = t.pos[0] - sx, dy = (t.pos[1] + 0.9) - sy, dz = t.pos[2] - sz;
    const l = Math.hypot(dx, dy, dz) || 1;
    const sp = 0.65;
    const fb = new BlazeFireball(this.game, sx, sy, sz, [dx / l * sp + (Math.random() - 0.5) * 0.05, dy / l * sp + (Math.random() - 0.5) * 0.05, dz / l * sp + (Math.random() - 0.5) * 0.05], this);
    this.game.addEntity(fb);
    if (typeof Sound !== 'undefined' && Sound.fizz) Sound.fizz(this.pos);
  }
  shootGhastFireball(t) {
    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
    const sx = this.pos[0] + fwdX * 2.2, sy = this.pos[1] + 1.4, sz = this.pos[2] + fwdZ * 2.2;
    const dx = t.pos[0] - sx, dy = (t.pos[1] + 0.8) - sy, dz = t.pos[2] - sz;
    const l = Math.hypot(dx, dy, dz) || 1;
    const sp = 0.72;
    const fb = new GhastFireball(this.game, sx, sy, sz, [dx / l * sp, dy / l * sp, dz / l * sp], this);
    this.game.addEntity(fb);
    if (typeof Sound !== 'undefined' && Sound.fizz) Sound.fizz(this.pos);
  }
  shootDragonFireball(t) {
    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
    const sx = this.pos[0] + fwdX * 2.8, sy = this.pos[1] + 1.2, sz = this.pos[2] + fwdZ * 2.8;
    const dx = t.pos[0] - sx, dy = (t.pos[1] + 0.5) - sy, dz = t.pos[2] - sz;
    const l = Math.hypot(dx, dy, dz) || 1;
    const sp = 0.75;
    const dfb = new DragonFireball(this.game, sx, sy, sz, [dx / l * sp, dy / l * sp, dz / l * sp], this);
    this.game.addEntity(dfb);
    if (typeof Sound !== 'undefined' && Sound.fizz) Sound.fizz(this.pos);
  }
  pose(a) {
    const swing = lerp(this.limbSwing - this.limbAmt, this.limbSwing, a) * 0.6662, amt = this.limbAmt;
    const l = Math.cos(swing) * 1.4 * amt, r = Math.cos(swing + Math.PI) * 1.4 * amt;
    const P = { head: { ry: this.headYaw, rx: this.pitch } };
    switch (this.T.model) {
      case 'zombie': case 'skeleton': {
        const isMeleeArmed = this.type === 'wither_skeleton' || this.type === 'zombified_piglin';
        const raise = this.type === 'zombie' ? Math.PI / 2 : (this.target ? (isMeleeArmed ? 0.65 : Math.PI / 2) : (isMeleeArmed ? 0.2 : 0));
        const atk = this.swingT > 0 ? Math.sin(this.swingT / 6 * Math.PI) * 0.8 : 0;
        P.rarm = { rx: raise + (this.type === 'zombie' ? 0 : r * 0.5) + atk };
        P.larm = { rx: (this.type === 'zombie' ? raise : 0) + (this.type === 'zombie' ? 0 : l * 0.5) + (this.type === 'zombie' ? atk : 0) };
        P.rleg = { rx: l }; P.lleg = { rx: r };
        break;
      }
      case 'blaze': {
        const t = (this.age + a) * 0.12;
        for (let i = 0; i < 4; i++) {
          const ang = t + i * Math.PI / 2;
          P['rod' + i] = { t: [Math.cos(ang) * 0.48, Math.sin(t * 2 + i) * 0.08, Math.sin(ang) * 0.48], ry: -ang };
        }
        for (let i = 4; i < 8; i++) {
          const ang = -t * 0.8 + (i - 4) * Math.PI / 2 + 0.4;
          P['rod' + i] = { t: [Math.cos(ang) * 0.36, Math.cos(t * 1.7 + i) * 0.07, Math.sin(ang) * 0.36], ry: -ang };
        }
        for (let i = 8; i < 12; i++) {
          const ang = t * 0.6 + (i - 8) * Math.PI / 2 + 0.9;
          P['rod' + i] = { t: [Math.cos(ang) * 0.24, Math.sin(t * 1.4 + i) * 0.05, Math.sin(ang) * 0.24], ry: -ang };
        }
        break;
      }
      case 'ghast': {
        const t = (this.age + a) * 0.15;
        for (let i = 0; i < 9; i++) {
          P['tentacle' + i] = { rx: 0.25 + Math.sin(t + i * 1.3) * 0.3 };
        }
        break;
      }
      case 'ender_dragon': {
        const t = (this.age + a) * (this.phase === 'perching' ? 0.16 : 0.26);
        const flap = Math.sin(t) * 0.58;
        const wave = Math.cos(t) * 0.08;
        P.wing_r = { rz: flap, rx: Math.cos(t) * 0.12 };
        P.wing_l = { rz: -flap, rx: Math.cos(t) * 0.12 };
        for (let i = 0; i < 5; i++) {
          const nw = Math.sin(t - i * 0.35) * 0.07;
          P['neck' + i] = { rx: nw + wave * (0.3 + i * 0.18), t: [0, Math.sin(t - i * 0.3) * 0.08 * (i + 1), 0] };
        }
        P.head = { rx: wave * 1.2 + this.pitch * 0.35, ry: this.headYaw * 0.4, t: [0, Math.sin(t - 1.6) * 0.35, 0] };
        P.jaw = { rx: 0.16 + Math.abs(Math.sin(t * 0.85)) * 0.28, t: [0, Math.sin(t - 1.6) * 0.35, 0] };
        for (let i = 0; i < 12; i++) {
          const tw = Math.sin(t * 0.7 - i * 0.32) * 0.06;
          P['tail' + i] = {
            rx: -wave * (0.25 + i * 0.08) + tw,
            ry: Math.sin(t * 0.5 - i * 0.28) * (0.04 + i * 0.015),
            t: [Math.sin(t * 0.5 - i * 0.28) * 0.04 * i, -Math.cos(t * 0.7 - i * 0.32) * 0.04 * i, 0]
          };
        }
        const legSwing = Math.sin(t) * 0.15;
        P.front_leg_r = { rx: legSwing };
        P.front_leg_l = { rx: legSwing };
        P.hind_leg_r = { rx: -legSwing * 0.8 };
        P.hind_leg_l = { rx: -legSwing * 0.8 };
        break;
      }
      case 'enderman': {
        const atk = this.swingT > 0 ? Math.sin(this.swingT / 6 * Math.PI) * 0.7 : 0;
        if (this.target) P.head.t = [(Math.random() - 0.5) * 0.03, 0.14, (Math.random() - 0.5) * 0.03];
        P.rarm = { rx: r * 0.45 + atk };
        P.larm = { rx: l * 0.45 + atk };
        P.rleg = { rx: l * 0.45 };
        P.lleg = { rx: r * 0.45 };
        break;
      }
      case 'villager': P.rleg = { rx: l }; P.lleg = { rx: r }; break;
      case 'creeper': P.leg0 = { rx: l }; P.leg1 = { rx: r }; P.leg2 = { rx: r }; P.leg3 = { rx: l }; break;
      case 'chicken': {
        P.leg0 = { rx: l }; P.leg1 = { rx: r };
        const flap = this.onGround ? 0 : Math.sin(this.age * 1.5) * 0.8 + 0.8;
        P.wing0 = { rz: -flap }; P.wing1 = { rz: flap };
        break;
      }
      case 'spider': {
        for (let i = 0; i < 8; i++) {
          const right = i % 2 === 0, row = i >> 1;
          const spread = [0.7, 0.3, -0.3, -0.7][row];
          const ph = Math.cos(swing * 2 + (row % 2 ? Math.PI : 0) + (right ? 0 : Math.PI)) * 0.4 * amt;
          P['leg' + i] = { ry: (right ? -spread : spread) + ph, rz: right ? -0.6 + Math.abs(ph) * 0.3 : 0.6 - Math.abs(ph) * 0.3 };
        }
        break;
      }
      default:
        P.leg0 = { rx: l }; P.leg1 = { rx: r }; P.leg2 = { rx: r }; P.leg3 = { rx: l };
        if (this.type === 'sheep' && this.eatT > 0) P.head.rx = -0.9;
    }
    return P;
  }
}

// ---------------------------------------------------------------------------
// Item entity
// ---------------------------------------------------------------------------
class ItemEntity extends Entity {
  constructor(game, x, y, z, stack, vel) {
    super(game, x, y, z, 0.25, 0.25);
    this.stack = stack; this.pickup = 10; this.bobOff = Math.random() * Math.PI * 2;
    if (vel) this.vel = vel; else this.vel = [(Math.random() - 0.5) * 0.2, 0.2, (Math.random() - 0.5) * 0.2];
  }
  tick() {
    this.savePrev();
    this.age++;
    if (this.pickup > 0) this.pickup--;
    this.updateFluids();
    const v = this.vel;
    if (this.inWater) { v[1] += 0.01; v[0] *= 0.9; v[2] *= 0.9; v[1] *= 0.9; }
    else v[1] -= 0.04;
    if (this.collides(this.box())) { this.pos[1] += 0.1; v[1] = 0.1; }
    this.move(v[0], v[1], v[2]);
    const f = this.onGround ? 0.6 * 0.98 : 0.98;
    v[0] *= f; v[2] *= f; v[1] *= 0.98;
    if (this.onGround) v[1] *= -0.5;
    if (this.inLava) { this.dead = true; Sound.fizz(this.pos); return; }
    if (this.age > 6000) this.dead = true;
    // merge
    if (this.age % 20 === 0) {
      for (const e of this.game.entities) {
        if (e === this || !(e instanceof ItemEntity) || e.dead || e.stack.id !== this.stack.id || ITEMS[e.stack.id].durability || (typeof Enchant !== 'undefined' && !Enchant.sameStackMeta(e.stack, this.stack))) continue;
        if (this.distTo(e) < 1.2 && this.stack.count + e.stack.count <= maxStack(this.stack.id)) { this.stack.count += e.stack.count; e.dead = true; }
      }
    }
    // pickup
    const p = this.game.player;
    if (this.pickup <= 0 && p.deathTime === 0) {
      const b = p.box();
      if (this.pos[0] > b[0] - 1 && this.pos[0] < b[3] + 1 && this.pos[1] > b[1] - 0.5 && this.pos[1] < b[4] + 0.5 && this.pos[2] > b[2] - 1 && this.pos[2] < b[5] + 1) {
        const left = p.inv.add(this.stack);
        if (left < this.stack.count) {
          this.game.onPickup(this.stack.id, this.stack.count - left);
          Sound.pop(this.pos);
          this.game.particles.pickupAnim(this, p);
        }
        if (left === 0) this.dead = true; else this.stack.count = left;
      }
    }
  }
}

class FallingBlock extends Entity {
  constructor(game, x, y, z, id, meta) { super(game, x + 0.5, y, z + 0.5, 0.98, 0.98); this.blockId = id; this.meta = meta; }
  tick() {
    this.savePrev(); this.age++;
    this.vel[1] = (this.vel[1] - 0.04) * 0.98;
    this.move(0, this.vel[1], 0);
    if (this.onGround || this.age > 600) {
      this.dead = true;
      const x = Math.floor(this.pos[0]), y = Math.floor(this.pos[1] + 0.5), z = Math.floor(this.pos[2]);
      const cur = this.world.getBlock(x, y, z);
      if (cur === 0 || REPLACEABLE[cur]) { this.world.setBlock(x, y, z, this.blockId, this.meta); Sound.block('place', BLOCKS[this.blockId].sound, this.pos); }
      else this.game.dropItem(this.pos[0], this.pos[1], this.pos[2], makeStack(this.blockId, 1));
    }
  }
}

class PrimedTNT extends Entity {
  constructor(game, x, y, z, fuse = 80) {
    super(game, x + 0.5, y, z + 0.5, 0.98, 0.98);
    this.fuse = fuse;
    const a = Math.random() * Math.PI * 2;
    this.vel = [-Math.sin(a) * 0.02, 0.2, -Math.cos(a) * 0.02];
    Sound.fuse(this.pos);
  }
  tick() {
    this.savePrev(); this.age++;
    this.updateFluids();
    this.vel[1] -= 0.04;
    this.move(this.vel[0], this.vel[1], this.vel[2]);
    this.vel[0] *= 0.98; this.vel[1] *= 0.98; this.vel[2] *= 0.98;
    if (this.onGround) { this.vel[0] *= 0.7; this.vel[2] *= 0.7; this.vel[1] *= -0.5; }
    if (Math.random() < 0.5) this.game.particles.spawn('smoke', this.pos[0], this.pos[1] + 1.1, this.pos[2], 0, 0.02, 0);
    if (--this.fuse <= 0) { this.dead = true; this.game.explode(this.pos[0], this.pos[1] + 0.49, this.pos[2], 4, this, this.inWater); }
  }
}

class Arrow extends Entity {
  constructor(game, x, y, z, vel, shooter) {
    super(game, x, y, z, 0.5, 0.5);
    this.vel = vel; this.shooter = shooter; this.stuck = false; this.life = 0;
    this.fromPlayer = shooter === game.player;
    this.updateRot();
  }
  breakSnowball() {
    for (let i = 0; i < 8; i++) this.game.particles.spawn('block', this.pos[0], this.pos[1], this.pos[2], (Math.random() - 0.5) * 0.2, Math.random() * 0.2, (Math.random() - 0.5) * 0.2, { id: 1, layer: ITEMS[this.snowball].tex });
    if (ITEMS[this.snowball].key === 'egg' && Math.random() < 0.125) { const c = new Mob(this.game, 'chicken', this.pos[0], this.pos[1], this.pos[2]).makeBaby(); c.persistent = true; this.game.addEntity(c); }
  }
  updateRot() { const v = this.vel; this.yaw = Math.atan2(-v[0], -v[2]); this.pitch = Math.atan2(v[1], Math.hypot(v[0], v[2])); }
  tick() {
    this.savePrev(); this.age++;
    if (this.stuck) {
      if (++this.life > 1200) this.dead = true;
      if (this.world.getBlock(...this.stuckAt) === 0) { this.stuck = false; }
      if (this.fromPlayer && !this.noPickup && this.age > 10) {
        const p = this.game.player;
        if (this.distTo(p) < 1.5 && p.inv.add(makeStack('arrow', 1)) === 0) { this.dead = true; Sound.pop(this.pos); }
      }
      return;
    }
    const v = this.vel;
    const steps = Math.ceil(Math.hypot(v[0], v[1], v[2]) / 0.25);
    for (let i = 0; i < steps; i++) {
      const nx = this.pos[0] + v[0] / steps, ny = this.pos[1] + v[1] / steps, nz = this.pos[2] + v[2] / steps;
      // Deflect GhastFireball or detonate EndCrystal on arrow hit
      for (const e of this.game.entities) {
        if (e instanceof GhastFireball && !e.dead && Math.hypot(nx - e.pos[0], ny - (e.pos[1] + 0.5), nz - e.pos[2]) < 1.0) {
          const sp = Math.hypot(v[0], v[1], v[2]) || 1;
          e.deflect(this.shooter || this.game.player, [v[0] / sp, v[1] / sp, v[2] / sp]);
          this.dead = true;
          return;
        }
        if (e instanceof EndCrystal && !e.dead) {
          const b = e.box();
          if (nx > b[0] - 0.2 && nx < b[3] + 0.2 && ny > b[1] - 0.2 && ny < b[4] + 0.2 && nz > b[2] - 0.2 && nz < b[5] + 0.2) {
            e.hurt(1, { type: 'arrow', attacker: this.shooter, player: this.fromPlayer });
            this.dead = true;
            return;
          }
        }
      }
      // entity hit
      for (const e of this.game.entities.concat([this.game.player])) {
        if (e === this.shooter || !(e instanceof Living) || e.deathTime > 0 || (this.age < 3 && e === this.shooter)) continue;
        const boxes = typeof e.subBoxes === 'function' ? e.subBoxes() : [e.box()];
        let hitBox = false;
        for (const b of boxes) {
          if (nx > b[0] - 0.15 && nx < b[3] + 0.15 && ny > b[1] && ny < b[4] && nz > b[2] - 0.15 && nz < b[5] + 0.15) {
            hitBox = true;
            break;
          }
        }
        if (hitBox) {
          let dmg = this.snowball ? 0 : Math.ceil(Math.hypot(v[0], v[1], v[2]) * 2);
          if (!this.snowball && this.powerLvl > 0) dmg = Math.ceil(dmg * (1 + 0.25 * (this.powerLvl + 1)));
          if (this.snowball) { this.breakSnowball(); }
          const knock = 0.3 + (this.punchLvl || 0) * 0.35;
          const arrowSrc = { type: 'arrow', attacker: this.shooter, sourcePos: [this.pos[0], this.pos[1], this.pos[2]], knockFrom: [this.pos[0] - v[0], 0, this.pos[2] - v[2]], knock, player: this.fromPlayer };
          const blockedByShield = !this.snowball && e === this.game.player && e.isBlocking && e.isBlocking() && e.isBlockedFromFront(arrowSrc);
          const perchedDragon = !this.snowball && e instanceof Mob && e.type === 'ender_dragon' && e.phase === 'perching';
          const didHurt = e.hurt(dmg, arrowSrc);
          if (blockedByShield || perchedDragon) {
            v[0] *= -0.4; v[1] = 0.15; v[2] *= -0.4;
            this.pos[0] += v[0] * 1.2;
            this.pos[2] += v[2] * 1.2;
            this.shooter = e;
            this.age = 0;
            this.fromPlayer = false;
            this.updateRot();
            return;
          }
          if (this.flame && didHurt) e.fire = Math.max(e.fire || 0, 100);
          Sound.arrowHit(this.pos);
          this.dead = true; return;
        }
      }
      const bx = Math.floor(nx), by = Math.floor(ny), bz = Math.floor(nz);
      const id = this.world.getBlock(bx, by, bz);
      if (id && (BLOCKS[id].solid || id === 159)) {
        if (id === 157) {
          this.world.setMeta(bx, by, bz, 15);
          this.world.schedule(bx, by, bz, 10);
          Redstone.propagateFromSource(this.game, bx, by, bz);
          this.game.flushMesh();
        } else if (id === 159) {
          const m = this.world.getMeta(bx, by, bz);
          if (!(m & 8)) {
            this.world.setMeta(bx, by, bz, m | 8);
            Sound.click();
            this.world.schedule(bx, by, bz, 30);
            Redstone.propagateFromSource(this.game, bx, by, bz);
            this.game.flushMesh();
          }
        }
        if (this.snowball) { this.breakSnowball(); this.dead = true; return; }
        this.stuck = true; this.stuckAt = [bx, by, bz];
        Sound.arrowHit(this.pos);
        return;
      }
      this.pos[0] = nx; this.pos[1] = ny; this.pos[2] = nz;
    }
    if (this.flame && !this.inWater && Math.random() < 0.6) {
      this.game.particles.spawn('flame', this.pos[0], this.pos[1], this.pos[2], 0, 0.01, 0);
    }
    this.updateFluids();
    if (this.inWater) this.flame = false;
    const drag = this.inWater ? 0.6 : 0.99;
    v[0] *= drag; v[1] = v[1] * drag - 0.05; v[2] *= drag;
    this.updateRot();
    if (this.age > 400) this.dead = true;
  }
}

class GhastFireball extends Entity {
  constructor(game, x, y, z, vel, shooter) {
    super(game, x, y, z, 1.0, 1.0);
    this.vel = vel ? [...vel] : [0, 0, 0];
    this.shooter = shooter;
    this.deflected = false;
  }
  deflect(byEntity, dir) {
    this.shooter = byEntity;
    this.deflected = true;
    const d = dir || (this.game && this.game.lookDir ? this.game.lookDir() : [0, 0, -1]);
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    this.vel = [(d[0] / l) * 1.15, (d[1] / l) * 1.15, (d[2] / l) * 1.15];
    this.age = 0;
    if (typeof Sound !== 'undefined' && Sound.fizz) Sound.fizz(this.pos);
    return true;
  }
  hurt(a, src) {
    if (src && (src.attacker === this.game.player || src.player)) {
      const dir = (this.game && this.game.lookDir) ? this.game.lookDir() : [-this.vel[0], -this.vel[1], -this.vel[2]];
      return this.deflect(this.game.player, dir);
    }
    return false;
  }
  tick() {
    this.savePrev();
    this.age++;
    if (this.age > 240) { this.dead = true; return; }
    const v = this.vel;
    const nx = this.pos[0] + v[0], ny = this.pos[1] + v[1], nz = this.pos[2] + v[2];
    if (this.game && this.game.particles) {
      this.game.particles.spawn('smoke', this.pos[0], this.pos[1] + 0.5, this.pos[2], 0, 0.02, 0);
      this.game.particles.spawn('flame', this.pos[0], this.pos[1] + 0.5, this.pos[2], 0, 0.01, 0);
    }
    // Check collision with living entities
    const targets = this.game.entities.concat([this.game.player]);
    for (const e of targets) {
      if (!e || e === this.shooter || !(e instanceof Living) || e.dead || e.deathTime > 0) continue;
      const b = e.box();
      if (nx > b[0] - 0.4 && nx < b[3] + 0.4 && ny + 0.5 > b[1] - 0.3 && ny + 0.5 < b[4] + 0.3 && nz > b[2] - 0.4 && nz < b[5] + 0.4) {
        if (this.deflected && e instanceof Mob && e.type === 'ghast') {
          // Return to Sender! Instant kill on Ghast when hit by deflected fireball
          e.hurt(1000, { type: 'fireball', attacker: this.shooter, player: true, knockFrom: this.pos });
        } else {
          e.hurt(6, { type: 'fireball', attacker: this.shooter, sourcePos: [...this.pos], knockFrom: this.pos, player: !!this.deflected });
        }
        this.dead = true;
        this.game.explode(this.pos[0], this.pos[1] + 0.5, this.pos[2], 1.2, this);
        return;
      }
    }
    const bx = Math.floor(nx), by = Math.floor(ny + 0.5), bz = Math.floor(nz);
    const bid = this.world.getBlock(bx, by, bz);
    if (bid && BLOCKS[bid] && BLOCKS[bid].solid) {
      this.dead = true;
      this.game.explode(this.pos[0], this.pos[1] + 0.5, this.pos[2], 1.2, this);
      return;
    }
    this.pos[0] = nx; this.pos[1] = ny; this.pos[2] = nz;
  }
}

class BlazeFireball extends Entity {
  constructor(game, x, y, z, vel, shooter) {
    super(game, x, y, z, 0.35, 0.35);
    this.vel = vel ? [...vel] : [0, 0, 0];
    this.shooter = shooter;
  }
  tick() {
    this.savePrev();
    this.age++;
    if (this.age > 160) { this.dead = true; return; }
    const v = this.vel;
    const nx = this.pos[0] + v[0], ny = this.pos[1] + v[1], nz = this.pos[2] + v[2];
    if (this.game && this.game.particles && this.age % 2 === 0) {
      this.game.particles.spawn('flame', this.pos[0], this.pos[1] + 0.2, this.pos[2], 0, 0.01, 0);
    }
    const targets = this.game.entities.concat([this.game.player]);
    for (const e of targets) {
      if (!e || e === this.shooter || !(e instanceof Living) || e.dead || e.deathTime > 0) continue;
      const b = e.box();
      if (nx > b[0] - 0.2 && nx < b[3] + 0.2 && ny + 0.2 > b[1] && ny + 0.2 < b[4] && nz > b[2] - 0.2 && nz < b[5] + 0.2) {
        const hit = e.hurt(5, { type: 'fireball', attacker: this.shooter, sourcePos: [...this.pos], knockFrom: this.pos });
        if (hit && !(e.hasEffect && e.hasEffect('fire_resistance'))) e.fire = Math.max(e.fire || 0, 100);
        this.dead = true;
        return;
      }
    }
    const bx = Math.floor(nx), by = Math.floor(ny + 0.2), bz = Math.floor(nz);
    const bid = this.world.getBlock(bx, by, bz);
    if (bid && BLOCKS[bid] && BLOCKS[bid].solid) {
      const py = by + 1;
      if (py < HEIGHT && this.world.getBlock(bx, py, bz) === 0) {
        this.world.setBlock(bx, py, bz, 537, 0); // ignite fire block (537)
      }
      this.dead = true;
      return;
    }
    this.pos[0] = nx; this.pos[1] = ny; this.pos[2] = nz;
  }
}

class EnderPearlEntity extends Entity {
  constructor(game, x, y, z, vel, thrower) {
    super(game, x, y, z, 0.25, 0.25);
    this.vel = vel ? [...vel] : [0, 0, 0];
    this.thrower = thrower;
  }
  teleportThrower(tx, ty, tz) {
    const p = this.thrower;
    if (!p || p.dead) return;
    const w = this.world;
    // Find a safe standing Y near (tx, ty, tz) so the player does not suffocate in blocks
    let sx = tx, sy = ty, sz = tz;
    const bx = Math.floor(sx), bz = Math.floor(sz);
    let by = Math.floor(sy);
    if (w.getBlock(bx, by, bz) && BLOCKS[w.getBlock(bx, by, bz)] && BLOCKS[w.getBlock(bx, by, bz)].solid) {
      if (!BLOCKS[w.getBlock(bx, by + 1, bz)].solid && !BLOCKS[w.getBlock(bx, by + 2, bz)].solid) {
        sy = by + 1;
      }
    }
    p.pos[0] = sx;
    p.pos[1] = sy;
    p.pos[2] = sz;
    p.prev = [...p.pos];
    p.vel = [0, 0, 0];
    p.fallDist = 0;
    if (this.game && this.game.particles) {
      for (let i = 0; i < 24; i++) {
        this.game.particles.spawn('portal', sx + (Math.random() - 0.5) * 1.1, sy + Math.random() * 1.8, sz + (Math.random() - 0.5) * 1.1, (Math.random() - 0.5) * 0.12, 0.03, (Math.random() - 0.5) * 0.12);
      }
    }
    if (typeof Sound !== 'undefined' && Sound.tone) Sound.tone([sx, sy, sz], { freq: 240, end: 520, dur: 0.16, vol: 0.28, type: 'sine' });
    // Per Minecraft Wiki: Ender Pearl teleportation deals 5 HP (2.5 hearts) of fall damage (reduced by Feather Falling)
    p.invuln = 0;
    p.hurt(5, { type: 'fall', enderPearl: true });
  }
  tick() {
    this.savePrev();
    this.age++;
    if (this.pos[1] < 0 || this.age > 240) {
      // Falling into the Void destroys the pearl without teleporting the player
      this.dead = true;
      return;
    }
    if (this.game && this.game.particles) {
      this.game.particles.spawn('portal', this.pos[0], this.pos[1] + 0.1, this.pos[2], (Math.random() - 0.5) * 0.04, -0.01, (Math.random() - 0.5) * 0.04);
    }
    const v = this.vel;
    const steps = Math.max(1, Math.ceil(Math.hypot(v[0], v[1], v[2]) / 0.25));
    for (let i = 0; i < steps; i++) {
      const nx = this.pos[0] + v[0] / steps, ny = this.pos[1] + v[1] / steps, nz = this.pos[2] + v[2] / steps;
      // Check entity collision (EndCrystal or Mob)
      for (const e of this.game.entities) {
        if (!e || e === this || e === this.thrower || e.dead) continue;
        if (e instanceof EndCrystal || e instanceof Living) {
          const b = e.box();
          if (nx > b[0] - 0.15 && nx < b[3] + 0.15 && ny > b[1] - 0.15 && ny < b[4] + 0.15 && nz > b[2] - 0.15 && nz < b[5] + 0.15) {
            if (e instanceof EndCrystal) e.hurt(1, { type: 'thrown', attacker: this.thrower, player: true });
            else e.hurt(0, { type: 'thrown', attacker: this.thrower, knockFrom: this.pos, player: true });
            this.teleportThrower(this.pos[0], this.pos[1], this.pos[2]);
            this.dead = true;
            return;
          }
        }
      }
      const bx = Math.floor(nx), by = Math.floor(ny), bz = Math.floor(nz);
      const bid = this.world.getBlock(bx, by, bz);
      if (bid === 539) {
        // Thrown into an End Portal / Exit Portal -> teleport player to portal
        this.teleportThrower(bx + 0.5, by + 0.1, bz + 0.5);
        this.dead = true;
        return;
      }
      if (bid && BLOCKS[bid] && BLOCKS[bid].solid) {
        this.teleportThrower(this.pos[0], this.pos[1], this.pos[2]);
        this.dead = true;
        return;
      }
      this.pos[0] = nx; this.pos[1] = ny; this.pos[2] = nz;
    }
    v[0] *= 0.99; v[1] = v[1] * 0.99 - 0.03; v[2] *= 0.99;
  }
}

class EyeOfEnderEntity extends Entity {
  constructor(game, x, y, z, targetX, targetY, targetZ) {
    super(game, x, y, z, 0.25, 0.25);
    this.targetX = targetX;
    this.targetY = targetY;
    this.targetZ = targetZ;
    const dx = targetX - x, dz = targetZ - z;
    const distH = Math.hypot(dx, dz) || 1;
    const travelDist = Math.min(12, distH);
    const ux = dx / distH, uz = dz / distH;
    // Per Minecraft Wiki: flies ~12 blocks toward nearest Stronghold; angles down when horizontally close (< 20 blocks)
    const destY = distH < 20 ? Math.max(targetY + 1, y - 2.5) : y + 3.5;
    this.dest = [x + ux * travelDist, destY, z + uz * travelDist];
    this.vel = [(this.dest[0] - x) / 36, (this.dest[1] - y) / 36, (this.dest[2] - z) / 36];
    this.shattered = false;
  }
  tick() {
    this.savePrev();
    this.age++;
    if (this.game && this.game.particles) {
      this.game.particles.spawn('portal', this.pos[0] + (Math.random() - 0.5) * 0.2, this.pos[1] + (Math.random() - 0.5) * 0.2, this.pos[2] + (Math.random() - 0.5) * 0.2, -this.vel[0] * 0.2, -0.02, -this.vel[2] * 0.2);
    }
    if (this.age <= 36) {
      const dx = this.dest[0] - this.pos[0], dy = this.dest[1] - this.pos[1], dz = this.dest[2] - this.pos[2];
      this.vel = [dx * 0.14, dy * 0.14, dz * 0.14];
      this.pos[0] += this.vel[0];
      this.pos[1] += this.vel[1];
      this.pos[2] += this.vel[2];
    } else {
      // Hover briefly at apex before dropping (80%) or shattering (20%)
      this.vel = [0, Math.sin(this.age * 0.4) * 0.01, 0];
      this.pos[1] += this.vel[1];
    }
    if (this.age >= 50) {
      this.dead = true;
      const shouldDrop = this.forceShatter ? false : (this.forceDrop ? true : Math.random() < 0.8);
      if (shouldDrop) {
        this.game.dropItem(this.pos[0], this.pos[1], this.pos[2], makeStack('eye_of_ender', 1), [0, -0.05, 0]);
        if (typeof Sound !== 'undefined' && Sound.pop) Sound.pop(this.pos);
      } else {
        this.shattered = true;
        if (this.game && this.game.particles) {
          for (let i = 0; i < 16; i++) {
            this.game.particles.spawn('portal', this.pos[0], this.pos[1], this.pos[2], (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25);
            this.game.particles.spawn('block', this.pos[0], this.pos[1], this.pos[2], (Math.random() - 0.5) * 0.2, Math.random() * 0.2, (Math.random() - 0.5) * 0.2, { id: 1, layer: T('i_ender_eye') });
          }
        }
        if (typeof Sound !== 'undefined' && Sound.block) Sound.block('break', 'glass', this.pos);
      }
    }
  }
}

class EndCrystal extends Entity {
  constructor(game, x, y, z) {
    super(game, x, y, z, 1.6, 1.6);
    this.persistent = true;
    this.bobPhase = Math.random() * Math.PI * 2;
  }
  tick() {
    this.savePrev();
    this.age++;
  }
  hurt(a, src) {
    if (this.dead) return false;
    this.dead = true;
    // Per Minecraft Wiki: destroying an End Crystal while it is healing the Ender Dragon deals 10 HP damage to the Dragon!
    for (const e of this.game.entities) {
      if (e instanceof Mob && !e.dead && !e.deathTime && e.type === 'ender_dragon') {
        if (e.healingCrystal === this || e.distTo(this) <= 32) {
          e.healingCrystal = null;
          e.invuln = 0;
          e.hurt(10, { type: 'crystal_explosion', attacker: (src && src.attacker) || this.game.player, player: true });
        }
      }
    }
    this.game.explode(this.pos[0], this.pos[1] + 0.6, this.pos[2], 6, this);
    // Also check if all crystals are gone or notify game
    return true;
  }
}

class DragonBreathCloud extends Entity {
  constructor(game, x, y, z, duration = 140) {
    super(game, x, y, z, 5.0, 1.2);
    this.duration = duration;
    this.radius = 2.6;
  }
  tick() {
    this.savePrev();
    this.age++;
    if (this.age >= this.duration) { this.dead = true; return; }
    if (this.game && this.game.particles) {
      for (let i = 0; i < 4; i++) {
        const ang = Math.random() * Math.PI * 2, r = Math.random() * this.radius;
        const px = this.pos[0] + Math.cos(ang) * r, pz = this.pos[2] + Math.sin(ang) * r;
        this.game.particles.spawn('portal', px, this.pos[1] + 0.15 + Math.random() * 0.4, pz, (Math.random() - 0.5) * 0.03, 0.015, (Math.random() - 0.5) * 0.03);
      }
    }
    if (this.age % 20 === 0 && this.game && this.game.player) {
      const p = this.game.player;
      if (p.deathTime === 0 && !p.creative && Math.hypot(p.pos[0] - this.pos[0], p.pos[2] - this.pos[2]) <= this.radius && Math.abs(p.pos[1] - this.pos[1]) < 2.0) {
        p.hurt(3, { type: 'dragon_breath' });
      }
    }
  }
}

class DragonFireball extends Entity {
  constructor(game, x, y, z, vel, shooter) {
    super(game, x, y, z, 0.8, 0.8);
    this.vel = vel ? [...vel] : [0, 0, 0];
    this.shooter = shooter;
  }
  detonate() {
    if (this.dead) return;
    this.dead = true;
    const by = Math.floor(this.pos[1]);
    let groundY = this.pos[1];
    for (let y = by; y >= Math.max(1, by - 4); y--) {
      const bid = this.world.getBlock(Math.floor(this.pos[0]), y - 1, Math.floor(this.pos[2]));
      if (bid && BLOCKS[bid] && BLOCKS[bid].solid) { groundY = y; break; }
    }
    this.game.addEntity(new DragonBreathCloud(this.game, this.pos[0], groundY, this.pos[2], 140));
    if (typeof Sound !== 'undefined' && Sound.explode) Sound.explode(this.pos);
  }
  tick() {
    this.savePrev();
    this.age++;
    if (this.age > 200) { this.dead = true; return; }
    if (this.game && this.game.particles) {
      this.game.particles.spawn('portal', this.pos[0], this.pos[1] + 0.3, this.pos[2], (Math.random() - 0.5) * 0.05, 0.02, (Math.random() - 0.5) * 0.05);
    }
    const v = this.vel;
    const nx = this.pos[0] + v[0], ny = this.pos[1] + v[1], nz = this.pos[2] + v[2];
    const p = this.game && this.game.player;
    if (p && p.deathTime === 0 && Math.hypot(nx - p.pos[0], ny - (p.pos[1] + 0.9), nz - p.pos[2]) < 1.2) {
      p.hurt(6, { type: 'dragon_breath', attacker: this.shooter, knockFrom: this.pos });
      this.detonate();
      return;
    }
    const bx = Math.floor(nx), by = Math.floor(ny), bz = Math.floor(nz);
    const bid = this.world.getBlock(bx, by, bz);
    if (bid && BLOCKS[bid] && BLOCKS[bid].solid) {
      this.detonate();
      return;
    }
    this.pos[0] = nx; this.pos[1] = ny; this.pos[2] = nz;
  }
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------
class Particles {
  constructor(game) { this.game = game; this.list = []; this.pickups = []; }
  spawn(type, x, y, z, vx, vy, vz, extra) {
    if (this.list.length > 3000) return;
    const p = { type, x, y, z, px: x, py: y, pz: z, vx, vy, vz, age: 0, life: 20, size: 0.1, grav: 0, layer: 0, u0: 0, v0: 0, us: 1, col: [255, 255, 255], bright: false, frames: 0, base: 0 };
    const r = Math.random;
    switch (type) {
      case 'block': {
        const b = BLOCKS[extra.id];
        p.layer = extra.layer ?? (b.texFn ? b.texFn.call(b, 0, extra.meta || 0) : b.particle);
        p.us = 0.25; p.u0 = r() * 0.75; p.v0 = r() * 0.75;
        p.life = 4 / (r() * 0.9 + 0.1); p.grav = 0.04; p.size = 0.05 + r() * 0.05;
        if (b.tint) { const t = extra.tint || [124, 189, 107]; p.col = t; }
        break;
      }
      case 'smoke': p.frames = 12; p.base = T('p_big_smoke_0'); p.life = 20 + r() * 20; p.size = 0.15 + r() * 0.15; p.grav = -0.002; p.col = [80, 80, 80]; break;
      case 'poof': p.frames = 8; p.base = T('p_generic_0'); p.life = 16 + r() * 8; p.size = 0.15 + r() * 0.1; p.col = [230, 230, 230]; p.reverse = true; break;
      case 'reddust': p.frames = 8; p.base = T('p_generic_0'); p.life = 10 + r() * 10; p.size = 0.05 + r() * 0.03; p.col = (extra && extra.col) || [235, 25, 25]; p.reverse = true; p.bright = true; break;
      case 'explosion': p.frames = 16; p.base = T('p_explosion_0'); p.life = 8 + r() * 8; p.size = 1 + r() * 0.8; p.bright = true; break;
      case 'flame': p.layer = T('p_flame'); p.life = 10 + r() * 10; p.size = 0.06 + r() * 0.04; p.bright = true; break;
      case 'lava': p.layer = T('p_lava'); p.life = 30; p.size = 0.08; p.grav = 0.04; p.bright = true; break;
      case 'splash': p.layer = T('p_splash_' + (r() * 4 | 0)); p.life = 10; p.size = 0.08; p.grav = 0.04; p.col = [80, 120, 230]; break;
      case 'bubble': p.layer = T('p_bubble'); p.life = 20 + r() * 20; p.size = 0.05; p.grav = -0.01; break;
      case 'crit': p.layer = T('p_critical_hit'); p.life = 12; p.size = 0.08; p.grav = 0.02; p.bright = true; break;
      case 'enchant_hit': p.layer = T('p_enchanted_hit'); p.life = 14; p.size = 0.09; p.grav = 0.02; p.bright = true; p.col = [160, 220, 255]; break;
      case 'heart': p.layer = T('p_heart'); p.life = 20; p.size = 0.15; p.grav = -0.005; p.bright = true; break;
      case 'note': p.layer = T('p_note'); p.life = 20; p.size = 0.15; p.bright = true; p.col = extra.col; break;
      case 'damage': p.layer = T('p_damage'); p.life = 15; p.size = 0.1; p.grav = 0.02; break;
      case 'glint': p.layer = T('p_glint'); p.life = 20; p.size = 0.08; p.bright = true; break;
      case 'bone_meal': p.layer = T('p_effect_' + (r() * 3 | 0)); p.life = 20; p.size = 0.08; p.col = [120, 220, 90]; p.bright = true; break;
      case 'potion': p.layer = T('p_effect_' + (r() * 3 | 0)); p.life = 24 + (r() * 12 | 0); p.size = 0.08; p.col = (extra && extra.col) || [200, 100, 255]; p.bright = true; break;
      case 'cherry_petal':
        p.layer = T('p_leaf_' + (r() * 3 | 0));
        p.life = 60 + (r() * 40 | 0);
        p.size = 0.055 + r() * 0.025;
        p.grav = 0.0012;
        p.col = (extra && extra.col) || [255, 182 + (r() * 35 | 0), 208 + (r() * 35 | 0)];
        p.swayPhase = r() * Math.PI * 2;
        break;
      case 'portal': p.layer = T('p_effect_' + (r() * 3 | 0)); p.life = 18 + (r() * 14 | 0); p.size = 0.07 + r() * 0.03; p.grav = -0.002; p.col = [185 + (r() * 50 | 0), 45 + (r() * 35 | 0), 235 + (r() * 20 | 0)]; p.bright = true; break;
      case 'rain': p.layer = T('p_splash_' + (r() * 4 | 0)); p.life = 6; p.size = 0.06; p.grav = 0.04; p.col = [100, 140, 230]; break;
    }
    this.list.push(p);
    return p;
  }
  blockBreak(x, y, z, id, meta) {
    const tint = BLOCKS[id].tint ? this.game.tintAt(x, z, BLOCKS[id].tint) : null;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) {
      const px = x + (i + 0.5) / 4, py = y + (j + 0.5) / 4, pz = z + (k + 0.5) / 4;
      this.spawn('block', px, py, pz, (px - x - 0.5) * 0.3 + (Math.random() - 0.5) * 0.05, (py - y - 0.5) * 0.3 + Math.random() * 0.1, (pz - z - 0.5) * 0.3, { id, meta, tint });
    }
  }
  blockHit(x, y, z, face, id, meta) {
    const D = DIRS[face];
    const px = x + 0.5 + D[0] * 0.52 + (D[0] ? 0 : (Math.random() - 0.5) * 0.9);
    const py = y + 0.5 + D[1] * 0.52 + (D[1] ? 0 : (Math.random() - 0.5) * 0.9);
    const pz = z + 0.5 + D[2] * 0.52 + (D[2] ? 0 : (Math.random() - 0.5) * 0.9);
    const tint = BLOCKS[id].tint ? this.game.tintAt(x, z, BLOCKS[id].tint) : null;
    this.spawn('block', px, py, pz, D[0] * 0.05, 0.05 + D[1] * 0.05, D[2] * 0.05, { id, meta, tint });
  }
  pickupAnim(e, p) { this.pickups.push({ stack: { ...e.stack }, from: [...e.pos], t: 0, target: p }); }
  tick() {
    const w = this.game.world;
    for (const p of this.list) {
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.age++;
      p.vy -= p.grav;
      if (p.type === 'cherry_petal') {
        p.vx += Math.cos(p.age * 0.12 + (p.swayPhase || 0)) * 0.0014;
        p.vz += Math.sin(p.age * 0.12 + (p.swayPhase || 0)) * 0.0014;
        if (p.vy < -0.035) p.vy = -0.035;
      }
      let nx = p.x + p.vx, ny = p.y + p.vy, nz = p.z + p.vz;
      if (p.grav > 0) {
        const id = w.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
        if (id && SOLIDCUBE[id]) { if (p.vy < 0) { ny = p.y; p.vy = 0; p.vx *= 0.7; p.vz *= 0.7; } else { nx = p.x; nz = p.z; } }
      }
      p.x = nx; p.y = ny; p.z = nz;
      p.vx *= 0.98; p.vy *= 0.98; p.vz *= 0.98;
      if (p.type === 'smoke' || p.type === 'explosion') { p.vx *= 0.9; p.vz *= 0.9; }
      if (p.type === 'bubble' && w.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) !== WATER) p.age = p.life;
      if (p.type === 'lava' && Math.random() < 0.1) this.spawn('smoke', p.x, p.y, p.z, 0, 0.01, 0);
      if (p.age % 4 === 1) p.light = w.getLight(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    }
    this.list = this.list.filter(p => p.age < p.life);
    for (const q of this.pickups) q.t++;
    this.pickups = this.pickups.filter(q => q.t < 3);
  }
  // build billboard quads into a MeshBuffer
  build(mb, a, cam, right, up) {
    mb.reset();
    for (const p of this.list) {
      const x = lerp(p.px, p.x, a), y = lerp(p.py, p.y, a), z = lerp(p.pz, p.z, a);
      let layer = p.layer;
      if (p.frames) {
        const f = Math.min(p.frames - 1, Math.floor((p.age + a) / p.life * p.frames));
        layer = p.base + (p.reverse ? p.frames - 1 - f : f);
      }
      const s = p.size;
      const rx = right[0] * s, ry = right[1] * s, rz = right[2] * s, ux = up[0] * s, uy = up[1] * s, uz = up[2] * s;
      const l = p.light ?? 0xF0;
      const sky = p.bright ? 255 : (l >> 4) * 17, blk = p.bright ? 255 : (l & 15) * 17;
      const u0 = p.u0, v0 = p.v0, u1 = u0 + p.us, v1 = v0 + p.us;
      const c = p.col;
      mb.v(x - rx - ux, y - ry - uy, z - rz - uz, u0, v1, layer, 0, c[0], c[1], c[2], 255, sky, blk, 0);
      mb.v(x + rx - ux, y + ry - uy, z + rz - uz, u1, v1, layer, 0, c[0], c[1], c[2], 255, sky, blk, 0);
      mb.v(x + rx + ux, y + ry + uy, z + rz + uz, u1, v0, layer, 0, c[0], c[1], c[2], 255, sky, blk, 0);
      mb.v(x - rx + ux, y - ry + uy, z - rz + uz, u0, v0, layer, 0, c[0], c[1], c[2], 255, sky, blk, 0);
    }
  }
}
