import React from 'react'
import { Canvas } from '@react-three/fiber'
// TODO: 依需求加入 @react-three/drei 輔助工具

function Viewer3D() {
  return (
    <Canvas
      camera={{ position: [0, 5, 10], fov: 50 }}
      style={{ width: '100%', height: '100%' }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      {/* TODO: 樓層幾何、AP 標記、信號視覺化 */}
    </Canvas>
  )
}

export default Viewer3D
