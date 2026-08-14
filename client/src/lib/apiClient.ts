import type { ApiResponse } from '../../../shared/types';

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

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
  });
  const body = (await response.json()) as ApiResponse<T>;

  if (!response.ok || 'error' in body) {
    const errorBody = body as Extract<ApiResponse<T>, { error: unknown }>;
    throw new ApiRequestError(
      errorBody.error.message,
      errorBody.error.code,
      errorBody.error.requestId
    );
  }

  return body.data;
}
