import mongoose from 'mongoose';

const { Schema } = mongoose;

const exchangeTransactionSchema = new Schema(
  {
    transactionId: {
      type: String,
      required: true,
      trim: true,
    },
    timestamp: {
      type: Date,
      default: null,
    },
    type: {
      type: String,
      trim: true,
      default: null,
    },
    asset: {
      type: String,
      trim: true,
      default: null,
    },
    quantity: {
      type: Number,
      default: null,
    },
    priceUsd: {
      type: Number,
      default: null,
    },
    fee: {
      type: Number,
      default: null,
    },
    note: {
      type: String,
      trim: true,
      default: null,
    },
    rawRow: {
      type: Schema.Types.Mixed,
      default: null,
    },
    qualityFlag: {
      type: Boolean,
      default: false,
    },
    qualityReason: {
      type: String,
      trim: true,
      default: null,
    },
    runId: {
      type: String,
      index: true,
      trim: true,
      default: null,
    },
  },
  {
    collection: 'exchangeTransactions',
    timestamps: true,
  }
);

exchangeTransactionSchema.index({ transactionId: 1, runId: 1 }, { unique: true });
exchangeTransactionSchema.index({ timestamp: 1 });
exchangeTransactionSchema.index({ asset: 1, type: 1 });

export const ExchangeTransaction = mongoose.model('ExchangeTransaction', exchangeTransactionSchema);
