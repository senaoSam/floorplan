import React, { useEffect, useState } from 'react'
import Toolbar from '@/components/Toolbar/Toolbar'
import SidebarLeft from '@/components/SidebarLeft/SidebarLeft'
import CanvasArea from '@/components/CanvasArea/CanvasArea'
import PanelRight from '@/components/PanelRight/PanelRight'
import ProgressPanel from '@/components/ProgressPanel/ProgressPanel'
import DemoLoader from '@/components/DemoLoader/DemoLoader'
import SampleApp from '@/heatmap_sample/SampleApp'
import './styles/App.sass'

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

function App() {
  const hash = useHashRoute()

  if (hash === '#/heatmap-sample') {
    return <SampleApp />
  }

  return (
    <div className="app">
      <Toolbar />
      <div className="app__body">
        <SidebarLeft />
        <CanvasArea />
        <PanelRight />
      </div>
      <DemoLoader />
      <ProgressPanel />
      <a
        href="#/heatmap-sample"
        style={{
          position: 'fixed',
          bottom: 12,
          left: 12,
          padding: '6px 12px',
          background: '#1e293b',
          color: '#e2e8f0',
          border: '1px solid #334155',
          borderRadius: 6,
          fontSize: 12,
          textDecoration: 'none',
          zIndex: 9999,
        }}
      >
        → Heatmap Sample
      </a>
    </div>
  )
}

export default App
