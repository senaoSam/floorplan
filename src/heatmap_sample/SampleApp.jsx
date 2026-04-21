import React, { useState, useCallback } from 'react';
import FloorCanvas from './components/FloorCanvas.jsx';
import ControlPanel from './components/ControlPanel.jsx';
import Legend from './components/Legend.jsx';
import { defaultScenario } from './physics/scenario.js';
import './styles.css';

export default function SampleApp() {
  const [scenario, setScenario] = useState(() => defaultScenario());
  const [options, setOptions] = useState({
    reflections: true,
    diffraction: true,
    gridStepM: 0.5,
    blur: 8,
    showApRings: true,
    showContours: true
  });
  const [hover, setHover] = useState(null);

  const updateAp = useCallback((idx, patch) => {
    setScenario((s) => {
      const aps = s.aps.map((ap, i) => (i === idx ? { ...ap, ...patch } : ap));
      return { ...s, aps };
    });
  }, []);

  const onApMove = useCallback((idx, pos) => {
    updateAp(idx, { pos });
  }, [updateAp]);

  const resetScenario = () => setScenario(defaultScenario());

  return (
    <div className="heatmap-sample-root">
    <div className="app-root">
      <header className="app-header">
        <div className="brand">
          <a
            className="back-link"
            href="#/"
            onClick={(e) => {
              e.preventDefault();
              window.location.hash = '';
            }}
          >
            ← 回主系統
          </a>
          <div className="brand-mark" />
          <div>
            <h1>RSSI Heatmap Simulator</h1>
            <small>5 GHz · Ch36 @ 40 MHz · 5190 MHz &nbsp;|&nbsp; Office Floor Simulation</small>
          </div>
        </div>
        <div className="head-stats">
          {hover ? (
            <>
              <span><b>位置</b> ({hover.at.x.toFixed(2)}, {hover.at.y.toFixed(2)}) m</span>
              <span><b>RSSI</b> {hover.rssiDbm.toFixed(1)} dBm</span>
              <span><b>SINR</b> {hover.sinrDb.toFixed(1)} dB</span>
              {hover.perAp.map((v, i) => (
                <span key={i}><b>AP-{i + 1}</b> {v.toFixed(1)}</span>
              ))}
            </>
          ) : (
            <span className="muted">將滑鼠移到地圖查看該點的 RSSI / SINR</span>
          )}
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <ControlPanel
            scenario={scenario}
            options={options}
            setOptions={setOptions}
            updateAp={updateAp}
            resetScenario={resetScenario}
          />
        </aside>

        <main className="canvas-wrap">
          <FloorCanvas
            scenario={scenario}
            options={options}
            onApMove={onApMove}
            hoverCallback={setHover}
          />
          <Legend />
        </main>
      </div>

      <footer className="app-footer">
        <span>Propagation: ITU-R P.1238 + Friis blend · Image-source reflections · UTD knife-edge diffraction · Oblique wall penetration</span>
      </footer>
    </div>
    </div>
  );
}
