import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageProvider, UploadResult, WasabiConfig } from './storage.interface';

export class WasabiStorage implements StorageProvider {
  private client: S3Client;
  private bucket: string;

  constructor(config: WasabiConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
    this.bucket = config.bucket;
  }

  async upload(buffer: Buffer, path: string, mimeType: string): Promise<UploadResult> {
    const key = `uploads/${path}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    });

    await this.client.send(command);

    const url = `https://${this.bucket}.s3.${process.env.WASABI_REGION || 'ap-southeast-1'}.wasabisys.com/${key}`;

    return {
      url,
      key,
      provider: 'wasabi',
      bucket: this.bucket,
      size: buffer.length,
      mimeType,
    };
  }

  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(command);
  }

  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }
}