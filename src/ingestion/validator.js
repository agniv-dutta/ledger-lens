const validationRuns = new Map();

function getRunState(runId) {
  const key = String(runId ?? '__default__');

  if (!validationRuns.has(key)) {
    validationRuns.set(key, {
      user: new Set(),
      exchange: new Set(),
    });
  }

  return validationRuns.get(key);
}

function normalizeString(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

function parseDateValue(value) {
  const normalizedValue = normalizeString(value);

  if (!normalizedValue) {
    return { date: null, reason: 'Missing or unparseable timestamp' };
  }

  const parsedDate = new Date(normalizedValue);

  if (Number.isNaN(parsedDate.getTime())) {
    return { date: null, reason: 'Missing or unparseable timestamp' };
  }

  return { date: parsedDate, reason: null };
}

function parseNumberValue(value) {
  const normalizedValue = normalizeString(value);

  if (!normalizedValue) {
    return null;
  }

  const parsedNumber = Number(normalizedValue);
  return Number.isFinite(parsedNumber) ? parsedNumber : null;
}

function addReason(reasons, reason) {
  if (reason && !reasons.includes(reason)) {
    reasons.push(reason);
  }
}

export function resetValidationState(runId) {
  if (runId == null) {
    validationRuns.clear();
    return;
  }

  validationRuns.delete(String(runId));
}

export function validateRow(row, source) {
  const reasons = [];
  const cleanedRow = {};
  const runId = row?.runId ?? '__default__';
  const runState = getRunState(runId);
  const sourceSet = source === 'exchange' ? runState.exchange : runState.user;

  const transactionId = normalizeString(row?.transactionId);
  const type = normalizeString(row?.type);
  const asset = normalizeString(row?.asset);

  cleanedRow.transactionId = transactionId;
  cleanedRow.type = type;
  cleanedRow.asset = asset;
  cleanedRow.note = normalizeString(row?.note);
  cleanedRow.qualityFlag = false;
  cleanedRow.qualityReason = null;
  cleanedRow.runId = runId === '__default__' ? null : String(runId);
  cleanedRow.rawRow = row;

  const { date: timestamp, reason: timestampReason } = parseDateValue(row?.timestamp);
  cleanedRow.timestamp = timestamp;
  addReason(reasons, timestampReason);

  const quantity = parseNumberValue(row?.quantity);
  const fee = parseNumberValue(row?.fee);

  cleanedRow.quantity = quantity;
  cleanedRow.priceUsd = parseNumberValue(row?.priceUsd);
  cleanedRow.fee = fee;

  if (quantity == null) {
    addReason(reasons, 'Missing or unparseable quantity');
  } else if (quantity <= 0) {
    addReason(reasons, 'Negative or zero quantity');
  }

  if (!transactionId) {
    addReason(reasons, 'Missing required field: transactionId');
  }

  if (!type) {
    addReason(reasons, 'Missing required field: type');
  }

  if (!asset) {
    addReason(reasons, 'Missing required field: asset');
  }

  if (transactionId) {
    if (sourceSet.has(transactionId)) {
      addReason(reasons, 'Duplicate transactionId within source');
    } else {
      sourceSet.add(transactionId);
    }
  }

  const reason = reasons.length > 0 ? reasons.join('; ') : null;

  if (reason) {
    cleanedRow.qualityFlag = true;
    cleanedRow.qualityReason = reason;
  }

  return {
    valid: reason == null,
    cleanedRow,
    reason,
  };
}
