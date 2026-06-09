import type { FingerHole } from '@/types'
import { DEFAULT_CUTOUT_DEPTH, DISPLAY_SCALE } from '@/lib/constants'
import { filletedRectangleRadius, isFilletedRectangleCutout, isRectangularCutout } from '@/lib/cutouts'

interface Props {
  holes: FingerHole[]
  zoom?: number
  interactive?: boolean
  selectedId?: string
  editMode?: string
  defaultCutoutDepth?: number
  onMouseDown?: (id: string, e: React.MouseEvent) => void
  onClick?: (e: React.MouseEvent) => void
}

export function CutoutOverlay({ holes, zoom = 1, interactive, selectedId, editMode, defaultCutoutDepth = DEFAULT_CUTOUT_DEPTH, onMouseDown, onClick }: Props) {
  return (
    <>
      {holes.map(fh => {
        const x = fh.x * DISPLAY_SCALE
        const y = fh.y * DISPLAY_SCALE
        const r = fh.radius * DISPLAY_SCALE
        const shape = fh.shape || 'circle'
        const rotation = fh.rotation || 0
        const isSelected = interactive && selectedId === fh.id
        const isRectangular = isRectangularCutout(shape)
        const isFilleted = isFilletedRectangleCutout(shape)
        const w = isRectangular && fh.width ? fh.width * DISPLAY_SCALE : r * 2
        const h = isRectangular && fh.height ? fh.height * DISPLAY_SCALE : r * 2

        const fill = isSelected ? 'rgb(30, 41, 59)' : 'rgb(51, 65, 85)'
        const stroke = isSelected ? 'rgb(90, 180, 222)' : 'rgb(30, 41, 59)'
        const strokeWidth = (isSelected ? 3 : 1) / zoom
        const cutoutDepth = (fh.depth_override ?? defaultCutoutDepth) * DISPLAY_SCALE
        const filletR = filletedRectangleRadius(w, cutoutDepth)
        const left = x - w / 2
        const right = x + w / 2
        const top = y - h / 2
        const bottom = y + h / 2
        const cursor = interactive && editMode === 'select' ? 'cursor-move' : interactive ? 'cursor-default' : 'pointer-events-none'

        return (
          <g key={fh.id} transform={rotation !== 0 ? `rotate(${rotation} ${x} ${y})` : undefined}>
            {(shape === 'circle' || shape === 'cylinder') && (
              <circle
                cx={x} cy={y} r={r}
                fill={fill} stroke={stroke} strokeWidth={strokeWidth}
                className={cursor}
                onMouseDown={interactive && onMouseDown ? (e) => onMouseDown(fh.id, e) : undefined}
                onClick={interactive && onClick ? onClick : undefined}
              />
            )}
            {shape === 'cylinder' && (
              <circle
                cx={x} cy={y} r={Math.max(0.5, r * 0.35)}
                fill="none" stroke={stroke} strokeWidth={strokeWidth}
                className="pointer-events-none"
              />
            )}
            {(shape === 'square' || (isRectangular && !isFilleted)) && (
              <rect
                x={left} y={top} width={w} height={h}
                fill={fill} stroke={stroke} strokeWidth={strokeWidth}
                className={cursor}
                onMouseDown={interactive && onMouseDown ? (e) => onMouseDown(fh.id, e) : undefined}
                onClick={interactive && onClick ? onClick : undefined}
              />
            )}
            {isFilleted && (
              <path
                d={`M ${left} ${top} H ${right} V ${bottom - filletR} Q ${right} ${bottom} ${right - filletR} ${bottom} H ${left + filletR} Q ${left} ${bottom} ${left} ${bottom - filletR} V ${top} Z`}
                fill={fill} stroke={stroke} strokeWidth={strokeWidth}
                className={cursor}
                onMouseDown={interactive && onMouseDown ? (e) => onMouseDown(fh.id, e) : undefined}
                onClick={interactive && onClick ? onClick : undefined}
              />
            )}
          </g>
        )
      })}
    </>
  )
}
