import util from "util";
import AWS, { S3 } from "aws-sdk";
import fetch from "fetch-with-proxy";
import { compact } from "lodash";
import { useAgent } from "request-filtering-agent";
import { v4 as uuidv4 } from "uuid";
import env from "@server/env";
import Logger from "@server/logging/Logger";

const AWS_SECRET_ACCESS_KEY = env.AWS_SECRET_ACCESS_KEY;
const AWS_ACCESS_KEY_ID = env.AWS_ACCESS_KEY_ID;
const AWS_REGION = env.AWS_REGION;
const AWS_S3_PROVIDER = env.AWS_S3_PROVIDER;
const AWS_S3_BUCKET_NAME = env.AWS_S3_BUCKET_NAME;
const AWS_S3_FORCE_PATH_STYLE = env.AWS_S3_FORCE_PATH_STYLE;

const AWS_S3_ENDPOINT =
  process.env.AWS_S3_ENDPOINT ||
  `https://${AWS_S3_BUCKET_NAME}.${AWS_REGION}.${AWS_S3_PROVIDER}`;
const AWS_S3_ENDPOINT_MODE =
  process.env.AWS_S3_ENDPOINT_MODE ||
  AWS_S3_ENDPOINT.includes(AWS_S3_BUCKET_NAME)
    ? "domain"
    : "path";
const AWS_S3_PUBLIC_ENDPOINT =
  process.env.AWS_S3_PUBLIC_ENDPOINT || AWS_S3_ENDPOINT;

const s3 = new AWS.S3({
  endpoint: AWS_S3_ENDPOINT,
  region: AWS_REGION,
  s3BucketEndpoint: AWS_S3_ENDPOINT_MODE === "domain" ? true : undefined,
  s3ForcePathStyle: AWS_S3_FORCE_PATH_STYLE,
  accessKeyId: AWS_ACCESS_KEY_ID,
  secretAccessKey: AWS_SECRET_ACCESS_KEY,
  signatureVersion: "v4",
});

const createPresignedPost: (
  params: S3.PresignedPost.Params
) => Promise<S3.PresignedPost> = util
  .promisify(s3.createPresignedPost)
  .bind(s3);

export const getPresignedPost = (
  key: string,
  acl: string,
  maxUploadSize: number,
  contentType = "image"
) => {
  const params = {
    Bucket: AWS_S3_BUCKET_NAME,
    Conditions: compact([
      ["content-length-range", 0, maxUploadSize],
      ["starts-with", "$Content-Type", contentType],
      ["starts-with", "$Cache-Control", ""],
    ]),
    Fields: {
      "Content-Disposition": "attachment",
      key,
      acl,
    },
    Expires: 3600,
  };

  return createPresignedPost(params);
};

export const publicS3Endpoint = (isServerUpload?: boolean) => {
  const endpoint = isServerUpload ? AWS_S3_ENDPOINT : AWS_S3_PUBLIC_ENDPOINT;
  if (AWS_S3_ENDPOINT_MODE === "domain") return endpoint;
  else return `${endpoint}/${AWS_S3_BUCKET_NAME}`;
};

export const uploadToS3 = async ({
  body,
  contentLength,
  contentType,
  key,
  acl,
}: {
  body: S3.Body;
  contentLength: number;
  contentType: string;
  key: string;
  acl: string;
}) => {
  await s3
    .putObject({
      ACL: acl,
      Bucket: AWS_S3_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
      ContentDisposition: "attachment",
      Body: body,
    })
    .promise();
  const endpoint = publicS3Endpoint(true);
  return `${endpoint}/${key}`;
};

export const uploadToS3FromUrl = async (
  url: string,
  key: string,
  acl: string
) => {
  const endpoint = publicS3Endpoint(true);
  if (url.startsWith("/api") || url.startsWith(endpoint)) {
    return;
  }

  try {
    const res = await fetch(url, {
      agent: useAgent(url),
    });
    const buffer = await res.buffer();
    await s3
      .putObject({
        ACL: acl,
        Bucket: AWS_S3_BUCKET_NAME,
        Key: key,
        ContentType: res.headers["content-type"],
        ContentLength: res.headers["content-length"],
        ContentDisposition: "attachment",
        Body: buffer,
      })
      .promise();
    return `${endpoint}/${key}`;
  } catch (err) {
    Logger.error("Error uploading to S3 from URL", err, {
      url,
      key,
      acl,
    });
    return;
  }
};

export const deleteFromS3 = (key: string) =>
  s3
    .deleteObject({
      Bucket: AWS_S3_BUCKET_NAME,
      Key: key,
    })
    .promise();

export const getSignedUrl = async (key: string, expiresIn = 60) => {
  const params = {
    Bucket: AWS_S3_BUCKET_NAME,
    Key: key,
    Expires: expiresIn,
    ResponseContentDisposition: "attachment",
  };

  return await s3.getSignedUrlPromise("getObject", params);
};

// function assumes that acl is private
export const getAWSKeyForFileOp = (teamId: string, name: string) => {
  const bucket = "uploads";
  return `${bucket}/${teamId}/${uuidv4()}/${name}-export.zip`;
};

export const getFileStream = (key: string) => {
  try {
    return s3
      .getObject({
        Bucket: AWS_S3_BUCKET_NAME,
        Key: key,
      })
      .createReadStream();
  } catch (err) {
    Logger.error("Error getting file stream from S3 ", err, {
      key,
    });
  }

  return null;
};

export const getFileBuffer = async (key: string) => {
  const response = await s3
    .getObject({
      Bucket: AWS_S3_BUCKET_NAME,
      Key: key,
    })
    .promise();

  if (response.Body) {
    return response.Body as Blob;
  }

  throw new Error("Error getting file buffer from S3");
};
