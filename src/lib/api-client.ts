/*
 * Demo build — there is no backend. ApiClient dispatches every call to the
 * in-browser demo API (lib/demo-api.ts), which serves fictional data and
 * persists mutations to localStorage. The class surface is unchanged.
 */
import { demoApi, demoBlob, ApiError } from "./demo-api";

export const API_BASE_URL = "";

// Authenticated file downloads/streaming — returns an object URL for a blob
// fetched with the session token (used for signature documents etc.).
export const fetchFileUrl = async (endpoint: string): Promise<string> => {
  const blob = await apiClient.getBlob(endpoint);
  return URL.createObjectURL(blob);
};

// Convert a FormData payload into a plain object for the demo dispatcher.
const formDataToObject = (fd: FormData): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  fd.forEach((v, k) => {
    if (v instanceof File) {
      const names = (out["attachmentNames"] as string[] | undefined) ?? [];
      names.push(v.name);
      out["attachmentNames"] = names;
      (out[k] as unknown) = v.name;
    } else if (k.endsWith("[]") || k.startsWith("pref")) {
      const arr = (out[k.replace(/\[\]$/, "")] as unknown[] | undefined) ?? [];
      arr.push(v);
      out[k.replace(/\[\]$/, "")] = arr;
    } else {
      out[k] = v;
    }
  });
  return out;
};

class ApiClient {
  private token: string | null = null;

  private loadToken() {
    if (typeof window !== "undefined" && window.localStorage) {
      this.token = localStorage.getItem("auth_token");
    }
  }

  setToken(token: string) {
    this.token = token;
    if (typeof window !== "undefined" && window.localStorage) {
      localStorage.setItem("auth_token", token);
    }
  }

  clearToken() {
    this.token = null;
    if (typeof window !== "undefined" && window.localStorage) {
      localStorage.removeItem("auth_token");
    }
  }

  // The stored JWT is dead (expired or rotated) — wipe the session and bounce
  // back to the login screen instead of letting every request 401 in the
  // background. /api/auth/* is excluded: 401s there are bad credentials in
  // login/reset flows (no session yet), and must not force a reload.
  private handleUnauthorized(endpoint: string) {
    if (typeof window === "undefined" || endpoint.startsWith("/api/auth/")) return;
    if (!window.localStorage.getItem("workhr.session")) return;
    this.clearToken();
    window.localStorage.removeItem("workhr.session");
    if (window.location.pathname !== "/") window.location.assign("/");
  }

  private bearer() {
    return this.token ? `Bearer ${this.token}` : null;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (typeof window !== "undefined") this.loadToken();
    try {
      const body =
        options.body instanceof FormData
          ? formDataToObject(options.body)
          : typeof options.body === "string"
            ? JSON.parse(options.body)
            : options.body;
      return (await demoApi(String(options.method ?? "GET"), endpoint, body, this.bearer())) as T;
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) this.handleUnauthorized(endpoint);
        throw new Error(err.message);
      }
      throw err instanceof Error ? err : new Error("Request failed");
    }
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: "GET" });
  }

  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: "POST", body: JSON.stringify(data) });
  }

  async put<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: "PUT", body: JSON.stringify(data) });
  }

  async patch<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: "PATCH", body: JSON.stringify(data) });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: "DELETE" });
  }

  // File upload — callers pass endpoints without the /api prefix ("/applications").
  async uploadFile<T>(endpoint: string, formData: FormData): Promise<T> {
    if (typeof window !== "undefined") this.loadToken();
    try {
      return (await demoApi(
        "POST",
        `/api${endpoint}`,
        formDataToObject(formData),
        this.bearer(),
      )) as T;
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) this.handleUnauthorized(endpoint);
        throw new Error(err.message);
      }
      throw err instanceof Error ? err : new Error("Upload failed");
    }
  }

  // Fetch a binary document with auth (used for secure admin document viewing)
  async getBlob(endpoint: string): Promise<Blob> {
    if (typeof window !== "undefined") this.loadToken();
    return demoBlob(endpoint, this.bearer());
  }
}

// Direct export to avoid Proxy issues
export const apiClient = new ApiClient();
