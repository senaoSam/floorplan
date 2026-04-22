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
        <h4>3. 一階鏡面反射（Image-Source）</h4>
        <ul>
          <li>對每道牆建立 AP 鏡像點，與接收點連線交於反射點</li>
          <li>反射損失：<code>R = |Γ| · (0.5 + 0.5·cos θ_i) · e^(−2(k·σ·cos θ_i)²)</code></li>
          <li>σ 是表面粗糙度 (Rayleigh)；<code>|Γ|</code> 由材質決定</li>
          <li>反射引入 π 相位</li>
        </ul>
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
        <h4>5. 多路徑相干疊加</h4>
        <p>
          每條路徑都轉為複數電壓 <code>V = √(P_rx) · e^(j·(k·d + φ))</code>，
          其中 <code>P_rx = P_tx + G_tx + G_rx − PL_total</code>（dBm），
          G_tx、G_rx 分別是 AP 與接收端天線增益（<code>AP_ANT_GAIN_DBI</code>、
          <code>RX_ANT_GAIN_DBI</code>）。全部加總後取 |V|² 作為功率。
        </p>
      </section>

      <section>
        <h4>6. 同頻 SINR 聚合</h4>
        <ul>
          <li>RSSI 取最強 AP (client 會 associate 到它)</li>
          <li>SINR 分母只加入「頻譜真的重疊」的其他 AP（依 band + channel + channelWidth 判斷）</li>
          <li>
            雜訊與干擾在線性功率 (mW) 域相加：<br />
            <code>SINR_dB = S_dBm − 10·log₁₀(10^(N/10) + Σ 10^(I_k/10))</code><br />
            noise floor N = −95 dBm
          </li>
        </ul>
      </section>

      <section>
        <h4>7. Scope 遮罩</h4>
        <p>
          若存在至少一個 in-scope 多邊形，網格點必須落在其中之一才算；
          落在任一 out-scope 多邊形內的點也會被剔除。被剔除的點標成 NaN，
          在 shader 丟棄成透明。無 in-scope 時則全部點都計算，僅受 out-scope 剔除。
        </p>
      </section>

      <section className="muted small">
        演算法來源：<code>heatmap_sample/</code>（image-source reflection / knife-edge 繞射 /
        secant 穿透）。本系統的 propagation adapter 相對 sample 有兩點差異：
        (1) 路徑損失改為純 Friis，不再與 ITU-R P.1238 取 max；
        (2) 頻率參數化為 per-AP（<code>ap.centerMHz</code>，缺值 fallback 5190 MHz），
        SINR 只累計頻譜重疊的 AP。
      </section>
    </div>
  )
}

export default FormulaNote
