// CAD (DXF/DWG) floor import, backed by the same "Floorplan cv+graph
// pipeline" service as AIWallsModal.
//
// The browser doesn't parse CAD at all: the file is uploaded to POST /jobs and
// the floor background is GET /jobs/{id}/input — the server's own rendering
// of the drawing, with no annotations. It is available as soon as the job is
// created, so there's no polling here. Walls are left to AIWallsModal, which
// re-sends the CAD file; its coordinates share this image's pixel space.
//
// Jobs expire server-side, so the background is downloaded now and kept as a
// blob rather than referenced by URL.

const API_BASE_URL = 'https://floorplan.senao.net'
const API_TOKEN = '5yF5qWsxew5RbOfMO5-V1BUwaCgIc8_Bjb9O7Cw4tCE'
const ALGORITHM = 'cnn'

const CAD_EXTENSIONS = ['.dxf', '.dwg']

// Browsers leave `file.type` empty for DXF/DWG, so go by extension. The
// backend sniffs the real format from content but still wants the real name.
export const isCadFile = (file) => {
  const name = String(file?.name || '').toLowerCase()
  return CAD_EXTENSIONS.some((ext) => name.endsWith(ext))
}

const authHeaders = () => ({ Authorization: `Bearer ${API_TOKEN}` })

async function readError(res) {
  try {
    const j = await res.json()
    if (typeof j?.detail === 'string') return j.detail
    if (Array.isArray(j?.detail)) {
      return j.detail.map((d) => `${(d.loc ?? []).join('.')}: ${d.msg}`).join('; ')
    }
    if (j?.detail) return JSON.stringify(j.detail)
    return JSON.stringify(j)
  } catch {
    return `HTTP ${res.status} ${res.statusText}`
  }
}

function decodeImageSize(blob) {
  const url = URL.createObjectURL(blob)
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('底圖解碼失敗'))
    img.src = url
  }).finally(() => URL.revokeObjectURL(url))
}

// Returns { blob, width, height }. Throws with a user-facing message on any
// failure.
export async function fetchCadBackground(file, onProgress = () => {}) {
  onProgress('上傳 CAD 檔…')
  const fd = new FormData()
  fd.append('file', file, file.name)
  fd.append('algorithm', ALGORITHM)
  // Only the input rendering is needed here, so skip the overlay image.
  fd.append('output', 'algo')

  const created = await fetch(`${API_BASE_URL}/jobs`, {
    method: 'POST',
    headers: authHeaders(),
    body: fd,
  })
  if (!created.ok) throw new Error(`上傳失敗：${await readError(created)}`)
  const job = await created.json()
  if (!job.job_id) throw new Error('伺服器回應沒有 job_id。')

  onProgress('取得底圖…')
  const res = await fetch(`${API_BASE_URL}/jobs/${job.job_id}/input`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`後端沒有回傳底圖：${await readError(res)}`)
  const blob = await res.blob()
  const { width, height } = await decodeImageSize(blob)
  return { blob, width, height }
}
