import Database from '../../src/lib/db'
import { putMemberAlias } from '../../src/services/identity'
import { DemandStatus, DemandSubtype } from '../../src/models/demands'

const db = new Database().db()

export const cleanup = async () => {
  await db.attachments().del()
  await db.demands().del()
}

export const selfAlias = 'test-self'
export const selfAddress = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
export const parametersAttachmentId = 'a789ad47-91c3-446e-90f9-a7c9b233eaf8'
export const capacityId = '0f5af074-7d4d-40b4-86a5-17a2391303cb'

export const seed = async () => {
  await cleanup()

  await putMemberAlias(selfAddress, selfAlias)

  await db.attachments().insert([
    {
      id: parametersAttachmentId,
      filename: 'test.txt',
      binary_blob: 9999999,
    },
  ])

  await db.demands().insert([
    {
      id: capacityId,
      owner: selfAddress,
      subtype: DemandSubtype.Capacity,
      status: DemandStatus.Created,
      parameters_attachment_id: parametersAttachmentId,
    },
  ])
}