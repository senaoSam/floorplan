// SNR → MCS → PHY data-rate lookup for Client View.
//
// Goal: given the SNR a client sees from its serving AP, plus the client's
// PHY (Wi-Fi 5/6/6E/7), channel width and spatial-stream count, report the
// MCS the link would run at and the resulting PHY rate (Mbps). This is the
// "Data rate" figure in the Client Experience pane.
//
// Model (standard 802.11, not invented):
//   - The 802.11ax/be MCS ladder (0..13) with its modulation + coding labels.
//   - Per-MCS minimum SNR thresholds (dB) — typical receiver sensitivity
//     values used across the industry (e.g. Cisco / Aruba design guides).
//     Wi-Fi 5 (11ac) tops out at MCS 9 (256-QAM); Wi-Fi 6/6E (11ax) adds
//     MCS 10/11 (1024-QAM); Wi-Fi 7 (11be) adds MCS 12/13 (4096-QAM).
//   - PHY rate = baseRate20MHz1ss[mcs] × widthFactor × spatialStreams.
//     baseRate is the 11ax 20 MHz / 1 SS / 0.8 µs GI rate ladder; width and
//     stream scaling are linear (the standard's data-subcarrier counts make
//     this exact to within rounding for the figures we display).
//   - 57-29: 11ac (VHT) and 11n (HT) use their own ladders -- 52 data
//     subcarriers at 20 MHz and a 3.2 µs symbol + 0.4 µs short GI, not HE's
//     234 / 12.8 µs -- and 11ac drops to 11n on 2.4 GHz (VHT is 5 GHz only).

// MCS ladder labels. Index = MCS number.
const MCS_LABELS = [
  'BPSK 1/2',       // 0
  'QPSK 1/2',       // 1
  'QPSK 3/4',       // 2
  '16-QAM 1/2',     // 3
  '16-QAM 3/4',     // 4
  '64-QAM 2/3',     // 5
  '64-QAM 3/4',     // 6
  '64-QAM 5/6',     // 7
  '256-QAM 3/4',    // 8
  '256-QAM 5/6',    // 9
  '1024-QAM 3/4',   // 10
  '1024-QAM 5/6',   // 11
  '4096-QAM 3/4',   // 12
  '4096-QAM 5/6',   // 13
]

// Minimum SNR (dB) to sustain each MCS. Monotonic increasing.
const MCS_MIN_SNR = [
  2,    // 0  BPSK 1/2
  5,    // 1  QPSK 1/2
  9,    // 2  QPSK 3/4
  11,   // 3  16-QAM 1/2
  15,   // 4  16-QAM 3/4
  18,   // 5  64-QAM 2/3
  20,   // 6  64-QAM 3/4
  25,   // 7  64-QAM 5/6
  29,   // 8  256-QAM 3/4
  31,   // 9  256-QAM 5/6
  36,   // 10 1024-QAM 3/4
  39,   // 11 1024-QAM 5/6
  43,   // 12 4096-QAM 3/4
  46,   // 13 4096-QAM 5/6
]

// 802.11ax base PHY rate (Mbps) for 20 MHz, 1 spatial stream, 0.8 µs GI,
// indexed by MCS. Width and stream scaling are applied on top.
const BASE_RATE_20_1SS = [
  8.6,    // 0
  17.2,   // 1
  25.8,   // 2
  34.4,   // 3
  51.6,   // 4
  68.8,   // 5
  77.4,   // 6
  86.0,   // 7
  103.2,  // 8
  114.7,  // 9
  129.0,  // 10
  143.4,  // 11
  154.9,  // 12  (11be 4096-QAM extrapolated from 1024-QAM ladder)
  172.1,  // 13
]

// 57-29: 802.11n/ac (HT/VHT) base PHY rate (Mbps) for 20 MHz, 1 SS, 400 ns
// short GI -- the max-rate config, like HE's 0.8 µs above. VHT MCS 9 is not
// defined at 20 MHz for 1 / 2 SS (see maxMcs); its 96.3 only scales to 40+.
const BASE_RATE_VHT_20_1SS = [7.2, 14.4, 21.7, 28.9, 43.3, 57.8, 65.0, 72.2, 86.7, 96.3]

// Highest MCS each PHY generation can reach.
const MAX_MCS_BY_PHY = {
  '11n':  7,   // Wi-Fi 4  → 64-QAM
  '11ac': 9,   // Wi-Fi 5  → 256-QAM
  '11ax': 11,  // Wi-Fi 6/6E → 1024-QAM
  '11be': 13,  // Wi-Fi 7  → 4096-QAM
}

// 57-29: generation order, so a link runs at min(AP, client).
const PHY_RANK = { '11n': 0, '11ac': 1, '11ax': 2, '11be': 3 }
export const minPhy = (a, b) => (PHY_RANK[a] ?? 2) <= (PHY_RANK[b] ?? 2) ? a : b

// The PHY a link actually uses on `band`: 11ac is 5 GHz only, so an 11ac
// client on 2.4 GHz runs 11n.
export function phyOnBand(phy, band) {
  return phy === '11ac' && band === 2.4 ? '11n' : phy
}

// Linear width factor relative to 20 MHz, from HE (11ax) data-subcarrier
// counts: 20→234, 40→468, 80→980, 160→1960. Ratios vs the 234 baseline:
//   40 → 2.0, 80 → 4.19, 160 → 8.38.
function widthFactor(width) {
  if (width >= 160) return 8.38
  if (width >= 80)  return 4.19
  if (width >= 40)  return 2.0
  return 1.0
}

// HT/VHT data subcarriers: 20→52, 40→108, 80→234, 160→468.
function widthFactorVht(width) {
  if (width >= 160) return 9.0
  if (width >= 80)  return 4.5
  if (width >= 40)  return 108 / 52
  return 1.0
}

const isLegacyPhy = (phy) => phy === '11n' || phy === '11ac'

// Pick the highest MCS sustainable at the given SNR, capped by the client PHY.
// Returns -1 when SNR is below even MCS 0 (no usable link).
export function mcsForSnr(snrDb, phy, channelWidthMHz = 20, spatialStreams = 1) {
  let maxMcs = MAX_MCS_BY_PHY[phy] ?? 11
  // 57-29: VHT MCS 9 is undefined at 20 MHz except with 3 spatial streams.
  if (phy === '11ac' && (channelWidthMHz ?? 20) < 40 && spatialStreams !== 3) maxMcs = 8
  let mcs = -1
  for (let i = 0; i <= maxMcs; i++) {
    if (snrDb >= MCS_MIN_SNR[i]) mcs = i
    else break
  }
  return mcs
}

// Full data-rate estimate for a client link.
// Args:
//   snrDb           — SNR the client sees from its serving AP
//   phy             — link PHY ('11n' | '11ac' | '11ax' | '11be'): min of AP
//                     and client, already resolved for the band (phyOnBand)
//   channelWidthMHz — effective channel width (min of AP width and client max)
//   spatialStreams  — min of AP and client stream counts
// Returns: { mcs, mcsLabel, phyRateMbps, modulation } or { mcs:-1, ... } when
//          the link can't sustain MCS 0.
export function estimateDataRate(snrDb, phy, channelWidthMHz, spatialStreams) {
  const nss = Math.max(1, spatialStreams ?? 1)
  // 11n tops out at 40 MHz.
  const width = phy === '11n' ? Math.min(channelWidthMHz ?? 20, 40) : (channelWidthMHz ?? 20)
  const mcs = mcsForSnr(snrDb, phy, width, nss)
  if (mcs < 0) {
    return { mcs: -1, mcsLabel: '—', phyRateMbps: 0, modulation: 'no link' }
  }
  const rate = isLegacyPhy(phy)
    ? BASE_RATE_VHT_20_1SS[mcs] * widthFactorVht(width) * nss
    : BASE_RATE_20_1SS[mcs] * widthFactor(width) * nss
  return {
    mcs,
    mcsLabel: MCS_LABELS[mcs],
    modulation: MCS_LABELS[mcs],
    phyRateMbps: Math.round(rate),
  }
}
