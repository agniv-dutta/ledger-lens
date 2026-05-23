import { assetAliases } from './assetAliases.js';

export function normaliseAsset(asset) {
  const normalizedAsset = String(asset ?? '').trim().toLowerCase();
  const alias = assetAliases[normalizedAsset] ?? normalizedAsset;
  return alias.toUpperCase();
}

export function normaliseType(userType, exchangeType) {
  const normalizedUserType = String(userType ?? '').trim().toUpperCase();
  const normalizedExchangeType = String(exchangeType ?? '').trim().toUpperCase();

  if (normalizedUserType === normalizedExchangeType) {
    return { compatible: true };
  }

  const allowedSwaps = new Set([
    'TRANSFER_OUT|TRANSFER_IN',
    'TRANSFER_IN|TRANSFER_OUT',
  ]);

  if (allowedSwaps.has(`${normalizedUserType}|${normalizedExchangeType}`)) {
    return { compatible: true };
  }

  return {
    compatible: false,
    reason: `type mismatch: ${normalizedUserType} vs ${normalizedExchangeType}`,
  };
}
