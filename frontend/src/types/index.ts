export interface Point {
  x: number
  y: number
}

export type CutoutShape = 'circle' | 'square' | 'rectangle'

export interface Cutout {
  id: string
  shape: CutoutShape
  x: number
  y: number
  radius: number // for circles, or half-width for squares
  width?: number // for rectangles
  height?: number // for rectangles
  rotation: number // degrees
}

// keep for backwards compat
export interface FingerHole {
  id: string
  x: number
  y: number
  radius: number
  rotation?: number
  shape?: CutoutShape
  width?: number
  height?: number
}

export interface Polygon {
  id: string
  points: Point[]
  label: string
  finger_holes: FingerHole[]
}

export interface Session {
  id: string
  name: string | null
  description: string | null
  tags: string[]
  created_at: string | null
  original_image_path: string | null
  corrected_image_path: string | null
  mask_image_path: string | null
  corners: Point[] | null
  paper_size: 'a4' | 'letter' | null
  scale_factor: number | null
  polygons: Polygon[] | null
  stl_path: string | null
}

export interface SessionSummary {
  id: string
  name: string | null
  description: string | null
  tags: string[]
  created_at: string | null
  thumbnail_url: string | null
  tool_count: number
  has_stl: boolean
}

export interface UploadResponse {
  session_id: string
  image_url: string
  detected_corners: Point[] | null
}

export interface CornersResponse {
  corrected_image_url: string
  scale_factor: number
}

export interface TraceResponse {
  polygons: Polygon[]
  mask_url: string | null
}

export interface GenerateResponse {
  stl_url: string
}

export interface BinConfig {
  grid_x: number
  grid_y: number
  height_units: number
  magnets: boolean
  stacking_lip: boolean
  wall_thickness: number
  cutout_depth: number
  cutout_clearance: number
}
