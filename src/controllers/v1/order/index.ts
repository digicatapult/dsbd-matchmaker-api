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
} from 'tsoa'
import { Logger } from 'pino'

import { UUID } from '../../../models/strings'
import { DemandRequest, DemandResponse } from '../../../models/demand'
import { TransactionResponse } from '../../../models/transaction'
import { logger } from '../../../lib/logger'
import { BadRequest, NotFound } from '../../../lib/error-handler'
import Database from '../../../lib/db'
import { getMemberByAddress, getMemberBySelf } from '../../../lib/services/identity'
import { demandCreate } from '../../../lib/payload'
import ChainNode from '../../../lib/chainNode'
import env from '../../../env'

@Route('v1/order')
@Tags('order')
@Security('BearerAuth')
export class order extends Controller {
  log: Logger
  db: Database
  node: ChainNode

  constructor() {
    super()
    this.log = logger.child({ controller: '/order' })
    this.db = new Database()
    this.node = new ChainNode({
      host: env.NODE_HOST,
      port: env.NODE_PORT,
      logger,
      userUri: env.USER_URI,
    })
  }

  /**
   * Returns the details of all order demands.
   * @summary List all order demands
   */
  @Get('/')
  public async getAll(): Promise<DemandResponse[]> {
    const order = await this.db.getDemands('order')
    const result = await Promise.all(
      order.map(async (order: DemandResponse) => ({
        ...order,
        owner: await getMemberByAddress(order.owner).then(({ alias }) => alias),
      }))
    )
    return result
  }

  /**
   * Returns the details of all order demand transactions.
   * @summary List all order demand transactions
   * @param orderId The order's identifier
   */
  @Get('{orderId}/creation')
  public async getAllTransactions(@Path() orderId: UUID): Promise<DemandResponse[]> {
    const [order] = await this.db.getDemand(orderId)
    if (!order) throw new NotFound('order')

    return await this.db.getTransactionsByLocalId(orderId, 'creation')
  }

  /**
   * @summary Get a order by ID
   * @param orderId The order's identifier
   */
  @Response<NotFound>(404, 'Item not found')
  @Get('{orderId}')
  public async getById(@Path() orderId: UUID): Promise<DemandResponse> {
    const [order] = await this.db.getDemand(orderId)
    if (!order) throw new NotFound('order')

    return {
      ...order,
      owner: await getMemberByAddress(order.owner),
    }
  }

  /**
   * @summary Get a order creation transaction by ID
   * @param orderId The order's identifier
   * @param creationId The order's creation ID
   */
  @Response<NotFound>(404, 'Item not found.')
  @SuccessResponse('200')
  @Get('{orderId}/creation/{creationId}')
  public async getOrderCreation(@Path() orderId: UUID, creationId: UUID): Promise<TransactionResponse> {
    const [order] = await this.db.getDemand(orderId)
    if (!order) throw new NotFound('order')

    const [creation] = await this.db.getTransaction(creationId)
    if (!creation) throw new NotFound('creation')
    return creation
  }

  /**
   * A member creates the order {orderId} on-chain. The order is now viewable to other members.
   * @summary Create a new order demand on-chain
   * @param orderId The order's identifier
   */
  @Post('{orderId}/creation')
  @Response<NotFound>(404, 'Item not found')
  @SuccessResponse('201')
  public async createOrderOnChain(@Path() orderId: UUID): Promise<TransactionResponse> {
    const [order] = await this.db.getDemandWithAttachment(orderId, 'order')
    if (!order) throw new NotFound('order')
    if (order.state !== 'created') throw new BadRequest(`Demand must have state: ${'created'}`)

    const extrinsic = await this.node.prepareRunProcess(demandCreate(order))

    const [transaction] = await this.db.insertTransaction({
      api_type: 'order',
      transaction_type: 'creation',
      local_id: orderId,
      state: 'submitted',
      hash: extrinsic.hash.toHex(),
    })

    this.node.submitRunProcess(extrinsic, this.db.updateTransactionState(transaction.id))

    return transaction
  }

  /**
   * A Member creates a new demand for a order by referencing an uploaded parameters file.
   * @summary Create a new order demand
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
    const [{ id, state }] = await this.db.insertDemand({
      owner: address,
      subtype: 'order',
      state: 'created',
      parameters_attachment_id: parametersAttachmentId,
    })

    return {
      id,
      owner: alias,
      state,
      parametersAttachmentId,
    }
  }
}