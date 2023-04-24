import fetch from 'node-fetch'
import { startStatusHandler, serviceState } from '../util/statusPoll'
import env from '../../env'

const { WATCHER_POLL_PERIOD_MS, WATCHER_TIMEOUT_MS, IPFS_HOST, IPFS_PORT } = env

const versionURL = `http://${IPFS_HOST}:${IPFS_PORT}/api/v0/version`
const peersURL = `http://${IPFS_HOST}:${IPFS_PORT}/api/v0/swarm/peers`

const getStatus = async () => {
  try {
    const results = await Promise.all([fetch(versionURL, { method: 'POST' }), fetch(peersURL, { method: 'POST' })])
    if (results.some((result) => !result.ok)) {
      return {
        status: serviceState.DOWN,
        detail: {
          message: 'Error getting status from IPFS node',
        },
      }
    }

    const [versionResult, peersResult]: any = await Promise.all(results.map((r) => r.json()))
    const peers = peersResult.Peers || []
    const peerCount = new Set(peers.map((peer: any) => peer.Peer)).size
    return {
      status: peerCount === 0 ? serviceState.DOWN : serviceState.UP,
      detail: {
        version: versionResult.Version,
        peerCount: peerCount,
      },
    }
  } catch (err) {
    return {
      status: serviceState.DOWN,
      detail: {
        message: 'Error getting status from IPFS node',
      },
    }
  }
}

const startIpfsStatus = () =>
  startStatusHandler({
    getStatus,
    pollingPeriodMs: WATCHER_POLL_PERIOD_MS,
    serviceTimeoutMs: WATCHER_TIMEOUT_MS,
  })

export default startIpfsStatus
