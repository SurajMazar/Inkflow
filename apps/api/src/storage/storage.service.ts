import { Readable } from 'node:stream';
import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { AppConfig } from '../config/app-config';

export interface StoredObject {
  body: Readable;
  contentLength: number | null;
  contentType: string | null;
}

function isNotFound(err: unknown): boolean {
  if (err instanceof S3ServiceException) {
    return (
      err.$metadata.httpStatusCode === 404 ||
      err.name === 'NotFound' ||
      err.name === 'NoSuchKey' ||
      err.name === 'NoSuchBucket'
    );
  }
  return false;
}

/** S3-compatible object storage (MinIO locally). */
@Injectable()
export class StorageService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  readonly bucket: string;

  constructor(config: AppConfig) {
    const env = config.env;
    this.bucket = env.S3_BUCKET;
    this.s3 = new S3Client({
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
      maxAttempts: 3,
      // Broadest compatibility with S3-compatible stores (MinIO, R2, …).
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureBucket();
    } catch (err) {
      // Readiness reports storage as down; the API keeps serving everything that does not need it.
      this.logger.error(`Object storage is not reachable: ${(err as Error).message}`);
    }
  }

  onApplicationShutdown(): void {
    this.s3.destroy();
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      if (!isNotFound(err)) throw err;
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created bucket ${this.bucket}`);
      } catch (createErr) {
        const name = (createErr as { name?: string }).name;
        if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw createErr;
      }
    }
  }

  async headBucket(): Promise<void> {
    await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
      }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  /** Streams an object; null when it does not exist. */
  async get(key: string): Promise<StoredObject | null> {
    try {
      const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!out.Body) return null;
      const body =
        out.Body instanceof Readable
          ? out.Body
          : Readable.fromWeb(out.Body.transformToWebStream() as never);
      return {
        body,
        contentLength: out.ContentLength ?? null,
        contentType: out.ContentType ?? null,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    const obj = await this.get(key);
    if (!obj) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of obj.body)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Deletes objects in batches of 1000; failures are logged, not thrown (best-effort cleanup). */
  async deleteMany(keys: string[]): Promise<void> {
    const unique = [...new Set(keys)];
    for (let i = 0; i < unique.length; i += 1000) {
      const chunk = unique.slice(i, i + 1000);
      try {
        await this.s3.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      } catch (err) {
        this.logger.warn(`Failed to delete ${chunk.length} objects: ${(err as Error).message}`);
      }
    }
  }
}
