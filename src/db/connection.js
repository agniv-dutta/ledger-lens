import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

export async function connectToDatabase(mongodbUri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(mongodbUri);
  logger.info('Connected to MongoDB');
}
