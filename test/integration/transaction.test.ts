import { describe, before } from 'mocha'
import { Express } from 'express'
import { expect } from 'chai'

import createHttpServer from '../../src/server'
import { get } from '../helper/routeHelper'
import {
  seed,
  cleanup,
  seededCapacityId,
  nonExistentId,
  seededTransactionId,
  seededTransactionId2,
  seededProposalTransactionId,
  seededAcceptTransactionId,
  seededMatch2Id,
  exampleDate,
} from '../seeds'
import { TransactionState, TransactionApiType, TransactionType } from '../../src/models/transaction'

describe('transaction', () => {
  let app: Express

  before(async function () {
    app = await createHttpServer()
  })

  beforeEach(async function () {
    await seed()
  })

  afterEach(async function () {
    await cleanup()
  })

  describe('happy path', () => {
    it('it should get a transaction from an id - 200', async () => {
        const response = await get(app, `/transaction/${seededTransactionId}`)
        expect(response.status).to.equal(200)
        expect(response.body).to.deep.equal({
          id: seededTransactionId,
          apiType: TransactionApiType.capacity,
          transactionType: TransactionType.creation,
          localId: seededCapacityId,
          state: TransactionState.submitted,
          submittedAt: exampleDate,
          updatedAt: exampleDate,
        })
      })

      it('it should get all transactions - 200', async () => {
        const response = await get(app, `/transaction/`)
        console.log(response.body)
        expect(response.status).to.equal(200)
        expect(response.body).to.deep.equal([
            {
                id: seededTransactionId,
                api_type: TransactionApiType.capacity,
                transaction_type: TransactionType.creation,
                local_id: seededCapacityId,
                state: TransactionState.submitted,
                created_at: exampleDate,
                updated_at: exampleDate,
            },
            {
                id: seededTransactionId2,
                api_type: TransactionApiType.capacity,
                transaction_type: TransactionType.creation,
                local_id: seededCapacityId,
                state: TransactionState.submitted,
                created_at: exampleDate,
                updated_at: exampleDate,
              },
              {
                id: seededProposalTransactionId,
                api_type: TransactionApiType.match2,
                transaction_type: TransactionType.proposal,
                local_id: seededMatch2Id,
                state: TransactionState.submitted,
                created_at: exampleDate,
                updated_at: exampleDate,
              },
              {
                id: seededAcceptTransactionId,
                api_type: TransactionApiType.match2,
                transaction_type: TransactionType.accept,
                local_id: seededMatch2Id,
                state: TransactionState.submitted,
                created_at: exampleDate,
                updated_at: exampleDate,
              },
              {
                apiType: TransactionApiType.capacity,
                submittedAt: exampleDate,
                transactionType: TransactionType.proposal,
                updatedAt: exampleDate,
              },
        ])
      })

      it('it should get all transactions of an api type - 200', async () => {
        const response = await get(app, `/transaction?apiType=${TransactionApiType.match2}`)
        expect(response.status).to.equal(200)
        expect(response.body).to.deep.equal([
          {
            id: seededProposalTransactionId,
            apiType: TransactionApiType.match2,
            transactionType: TransactionType.proposal,
            localId: seededMatch2Id,
            state: TransactionState.submitted,
            submittedAt: exampleDate,
            updatedAt: exampleDate,
          },
        ])
      })

      it('non-existent transaction type - 422', async () => {
        const response = await get(app, `/transaction?apiType=${TransactionApiType.order}`)
        expect(response.status).to.equal(422)
      })
  })

  describe('sad path', () => {
    it('non-existent transaction id - 404', async () => {
        const response = await get(app, `/transaction/${nonExistentId}`)
        expect(response.status).to.equal(404)
      })

      it('made-up transaction type - 422', async () => {
        const response = await get(app, `/transaction?apiType=${'banana'}`)
        expect(response.status).to.equal(422) 
      })

      it('it should not get all transactions - 200', async () => {
        cleanup()
        const response = await get(app, `/transaction/`)
        expect(response.status).to.equal(200)
      })

  })
})