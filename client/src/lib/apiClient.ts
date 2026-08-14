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
