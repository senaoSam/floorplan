import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Stage, Layer, Rect, Line, Circle, Text, Image as KonvaImage, Group } from 'react-konva';
import { sampleField } from '../render/heatmap.js';
import { createHeatmapGL } from '../render/heatmapGL.js';
import { rssiFromAp, aggregateApContributions } from '../physics/propagation.js';
import { NOISE_FLOOR_DBM } from '../physics/constants.js';

// react-konva + WebGL2 floorplan renderer.
// Layers (bottom → top):
//   1) paper + heatmap image (listening:false)
//   2) floor outline + walls + AP rings (listening:false)
//   3) APs (draggable) + labels

const PADDING_PX = 24;

export default function FloorCanvas({ scenario, options, onApMove, hoverCallback }) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const glRef = useRef(null);
  const [size, setSize] = useState({ w: 960, h: 672 });
  const [heatVersion, setHeatVersion] = useState(0); // bump to tell Konva.Image to redraw
  const [dragApIdx, setDragApIdx] = useState(-1);

  // Derived scale (px per meter) — identical math to the old canvas path.
  const pxPerM = useMemo(() => {
    const w = size.w - PADDING_PX * 2;
    const h = size.h - PADDING_PX * 2;
    return Math.min(w / scenario.size.w, h / scenario.size.h);
  }, [size, scenario.size]);

  const toPx = useCallback((p) => ({
    x: PADDING_PX + p.x * pxPerM,
    y: PADDING_PX + p.y * pxPerM
  }), [pxPerM]);

  const toMeter = useCallback((px, py) => ({
    x: (px - PADDING_PX) / pxPerM,
    y: (py - PADDING_PX) / pxPerM
  }), [pxPerM]);

  // ---- Lazy-init WebGL renderer (shared across renders, disposed on unmount) ----
  const getGL = () => {
    if (!glRef.current) glRef.current = createHeatmapGL();
    return glRef.current;
  };
  useEffect(() => () => {
    if (glRef.current) { glRef.current.dispose(); glRef.current = null; }
  }, []);

  // ---- Compute heatmap (expensive physics) + GPU render when inputs change ----
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      const grid = options.gridStepM ?? 0.35;
      const field = sampleField(scenario, grid, {
        maxReflOrder: options.reflections ? 1 : 0,
        enableDiffraction: options.diffraction
      });
      if (cancelled) return;

      const outW = Math.max(1, Math.round(scenario.size.w * pxPerM));
      const outH = Math.max(1, Math.round(scenario.size.h * pxPerM));
      const mpp = 1 / pxPerM;
      getGL().render(field, outW, outH, mpp, options.blur ?? 2, options.showContours ?? true);
      setHeatVersion((n) => n + 1);
    };
    const id = setTimeout(run, 0);
    return () => { cancelled = true; clearTimeout(id); };
  }, [scenario, options, pxPerM]);

  // ---- Responsive sizing: match the parent width, preserve floor aspect ----
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onResize = () => {
      const w = Math.max(400, el.clientWidth);
      const h = Math.max(320, Math.round(w * scenario.size.h / scenario.size.w));
      setSize({ w, h });
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [scenario.size]);

  // ---- Hover RSSI readout (stage pointermove) ----
  const onStageMove = useCallback((e) => {
    if (dragApIdx >= 0 || !hoverCallback) return;
    const stage = e.target.getStage();
    const p = stage.getPointerPosition();
    if (!p) return;
    const mWorld = toMeter(p.x, p.y);
    if (mWorld.x < 0 || mWorld.x > scenario.size.w ||
        mWorld.y < 0 || mWorld.y > scenario.size.h) {
      hoverCallback(null);
      return;
    }
    const perAp = scenario.aps.map(ap =>
      rssiFromAp(ap, mWorld, scenario.walls, scenario.corners, {
        maxReflOrder: 1, enableDiffraction: true
      }).rssiDbm
    );
    const agg = aggregateApContributions(perAp, NOISE_FLOOR_DBM);
    hoverCallback({ at: mWorld, perAp, ...agg });
  }, [dragApIdx, hoverCallback, scenario, toMeter]);

  const onStageLeave = useCallback(() => {
    setDragApIdx(-1);
    if (hoverCallback) hoverCallback(null);
  }, [hoverCallback]);

  // ---- Heatmap image anchoring ----
  const heatPos = toPx({ x: 0, y: 0 });
  const heatW = Math.round(scenario.size.w * pxPerM);
  const heatH = Math.round(scenario.size.h * pxPerM);
  const heatCanvas = glRef.current ? glRef.current.canvas : null;

  // Precompute floor outline rect
  const outline0 = toPx({ x: 0, y: 0 });
  const outline1 = toPx({ x: scenario.size.w, y: scenario.size.h });

  return (
    <div
      ref={containerRef}
      className="floor-canvas"
      style={{ cursor: dragApIdx >= 0 ? 'grabbing' : 'crosshair' }}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        onMouseMove={onStageMove}
        onMouseLeave={onStageLeave}
      >
        {/* Layer 1: paper + heatmap */}
        <Layer listening={false}>
          <Rect x={0} y={0} width={size.w} height={size.h} fill="#f8fafc" />
          {heatCanvas && (
            <KonvaImage
              image={heatCanvas}
              x={heatPos.x}
              y={heatPos.y}
              width={heatW}
              height={heatH}
              // bump key so Konva re-reads the underlying canvas after GL redraw
              key={heatVersion}
            />
          )}
        </Layer>

        {/* Layer 2: floor outline + walls + AP rings */}
        <Layer listening={false}>
          <Rect
            x={outline0.x}
            y={outline0.y}
            width={outline1.x - outline0.x}
            height={outline1.y - outline0.y}
            stroke="#334155"
            strokeWidth={2}
          />
          {scenario.walls.map((w, i) => {
            const a = toPx(w.a), b = toPx(w.b);
            const exterior = w.kind === 'exterior';
            return (
              <Line
                key={i}
                points={[a.x, a.y, b.x, b.y]}
                stroke={exterior ? '#1e293b' : '#475569'}
                strokeWidth={exterior ? 4 : 3}
                lineCap="round"
              />
            );
          })}
          {options.showApRings && scenario.aps.flatMap((ap, idx) => {
            const p = toPx(ap.pos);
            return [3, 8, 14].map((rM, r) => (
              <Circle
                key={`ring-${idx}-${r}`}
                x={p.x}
                y={p.y}
                radius={rM * pxPerM}
                stroke="rgba(30, 64, 175, 0.25)"
                strokeWidth={1}
                dash={[4, 3]}
              />
            ));
          })}
        </Layer>

        {/* Layer 3: APs (draggable) + labels */}
        <Layer>
          {scenario.aps.map((ap, idx) => {
            const p = toPx(ap.pos);
            return (
              <Group
                key={ap.id}
                x={p.x}
                y={p.y}
                draggable
                onDragStart={() => setDragApIdx(idx)}
                onDragMove={(e) => {
                  const node = e.currentTarget;
                  const m = toMeter(node.x(), node.y());
                  m.x = Math.max(0.2, Math.min(scenario.size.w - 0.2, m.x));
                  m.y = Math.max(0.2, Math.min(scenario.size.h - 0.2, m.y));
                  const clamped = toPx(m);
                  node.x(clamped.x);
                  node.y(clamped.y);
                  onApMove(idx, m);
                }}
                onDragEnd={() => setDragApIdx(-1)}
                onMouseEnter={(e) => {
                  const stage = e.target.getStage();
                  if (stage) stage.container().style.cursor = 'grab';
                }}
                onMouseLeave={(e) => {
                  const stage = e.target.getStage();
                  if (stage) stage.container().style.cursor = dragApIdx >= 0 ? 'grabbing' : 'crosshair';
                }}
              >
                <Circle
                  x={0} y={0} radius={10}
                  fill="#1e3a8a"
                  stroke="#f8fafc"
                  strokeWidth={2}
                />
                {/* Canvas2D fillText uses alphabetic baseline; Konva uses top.
                    Approximate ascent = fontSize * 0.8 to match old positions:
                      old: fillText(id,   p.x+14, p.y+4)  → top ≈ p.y+4  - 12*0.8 = p.y - 5.6
                      old: fillText(chan, p.x+14, p.y+17) → top ≈ p.y+17 - 10*0.8 = p.y + 9 */}
                <Text
                  x={14}
                  y={-5.6}
                  text={ap.id}
                  fontSize={12}
                  fontStyle="bold"
                  fontFamily="system-ui, sans-serif"
                  fill="#0f172a"
                  listening={false}
                />
                <Text
                  x={14}
                  y={9}
                  text={`Ch36 · ${ap.txDbm}dBm`}
                  fontSize={10}
                  fontFamily="system-ui, sans-serif"
                  fill="#475569"
                  listening={false}
                />
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
