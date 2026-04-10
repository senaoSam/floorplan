import React from 'react'
import Toolbar from '@/components/Toolbar/Toolbar'
import SidebarLeft from '@/components/SidebarLeft/SidebarLeft'
import CanvasArea from '@/components/CanvasArea/CanvasArea'
import './styles/App.sass'

function App() {
  return (
    <div className="app">
      <Toolbar />
      <div className="app__body">
        <SidebarLeft />
        <CanvasArea />
      </div>
    </div>
  )
}

export default App
