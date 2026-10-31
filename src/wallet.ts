/**
 * Server-side wallets (provider and agents) on mainnet, built with
 * Setup.createWalletSQLite (guide §14.1, as AGENTS.md prescribes). It builds the
 * key deriver inside wallet-toolbox, so no @bsv/sdk objects cross from our ESM
 * build into its CJS build. Headers come from Arcade's chaintracks; broadcast
 * uses wallet-toolbox's default providers. Keys come from .env; storage lives
 * in .local/ (both gitignored). Never log a key.
 */
import { mkdirSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { PrivateKey, WhatsOnChain } from '@bsv/sdk'
import { Setup, type Wallet } from '@bsv/wallet-toolbox'

export async function makeServerWallet (rootKeyHex: string, filePath: string): Promise<Wallet> {
  mkdirSync(dirname(filePath), { recursive: true })
  const identityKey = PrivateKey.fromHex(rootKeyHex).toPublicKey().toString()
  const env = { chain: 'main' as const, identityKey, identityKey2: identityKey, taalApiKey: '', devKeys: {}, mySQLConnection: '{}', filePath }
  const setup = await Setup.createWalletSQLite({ env, rootKeyHex, filePath, databaseName: basename(filePath, '.sqlite').replace(/-/g, '_') })
  void setup.monitor.startTasks() // tracks proofs, retries broadcasts
  // Chaintracks can lag behind just-mined blocks; a payer's fresh proof is then
  // rejected as invalid AtomicBEEF after the payer has already broadcast. Fall
  // back to WhatsOnChain headers before refusing (wallet and storage share these services).
  const services = setup.wallet.getServices()
  const primary = await services.getChainTracker()
  const woc = new WhatsOnChain('main')
  services.getChainTracker = async () => ({
    isValidRootForHeight: async (root: string, height: number) =>
      (await primary.isValidRootForHeight(root, height).catch(() => false)) || await woc.isValidRootForHeight(root, height),
    currentHeight: async () => await primary.currentHeight()
  })
  return setup.wallet
}

/** `PROVIDER_KEY` → .local/provider.sqlite, `AGENT_A_KEY` → .local/agent-a.sqlite, … */
export const walletFileFor = (envVar: string): string =>
  `.local/${envVar.replace(/_KEY$/, '').toLowerCase().replace(/_/g, '-')}.sqlite`

export async function walletFromEnv (envVar: string): Promise<Wallet> {
  const hex = process.env[envVar]
  if (hex === undefined || !/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`${envVar} missing or malformed in .env — run npm run keygen`)
  return await makeServerWallet(hex, walletFileFor(envVar))
}

export const spendableSats = async (w: Wallet): Promise<number> =>
  (await w.listOutputs({ basket: 'default', limit: 1000 })).outputs.filter(o => o.spendable).reduce((s, o) => s + o.satoshis, 0)
