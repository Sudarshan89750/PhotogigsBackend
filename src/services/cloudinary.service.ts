import { Service } from 'typedi';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { config } from '../config';
import logger from '../utils/logger';

export type UploadFolder = 'avatars' | 'posts' | 'marketplace' | 'campaigns' | 'disputes' | 'chat' | 'submissions' | 'id-documents';

@Service()
export class CloudinaryService {
  constructor() {
    cloudinary.config({
      cloud_name: config.cloudinary.cloudName,
      api_key: config.cloudinary.apiKey,
      api_secret: config.cloudinary.apiSecret,
      secure: true,
    });
  }

  // ─── Server-side image upload (memoryStorage routes) ─────────────────────
  async uploadBuffer(
    buffer: Buffer,
    folder: UploadFolder,
    resourceType: 'image' | 'auto' = 'image'
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: `photogigs/${folder}`, resource_type: resourceType },
        (err, result?: UploadApiResponse) => {
          if (err || !result) return reject(err ?? new Error('Upload failed'));
          resolve(result.secure_url);
        }
      );
      stream.end(buffer);
    });
  }

  // ─── FIX: Signed upload params for direct browser → Cloudinary uploads ──
  // The client uses these to upload video/large media DIRECTLY to Cloudinary.
  // Zero video bytes ever touch the Node.js heap.
  //
  // Client flow:
  //   1. GET /api/v1/users/cloudinary-signature?folder=posts&resourceType=video
  //   2. Receive { signature, timestamp, cloudName, apiKey, folder }
  //   3. POST FormData directly to:
  //      https://api.cloudinary.com/v1_1/<cloudName>/video/upload
  //      with fields: file, signature, timestamp, api_key, folder
  //   4. Cloudinary returns { secure_url } — send that URL to the backend
  generateSignedUploadParams(
    folder: UploadFolder,
    resourceType: 'image' | 'video' | 'raw' = 'image',
    userId: string
  ): {
    signature: string;
    timestamp: number;
    cloudName: string;
    apiKey: string;
    folder: string;
    resourceType: string;
    tags: string;
  } {
    const timestamp = Math.round(Date.now() / 1000);
    const fullFolder = `photogigs/${folder}`;

    // Tag the upload with the userId so uploads are traceable
    const paramsToSign: Record<string, string | number> = {
      folder: fullFolder,
      tags: `user_${userId}`,
      timestamp,
    };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      config.cloudinary.apiSecret
    );

    return {
      signature,
      timestamp,
      cloudName: config.cloudinary.cloudName,
      apiKey: config.cloudinary.apiKey,
      folder: fullFolder,
      resourceType,
      tags: `user_${userId}`,
    };
  }

  // ─── Verify a Cloudinary public_id actually belongs to a specific folder ─
  // Call this when the client POSTs back a URL from a direct upload, to prevent
  // users from submitting arbitrary Cloudinary URLs they don't own.
  isOwnedUrl(url: string, expectedFolder: UploadFolder): boolean {
    return url.includes(`/photogigs/${expectedFolder}/`);
  }

  async deleteByUrl(url: string): Promise<void> {
    try {
      const parts = url.split('/');
      const uploadIndex = parts.findIndex((p) => p === 'upload');
      if (uploadIndex === -1) return;
      // Skip version segment (v1234567890) if present after 'upload'
      let publicIdParts = parts.slice(uploadIndex + 1);
      if (publicIdParts.length > 0 && /^v\d+$/.test(publicIdParts[0])) {
        publicIdParts = publicIdParts.slice(1);
      }
      const publicId = publicIdParts.join('/').replace(/\.[^/.]+$/, '');
      await cloudinary.uploader.destroy(publicId);
    } catch (err) {
      logger.error('Cloudinary delete failed', { url, err });
    }
  }
}
