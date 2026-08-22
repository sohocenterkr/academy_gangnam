import { v2 as cloudinary } from 'cloudinary';

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  uploadRoot: string;
}

export interface CloudinaryClient {
  sign(params: Record<string, string | number>): string;
  getResource(publicId: string, resourceType: 'image' | 'video' | 'raw'): Promise<CloudinaryResource | null>;
  destroy(publicId: string, resourceType: 'image' | 'video' | 'raw'): Promise<void>;
}

export interface CloudinaryResource {
  publicId: string;
  assetId: string | null;
  secureUrl: string;
  resourceType: 'image' | 'video' | 'raw';
  format: string | null;
  bytes: number;
  width: number | null;
  height: number | null;
  duration: number | null;
}

export function createCloudinaryClient(config: CloudinaryConfig): CloudinaryClient {
  const instance = cloudinary;
  instance.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
    secure: true,
  });

  return {
    sign(params) {
      return instance.utils.api_sign_request(params, config.apiSecret);
    },
    async getResource(publicId, resourceType) {
      try {
        const resource = await instance.api.resource(publicId, { resource_type: resourceType });
        return {
          publicId: resource.public_id,
          assetId: resource.asset_id ?? null,
          secureUrl: resource.secure_url,
          resourceType,
          format: resource.format ?? null,
          bytes: resource.bytes,
          width: resource.width ?? null,
          height: resource.height ?? null,
          duration: resource.duration ?? null,
        };
      } catch (error) {
        if (isNotFoundError(error)) return null;
        throw error;
      }
    },
    async destroy(publicId, resourceType) {
      await instance.uploader.destroy(publicId, { resource_type: resourceType });
    },
  };
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'http_code' in error && (error as { http_code: number }).http_code === 404;
}
