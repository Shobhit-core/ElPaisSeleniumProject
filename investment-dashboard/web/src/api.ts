// Thin fetch wrapper. All requests are same-origin; the session cookie is HttpOnly and never
// visible to JavaScript. The custom header is the CSRF guard the server requires.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: unknown,
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T = any>(method: string, url: string, body?: unknown, contentType = "application/json"): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: "same-origin",
      headers: { "x-requested-with": "dashboard", ...(body !== undefined ? { "content-type": contentType } : {}) },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Cannot reach the dashboard server. Is it running?", null);
  }
  const text = await res.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON (CSV) */
  }
  if (res.status === 401 && url !== "/auth/login") onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`, data);
  return data as T;
}

export const get = <T = any>(u: string) => api<T>("GET", u);
export const post = <T = any>(u: string, b?: unknown) => api<T>("POST", u, b ?? {});
export const put = <T = any>(u: string, b: unknown) => api<T>("PUT", u, b);
export const del = <T = any>(u: string) => api<T>("DELETE", u);
