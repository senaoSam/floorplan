// Phase 58: an AP is one device carrying `radios[]` (one per band). Device
// fields (position, height, model, mount, antenna orientation) are shared;
// each radio has its own band, channel, width, TX power and optional peak
// gain override. Spec: .claude/radios-spec.md.
//
// Engines and planners work per radio. `radioView` flattens device + radio
// into the single-radio shape they were written for (frequency / channel /
// channelWidth / txPower / antennaPeakGainDbi), keyed by `radioKey` so
// per-entry caches and maps never collide across one device's radios.

import { getAPModelById, getDefaultTxPower } from '@/constants/apModels'
import { DEFAULT_CHANNEL_WIDTH } from '@/constants/channelWidths'
import { allowedChannels } from '@/constants/regulatoryDomains'

export const BANDS = [2.4, 5, 6]
export const DEFAULT_CHANNEL_BY_BAND = { 2.4: 1, 5: 36, 6: 1 }

const KEY_SEP = '#'
export const radioKey = (apId, band) => `${apId}${KEY_SEP}${band}`
// Device id of a radio key (or of a plain device id).
export function deviceIdOf(key) {
  const s = String(key)
  const i = s.lastIndexOf(KEY_SEP)
  return i < 0 ? s : s.slice(0, i)
}
export function bandOfKey(key) {
  const s = String(key)
  const i = s.lastIndexOf(KEY_SEP)
  return i < 0 ? null : Number(s.slice(i + 1))
}

// `domainId` (optional): a band the regulatory domain allows no channel on
// (e.g. 6 GHz in CN) starts disabled.
export function makeRadio(band, model, overrides = {}, domainId = null) {
  const maxTx = model?.maxTxPower?.[band]
  const tx = getDefaultTxPower(band)
  return {
    band,
    enabled: domainId == null || allowedChannels(domainId, band).length > 0,
    channel: DEFAULT_CHANNEL_BY_BAND[band],
    channelWidth: DEFAULT_CHANNEL_WIDTH[band] ?? 20,
    txPower: maxTx != null ? Math.min(tx, maxTx) : tx,
    antennaPeakGainDbi: null,
    ...overrides,
  }
}

// Radios for a model: one per supported band, low to high. Settings of bands
// the model still supports are kept (TX clamped to the new model's limit);
// new bands get defaults (off where `domainId` has no channel for them);
// unsupported bands are dropped.
export function radiosForModel(modelId, prev = [], domainId = null) {
  const model = getAPModelById(modelId)
  return [...model.supportedBands].sort((a, b) => a - b).map((band) => {
    const old = prev.find((r) => r.band === band)
    if (!old) return makeRadio(band, model, {}, domainId)
    const maxTx = model.maxTxPower?.[band]
    return maxTx != null && old.txPower > maxTx ? { ...old, txPower: maxTx } : old
  })
}

export const apRadios = (ap) => ap?.radios ?? []
export const enabledRadios = (ap) => apRadios(ap).filter((r) => r.enabled)
export const apRadio = (ap, band) => apRadios(ap).find((r) => r.band === band) ?? null
export const enabledBands = (ap) => enabledRadios(ap).map((r) => r.band)
export const hasEnabledBand = (ap, band) => enabledRadios(ap).some((r) => String(r.band) === String(band))
export function highestEnabledBand(ap) {
  const bands = enabledBands(ap)
  return bands.length ? Math.max(...bands) : null
}

// New radios array with one band patched.
export const patchRadio = (ap, band, patch) =>
  apRadios(ap).map((r) => (r.band === band ? { ...r, ...patch } : r))

// The device with only its enabled radios on `band` (for band filters);
// null when it has none.
export function withOnlyBand(ap, band) {
  const radios = enabledRadios(ap).filter((r) => String(r.band) === String(band))
  return radios.length ? { ...ap, radios } : null
}

// A radio entry already in the flat single-radio shape passes through.
const isRadioView = (ap) => ap && ap.radios === undefined && ap.frequency !== undefined

// Device + radio in the single-radio shape, keyed per radio.
export function radioView(ap, radio) {
  const { radios, ...device } = ap
  return {
    ...device,
    id: radioKey(ap.id, radio.band),
    deviceId: ap.id,
    frequency: radio.band,
    channel: radio.channel,
    channelWidth: radio.channelWidth,
    txPower: radio.txPower,
    antennaPeakGainDbi: radio.antennaPeakGainDbi ?? null,
  }
}

// Every enabled radio of every device, as radio views.
export function expandRadios(aps) {
  const out = []
  for (const ap of aps ?? []) {
    if (isRadioView(ap)) { out.push(ap); continue }
    for (const r of enabledRadios(ap)) out.push(radioView(ap, r))
  }
  return out
}

// Write per-radio results (Map<radioKey, value>) back onto devices:
// `toPatch(value)` gives the radio patch. Devices with nothing to change
// keep their identity.
export function applyRadioResults(aps, results, toPatch) {
  return (aps ?? []).map((ap) => {
    let changed = false
    const radios = apRadios(ap).map((r) => {
      const key = radioKey(ap.id, r.band)
      if (!results.has(key)) return r
      changed = true
      return { ...r, ...toPatch(results.get(key)) }
    })
    return changed ? { ...ap, radios } : ap
  })
}

// Radio keys of every radio (enabled or not) -- the live set for caches.
export function allRadioKeys(aps) {
  const out = []
  for (const ap of aps ?? []) for (const r of apRadios(ap)) out.push(radioKey(ap.id, r.band))
  return out
}
