import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { syncEnv } from "./env.js";

export function createR2Client() {
  // env.js is the only module that names env vars; see its header for why
  // loading and reading are separate concerns.
  const { accessKeyId, secretAccessKey, endpoint, bucket } = syncEnv();
  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return { client, bucket };
}

/** Returns the set of every object key currently in the bucket. */
export async function listAllKeys({ client, bucket }) {
  const keys = new Set();
  let ContinuationToken;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken })
    );
    for (const obj of res.Contents ?? []) keys.add(obj.Key);
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

/** Uploads one derivative with the immutable cache headers from SPEC.md §6. */
export async function putDerivative({ client, bucket }, key, body, contentType) {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
}

/** Deletes objects in batches of 1000 (the S3 DeleteObjects limit). */
export async function deleteKeys({ client, bucket }, keys) {
  const list = [...keys];
  for (let i = 0; i < list.length; i += 1000) {
    const chunk = list.slice(i, i + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: chunk.map((Key) => ({ Key })) },
      })
    );
  }
}
