import * as envalid from 'envalid'
import dotenv from 'dotenv'

if (process.env.NODE_ENV === 'test') {
  dotenv.config({ path: 'test/test.env' })
} else {
  dotenv.config()
}

export default envalid.cleanEnv(process.env, {
  PORT: envalid.port({ default: 3000 }),
  LOG_LEVEL: envalid.str({ default: 'info', devDefault: 'debug' }),
  DB_HOST: envalid.str({ devDefault: 'localhost' }),
  DB_PORT: envalid.port({ default: 5432 }),
  DB_USERNAME: envalid.str({ devDefault: 'postgres' }),
  DB_PASSWORD: envalid.str({ devDefault: 'postgres' }),
  DB_NAME: envalid.str({ default: 'dscp-matchmaker-api' }),
  IDENTITY_SERVICE_HOST: envalid.host({ devDefault: 'localhost' }),
  IDENTITY_SERVICE_PORT: envalid.port({ devDefault: 3002, default: 3000 }),
  NODE_HOST: envalid.host({ default: 'localhost' }),
  NODE_PORT: envalid.port({ default: 9944 }),
  ENABLE_INDEXER: envalid.bool({ default: false }),
  USER_URI: envalid.str({ devDefault: '//Alice' }),
  IPFS_HOST: envalid.host({ devDefault: 'localhost' }),
  IPFS_PORT: envalid.port({ default: 5001 }),
  IPFS_STATUS_POLL_PERIOD_MS: envalid.num({ default: 10 * 1000 }),
  IPFS_STATUS_TIMEOUT_MS: envalid.num({ default: 2 * 1000 }),
  SUBSTRATE_STATUS_POLL_PERIOD_MS: envalid.num({ default: 10 * 1000 }),
  SUBSTRATE_STATUS_TIMEOUT_MS: envalid.num({ default: 2 * 1000 }),
  IDENTITY_STATUS_POLL_PERIOD_MS: envalid.num({ default: 10 * 1000 }),
  IDENTITY_STATUS_TIMEOUT_MS: envalid.num({ default: 2 * 1000 }),
})
