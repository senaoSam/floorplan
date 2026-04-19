// ITU-R P.2040 材料模型工具
// 嚴格對應 .tmp-heatmap/02-material-models.md §1.2 / §1.3
//
// 用法：使用者提供「在 refFreqMHz 下此材質 = X dB」(refAttDb)，
// 引擎用四參數 (a, b, c, d) 計算 α(refFreq) 與 α(targetFreq)，
// 把 X dB 按 α_tgt / α_ref 比例縮放到目標頻段。
// 金屬 (isConductor=true) 直接回傳 refAttDb（頻率相關性小）。

// f 單位：規格範例 Python 傳入 MHz，內部用 GHz 餵 (a,b,c,d)
// α 公式裡的常數對 ratio 會抵消，所以單位選擇只要前後一致即可

// η'(f_GHz) = a · f^b
function eta(a, b, fGhz) {
  return a * Math.pow(fGhz, b)
}

// σ(f_GHz) = c · f^d
function sigma(c, d, fGhz) {
  return c * Math.pow(fGhz, d)
}

// 複數虛部：Im(√z)，z = re + j·im
// √(re + j·im) 的虛部 = sign(im) · √((|z| - re) / 2)
function sqrtComplexImag(re, im) {
  const mag = Math.hypot(re, im)
  const inner = (mag - re) / 2
  // inner 應 >= 0；浮點誤差可能微負
  const v = Math.sqrt(Math.max(inner, 0))
  return im >= 0 ? v : -v
}

// α(f) = (20π · f · √η') / (ln(10) · c_light) · Im(√(1 - j·18σ/(f_GHz · η')))
// 對 ratio 而言只需保留與頻率相關項：f_MHz · √η' · Im(√(1 - j·18σ/(f_GHz·η')))
// 常數 20π / (ln(10) · c_light) 在 ratio 中抵消
function alphaFreqDependent(fMhz, etaPrime, sigmaVal) {
  const fGhz = fMhz / 1000
  // 1 - j·18σ/(f_GHz·η')
  const re = 1
  const im = -(18 * sigmaVal) / (fGhz * etaPrime)
  const imagPart = sqrtComplexImag(re, im)
  return fMhz * Math.sqrt(etaPrime) * imagPart
}

// 主入口：把 refAttDb 從 refFreqMHz 外推到 targetFreqMHz
//
// material: { refAttDb, refFreqMHz, a, b, c, d, isConductor }
//   - refAttDb       — 使用者輸入「在 refFreqMHz 下此牆 = X dB」
//   - refFreqMHz     — 對應的參考頻率（通常 2400 或 5000）
//   - a,b,c,d        — ITU-R P.2040-3 表格係數（介電質用）
//   - isConductor    — 金屬旗標
export function wallAttAtFreq(material, targetFreqMhz) {
  if (!material) return 0
  const { refAttDb, refFreqMHz, a, b, c, d, isConductor } = material
  if (refAttDb == null || refFreqMHz == null) return 0
  if (isConductor) return refAttDb

  const refGhz = refFreqMHz / 1000
  const tgtGhz = targetFreqMhz / 1000

  const etaRef = eta(a, b, refGhz)
  const sigRef = sigma(c, d, refGhz)
  const etaTgt = eta(a, b, tgtGhz)
  const sigTgt = sigma(c, d, tgtGhz)

  const alphaRef = alphaFreqDependent(refFreqMHz, etaRef, sigRef)
  const alphaTgt = alphaFreqDependent(targetFreqMhz, etaTgt, sigTgt)

  if (alphaRef === 0 || !isFinite(alphaRef)) return refAttDb
  return refAttDb * (alphaTgt / alphaRef)
}
