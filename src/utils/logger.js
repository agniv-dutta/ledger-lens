import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import winston from 'winston';
import { config } from '../config/index.js';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const projectRootPath = path.resolve(currentDirPath, '..', '..');
const logsDirPath = path.join(projectRootPath, 'logs');

fs.mkdirSync(logsDirPath, { recursive: true });

const { combine, timestamp, errors, json, printf } = winston.format;

const consoleFormat = printf(({ level, message, timestamp: logTimestamp, ...meta }) => {
  const metaString = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `${logTimestamp} ${level}: ${message}${metaString}`;
});

export const logger = winston.createLogger({
  level: config.logLevel,
  format: combine(timestamp(), errors({ stack: true }), json()),
  transports: [
    new winston.transports.Console({
      format: combine(timestamp(), errors({ stack: true }), consoleFormat),
    }),
    new winston.transports.File({
      filename: path.join(logsDirPath, 'app.log'),
      level: 'info',
    }),
    new winston.transports.File({
      filename: path.join(logsDirPath, 'error.log'),
      level: 'error',
    }),
  ],
});
