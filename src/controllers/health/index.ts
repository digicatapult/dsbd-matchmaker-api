import { Controller, Get, Response, Route, SuccessResponse, Hidden } from 'tsoa'
import type { Health } from '../../models'
import { logger } from '../../lib/logger'
import { startStatusHandlers } from '../../lib/service-watcher/index'
import { serviceState } from '../../lib/service-watcher/statusPoll'
import { ServiceUnavailable } from '../../lib/error-handler/index'

@Route('health')
export class health extends Controller {
  constructor() {
    super()
  }

  @Response<ServiceUnavailable>(503)
  @SuccessResponse(200)
  @Hidden()
  @Get('/')
  public async get(): Promise<Health> {
    logger.debug({ msg: 'new request received', controller: '/health' })

    const serviceStatusStrings = {
      [serviceState.UP]: 'ok',
      [serviceState.DOWN]: 'down',
      [serviceState.ERROR]: 'error',
    }

    const statusHandler = await startStatusHandlers()
    const status = statusHandler.status
    const details = statusHandler.detail

    const response: Health = {
      status: serviceStatusStrings[status] || 'error',
      version: process.env.npm_package_version ? process.env.npm_package_version : 'unknown',
      details: Object.fromEntries(
        Object.entries(details).map(([depName, { status, detail }]) => {
          return [
            depName,
            {
              status: serviceStatusStrings[status] || 'error',
              detail: detail,
            },
          ]
        })
      ),
    }
    if (status !== serviceState.UP) throw new ServiceUnavailable(503, response)
    return response
  }
}
