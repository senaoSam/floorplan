import React from 'react';

export default function ControlPanel({ scenario, options, setOptions, updateAp, resetScenario }) {
  return (
    <div className="control-panel">
      <section>
        <h3>模擬參數 (Physics)</h3>
        <label className="row">
          <input
            type="checkbox"
            checked={options.reflections}
            onChange={(e) => setOptions({ ...options, reflections: e.target.checked })}
          />
          <span>反射 (1st-order, image source)</span>
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={options.diffraction}
            onChange={(e) => setOptions({ ...options, diffraction: e.target.checked })}
          />
          <span>繞射 (UTD / knife edge)</span>
        </label>
        <label className="row">
          <span>網格精度: {options.gridStepM.toFixed(2)} m</span>
          <input
            type="range" min="0.2" max="0.8" step="0.05"
            value={options.gridStepM}
            onChange={(e) => setOptions({ ...options, gridStepM: parseFloat(e.target.value) })}
          />
        </label>
        <label className="row">
          <span>平滑 (blur): {options.blur} px</span>
          <input
            type="range" min="0" max="24" step="1"
            value={options.blur}
            onChange={(e) => setOptions({ ...options, blur: parseInt(e.target.value, 10) })}
          />
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={options.showApRings}
            onChange={(e) => setOptions({ ...options, showApRings: e.target.checked })}
          />
          <span>AP 距離虛線圈 (3 / 8 / 14 m)</span>
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={options.showContours}
            onChange={(e) => setOptions({ ...options, showContours: e.target.checked })}
          />
          <span>訊號等高線 (臨界值黑線)</span>
        </label>
      </section>

      <section>
        <h3>Access Points</h3>
        {scenario.aps.map((ap, i) => (
          <div className="ap-card" key={ap.id}>
            <div className="ap-head">
              <strong>{ap.id}</strong>
              <span className="chip">5GHz · Ch36@40 · 5190 MHz</span>
            </div>
            <div className="ap-row">
              <label>Tx (dBm)</label>
              <input
                type="number" min="5" max="23"
                value={ap.txDbm}
                onChange={(e) => updateAp(i, { txDbm: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="ap-row">
              <label>X (m)</label>
              <input
                type="number" step="0.1"
                value={ap.pos.x.toFixed(2)}
                onChange={(e) => updateAp(i, { pos: { ...ap.pos, x: parseFloat(e.target.value) || 0 } })}
              />
              <label>Y (m)</label>
              <input
                type="number" step="0.1"
                value={ap.pos.y.toFixed(2)}
                onChange={(e) => updateAp(i, { pos: { ...ap.pos, y: parseFloat(e.target.value) || 0 } })}
              />
            </div>
          </div>
        ))}
        <button className="btn-secondary" onClick={resetScenario}>還原預設場景</button>
      </section>

      <section className="hint">
        <h3>說明</h3>
        <ul>
          <li>拖曳地圖上的 AP 可重新定位。</li>
          <li>兩台 AP 同頻 (Ch36) → 會以 SINR 方式計入同頻干擾。</li>
          <li>牆壁: 外牆 12 dB / 內牆 8 dB，斜入射有 sec(θ) 放大。</li>
          <li>傳播模型: ITU-R P.1238 室內 + Friis，混合取悲觀值。</li>
        </ul>
      </section>
    </div>
  );
}
