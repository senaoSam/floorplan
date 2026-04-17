import React, { useState } from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { greedyChannelAssign } from '@/utils/autoChannelPlan'
import { greedyPowerAssign } from '@/utils/autoPowerPlan'
import './DevicePlanningPanel.sass'

function DevicePlanningPanel() {
  const [collapsed, setCollapsed] = useState(true)

  const regulatoryDomain      = useEditorStore((s) => s.regulatoryDomain)
  const autoChannelOnPlace    = useEditorStore((s) => s.autoChannelOnPlace)
  const pathLossExponent      = useEditorStore((s) => s.pathLossExponent)
  const toggleAutoChannelOnPlace = useEditorStore((s) => s.toggleAutoChannelOnPlace)

  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const floorScale    = useFloorStore((s) => s.floors.find((f) => f.id === s.activeFloorId)?.scale ?? null)

  const apsByFloor = useAPStore((s) => s.apsByFloor)
  const setAPs     = useAPStore((s) => s.setAPs)
  const apsOnFloor = (apsByFloor[activeFloorId] ?? []).length

  const runAutoChannel = () => {
    const aps = apsByFloor[activeFloorId] ?? []
    if (aps.length === 0) return
    const assignments = greedyChannelAssign(aps, regulatoryDomain)
    const updated = aps.map((ap) => {
      const a = assignments.get(ap.id)
      return a ? { ...ap, channel: a.channel } : ap
    })
    setAPs(activeFloorId, updated)
  }

  const runAutoPower = () => {
    const aps = apsByFloor[activeFloorId] ?? []
    if (aps.length === 0 || !floorScale) return
    const assignments = greedyPowerAssign(aps, floorScale, pathLossExponent)
    const updated = aps.map((ap) => {
      const a = assignments.get(ap.id)
      return a ? { ...ap, txPower: a.txPower } : ap
    })
    setAPs(activeFloorId, updated)
  }

  return (
    <div className="device-planning">
      <div className="device-planning__header" onClick={() => setCollapsed((v) => !v)}>
        <span className="device-planning__icon">📡</span>
        <span className="device-planning__title">設備規劃</span>
        <span className={`device-planning__arrow${collapsed ? ' device-planning__arrow--collapsed' : ''}`}>▾</span>
      </div>

      {!collapsed && (
        <div className="device-planning__body">
          <section className="device-planning__section">
            <div className="device-planning__section-head">
              <p className="device-planning__section-title">AP</p>
              <label
                className="device-planning__check"
                title="放置新 AP 時自動指派頻道"
              >
                <input
                  type="checkbox"
                  checked={autoChannelOnPlace}
                  onChange={toggleAutoChannelOnPlace}
                />
                <span>新AP自動選頻</span>
              </label>
            </div>

            <div className="device-planning__actions">
              <button
                className="device-planning__btn"
                onClick={runAutoChannel}
                disabled={apsOnFloor === 0}
                title="對本樓層所有 AP 執行 greedy 最小干擾頻道指派"
              >
                📻 自動頻道
              </button>
              <button
                className="device-planning__btn"
                onClick={runAutoPower}
                disabled={apsOnFloor === 0 || !floorScale}
                title={!floorScale ? '需先設定比例尺' : '依最近鄰 AP 距離反推最小覆蓋功率（目標 −67 dBm）'}
              >
                ⚡ 自動功率
              </button>
            </div>
          </section>

          {/* 未來：Switch / IPCam / Gateway 規劃 section 追加在這裡 */}
        </div>
      )}
    </div>
  )
}

export default DevicePlanningPanel
