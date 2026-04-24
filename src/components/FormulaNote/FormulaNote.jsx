import React from 'react'
import './FormulaNote.sass'

// Reflects the algorithm actually running in src/features/heatmap/.
// Keep this in sync with propagation.js when parameters change.
function FormulaNote() {
  return (
    <div className="formula-note">
      <section>
        <h4>1. 路徑損失（每台 AP 按自身頻率）</h4>
        <p>使用 Friis 自由空間公式：</p>
        <p><code>PL = 20·log₁₀(d) + 20·log₁₀(f_MHz) − 27.55</code></p>
        <p className="muted">
          d 取 max(d, 0.5 m) 避免近場奇異。f_MHz 由 AP 的 band + channel 算出中心頻率，
          不寫死 5 GHz。室內衰減靠第 2 點顯式逐牆累加，不再混合 ITU-R P.1238
          site-general 模型以避免與顯式牆損雙重計損。
        </p>
      </section>

      <section>
        <h4>2. 牆體穿透（斜入射放大）</h4>
        <p>
          每道穿越的牆/門窗累加 <code>L_wall · sec(θ_i)</code>，
          <code>θ_i</code> 為射線與牆面法線夾角，<code>sec</code> 上限 3.5（約 79°）避免掠射爆衝。
        </p>
        <p className="muted">L_wall 來自材質的 dbLoss；門窗則用 opening.material 的 dbLoss 取代該段牆。</p>
      </section>

      <section>
        <h4>3. 一階鏡面反射（複數 Fresnel）</h4>
        <p>對每道牆建立 AP 鏡像點，與接收點連線交於反射點。材質用 ITU-R P.2040-3 係數
          <code>(a, b, c, d)</code>，按 AP 的中心頻率推出複數相對介電常數：</p>
        <p>
          <code>η′ = a · f_GHz^b</code>、<code>σ = c · f_GHz^d</code> (S/m)<br />
          <code>ε_c = η′ − j · σ / (2π · f · ε₀)</code>
        </p>
        <p>Fresnel 複數反射係數（TE / TM 極化）：</p>
        <p>
          <code>Γ_⊥ = (cosθ − √(ε_c − sin²θ)) / (cosθ + √(ε_c − sin²θ))</code><br />
          <code>Γ_∥ = (ε_c·cosθ − √(ε_c − sin²θ)) / (ε_c·cosθ + √(ε_c − sin²θ))</code>
        </p>
        <p className="muted">
          粗糙度因子 <code>e^(−2(k·σ_r·cosθ)²)</code> 作為實數衰減另外乘入（與 Rayleigh 準則一致）。
          金屬視為完美導體 <code>Γ → −1</code>。
          不再額外乘 <code>(0.5 + 0.5·cosθ)</code>（Fresnel 本身已含角度依賴），也不再固定加 π 相位
          （相位由 Fresnel 複數值自然帶出）。
        </p>
      </section>

      <section>
        <h4>4. Knife-Edge 繞射（Lee 近似）</h4>
        <p>直射路徑被牆擋住時，對每個牆端點（corner）計算 Fresnel-Kirchhoff 參數：</p>
        <p><code>v = h · √(2/λ · (d₁+d₂)/(d₁·d₂))</code></p>
        <p className="muted">
          用 Lee 分段近似換算額外 dB 損失（ITU-R P.526 系列 knife-edge）。
          注意這是薄刀口近似，不是完整 UTD wedge 繞射。
          corner 兩段路徑各自只允許穿過 ≤1 道牆，且繞射損失 &gt;40 dB 的路徑會捨棄。
        </p>
      </section>

      <section>
        <h4>5. 多路徑寬頻相干疊加（雙極化通道）</h4>
        <p>
          為了保留正交極化的獨立性，把 scalar 通道拆成兩個互相獨立的極化通道
          <code>H_⊥(f)</code>、<code>H_∥(f)</code>。每條路徑在兩通道各自攜帶複數增益
          <code>aₙ,⊥</code>、<code>aₙ,∥</code> 與共同延遲 <code>τₙ = dₙ / c</code>：
        </p>
        <ul>
          <li>
            直射 / 繞射：<code>aₙ,⊥ = aₙ,∥ = (1/√2) · √(P_rx,n)</code>，其中
            <code>P_rx,n = P_tx + G_tx + G_rx − PL_total,n</code>（dBm）。
            1/√2 代表發射端以兩個正交極化基底等功率激發。
          </li>
          <li>
            反射：<code>aₙ,p = (1/√2) · √(P_rx,n) · roughness · Γ_p</code>，
            <code>Γ_p</code> 取第 3 點的 Fresnel 複數係數（p 為 ⊥ 或 ∥）。
          </li>
        </ul>
        <p>
          在 channel 有效頻寬（BW × 0.9，避開 guard band）內取 N 個等距頻點，
          兩通道各自相干疊加後在功率域合成：
        </p>
        <p>
          <code>H_p(fᵢ) = Σ aₙ,p · e^(−j·2π·fᵢ·τₙ)</code>，
          <code>P(fᵢ) = |H_⊥(fᵢ)|² + |H_∥(fᵢ)|²</code><br />
          <code>RSSI = 10·log₁₀( (1/N)·Σᵢ P(fᵢ) )</code>
        </p>
        <p className="muted">
          N = max(5, ⌈BW_MHz / 4⌉)，Δf ≲ 4 MHz 足以涵蓋室內典型延遲擴展 (~125 ns)。
          頻域取樣避免窄頻 null 被當作整個 channel 的黑洞；
          雙通道合成是 polarization-agnostic receiver 的近似，
          不代表特定單極化天線的瞬時複數通道。
        </p>
      </section>

      <section>
        <h4>6. 訊號品質指標聚合（RSSI / SINR / SNR / CCI）</h4>
        <ul>
          <li>RSSI = 最強 AP 的接收功率（client 會 associate 到它）</li>
          <li>
            SINR 分母加入「頻譜真的重疊」的其他 AP（依 band + channel + channelWidth 判斷），
            干擾與雜訊在線性功率 (mW) 域相加：<br />
            <code>SINR_dB = S_dBm − 10·log₁₀(10^(N/10) + Σ 10^(I_k/10))</code>
          </li>
          <li>
            SNR = 忽略干擾的訊號雜訊比，上限參考：<br />
            <code>SNR_dB = S_dBm − N_dBm</code>
          </li>
          <li>
            CCI = 同頻干擾功率總和（dBm），越低越好：<br />
            <code>CCI_dBm = 10·log₁₀( Σ 10^(I_k/10) )</code>（無干擾時 −∞）
          </li>
          <li>noise floor N = −95 dBm</li>
        </ul>
      </section>

      <section>
        <h4>7. 天線方向性（發射端增益）</h4>
        <p>
          每條離開 AP 的射線（直射終點、反射點、繞射 corner）依其離軸角
          <code>|Δθ|</code> 取天線增益：
        </p>
        <ul>
          <li>Omni：固定 <code>G_tx = AP_ANT_GAIN_DBI</code>（3 dBi）</li>
          <li>
            Directional：半波瓣寬 <code>φ/2</code> 內為峰值增益，
            外側 15° 線性跌到 <code>−20 dB</code> 的背瓣。
          </li>
          <li>
            Custom pattern：<code>G_tx = 峰值 + sampleGain(pattern, |Δθ|)</code>，
            pattern 為 36 個 10° 取樣（bore-sight = 0 dB）
          </li>
        </ul>
        <p className="muted">
          方位角 <code>azimuth</code> 用 canvas 座標（+x = 0°、+y = 90°），與 APLayer 顯示一致。
          接收端仍當 omni（<code>G_rx = RX_ANT_GAIN_DBI</code>）。
        </p>
      </section>

      <section>
        <h4>8. 跨樓層訊號（樓板衰減 + FloorHole bypass）</h4>
        <p>
          所有樓層的 AP 都參與計算。每個 AP 的絕對高度
          <code>Z_ap = floor.elevation + ap.z</code>，接收端則是
          <code>Z_rx = 當前樓層.elevation + 1.0 m</code>（預設觀察高度）。
        </p>
        <ul>
          <li>
            <b>3D 距離</b>：直射路徑的 Friis 自由空間損失改用 3D 距離
            <code>d = √(Δx² + Δy² + Δz²)</code>。
          </li>
          <li>
            <b>樓板衰減（Slab loss）</b>：射線從 Z_ap 到 Z_rx 垂直跨越的每一道樓板邊界都累加
            <code>floor.floorSlabAttenuationDb</code>（預設 concrete 12 dB）。
          </li>
          <li>
            <b>FloorHole bypass</b>：射線穿越某道樓板邊界 y=b 時，求該 XY 交點
            <code>(x(t), y(t))</code>，若落在該邊界有效的任一 FloorHole 多邊形內 → 該層 slab 不計。
            Hole 的垂直範圍由 <code>bottomFloorId</code> ~ <code>topFloorId</code> 決定，
            預設只 bypass 自己樓層的天花板。
          </li>
          <li>
            <b>跨樓層簡化</b>：當射線跨越 ≥ 1 層樓板時，
            關閉反射 / 繞射（walls 是 2D segment，鏡像幾何在跨樓層沒物理意義），
            也不計其他樓層的牆衰減。這些限制將在後續任務放寬。
          </li>
        </ul>
      </section>

      <section>
        <h4>9. Scope 遮罩</h4>
        <p>
          若存在至少一個 in-scope 多邊形，網格點必須落在其中之一才算；
          落在任一 out-scope 多邊形內的點也會被剔除。被剔除的點標成 NaN，
          在 shader 丟棄成透明。無 in-scope 時則全部點都計算，僅受 out-scope 剔除。
        </p>
      </section>

      <section className="muted small">
        演算法來源：<code>heatmap_sample/</code>（image-source reflection / knife-edge 繞射 /
        secant 穿透）。本系統的 propagation adapter 相對 sample 有幾點差異：
        (1) 路徑損失改為純 Friis，不再與 ITU-R P.1238 取 max；
        (2) 頻率參數化為 per-AP（<code>ap.centerMHz</code>，缺值 fallback 5190 MHz）；
        (3) 反射改用 ITU-R P.2040-3 材質係數 + 複數 Fresnel，並拆成兩個正交極化通道在功率域合成；
        (4) 多路徑在整個 channel 頻寬內取 N 個頻點做寬頻平均；
        (5) SINR 只累計頻譜重疊的 AP；
        (6) 多樓層：所有樓層 AP 共用同一套 propagation，直射加 slab loss，
        FloorHole 可 bypass，跨樓層射線關閉反射/繞射與其他樓層牆穿透。
      </section>
    </div>
  )
}

export default FormulaNote
