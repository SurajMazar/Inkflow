import { CSRF_HEADER, SHARE_TOKEN_HEADER } from '@inkflow/shared';
import {
  buildUrl,
  ensureCsrfToken,
  networkError,
  recoverFrom401,
  shouldRefreshOn401,
  toApiError,
  type CallOptions,
} from './client';

export interface UploadProgress {
  loaded: number;
  total: number;
  /** 0…1, or null when the total size is unknown. */
  fraction: number | null;
}

export interface UploadOptions extends CallOptions {
  onProgress?: (progress: UploadProgress) => void;
}

function parseBody(xhr: XMLHttpRequest): unknown {
  const text = xhr.responseText;
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function sendOnce(path: string, formData: FormData, csrf: string | null, options: UploadOptions) {
  return new Promise<{ status: number; body: unknown; retryAfter: string | null }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', buildUrl(path));
    xhr.withCredentials = true;
    xhr.setRequestHeader('accept', 'application/json');
    if (csrf) xhr.setRequestHeader(CSRF_HEADER, csrf);
    if (options.shareToken) xhr.setRequestHeader(SHARE_TOKEN_HEADER, options.shareToken);

    const onAbort = () => xhr.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => options.signal?.removeEventListener('abort', onAbort);

    xhr.upload.onprogress = (event) => {
      options.onProgress?.({
        loaded: event.loaded,
        total: event.total,
        fraction: event.lengthComputable && event.total > 0 ? event.loaded / event.total : null,
      });
    };
    xhr.onload = () => {
      cleanup();
      resolve({ status: xhr.status, body: parseBody(xhr), retryAfter: xhr.getResponseHeader('retry-after') });
    };
    xhr.onerror = () => {
      cleanup();
      reject(networkError());
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException('Upload aborted', 'AbortError'));
    };
    if (options.signal?.aborted) {
      xhr.abort();
      return;
    }
    xhr.send(formData);
  });
}

/**
 * Multipart POST with upload progress (XMLHttpRequest), sharing the CSRF and
 * refresh-and-retry behaviour of `request()`.
 */
export async function uploadWithProgress<T>(path: string, formData: FormData, options: UploadOptions = {}): Promise<T> {
  let refreshed = false;
  let csrfRetried = false;
  for (;;) {
    const csrf = await ensureCsrfToken(csrfRetried);
    const { status, body, retryAfter } = await sendOnce(path, formData, csrf, options);
    if (status >= 200 && status < 300) return body as T;
    const error = toApiError(status, body, retryAfter);
    if (status === 401 && !refreshed && shouldRefreshOn401(path, error.code)) {
      refreshed = true;
      if (await recoverFrom401()) continue;
      throw error;
    }
    if (status === 403 && error.code === 'CSRF_INVALID' && !csrfRetried) {
      csrfRetried = true;
      continue;
    }
    throw error;
  }
}
