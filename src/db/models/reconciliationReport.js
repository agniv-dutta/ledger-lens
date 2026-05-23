import mongoose from 'mongoose';

const { Schema } = mongoose;

const reconciliationReportSchema = new Schema(
  {
    runId: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      enum: ['matched', 'conflicting', 'unmatched_user', 'unmatched_exchange'],
    },
    userTx: {
      type: Schema.Types.Mixed,
      default: null,
    },
    exchangeTx: {
      type: Schema.Types.Mixed,
      default: null,
    },
    reason: {
      type: String,
      trim: true,
      default: null,
    },
    diffDetails: {
      type: Schema.Types.Mixed,
      default: null,
    },
    confidenceScore: {
      type: Number,
      default: null,
    },
  },
  {
    collection: 'reconciliationReports',
    timestamps: true,
  }
);

reconciliationReportSchema.index({ runId: 1 });
reconciliationReportSchema.index({ runId: 1, category: 1 });

export const ReconciliationReport = mongoose.model('ReconciliationReport', reconciliationReportSchema);
