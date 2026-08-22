import { apiPost } from './apiClient';

interface SignResponse {
  uploadSessionId: string;
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  signature: string;
  resourceType: 'image' | 'video' | 'raw';
}

export interface UploadedMedia {
  id: string;
  secureUrl: string;
  resourceType: string;
  bytes: number;
}

// Uploads a file straight from the browser to Cloudinary using a short-lived signature —
// file bytes never pass through our own server (spec §13.6).
export async function uploadFileDirect(
  file: File,
  params: { purpose: string; targetType: string; targetId?: string; resourceType?: 'image' | 'video' | 'raw' }
): Promise<UploadedMedia> {
  const resourceType = params.resourceType ?? 'image';
  const signed = await apiPost<SignResponse>('/api/uploads/sign', {
    purpose: params.purpose,
    targetType: params.targetType,
    targetId: params.targetId,
    resourceType,
  });

  const form = new FormData();
  form.append('file', file);
  form.append('api_key', signed.apiKey);
  form.append('timestamp', String(signed.timestamp));
  form.append('folder', signed.folder);
  form.append('signature', signed.signature);

  const uploadResponse = await fetch(`https://api.cloudinary.com/v1_1/${signed.cloudName}/${resourceType}/upload`, {
    method: 'POST',
    body: form,
  });
  const uploadJson = (await uploadResponse.json()) as { public_id?: string; error?: { message: string } };
  if (!uploadResponse.ok || !uploadJson.public_id) {
    throw new Error(uploadJson.error?.message ?? '파일 업로드에 실패했습니다.');
  }

  return apiPost<UploadedMedia>(`/api/uploads/${signed.uploadSessionId}/finalize`, { publicId: uploadJson.public_id });
}
