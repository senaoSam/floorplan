import React from 'react';
import { dbmToRgb } from '../render/colormap.js';

const bands = [
  { label: '極強 (Excellent)',  range: '-30 ~ -50 dBm', mid: -40 },
  { label: '優良 (Good)',       range: '-51 ~ -60 dBm', mid: -55 },
  { label: '普通 (Fair)',       range: '-61 ~ -70 dBm', mid: -65 },
  { label: '不佳 (Poor)',       range: '-71 ~ -80 dBm', mid: -75 },
  { label: '極差 (Very Poor)',  range: '-81 ~ -90 dBm', mid: -85 }
];

export default function Legend() {
  return (
    <div className="legend">
      <div className="legend-title">Signal Strength (RSSI)</div>
      {bands.map((b) => {
        const [r, g, bl] = dbmToRgb(b.mid);
        return (
          <div key={b.label} className="legend-row">
            <span className="legend-swatch" style={{ background: `rgb(${r},${g},${bl})` }} />
            <span className="legend-label">{b.label}</span>
            <span className="legend-range">{b.range}</span>
          </div>
        );
      })}
      <div className="legend-gradient">
        <div className="gradient-bar" />
        <div className="gradient-ticks">
          <span>-30</span><span>-50</span><span>-70</span><span>-90</span>
        </div>
      </div>
    </div>
  );
}
