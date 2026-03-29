'use client'

import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'

function UploadIllustration() {
  return (
    <svg viewBox="0 0 280 180" fill="none" className="w-full h-full">
      <defs>
        {/* paper shadow */}
        <filter id="paperShadow" x="-10%" y="-10%" width="130%" height="130%">
          <feDropShadow dx="2" dy="3" stdDeviation="4" floodColor="#000" floodOpacity="0.35" />
        </filter>
        {/* tool shadow */}
        <filter id="toolShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="1" dy="2" stdDeviation="2" floodColor="#000" floodOpacity="0.4" />
        </filter>
        {/* scan glow */}
        <linearGradient id="scanGlow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5ab4de" stopOpacity="0" />
          <stop offset="40%" stopColor="#5ab4de" stopOpacity="0.12" />
          <stop offset="60%" stopColor="#5ab4de" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#5ab4de" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* transparent bg — inherits from the glass panel */}

      {/* paper sheet */}
      <g transform="rotate(-2, 115, 92)" filter="url(#paperShadow)">
        <rect x="30" y="22" width="170" height="130" rx="2" fill="#e2e8f0" />
        <rect x="30" y="22" width="170" height="130" rx="2" fill="#f1f5f9" opacity="0.4" />
        {/* ruled lines */}
        {[42, 58, 74, 90, 106, 122, 138].map(y => (
          <line key={y} x1="40" y1={y} x2="190" y2={y} stroke="#cbd5e1" strokeWidth="0.3" opacity="0.6" />
        ))}
        {/* margin line */}
        <line x1="52" y1="24" x2="52" y2="150" stroke="#e8b4b8" strokeWidth="0.3" opacity="0.4" />
      </g>

      {/* screwdriver - angled, overflows top */}
      <g filter="url(#toolShadow)">
        <animate attributeName="opacity" values="0;1" dur="0.4s" fill="freeze" />
        <animateTransform attributeName="transform" type="translate" values="0,8;0,0" dur="0.4s" fill="freeze" />
        <g transform="rotate(15, 80, 70)">
          {/* handle */}
          <rect x="74" y="80" width="12" height="50" rx="4" fill="#dc6843" />
          <rect x="76" y="82" width="8" height="46" rx="3" fill="#e07850" />
          {/* grip lines */}
          {[90, 96, 102, 108, 114].map(y => (
            <line key={y} x1="75" y1={y} x2="85" y2={y} stroke="#c45a38" strokeWidth="0.6" />
          ))}
          {/* ferrule */}
          <rect x="76" y="74" width="8" height="8" rx="1" fill="#94a3b8" />
          {/* shaft */}
          <rect x="78.5" y="12" width="3" height="64" rx="1" fill="#94a3b8" />
          <line x1="80" y1="14" x2="80" y2="74" stroke="#b0bec5" strokeWidth="0.5" />
        </g>
      </g>

      {/* spanner - overflows right */}
      <g filter="url(#toolShadow)">
        <animate attributeName="opacity" values="0;0;1" dur="0.8s" fill="freeze" />
        <animateTransform attributeName="transform" type="translate" values="0,8;0,8;0,0" dur="0.8s" fill="freeze" />
        <g transform="rotate(-25, 160, 90)">
          {/* open jaw */}
          <path d="M155 16 L153 28 L147 32 L147 38 L153 42 L155 54 L165 54 L167 42 L173 38 L173 32 L167 28 L165 16Z" fill="#64748b" />
          <path d="M155 16 L153 28 L147 32 L147 38 L153 42 L155 54 L160 54 L160 16Z" fill="#6b7d91" />
          {/* shaft */}
          <rect x="155" y="52" width="10" height="100" rx="1" fill="#64748b" />
          <rect x="155" y="52" width="5" height="100" rx="1" fill="#6b7d91" />
          {/* ring end */}
          <ellipse cx="160" cy="155" rx="12" ry="12" fill="#64748b" />
          <ellipse cx="160" cy="155" rx="12" ry="12" fill="#6b7d91" clipPath="inset(0 50% 0 0)" />
          <ellipse cx="160" cy="155" rx="6" ry="6" fill="#111827" />
        </g>
      </g>

      {/* hex key (allen key) - small, on paper */}
      <g filter="url(#toolShadow)">
        <animate attributeName="opacity" values="0;0;0;1" dur="1.2s" fill="freeze" />
        <animateTransform attributeName="transform" type="translate" values="0,6;0,6;0,6;0,0" dur="1.2s" fill="freeze" />
        <g transform="rotate(40, 120, 115)">
          <path d="M118 80 L118 125 L140 125" stroke="#475569" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M118 80 L118 125 L140 125" stroke="#526077" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </g>
      </g>

      {/* scan line sweeping over paper */}
      <g transform="rotate(-2, 115, 92)">
        <rect x="30" y="22" width="170" height="18" fill="url(#scanGlow)">
          <animateTransform attributeName="transform" type="translate" values="0,0;0,112;0,0" dur="3.5s" repeatCount="indefinite" />
        </rect>
      </g>

      {/* corner brackets */}
      {[
        { x: 28, y: 20, d: 'M28 32 L28 20 L40 20' },
        { x: 200, y: 16, d: 'M188 16 L200 16 L200 28' },
        { x: 203, y: 152, d: 'M203 140 L203 152 L191 152' },
        { x: 33, y: 156, d: 'M45 156 L33 156 L33 144' },
      ].map(({ x, y, d }, i) => (
        <g key={i}>
          {/* pulse ring */}
          <circle cx={x} cy={y} r="4" fill="none" stroke="#5ab4de" strokeWidth="1" opacity="0">
            <animate attributeName="r" values="4;12" dur="2s" begin={`${i * 0.5}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.4;0" dur="2s" begin={`${i * 0.5}s`} repeatCount="indefinite" />
          </circle>
          {/* bracket */}
          <path d={d} stroke="#5ab4de" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.8" />
          {/* dot */}
          <circle cx={x} cy={y} r="2" fill="#5ab4de" />
        </g>
      ))}

      {/* camera/phone icon - top right */}
      <g>
        <animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" dur="4s" repeatCount="indefinite" />

        {/* phone body */}
        <rect x="228" y="28" width="34" height="56" rx="5" fill="#1e293b" stroke="#334155" strokeWidth="1" />
        {/* screen */}
        <rect x="232" y="34" width="26" height="40" rx="2" fill="#0f172a" />
        {/* lens ring */}
        <circle cx="245" cy="54" r="9" fill="none" stroke="#334155" strokeWidth="1" />
        <circle cx="245" cy="54" r="6" fill="#5ab4de" opacity="0.08">
          <animate attributeName="opacity" values="0.08;0.25;0.08" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="245" cy="54" r="3.5" fill="#5ab4de" opacity="0.35" />
        <circle cx="245" cy="54" r="1.5" fill="#5ab4de" opacity="0.8" />
        {/* shutter button */}
        <circle cx="245" cy="78" r="2.5" fill="none" stroke="#334155" strokeWidth="0.8" />
      </g>

      {/* dashed line from phone to scene */}
      <path d="M245 90 L245 92 Q245 102 238 108 L180 138" stroke="#5ab4de" strokeWidth="1" strokeDasharray="3 3" opacity="0.3">
        <animate attributeName="strokeDashoffset" values="0;-12" dur="1.5s" repeatCount="indefinite" />
      </path>
      <circle cx="178" cy="139" r="2" fill="#5ab4de" opacity="0.3" />
    </svg>
  )
}

interface Props {
  onUpload: (file: File) => void
  disabled?: boolean
}

export function ImageUploader({ onUpload, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  function handleClick() {
    if (!disabled) inputRef.current?.click()
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file && !disabled) onUpload(file)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    if (!disabled) setIsDragging(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    if (disabled) return
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) onUpload(file)
  }

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        glass rounded-[10px] py-6 px-6 cursor-pointer
        transition-all duration-150
        ${isDragging ? 'border-accent bg-accent-muted scale-[1.005]' : 'hover:bg-glass-hover'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input ref={inputRef} type="file" accept="image/*" onChange={handleChange} className="hidden" />
      {isDragging ? (
        <div className="py-4 text-center">
          <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-accent-muted flex items-center justify-center">
            <Upload className="w-4 h-4 text-accent" />
          </div>
          <p className="text-sm text-accent font-medium">Drop the image here</p>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-10">
          <div className="w-72 h-44 flex-shrink-0">
            <UploadIllustration />
          </div>
          <div className="text-center sm:text-left flex-1">
            <p className="text-lg text-white font-bold mb-3 leading-snug">
              Photograph your tools on a sheet of paper
            </p>
            <ul className="text-sm text-text-secondary leading-relaxed space-y-1.5 mb-5">
              <li className="flex items-start gap-2 justify-center sm:justify-start">
                <span className="mt-[7px] block w-1.5 h-1.5 rounded-full bg-accent/50 flex-shrink-0" />
                Place tools on A4 or Letter paper
              </li>
              <li className="flex items-start gap-2 justify-center sm:justify-start">
                <span className="mt-[7px] block w-1.5 h-1.5 rounded-full bg-accent/50 flex-shrink-0" />
                Tools can overflow the paper edges
              </li>
              <li className="flex items-start gap-2 justify-center sm:justify-start">
                <span className="mt-[7px] block w-1.5 h-1.5 rounded-full bg-accent/50 flex-shrink-0" />
                All four paper corners must be visible
              </li>
              <li className="flex items-start gap-2 justify-center sm:justify-start">
                <span className="mt-[7px] block w-1.5 h-1.5 rounded-full bg-accent/50 flex-shrink-0" />
                Take a top-down photo
              </li>
            </ul>
            <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-accent text-white text-sm font-semibold shadow-lg shadow-accent/20">
              <Upload className="w-4 h-4" />
              Upload photo
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
