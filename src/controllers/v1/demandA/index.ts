import {
  Get,
  Path,
  Body,
  Tags,
  Security,
  ValidateError,
  SuccessResponse,
  Response,
  Controller,
  Post,
  Route,
  Query,
} from 'tsoa'
import { Logger } from 'pino'

import { DATE, UUID } from '../../../models/strings'
import { DemandRequest, DemandResponse, DemandSubtype } from '../../../models/demand'
import { TransactionResponse, TransactionType } from '../../../models/transaction'
import { logger } from '../../../lib/logger'
import { BadRequest, NotFound } from '../../../lib/error-handler'
import Database, { DemandRow } from '../../../lib/db'
import { getMemberByAddress, getMemberBySelf } from '../../../lib/services/identity'
import { demandCreate } from '../../../lib/payload'
import ChainNode from '../../../lib/chainNode'
import env from '../../../env'
import { parseDateParam } from '../../../lib/utils/queryParams'

@Route('v1/demandA')
@Tags('demandA')
@Security('BearerAuth')
export class demandA extends Controller {
  log: Logger
  db: Database
  node: ChainNode

  constructor() {
    super()
    this.log = logger.child({ controller: '/demandA' })
    this.db = new Database()
    this.node = new ChainNode({
      host: env.NODE_HOST,
      port: env.NODE_PORT,
      logger,
      userUri: env.USER_URI,
    })
  }

  /**
   * Returns the details of all demandA demands.
   * @summary List demandAs
   */
  @Get('/')
  public async getAll(@Query() updated_since?: DATE): Promise<DemandResponse[]> {
    const query: { subtype: DemandSubtype; updatedSince?: Date } = { subtype: 'demand_a' }
    if (updated_since) {
      query.updatedSince = parseDateParam(updated_since)
    }

    const demandAs = await this.db.getDemands(query)
    const result = await Promise.all(demandAs.map(async (demandA) => responseWithAlias(demandA)))
    return result
  }

  /**
   * Returns the details of all demandA demand transactions.
   * @summary List demandA transactions
   * @param demandAId The demandA's identifier
   */
  @Get('{demandAId}/creation')
  public async getAllTransactions(@Path() demandAId: UUID, @Query() updated_since?: DATE): Promise<DemandResponse[]> {
    const query: {
      localId: UUID
      transactionType: TransactionType
      updatedSince?: Date
    } = { localId: demandAId, transactionType: 'creation' }
    if (updated_since) {
      query.updatedSince = parseDateParam(updated_since)
    }

    const [demandA] = await this.db.getDemand(demandAId)
    if (!demandA) throw new NotFound('demandA')

    return await this.db.getTransactionsByLocalId(query)
  }

  /**
   * @summary Get a demandA by ID
   * @param demandAId The demandA's identifier
   */
  @Response<NotFound>(404, 'Item not found')
  @Get('{demandAId}')
  public async getById(@Path() demandAId: UUID): Promise<DemandResponse> {
    const [demandA] = await this.db.getDemand(demandAId)
    if (!demandA) throw new NotFound('demandA')

    return responseWithAlias(demandA)
  }

  /**
   * @summary Get a demandA creation transaction by ID
   * @param demandAId The demandA's identifier
   * @param creationId The demandA's creation ID
   */
  @Response<NotFound>(404, 'Item not found.')
  @SuccessResponse('200')
  @Get('{demandAId}/creation/{creationId}')
  public async getDemandACreation(@Path() demandAId: UUID, creationId: UUID): Promise<TransactionResponse> {
    const [demandA] = await this.db.getDemand(demandAId)
    if (!demandA) throw new NotFound('demandA')

    const [creation] = await this.db.getTransaction(creationId)
    if (!creation) throw new NotFound('creation')
    return creation
  }

  /**
   * A member creates the demandA {demandAId} on-chain. The demandA is now viewable to other members.
   * @summary Create a new demandA demand on-chain
   * @param demandAId The demandA's identifier
   */
  @Post('{demandAId}/creation')
  @Response<NotFound>(404, 'Item not found')
  @SuccessResponse('201')
  public async createDemandAOnChain(@Path() demandAId: UUID): Promise<TransactionResponse> {
    const [demandA] = await this.db.getDemandWithAttachment(demandAId, 'demand_a')
    if (!demandA) throw new NotFound('demandA')
    if (demandA.state !== 'pending') throw new BadRequest(`Demand must have state: 'pending'`)

    const extrinsic = await this.node.prepareRunProcess(demandCreate(demandA))

    const [transaction] = await this.db.insertTransaction({
      api_type: 'demand_a',
      transaction_type: 'creation',
      local_id: demandAId,
      state: 'submitted',
      hash: extrinsic.hash.toHex(),
    })

    this.node.submitRunProcess(extrinsic, this.db.updateTransactionState(transaction.id))

    return transaction
  }

  /**
   * A Member creates a new demand for a demandA by referencing an uploaded parameters file.
   * @summary Create a new demandA demand
   * @param parametersAttachmentId The attachment's identifier
   */
  @Post()
  @Response<BadRequest>(400, 'Request was invalid')
  @Response<NotFound>(404, 'Demand was not found')
  @Response<ValidateError>(422, 'Validation Failed')
  @SuccessResponse('201')
  public async create(@Body() { parametersAttachmentId }: DemandRequest): Promise<DemandResponse> {
    const [attachment] = await this.db.getAttachment(parametersAttachmentId)
    if (!attachment) throw new NotFound('attachment')

    const { address, alias } = await getMemberBySelf()
    const [demandB] = await this.db.insertDemand({
      owner: address,
      subtype: 'demand_a',
      state: 'pending',
      parameters_attachment_id: parametersAttachmentId,
    })

    return {
      id: demandB.id,
      owner: alias,
      state: demandB.state,
      parametersAttachmentId,
      createdAt: demandB.created_at.toISOString(),
      updatedAt: demandB.updated_at.toISOString(),
    }
  }
}

const responseWithAlias = async (demandA: DemandRow): Promise<DemandResponse> => {
  const { alias: ownerAlias } = await getMemberByAddress(demandA.owner)

  return {
    id: demandA.id,
    owner: ownerAlias,
    state: demandA.state,
    parametersAttachmentId: demandA.parametersAttachmentId,
    createdAt: demandA.createdAt.toISOString(),
    updatedAt: demandA.updatedAt.toISOString(),
  }
}
