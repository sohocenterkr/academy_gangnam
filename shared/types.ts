export interface ApiSuccess<T> {
  data: T;
  meta: {
    requestId: string;
    kstTimestamp: string;
  };
}

export interface ApiErrorBody {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  requestId: string;
}

export interface ApiError {
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
