import React from 'react'
import './FormulaNote.sass'

// Reflects the algorithm actually running in src/features/heatmap/.
// Keep this in sync with propagation.js when parameters change.
function FormulaNote() {
  return (
    <div className="formula-note">
      <section>
        <h4>1. 路徑損失（每台 AP 按自身頻率）</h4>
        <p>取下列兩者較悲觀值（較大者）：</p>
        <ul>
          <li><b>Friis (自由空間)</b>：<code>PL = 20·log₁₀(d) + 20·log₁₀(f_MHz) − 27.55</code></li>
          <li><b>ITU-R P.1238 (室內)</b>：<code>PL = 20·log₁₀(f_MHz) + 31·log₁₀(d) − 28</code></li>
        </ul>
        <p className="muted">f_MHz 由 AP 的 band + channel + channelWidth 算出中心頻率，不再寫死 5 GHz。</p>
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
        <h4>4. UTD Knife-Edge 繞射</h4>
        <p>直射路徑被擋時，對每個牆端點（corner）計算 Fresnel-Kirchhoff 參數：</p>
        <p><code>v = h · √(2/λ · (d₁+d₂)/(d₁·d₂))</code></p>
        <p className="muted">用 Lee 近似公式 (knifeEdgeLossDb) 換算成額外 dB 損失。</p>
      </section>

      <section>
        <h4>5. 多路徑相干疊加</h4>
        <p>
          每條路徑都轉為 <code>複數電壓 = √(P_rx) · e^(j·(k·d + φ))</code>，
          全部加總後取功率。
        </p>
      </section>

      <section>
        <h4>6. 同頻 SINR 聚合</h4>
        <ul>
          <li>RSSI 取最強 AP (client 會 associate 到它)</li>
          <li>SINR 分母只加入「頻譜真的重疊」的其他 AP（依 band + channel + channelWidth 判斷）</li>
          <li>SINR = 訊號 − 10·log₁₀(noise + ΣI_k)，noise floor = −95 dBm</li>
        </ul>
      </section>

      <section>
        <h4>7. Scope 遮罩</h4>
        <p>
          In-scope 多邊形外 + Out-of-scope 多邊形內的網格點不計算 (NaN)，
          在 shader 被丟棄成透明，避免誤導。
        </p>
      </section>

      <section className="muted small">
        演算法來源：<code>heatmap_sample/</code>（ITU-R P.1238 + Friis blend / image-source /
        UTD / secant 穿透）。本系統的 propagation adapter 保持同樣公式，僅把固定 5190 MHz
        參數化為 per-AP，並把 SINR 改成頻譜重疊過濾。
      </section>
    </div>
  )
}

export default FormulaNote
