import { useEffect, useRef, useState } from 'react'

type Point = [number, number, number]
type Face = { points: Point[]; color: [number, number, number] }
const silver: Face['color'] = [203, 225, 235]
const teal: Face['color'] = [34, 155, 166]

// A small, real 3D mesh rendered with Canvas 2D. No WebGL/runtime dependency;
// depth sorting and directional lighting keep the scene inexpensive on phones.
function aircraftMesh(): Face[] {
  const faces: Face[] = []
  const face = (points: Point[], color = silver) => faces.push({ points, color })
  const body = (x: number, z: number, rings: [number, number][], radius: number) => {
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < 12; j++) {
        const p = (ring: number, angle: number): Point => [
          x + Math.cos(angle * Math.PI / 6) * rings[ring][1] * radius,
          rings[ring][0], z + Math.sin(angle * Math.PI / 6) * rings[ring][1] * radius,
        ]
        face([p(i, j), p(i + 1, j), p(i + 1, j + 1), p(i, j + 1)])
      }
    }
  }
  body(0, 0, [[-7, 0.06], [-6, 0.5], [-4, 0.95], [2.8, 1], [4.8, 0.86], [5.8, 0.56], [6.5, 0.04]], 0.63)
  for (const side of [-1, 1]) {
    const wing: Point[] = [[side * 0.4, 1.6, 0], [side * 6.8, -2.2, 0.3], [side * 6.8, -3.15, 0.3], [side * 1.1, -1.8, -0.1]]
    face(wing)
    face(wing.map(([x, y, z]) => [x, y, z - 0.15]), [104, 148, 170])
    face([[side * 6.8, -2.2, 0.3], [side * 7, -2.55, 1.1], [side * 7, -3.1, 1.1], [side * 6.8, -3.15, 0.3]], teal)
    face([[side * 0.15, -4.4, 0.2], [side * 2.8, -6.1, 0.4], [side * 2.8, -6.8, 0.4], [side * 0.15, -5.7, 0.2]], [164, 201, 215])
    body(side * 2.6, -0.65, [[-2.1, 0.5], [-1.7, 0.9], [-0.3, 1], [0.05, 0.9]], 0.42)
    const engineFront: Point[] = Array.from({ length: 12 }, (_, i) => [side * 2.6 + Math.cos(i * Math.PI / 6) * 0.29, 0.06, -0.65 + Math.sin(i * Math.PI / 6) * 0.29])
    face(engineFront, [16, 40, 54])
    // Narrow cabin windows, visible on the near side of the fuselage.
    for (let y = -3.7; y < 3.8; y += 0.55) {
      face([[side * 0.58, y, 0.28], [side * 0.58, y + 0.2, 0.28], [side * 0.51, y + 0.2, 0.4], [side * 0.51, y, 0.4]], [28, 64, 82])
    }
    face([[side * 0.17, 4.7, 0.49], [side * 0.45, 4.7, 0.34], [side * 0.38, 5.35, 0.3], [side * 0.13, 5.45, 0.4]], [21, 59, 78])
  }
  face([[-0.09, -4.1, 0.4], [-0.09, -5.85, 2.7], [-0.09, -6.7, 2.7], [-0.09, -6.2, 0.2]], teal)
  face([[0.09, -4.1, 0.4], [0.09, -5.85, 2.7], [0.09, -6.7, 2.7], [0.09, -6.2, 0.2]], [43, 193, 191])
  return faces
}

const mesh = aircraftMesh()

function drawAircraft(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, yaw: number, bank: number, alpha = 1) {
  const transform = ([px, py, pz]: Point): Point => {
    const bx = px * Math.cos(bank) - pz * Math.sin(bank)
    const bz = px * Math.sin(bank) + pz * Math.cos(bank)
    const rx = bx * Math.cos(yaw) - py * Math.sin(yaw)
    const ry = bx * Math.sin(yaw) + py * Math.cos(yaw)
    return [rx, -ry * 0.68 - bz * 0.73, ry * 0.73 - bz * 0.68]
  }
  ctx.save()
  ctx.globalAlpha = alpha
  const polygons = mesh.map((face) => {
    const points = face.points.map(transform)
    const u = points[1].map((v, i) => v - points[0][i])
    const v = points[2].map((n, i) => n - points[0][i])
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const light = 0.52 + 0.48 * Math.abs((normal[0] * -0.3 + normal[1] * -0.7 + normal[2] * -0.6) / (Math.hypot(...normal) || 1))
    return { points, color: face.color.map((value) => Math.round(value * light)), depth: points.reduce((sum, p) => sum + p[2], 0) / points.length }
  }).sort((a, b) => b.depth - a.depth)
  for (const face of polygons) {
    ctx.beginPath()
    face.points.forEach(([px, py], index) => index ? ctx.lineTo(x + px * scale, y + py * scale) : ctx.moveTo(x + px * scale, y + py * scale))
    ctx.closePath()
    ctx.fillStyle = `rgb(${face.color.join(',')})`
    ctx.fill()
    ctx.strokeStyle = ctx.fillStyle
    ctx.lineWidth = 0.4
    ctx.stroke()
  }
  ctx.restore()
}

function paint(ctx: CanvasRenderingContext2D, width: number, height: number, time: number) {
  ctx.clearRect(0, 0, width, height)
  const unit = width / 700
  const horizon = height * 0.58
  // Perspective ground grid and an atmospheric horizon.
  const glow = ctx.createRadialGradient(width * 0.55, horizon, 0, width * 0.55, horizon, width * 0.62)
  glow.addColorStop(0, 'rgba(35,165,180,0.15)')
  glow.addColorStop(1, 'rgba(9,27,44,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = 'rgba(104,182,202,0.1)'
  ctx.lineWidth = 0.7
  for (let i = -8; i <= 10; i++) {
    ctx.beginPath(); ctx.moveTo(width * 0.5 + i * 24 * unit, horizon - 65); ctx.lineTo(width * 0.5 + i * 95 * unit, height + 70); ctx.stroke()
  }
  for (let i = 0; i < 12; i++) {
    const py = horizon - 60 + i * i * 3
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(width, py); ctx.stroke()
  }
  // Radar-like range rings; entirely illustrative, never flight telemetry.
  for (const radius of [70, 120, 175, 245]) {
    ctx.beginPath(); ctx.ellipse(width * 0.56, height * 0.76, radius * unit, radius * 0.28, -0.17, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(104,182,202,0.15)'; ctx.stroke()
  }
  const routes = [
    { start: [0.17, 0.83], end: [0.82, 0.45], lift: 0.6, color: '91,225,213' },
    { start: [0.36, 0.96], end: [0.86, 0.69], lift: 0.48, color: '109,160,230' },
    { start: [0.07, 0.63], end: [0.66, 0.91], lift: 0.2, color: '91,225,213' },
  ]
  routes.forEach((route, i) => {
    const [sx, sy] = [route.start[0] * width, route.start[1] * height]
    const [ex, ey] = [route.end[0] * width, route.end[1] * height]
    const [cx, cy] = [(sx + ex) / 2, Math.min(sy, ey) - height * route.lift]
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(cx, cy, ex, ey)
    ctx.strokeStyle = `rgba(${route.color},0.43)`; ctx.lineWidth = 1; ctx.setLineDash([3, 5]); ctx.stroke(); ctx.setLineDash([])
    for (let j = 0; j < 8; j++) {
      const t = ((time * 0.024 + i * 0.27) % 1 + j * 0.007) % 1
      const x = (1 - t) ** 2 * sx + 2 * (1 - t) * t * cx + t ** 2 * ex
      const y = (1 - t) ** 2 * sy + 2 * (1 - t) * t * cy + t ** 2 * ey
      ctx.fillStyle = `rgba(${route.color},${0.1 + j * 0.1})`
      ctx.beginPath(); ctx.arc(x, y, j === 7 ? 2.5 : 1.3, 0, Math.PI * 2); ctx.fill()
    }
    for (const [x, y] of [[sx, sy], [ex, ey]]) {
      ctx.strokeStyle = `rgba(${route.color},0.4)`; ctx.beginPath(); ctx.ellipse(x, y, 7, 3, 0, 0, Math.PI * 2); ctx.stroke()
      ctx.fillStyle = `rgba(${route.color},0.9)`; ctx.fillRect(x - 1.5, y - 1.5, 3, 3)
    }
  })
  ctx.font = '10px ui-monospace, monospace'
  ctx.fillStyle = '#98b8ca'
  for (const [label, x, y] of [['DEL', 0.84, 0.44], ['BOM', 0.13, 0.91], ['BLR', 0.87, 0.75]] as const) ctx.fillText(label, x * width, y * height)

  // Contrails connect the mesh to the scene; the main aircraft banks gently.
  const drift = Math.sin(time * 0.3)
  const x = width * 0.56 + drift * 9
  const y = height * 0.44 + Math.cos(time * 0.4) * 5
  const size = Math.min(width / 24, height / 15.5)
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(-0.58)
  for (const offset of [-size * 2.5, size * 2.5]) {
    const trail = ctx.createLinearGradient(0, 40, 0, 250)
    trail.addColorStop(0, 'rgba(183,228,235,0.2)'); trail.addColorStop(1, 'rgba(183,228,235,0)')
    ctx.strokeStyle = trail; ctx.lineWidth = 1.3
    ctx.beginPath(); ctx.moveTo(offset, 30); ctx.lineTo(offset + 5, 250); ctx.stroke()
  }
  ctx.restore()
  drawAircraft(ctx, x, y, size, -0.62 + drift * 0.025, -0.18 + Math.sin(time * 0.35) * 0.055)
  drawAircraft(ctx, width * 0.22 + Math.sin(time * 0.15) * 28, height * 0.22, size * 0.23, 1.5, 0.1, 0.6)
}

export default function AviationScene() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    const element = canvas.current
    const ctx = element?.getContext('2d')
    if (!element || !ctx) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let visible = true
    let time = 0
    let last = 0
    let width = 0
    let height = 0
    const render = () => paint(ctx, width, height, time)
    const animate = (now: number) => {
      if (now - last >= 32) {
        time += last ? Math.min((now - last) / 1000, 0.1) : 0
        last = now
        render()
      }
      frame = requestAnimationFrame(animate)
    }
    const sync = () => {
      cancelAnimationFrame(frame)
      last = 0
      render()
      if (!paused && !media.matches && visible && !document.hidden) frame = requestAnimationFrame(animate)
    }
    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width
      height = entry.contentRect.height
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
      element.width = Math.round(width * ratio)
      element.height = Math.round(height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      sync()
    })
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync() })
    resize.observe(element)
    observer.observe(element)
    media.addEventListener('change', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      observer.disconnect()
      media.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [paused])

  return (
    <div className="aviation-scene" data-testid="aviation-scene">
      <canvas ref={canvas} aria-hidden="true" />
      <span className="scene-coordinate" aria-hidden="true">IND / DOMESTIC NETWORK</span>
      <div className="scene-caption"><span>Illustrative flight paths · not aircraft tracking</span>
        <button type="button" onClick={() => setPaused(!paused)} aria-pressed={paused} aria-label={paused ? 'Resume scene animation' : 'Pause scene animation'}>
          {paused ? '▶ Motion' : 'Ⅱ Motion'}
        </button>
      </div>
    </div>
  )
}
