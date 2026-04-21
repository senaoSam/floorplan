import React from 'react';
import { dbmToRgb } from '../render/colormap.js';

const bands = [
  { label: '極強 (Excellent)',  range: '> -35 dBm',     mid: -35 },
  { label: '優良 (Good)',       range: '-35 ~ -45 dBm', mid: -40 },
  { label: '普通 (Fair)',       range: '-45 ~ -55 dBm', mid: -50 },
  { label: '不佳 (Poor)',       range: '-55 ~ -65 dBm', mid: -60 },
  { label: '極差 (Very Poor)',  range: '< -75 dBm',     mid: -75 }
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
          <span>-35</span><span>-45</span><span>-55</span><span>-65</span><span>-75</span>
        </div>
      </div>
    </div>
  );
}
