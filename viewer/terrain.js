import { clamp } from "./core.js";
function bilinear(z, cols, rows, x, y) {
  x = clamp(x, 0, cols - 1);
  y = clamp(y, 0, rows - 1);
  const ix = Math.min(cols - 2, Math.floor(x)),
    iy = Math.min(rows - 2, Math.floor(y)),
    dx = x - ix,
    dy = y - iy,
    i = iy * cols + ix;
  return (
    z[i] * (1 - dx) * (1 - dy) +
    z[i + 1] * dx * (1 - dy) +
    z[i + cols] * (1 - dx) * dy +
    z[i + cols + 1] * dx * dy
  );
}
export async function floatFile(url, cols, rows) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Terrain download failed (${response.status})`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== cols * rows * 4)
    throw new Error("Terrain file size does not match its metadata.");
  const values = new Float32Array(buffer);
  if (!values.every(Number.isFinite)) throw new Error("Terrain contains missing heights.");
  return values;
}
export async function createTerrain(C, meta, baseURL, onWarning) {
  const overview = await floatFile(
    baseURL + meta.overview.file,
    meta.overview.cols,
    meta.overview.rows,
  );
  const cache = new Map(),
    pending = new Map();
  let active = 0;
  const queue = [];
  let warned = false;
  const run = () => {
    while (active < 4 && queue.length) {
      active++;
      const task = queue.shift();
      task().finally(() => {
        active--;
        run();
      });
    }
  };
  const tileFor = (x, y) =>
    `${Math.min(Math.floor(x / 256) * 256, Math.floor((meta.cols - 2) / 256) * 256)}-${Math.min(Math.floor(y / 256) * 256, Math.floor((meta.rows - 2) / 256) * 256)}`;
  const tiles = new Map(meta.tiles.map((t) => [`${t.x}-${t.y}`, t]));
  const load = (key) => {
    if (cache.has(key)) {
      const t = cache.get(key);
      cache.delete(key);
      cache.set(key, t);
      return Promise.resolve(t);
    }
    if (pending.has(key)) return pending.get(key);
    const tile = tiles.get(key);
    if (!tile) return Promise.resolve(null);
    const promise = new Promise((resolve) => {
      queue.push(async () => {
        try {
          const z = await floatFile(baseURL + tile.file, tile.cols, tile.rows);
          cache.set(key, { ...tile, z });
          if (cache.size > 64) cache.delete(cache.keys().next().value);
          resolve(cache.get(key));
        } catch (e) {
          if (!warned) {
            onWarning("Detailed terrain unavailable; showing the overview. Reload to retry.");
            warned = true;
          }
          resolve(null);
        } finally {
          pending.delete(key);
        }
      });
    });
    pending.set(key, promise);
    run();
    return promise;
  };
  let provider;
  provider = new C.CustomHeightmapTerrainProvider({
    width: 33,
    height: 33,
    credit: "USGS 3DEP · estimated terrain inside the marked boundary",
    callback: (x, y, level) => {
      const rect = provider.tilingScheme.tileXYToRectangle(x, y, level),
        w = C.Math.toDegrees(rect.west),
        e = C.Math.toDegrees(rect.east),
        s = C.Math.toDegrees(rect.south),
        n = C.Math.toDegrees(rect.north);
      const samples = [],
        keys = new Set();
      for (let row = 0; row < 33; row++)
        for (let col = 0; col < 33; col++) {
          const lon = w + ((e - w) * col) / 32,
            lat = n + ((s - n) * row) / 32;
          if (lon < meta.west || lon > meta.east || lat < meta.south || lat > meta.north) {
            samples.push(null);
            continue;
          }
          const gx = ((lon - meta.west) / (meta.east - meta.west)) * (meta.cols - 1),
            gy = ((meta.north - lat) / (meta.north - meta.south)) * (meta.rows - 1),
            key = tileFor(gx, gy);
          samples.push({ gx, gy, key });
          if (level >= 16) keys.add(key);
        }
      const assemble = (loaded) => {
        const detailed = new Map(loaded.filter(Boolean).map((t) => [`${t.x}-${t.y}`, t]));
        return Float32Array.from(
          samples.map((p) => {
            if (!p) return 0;
            const t = detailed.get(p.key);
            if (t) return bilinear(t.z, t.cols, t.rows, p.gx - t.x, p.gy - t.y);
            return bilinear(
              overview,
              meta.overview.cols,
              meta.overview.rows,
              (p.gx / (meta.cols - 1)) * (meta.overview.cols - 1),
              (p.gy / (meta.rows - 1)) * (meta.overview.rows - 1),
            );
          }),
        );
      };
      return keys.size ? Promise.all([...keys].map(load)).then(assemble) : assemble([]);
    },
  });
  return provider;
}
