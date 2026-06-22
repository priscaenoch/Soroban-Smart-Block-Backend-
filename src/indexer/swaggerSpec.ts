import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Soroban Block Explorer API',
      version: '1.0.0',
      description: 'Human-readable Soroban smart contract block explorer backend. Decodes raw XDR into plain English descriptions of transactions, events, contracts, and tokens on the Stellar/Soroban network.',
    },
    servers: [
      { url: '/api/v1', description: 'API v1' },
    ],
    tags: [
      { name: 'Transactions', description: 'Soroban transaction queries and decoding' },
      { name: 'Events', description: 'Contract event queries' },
      { name: 'Contracts', description: 'Smart contract metadata and ABI management' },
      { name: 'Wallets', description: 'Wallet/account transaction history' },
      { name: 'Tokens', description: 'Token balances, info, and transfers' },
      { name: 'Render', description: 'Human-readable transaction rendering' },
      { name: 'Simulate', description: 'Transaction simulation' },
      { name: 'Verify', description: 'Contract source code verification' },
      { name: 'Authorizations', description: 'Session authorization tracking' },
      { name: 'Sync State', description: 'Indexer synchronization status' },
      { name: 'Network', description: 'Network protocol status' },
      { name: 'Token Metadata', description: 'Token metadata resolution' },
      { name: 'Protocol', description: 'Protocol version and reconciliation' },
      { name: 'i18n', description: 'Internationalization translation management' },
    ],
  },
  apis: ['./src/api/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
