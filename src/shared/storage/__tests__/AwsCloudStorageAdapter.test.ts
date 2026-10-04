import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AwsCloudStorageAdapter } from '../AwsCloudStorageAdapter';
import { InMemoryStorageAdapter } from '../InMemoryStorageAdapter';
import { AuthService } from '../../auth/AuthService';

import { IndexedDbStorageAdapter } from '../IndexedDbStorageAdapter';

const createMockStorage = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
};

describe('AwsCloudStorageAdapter', () => {
  let adapter: AwsCloudStorageAdapter;
  let mockLocal: InMemoryStorageAdapter;

  beforeEach(() => {
    const mockStorage = createMockStorage();
    vi.stubGlobal('localStorage', mockStorage);
    vi.stubGlobal('window', {
      localStorage: mockStorage,
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal('navigator', {
      onLine: true,
    });
    AuthService.signOut();
    vi.restoreAllMocks();
    mockLocal = new InMemoryStorageAdapter();
    adapter = new AwsCloudStorageAdapter(mockLocal as unknown as IndexedDbStorageAdapter);
  });

  it('saves and retrieves expenses locally', async () => {
    const expense = await adapter.saveExpense({
      date: '2026-09-25',
      amount: 45.5,
      categoryId: 'cat_groceries',
      categoryName: 'Living - Groceries',
      enteredBy: 'Mike',
    });

    expect(expense.expenseId).toBeDefined();
    expect(expense.syncStatus).toBe('PENDING_SYNC');

    const expenses = await adapter.getExpenses(2026, 9);
    expect(expenses.length).toBe(1);
    expect(expenses[0].amount).toBe(45.5);
  });

  it('saves and retrieves categories', async () => {
    const category = await adapter.saveCategory({
      id: 'cat_coffee',
      name: 'Living - Coffee',
      plannedMonthlyDefault: 50,
    });

    expect(category.id).toBe('cat_coffee');
    const allCats = await adapter.getCategories();
    expect(allCats.some(c => c.id === 'cat_coffee')).toBe(true);
  });

  it('flushes pending expenses when authenticated', async () => {
    // Save expense while unauthenticated
    await adapter.saveExpense({
      date: '2026-09-25',
      amount: 100,
      categoryId: 'cat_dining',
      categoryName: 'Leisure - Dining',
      enteredBy: 'Mike',
    });

    const pendingBefore = await adapter.getPendingSyncExpenses();
    expect(pendingBefore.length).toBe(1);

    // Authenticate
    vi.spyOn(AuthService, 'isAuthenticated').mockReturnValue(true);
    vi.spyOn(AuthService, 'getIdToken').mockResolvedValue('mock_token');

    // Mock API Gateway batch response
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success', count: 1 }),
    } as unknown as Response);

    const result = await adapter.flushPendingExpenses();
    expect(result.syncedCount).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const pendingAfter = await adapter.getPendingSyncExpenses();
    expect(pendingAfter.length).toBe(0);
  });

  it('updates an existing expense and flushes updates to cloud', async () => {
    const saved = await adapter.saveExpense({
      date: '2026-09-10',
      amount: 50,
      categoryId: 'cat_groceries',
      categoryName: 'Groceries',
      enteredBy: 'Mike',
    });

    vi.spyOn(AuthService, 'isAuthenticated').mockReturnValue(true);
    vi.spyOn(AuthService, 'getIdToken').mockResolvedValue('mock_token');
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success' }),
    } as unknown as Response);

    const updated = await adapter.updateExpense(saved.expenseId, {
      amount: 75.25,
      notes: 'Weekly groceries at Trader Joes',
    });

    expect(updated.amount).toBe(75.25);
    expect(updated.notes).toBe('Weekly groceries at Trader Joes');
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('deletes old remote item if date month/year changed during update', async () => {
    const saved = await adapter.saveExpense({
      date: '2026-08-25',
      amount: 30,
      categoryId: 'cat_fuel',
      categoryName: 'Fuel',
      enteredBy: 'Mike',
    });

    vi.spyOn(AuthService, 'isAuthenticated').mockReturnValue(true);
    vi.spyOn(AuthService, 'getIdToken').mockResolvedValue('mock_token');
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success' }),
    } as unknown as Response);

    await adapter.updateExpense(saved.expenseId, {
      date: '2026-09-02',
    });

    // First fetch should be DELETE /api/expenses/{id}
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining(`/api/expenses/${encodeURIComponent(saved.expenseId)}`),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});
