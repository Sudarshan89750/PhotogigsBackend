export interface UploadResult {
  url: string;
  key: string;
  provider: 'wasabi' | 'cloudinary';
  bucket?: string;
  size: number;
  mimeType: string;
}

export interface StorageProvider {
  upload(buffer: Buffer, path: string, mimeType: string): Promise<UploadResult>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, expiresIn?: number): Promise<string>;
}

export interface StorageConfig {
  provider: 'wasabi' | 'cloudinary';
  enableFallback: boolean;
  wasabi?: WasabiConfig;
  cloudinary?: CloudinaryConfig;
}

export interface WasabiConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}