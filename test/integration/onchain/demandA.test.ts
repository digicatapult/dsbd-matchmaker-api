import { describe, beforeEach, afterEach, it } from 'mocha'
import { Express } from 'express'
import { expect } from 'chai'

import Indexer from '../../../src/lib/indexer/index.js'
import { post } from '../../helper/routeHelper.js'
import { seed, cleanup, parametersAttachmentId, seededDemandAId } from '../../seeds/onchainSeeds/demandA.seed.js'

import { selfAddress, withIdentitySelfMock } from '../../helper/mock.js'
import Database, { DemandRow } from '../../../src/lib/db/index.js'
import ChainNode from '../../../src/lib/chainNode.js'
import { pollTransactionState, pollDemandState, pollDemandCommentState } from '../../helper/poll.js'
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

  describe('demandA', () => {
    it('creates an demandA on chain', async () => {
      const lastTokenId = await node.getLastTokenId()
      const {
        body: { id: demandAId },
      } = await post(context.app, '/v1/demandA', { parametersAttachmentId })

      // submit to chain
      const response = await post(context.app, `/v1/demandA/${demandAId}/creation`, {})
      expect(response.status).to.equal(201)

      const { id: transactionId, state } = response.body
      expect(transactionId).to.match(
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
      )
      expect(state).to.equal('submitted')

      await node.sealBlock()
      await pollTransactionState(db, transactionId, 'finalised')
      await pollDemandState(db, demandAId, 'created')

      const [demandA] = await db.getDemand(demandAId)
      expect(demandA).to.contain({
        id: demandAId,
        state: 'created',
        subtype: 'demand_a',
        parametersAttachmentId,
        latestTokenId: lastTokenId + 1,
        originalTokenId: lastTokenId + 1,
      })
    })

    it('creates many demandAs on chain in parallel', async function () {
      const numberDemands = 500

      const demandIds = await Promise.all(
        Array(numberDemands)
          .fill(null)
          .map(async () => {
            const {
              status,
              body: { id: demandAId },
            } = await post(context.app, '/v1/demandA', { parametersAttachmentId })
            expect(status).to.equal(201)
            return demandAId as string
          })
      )

      const transactionIds = await Promise.all(
        demandIds.map(async (demandAId) => {
          const response = await post(context.app, `/v1/demandA/${demandAId}/creation`, {})
          expect(response.status).to.equal(201)

          const { id: transactionId, state } = response.body
          expect(transactionId).to.match(
            /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
          )
          expect(state).to.equal('submitted')

          return transactionId as string
        })
      )

      await node.sealBlock()

      await Promise.all(
        transactionIds.map(async (tx) => {
          await pollTransactionState(db, tx, 'finalised')
        })
      )

      await Promise.all(
        demandIds.map(async (demand) => {
          await pollDemandState(db, demand, 'created', 500, 100)

          const [demandA] = await db.getDemand(demand)
          expect(demandA).to.contain({
            id: demand,
            state: 'created',
            subtype: 'demand_a',
            parametersAttachmentId,
          })
        })
      )
    })

    it('should comment on a demandA on-chain', async () => {
      const lastTokenId = await node.getLastTokenId()

      // submit to chain
      const creationResponse = await post(context.app, `/v1/demandA/${seededDemandAId}/creation`, {})
      expect(creationResponse.status).to.equal(201)
      // wait for block to finalise
      await node.sealBlock()
      await pollTransactionState(db, creationResponse.body.id, 'finalised')
      await pollDemandState(db, seededDemandAId, 'created')

      // submit to chain
      const commentResponse = await post(context.app, `/v1/demandA/${seededDemandAId}/comment`, {
        attachmentId: parametersAttachmentId,
      })
      expect(commentResponse.status).to.equal(201)
      // wait for block to finalise
      await node.sealBlock()
      await pollTransactionState(db, commentResponse.body.id, 'finalised')
      await pollDemandCommentState(db, commentResponse.body.id, 'created')

      // check local demandA updates with token id
      const [maybeDemandB] = await db.getDemand(seededDemandAId)
      const demandA = maybeDemandB as DemandRow
      expect(demandA.latestTokenId).to.equal(lastTokenId + 2)
      expect(demandA.originalTokenId).to.equal(lastTokenId + 1)

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
    it('comment on many demandAs on chain in parallel', async function () {
      const numberDemands = 500

      const demandIds = await Promise.all(
        Array(numberDemands)
          .fill(null)
          .map(async () => {
            const {
              status,
              body: { id: demandAId },
            } = await post(context.app, '/v1/demandA', { parametersAttachmentId })
            expect(status).to.equal(201)
            return demandAId as string
          })
      )

      const transactionIds = await Promise.all(
        demandIds.map(async (demandAId) => {
          const response = await post(context.app, `/v1/demandA/${demandAId}/creation`, {})
          expect(response.status).to.equal(201)

          const { id: transactionId, state } = response.body
          expect(transactionId).to.match(
            /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
          )
          expect(state).to.equal('submitted')

          return transactionId as string
        })
      )

      await node.sealBlock()

      await Promise.all(
        transactionIds.map(async (tx) => {
          await pollTransactionState(db, tx, 'finalised')
        })
      )

      await Promise.all(
        demandIds.map(async (demand) => {
          await pollDemandState(db, demand, 'created', 500, 100)

          const [demandA] = await db.getDemand(demand)
          expect(demandA).to.contain({
            id: demand,
            state: 'created',
            subtype: 'demand_a',
            parametersAttachmentId,
          })
        })
      )
      const commentResponses = await Promise.all(
        demandIds.map(async (demandAId) => {
          const commentResponse = await post(context.app, `/v1/demandA/${demandAId}/comment`, {
            attachmentId: parametersAttachmentId,
          })
          expect(commentResponse.status).to.equal(201)
          return commentResponse.body.id as string
        })
      )
      await node.sealBlock()

      await Promise.all(
        commentResponses.map(async (commentResponseId) => {
          await pollTransactionState(db, commentResponseId, 'finalised')
          await pollDemandCommentState(db, commentResponseId, 'created')
          const [maybeComment] = await db.getDemandCommentForTransaction(commentResponseId)
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
      )
    })
  })
})
