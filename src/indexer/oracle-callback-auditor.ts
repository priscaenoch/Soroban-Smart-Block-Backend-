import { prismaWrite as prisma } from '../db';

/**
 * Track oracle callback patterns: link request tx to fulfillment tx.
 * Detects when a contract requests data from an oracle and receives response blocks later.
 */
export async function trackOracleCallback(
  requestTxHash: string,
  requestLedger: number,
  requestTime: Date,
  oracleContractAddress: string,
  dataRequestorAddress: string
): Promise<void> {
  await prisma.oracleCallback.upsert({
    where: { requestTransactionHash: requestTxHash },
    update: {},
    create: {
      requestTransactionHash: requestTxHash,
      requestLedgerSequence: requestLedger,
      requestTimestamp: requestTime,
      oracleContractAddress,
      dataRequestorAddress,
      status: 'pending',
    },
  });
}

/**
 * Mark oracle callback as fulfilled when response is received.
 */
export async function fulfillOracleCallback(
  requestTxHash: string,
  fulfillmentTxHash: string,
  fulfillmentLedger: number,
  fulfillmentTime: Date
): Promise<void> {
  const callback = await prisma.oracleCallback.findUnique({
    where: { requestTransactionHash: requestTxHash },
  });

  if (!callback) return;

  const roundTripLatencyBlocks = fulfillmentLedger - callback.requestLedgerSequence;
  const roundTripLatencyMs = fulfillmentTime.getTime() - callback.requestTimestamp.getTime();

  await prisma.oracleCallback.update({
    where: { requestTransactionHash: requestTxHash },
    data: {
      fulfillmentTransactionHash: fulfillmentTxHash,
      fulfillmentLedgerSequence: fulfillmentLedger,
      fulfillmentTimestamp: fulfillmentTime,
      roundTripLatencyBlocks,
      roundTripLatencyMs,
      status: 'fulfilled',
    },
  });
}

/**
 * Get audit card for a request transaction.
 */
export async function getOracleCallbackAudit(requestTxHash: string) {
  return prisma.oracleCallback.findUnique({
    where: { requestTransactionHash: requestTxHash },
  });
}

/**
 * Get all pending callbacks (not yet fulfilled).
 */
export async function getPendingCallbacks(oracleAddress: string) {
  return prisma.oracleCallback.findMany({
    where: {
      oracleContractAddress: oracleAddress,
      status: 'pending',
    },
    orderBy: { requestLedgerSequence: 'desc' },
  });
}
