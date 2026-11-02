import { RebalancingStorage } from '../../types/rebalancing';
import { isLocalhostEnvironment } from '../../utils/appMode';
import { CloudRebalancingStorage } from './CloudRebalancingStorage';
import { IndexedDbRebalancingStorage } from './IndexedDbRebalancingStorage';

let defaultStorage: RebalancingStorage | null = null;

/** Localhost uses IndexedDB only; any other host also syncs to the cloud API. */
export function getRebalancingStorage(): RebalancingStorage {
  if (!defaultStorage) {
    defaultStorage = isLocalhostEnvironment()
      ? new IndexedDbRebalancingStorage()
      : new CloudRebalancingStorage();
  }
  return defaultStorage;
}

export function setRebalancingStorage(storage: RebalancingStorage): void {
  defaultStorage = storage;
}

export * from './IndexedDbRebalancingStorage';
export * from './CloudRebalancingStorage';
export * from './importPlan';
