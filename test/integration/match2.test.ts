import { describe, before, test } from 'mocha'
import { Express } from 'express'
import { expect } from 'chai'

import createHttpServer from '../../src/server'
import { post, get } from '../helper/routeHelper'
import { seed, cleanup, seededCapacityId, seededOrderId, nonExistentId, seededMatch2Id } from '../seeds'

import { selfAlias, identitySelfMock } from '../helper/mock'
import { Match2State } from '../../src/models/match2'

describe('match2', () => {
  let app: Express

  before(async function () {
    app = await createHttpServer()
    identitySelfMock()
  })

  beforeEach(async function () {
    await seed()
  })

  afterEach(async function () {
    await cleanup()
  })

  describe('happy path', () => {
    test('it should create a match2', async () => {
      const response = await post(app, '/match2', { demandA: seededOrderId, demandB: seededCapacityId })
      expect(response.status).to.equal(201)

      const { id: responseId, ...responseRest } = response.body
      expect(responseId).to.match(
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
      )
      expect(responseRest).to.deep.equal({
        state: Match2State.proposed,
        optimiser: selfAlias,
        memberA: selfAlias,
        memberB: selfAlias,
        demandA: seededOrderId,
        demandB: seededCapacityId,
      })
    })

    test('it should get a match2', async () => {
      const response = await get(app, `/match2/${seededMatch2Id}`)
      expect(response.status).to.equal(200)
      expect(response.body).to.deep.equal({
        id: seededMatch2Id,
        state: Match2State.proposed,
        optimiser: selfAlias,
        memberA: selfAlias,
        memberB: selfAlias,
        demandA: seededOrderId,
        demandB: seededCapacityId,
      })
    })

    test('it should get all match2s', async () => {
      const response = await get(app, `/match2`)
      expect(response.status).to.equal(200)
      expect(response.body.length).to.equal(1)
      expect(response.body[0]).to.deep.equal({
        id: seededMatch2Id,
        state: Match2State.proposed,
        optimiser: selfAlias,
        memberA: selfAlias,
        memberB: selfAlias,
        demandA: seededOrderId,
        demandB: seededCapacityId,
      })
    })
  })

  describe('sad path', () => {
    test('non-existent demandA - 400', async () => {
      const response = await post(app, '/match2', { demandA: nonExistentId, demandB: seededCapacityId })
      expect(response.status).to.equal(400)
      expect(response.body).to.equal('Demand A not found')
    })

    test('non-existent demandB - 400', async () => {
      const response = await post(app, '/match2', { demandA: seededOrderId, demandB: nonExistentId })
      expect(response.status).to.equal(400)
      expect(response.body).to.equal('Demand B not found')
    })

    test('both demands are orders - 400', async () => {
      const response = await post(app, '/match2', { demandA: seededOrderId, demandB: seededOrderId })
      expect(response.status).to.equal(400)
      expect(response.body).to.equal('Demands have matching type: order')
    })

    test('both demands are capacities - 400', async () => {
      const response = await post(app, '/match2', { demandA: seededCapacityId, demandB: seededCapacityId })
      expect(response.status).to.equal(400)
      expect(response.body).to.equal('Demands have matching type: capacity')
    })

    it('non-existent match2 id - 404', async () => {
      const response = await get(app, `/match2/${nonExistentId}`)
      expect(response.status).to.equal(404)
    })
  })
})
