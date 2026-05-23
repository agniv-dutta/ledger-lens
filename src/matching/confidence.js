/**
 * Compute a confidence score for a reconciled transaction pair.
 * The quantity drift input should be normalized to the configured tolerance limit, where 1.0 means at tolerance.
 * @param {object} params - The confidence scoring parameters.
 * @param {number} params.timestampDiffSeconds - Absolute timestamp drift in seconds.
 * @param {number} [params.timestampToleranceSeconds=300] - Allowed timestamp drift in seconds.
 * @param {number} params.quantityDiffPct - Quantity drift normalized to the tolerance limit.
 * @param {boolean} params.typeSwapped - Whether the match used a TRANSFER_IN/TRANSFER_OUT swap.
 * @param {boolean} params.assetAliased - Whether an asset alias was resolved on either side.
 * @returns {number} The clamped confidence score in the range 0 to 100.
 */
export function computeConfidence({ timestampDiffSeconds, timestampToleranceSeconds = 300, quantityDiffPct, typeSwapped, assetAliased }) {
  const timestampRatio = Math.min(
    Math.max(Number(timestampDiffSeconds ?? 0) / Math.max(Number(timestampToleranceSeconds ?? 300), 1), 0),
    1
  );
  const quantityRatio = Math.min(Math.max(Number(quantityDiffPct ?? 0), 0), 1);

  const timestampDeduction = timestampRatio * 30;
  const quantityDeduction = quantityRatio * 40;
  const typeDeduction = typeSwapped ? 10 : 0;
  const assetDeduction = assetAliased ? 5 : 0;

  const rawScore = 100 - timestampDeduction - quantityDeduction - typeDeduction - assetDeduction;
  return Math.round(Math.min(Math.max(rawScore, 0), 100));
}
