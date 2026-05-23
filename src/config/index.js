import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  MONGODB_URI: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  TIMESTAMP_TOLERANCE_SECONDS: z.coerce.number().int().nonnegative().default(300),
  QUANTITY_TOLERANCE_PCT: z.coerce.number().nonnegative().default(0.01),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('info'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const details = parsedEnv.error.flatten().fieldErrors;
  throw new Error(`Invalid environment configuration: ${JSON.stringify(details)}`);
}

export const config = {
  mongodbUri: parsedEnv.data.MONGODB_URI,
  port: parsedEnv.data.PORT,
  timestampToleranceSeconds: parsedEnv.data.TIMESTAMP_TOLERANCE_SECONDS,
  quantityTolerancePct: parsedEnv.data.QUANTITY_TOLERANCE_PCT,
  logLevel: parsedEnv.data.LOG_LEVEL,
};
