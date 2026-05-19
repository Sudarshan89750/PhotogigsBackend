import { StorageProvider, UploadResult, StorageConfig } from './storage.interface';
import { WasabiStorage } from './wasabi.storage';
import { CloudinaryStorage } from './cloudinary.storage';

export class StorageFactory {
  private primary: StorageProvider;
  private fallback: StorageProvider | null = null;
  private enableFallback: boolean;

  constructor(config: StorageConfig) {
    if (config.provider === 'wasabi' && config.wasabi) {
      this.primary = new WasabiStorage(config.wasabi);
    } else if (config.provider === 'cloudinary' && config.cloudinary) {
      this.primary = new CloudinaryStorage(config.cloudinary);
    } else {
      throw new Error('Invalid storage configuration');
    }

    if (config.enableFallback && config.provider === 'wasabi' && config.cloudinary) {
      this.fallback = new CloudinaryStorage(config.cloudinary);
    } else if (config.enableFallback && config.provider === 'cloudinary' && config.wasabi) {
      this.fallback = new WasabiStorage(config.wasabi);
    }

    this.enableFallback = config.enableFallback;
  }

  async upload(buffer: Buffer, path: string, mimeType: string): Promise<UploadResult> {
    try {
      return await this.primary.upload(buffer, path, mimeType);
    } catch (error) {
      console.error('[StorageFactory] Primary upload failed:', error);

      if (this.enableFallback && this.fallback) {
        console.log('[StorageFactory] Trying fallback provider...');
        try {
          return await this.fallback.upload(buffer, path, mimeType);
        } catch (fallbackError) {
          console.error('[StorageFactory] Fallback upload also failed:', fallbackError);
          throw fallbackError;
        }
      }

      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.primary.delete(key);
    } catch (error) {
      console.error('[StorageFactory] Primary delete failed:', error);
      if (this.enableFallback && this.fallback) {
        await this.fallback.delete(key);
      }
    }
  }

  async getSignedUrl(key: string, expiresIn?: number): Promise<string> {
    return this.primary.getSignedUrl(key, expiresIn);
  }
}

let storageInstance: StorageFactory | null = null;

export function initStorage(config: StorageConfig): StorageFactory {
  storageInstance = new StorageFactory(config);
  return storageInstance;
}

export function getStorage(): StorageFactory {
  if (!storageInstance) {
    throw new Error('Storage not initialized. Call initStorage() first.');
  }
  return storageInstance;
}