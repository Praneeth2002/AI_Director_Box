import { Storage } from '@google-cloud/storage';
import path from 'path';
import fs from 'fs';

const storage = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

const BUCKET_NAME = process.env.GCS_BUCKET_NAME;

export async function uploadToGCS(localFilePath: string, destination: string): Promise<string | null> {
  if (!BUCKET_NAME) {
    console.warn('[GCS] No BUCKET_NAME defined in .env, skipping cloud upload.');
    return null;
  }

  try {
    const bucket = storage.bucket(BUCKET_NAME);
    const fileName = path.basename(localFilePath);
    const destPath = destination ? `${destination}/${fileName}` : fileName;

    await bucket.upload(localFilePath, {
      destination: destPath,
      public: true, // Make public for easy serving in the competition
    });

    // Return the public URL
    return `https://storage.googleapis.com/${BUCKET_NAME}/${destPath}`;
  } catch (error) {
    console.error('[GCS] Upload failed:', error);
    return null;
  }
}

/**
 * Ensures that if we are in production (Cloud Run), we favor GCS URLs.
 * In local dev, it returns the local path.
 */
export function getServeUrl(localRelativePath: string, gcsUrl: string | null): string {
  if (process.env.NODE_ENV === 'production' && gcsUrl) {
    return gcsUrl;
  }
  return localRelativePath;
}
