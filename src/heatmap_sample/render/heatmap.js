// Heatmap field sampler + raster renderer.
// Samples signal at a coarse grid (physics is expensive), then performs
// bilinear upsampling + a small gaussian blur to give the organic "wave" look
// — no staircase edges at room boundaries.

import { rssiFromAp, aggregateApContributions } from '../physics/propagation.js';
import { dbmToRgb, dbmToAlpha } from './colormap.js';
import { NOISE_FLOOR_DBM } from '../physics/constants.js';

// Compute per-cell RSSI & SINR on a coarse physics grid.
// gridStepM: physics sample spacing in meters (typical 0.35m → ~1600 samples in 20x14 office)
export function sampleField(scenario, gridStepM = 0.35, opts = {}) {
  const { w, h } = scenario.size;
  const nx = Math.ceil(w / gridStepM) + 1;
  const ny = Math.ceil(h / gridStepM) + 1;
  const rssi = new Float32Array(nx * ny);
  const sinr = new Float32Array(nx * ny);

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const rx = { x: i * gridStepM, y: j * gridStepM };
      const perAp = [];
      for (const ap of scenario.aps) {
        const { rssiDbm } = rssiFromAp(ap, rx, scenario.walls, scenario.corners, opts);
        perAp.push(rssiDbm);
      }
      const agg = aggregateApContributions(perAp, NOISE_FLOOR_DBM);
      rssi[j * nx + i] = agg.rssiDbm;
      sinr[j * nx + i] = agg.sinrDb;
    }
  }
  return { rssi, sinr, nx, ny, gridStepM };
}

// Bilinear lookup into coarse field at floating-point grid coords.
function bilinear(field, nx, ny, fx, fy) {
  const x0 = Math.max(0, Math.min(nx - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(ny - 1, Math.floor(fy)));
  const x1 = Math.min(nx - 1, x0 + 1);
  const y1 = Math.min(ny - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = field[y0 * nx + x0];
  const b = field[y0 * nx + x1];
  const c = field[y1 * nx + x0];
  const d = field[y1 * nx + x1];
  return (1 - ty) * ((1 - tx) * a + tx * b) + ty * ((1 - tx) * c + tx * d);
}

// Render the sampled field into an ImageData buffer of size (outW, outH).
// metersPerPixel: canvas scale (derived from canvas size and floor dimensions).
export function renderHeatmap(field, outW, outH, metersPerPixel) {
  const { rssi, nx, ny, gridStepM } = field;
  const img = new ImageData(outW, outH);
  const data = img.data;
  const scale = metersPerPixel / gridStepM; // grid cells per pixel

  for (let py = 0; py < outH; py++) {
    const gy = py * scale;
    for (let px = 0; px < outW; px++) {
      const gx = px * scale;
      const v = bilinear(rssi, nx, ny, gx, gy);
      const [r, g, b] = dbmToRgb(v);
      const a = dbmToAlpha(v);
      const idx = (py * outW + px) * 4;
      data[idx    ] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return img;
}

// Post-process blur: separable gaussian on the rendered ImageData (alpha-safe).
// radius in pixels. Keeps edges soft → "wave" feel.
export function blurImageData(img, radius = 2) {
  if (radius <= 0) return img;
  const { width: w, height: h, data } = img;
  const tmp = new Uint8ClampedArray(data.length);
  const out = new Uint8ClampedArray(data.length);

  const kSize = radius * 2 + 1;
  const kernel = new Float32Array(kSize);
  const sigma = Math.max(radius * 0.8, 0.5);
  let sum = 0;
  for (let i = 0; i < kSize; i++) {
    const x = i - radius;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += kernel[i];
  }
  for (let i = 0; i < kSize; i++) kernel[i] /= sum;

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.max(0, Math.min(w - 1, x + k));
        const idx = (y * w + xx) * 4;
        const wgt = kernel[k + radius];
        r += data[idx    ] * wgt;
        g += data[idx + 1] * wgt;
        b += data[idx + 2] * wgt;
        a += data[idx + 3] * wgt;
      }
      const out_i = (y * w + x) * 4;
      tmp[out_i    ] = r; tmp[out_i + 1] = g; tmp[out_i + 2] = b; tmp[out_i + 3] = a;
    }
  }
  // Vertical pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.max(0, Math.min(h - 1, y + k));
        const idx = (yy * w + x) * 4;
        const wgt = kernel[k + radius];
        r += tmp[idx    ] * wgt;
        g += tmp[idx + 1] * wgt;
        b += tmp[idx + 2] * wgt;
        a += tmp[idx + 3] * wgt;
      }
      const out_i = (y * w + x) * 4;
      out[out_i    ] = r; out[out_i + 1] = g; out[out_i + 2] = b; out[out_i + 3] = a;
    }
  }
  return new ImageData(out, w, h);
}
