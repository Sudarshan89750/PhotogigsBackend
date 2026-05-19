import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { StorageProvider, UploadResult, CloudinaryConfig } from './storage.interface';

export class CloudinaryStorage implements StorageProvider {
  private cloudName: string;
  private apiKey: string;
  private apiSecret: string;

  constructor(config: CloudinaryConfig) {
    this.cloudName = config.cloudName;
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;

    cloudinary.config({
      cloud_name: this.cloudName,
      api_key: this.apiKey,
      api_secret: this.apiSecret,
      secure: true,
    });
  }

  async upload(buffer: Buffer, path: string, mimeType: string): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const folder = path.includes('/') ? path.split('/')[0] : 'uploads';
      const stream = cloudinary.uploader.upload_stream(
        { folder: `photogigs/${folder}`, resource_type: 'auto' },
        (err, result?: UploadApiResponse) => {
          if (err || !result) return reject(err ?? new Error('Upload failed'));
          resolve({
            url: result.secure_url,
            key: result.public_id,
            provider: 'cloudinary',
            size: buffer.length,
            mimeType: result.format,
          });
        }
      );
      stream.end(buffer);
    });
  }

  async delete(key: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(key);
    } catch (err) {
      console.error('[CloudinaryStorage] Delete failed:', err);
    }
  }

  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    return `https://res.cloudinary.com/${this.cloudName}/image/upload/${key}`;
  }
}