import { StorageAdapter } from '../types/expenses';
import { AwsCloudStorageAdapter } from './AwsCloudStorageAdapter';
import { IndexedDbStorageAdapter } from './IndexedDbStorageAdapter';
import { InMemoryStorageAdapter } from './InMemoryStorageAdapter';
import { isLocalhostEnvironment } from '../utils/appMode';

let defaultAdapter: StorageAdapter | null = null;

export function getStorageAdapter(): StorageAdapter {
  if (!defaultAdapter) {
    if (typeof window !== 'undefined' && window.indexedDB) {
      if (isLocalhostEnvironment()) {
        defaultAdapter = new IndexedDbStorageAdapter();
      } else {
        defaultAdapter = new AwsCloudStorageAdapter(new IndexedDbStorageAdapter());
      }
    } else {
      defaultAdapter = new InMemoryStorageAdapter();
    }
  }
  return defaultAdapter;
}

export function setStorageAdapter(adapter: StorageAdapter): void {
  defaultAdapter = adapter;
}

export * from '../types/expenses';
export * from './defaultCategories';
export * from './IndexedDbStorageAdapter';
export * from './InMemoryStorageAdapter';
export * from './AwsCloudStorageAdapter';
export * from './PlanSyncService';
