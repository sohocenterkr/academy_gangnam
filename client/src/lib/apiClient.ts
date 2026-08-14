import type { ApiResponse } from '@shared/types';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly requestId: string
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

const INVALID_RESPONSE_MESSAGE = '서버 응답을 처리할 수 없습니다.';

function throwInvalidResponse(requestId: string = ''): never {
  throw new ApiRequestError(INVALID_RESPONSE_MESSAGE, 'INVALID_RESPONSE', requestId);
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
  });

  let body: ApiResponse<T>;
  try {
    body = (await response.json()) as ApiResponse<T>;
  } catch {
    throwInvalidResponse();
  }

  if (!response.ok || 'error' in body) {
    const errorBody = (body as Extract<ApiResponse<T>, { error: unknown }> | undefined)?.error;
    if (!errorBody) {
      throwInvalidResponse();
    }
    throw new ApiRequestError(errorBody.message, errorBody.code, errorBody.requestId ?? '');
  }

  if (!('data' in body)) {
    throwInvalidResponse();
  }

  return body.data;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });

  let parsed: ApiResponse<T>;
  try {
    parsed = (await response.json()) as ApiResponse<T>;
  } catch {
    throwInvalidResponse();
  }

  if (!response.ok || 'error' in parsed) {
    const errorBody = (parsed as Extract<ApiResponse<T>, { error: unknown }> | undefined)?.error;
    if (!errorBody) {
      throwInvalidResponse();
    }
    throw new ApiRequestError(errorBody.message, errorBody.code, errorBody.requestId ?? '');
  }

  if (!('data' in parsed)) {
    throwInvalidResponse();
  }

  return parsed.data;
}
