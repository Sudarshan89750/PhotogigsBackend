import 'reflect-metadata';
import { Container } from 'typedi';
import { loadPostgres } from './postgres.loader';
import { loadMongo } from './mongo.loader';
import { RedisService } from '../services/redis.service';
import logger from '../utils/logger';

export const initializeDependencies = async (): Promise<void> => {
  // 0. Register logger in DI container - services use @Inject('logger')
  Container.set('logger', logger);

  // 1. Databases first - services depend on them
  await loadPostgres();
  await loadMongo();

  // 2. Redis - eagerly instantiate to trigger connection and validate config
  Container.get(RedisService);

  logger.info('All dependencies initialized');
};
