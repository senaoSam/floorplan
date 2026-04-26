import React, { useEffect, useState } from 'react'
import Toolbar from '@/components/Toolbar/Toolbar'
import SidebarLeft from '@/components/SidebarLeft/SidebarLeft'
import CanvasArea from '@/components/CanvasArea/CanvasArea'
import PanelRight from '@/components/PanelRight/PanelRight'
import ProgressPanel from '@/components/ProgressPanel/ProgressPanel'
import DemoLoader from '@/components/DemoLoader/DemoLoader'
import HeatmapDiffPage from '@/features/heatmap/diffPage/HeatmapDiffPage'
import HeatmapBenchPage from '@/features/heatmap/diffPage/HeatmapBenchPage'
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

  if (hash === '#/heatmap-diff') {
    return <HeatmapDiffPage />
  }
  if (hash === '#/heatmap-bench') {
    return <HeatmapBenchPage />
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
    </div>
  )
}

export default App
