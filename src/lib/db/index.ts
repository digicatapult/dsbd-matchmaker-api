import knex, { Knex } from 'knex'
import type { Logger } from 'pino'

import { logger } from '../logger'
import { pgConfig } from './knexfile'
import { DemandState, DemandSubtype } from '../../models/demand'
import { HEX, UUID } from '../../models/strings'
import { Match2State } from '../../models/match2'
import { TransactionApiType, TransactionState, TransactionType } from '../../models/transaction'

const tablesList = ['attachment', 'demand', 'transaction', 'match2', 'processed_blocks'] as const
type TABLES_TUPLE = typeof tablesList
type TABLE = TABLES_TUPLE[number]

export type Models<V> = {
  [key in TABLE]: V
}

export type Query = Knex.QueryBuilder

export type ProcessedBlock = { hash: HEX; parent: HEX; height: number }
export type ProcessedBlockTrimmed = { hash: string; parent: string; height: number }

const demandColumns = [
  'id',
  'owner',
  'state',
  'subtype',
  'parameters_attachment_id AS parametersAttachmentId',
  'latest_token_id AS latestTokenId',
  'original_token_id AS originalTokenId',
]

const match2Columns = [
  'id',
  'state',
  'optimiser',
  'member_a AS memberA',
  'member_b AS memberB',
  'demand_a_id AS demandA',
  'demand_b_id AS demandB',
  'latest_token_id AS latestTokenId',
  'original_token_id AS originalTokenId',
]

const transactionColumns = [
  'id',
  'state',
  'local_id AS localId',
  'api_type AS apiType',
  'transaction_type AS transactionType',
  'created_at AS submittedAt',
  'updated_at AS updatedAt',
]

export interface Transaction {
  id: UUID
  state: TransactionState
  localId: UUID
  apiType: TransactionApiType
  transactionType: TransactionType
  submittedAt: Date
  updatedAt: Date
}

const processBlocksColumns = ['hash', 'height', 'parent']

function trim0x(input: ProcessedBlock): ProcessedBlockTrimmed {
  return {
    hash: input.hash.startsWith('0x') ? input.hash.slice(2) : input.hash,
    height: input.height,
    parent: input.parent.startsWith('0x') ? input.parent.slice(2) : input.parent,
  }
}

function restore0x(input: ProcessedBlockTrimmed): ProcessedBlock {
  return {
    hash: input.hash.startsWith('0x') ? (input.hash as HEX) : `0x${input.hash}`,
    height: input.height,
    parent: input.parent.startsWith('0x') ? (input.parent as HEX) : `0x${input.parent}`,
  }
}

export default class Database {
  private client: Knex
  private log: Logger
  public db: () => Models<() => Query>

  constructor() {
    this.log = logger
    this.client = knex(pgConfig)
    const models = tablesList.reduce((acc, name) => {
      this.log.debug(`initializing ${name} db model`)
      return {
        [name]: () => this.client(name),
        ...acc,
      }
    }, {}) as Models<() => Query>
    this.db = () => models
  }

  getAttachment = async (parametersAttachmentId: string) => {
    return this.db().attachment().where({ id: parametersAttachmentId })
  }

  updateAttachment = async (id: string, filename: string, size: number) => {
    return this.db().attachment().update({ filename, size }).where({ id })
  }

  insertAttachment = async (attachment: object) => {
    return this.db().attachment().insert(attachment).returning('*')
  }

  insertDemand = async (demand: object) => {
    return this.db().demand().insert(demand).returning('*')
  }

  updateDemand = async (id: UUID, demand: object) => {
    return this.db()
      .demand()
      .update({
        ...demand,
        updated_at: new Date(),
      })
      .where({ id })
      .returning('*')
  }

  getDemands = async (subtype: DemandSubtype) => {
    return this.db().demand().select(demandColumns).where({ subtype })
  }

  getDemand = async (id: UUID) => {
    return this.db().demand().select(demandColumns).where({ id })
  }

  getDemandWithAttachment = async (id: UUID, subtype: DemandSubtype) => {
    return this.db()
      .demand()
      .join('attachment', 'demand.parameters_attachment_id', 'attachment.id')
      .select()
      .where({ 'demand.id': id, subtype })
  }

  insertTransaction = async ({ hash, ...rest }: { hash: HEX } & Record<string, string>) => {
    return this.db()
      .transaction()
      .insert({ hash: hash.slice(2), ...rest })
      .returning(transactionColumns)
  }

  getTransaction = async (id: UUID) => {
    return this.db().transaction().select(transactionColumns).where({ id })
  }

  findTransaction = async (callHash: HEX) => {
    const transactions = (await this.db()
      .transaction()
      .select(transactionColumns)
      .where({ hash: callHash.substring(2) })) as Transaction[]

    return transactions.length !== 0 ? transactions[0] : null
  }

  getTransactions = async (state?: TransactionState, api_type?: TransactionApiType) => {
    return this.db()
      .transaction()
      .where({ ...(state && { state }), ...(api_type && { api_type }) })
      .select(transactionColumns)
  }

  getTransactionsByLocalId = async (local_id: UUID, transaction_type: TransactionType) => {
    return this.db().transaction().select(transactionColumns).where({ local_id, transaction_type })
  }

  updateTransaction = async (transactionId: UUID, transaction: object) => {
    return this.db()
      .transaction()
      .update({ ...transaction, updated_at: this.client.fn.now() })
      .where({ id: transactionId })
      .returning('local_id AS localId')
  }

  updateTransactionState = (transactionId: UUID) => {
    return async (state: TransactionState) => {
      await this.updateTransaction(transactionId, { state })
    }
  }

  updateLocalWithTokenId = async (
    table: TABLE,
    localId: UUID,
    state: DemandState | Match2State,
    latestTokenId: number,
    isNewEntity: boolean
  ) => {
    return this.db()
      [table]()
      .update({
        state,
        latest_token_id: latestTokenId,
        ...(isNewEntity && { original_token_id: latestTokenId }),
        updated_at: this.client.fn.now(),
      })
      .where({ id: localId })
  }

  insertMatch2 = async (match2: object) => {
    return this.db().match2().insert(match2).returning(match2Columns)
  }

  updateMatch2 = async (id: UUID, match2: object) => {
    return this.db()
      .match2()
      .update({
        ...match2,
        updated_at: new Date(),
      })
      .where({ id })
      .returning('*')
  }

  getMatch2s = async () => {
    return this.db().match2().select(match2Columns)
  }

  getMatch2 = async (match2Id: UUID) => {
    return this.db().match2().where({ id: match2Id }).select(match2Columns)
  }

  getLastProcessedBlock = async (): Promise<ProcessedBlock | null> => {
    const blockRecords = await this.db()
      .processed_blocks()
      .select(processBlocksColumns)
      .orderBy('height', 'desc')
      .limit(1)
    return blockRecords.length !== 0 ? restore0x(blockRecords[0]) : null
  }

  findLocalIdForToken = async (tokenId: number): Promise<UUID | null> => {
    const result = (await Promise.all([
      this.db().demand().select(['id']).where({ latest_token_id: tokenId }),
      this.db().match2().select(['id']).where({ latest_token_id: tokenId }),
    ])) as { id: UUID }[][]
    const flatten = result.reduce((acc, set) => [...acc, ...set], [])
    return flatten[0]?.id || null
  }

  insertProcessedBlock = async (block: ProcessedBlock): Promise<void> => {
    await this.db().processed_blocks().insert(trim0x(block))
  }

  withTransaction = (update: (db: Database) => Promise<void>) => {
    return this.client.transaction(async (trx) => {
      const decorated: Database = {
        ...this,
        client: trx,
      }
      await update(decorated)
    })
  }
}
