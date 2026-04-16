import React, { useState } from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import { REGULATORY_LIST } from '@/constants/regulatoryDomains'
import './RegulatorySelector.sass'

function RegulatorySelector() {
  const domainId = useEditorStore((s) => s.regulatoryDomain)
  const setDomain = useEditorStore((s) => s.setRegulatoryDomain)
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="regulatory-selector">
      <div className="regulatory-selector__header" onClick={() => setCollapsed((v) => !v)}>
        <span className="regulatory-selector__icon">🌐</span>
        <span className="regulatory-selector__title">國家頻段</span>
        <span className={`regulatory-selector__arrow${collapsed ? ' regulatory-selector__arrow--collapsed' : ''}`}>▾</span>
      </div>
      {!collapsed && (
        <div className="regulatory-selector__body">
          <select
            className="regulatory-selector__select"
            value={domainId}
            onChange={(e) => setDomain(e.target.value)}
          >
            {REGULATORY_LIST.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}

export default RegulatorySelector
