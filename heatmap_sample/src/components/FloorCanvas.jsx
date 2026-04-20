import React, { useEffect, useRef, useState, useMemo } from 'react';
import { sampleField, renderHeatmap, blurImageData } from '../render/heatmap.js';
import { rssiFromAp, aggregateApContributions } from '../physics/propagation.js';
import { NOISE_FLOOR_DBM } from '../physics/constants.js';

// Canvas-based floorplan renderer.
// Layers (bottom → top):
//   1) white paper
//   2) heatmap (ImageData)
//   3) walls
//   4) APs + labels
//   5) cursor readout

const PADDING_PX = 24;

export default function FloorCanvas({ scenario, options, onApMove, hoverCallback }) {
  const canvasRef = useRef(null);
  const heatRef   = useRef(null);  // cached heatmap canvas
  const [size, setSize] = useState({ w: 960, h: 672 });
  const [dragApIdx, setDragApIdx] = useState(-1);

  // Derived scale (px per meter)
  const pxPerM = useMemo(() => {
    const w = size.w - PADDING_PX * 2;
    const h = size.h - PADDING_PX * 2;
    return Math.min(w / scenario.size.w, h / scenario.size.h);
  }, [size, scenario.size]);

  const toPx = (p) => ({
    x: PADDING_PX + p.x * pxPerM,
    y: PADDING_PX + p.y * pxPerM
  });
  const toMeter = (px, py) => ({
    x: (px - PADDING_PX) / pxPerM,
    y: (py - PADDING_PX) / pxPerM
  });

  // ---- Compute heatmap (expensive) when scenario/options change ----
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      const grid = options.gridStepM ?? 0.35;
      const field = sampleField(scenario, grid, {
        maxReflOrder: options.reflections ? 1 : 0,
        enableDiffraction: options.diffraction
      });
      if (cancelled) return;

      const outW = Math.round(scenario.size.w * pxPerM);
      const outH = Math.round(scenario.size.h * pxPerM);
      const mpp = 1 / pxPerM;
      let img = renderHeatmap(field, outW, outH, mpp);
      img = blurImageData(img, options.blur ?? 2);

      const off = document.createElement('canvas');
      off.width = outW; off.height = outH;
      off.getContext('2d').putImageData(img, 0, 0);
      heatRef.current = off;
      draw();
    };
    // yield to browser so UI stays responsive
    const id = setTimeout(run, 0);
    return () => { cancelled = true; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, options, pxPerM]);

  // ---- Resize observer ----
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onResize = () => {
      const parent = c.parentElement;
      const w = Math.max(400, parent.clientWidth);
      const h = Math.max(320, Math.round(w * scenario.size.h / scenario.size.w));
      setSize({ w, h });
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [scenario.size]);

  // ---- Draw loop ----
  const draw = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = size.w;
    c.height = size.h;
    const ctx = c.getContext('2d');

    // paper
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, size.w, size.h);

    // heatmap
    if (heatRef.current) {
      const p0 = toPx({ x: 0, y: 0 });
      ctx.drawImage(heatRef.current, p0.x, p0.y);
    }

    // floor outline
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    const p0 = toPx({ x: 0, y: 0 });
    const p1 = toPx({ x: scenario.size.w, y: scenario.size.h });
    ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);

    // walls
    for (const w of scenario.walls) {
      const a = toPx(w.a), b = toPx(w.b);
      ctx.strokeStyle = w.kind === 'exterior' ? '#1e293b' : '#475569';
      ctx.lineWidth = w.kind === 'exterior' ? 4 : 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // APs
    scenario.aps.forEach((ap, idx) => {
      const p = toPx(ap.pos);
      // coverage radius rings (visual guide at 3/8/14 m)
      if (options.showApRings) {
        ctx.strokeStyle = 'rgba(30, 64, 175, 0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        [3, 8, 14].forEach(rM => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, rM * pxPerM, 0, Math.PI * 2);
          ctx.stroke();
        });
        ctx.setLineDash([]);
      }

      // body
      ctx.fillStyle = '#1e3a8a';
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();

      // label
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillText(ap.id, p.x + 14, p.y + 4);
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillStyle = '#475569';
      ctx.fillText(`Ch36 · ${ap.txDbm}dBm`, p.x + 14, p.y + 17);
    });
  };

  useEffect(() => { draw(); /* eslint-disable-next-line */ }, [size]);

  // Convert a mouse event into canvas-internal pixel coords (handles CSS scaling).
  const mouseToCanvasPx = (e) => {
    const c = canvasRef.current;
    const rect = c.getBoundingClientRect();
    const sx = c.width / rect.width;
    const sy = c.height / rect.height;
    return {
      mx: (e.clientX - rect.left) * sx,
      my: (e.clientY - rect.top)  * sy
    };
  };

  // ---- Mouse interaction ----
  const onMouseDown = (e) => {
    const { mx, my } = mouseToCanvasPx(e);
    for (let i = 0; i < scenario.aps.length; i++) {
      const p = toPx(scenario.aps[i].pos);
      if (Math.hypot(p.x - mx, p.y - my) < 16) {
        setDragApIdx(i);
        return;
      }
    }
  };
  const onMouseMove = (e) => {
    const { mx, my } = mouseToCanvasPx(e);
    const mWorld = toMeter(mx, my);

    if (dragApIdx >= 0) {
      // clamp inside floor
      mWorld.x = Math.max(0.2, Math.min(scenario.size.w - 0.2, mWorld.x));
      mWorld.y = Math.max(0.2, Math.min(scenario.size.h - 0.2, mWorld.y));
      onApMove(dragApIdx, mWorld);
      return;
    }

    // hover RSSI readout
    if (hoverCallback &&
        mWorld.x >= 0 && mWorld.x <= scenario.size.w &&
        mWorld.y >= 0 && mWorld.y <= scenario.size.h) {
      const perAp = scenario.aps.map(ap =>
        rssiFromAp(ap, mWorld, scenario.walls, scenario.corners, {
          maxReflOrder: 1, enableDiffraction: true
        }).rssiDbm
      );
      const agg = aggregateApContributions(perAp, NOISE_FLOOR_DBM);
      hoverCallback({ at: mWorld, perAp, ...agg });
    }
  };
  const onMouseUp = () => setDragApIdx(-1);
  const onMouseLeave = () => {
    setDragApIdx(-1);
    if (hoverCallback) hoverCallback(null);
  };

  return (
    <canvas
      ref={canvasRef}
      className="floor-canvas"
      style={{ cursor: dragApIdx >= 0 ? 'grabbing' : 'crosshair' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
    />
  );
}
