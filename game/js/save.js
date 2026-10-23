'use strict';
// ---------------------------------------------------------------------------
// Persistence: IndexedDB, falling back to localStorage, then to memory
// ---------------------------------------------------------------------------
const LS = {
  ok: (() => { try { const k = '__mcjs_test'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; } })(),
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  keys(prefix) { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(prefix)) out.push(k); } return out; },
};

const DB = {
  db: null, mem: { worlds: new Map(), chunks: new Map() }, ok: false, backend: 'memory',
  open() {
    return new Promise((res) => {
      const fallback = () => { this.backend = LS.ok ? 'local' : 'memory'; res(false); };
      let req;
      try { req = indexedDB.open('mc-js-clone', 1); } catch (e) { fallback(); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
      };
      req.onsuccess = () => { this.db = req.result; this.ok = true; this.backend = 'idb'; res(true); };
      req.onerror = fallback;
      req.onblocked = fallback;
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode), s = t.objectStore(store);
      let out;
      const r = fn(s);
      if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
    });
  },
  async listWorlds() {
    let all;
    if (this.backend === 'idb') all = await this.tx('worlds', 'readonly', s => s.getAll());
    else if (this.backend === 'local') all = LS.keys('mcjs:w:').map(k => LS.get(k)).filter(Boolean);
    else all = [...this.mem.worlds.values()];
    return (all || []).sort((a, b) => b.lastPlayed - a.lastPlayed);
  },
  async getWorld(id) {
    if (this.backend === 'idb') return this.tx('worlds', 'readonly', s => s.get(id));
    if (this.backend === 'local') return LS.get('mcjs:w:' + id);
    return this.mem.worlds.get(id);
  },
  async putWorld(w) {
    if (w) {
      w.schemaVersion = w.schemaVersion || SAVE_SCHEMA_VERSION;
      w.blockBits = w.blockBits || SAVE_BLOCK_BITS;
    }
    if (this.backend === 'idb') return this.tx('worlds', 'readwrite', s => s.put(w));
    if (this.backend === 'local') { LS.set('mcjs:w:' + w.id, w); return; }
    this.mem.worlds.set(w.id, w);
  },
  async deleteWorld(id) {
    if (this.backend === 'idb') {
      await this.tx('worlds', 'readwrite', s => s.delete(id));
      await this.tx('chunks', 'readwrite', s => s.delete(IDBKeyRange.bound(id + ':', id + ':￿')));
    } else if (this.backend === 'local') {
      localStorage.removeItem('mcjs:w:' + id);
      for (const k of LS.keys('mcjs:c:' + id + ':')) localStorage.removeItem(k);
    } else {
      this.mem.worlds.delete(id);
      for (const k of [...this.mem.chunks.keys()]) if (k.startsWith(id + ':')) this.mem.chunks.delete(k);
    }
  },
  async loadChunks(id, fallbackBits) {
    const out = new Map();
    if (this.backend === 'idb') {
      await new Promise((res) => {
        const t = this.db.transaction('chunks', 'readonly'), s = t.objectStore('chunks');
        const req = s.openCursor(IDBKeyRange.bound(id + ':', id + ':￿'));
        req.onsuccess = () => {
          const c = req.result;
          if (c) { const [, cx, cz] = c.key.split(':'); out.set(ckey(+cx, +cz), normalizeChunkRec(c.value, fallbackBits)); c.continue(); }
        };
        t.oncomplete = res; t.onerror = res;
      });
    } else if (this.backend === 'local') {
      for (const k of LS.keys('mcjs:c:' + id + ':')) {
        const [, , , cx, cz] = k.split(':'); const v = LS.get(k);
        if (v) out.set(ckey(+cx, +cz), normalizeChunkRec(v, fallbackBits));
      }
    } else {
      for (const [k, v] of this.mem.chunks) if (k.startsWith(id + ':')) { const [, cx, cz] = k.split(':'); out.set(ckey(+cx, +cz), normalizeChunkRec(v, fallbackBits)); }
    }
    return out;
  },
  async getChunk(id, cx, cz, fallbackBits) {
    if (!id) return null;
    const key = id + ':' + cx + ':' + cz;
    if (this.backend === 'idb') {
      const v = await this.tx('chunks', 'readonly', s => s.get(key));
      return normalizeChunkRec(v, fallbackBits);
    }
    if (this.backend === 'local') {
      return normalizeChunkRec(LS.get('mcjs:c:' + key), fallbackBits);
    }
    return normalizeChunkRec(this.mem.chunks.get(key), fallbackBits);
  },
  async putChunks(id, list) {
    if (!list.length) return;
    if (this.backend === 'idb') return this.tx('chunks', 'readwrite', s => { for (const [cx, cz, v] of list) s.put(normalizeChunkRec(v), id + ':' + cx + ':' + cz); });
    if (this.backend === 'local') { for (const [cx, cz, v] of list) LS.set('mcjs:c:' + id + ':' + cx + ':' + cz, { b: Array.from(v.b), m: Array.from(v.m), blockBits: v.blockBits || SAVE_BLOCK_BITS }); return; }
    for (const [cx, cz, v] of list) this.mem.chunks.set(id + ':' + cx + ':' + cz, normalizeChunkRec(v));
  },
  async exportWorldData(id) {
    const meta = await this.getWorld(id);
    if (!meta) throw new Error('找不到存档: ' + id);
    const chunksMap = await this.loadChunks(id, meta.blockBits);
    const chunks = [];
    for (const [k, rec] of chunksMap.entries()) {
      const cx = Math.floor(k / 65536) - 32768;
      const cz = (k % 65536) - 32768;
      chunks.push({
        cx,
        cz,
        blockBits: rec.blockBits || meta.blockBits || SAVE_BLOCK_BITS,
        b: Array.from(rec.b),
        m: Array.from(rec.m),
      });
    }
    const worldCopy = JSON.parse(JSON.stringify(meta));
    worldCopy.schemaVersion = worldCopy.schemaVersion || SAVE_SCHEMA_VERSION;
    worldCopy.blockBits = worldCopy.blockBits || SAVE_BLOCK_BITS;
    worldCopy.modifiedChunkKeys = chunks.map(c => ckey(c.cx, c.cz));
    return {
      format: 'htgame-world-save',
      schemaVersion: worldCopy.schemaVersion,
      blockBits: worldCopy.blockBits,
      exportedAt: Date.now(),
      world: worldCopy,
      chunks,
    };
  },
  async importWorldData(raw) {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || typeof data !== 'object') throw new Error('无效的存档文件格式');
    const srcWorld = data.world && typeof data.world === 'object' ? data.world : data;
    const meta = JSON.parse(JSON.stringify(srcWorld));
    delete meta.chunks;
    if (!meta.id) meta.id = 'w' + Date.now().toString(36);
    meta.name = meta.name || '导入的世界';
    meta.lastPlayed = meta.lastPlayed || Date.now();
    meta.schemaVersion = data.schemaVersion || meta.schemaVersion || SAVE_SCHEMA_VERSION;
    meta.blockBits = data.blockBits || meta.blockBits || SAVE_BLOCK_BITS;
    const rawChunks = data.chunks || srcWorld.chunks || [];
    const chunkList = [];
    const modKeys = new Set(Array.isArray(meta.modifiedChunkKeys) ? meta.modifiedChunkKeys : []);
    if (Array.isArray(rawChunks)) {
      for (const item of rawChunks) {
        if (Array.isArray(item) && item.length >= 3) {
          const [cx, cz, rec] = item;
          const norm = normalizeChunkRec(rec, meta.blockBits);
          if (norm) { chunkList.push([+cx, +cz, norm]); modKeys.add(ckey(+cx, +cz)); }
        } else if (item && typeof item === 'object') {
          const cx = +item.cx, cz = +item.cz;
          const norm = normalizeChunkRec(item, meta.blockBits);
          if (norm && !isNaN(cx) && !isNaN(cz)) { chunkList.push([cx, cz, norm]); modKeys.add(ckey(cx, cz)); }
        }
      }
    }
    meta.modifiedChunkKeys = [...modKeys];
    await this.deleteWorld(meta.id);
    await this.putWorld(meta);
    if (chunkList.length) await this.putChunks(meta.id, chunkList);
    return meta;
  },
};

const SAVE_SCHEMA_VERSION = 2;
const SAVE_BLOCK_BITS = 16;

function normalizeChunkRec(v, fallbackBits = SAVE_BLOCK_BITS) {
  if (!v) return null;
  const b = v.b instanceof Uint16Array ? v.b : new Uint16Array(v.b || []);
  const m = v.m instanceof Uint16Array ? v.m : new Uint16Array(v.m || []);
  let bits = v.blockBits;
  if (!bits) {
    let hasHigh = false;
    for (let i = 0; i < b.length; i += 2) { if (b[i] > 255) { hasHigh = true; break; } }
    bits = hasHigh ? 16 : (fallbackBits || 8);
  }
  return { b, m, blockBits: bits };
}

function encodeChunk(ch) {
  return { b: new Uint16Array(rleEncode(ch.blocks)), m: new Uint16Array(rleEncode(ch.meta)), blockBits: SAVE_BLOCK_BITS };
}
function decodeChunk(rec, ch, worldBlockBits) {
  if (!rec || !ch) return;
  const explicitBits = rec.blockBits ?? worldBlockBits;
  let bits = explicitBits;
  if (bits === undefined) {
    let hasHigh = false;
    if (rec.b) for (let i = 0; i < rec.b.length; i += 2) { if (rec.b[i] > 255) { hasHigh = true; break; } }
    bits = hasHigh ? 16 : 8;
  }
  if (rec.b && rec.b.length === ch.blocks.length && !(rec.b instanceof Uint16Array) && bits === 8) {
    for (let i = 0; i < ch.blocks.length; i++) ch.blocks[i] = rec.b[i] & 0xFF;
  } else if (bits === 8) {
    const b8 = rleDecode(rec.b, ch.blocks.length, Uint8Array);
    ch.blocks.set(b8);
  } else {
    rleDecode(rec.b, ch.blocks);
  }
  if (rec.m && rec.m.length === ch.meta.length && rec.m instanceof Uint8Array) {
    ch.meta.set(rec.m);
  } else {
    rleDecode(rec.m, ch.meta);
  }
}