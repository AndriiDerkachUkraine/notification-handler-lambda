/** Repository factory. Imports are lazy, so the simulated store never loads the MySQL driver. */
import { RequestError } from '../domain/errors.js';

const FACTORIES = {
  dummy: async (config) => (await import('./mysql/dummy.js')).createDummyRepository(config),
  mysql: async (config) => (await import('./mysql/mysql-repository.js')).createMysqlRepository({ url: config.mysqlUrl, creator: config.creator }),
};

/** @param {ReturnType<import('../config.js').loadConfig>} config */
export async function createRepository(config) {
  const create = FACTORIES[config.store];
  if (!create) throw new RequestError(`unknown NOTIFICATION_STORE "${config.store}", expected one of: ${Object.keys(FACTORIES).join(', ')}`);
  return create(config);
}
