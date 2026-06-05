export interface S3Bucket {
  name: string;
  creationDate?: Date;
  connectionId: string;
}

export interface S3Object {
  key: string;
  lastModified?: Date;
  size?: number;
  etag?: string;
  storageClass?: string;
  isFolder: boolean;
}

export interface ListObjectsResponse {
  objects: S3Object[];
  prefixes: string[];
  isTruncated: boolean;
  nextContinuationToken?: string;
}

export interface IncompleteUpload {
  key: string;
  uploadId: string;
  initiated: string; // ISO timestamp
  storageClass: string | null;
  initiatorDisplayName: string | null;
  initiatorId: string | null;
}
