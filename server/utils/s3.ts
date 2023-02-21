import util from "util";
import AWS from "aws-sdk";
import fetch from "fetch-with-proxy";
import { compact } from "lodash";
import { useAgent } from "request-filtering-agent";
import { v4 as uuidv4 } from "uuid";
import Logger from "@server/logging/Logger";

// backward compatibility
function removeBucketName(url: string | undefined) {
  if (
    !process.env.AWS_S3_FORCE_PATH_STYLE &&
    process.env.AWS_S3_UPLOAD_BUCKET_NAME &&
    url
  ) {
    const bucket_url = new URL(url);
    if (bucket_url.hostname.startsWith(process.env.AWS_S3_UPLOAD_BUCKET_NAME)) {
      bucket_url.hostname = bucket_url.hostname.substring(
        process.env.AWS_S3_UPLOAD_BUCKET_NAME.length + 1
      );
      return bucket_url.toString();
    }
  }
  return url;
}
const AWS_S3_ACCELERATE_URL = removeBucketName(
  process.env.AWS_S3_ACCELERATE_URL
);
const AWS_S3_UPLOAD_BUCKET_URL = removeBucketName(
  process.env.AWS_S3_UPLOAD_BUCKET_URL
);
const AWS_S3_UPLOAD_BUCKET_NAME = process.env.AWS_S3_UPLOAD_BUCKET_NAME;
const AWS_S3_FORCE_PATH_STYLE = process.env.AWS_S3_FORCE_PATH_STYLE;

const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_REGION = process.env.AWS_REGION || "";
const AWS_SERVICE = process.env.AWS_SERVICE || "s3";
const AWS_S3_PROVIDER = process.env.AWS_S3_PROVIDER || "amazonaws.com";
const AWS_S3_BUCKET_NAME =
  process.env.AWS_S3_BUCKET_NAME || AWS_S3_UPLOAD_BUCKET_NAME || "outline";
const AWS_S3_ENDPOINT =
  process.env.AWS_S3_ENDPOINT ||
  AWS_S3_UPLOAD_BUCKET_URL ||
  `https://${AWS_SERVICE}.${AWS_REGION}.${AWS_S3_PROVIDER}`;
const AWS_S3_ENDPOINT_STYLE =
  /* eslint-disable-next-line */
  process.env.AWS_S3_ENDPOINT_STYLE || (() => {
    /* eslint-disable */
    switch (AWS_S3_FORCE_PATH_STYLE) {
      case "true": return "path";
      case undefined: return "domain";
      default: return "domain";
    }
  })();
const AWS_S3_PUBLIC_ENDPOINT =
  process.env.AWS_S3_PUBLIC_ENDPOINT ||
  AWS_S3_ACCELERATE_URL ||
  AWS_S3_ENDPOINT;

const s3config = {
  endpoint: "",
  region: AWS_REGION,
  s3ForcePathStyle: AWS_S3_ENDPOINT_STYLE === "path",
  accessKeyId: AWS_ACCESS_KEY_ID,
  secretAccessKey: AWS_SECRET_ACCESS_KEY,
  signatureVersion: "v4",
};

s3config.endpoint = AWS_S3_ENDPOINT;
const s3 = new AWS.S3(s3config);
s3config.endpoint = AWS_S3_PUBLIC_ENDPOINT;
const s3public = new AWS.S3(s3config); // used only for signing public urls

const getPresignedPostPromise: (
  params: AWS.S3.PresignedPost.Params
) => Promise<AWS.S3.PresignedPost> = util
  .promisify(s3public.createPresignedPost)
  .bind(s3public);

export const getPresignedPost = async (
  key: string,
  acl: string,
  maxUploadSize: number,
  contentType = "image"
) => {
  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
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

  return await getPresignedPostPromise(params);
};

const _publicS3Endpoint = (() => {
  const url = new URL(AWS_S3_PUBLIC_ENDPOINT);
  if (AWS_S3_ENDPOINT_STYLE === "domain") {
    url.host = `${AWS_S3_BUCKET_NAME}.${url.host}`;
  } else {
    url.pathname += AWS_S3_BUCKET_NAME;
  }
  return url.toString();
})();

export const publicS3Endpoint = () => _publicS3Endpoint;

const host = AWS_S3_UPLOAD_BUCKET_URL.replace("s3:", "localhost:").replace(
  /\/$/,
  ""
);

// support old path-style S3 uploads and new virtual host uploads by checking
// for the bucket name in the endpoint url before appending.
const isVirtualHost = host.includes(AWS_S3_UPLOAD_BUCKET_NAME);

if (isVirtualHost) {
  return host;
}

return `${host}/${isServerUpload && isDocker ? "s3/" : ""
  }${AWS_S3_UPLOAD_BUCKET_NAME}`;
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
  const endpoint = publicS3Endpoint();
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

export const deleteFromS3 = (key: string) => {
  return s3
    .deleteObject({
      Bucket: AWS_S3_BUCKET_NAME,
      Key: key,
    })
    .promise();
};

export const getSignedUrl = async (key: string, expiresInMs = 60) => {
  const params = {
    Bucket: AWS_S3_BUCKET_NAME,
    Key: key,
    Expires: expiresInMs,
    ResponseContentDisposition: "attachment",
  };

  return await s3public.getSignedUrlPromise("getObject", params);
};

// function assumes that acl is private
export const getAWSKeyForFileOp = (teamId: string, name: string) => {
  const bucket = "uploads";
  return `${bucket}/${teamId}/${uuidv4()}/${name}-export.zip`;
};

export const getFileByKey = (key: string) => {
  const params = {
    Bucket: AWS_S3_BUCKET_NAME,
    Key: key,
  };

  try {
    return s3.getObject(params).createReadStream();
  } catch (err) {
    Logger.error("Error getting file from S3 by key", err, {
      key,
    });
  }

  return null;
};
