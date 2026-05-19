import React, { useMemo } from 'react'
import { Group, Line, Circle, Text } from 'react-konva'
import { useAPStore } from '@/store/useAPStore'
import { useCableStore } from '@/store/useCableStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { useEditorStore } from '@/store/useEditorStore'
import { computeRoutes } from '@/features/cable/computeRoutes'

// 17-2: opacity multiplier for cables NOT related to the current selection.
// Routes that touch the selected AP / Switch keep full opacity; everything
// else fades so the user sees the connection at a glance.
const DIM_OPACITY = 0.18

// Indigo highlight band drawn beneath cable lines for the focused route(s).
// No border — just a translucent body that wraps the polyline.
const HIGHLIGHT_FILL = 'rgba(129, 140, 248, 0.55)'  // indigo-400 @ 55%

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
  // 17-2: selection state drives the dim-the-others highlight pass.
  const selectedId   = useEditorStore((s) => s.selectedId)
  const selectedType = useEditorStore((s) => s.selectedType)
  const inverseScale = 1 / (viewportScale || 1)

  // Decide which cable groups stay fully opaque vs fade. No selection (or
  // a selection that isn't a network device) → everything stays normal.
  const hasFocus = selectedId && (selectedType === 'ap' || selectedType === 'switch')
  const isRouteRelevant = (r) => {
    if (!hasFocus) return true
    if (selectedType === 'ap')     return r.apId     === selectedId
    if (selectedType === 'switch') return r.switchId === selectedId
    return true
  }
  const isLinkRelevant = (link) => {
    if (!hasFocus) return true
    if (selectedType === 'switch') return link.srcId === selectedId || link.targetId === selectedId
    return false   // AP selection doesn't relate to S2S trunks
  }
  // Highlight = "selected AND this cable is one of the focused ones".
  const isRouteFocused = (r)    => hasFocus && isRouteRelevant(r)
  const isLinkFocused  = (link) => hasFocus && isLinkRelevant(link)

  const { routes, switchLinks } = useMemo(() => {
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

  if (routes.size === 0 && switchLinks.size === 0) return null

  const apsOnFloor      = apsByFloor[floorId] ?? []
  const switchesOnFloor = switchesByFloor[floorId] ?? []

  return (
    <Group listening={false}>
      {Array.from(routes.values()).map((r) => {
        const groupOpacity = isRouteRelevant(r) ? 1 : DIM_OPACITY
        const highlight = isRouteFocused(r)
        if (r.routeStatus === 'unroutable') {
          // Only show the unroutable badge on the AP's home floor.
          if (r.homeFloorId !== floorId) return null
          const ap = apsOnFloor.find((a) => a.id === r.apId)
          if (!ap) return null
          const apLive = dragAP && dragAP.id === ap.id
            ? { ...ap, x: dragAP.x, y: dragAP.y }
            : ap
          return (
            <Group key={r.apId} opacity={groupOpacity}>
              <UnroutableBadge ap={apLive} s={inverseScale} />
            </Group>
          )
        }
        if (r.routeStatus === 'fallback-manhattan') {
          // Fallback is always same-floor by spec; skip if not this floor.
          if (r.homeFloorId !== floorId) return null
          const flat = r.points.flatMap((p) => [p.x, p.y])
          return (
            <Group key={r.apId} opacity={groupOpacity}>
              {highlight && <HighlightBand points={r.points} floorId={floorId} s={inverseScale} />}
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
        return (
          <Group key={r.apId} opacity={groupOpacity}>
            {highlight && <HighlightBand points={r.points} floorId={floorId} s={inverseScale} />}
            <TrayRoute route={r} floorId={floorId} s={inverseScale} />
          </Group>
        )
      })}

      {/* 14-2: switch-to-switch uplinks. Same renderer, distinct colour so
          trunk lines don't blend into AP cables. */}
      {Array.from(switchLinks.values()).map((link) => {
        const groupOpacity = isLinkRelevant(link) ? 1 : DIM_OPACITY
        const highlight = isLinkFocused(link)
        if (link.routeStatus === 'unroutable') {
          if (link.srcFloorId !== floorId) return null
          const sw = switchesOnFloor.find((s) => s.id === link.srcId)
          if (!sw) return null
          return (
            <Group key={`sl-${link.srcId}`} opacity={groupOpacity}>
              <UnroutableBadge ap={sw} s={inverseScale} />
            </Group>
          )
        }
        if (link.routeStatus === 'fallback-manhattan') {
          if (link.srcFloorId !== floorId) return null
          // Match cableType colour scheme — same palette as SwitchLinkRoute
          // so toggling Copper/Fiber on a Manhattan fallback stays legible.
          const isFiber = link.cableType === 'fiber'
          const stroke  = isFiber ? '#fb7185' : '#a78bfa'
          const flat = link.points.flatMap((p) => [p.x, p.y])
          return (
            <Group key={`sl-${link.srcId}`} opacity={groupOpacity}>
              {highlight && <HighlightBand points={link.points} floorId={floorId} s={inverseScale} />}
              <Line
                points={flat}
                stroke={stroke}
                strokeWidth={1.6 * inverseScale}
                dash={isFiber
                  ? [18 * inverseScale, 8 * inverseScale]   // longer dash for fiber
                  : [14 * inverseScale, 10 * inverseScale]}
                opacity={0.8}
                lineCap="round"
                lineJoin="round"
              />
            </Group>
          )
        }
        return (
          <Group key={`sl-${link.srcId}`} opacity={groupOpacity}>
            {highlight && <HighlightBand points={link.points} floorId={floorId} s={inverseScale} />}
            <SwitchLinkRoute link={link} floorId={floorId} s={inverseScale} />
          </Group>
        )
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

// Trunk variant of TrayRoute — same per-segment rendering but with a
// distinct colour so switch-to-switch uplinks visually separate from
// AP-to-switch drops. Fiber-class links use a longer dash to hint at the
// material change.
function SwitchLinkRoute({ link, floorId, s }) {
  const pts = link.points
  if (!pts || pts.length < 2) return null
  const isFiber  = link.cableType === 'fiber'
  const trunk    = isFiber ? '#fb7185' : '#a78bfa'  // rose-400 / violet-400
  const stroke2  = isFiber ? '#9f1239' : '#6d28d9'
  return (
    <Group>
      {pts.slice(0, -1).map((p, i) => {
        const q = pts[i + 1]
        if (p.floorId !== floorId || q.floorId !== floorId) return null
        const isDrop = p.kind === 'endpoint' || q.kind === 'endpoint'
        return (
          <Line
            key={i}
            points={[p.x, p.y, q.x, q.y]}
            stroke={trunk}
            strokeWidth={(isDrop ? 1.5 : 1.9) * s}
            dash={isDrop ? [6 * s, 4 * s] : (isFiber ? [12 * s, 6 * s] : null)}
            opacity={isDrop ? 0.85 : 0.95}
            lineCap="round"
            lineJoin="round"
          />
        )
      })}
      {pts.map((p, i) => {
        if (p.floorId !== floorId) return null
        if (p.kind === 'endpoint') return null
        const isFoot     = p.kind === 'endpoint-foot'
        const isRiserFoot = p.kind === 'riser-foot'
        const isRiserHub = p.kind === 'riser@floor'
        const radius = (isFoot || isRiserFoot) ? 2.6 : isRiserHub ? 3.1 : 2.2
        return (
          <Circle
            key={`d${i}`}
            x={p.x}
            y={p.y}
            radius={radius * s}
            fill={trunk}
            stroke={isFoot || isRiserFoot || isRiserHub ? stroke2 : null}
            strokeWidth={isFoot || isRiserFoot || isRiserHub ? 0.6 * s : 0}
            opacity={0.9}
          />
        )
      })}
    </Group>
  )
}

// Translucent indigo band drawn UNDER cable lines so the focused route
// reads as a highlighted "tube". No border — just the body. Each on-floor
// segment is its own Line so cross-floor riser hops don't smear across
// the canvas. Strokewidth tuned to wrap cleanly around drop legs + tray
// runs without obscuring them.
function HighlightBand({ points, floorId, s }) {
  if (!points || points.length < 2) return null
  const segments = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]
    if (a.floorId === floorId && b.floorId === floorId) {
      segments.push([a.x, a.y, b.x, b.y])
    }
  }
  return (
    <>
      {segments.map((seg, i) => (
        <Line
          key={`hb-${i}`}
          points={seg}
          stroke={HIGHLIGHT_FILL}
          strokeWidth={10 * s}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      ))}
    </>
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
