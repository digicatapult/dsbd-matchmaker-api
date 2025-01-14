import { describe, beforeEach, afterEach, it } from 'mocha'
import { Express } from 'express'
import { expect } from 'chai'

import Indexer from '../../../src/lib/indexer/index.js'
import { post } from '../../helper/routeHelper.js'
import { seed, cleanup, seededDemandBId, parametersAttachmentId } from '../../seeds/onchainSeeds/demandB.seed.js'
import { selfAddress, withIdentitySelfMock } from '../../helper/mock.js'
import Database, { DemandRow } from '../../../src/lib/db/index.js'
import ChainNode from '../../../src/lib/chainNode.js'
import { pollDemandCommentState, pollDemandState, pollTransactionState } from '../../helper/poll.js'
import { withAppAndIndexer } from '../../helper/chainTest.js'
import { container } from 'tsyringe'

describe('on-chain', function () {
  this.timeout(60000)
  const db = new Database()
  const node = container.resolve(ChainNode)
  const context: { app: Express; indexer: Indexer } = {} as { app: Express; indexer: Indexer }

  withAppAndIndexer(context)

  withIdentitySelfMock()

  beforeEach(async function () {
    await seed()
  })

  afterEach(async function () {
    await cleanup()
  })

  describe('demandB', () => {
    it('should create a demandB on-chain', async () => {
      const lastTokenId = await node.getLastTokenId()

      // submit to chain
      const response = await post(context.app, `/v1/demandB/${seededDemandBId}/creation`, {})
      expect(response.status).to.equal(201)

      const { id: transactionId, state } = response.body
      expect(transactionId).to.match(
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
      )
      expect(state).to.equal('submitted')

      // wait for block to finalise
      await node.sealBlock()
      await pollTransactionState(db, transactionId, 'finalised')
      await pollDemandState(db, seededDemandBId, 'created')

      // check local demandB updates with token id
      const [maybeDemandB] = await db.getDemand(seededDemandBId)
      const demandB = maybeDemandB as DemandRow
      expect(demandB.latestTokenId).to.equal(lastTokenId + 1)
      expect(demandB.originalTokenId).to.equal(lastTokenId + 1)
    })

    it('should comment on a demandB on-chain', async () => {
      const lastTokenId = await node.getLastTokenId()

      // submit to chain
      const creationResponse = await post(context.app, `/v1/demandB/${seededDemandBId}/creation`, {})
      expect(creationResponse.status).to.equal(201)
      // wait for block to finalise
      await node.sealBlock()
      await pollTransactionState(db, creationResponse.body.id, 'finalised')
      await pollDemandState(db, seededDemandBId, 'created')

      // submit to chain
      const commentResponse = await post(context.app, `/v1/demandB/${seededDemandBId}/comment`, {
        attachmentId: parametersAttachmentId,
      })
      expect(commentResponse.status).to.equal(201)
      // wait for block to finalise
      await node.sealBlock()
      await pollTransactionState(db, commentResponse.body.id, 'finalised')
      await pollDemandCommentState(db, commentResponse.body.id, 'created')

      // check local demandB updates with token id
      const [maybeDemandB] = await db.getDemand(seededDemandBId)
      const demandB = maybeDemandB as DemandRow
      expect(demandB.latestTokenId).to.equal(lastTokenId + 2)
      expect(demandB.originalTokenId).to.equal(lastTokenId + 1)

      const [maybeComment] = await db.getDemandCommentForTransaction(commentResponse.body.id)
      if (!maybeComment) {
        expect.fail('Expected comment to be in db')
      }
      const { id, createdAt, ...comment } = maybeComment
      expect(comment).to.deep.equal({
        owner: selfAddress,
        attachmentId: parametersAttachmentId,
        state: 'created',
      })
    })
  })
})
