// Shared mock-CCTV frame painter. We have no real camera streams, so every
// place that shows "camera imagery" paints a believable MOCK frame on a 2D
// canvas. This used to be copy-pasted in three components (LiveViewModal,
// CameraListPanel's HoverThumb, CalibrationModal); it now lives here so the
// visuals stay identical and a future real-stream swap touches ONE file.
//
// drawCctvFrame(ctx, opts) renders a single frame. For animated callers
// (LiveViewModal) call it once per rAF tick with an incrementing `frame`; for
// static callers (thumb, calib) call it once.
//
// opts:
//   w, h        — canvas size in px (each variant has its own fixed size)
//   frame       — animation tick (drives drift/grain/scanline/jitter/blink/snow)
//   camera      — the camera object (uses camera.name)
//   variant     — 'live' | 'thumb' | 'calib' (picks the exact look per caller)
//   online      — false ⇒ no-signal screen (live + thumb only)
//   detecting   — true ⇒ amber detection box (live + thumb)
//   clockText   — preformatted timecode string (live HUD); caller owns format
//   renderMode  — 'mock' (default) | 'stream' (future real-video seam)

export function drawCctvFrame(ctx, opts) {
  const {
    w,
    h,
    frame = 0,
    camera,
    variant = 'live',
    online = true,
    detecting = false,
    clockText = '',
    renderMode = 'mock',
  } = opts

  // ── Render-mode seam ──────────────────────────────────────────────
  // 'stream' is the future real-video path. When a product integration
  // wires a <video> element through here, this branch becomes:
  //     ctx.drawImage(videoEl, 0, 0, w, h)
  //     return
  // For now it has no source, so it falls through to the mock painter
  // below — the mock is the placeholder for the not-yet-real stream.
  if (renderMode === 'stream') {
    // TODO(stream): ctx.drawImage(videoEl, 0, 0, w, h); return
    // Fall through to mock until a real stream source exists.
  }

  if (variant === 'calib') {
    drawCalibFrame(ctx, w, h, camera)
    return
  }

  if (!online) {
    drawOffline(ctx, w, h, frame, variant)
    return
  }

  if (variant === 'thumb') {
    drawThumbFrame(ctx, w, h, camera, detecting)
    return
  }

  // variant === 'live'
  drawLiveFrame(ctx, w, h, frame, camera, detecting, clockText)
}

// ── live (LiveViewModal, animated 480×270) ───────────────────────────
function drawLiveFrame(ctx, W, H, frame, camera, detecting, clockText) {
  // Online: dim room gradient + drifting scanline + faint grain.
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#1f2937')
  g.addColorStop(1, '#0b1220')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // floor perspective lines, slow drift
  ctx.strokeStyle = 'rgba(148,163,184,0.12)'
  ctx.lineWidth = 1
  const drift = (frame * 0.3) % 40
  for (let y = -40 + drift; y < H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y + 18); ctx.stroke()
  }
  // grain
  ctx.fillStyle = 'rgba(255,255,255,0.015)'
  for (let i = 0; i < 60; i++) {
    const gx = (Math.sin(i * 99 + frame) * 0.5 + 0.5) * W
    const gy = (Math.cos(i * 57 + frame * 1.3) * 0.5 + 0.5) * H
    ctx.fillRect(gx, gy, 2, 2)
  }
  // scanline
  const sy = (frame * 2) % H
  ctx.fillStyle = 'rgba(56,189,248,0.06)'
  ctx.fillRect(0, sy, W, 3)

  // detection box when the camera is currently seeing a target
  if (detecting) {
    const bx = W * 0.38 + Math.sin(frame * 0.05) * 30
    const by = H * 0.42 + Math.cos(frame * 0.04) * 18
    ctx.strokeStyle = '#f59e0b'
    ctx.lineWidth = 2
    ctx.strokeRect(bx, by, 70, 110)
    ctx.fillStyle = '#f59e0b'
    ctx.font = '600 11px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('PERSON', bx, by - 5)
  }

  // HUD overlays
  ctx.fillStyle = '#e2e8f0'
  ctx.font = '600 13px ui-monospace, monospace'
  ctx.textAlign = 'left'
  ctx.fillText(clockText, 12, 22)
  ctx.textAlign = 'right'
  ctx.fillText(camera.name, W - 12, 22)
  // REC blinking dot
  if (Math.floor(frame / 30) % 2 === 0) {
    ctx.fillStyle = '#ef4444'
    ctx.beginPath(); ctx.arc(W - 64, 17, 5, 0, Math.PI * 2); ctx.fill()
  }
  ctx.fillStyle = '#ef4444'
  ctx.font = '700 12px system-ui, sans-serif'
  ctx.fillText('REC', W - 18, 38)
}

// ── thumb (CameraListPanel HoverThumb, static 168×95) ────────────────
function drawThumbFrame(ctx, THUMB_W, THUMB_H, camera, detecting) {
  const g = ctx.createLinearGradient(0, 0, 0, THUMB_H)
  g.addColorStop(0, '#1f2937'); g.addColorStop(1, '#0b1220')
  ctx.fillStyle = g; ctx.fillRect(0, 0, THUMB_W, THUMB_H)
  ctx.strokeStyle = 'rgba(148,163,184,0.14)'
  ctx.lineWidth = 1
  for (let y = 16; y < THUMB_H; y += 18) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(THUMB_W, y + 8); ctx.stroke()
  }
  if (detecting) {
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2
    ctx.strokeRect(THUMB_W * 0.4, THUMB_H * 0.34, 26, 42)
  }
  ctx.fillStyle = '#e2e8f0'
  ctx.font = '600 10px ui-monospace, monospace'
  ctx.textAlign = 'left'
  ctx.fillText(camera.name, 8, 16)
  ctx.fillStyle = '#ef4444'
  ctx.beginPath(); ctx.arc(THUMB_W - 14, 13, 4, 0, Math.PI * 2); ctx.fill()
}

// ── calib (CalibrationModal, static 420×236) ─────────────────────────
function drawCalibFrame(ctx, FRAME_W, FRAME_H, camera) {
  const g = ctx.createLinearGradient(0, 0, 0, FRAME_H)
  g.addColorStop(0, '#1f2937')
  g.addColorStop(1, '#0b1220')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, FRAME_W, FRAME_H)
  // perspective floor lines so corners read as a ground plane
  ctx.strokeStyle = 'rgba(148,163,184,0.18)'
  ctx.lineWidth = 1
  for (let y = 40; y < FRAME_H; y += 34) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(FRAME_W, y + 16); ctx.stroke()
  }
  for (let x = 40; x < FRAME_W; x += 70) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 40, FRAME_H); ctx.stroke()
  }
  ctx.fillStyle = '#94a3b8'
  ctx.font = '600 11px ui-monospace, monospace'
  ctx.fillText(`${camera.name} · 模擬畫面`, 10, 18)
}

// ── offline no-signal (live + thumb) ─────────────────────────────────
// live: animated TV snow (frame term) + dark band + '無訊號 · 裝置離線'.
// thumb: frozen snow (no frame term) + '無訊號'.
function drawOffline(ctx, W, H, frame, variant) {
  const img = ctx.createImageData(W, H)
  if (variant === 'live') {
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.sin(i * 12.9898 + frame * 7.13) * 43758.5) % 1
      const n = Math.abs(v) * 255
      img.data[i] = img.data[i + 1] = img.data[i + 2] = n
      img.data[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, H / 2 - 22, W, 44)
    ctx.fillStyle = '#f97316'
    ctx.font = '600 18px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('無訊號 · 裝置離線', W / 2, H / 2 + 6)
    return
  }
  // thumb
  for (let i = 0; i < img.data.length; i += 4) {
    const n = Math.abs((Math.sin(i * 12.9898) * 43758.5) % 1) * 255
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  ctx.fillStyle = '#f97316'
  ctx.font = '600 11px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('無訊號', W / 2, H / 2 + 4)
}
