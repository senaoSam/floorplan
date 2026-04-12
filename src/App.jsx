import React from 'react'
import Toolbar from '@/components/Toolbar/Toolbar'
import SidebarLeft from '@/components/SidebarLeft/SidebarLeft'
import CanvasArea from '@/components/CanvasArea/CanvasArea'
import PanelRight from '@/components/PanelRight/PanelRight'
import ProgressPanel from '@/components/ProgressPanel/ProgressPanel'
import DemoLoader from '@/components/DemoLoader/DemoLoader'
import FormulaNote from '@/components/FormulaNote/FormulaNote'
import './styles/App.sass'

function App() {
  return (
    <div className="app">
      <Toolbar />
      <div className="app__body">
        <SidebarLeft />
        <CanvasArea />
        <PanelRight />
      </div>
      <FormulaNote />
      <DemoLoader />
      <ProgressPanel />
    </div>
  )
}

export default App
