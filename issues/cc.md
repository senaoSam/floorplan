FormulaNote.jsx 七個公式的問題分析
對照 propagation.js 實際程式碼，問題如下：

公式 1（路徑損失）— 小問題

文案寫 f_MHz，但 Friis 標準式單位要一致；這裡用的是 20·log₁₀(f_MHz) − 27.55（27.55 = 20·log₁₀(4π/c)·以 MHz+m 為單位的常數），公式沒錯但沒標單位。
propagation.js:32 對距離做了 dEff = max(d, 0.5) 近場 clamp，公式裡完全沒提。
公式 2（牆體穿透）— 大致正確

sec 上限 3.5 對應 propagation.js:38 的 1 / max(cosI, 0.2)，寫 ~79° 是 acos(0.2)=78.46°，OK。
但「門窗用 opening.material 的 dbLoss 取代該段牆」說法不精確：buildScenario.js:55-80 是把牆切成多段 sub-segment，門窗段帶自己的 lossDb，並不是「取代」而是獨立子段。
公式 3（一階鏡面反射）— 缺一個重要修正

文案寫 R = |Γ|·(0.5 + 0.5·cos θ_i)·e^(−2(k·σ·cos θ_i)²)，對應 propagation.js:109-111，但程式把 R 再用 -20·log₁₀(max(R, 1e-3)) 換成 dB 再疊加，並且有 rFactor < 0.02 → 放棄 與 cosI < 0.05 → 放棄（grazing）這兩個閾值，公式沒寫。
「反射引入 π 相位」對應 propagation.js:121 pathPhasor(..., Math.PI)，正確。
公式 4（UTD Knife-Edge）— 名稱與實作不符

標題叫 "UTD"，但 propagation.js:53-59 用的是 ITU-R P.526 / Lee 近似的 knife-edge，不是 UTD（UTD 需要 Keller coefficient）。文案自己在「演算法來源」那段也寫 "UTD"，前後一致但都不正確——應改成 "Knife-Edge (Lee approximation)" 或 "ITU-R P.526 knife-edge"。
公式 v = h·√(2/λ·(d₁+d₂)/(d₁·d₂)) 正確，但程式實際呼叫的是 knifeEdgeLossDb(-v) 再取 Math.abs（propagation.js:69），這個符號處理沒解釋。
另外 corners 還要通過「只能穿過 ≤1 道牆」的過濾（propagation.js:131），公式沒提。
公式 5（多路徑相干疊加）— 公式錯誤

文案寫 複數電壓 = √(P_rx)·e^(j·(k·d + φ))，但 propagation.js:74-76 的 amp = √(dbToLin(rxPowerDb))，其中 rxPowerDb = txDbm + Gt + Gr − totalLoss。文案沒提天線增益 AP_ANT_GAIN_DBI + RX_ANT_GAIN_DBI。
「加總後取功率」對應 Re² + Im²，OK。
公式 6（同頻 SINR）— 公式有 bug

「SINR = 訊號 − 10·log₁₀(noise + ΣI_k)」維度錯誤：noise 與 I_k 在括號內必須是**線性功率（mW）**不是 dBm，但文案沒標單位。正確寫法應該是：

SINR = S_dBm − 10·log₁₀(10^(N/10) + Σ 10^(I_k/10))

對應 propagation.js:162-168 的 dbToLin 加總。目前讀起來像直接把 dBm 數值相加，會誤導讀者。

noise floor = −95 dBm 與 constants.js 的 NOISE_FLOOR_DBM 要確認一致（沒 import 不到就先相信）。

公式 7（Scope 遮罩）— 邏輯描述不準

文案寫 "In-scope 多邊形外 + Out-of-scope 多邊形內的網格點不計算"，但 buildScenario.js:169-177 的實際邏輯是：只有當存在 in-scope 時才要求點必須在某個 in-scope 內；沒有 in-scope 時全部點都算。文案寫得像 in-scope 一定存在。
最後段落（演算法來源）

寫 "UTD"，同第 4 點，應正名。
寫 "把固定 5190 MHz 參數化為 per-AP"，但 propagation.js:84 還有 ap.centerMHz || 5190 的 fallback，嚴格說還是有硬編。
要我直接修哪幾條？建議優先修 #4 名稱、#6 維度錯誤、#5 遺漏天線增益這三個，其他屬於說明精度問題。