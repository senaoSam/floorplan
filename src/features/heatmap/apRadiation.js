// 57-23: what an AP actually radiates -- peak antenna gain and conducted TX
// power after the regulatory EIRP cap. Single source for buildScenario (so
// both engines, hover, Client View and the planners agree) and the AP panel.
//
// Peak gain:
//   omni               -> the model's per-band gain (fallback AP_ANT_GAIN_DBI)
//   directional/custom -> the user's `antennaPeakGainDbi` when set, otherwise
//                         the pattern's directivity. The model's omni gain no
//                         longer applies once the radiation is shaped -- a
//                         narrower beam concentrates the same power.
// TX power:
//   min(set TX, EIRP limit - peak gain). Real APs derate conducted power the
//   same way from their country code and configured antenna gain.

import { getAPAntennaGain, getDefaultTxPower } from '@/constants/apModels'
import { getPatternById, patternDirectivityDbi, directionalDirectivityDbi } from '@/constants/antennaPatterns'
import { eirpLimitDbm } from '@/constants/regulatoryDomains'
import { channelRangeMHz } from './frequency'
import { AP_ANT_GAIN_DBI } from './rfConstants'

export function autoPeakGainDbi(ap) {
  const mode = ap.antennaMode ?? 'omni'
  if (mode === 'directional') return directionalDirectivityDbi(ap.beamwidth ?? 60)
  if (mode === 'custom') return patternDirectivityDbi(getPatternById(ap.patternId))
  return getAPAntennaGain(ap) ?? AP_ANT_GAIN_DBI
}

export function resolveApRadiation(ap, domainId) {
  const band = ap.frequency ?? 5
  const shaped = (ap.antennaMode ?? 'omni') !== 'omni'
  const autoPeak = autoPeakGainDbi(ap)
  const peak = shaped && Number.isFinite(ap.antennaPeakGainDbi) ? ap.antennaPeakGainDbi : autoPeak
  const setTx = ap.txPower ?? getDefaultTxPower(band)
  const [lo, hi] = channelRangeMHz(band, ap.channel ?? 36, ap.channelWidth ?? 20)
  const limit = eirpLimitDbm(domainId, lo, hi)
  const tx = limit == null ? setTx : Math.min(setTx, limit - peak)
  return {
    peakGainDbi: peak,
    autoPeakGainDbi: autoPeak,
    setTxDbm: setTx,
    txDbm: tx,
    eirpDbm: tx + peak,
    eirpLimitDbm: limit,
    capped: tx < setTx,
  }
}
