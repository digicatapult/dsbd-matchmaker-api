import { Controller, Get, Route, Path, Response, Tags, Security, Query } from 'tsoa'
import type { Logger } from 'pino'
import { logger } from '../../lib/logger'
import Database from '../../lib/db'
import { UUID } from '../../models/uuid'
import { BadRequest, NotFound } from '../../lib/error-handler/index'
import { TransactionResponse, TransactionType } from '../../models/transaction'

@Route('transaction')
@Tags('transaction')
@Security('bearerAuth')
export class TransactionController extends Controller {
  log: Logger
  db: Database

  constructor() {
    super()
    this.log = logger.child({ controller: '/transaction' })
    this.db = new Database()
  }

  /**
   * Returns the details of all transactions.
   * @summary List all transactions
   * @Query apiType lists all transactions by that type
   */
  @Response<BadRequest>(400, 'Request was invalid')
  @Response<NotFound>(404, 'Item not found')
  @Get('/')
  public async getAllTransactions(@Query() apiType?: TransactionType): Promise<TransactionResponse[]> {
    if (apiType) {
      const transactionsByType = await this.db.getTransactionsByType(apiType)
      if (!transactionsByType) throw new NotFound('transactionsByType')

      return transactionsByType
    } else {
      const transactions = await this.db.getTransactions()
      if (!transactions) throw new NotFound('transactions')

      return transactions
    }
  }

  /**
   * @summary Get a transaction by ID
   * @param transactionId The transactions's identifier
   */
  @Response<NotFound>(404, 'Item not found')
  @Get('{transactionId}')
  public async getTransaction(@Path() transactionId: UUID): Promise<TransactionResponse> {
    const [transaction] = await this.db.getTransaction(transactionId)
    if (!transaction) throw new NotFound('transaction')

    return transaction
  }
}