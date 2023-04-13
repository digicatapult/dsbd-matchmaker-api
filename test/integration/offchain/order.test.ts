/* eslint disable */
import { describe, before } from 'mocha'
import { Express } from 'express'
import { expect } from 'chai'

import createHttpServer from '../../../src/server'
import { post, get } from '../../helper/routeHelper'
import { seed, parametersAttachmentId, seededOrderId, seededOrderCreationId, cleanup } from '../../seeds'

import { selfAlias, identitySelfMock } from '../../helper/mock'
import Database from '../../../src/lib/db'

const db = new Database()

describe('order', () => {
  let res: any
  let app: Express

  before(async function () {
    app = await createHttpServer()
    identitySelfMock()
  })

  beforeEach(async () => await seed())

  describe('when requested order or orders do not exist', () => {
    beforeEach(async () => await cleanup())

    it('returns 200 and an empty array when retrieving all', async () => {
      const { status, body } = await get(app, '/order')

      expect(status).to.equal(200)
      expect(body).to.be.an('array').that.is.empty
    })

    it('returns 404 if can not be found by ID', async () => {
      const { status, body } = await get(app, '/order/807d1184-9670-4fb0-bb33-28582e5467b2')

      expect(status).to.equal(404)
      expect(body).to.equal('order not found')
    })
    // TODO - assert for max number of records
  })

  describe('if attachment can not be found', () => {
    beforeEach(async () => {
      res = await post(app, '/order', { parametersAttachmentId: 'a789ad47-91c3-446e-90f9-a7c9b233ea88' })
    })

    it('returns 404 along with the message', () => {
      const { status, body } = res

      expect(status).to.equal(404)
      expect(body).to.equal('attachment not found')
    })
  })

  describe('if invalid order uuid', () => {
    beforeEach(async () => {
      res = await get(app, '/order/789ad47')
    })

    it('returns 422 along with validation error', async () => {
      const { status, body } = res

      expect(status).to.equal(422)
      expect(body).to.deep.contain({
        fields: {
          orderId: {
            message:
              "Not match in '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-4[0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}'",
            value: '789ad47',
          },
        },
        name: 'ValidateError',
        message: 'Validation failed',
      })
    })
  })

  describe('if invalid attachment uuid', () => {
    beforeEach(async () => {
      res = await post(app, '/order', { parametersAttachmentId: 'a789ad47' })
    })

    it('returns 422 along with validation error', () => {
      const { status, body } = res

      expect(status).to.equal(422)
      expect(body).to.deep.contain({
        fields: {
          '.parametersAttachmentId': {
            message:
              "Not match in '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-4[0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}'",
            value: 'a789ad47',
          },
        },
        name: 'ValidateError',
        message: 'Validation failed',
      })
    })
  })

  describe('if order state is not created while posting new creation', () => {
    beforeEach(async () => {
      await db.insertDemand({
        id: 'b21f865e-f4e9-4ae2-8944-de691e9eb4d0',
        owner: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
        subtype: 'order',
        state: 'allocated',
        parameters_attachment_id: parametersAttachmentId,
        latest_token_id: 99,
        original_token_id: 99,
      })
    })

    it('returns 400 along with bad request message', async () => {
      const { status, body } = await post(app, '/order/b21f865e-f4e9-4ae2-8944-de691e9eb4d0/creation', {})

      expect(status).to.equal(400)
      expect(body).to.equal('Demand must have state: created')
    })
  })

  it('retrieves order by id', async () => {
    const { status, body } = await post(app, '/order', { parametersAttachmentId })

    expect(status).to.equal(201)
    expect(body).to.have.property('id')
    expect(body).to.deep.contain({
      owner: 'test-self',
      state: 'created',
      parametersAttachmentId: 'a789ad47-91c3-446e-90f9-a7c9b233eaf8',
    })
  })

  it('should create an order demand', async () => {
    const response = await post(app, '/order', { parametersAttachmentId })
    const { id: responseId, ...responseRest } = response.body

    expect(response.status).to.equal(201)
    expect(responseId).to.match(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ABab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
    )
    expect(responseRest).to.deep.equal({
      parametersAttachmentId,
      state: 'created',
      owner: selfAlias,
    })
  })

  it('retrieves order creation', async () => {
    const { status, body: creation } = await get(app, `/order/${seededOrderId}/creation/${seededOrderCreationId}`)

    expect(status).to.equal(200)
    expect(creation).to.include.keys(['id', 'localId', 'submittedAt', 'updatedAt'])
    expect(creation).to.contain({
      state: 'submitted',
      apiType: 'order',
      transactionType: 'creation',
    })
  })

  it('retrieves all order creations', async () => {
    const { status, body } = await get(app, `/order/${seededOrderId}/creation`)

    expect(status).to.equal(200)
    expect(body[0]).to.deep.contain({
      state: 'submitted',
      localId: seededOrderId,
      apiType: 'order',
      transactionType: 'creation',
    })
  })
})
