import mongoose from 'mongoose';

const { Schema } = mongoose;

const reconciliationRunSchema = new Schema(
  {
    runId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed'],
      required: true,
      default: 'pending',
    },
    config: {
      type: Schema.Types.Mixed,
      default: null,
    },
    summary: {
      type: Schema.Types.Mixed,
      default: null,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    error: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    collection: 'reconciliationRuns',
    timestamps: true,
  }
);

export const ReconciliationRun = mongoose.model('ReconciliationRun', reconciliationRunSchema);
