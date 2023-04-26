import {
  ValidateError,
  Controller,
  Post,
  Get,
  Route,
  Response,
  Body,
  SuccessResponse,
  Tags,
  Security,
  Path,
} from 'tsoa'
import type { Logger } from 'pino'

import { logger } from '../../lib/logger'
import Database from '../../lib/db'
import { BadRequest, HttpResponse, NotFound } from '../../lib/error-handler/index'
import { getMemberByAddress, getMemberBySelf } from '../../lib/services/identity'
import { Match2Request, Match2Response } from '../../models/match2'
import { UUID } from '../../models/strings'
import { TransactionResponse } from '../../models/transaction'
import { match2AcceptFinal, match2AcceptFirst, match2Propose } from '../../lib/payload'
import { DemandPayload, DemandSubtype } from '../../models/demand'
import ChainNode from '../../lib/chainNode'
import env from '../../env'

@Route('match2')
@Tags('match2')
@Security('bearerAuth')
export class Match2Controller extends Controller {
  log: Logger
  db: Database
  node: ChainNode

  constructor() {
    super()
    this.log = logger.child({ controller: '/match2' })
    this.db = new Database()
    this.node = new ChainNode({
      host: env.NODE_HOST,
      port: env.NODE_PORT,
      logger,
      userUri: env.USER_URI,
    })
  }

  /**
   * A Member proposes a new match2 for an order and a capacity by referencing each demand.
   * @summary Propose a new match2
   */
  @Post()
  @Response<BadRequest>(400, 'Request was invalid')
  @Response<ValidateError>(422, 'Validation Failed')
  @SuccessResponse('201')
  public async proposeMatch2(
    @Body() { demandA: demandAId, demandB: demandBId }: Match2Request
  ): Promise<Match2Response> {
    const [demandA] = await this.db.getDemand(demandAId)
    validatePreLocal(demandA, 'order', 'DemandA')

    const [demandB] = await this.db.getDemand(demandBId)
    validatePreLocal(demandB, 'capacity', 'DemandB')

    const { address: selfAddress } = await getMemberBySelf()

    const [match2] = await this.db.insertMatch2({
      optimiser: selfAddress,
      member_a: demandA.owner,
      member_b: demandB.owner,
      state: 'proposed',
      demand_a_id: demandAId,
      demand_b_id: demandBId,
    })

    return responseWithAliases(match2)
  }

  /**
   * Returns the details of all match2s.
   * @summary List all match2s
   */
  @Get('/')
  public async getAll(): Promise<Match2Response[]> {
    const match2s = await this.db.getMatch2s()
    const result = await Promise.all(match2s.map(async (match2: Match2Response) => responseWithAliases(match2)))
    return result
  }

  /**
   * @summary Get a match2 by ID
   * @param match2Id The match2's identifier
   */
  @Response<ValidateError>(422, 'Validation Failed')
  @Response<NotFound>(404, 'Item not found')
  @Get('{match2Id}')
  public async getMatch2(@Path() match2Id: UUID): Promise<Match2Response> {
    const [match2] = await this.db.getMatch2(match2Id)
    if (!match2) throw new NotFound('match2')

    return responseWithAliases(match2)
  }

  /**
   * An optimiser creates the match2 {match2Id} on-chain. The match2 is now viewable to other members.
   * @summary Create a new match2 on-chain
   * @param match2Id The match2's identifier
   */
  @Post('{match2Id}/proposal')
  @Response<NotFound>(404, 'Item not found')
  @Response<BadRequest>(400, 'Request was invalid')
  @SuccessResponse('201')
  public async proposeMatch2OnChain(@Path() match2Id: UUID): Promise<TransactionResponse> {
    const [match2] = await this.db.getMatch2(match2Id)
    if (!match2) throw new NotFound('match2')
    if (match2.state !== 'proposed') throw new BadRequest(`Match2 must have state: ${'proposed'}`)

    const [demandA] = await this.db.getDemand(match2.demandA)
    validatePreOnChain(demandA, 'order', 'DemandA')

    const [demandB] = await this.db.getDemand(match2.demandB)
    validatePreOnChain(demandB, 'capacity', 'DemandB')

    const extrinsic = await this.node.prepareRunProcess(match2Propose(match2, demandA, demandB))

    const [transaction] = await this.db.insertTransaction({
      transaction_type: 'proposal',
      api_type: 'match2',
      local_id: match2Id,
      state: 'submitted',
      hash: extrinsic.hash.toHex(),
    })

    this.node.submitRunProcess(extrinsic, this.db.updateTransactionState(transaction.id))

    return transaction
  }

  /**
   * @summary Get a match2 proposal transaction by ID
   * @param match2Id The match2's identifier
   * @param proposalId The match2's proposal ID
   */
  @Response<NotFound>(404, 'Item not found.')
  @SuccessResponse('200')
  @Get('{match2Id}/proposal/{proposalId}')
  public async getMatch2Proposal(@Path() match2Id: UUID, proposalId: UUID): Promise<TransactionResponse> {
    const [match2] = await this.db.getMatch2(match2Id)
    if (!match2) throw new NotFound('match2')

    const [proposal] = await this.db.getTransaction(proposalId)
    if (!proposal) throw new NotFound('proposal')

    return proposal
  }

  /**
   * @summary Get all of a match2's proposal transactions
   * @param match2Id The match2's identifier
   */
  @Response<NotFound>(404, 'Item not found.')
  @SuccessResponse('200')
  @Get('{match2Id}/proposal')
  public async getMatch2Proposals(@Path() match2Id: UUID): Promise<TransactionResponse[]> {
    const [match2] = await this.db.getMatch2(match2Id)
    if (!match2) throw new NotFound('match2')

    return await this.db.getTransactionsByLocalId(match2Id, 'proposal')
  }

  /**
   * A member accepts a match2 {match2Id} on-chain.
   * If all members have accepted, its demands are allocated and can no longer be used in other match2s.
   * @summary Accept a match2 on-chain
   * @param match2Id The match2's identifier
   */
  @Post('{match2Id}/accept')
  @Response<NotFound>(404, 'Item not found')
  @Response<BadRequest>(400, 'Request was invalid')
  @SuccessResponse('201')
  public async acceptMatch2OnChain(@Path() match2Id: UUID): Promise<TransactionResponse> {
    const [match2] = await this.db.getMatch2(match2Id)
    if (!match2) throw new NotFound('match2')

    const state = match2.state

    if (state === 'acceptedFinal') throw new BadRequest(`Already ${'acceptedFinal'}`)

    const [demandA] = await this.db.getDemand(match2.demandA)
    validatePreOnChain(demandA, 'order', 'DemandA')

    const [demandB] = await this.db.getDemand(match2.demandB)
    validatePreOnChain(demandB, 'capacity', 'DemandB')

    const { address: selfAddress } = await getMemberBySelf()
    const ownsDemandA = demandA.owner === selfAddress
    const ownsDemandB = demandB.owner === selfAddress

    const acceptAB = async () => {
      const newState = ownsDemandA ? 'acceptedA' : 'acceptedB'

      const extrinsic = await this.node.prepareRunProcess(match2AcceptFirst(match2, newState, demandA, demandB))

      const [transaction] = await this.db.insertTransaction({
        transaction_type: 'accept',
        api_type: 'match2',
        local_id: match2Id,
        state: 'submitted',
        hash: extrinsic.hash.toHex(),
      })

      this.node.submitRunProcess(extrinsic, this.db.updateTransactionState(transaction.id))
      return transaction
    }

    const acceptFinal = async () => {
      const extrinsic = await this.node.prepareRunProcess(match2AcceptFinal(match2, demandA, demandB))

      const [transaction] = await this.db.insertTransaction({
        transaction_type: 'accept',
        api_type: 'match2',
        local_id: match2Id,
        state: 'submitted',
        hash: extrinsic.hash.toHex(),
      })

      this.node.submitRunProcess(extrinsic, this.db.updateTransactionState(transaction.id))
      return transaction
    }

    switch (state) {
      case 'proposed':
        if (!ownsDemandA && !ownsDemandB) throw new BadRequest(`You do not own an acceptable demand`)
        return await acceptAB()
      case 'acceptedA':
        if (!ownsDemandB) throw new BadRequest(`You do not own an acceptable demand`)
        return await acceptFinal()
      case 'acceptedB':
        if (!ownsDemandA) throw new BadRequest(`You do not own an acceptable demand`)
        return await acceptFinal()
      default:
        throw new HttpResponse({})
    }
  }

  /**
   * @summary Get a match2 accept transaction by ID
   * @param match2Id The match2's identifier
   * @param acceptId The match2's accept ID
   */
  @Response<NotFound>(404, 'Item not found.')
  @SuccessResponse('200')
  @Get('{match2Id}/accept/{acceptId}')
  public async getMatch2Accept(@Path() match2Id: UUID, acceptId: UUID): Promise<TransactionResponse> {
    const [match2] = await this.db.getMatch2(match2Id)
    if (!match2) throw new NotFound('match2')

    const [accept] = await this.db.getTransaction(acceptId)
    if (!accept) throw new NotFound('accept')

    return accept
  }

  /**
   * @summary Get all of a match2's accept transactions
   * @param match2Id The match2's identifier
   */
  @Response<NotFound>(404, 'Item not found.')
  @SuccessResponse('200')
  @Get('{match2Id}/accept')
  public async getMatch2Accepts(@Path() match2Id: UUID): Promise<TransactionResponse[]> {
    const [match2] = await this.db.getMatch2(match2Id)
    if (!match2) throw new NotFound('match2')

    return await this.db.getTransactionsByLocalId(match2Id, 'accept')
  }
}

const responseWithAliases = async (match2: Match2Response): Promise<Match2Response> => {
  const [{ alias: optimiser }, { alias: memberA }, { alias: memberB }] = await Promise.all([
    getMemberByAddress(match2.optimiser),
    getMemberByAddress(match2.memberA),
    getMemberByAddress(match2.memberB),
  ])

  return {
    id: match2.id,
    state: match2.state,
    optimiser,
    memberA,
    memberB,
    demandA: match2.demandA,
    demandB: match2.demandB,
  }
}

const validatePreLocal = (demand: DemandPayload, subtype: DemandSubtype, key: string) => {
  if (!demand) {
    throw new BadRequest(`${key} not found`)
  }

  if (demand.subtype !== subtype) {
    throw new BadRequest(`${key} must be ${subtype}`)
  }

  if (demand.state === 'allocated') {
    throw new BadRequest(`${key} is already ${'allocated'}`)
  }
}

const validatePreOnChain = (demand: DemandPayload, subtype: DemandSubtype, key: string) => {
  validatePreLocal(demand, subtype, key)

  if (!demand.latestTokenId) {
    throw new BadRequest(`${key} must be on chain`)
  }
}
