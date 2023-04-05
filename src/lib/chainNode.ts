import { ApiPromise, WsProvider, Keyring, SubmittableResult } from '@polkadot/api'
import { Logger } from 'pino'
import { HttpResponse } from './error-handler'

import env from '../env'
import { addFile } from './services/ipfs'
import type { Payload, Output, Metadata, MetadataFile } from './payload'

const { USER_URI } = env

export interface NodeCtorConfig {
  host: string
  port: number
  logger: Logger
}

interface RoleEnum {
  name: string | undefined
  index: number | undefined
}

export default class ChainNode {
  private provider: WsProvider
  private api: ApiPromise
  private keyring: Keyring
  private logger: Logger
  private roles: RoleEnum[]

  constructor({ host, port, logger }: NodeCtorConfig) {
    this.logger = logger.child({ module: 'ChainNode' })
    this.provider = new WsProvider(`ws://${host}:${port}`)
    this.api = new ApiPromise({ provider: this.provider })
    this.keyring = new Keyring({ type: 'sr25519' })
    this.roles = []

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    this.api.isReadyOrError.catch(() => {}) // prevent unhandled promise rejection errors

    this.api.on('disconnected', () => {
      this.logger.warn(`Disconnected from substrate node at ${host}:${port}`)
    })

    this.api.on('connected', () => {
      this.logger.info(`Connected to substrate node at ${host}:${port}`)
    })

    this.api.on('error', (err) => {
      this.logger.error(`Error from substrate node connection. Error was ${err.message || JSON.stringify(err)}`)
    })
  }

  async getLastFinalisedBlockHash(): Promise<string> {
    const result = await this.api.rpc.chain.getFinalizedHead()
    return result.toHex()
  }

  async getHeader(hash: string): Promise<{ hash: string; height: number; parent: string }> {
    const result = await this.api.rpc.chain.getHeader(hash)
    return {
      hash: result.toHex(),
      height: result.number.toNumber(),
      parent: result.parentHash.toHex(),
    }
  }

  async getRoles(): Promise<RoleEnum[]> {
    await this.api.isReady

    const registry = this.api.registry
    const lookup = registry.lookup
    const lookupId = registry.getDefinition('DscpNodeRuntimeRole') as `Lookup${number}`

    const rolesEnum = lookup.getTypeDef(lookupId).sub
    if (Array.isArray(rolesEnum)) {
      return rolesEnum.map((e) => ({ name: e.name, index: e.index }))
    } else {
      throw new Error('No roles found on-chain')
    }
  }

  roleToIndex(role: string) {
    const entry = this.roles.find((e) => e.name === role)

    if (!entry || entry.index === undefined) {
      throw new Error(`Invalid role: ${role}`)
    }

    return entry.index
  }

  async runProcess({ process, inputs, outputs }: Payload): Promise<number[]> {
    await this.api.isReady

    const account = this.keyring.addFromUri(USER_URI)

    const outputsAsMaps = await Promise.all(
      outputs.map(async (output: Output) => [
        await this.processRoles(output.roles),
        await this.processMetadata(output.metadata),
      ])
    )

    this.logger.debug('Running Transaction inputs: %j outputs: %j', inputs, outputsAsMaps)

    return new Promise((resolve, reject) => {
      let unsub: () => void
      this.api.tx.simpleNFT
        .runProcess(process, inputs, outputsAsMaps)
        .signAndSend(account, (result: SubmittableResult) => {
          this.logger.debug('result.status %s', JSON.stringify(result.status))
          this.logger.debug('result.status.isInBlock', result.status.isInBlock)
          const { dispatchError, status } = result

          if (dispatchError) {
            if (dispatchError.isModule) {
              const decoded = this.api.registry.findMetaError(dispatchError.asModule)
              reject(new HttpResponse({ message: `Node dispatch error: ${decoded.name}` }))
            } else {
              reject(Error(dispatchError.toString()))
            }
          }

          if (status.isInBlock) {
            const processRanEvent = result.events.find(({ event: { method } }) => method === 'ProcessRan')
            const data: any = processRanEvent?.event?.data
            const tokens = data?.outputs?.map((x: any) => x.toNumber())

            unsub()
            resolve(tokens)
          }
        })
        .then((res) => {
          unsub = res
        })
        .catch((err) => {
          this.logger.warn(`Error in run process transaction: ${err}`)
          throw err
        })
    })
  }

  async processRoles(roles: Record<string, string>) {
    if (this.roles.length === 0) {
      this.roles = await this.getRoles()
    }

    return new Map(
      Object.entries(roles).map(([key, v]) => {
        return [this.roleToIndex(key), v]
      })
    )
  }

  async processMetadata(metadata: Metadata) {
    return new Map(
      await Promise.all(
        Object.entries(metadata).map(async ([key, value]) => {
          let processedValue
          switch (value.type) {
            case 'LITERAL':
              processedValue = { Literal: value.value as string }
              break
            case 'TOKEN_ID':
              processedValue = { TokenId: value.value as string }
              break
            case 'FILE':
              processedValue = { File: await addFile(value.value as MetadataFile) }
              break
            default:
            case 'NONE':
              processedValue = { None: null }
              break
          }

          return [key, processedValue] as readonly [unknown, unknown]
        })
      )
    )
  }

  async getLastTokenId() {
    await this.api.isReady
    const lastTokenId = await this.api.query.simpleNFT.lastToken()

    return lastTokenId ? parseInt(lastTokenId.toString(), 10) : 0
  }
}
