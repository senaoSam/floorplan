import React from 'react'
import TopBar from '@/components/TopBar/TopBar'
import SidebarLeft from '@/components/SidebarLeft/SidebarLeft'
import CameraListPanel from '@/components/CameraTimeline/CameraListPanel'
import CanvasArea from '@/components/CanvasArea/CanvasArea'
import PanelRight from '@/components/PanelRight/PanelRight'
import ContextMenuMount from '@/components/ContextMenu/ContextMenuMount'
import UiToast from '@/components/UiToast/UiToast'
import '@/styles/App.sass'

// Standalone-mode shell. The embeddable boundary is `<FloorplanSystem />`
// (rendered inside CanvasArea); host integration replaces this shell with
// the main product's own chrome.
function App() {
  return (
    <div className="app">
      <TopBar />
      <div className="app__body">
        <SidebarLeft />
        <CameraListPanel />
        <CanvasArea />
        <PanelRight />
      </div>
      <UiToast />
      <ContextMenuMount />
    </div>
  )
}

export default App
