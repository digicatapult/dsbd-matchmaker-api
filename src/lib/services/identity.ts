import { singleton } from 'tsyringe'
import { z } from 'zod'

import { NotFound, HttpResponse } from '../error-handler/index.js'
import env from '../../env.js'
import { Status, serviceState } from '../service-watcher/statusPoll.js'

const identityResponseValidator = z.object({
  address: z.string(),
  alias: z.string(),
})
type IdentityResponse = z.infer<typeof identityResponseValidator>

const identityHealthValidator = z.object({
  version: z.string(),
  status: z.literal('ok'),
})
type IdentityHealthResponse = z.infer<typeof identityHealthValidator>

@singleton()
export default class Identity {
  private URL_PREFIX: string

  constructor() {
    this.URL_PREFIX = `http://${env.IDENTITY_SERVICE_HOST}:${env.IDENTITY_SERVICE_PORT}`
  }

  getStatus = async (): Promise<Status> => {
    try {
      const res = await this.getHealth()
      if (res) {
        if (!res.version.match(/\d+.\d+.\d+/)) {
          return {
            status: serviceState.DOWN,
            detail: {
              message: 'Error getting status from Identity service',
            },
          }
        }
        return {
          status: serviceState.UP,
          detail: {
            version: res.version,
          },
        }
      }
      throw new Error()
    } catch (err) {
      return {
        status: serviceState.DOWN,
        detail: {
          message: 'Error getting status from Identity service',
        },
      }
    }
  }
  getMemberByAlias = async (alias: string, authorization: string): Promise<IdentityResponse> => {
    const res = await fetch(`${this.URL_PREFIX}/v1/members/${encodeURIComponent(alias)}`, {
      headers: {
        authorization,
      },
    })

    if (res.ok) {
      return identityResponseValidator.parse(await res.json())
    }

    if (res.status === 404) {
      throw new NotFound(`identity: ${alias}`)
    }

    throw new HttpResponse({})
  }

  getHealth = async (): Promise<IdentityHealthResponse> => {
    const res = await fetch(`${this.URL_PREFIX}/health`)

    if (res.ok) {
      return identityHealthValidator.parse(await res.json())
    }

    throw new HttpResponse({})
  }

  getMemberBySelf = async (authorization: string): Promise<IdentityResponse> => {
    const res = await fetch(`${this.URL_PREFIX}/v1/self`, {
      headers: {
        authorization,
      },
    })

    if (res.ok) {
      return identityResponseValidator.parse(await res.json())
    }

    throw new HttpResponse({})
  }

  getMemberByAddress = (alias: string, authorization: string) => this.getMemberByAlias(alias, authorization)
}
