import React, { useMemo } from 'react'
import { Group, Line, Circle, Text } from 'react-konva'
import { useAPStore } from '@/store/useAPStore'
import { useCableStore } from '@/store/useCableStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { computeRoutes } from '@/features/cable/computeRoutes'

// Render Stage 3 route results on the active floor only. Routes are
// computed building-wide (cross-floor via risers); we filter segments to
// those that lie on the active floor. Three states (cable-spec §9):
//   tray              — solid cyan, dashed drop-legs at endpoints
//   fallback-manhattan — dashed pale grey
//   unroutable        — red exclamation badge at AP location
//
// Routes are virtual — recomputed every render from store state.
function CableLayer({ floorId, viewportScale }) {
  const floors          = useFloorStore((s) => s.floors)
  const apsByFloor      = useAPStore((s) => s.apsByFloor)
  const switchesByFloor = useCableStore((s) => s.switchesByFloor)
  const traysByFloor    = useCableStore((s) => s.traysByFloor)
  const risers          = useCableStore((s) => s.risers)
  // Live drag overrides — keep cable lines tracking the cursor in real time
  // instead of waiting for the dragend commit into the main stores.
  const dragAP     = useDragOverlayStore((s) => s.ap)
  const dragSwitch = useDragOverlayStore((s) => s.sw)
  const inverseScale = 1 / (viewportScale || 1)

  const routes = useMemo(() => {
    // Apply drag overlays on the active floor only — overlays are per-floor.
    const apsByFloorLive = dragAP
      ? {
          ...apsByFloor,
          [floorId]: (apsByFloor[floorId] ?? []).map((a) => (a.id === dragAP.id ? { ...a, x: dragAP.x, y: dragAP.y } : a)),
        }
      : apsByFloor
    const switchesByFloorLive = dragSwitch
      ? {
          ...switchesByFloor,
          [floorId]: (switchesByFloor[floorId] ?? []).map((s) => (s.id === dragSwitch.id ? { ...s, x: dragSwitch.x, y: dragSwitch.y } : s)),
        }
      : switchesByFloor
    return computeRoutes({
      floors,
      apsByFloor: apsByFloorLive,
      switchesByFloor: switchesByFloorLive,
      traysByFloor,
      risers,
    })
  }, [floors, apsByFloor, switchesByFloor, traysByFloor, risers, dragAP, dragSwitch, floorId])

  if (routes.size === 0) return null

  const apsOnFloor = apsByFloor[floorId] ?? []

  return (
    <Group listening={false}>
      {Array.from(routes.values()).map((r) => {
        if (r.routeStatus === 'unroutable') {
          // Only show the unroutable badge on the AP's home floor.
          if (r.homeFloorId !== floorId) return null
          const ap = apsOnFloor.find((a) => a.id === r.apId)
          if (!ap) return null
          const apLive = dragAP && dragAP.id === ap.id
            ? { ...ap, x: dragAP.x, y: dragAP.y }
            : ap
          return <UnroutableBadge key={r.apId} ap={apLive} s={inverseScale} />
        }
        if (r.routeStatus === 'fallback-manhattan') {
          // Fallback is always same-floor by spec; skip if not this floor.
          if (r.homeFloorId !== floorId) return null
          const flat = r.points.flatMap((p) => [p.x, p.y])
          return (
            <Group key={r.apId}>
              <Line
                points={flat}
                stroke="#9ca3af"
                strokeWidth={1.2 * inverseScale}
                dash={[14 * inverseScale, 10 * inverseScale]}
                opacity={0.7}
                lineCap="round"
                lineJoin="round"
              />
              {r.points.length === 3 && (
                <Circle
                  x={r.points[1].x}
                  y={r.points[1].y}
                  radius={2 * inverseScale}
                  fill="#9ca3af"
                  opacity={0.85}
                />
              )}
            </Group>
          )
        }
        // routeStatus === 'tray' — may span multiple floors via riser. Only
        // render the contiguous segments that lie entirely on the active floor.
        return <TrayRoute key={r.apId} route={r} floorId={floorId} s={inverseScale} />
      })}
    </Group>
  )
}

// A graph-routed path: endpoint → endpoint-foot → tray nodes → [riser jump] →
// tray nodes → endpoint-foot → endpoint. Segments touching an 'endpoint' node
// render as dashed drop legs; tray runs are solid. Vertical riser hops
// (riser@floor ↔ riser@floor) connect different floors — skip those segments
// here (the RiserLayer column already conveys the vertical run in 3D).
function TrayRoute({ route, floorId, s }) {
  const pts = route.points
  if (!pts || pts.length < 2) return null
  const trayColor = '#22d3ee'
  return (
    <Group>
      {pts.slice(0, -1).map((p, i) => {
        const q = pts[i + 1]
        // Only draw segments fully on this floor — skip both off-floor segs
        // and the cross-floor riser-vertical hops (different floorId).
        if (p.floorId !== floorId || q.floorId !== floorId) return null
        const isDrop = p.kind === 'endpoint' || q.kind === 'endpoint'
        return (
          <Line
            key={i}
            points={[p.x, p.y, q.x, q.y]}
            stroke={trayColor}
            strokeWidth={(isDrop ? 1.4 : 1.6) * s}
            dash={isDrop ? [6 * s, 4 * s] : null}
            opacity={isDrop ? 0.85 : 0.95}
            lineCap="round"
            lineJoin="round"
          />
        )
      })}
      {pts.map((p, i) => {
        if (p.floorId !== floorId) return null
        // AP / Switch icons own their own visuals; only mark tray geometry.
        if (p.kind === 'endpoint') return null
        const isFoot     = p.kind === 'endpoint-foot'
        const isRiserFoot = p.kind === 'riser-foot'
        const isRiserHub = p.kind === 'riser@floor'
        const radius = (isFoot || isRiserFoot) ? 2.5 : isRiserHub ? 3 : 2
        return (
          <Circle
            key={`d${i}`}
            x={p.x}
            y={p.y}
            radius={radius * s}
            fill={trayColor}
            stroke={isFoot || isRiserFoot || isRiserHub ? '#0e7490' : null}
            strokeWidth={isFoot || isRiserFoot || isRiserHub ? 0.6 * s : 0}
            opacity={0.9}
          />
        )
      })}
    </Group>
  )
}

function UnroutableBadge({ ap, s }) {
  // Sit just above the AP icon so the AP frequency ring stays readable.
  const x = ap.x + 14 * s
  const y = ap.y - 18 * s
  return (
    <Group>
      <Circle x={x} y={y} radius={8 * s} fill="#ef4444" stroke="#fff" strokeWidth={1.5 * s} />
      <Text
        text="!"
        x={x - 5 * s}
        y={y - 7 * s}
        width={10 * s}
        align="center"
        fontSize={12 * s}
        fontStyle="bold"
        fill="#fff"
      />
    </Group>
  )
}

export default CableLayer
