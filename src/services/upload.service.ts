import { Service } from 'typedi';
import { config } from '../config';
import { initStorage, getStorage, StorageFactory } from './storage/storage.factory';
import logger from '../utils/logger';

export type UploadFolder = 'avatars' | 'posts' | 'marketplace' | 'campaigns' | 'disputes' | 'chat' | 'submissions' | 'id-documents';

export interface UploadMetadata {
  url: string;
  key: string;
  provider: 'wasabi' | 'cloudinary';
  bucket?: string;
  size: number;
  mimeType: string;
}

@Service()
export class UploadService {
  private storage: StorageFactory;

  constructor() {
    this.storage = initStorage({
      provider: config.storage.provider,
      enableFallback: config.storage.enableFallback,
      wasabi: config.wasabi.accessKeyId ? {
        endpoint: config.wasabi.endpoint,
        region: config.wasabi.region,
        accessKeyId: config.wasabi.accessKeyId,
        secretAccessKey: config.wasabi.secretAccessKey,
        bucket: config.wasabi.bucket,
      } : undefined,
      cloudinary: {
        cloudName: config.cloudinary.cloudName,
        apiKey: config.cloudinary.apiKey,
        apiSecret: config.cloudinary.apiSecret,
      },
    });

    logger.info(`Storage initialized: Primary=${config.storage.provider}, Fallback=${config.storage.enableFallback ? 'enabled' : 'disabled'}`);
  }

  async upload(buffer: Buffer, folder: UploadFolder, mimeType: string): Promise<UploadMetadata> {
    const timestamp = Date.now();
    const filename = `${folder}/${timestamp}`;

    try {
      const result = await this.storage.upload(buffer, filename, mimeType);

      logger.info(`File uploaded to ${result.provider}: ${result.url}`);

      return {
        url: result.url,
        key: result.key,
        provider: result.provider,
        bucket: result.bucket,
        size: result.size,
        mimeType: result.mimeType,
      };
    } catch (error) {
      logger.error('Upload failed:', error);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
      logger.info(`File deleted: ${key}`);
    } catch (error) {
      logger.error('Delete failed:', error);
    }
  }
}

export const uploadService = new UploadService();