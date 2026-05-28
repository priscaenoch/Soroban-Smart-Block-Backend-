import { Router, Request, Response } from 'express';
import { analyzeStorageTrap, markStorageTrapAlert } from '../indexer/storage-trap-analyzer';
import { prismaRead as prisma } from '../db';

export const storageTrapRouter = Router();

/**
 * POST /api/v1/storage-trap/analyze
 * Compare old and new contract ABIs to detect storage layout mismatches.
 */
storageTrapRouter.post('/analyze', async (req: Request, res: Response) => {
  try {
    const { contractAddress, oldAbi, newAbi } = req.body;

    if (!contractAddress || !oldAbi || !newAbi) {
      return res.status(400).json({
        error: 'Missing required fields: contractAddress, oldAbi, newAbi',
      });
    }

    const alerts = await analyzeStorageTrap(contractAddress, oldAbi, newAbi);

    if (alerts.length > 0) {
      await markStorageTrapAlert(contractAddress, alerts);
    }

    res.json({
      contractAddress,
      alertCount: alerts.length,
      criticalCount: alerts.filter(a => a.severity === 'critical').length,
      alerts,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * GET /api/v1/storage-trap/:contractAddress
 * Retrieve storage trap alerts for a contract.
 */
storageTrapRouter.get('/:contractAddress', async (req: Request, res: Response) => {
  try {
    const { contractAddress } = req.params;

    const contract = await prisma.contract.findUnique({
      where: { address: contractAddress },
      select: { abi: true },
    });

    if (!contract) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    const trapAlert = (contract.abi as any)?._storageTrapAlert;

    res.json({
      contractAddress,
      hasTrap: !!trapAlert,
      alert: trapAlert || null,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});
