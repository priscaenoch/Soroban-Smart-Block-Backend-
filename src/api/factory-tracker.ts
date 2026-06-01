import { Router, Request, Response } from 'express';
import { getFactoryTree, getDexInstances } from '../indexer/contract-factory-tracker';

export const factoryTrackerRouter = Router();

// GET /factories/:parentAddress/tree
factoryTrackerRouter.get('/:parentAddress/tree', async (req: Request, res: Response) => {
  try {
    const tree = await getFactoryTree(req.params.parentAddress);

    res.json({
      parentFactory: tree.parent,
      childCount: tree.childCount,
      children: tree.children.map((c: any) => ({
        childAddress: c.childContractAddress,
        createdAt: c.creationTimestamp,
        creationTxHash: c.creationTransactionHash,
        metadata: c.contractMetadata,
      })),
    });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// GET /factories/:factoryAddress/instances
factoryTrackerRouter.get('/:factoryAddress/instances', async (req: Request, res: Response) => {
  try {
    const instances = await getDexInstances(req.params.factoryAddress);

    res.json({
      factoryAddress: req.params.factoryAddress,
      activeInstances: instances.length,
      instances: instances.map((i: any) => ({
        address: i.childContractAddress,
        createdAt: i.creationTimestamp,
        creationLedger: i.creationLedgerSequence,
      })),
    });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});
