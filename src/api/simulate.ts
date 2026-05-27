import { Router, Request, Response } from 'express';
import { xdr, Transaction, FeeBumpTransaction, SorobanRpc } from '@stellar/stellar-sdk';
import { rpc } from '../indexer/rpc';
import { config } from '../config';
import { parseInvokeHostFunction } from '../indexer/xdr-parser';
import { getContractAbi } from '../indexer/registry';
import { decodeScVal } from '../indexer/args-decoder';
import { formatFootprint } from '../indexer/footprint-formatter';
import { prisma } from '../db';

export const simulateRouter = Router();

// ── Type helpers ──────────────────────────────────────────────────────────────

interface ParamDiagnostic {
  index: number;
  name: string;
  expectedType: string;
  providedType: string;
  value: unknown;
  issue: string;
}

// ── Arg diagnostics ───────────────────────────────────────────────────────────

const XDR_TYPE_MAP: Record<string, string[]> = {
  address: ['scvAddress'],
  bool: ['scvBool'],
  i128: ['scvI128'],
  u128: ['scvU128'],
  i64: ['scvI64'],
  u64: ['scvU64'],
  i32: ['scvI32'],
  u32: ['scvU32'],
  string: ['scvString'],
  symbol: ['scvSymbol'],
  bytes: ['scvBytes'],
  void: ['scvVoid'],
};

function detectTypeMismatch(abiType: string, xdrType: string, value: unknown): string | null {
  const allowed = XDR_TYPE_MAP[abiType.toLowerCase()];
  if (!allowed) return null;
  if (!allowed.includes(xdrType))
    return `Type mismatch: expected ${abiType} (${allowed.join('|')}) but got ${xdrType}`;
  if ((abiType === 'u32' || abiType === 'u64' || abiType === 'u128') &&
      typeof value === 'bigint' && value < 0n)
    return `Value ${value} is negative but ${abiType} must be ≥ 0`;
  return null;
}

function diagnoseArgs(
  fnName: string,
  rawArgs: xdr.ScVal[],
  abi: Awaited<ReturnType<typeof getContractAbi>>,
  decimals?: number
): ParamDiagnostic[] {
  if (!abi) return [];
  const fn = abi.functions.find((f) => f.name === fnName);
  if (!fn) return [];

  const issues: ParamDiagnostic[] = [];

  for (let i = 0; i < fn.inputs.length; i++) {
    const param = fn.inputs[i];
    const val = rawArgs[i];
    if (!val) {
      issues.push({ index: i, name: param.name, expectedType: param.type,
        providedType: 'missing', value: undefined,
        issue: `Missing required argument "${param.name}" (expected ${param.type})` });
      continue;
    }
    const providedType = val.switch().name;
    const decoded = decodeScVal(val, param, decimals);
    const mismatch = detectTypeMismatch(param.type, providedType, decoded.raw);
    if (mismatch)
      issues.push({ index: i, name: param.name, expectedType: param.type,
        providedType, value: decoded.formatted, issue: mismatch });
  }

  if (rawArgs.length > fn.inputs.length)
    issues.push({ index: fn.inputs.length, name: '(extra)', expectedType: 'none',
      providedType: 'extra', value: null,
      issue: `${rawArgs.length - fn.inputs.length} unexpected extra argument(s) passed to "${fnName}"` });

  return issues;
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/simulate
 * Body: { transaction: "<base64 XDR>" }
 *
 * Proxies to Soroban RPC simulateTransaction.
 * - On success: overlays formatted resource footprint (CPU, RAM, read/write bytes & entries).
 * - On failure: overlays ABI-aware per-param diagnostics explaining what broke.
 */
simulateRouter.post('/', async (req: Request, res: Response) => {
  const { transaction } = req.body as { transaction?: string };
  if (!transaction || typeof transaction !== 'string')
    return res.status(400).json({ error: 'Body must include a base64 XDR "transaction" field.' });

  const parsed = parseInvokeHostFunction(transaction);

  // Build SDK transaction object for the RPC call
  let txObj: Transaction | FeeBumpTransaction;
  try {
    try {
      txObj = new Transaction(transaction, config.networkPassphrase);
    } catch {
      txObj = new FeeBumpTransaction(transaction, config.networkPassphrase);
    }
  } catch (err) {
    return res.status(400).json({ error: 'Invalid transaction XDR', detail: String(err) });
  }

  let rpcResult: SorobanRpc.Api.SimulateTransactionResponse;
  try {
    rpcResult = await rpc.simulateTransaction(txObj);
  } catch (err) {
    return res.status(502).json({ error: 'RPC request failed', detail: String(err) });
  }

  // ── Success path ─────────────────────────────────────────────────────────
  if (SorobanRpc.Api.isSimulationSuccess(rpcResult) || SorobanRpc.Api.isSimulationRestore(rpcResult)) {
    const footprint = formatFootprint(rpcResult);
    return res.json({ status: 'success', simulation: rpcResult, footprint, parsed });
  }

  // ── Failure path — build diagnostic overlay ───────────────────────────────
  const rpcError = (rpcResult as SorobanRpc.Api.SimulateTransactionErrorResponse).error;

  let paramIssues: ParamDiagnostic[] = [];
  let humanSummary = rpcError;

  if (parsed) {
    const { contractId, functionName } = parsed;

    let rawArgs: xdr.ScVal[] = [];
    try {
      const envelope = xdr.TransactionEnvelope.fromXDR(transaction, 'base64');
      const ops = envelope.switch().name === 'envelopeTypeTx'
        ? envelope.v1().tx().operations()
        : envelope.v0().tx().operations();
      const invokeOp = ops.find((op) => op.body().switch().name === 'invokeHostFunction');
      if (invokeOp)
        rawArgs = invokeOp.body().invokeHostFunctionOp().hostFunction().invokeContract().args();
    } catch { /* leave empty */ }

    const [abi, contract] = await Promise.all([
      getContractAbi(contractId),
      prisma.contract.findUnique({ where: { address: contractId } }),
    ]);

    paramIssues = diagnoseArgs(functionName, rawArgs, abi, contract?.tokenDecimals ?? undefined);

    if (paramIssues.length > 0) {
      const lines = paramIssues.map((p) => `  • [arg ${p.index}] ${p.name}: ${p.issue}`);
      humanSummary =
        `Call to "${functionName}" on ${contract?.name ?? contractId} will fail:\n` +
        lines.join('\n');
    } else if (abi) {
      humanSummary =
        `Simulation failed for "${functionName}" on ${contract?.name ?? contractId}. ` +
        `Arguments look structurally valid — likely a contract assertion or missing auth. ` +
        `RPC detail: ${rpcError}`;
    }
  }

  return res.status(422).json({
    status: 'failed',
    diagnostics: {
      rpcError,
      contract: parsed?.contractId ?? null,
      function: parsed?.functionName ?? null,
      paramIssues,
      humanSummary,
    },
  });
});
