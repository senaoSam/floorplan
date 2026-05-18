import React, { useMemo } from 'react'
import { Group, Line, Circle, Text } from 'react-konva'
import { useAPStore } from '@/store/useAPStore'
import { useCableStore } from '@/store/useCableStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { computeRoutes } from '@/features/cable/computeRoutes'

// Render Stage 3 route results. Three states (.claude/cable-spec.md §9):
//   tray              — solid, default colour (not yet — needs 12-2 graph route)
//   fallback-manhattan — dashed pale grey
//   unroutable        — red exclamation badge at AP location
//
// Routes are virtual — recomputed every render from store state.
function CableLayer({ floorId, viewportScale }) {
  const aps        = useAPStore((s) => s.apsByFloor[floorId] ?? [])
  const switches   = useCableStore((s) => s.switchesByFloor[floorId] ?? [])
  const trays      = useCableStore((s) => s.traysByFloor[floorId] ?? [])
  const floor      = useFloorStore((s) => s.floors.find((f) => f.id === floorId))
  // Live drag overrides — keep cable lines tracking the cursor in real time
  // instead of waiting for the dragend commit into the main stores.
  const dragAP     = useDragOverlayStore((s) => s.ap)
  const dragSwitch = useDragOverlayStore((s) => s.sw)
  const inverseScale = 1 / (viewportScale || 1)

  const routes = useMemo(() => {
    const apsLive = dragAP
      ? aps.map((a) => (a.id === dragAP.id ? { ...a, x: dragAP.x, y: dragAP.y } : a))
      : aps
    const switchesLive = dragSwitch
      ? switches.map((s) => (s.id === dragSwitch.id ? { ...s, x: dragSwitch.x, y: dragSwitch.y } : s))
      : switches
    return computeRoutes({ floor, aps: apsLive, switches: switchesLive, trays })
  }, [floor, aps, switches, trays, dragAP, dragSwitch])

  if (routes.size === 0) return null

  return (
    <Group listening={false}>
      {Array.from(routes.values()).map((r) => {
        if (r.routeStatus === 'unroutable') {
          const ap = aps.find((a) => a.id === r.apId)
          if (!ap) return null
          // Apply the same live override so the badge sticks to the dragged AP.
          const apLive = dragAP && dragAP.id === ap.id
            ? { ...ap, x: dragAP.x, y: dragAP.y }
            : ap
          return <UnroutableBadge key={r.apId} ap={apLive} s={inverseScale} />
        }
        if (r.routeStatus === 'fallback-manhattan') {
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
        // routeStatus === 'tray' — split into per-segment drop / tray legs so
        // the short drop from endpoint to its tray foot reads as dashed
        // (cable-spec §9), while the run along the tray stays solid cyan.
        return <TrayRoute key={r.apId} route={r} s={inverseScale} />
      })}
    </Group>
  )
}

// A graph-routed path: endpoint → endpoint-foot → tray nodes... → endpoint-foot → endpoint.
// Segments touching an 'endpoint' node are drop legs (dashed); the rest run
// along the tray (solid). Drop-foot nodes (where the leg meets the tray) and
// tray vertex / cross nodes get a small dot so the topology is readable.
function TrayRoute({ route, s }) {
  const pts = route.points
  if (!pts || pts.length < 2) return null
  const tray  = '#22d3ee'
  return (
    <Group>
      {pts.slice(0, -1).map((p, i) => {
        const q = pts[i + 1]
        const isDrop = p.kind === 'endpoint' || q.kind === 'endpoint'
        return (
          <Line
            key={i}
            points={[p.x, p.y, q.x, q.y]}
            stroke={tray}
            strokeWidth={(isDrop ? 1.4 : 1.6) * s}
            dash={isDrop ? [6 * s, 4 * s] : null}
            opacity={isDrop ? 0.85 : 0.95}
            lineCap="round"
            lineJoin="round"
          />
        )
      })}
      {pts.map((p, i) => {
        // Skip the AP / Switch nodes themselves — those endpoints already have
        // their own icons. Only mark intermediate tray geometry.
        if (p.kind === 'endpoint') return null
        const isFoot = p.kind === 'endpoint-foot'
        return (
          <Circle
            key={`d${i}`}
            x={p.x}
            y={p.y}
            radius={(isFoot ? 2.5 : 2) * s}
            fill={tray}
            stroke={isFoot ? '#0e7490' : null}
            strokeWidth={isFoot ? 0.6 * s : 0}
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
