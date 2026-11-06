import {
  RebalanceAccountTemplate,
  RebalanceSnapshot,
  RebalancingImportReport,
  RebalancingStorage,
} from '../../types/rebalancing';
import { planRebalancingImport } from './importPlan';

const DB_NAME = 'RetirementRebalancingDB';
const DB_VERSION = 1;
const STORE_ACCOUNTS = 'accounts';
const STORE_SNAPSHOTS = 'snapshots';
const INDEX_ACCOUNT_ID = 'accountId';

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class IndexedDbRebalancingStorage implements RebalancingStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDB(): Promise<IDBDatabase> {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return Promise.reject(new Error('IndexedDB is not supported or not available in this environment'));
    }
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_ACCOUNTS)) {
            db.createObjectStore(STORE_ACCOUNTS, { keyPath: 'accountId' });
          }
          if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
            const store = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'snapshotId' });
            store.createIndex(INDEX_ACCOUNT_ID, 'accountId', { unique: false });
          }
        };
      });
    }
    return this.dbPromise;
  }

  async getAccounts(): Promise<RebalanceAccountTemplate[]> {
    const db = await this.getDB();
    return promisify(db.transaction(STORE_ACCOUNTS, 'readonly').objectStore(STORE_ACCOUNTS).getAll());
  }

  async saveAccount(account: RebalanceAccountTemplate): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction(STORE_ACCOUNTS, 'readwrite');
    tx.objectStore(STORE_ACCOUNTS).put(account);
    await txDone(tx);
  }

  async deleteAccount(accountId: string): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction([STORE_ACCOUNTS, STORE_SNAPSHOTS], 'readwrite');
    tx.objectStore(STORE_ACCOUNTS).delete(accountId);
    const snapStore = tx.objectStore(STORE_SNAPSHOTS);
    const keys = await promisify(snapStore.index(INDEX_ACCOUNT_ID).getAllKeys(accountId));
    for (const key of keys) snapStore.delete(key);
    await txDone(tx);
  }

  async getSnapshots(accountId?: string): Promise<RebalanceSnapshot[]> {
    const db = await this.getDB();
    const store = db.transaction(STORE_SNAPSHOTS, 'readonly').objectStore(STORE_SNAPSHOTS);
    const rows = await promisify<RebalanceSnapshot[]>(
      accountId ? store.index(INDEX_ACCOUNT_ID).getAll(accountId) : store.getAll()
    );
    return rows.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async saveSnapshot(snapshot: RebalanceSnapshot): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
    tx.objectStore(STORE_SNAPSHOTS).put(snapshot);
    await txDone(tx);
  }

  async deleteSnapshot(_accountId: string, snapshotId: string): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
    tx.objectStore(STORE_SNAPSHOTS).delete(snapshotId);
    await txDone(tx);
  }

  /** Replaces the local copy with the given cloud state (used by the cloud wrapper after a fetch). */
  async replaceAll(accounts: RebalanceAccountTemplate[], snapshots: RebalanceSnapshot[]): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction([STORE_ACCOUNTS, STORE_SNAPSHOTS], 'readwrite');
    tx.objectStore(STORE_ACCOUNTS).clear();
    tx.objectStore(STORE_SNAPSHOTS).clear();
    for (const a of accounts) tx.objectStore(STORE_ACCOUNTS).put(a);
    for (const s of snapshots) tx.objectStore(STORE_SNAPSHOTS).put(s);
    await txDone(tx);
  }

  async exportRebalancing() {
    return { accounts: await this.getAccounts(), snapshots: await this.getSnapshots() };
  }

  async importRebalancing(
    accounts: RebalanceAccountTemplate[],
    snapshots: RebalanceSnapshot[]
  ): Promise<RebalancingImportReport> {
    const plan = planRebalancingImport(await this.getAccounts(), accounts, snapshots);
    for (const a of plan.accounts) await this.saveAccount(a);
    for (const s of plan.snapshots) await this.saveSnapshot(s);
    return {
      accountsImported: plan.accounts.length,
      snapshotsImported: plan.snapshots.length,
      skippedAccounts: plan.skippedAccounts,
    };
  }
}
