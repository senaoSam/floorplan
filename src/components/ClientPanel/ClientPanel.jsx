import React from 'react'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useClientViewStore } from '@/store/useClientViewStore'
import { CLIENT_DEVICE_LIST, getClientDeviceById } from '@/constants/clientDevices'
import { Select, NumberInput, Checkbox } from '@/components/PanelRight/_shared/PanelControls'
import '@/components/PanelRight/_shared/shared.sass'
import './ClientPanel.sass'

// Client Experience pane — "see the network from this device's perspective".
// Mounts only while the editor is in CLIENT_VIEW mode (CanvasArea gates it).
// Floating panel on the right. Controls are the SHARED right-panel primitives
// (Select / NumberInput / Checkbox from _shared/PanelControls) so the styling
// and UX match the AP panel etc. — no bespoke inputs here. The panel sets
// --panel-accent to the wireless cyan so focus rings / checkboxes theme like
// the AP panel.
//
// Layout mirrors Hamina's Client Experience pane:
//   device · 6 GHz · Wi-Fi 7 · good-signal area (+ threshold) · link direction ·
//   client height · per-band noise floor · min interfering RSSI · client tx
// followed by the live simulation readout (from useClientViewStore.reading).

const BAND_LABEL = { 2.4: '2.4 GHz', 5: '5 GHz', 6: '6 GHz' }
const LINK_DIRECTION_LABEL = { down: 'Downlink', up: 'Uplink', worst: 'Worstlink' }

const DEVICE_OPTIONS = CLIENT_DEVICE_LIST.map((d) => ({ value: d.id, label: d.name }))
const LINK_DIRECTION_OPTIONS = [
  { value: 'down', label: 'Downlink（AP→裝置）' },
  { value: 'up', label: 'Uplink（裝置→AP）' },
  { value: 'worst', label: 'Worstlink（取較差）' },
]

function fmt(v, unit, digits = 0) {
  if (v == null || !isFinite(v)) return '—'
  return `${v.toFixed(digits)} ${unit}`.trim()
}

// One labelled control row — the same label-left / control-right shape the
// shared PanelField gives the AP panel, but standalone for this floating panel.
function Field({ label, children }) {
  return (
    <div className="client-panel__field">
      <span className="client-panel__field-label">{label}</span>
      <span className="client-panel__field-value">{children}</span>
    </div>
  )
}

function ClientPanel() {
  const deviceId = useClientViewStore((s) => s.deviceId)
  const setDevice = useClientViewStore((s) => s.setDevice)
  const sixGHzOn = useClientViewStore((s) => s.sixGHzOn)
  const setSixGHzOn = useClientViewStore((s) => s.setSixGHzOn)
  const wifi7On = useClientViewStore((s) => s.wifi7On)
  const setWifi7On = useClientViewStore((s) => s.setWifi7On)
  const linkDirection = useClientViewStore((s) => s.linkDirection)
  const setLinkDirection = useClientViewStore((s) => s.setLinkDirection)
  const clientHeightM = useClientViewStore((s) => s.clientHeightM)
  const setClientHeightM = useClientViewStore((s) => s.setClientHeightM)
  const clientTxDbm = useClientViewStore((s) => s.clientTxDbm)
  const setClientTxDbm = useClientViewStore((s) => s.setClientTxDbm)
  const noiseFloor = useClientViewStore((s) => s.noiseFloor)
  const setNoiseFloorBand = useClientViewStore((s) => s.setNoiseFloorBand)
  const minInterferingRssiDbm = useClientViewStore((s) => s.minInterferingRssiDbm)
  const setMinInterferingRssiDbm = useClientViewStore((s) => s.setMinInterferingRssiDbm)
  const pos = useClientViewStore((s) => s.pos)
  const reading = useClientViewStore((s) => s.reading)
  const showAssociationArea = useClientViewStore((s) => s.showAssociationArea)
  const setShowAssociationArea = useClientViewStore((s) => s.setShowAssociationArea)
  const coverageThresholdDbm = useClientViewStore((s) => s.coverageThresholdDbm)
  const setCoverageThresholdDbm = useClientViewStore((s) => s.setCoverageThresholdDbm)
  const lockedApId = useClientViewStore((s) => s.lockedApId)
  const setLockedApId = useClientViewStore((s) => s.setLockedApId)

  const device = getClientDeviceById(deviceId)
  const sixGHzAvailable = device.sixGHzCapable
  const wifi7Available = device.phy === '11be'

  const placed = pos != null
  const outOfRange = reading?.outOfRange

  return (
    <div className="client-panel">
      <div className="client-panel__title">Client 體驗</div>

      <Field label="裝置">
        <Select value={deviceId} onChange={setDevice} options={DEVICE_OPTIONS} />
      </Field>

      <Checkbox
        checked={sixGHzOn && sixGHzAvailable}
        disabled={!sixGHzAvailable}
        onChange={setSixGHzOn}
        label={`支援 6 GHz${sixGHzAvailable ? '' : '（此裝置不支援）'}`}
      />
      <Checkbox
        checked={wifi7On && wifi7Available}
        disabled={!wifi7Available}
        onChange={setWifi7On}
        label={`支援 Wi-Fi 7${wifi7Available ? '' : '（此裝置不支援）'}`}
      />

      <div className="client-panel__divider" />

      <Checkbox
        checked={showAssociationArea}
        onChange={setShowAssociationArea}
        label="顯示良好訊號範圍（會暫時隱藏熱圖）"
      />

      {showAssociationArea && (
        <>
          <Field label="良好訊號門檻">
            <NumberInput
              value={coverageThresholdDbm}
              min={-85} max={-55} step={1}
              unit="dBm" width={70}
              onChange={(v) => { if (!isNaN(v)) setCoverageThresholdDbm(v) }}
            />
          </Field>
          <div className="client-panel__hint">
            藍色＝訊號強度達標的區域；藍色外仍可能連得到，只是訊號較弱
          </div>
        </>
      )}

      <Field label="連線方向">
        <Select value={linkDirection} onChange={setLinkDirection} options={LINK_DIRECTION_OPTIONS} />
      </Field>

      <Field label="裝置高度">
        <NumberInput
          value={clientHeightM}
          min={0} max={3} step={0.1}
          unit="m" width={70}
          onChange={(v) => { if (!isNaN(v)) setClientHeightM(v) }}
        />
      </Field>

      {[2.4, 5, 6].map((band) => (
        <Field label={`${BAND_LABEL[band]} 噪聲基準`} key={band}>
          <NumberInput
            value={noiseFloor[band]}
            min={-100} max={-80} step={1}
            unit="dBm" width={70}
            onChange={(v) => { if (!isNaN(v)) setNoiseFloorBand(band, v) }}
          />
        </Field>
      ))}

      <Field label="最小干擾 RSSI">
        <NumberInput
          value={minInterferingRssiDbm}
          min={-95} max={-60} step={1}
          unit="dBm" width={70}
          onChange={(v) => { if (!isNaN(v)) setMinInterferingRssiDbm(v) }}
        />
      </Field>

      <Field label="裝置發射功率">
        <NumberInput
          value={clientTxDbm}
          min={0} max={30} step={1}
          unit="dBm" width={70}
          onChange={(v) => { if (!isNaN(v)) setClientTxDbm(v) }}
        />
      </Field>

      <div className="client-panel__divider" />

      {!placed && (
        <div className="client-panel__hint">點一下平面圖放置 client；拖曳可移動觀察漫遊。</div>
      )}

      {/* Manual-lock status — shown whenever a lock is active, with an unlock
          button. (Lock is set via right-click menu on an AP.) */}
      {placed && lockedApId != null && (
        <div className="client-panel__lock">
          <span>🔒 手動連線（非真實漫遊）</span>
          <button type="button" onClick={() => setLockedApId(null)}>解除</button>
        </div>
      )}

      {placed && outOfRange && (
        <div className="client-panel__hint client-panel__hint--warn">
          {reading?.lockUnreachable
            ? '手動鎖定的 AP 在此位置無法連線（超出範圍 / 不支援的頻段）。'
            : `此位置沒有 ${device.name} 可關聯的 AP（超出範圍 / 不支援的頻段）。`}
        </div>
      )}

      {placed && !outOfRange && reading && (
        <div className="client-panel__readout">
          <div className="client-panel__row client-panel__row--head">
            <b>連線 AP</b>
            <span>{reading.isLocked ? '🔒 ' : ''}{reading.servingApName ?? '—'}</span>
          </div>
          <div className="client-panel__row">
            <b>距離</b><span>{fmt(reading.distanceM, 'm', 1)}</span>
          </div>
          <div className="client-panel__sep" />
          <div className="client-panel__row">
            <b>RSSI（{LINK_DIRECTION_LABEL[reading.linkDirection] ?? ''}）</b>
            <span>{fmt(reading.rssiDbm, 'dBm', 1)}</span>
          </div>
          <div className="client-panel__row">
            <b>SNR</b><span>{fmt(reading.snrDb, 'dB', 1)}</span>
          </div>
          <div className="client-panel__row">
            <b>SINR</b><span>{fmt(reading.sinrDb, 'dB', 1)}</span>
          </div>
          <div className="client-panel__sep" />
          <div className="client-panel__row">
            <b>頻段</b><span>{BAND_LABEL[reading.band] ?? '—'}</span>
          </div>
          <div className="client-panel__row client-panel__row--rate">
            <b>連線速率</b><span>{reading.phyRateMbps ? `${reading.phyRateMbps} Mbps` : '—'}</span>
          </div>
          <div className="client-panel__row">
            <b>MCS</b><span>{reading.mcs >= 0 ? `${reading.mcs} (${reading.mcsLabel})` : '—'}</span>
          </div>
          <div className="client-panel__row">
            <b>空間串流</b><span>{reading.spatialStreams ? `${reading.spatialStreams}×${reading.spatialStreams}` : '—'}</span>
          </div>
          <div className="client-panel__row">
            <b>頻寬</b><span>{reading.channelWidth ? `${reading.channelWidth} MHz` : '—'}</span>
          </div>
          {reading.candidates?.length > 0 && (
            <>
              <div className="client-panel__sep" />
              <div className="client-panel__cand-title">可漫遊候選</div>
              {reading.candidates.map((c) => (
                <div className="client-panel__row client-panel__row--cand" key={c.id}>
                  <b>{c.name}</b><span>{fmt(c.rssiDbm, 'dBm', 1)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Mount wrapper — only render inside CLIENT_VIEW mode.
export default function ClientPanelMount() {
  const editorMode = useEditorStore((s) => s.editorMode)
  if (editorMode !== EDITOR_MODE.CLIENT_VIEW) return null
  return <ClientPanel />
}
