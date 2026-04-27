import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

export const FREE_TIER = {
  cloudfront: {
    requests:     10_000_000,   // 10 M requests / month  (first 12 months)
    dataTransferGB: 1_024,      // 1 TB / month            (first 12 months)
  },
  s3: {
    storageGB:    5,            // 5 GB always-free
    putRequests:  2_000,        // PUT/COPY/POST/LIST per month  (always-free)
    getRequests:  20_000,       // GET per month                 (always-free)
    dataTransferGB: 100,        // 100 GB / month                (always-free)
  },
};

const cwClient = new CloudWatchClient({
  region: 'us-east-1', // CloudFront metrics are ALWAYS in us-east-1
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

function startOfMonth(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function sumDatapoints(datapoints: { Sum?: number }[]): number {
  return datapoints.reduce((acc, dp) => acc + (dp.Sum ?? 0), 0);
}


async function getCFMetric(
  metricName: string,
  distributionId: string,
  start: Date,
  end: Date,
): Promise<number> {
  const cmd = new GetMetricStatisticsCommand({
    Namespace:  'AWS/CloudFront',
    MetricName: metricName,
    Dimensions: [
      { Name: 'DistributionId', Value: distributionId },
      { Name: 'Region',         Value: 'Global' },
    ],
    StartTime:  start,
    EndTime:    end,
    Period:     86_400,      // daily data points — we sum them ourselves
    Statistics: ['Sum'],
  });

  const res = await cwClient.send(cmd);
  return sumDatapoints(res.Datapoints ?? []);
}

export async function getCloudFrontStats(distributionId: string) {
  const start = startOfMonth();
  const end   = new Date();

  const [requests, bytesDownloaded] = await Promise.all([
    getCFMetric('Requests',        distributionId, start, end),
    getCFMetric('BytesDownloaded', distributionId, start, end),
  ]);

  return {
    requests,
    dataTransferGB: bytesDownloaded / (1024 ** 3),
  };
}


export async function getS3StorageStats() {
  const bucket = process.env.AWS_S3_BUCKET_NAME!;
  let totalBytes  = 0;
  let objectCount = 0;
  let token: string | undefined;

  do {
    const cmd = new ListObjectsV2Command({
      Bucket:            bucket,
      ContinuationToken: token,
    });
    const res = await s3Client.send(cmd);

    for (const obj of res.Contents ?? []) {
      totalBytes  += obj.Size ?? 0;
      objectCount += 1;
    }

    token = res.NextContinuationToken;
  } while (token);

  return {
    storageGB:   totalBytes / (1024 ** 3),
    objectCount,
  };
}
