import React from 'react'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { getModeCapability } from '@/render/modeCapabilities'
import APPanel from './APPanel'
import SwitchPanel from './SwitchPanel'
import CableTrayPanel from './CableTrayPanel'
import RiserPanel from './RiserPanel'
import WallPanel from './WallPanel'
import ScopePanel from './ScopePanel'
import FloorHolePanel from './FloorHolePanel'
import FloorImagePanel from './FloorImagePanel'
import CameraPanel from './CameraPanel'
import TripwirePanel from './TripwirePanel'
import ZonePanel from './ZonePanel'
import AlignFloorPanel from './AlignFloorPanel'
import BatchPanel from './BatchPanel'
import Icon from '@/components/Icon/Icon'
import './PanelRight.sass'

// Right-panel router — keyed off selectedType / batch count. Adds the
// scope / floor_hole / batch routes that were missing; the panel-collapse
// chevron (‹ / ›) sits outside the aside so the user can fold the whole
// panel without losing their selection (oldSrc convention).

function PanelRight() {
  const selectedId           = useEditorStore((s) => s.selectedId)
  const selectedType         = useEditorStore((s) => s.selectedType)
  const selectedItems        = useEditorStore((s) => s.selectedItems)
  const editorMode           = useEditorStore((s) => s.editorMode)
  const panelCollapsed       = useEditorStore((s) => s.panelCollapsed)
  const togglePanelCollapsed = useEditorStore((s) => s.togglePanelCollapsed)
  const activeFloorId        = useFloorStore((s) => s.activeFloorId)

  const isBatch      = selectedItems.length > 1
  // ALIGN_FLOOR forces the panel open regardless of selection — the panel
  // is the only UI for the mode (oldSrc parity). Always targets the
  // active floor's transform.
  const isAlignMode  = editorMode === EDITOR_MODE.ALIGN_FLOOR
  // 47-14: read-only modes (STATS / CLIENT_VIEW) may hold a selection to
  // locate an object on the plan, but must not open an editable object panel —
  // that would let the user mutate values the mode is supposed to freeze. Those
  // modes have their own dedicated UI (StatsDashboard / ClientPanel) outside
  // this router, so suppressing the object panel here doesn't hide anything.
  const isReadOnly   = getModeCapability(editorMode).readOnly
  const hasSelection = !isReadOnly && (!!selectedId || isBatch || isAlignMode)
  const isOpen       = hasSelection && !panelCollapsed

  // Right-dock avoidance (ui-spec §2.1-2): publish the dock's occupied width
  // as a CSS variable so top-right floating panels (3D control panel /
  // ClientPanel) and the scale bar shift left instead of being covered.
  React.useEffect(() => {
    document.documentElement.style.setProperty('--right-dock', isOpen ? '300px' : '0px')
    return () => document.documentElement.style.setProperty('--right-dock', '0px')
  }, [isOpen])

  let body = null
  if (isReadOnly) {
    body = null
  } else if (isAlignMode && activeFloorId) {
    body = <AlignFloorPanel floorId={activeFloorId} />
  } else if (isBatch && activeFloorId) {
    body = <BatchPanel />
  } else if (!isBatch && activeFloorId) {
    switch (selectedType) {
      case 'ap':         body = <APPanel       floorId={activeFloorId} apId={selectedId} />;   break
      case 'switch':     body = <SwitchPanel   floorId={activeFloorId} swId={selectedId} />;   break
      case 'cable_tray': body = <CableTrayPanel floorId={activeFloorId} trayId={selectedId} />; break
      case 'cable_riser': body = <RiserPanel riserId={selectedId} />; break
      case 'floor_image': body = <FloorImagePanel floorId={selectedId} />; break
      case 'wall':       body = <WallPanel     floorId={activeFloorId} wallId={selectedId} />; break
      case 'scope':      body = <ScopePanel    floorId={activeFloorId} zoneId={selectedId} />; break
      case 'floor_hole': body = <FloorHolePanel floorId={activeFloorId} holeId={selectedId} />; break
      case 'camera':     body = <CameraPanel   floorId={activeFloorId} cameraId={selectedId} />; break
      case 'tripwire':   body = <TripwirePanel floorId={activeFloorId} tripwireId={selectedId} />; break
      case 'camera_zone': body = <ZonePanel    floorId={activeFloorId} zoneId={selectedId} />; break
      default:           body = null
    }
  }

  return (
    <>
      <aside className={`panel-right${isOpen ? ' panel-right--open' : ''}`}>
        {body}
        {!body && hasSelection && (
          <div className="panel-right__placeholder">
            <div className="panel-right__placeholder-title">
              {selectedType}
            </div>
            <div className="panel-right__placeholder-hint">
              此類型的屬性面板即將推出
            </div>
          </div>
        )}
      </aside>
      {hasSelection && (
        <button
          type="button"
          className={`panel-right__toggle${panelCollapsed ? ' panel-right__toggle--collapsed' : ''}`}
          onClick={togglePanelCollapsed}
          title={panelCollapsed ? '展開面板' : '收合面板'}
          aria-label={panelCollapsed ? '展開面板' : '收合面板'}
        >
          <Icon name={panelCollapsed ? 'chevronLeft' : 'chevronRight'} size={12} />
        </button>
      )}
    </>
  )
}

export default PanelRight
