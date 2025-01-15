import { describe, beforeEach, afterEach, it } from 'mocha'
import { Express } from 'express'
import { expect } from 'chai'

import Indexer from '../../../src/lib/indexer/index.js'
import { post, get } from '../../helper/routeHelper.js'
import { seed, cleanup, parametersAttachmentId } from '../../seeds/onchainSeeds/onchain.match2.seed.js'
import { withIdentitySelfMock } from '../../helper/mock.js'
import Database, { DemandRow, Match2Row } from '../../../src/lib/db/index.js'
import ChainNode from '../../../src/lib/chainNode.js'
import { pollDemandState, pollMatch2State, pollTransactionState } from '../../helper/poll.js'
import { withAppAndIndexer } from '../../helper/chainTest.js'
import { UUID } from '../../../src/models/strings.js'
import { container } from 'tsyringe'

describe('on-chain', function () {
  this.timeout(180000)
  const db = new Database()
  const node = container.resolve(ChainNode)
  const context: { app: Express; indexer: Indexer } = {} as { app: Express; indexer: Indexer }

  withAppAndIndexer(context)
  withIdentitySelfMock()

  beforeEach(async () => await seed())
  afterEach(async () => await cleanup())

  describe('match2', async () => {
    let match2Ids: string[] = []
    let demandAIds: {
      originalDemandA: number
      demandA: string
      transactionId: any
    }[] = []
    let demandBIds: {
      originalDemandB: number
      demandB: string
      transactionId: any
    }[] = []

    beforeEach(async () => {
      const numberIds = 200

      demandAIds = await Promise.all(
        Array(numberIds)
          .fill(null)
          .map(async () => {
            const {
              body: { id: demandAId },
            } = await post(context.app, '/v1/demandA', { parametersAttachmentId })
            const {
              body: { id: demandATransactionId },
            } = await post(context.app, `/v1/demandA/${demandAId}/creation`, {})
            const [demandA]: DemandRow[] = await db.getDemand(demandAId)

            return {
              originalDemandA: demandA.originalTokenId as number,
              demandA: demandAId as string,
              transactionId: demandATransactionId,
            }
          })
      )

      await node.sealBlock()
      //check demand and transaction state
      for (const demandA of demandAIds) {
        await pollTransactionState(db, demandA.transactionId, 'finalised')
        await pollDemandState(db, demandA.demandA, 'created')
      }

      demandBIds = await Promise.all(
        Array(numberIds)
          .fill(null)
          .map(async () => {
            const {
              body: { id: demandBId },
            } = await post(context.app, '/v1/demandB', { parametersAttachmentId })
            const {
              body: { id: demandBTransactionId },
            } = await post(context.app, `/v1/demandB/${demandBId}/creation`, {})

            const [demandB]: DemandRow[] = await db.getDemand(demandBId)

            return {
              originalDemandB: demandB.originalTokenId as number,
              demandB: demandBId as string,
              transactionId: demandBTransactionId,
            }
          })
      )
      await node.sealBlock()
      //check demand and transaction state
      for (const demandB of demandBIds) {
        await pollTransactionState(db, demandB.transactionId, 'finalised')
        await pollDemandState(db, demandB.demandB, 'created')
      }

      // check we have 500 demandAs and 500 demandBs
      if (demandAIds.length !== demandBIds.length) {
        console.log(`demandAs: ${demandAIds.length}`)
        console.log(`demandBs: ${demandBIds.length}`)

        throw new Error('Mismatch between demand A and demand B lengths')
      }

      match2Ids = await Promise.all(
        demandAIds.map(async (demandA, index) => {
          const demandB = demandBIds[index]
          const {
            body: { id: match2Id },
          } = await post(context.app, '/v1/match2', { demandA: demandA.demandA, demandB: demandB.demandB })
          return match2Id as UUID
        })
      )
      await node.sealBlock()
      // check we have 500 match2s
      if (match2Ids.length === 500) {
        throw new Error('Mismatch between demand A and demand B lengths')
      }
    })

    it.only('should propose many match2s on-chain', async () => {
      const transactionIds = await Promise.all(
        match2Ids.map(async (match2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${match2Id}/proposal`, {})
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
        match2Ids.map(async (match2Id) => {
          await pollMatch2State(db, match2Id, 'proposed')
        })
      )
      await Promise.all(
        match2Ids.map(async (match2Id) => {
          const [maybeMatch2] = await db.getMatch2(match2Id)
          const match2 = maybeMatch2 as Match2Row
          expect(match2.state).to.equal('proposed')
        })
      )
    })

    it('should acceptA then acceptFinal a match2 on-chain', async () => {
      // propose
      const proposalIds = await Promise.all(
        match2Ids.map(async (match2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${match2Id}/proposal`, {})
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
        proposalIds.map(async (proposal) => {
          await pollTransactionState(db, proposal, 'finalised')
        })
      )
      await Promise.all(
        match2Ids.map(async (match2Id) => {
          await pollMatch2State(db, match2Id, 'proposed')
        })
      )
      // submit accept to chain
      const responsesAcceptAIds = await Promise.all(
        match2Ids.map(async (match2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${match2Id}/accept`, {})
          expect(response.status).to.equal(201)

          const { id: transactionId, state } = response.body
          expect(transactionId).to.match(
            /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
          )
          expect(state).to.equal('submitted')
          return transactionId as string
        })
      )

      // wait for block to finalise
      await node.sealBlock()
      await Promise.all(
        responsesAcceptAIds.map(async (responseAcceptA) => {
          await pollTransactionState(db, responseAcceptA, 'finalised')
        })
      )
      await Promise.all(
        match2Ids.map(async (match2Id) => {
          await pollMatch2State(db, match2Id, 'acceptedA')
        })
      )

      // submit 2nd accept to chain
      const responsesAcceptFinalIds = await Promise.all(
        match2Ids.map(async (match2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${match2Id}/accept`, {})
          expect(response.status).to.equal(201)

          const { id: transactionId, state } = response.body
          expect(transactionId).to.match(
            /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
          )
          expect(state).to.equal('submitted')
          return transactionId as string
        })
      )

      // wait for block to finalise
      await node.sealBlock()
      await Promise.all(
        responsesAcceptFinalIds.map(async (responseAcceptFinal) => {
          await pollTransactionState(db, responseAcceptFinal, 'finalised')
        })
      )
      await Promise.all(
        match2Ids.map(async (match2Id) => {
          await pollMatch2State(db, match2Id, 'acceptedFinal')
        })
      )
      // check demans and match2 states
      await Promise.all(
        demandAIds.map(async (demand) => {
          const [maybeDemandA] = await db.getDemand(demand.demandA)
          const demandA = maybeDemandA as DemandRow
          expect(demandA.state).to.equal('allocated')
        })
      )
      await Promise.all(
        demandBIds.map(async (demand) => {
          const [maybeDemandA] = await db.getDemand(demand.demandB)
          const demandA = maybeDemandA as DemandRow
          expect(demandA.state).to.equal('allocated')
        })
      )
      await Promise.all(
        match2Ids.map(async (match) => {
          const [maybeMatch2AcceptFinal] = await db.getMatch2(match)
          const match2AcceptFinal = maybeMatch2AcceptFinal as Match2Row
          expect(match2AcceptFinal.state).to.equal('acceptedFinal')
        })
      )
    })
    it('should reject a proposed match2 on-chain', async () => {
      // propose
      const proposalIds = await Promise.all(
        match2Ids.map(async (match2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${match2Id}/proposal`, {})
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
        proposalIds.map(async (proposal) => {
          await pollTransactionState(db, proposal, 'finalised')
        })
      )
      await Promise.all(
        match2Ids.map(async (match2Id) => {
          await pollMatch2State(db, match2Id, 'proposed')
        })
      )

      // reject match2
      const rejectionIds = await Promise.all(
        match2Ids.map(async (match2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${match2Id}/rejection`, {})
          expect(response.status).to.equal(200)

          const { id: transactionId, state } = response.body
          expect(transactionId).to.match(
            /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
          )
          expect(state).to.equal('submitted')
          return transactionId as string
        })
      )

      // wait for block to finalise
      await node.sealBlock()
      await Promise.all(
        rejectionIds.map(async (rejection) => {
          await pollTransactionState(db, rejection, 'finalised')
        })
      )
      await Promise.all(
        match2Ids.map(async (match) => {
          await pollMatch2State(db, match, 'rejected')
          const [maybeMatch2Rejected] = await db.getMatch2(match)
          const match2Rejected = maybeMatch2Rejected as Match2Row
          expect(match2Rejected.state).to.equal('rejected')
        })
      )
    })
    it('should reject many acceptedA match2s on-chain', async () => {
      // propose
      const proposalIds = await Promise.all(
        match2Ids.map(async (match2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${match2Id}/proposal`, {})
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
        proposalIds.map(async (proposal) => {
          await pollTransactionState(db, proposal, 'finalised')
        })
      )
      await Promise.all(
        match2Ids.map(async (match2Id) => {
          await pollMatch2State(db, match2Id, 'proposed')
        })
      )
      // submit accept to chain
      const responsesAcceptAIds = await Promise.all(
        match2Ids.map(async (match2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${match2Id}/accept`, {})
          expect(response.status).to.equal(201)

          const { id: transactionId, state } = response.body
          expect(transactionId).to.match(
            /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
          )
          expect(state).to.equal('submitted')
          return transactionId as string
        })
      )

      // wait for block to finalise
      await node.sealBlock()
      await Promise.all(
        responsesAcceptAIds.map(async (responseAcceptA) => {
          await pollTransactionState(db, responseAcceptA, 'finalised')
        })
      )
      await Promise.all(
        match2Ids.map(async (match2Id) => {
          await pollMatch2State(db, match2Id, 'acceptedA')
        })
      )
      const rejectionIds = await Promise.all(
        match2Ids.map(async (match2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${match2Id}/rejection`, {})
          expect(response.status).to.equal(200)

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
        rejectionIds.map(async (reject) => {
          await pollTransactionState(db, reject, 'finalised')
        })
      )
      await Promise.all(
        match2Ids.map(async (match2Id) => {
          await pollMatch2State(db, match2Id, 'rejected')
        })
      )
    })

    it('should cancel an acceptedFinal match2 on-chain', async () => {
      // propose
      const proposalIds = await Promise.all(
        match2Ids.map(async (match2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${match2Id}/proposal`, {})
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
        proposalIds.map(async (proposal) => {
          await pollTransactionState(db, proposal, 'finalised')
        })
      )
      await Promise.all(
        match2Ids.map(async (match2Id) => {
          await pollMatch2State(db, match2Id, 'proposed')
        })
      )
      // submit accept to chain
      const responsesAcceptAIds = await Promise.all(
        match2Ids.map(async (match2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${match2Id}/accept`, {})
          expect(response.status).to.equal(201)

          const { id: transactionId, state } = response.body
          expect(transactionId).to.match(
            /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
          )
          expect(state).to.equal('submitted')
          return transactionId as string
        })
      )

      // wait for block to finalise
      await node.sealBlock()
      await Promise.all(
        responsesAcceptAIds.map(async (responseAcceptA) => {
          await pollTransactionState(db, responseAcceptA, 'finalised')
        })
      )
      await Promise.all(
        match2Ids.map(async (match2Id) => {
          await pollMatch2State(db, match2Id, 'acceptedA')
        })
      )

      // submit 2nd accept to chain
      const responsesAcceptFinalIds = await Promise.all(
        match2Ids.map(async (match2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${match2Id}/accept`, {})
          expect(response.status).to.equal(201)

          const { id: transactionId, state } = response.body
          expect(transactionId).to.match(
            /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
          )
          expect(state).to.equal('submitted')
          return transactionId as string
        })
      )

      // wait for block to finalise
      await node.sealBlock()
      await Promise.all(
        responsesAcceptFinalIds.map(async (responseAcceptFinal) => {
          await pollTransactionState(db, responseAcceptFinal, 'finalised')
        })
      )
      await Promise.all(
        match2Ids.map(async (match2Id) => {
          await pollMatch2State(db, match2Id, 'acceptedFinal')
        })
      )
      // check demandAs
      await Promise.all(
        demandAIds.map(async (demand) => {
          const [maybeDemandA] = await db.getDemand(demand.demandA)
          const demandA = maybeDemandA as DemandRow
          expect(demandA.state).to.equal('allocated')
        })
      )
      await Promise.all(
        demandBIds.map(async (demand) => {
          const [maybeDemandA] = await db.getDemand(demand.demandB)
          const demandA = maybeDemandA as DemandRow
          expect(demandA.state).to.equal('allocated')
        })
      )
      await Promise.all(
        match2Ids.map(async (match) => {
          const [maybeMatch2AcceptFinal] = await db.getMatch2(match)
          const match2AcceptFinal = maybeMatch2AcceptFinal as Match2Row
          expect(match2AcceptFinal.state).to.equal('acceptedFinal')
        })
      )
      // submit a cancellation request
      const cancelledIds = await Promise.all(
        match2Ids.map(async (match2Id) => {
          // submit to chain
          const data = { attachmentId: parametersAttachmentId }
          const response = await post(context.app, `/v1/match2/${match2Id}/cancellation`, data)
          expect(response.status).to.equal(200)

          const { id: transactionId, state } = response.body
          expect(transactionId).to.match(
            /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
          )
          expect(state).to.equal('submitted')
          return transactionId as string
        })
      )
      // wait for block to finalise
      await node.sealBlock()
      await Promise.all(
        responsesAcceptFinalIds.map(async (responseAcceptFinal) => {
          await pollTransactionState(db, responseAcceptFinal, 'finalised')
        })
      )
      await Promise.all(
        match2Ids.map(async (match2Id) => {
          await pollMatch2State(db, match2Id, 'cancelled')
        })
      )
      await Promise.all(
        demandAIds.map(async (demand) => {
          const demandA: DemandRow = await db.getDemand(demand.demandA).then((rows: DemandRow[]) => rows[0])
          expect(demandA).to.deep.contain({
            state: 'cancelled',
          })
        })
      )
      await Promise.all(
        demandBIds.map(async (demand) => {
          const demandB: DemandRow = await db.getDemand(demand.demandB).then((rows: DemandRow[]) => rows[0])
          expect(demandB).to.deep.contain({
            state: 'cancelled',
          })
        })
      )
      await Promise.all(
        match2Ids.map(async (match2Id) => {
          const match2: Match2Row = await db.getMatch2(match2Id).then((rows: Match2Row[]) => rows[0])
          expect(match2).to.deep.contain({
            state: 'cancelled',
          })
        })
      )
    })
  })
  describe('re-match2', async () => {
    let match2Ids: string[] = []
    let rematch2Ids: string[] = []
    let demandAIds: {
      originalDemandA: number
      demandA: string
      transactionId: any
    }[] = []
    let demandBIds: {
      originalDemandB: number
      demandB: string
      transactionId: any
    }[] = []
    let newDemandBIds: {
      originalDemandB: number
      demandB: string
      transactionId: any
    }[] = []
    beforeEach(async () => {
      const numberIds = 10

      demandAIds = await Promise.all(
        Array(numberIds)
          .fill(null)
          .map(async () => {
            const {
              body: { id: demandAId },
            } = await post(context.app, '/v1/demandA', { parametersAttachmentId })
            const {
              body: { id: demandATransactionId },
            } = await post(context.app, `/v1/demandA/${demandAId}/creation`, {})

            const [demandA]: DemandRow[] = await db.getDemand(demandAId)

            return {
              originalDemandA: demandA.originalTokenId as number,
              demandA: demandAId as string,
              transactionId: demandATransactionId,
            }
          })
      )

      await node.sealBlock()
      //check demand and transaction state
      for (const demandA of demandAIds) {
        await pollTransactionState(db, demandA.transactionId, 'finalised')
        await pollDemandState(db, demandA.demandA, 'created')
      }

      demandBIds = await Promise.all(
        Array(numberIds)
          .fill(null)
          .map(async () => {
            const {
              body: { id: demandBId },
            } = await post(context.app, '/v1/demandB', { parametersAttachmentId })
            const {
              body: { id: demandBTransactionId },
            } = await post(context.app, `/v1/demandB/${demandBId}/creation`, {})
            const [demandB]: DemandRow[] = await db.getDemand(demandBId)

            return {
              originalDemandB: demandB.originalTokenId as number,
              demandB: demandBId as string,
              transactionId: demandBTransactionId,
            }
          })
      )
      await node.sealBlock()

      //check demand and transaction state
      for (const demandB of demandBIds) {
        await pollTransactionState(db, demandB.transactionId, 'finalised')
        await pollDemandState(db, demandB.demandB, 'created')
      }

      // check we have 500 demandAs and 500 demandBs
      if (demandAIds.length !== demandBIds.length) {
        throw new Error('Mismatch between demand A and demand B lengths')
      }

      match2Ids = await Promise.all(
        demandAIds.map(async (demandA, index) => {
          const demandB = demandBIds[index]
          const {
            body: { id: match2Id },
          } = await post(context.app, '/v1/match2', { demandA: demandA.demandA, demandB: demandB.demandB })
          return match2Id as UUID
        })
      )
      await node.sealBlock()
      newDemandBIds = await Promise.all(
        Array(numberIds)
          .fill(null)
          .map(async () => {
            const {
              body: { id: demandBId },
            } = await post(context.app, '/v1/demandB', { parametersAttachmentId })
            const {
              body: { id: demandBTransactionId },
            } = await post(context.app, `/v1/demandB/${demandBId}/creation`, {})
            const [demandB]: DemandRow[] = await db.getDemand(demandBId)

            return {
              originalDemandB: demandB.originalTokenId as number,
              demandB: demandBId as string,
              transactionId: demandBTransactionId,
            }
          })
      )
      await node.sealBlock()
      // check demand and transaction state for new demands
      for (const demandB of newDemandBIds) {
        await pollTransactionState(db, demandB.transactionId, 'finalised')
        await pollDemandState(db, demandB.demandB, 'created')
      }

      // check that we have same amount of demandAs and new demandBs
      if (demandAIds.length !== newDemandBIds.length) {
        throw new Error('Mismatch between demand A and new demand B lengths')
      }
    })
    it('should propose a rematch2 on-chain', async () => {
      const transactionIds = await Promise.all(
        match2Ids.map(async (match2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${match2Id}/proposal`, {})
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
        match2Ids.map(async (match2Id) => {
          await pollMatch2State(db, match2Id, 'proposed')
        })
      )
      await Promise.all(
        match2Ids.map(async (match2Id) => {
          const [maybeMatch2] = await db.getMatch2(match2Id)
          const match2 = maybeMatch2 as Match2Row
          expect(match2.state).to.equal('proposed')
        })
      )
      const responsesAcceptAIds = await Promise.all(
        match2Ids.map(async (match2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${match2Id}/accept`, {})
          expect(response.status).to.equal(201)

          const { id: transactionId, state } = response.body
          expect(transactionId).to.match(
            /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
          )
          expect(state).to.equal('submitted')
          return transactionId as string
        })
      )

      // wait for block to finalise
      await node.sealBlock()
      await Promise.all(
        responsesAcceptAIds.map(async (responseAcceptA) => {
          await pollTransactionState(db, responseAcceptA, 'finalised')
        })
      )
      await Promise.all(
        match2Ids.map(async (match2Id) => {
          await pollMatch2State(db, match2Id, 'acceptedA')
        })
      )

      // submit 2nd accept to chain
      const responsesAcceptFinalIds = await Promise.all(
        match2Ids.map(async (match2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${match2Id}/accept`, {})
          expect(response.status).to.equal(201)

          const { id: transactionId, state } = response.body
          expect(transactionId).to.match(
            /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
          )
          expect(state).to.equal('submitted')
          return transactionId as string
        })
      )

      // wait for block to finalise
      await node.sealBlock()
      await Promise.all(
        responsesAcceptFinalIds.map(async (responseAcceptFinal) => {
          await pollTransactionState(db, responseAcceptFinal, 'finalised')
        })
      )
      await Promise.all(
        match2Ids.map(async (match2Id) => {
          await pollMatch2State(db, match2Id, 'acceptedFinal')
        })
      )
      // check demandAs
      await Promise.all(
        demandAIds.map(async (demand) => {
          const [maybeDemandA] = await db.getDemand(demand.demandA)
          const demandA = maybeDemandA as DemandRow
          expect(demandA.state).to.equal('allocated')
        })
      )
      await Promise.all(
        demandBIds.map(async (demand) => {
          const [maybeDemandB] = await db.getDemand(demand.demandB)
          const demandB = maybeDemandB as DemandRow
          expect(demandB.state).to.equal('allocated')
        })
      )
      await Promise.all(
        match2Ids.map(async (match) => {
          const [maybeMatch2AcceptFinal] = await db.getMatch2(match)
          const match2AcceptFinal = maybeMatch2AcceptFinal as Match2Row
          expect(match2AcceptFinal.state).to.equal('acceptedFinal')
        })
      )

      //prepare rematches
      rematch2Ids = await Promise.all(
        demandAIds.map(async (demandA, index) => {
          const demandB = newDemandBIds[index]
          const replacingMatch2 = match2Ids[index]
          const {
            body: { id: rematch2Id },
          } = await post(context.app, '/v1/match2', {
            demandA: demandA.demandA,
            demandB: demandB.demandB,
            replaces: replacingMatch2,
          })
          return rematch2Id as UUID
        })
      )
      await node.sealBlock()
      //submit rematches to chain
      const proposedRematch2Ids = await Promise.all(
        rematch2Ids.map(async (rematch2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${rematch2Id}/proposal`, {})
          expect(response.status).to.equal(201)

          const { id: transactionId, state } = response.body
          expect(transactionId).to.match(
            /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
          )
          expect(state).to.equal('submitted')
          return transactionId as string
        })
      )
      // wait for block to finalise
      await node.sealBlock()
      await Promise.all(
        responsesAcceptFinalIds.map(async (responseAcceptFinal) => {
          await pollTransactionState(db, responseAcceptFinal, 'finalised')
        })
      )
      await Promise.all(
        rematch2Ids.map(async (rematch2Id) => {
          await pollMatch2State(db, rematch2Id, 'proposed')
        })
      )
      //check status of demands and matches
      await Promise.all(
        demandAIds.map(async (demand) => {
          const [maybeDemandA] = await db.getDemand(demand.demandA)
          const demandA = maybeDemandA as DemandRow
          expect(demandA.state).to.equal('allocated')
        })
      )
      await Promise.all(
        match2Ids.map(async (match) => {
          const [maybeOldMatch2] = await db.getMatch2(match)
          const oldMatch2 = maybeOldMatch2 as Match2Row
          expect(oldMatch2.state).to.equal('acceptedFinal')
        })
      )
      await Promise.all(
        newDemandBIds.map(async (demand) => {
          const [maybeNewDemandB] = await db.getDemand(demand.demandB)
          const demandB = maybeNewDemandB as DemandRow
          expect(demandB.state).to.equal('created')
        })
      )
      await Promise.all(
        rematch2Ids.map(async (rematch) => {
          const [maybereMatch2] = await db.getMatch2(rematch)
          const rematch2 = maybereMatch2 as Match2Row
          expect(rematch2.state).to.equal('proposed')
        })
      )
    })
    it('accepts a rematch2 proposal', async () => {
      const transactionIds = await Promise.all(
        match2Ids.map(async (match2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${match2Id}/proposal`, {})
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
        match2Ids.map(async (match2Id) => {
          await pollMatch2State(db, match2Id, 'proposed')
        })
      )

      const responsesAcceptAIds = await Promise.all(
        match2Ids.map(async (match2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${match2Id}/accept`, {})
          expect(response.status).to.equal(201)

          const { id: transactionId, state } = response.body
          expect(transactionId).to.match(
            /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
          )
          expect(state).to.equal('submitted')
          return transactionId as string
        })
      )

      // wait for block to finalise
      await node.sealBlock()
      await Promise.all(
        responsesAcceptAIds.map(async (responseAcceptA) => {
          await pollTransactionState(db, responseAcceptA, 'finalised')
        })
      )
      await Promise.all(
        match2Ids.map(async (match2Id) => {
          await pollMatch2State(db, match2Id, 'acceptedA')
        })
      )
      // submit 2nd accept to chain
      const responsesAcceptFinalIds = await Promise.all(
        match2Ids.map(async (match2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${match2Id}/accept`, {})
          expect(response.status).to.equal(201)

          const { id: transactionId, state } = response.body
          expect(transactionId).to.match(
            /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
          )
          expect(state).to.equal('submitted')
          return transactionId as string
        })
      )

      // wait for block to finalise
      await node.sealBlock()
      await Promise.all(
        responsesAcceptFinalIds.map(async (responseAcceptFinal) => {
          await pollTransactionState(db, responseAcceptFinal, 'finalised')
        })
      )
      await Promise.all(
        match2Ids.map(async (match2Id) => {
          await pollMatch2State(db, match2Id, 'acceptedFinal')
        })
      )
      //prepare rematches
      rematch2Ids = await Promise.all(
        demandAIds.map(async (demandA, index) => {
          const demandB = newDemandBIds[index]
          const replacingMatch2 = match2Ids[index]
          const {
            body: { id: rematch2Id },
          } = await post(context.app, '/v1/match2', {
            demandA: demandA.demandA,
            demandB: demandB.demandB,
            replaces: replacingMatch2,
          })
          return rematch2Id as UUID
        })
      )
      await node.sealBlock()
      //submit rematches to chain
      const proposedRematch2Ids = await Promise.all(
        rematch2Ids.map(async (rematch2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${rematch2Id}/proposal`, {})
          expect(response.status).to.equal(201)

          const { id: transactionId, state } = response.body
          expect(transactionId).to.match(
            /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
          )
          expect(state).to.equal('submitted')
          return transactionId as string
        })
      )
      // wait for block to finalise
      await node.sealBlock()
      await Promise.all(
        responsesAcceptFinalIds.map(async (responseAcceptFinal) => {
          await pollTransactionState(db, responseAcceptFinal, 'finalised')
        })
      )
      await Promise.all(
        rematch2Ids.map(async (rematch2Id) => {
          await pollMatch2State(db, rematch2Id, 'proposed')
        })
      )
      const acceptedRematch2Ids = await Promise.all(
        rematch2Ids.map(async (rematch2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${rematch2Id}/accept`, {})
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
        responsesAcceptFinalIds.map(async (responseAcceptFinal) => {
          await pollTransactionState(db, responseAcceptFinal, 'finalised')
        })
      )
      await Promise.all(
        rematch2Ids.map(async (rematch2Id) => {
          await pollMatch2State(db, rematch2Id, 'acceptedA')
        })
      )
      const acceptedFinalRematch2Ids = await Promise.all(
        rematch2Ids.map(async (rematch2Id) => {
          // submit to chain
          const response = await post(context.app, `/v1/match2/${rematch2Id}/accept`, {})
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
        responsesAcceptFinalIds.map(async (responseAcceptFinal) => {
          await pollTransactionState(db, responseAcceptFinal, 'finalised')
        })
      )
      await Promise.all(
        rematch2Ids.map(async (rematch2Id) => {
          await pollMatch2State(db, rematch2Id, 'acceptedFinal')
        })
      )
      //check status of demands and matches
      await Promise.all(
        demandAIds.map(async (demand) => {
          const [maybeDemandA] = await db.getDemand(demand.demandA)
          const demandA = maybeDemandA as DemandRow
          expect(demandA.state).to.equal('allocated')
        })
      )
      await Promise.all(
        demandBIds.map(async (demand) => {
          const [maybeDemandB] = await db.getDemand(demand.demandB)
          const demandB = maybeDemandB as DemandRow
          expect(demandB.state).to.equal('cancelled')
        })
      )
      await Promise.all(
        match2Ids.map(async (match) => {
          const [maybeOldMatch2] = await db.getMatch2(match)
          const oldMatch2 = maybeOldMatch2 as Match2Row
          expect(oldMatch2.state).to.equal('cancelled')
        })
      )
      await Promise.all(
        newDemandBIds.map(async (demand) => {
          const [maybeNewDemandB] = await db.getDemand(demand.demandB)
          const demandB = maybeNewDemandB as DemandRow
          expect(demandB.state).to.equal('allocated')
        })
      )
      await Promise.all(
        rematch2Ids.map(async (rematch) => {
          const [maybereMatch2] = await db.getMatch2(rematch)
          const rematch2 = maybereMatch2 as Match2Row
          expect(rematch2.state).to.equal('acceptedFinal')
        })
      )
    })
  })
})
