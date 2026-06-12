const KEY = 'wos_token'

export const getToken = () => localStorage.getItem(KEY)
export const setToken = t => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY))

async function request(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/public/')) {
    setToken(null)
    if (!location.pathname.startsWith('/login')) location.assign('/login')
    throw new Error('Signed out')
  }

  let data = null
  try { data = await res.json() } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  get: path => request(path),
  post: (path, body = {}) => request(path, { method: 'POST', body }),
  patch: (path, body = {}) => request(path, { method: 'PATCH', body }),
  put: (path, body = {}) => request(path, { method: 'PUT', body }),
  del: path => request(path, { method: 'DELETE' }),
  // multipart upload — files: FileList/array; field defaults to 'files'
  upload: async (path, files, extra = {}, field = 'files') => {
    const fd = new FormData()
    for (const f of files) fd.append(field, f)
    for (const [k, v] of Object.entries(extra)) fd.append(k, v)
    const headers = {}
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(`/api${path}`, { method: 'POST', headers, body: fd })
    let data = null
    try { data = await res.json() } catch { /* empty */ }
    if (!res.ok) throw new Error(data?.error || `Upload failed (${res.status})`)
    return data
  },
}
