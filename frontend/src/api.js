export const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
export class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
export async function api(path, { token, method = 'GET', body, headers = {} } = {}) {
  const start = performance.now();
  const options = { method, headers: { ...headers }, signal: AbortSignal.timeout(30000) };
  if (token) options.headers.Authorization = `Bearer ${token}`;
  if (body instanceof FormData) options.body = body;
  else if (body !== undefined) { options.body = JSON.stringify(body); options.headers['Content-Type'] = 'application/json'; }
  let status = 0;
  try {
    const response = await fetch(API_BASE + path, options);
    status = response.status;
    const data = await response.json();
    if (!response.ok) {
      const detail = typeof data.detail === 'string' ? data.detail : data.detail?.map(x => x.msg).join(', ');
      throw new ApiError(detail || `요청 실패 (${status})`, status);
    }
    return data;
  } finally {
    window.dispatchEvent(new CustomEvent('api-request', { detail: { id: crypto.randomUUID(), time: new Date().toLocaleTimeString('ko-KR'),
      method, path: path.split('?')[0], status, ms: Math.round(performance.now() - start) } }));
  }
}
