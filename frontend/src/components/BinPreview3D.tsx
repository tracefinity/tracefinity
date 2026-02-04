'use client'

import { Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

interface Props {
  stlUrl: string
}

function useIsDarkMode() {
  const [isDark, setIsDark] = useState(false)
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'))
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return isDark
}

function StlModel({ url }: { url: string }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    const loader = new STLLoader()
    loader.load(
      url,
      (geo) => {
        geo.computeVertexNormals()

        // center horizontally, place on ground
        geo.computeBoundingBox()
        const box = geo.boundingBox!
        const centerX = (box.max.x + box.min.x) / 2
        const centerY = (box.max.y + box.min.y) / 2
        const minZ = box.min.z

        // translate so center is at origin XY and bottom is at Z=0
        geo.translate(-centerX, -centerY, -minZ)

        setGeometry(geo)
      },
      () => {},
      (err) => {
        console.error('STL load error:', err)
        setLoadError(String(err))
      }
    )
  }, [url])

  if (loadError) {
    return null
  }

  if (!geometry) return null

  // no rotation - STL is already in correct orientation (Z up)
  // three.js uses Y up, so rotate to match
  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} scale={[1, -1, 1]}>
      <meshStandardMaterial color="#4a90d9" metalness={0.2} roughness={0.5} />
    </mesh>
  )
}

function GridFloor({ isDark }: { isDark: boolean }) {
  return (
    <gridHelper
      args={[300, 30, isDark ? '#4b5563' : '#888888', isDark ? '#374151' : '#cccccc']}
      rotation={[0, 0, 0]}
      position={[0, 0, 0]}
    />
  )
}

function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[20, 20, 20]} />
      <meshStandardMaterial color="#cccccc" wireframe />
    </mesh>
  )
}

export function BinPreview3D({ stlUrl }: Props) {
  const isDark = useIsDarkMode()

  return (
    <div className="w-full h-full min-h-[400px]">
      <Canvas
        camera={{ position: [0, 250, 250], fov: 50 }}
        style={{ background: isDark ? '#1f2937' : '#f5f5f5' }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 20, 10]} intensity={1} />
        <directionalLight position={[-10, -10, -10]} intensity={0.3} />

        <Suspense fallback={<LoadingFallback />}>
          <StlModel url={stlUrl} />
        </Suspense>

        <GridFloor isDark={isDark} />
        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          minDistance={50}
          maxDistance={500}
        />
      </Canvas>
    </div>
  )
}
