import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  savePlannerExpenseLineItem,
  syncCustomCategoriesToPlanner,
  getPlannerExpenseCatalog,
  syncPlannerCatalogToCloudStorage,
} from './plannerCategories';
import { DEFAULT_DETAILED_EXPENSES_STATE } from '../../types';
import type { StorageAdapter } from '../storage';

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

describe('plannerCategories synchronization', () => {
  let mockStorage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    mockStorage = createMockStorage();
    const MockCustomEvent = class CustomEvent {
      detail: unknown;
      constructor(...args: unknown[]) {
        this.detail = (args[1] as { detail?: unknown } | undefined)?.detail;
      }
    };
    const MockEvent = class Event {
      constructor() {}
    };

    vi.stubGlobal('localStorage', mockStorage);
    vi.stubGlobal('CustomEvent', MockCustomEvent);
    vi.stubGlobal('Event', MockEvent);
    vi.stubGlobal('window', {
      localStorage: mockStorage,
      dispatchEvent: vi.fn(),
      CustomEvent: MockCustomEvent,
      Event: MockEvent,
    });

    const initial = {
      detailedExpenses: JSON.parse(JSON.stringify(DEFAULT_DETAILED_EXPENSES_STATE)),
    };
    mockStorage.setItem('retirement_planner_inputs', JSON.stringify(initial));
  });

  it('should register a newly added category and line item (e.g. Housewares under Home) into detailedExpenses catalog', () => {
    const item = savePlannerExpenseLineItem({
      name: 'Housewares',
      groupCategory: 'Home',
      plannedMonthlyDefault: 150,
    });

    expect(item).toBeDefined();
    expect(item?.name).toBe('Housewares');
    expect(item?.groupCategory).toBe('Home');

    const updatedRaw = mockStorage.getItem('retirement_planner_inputs');
    expect(updatedRaw).toBeDefined();
    const parsed = JSON.parse(updatedRaw!);

    expect(parsed.detailedExpenses.catalog.categories).toContain('Home');
    const catalogItem = parsed.detailedExpenses.catalog.items.find((i: { name: string; category: string }) => i.name === 'Housewares' && i.category === 'Home');
    expect(catalogItem).toBeDefined();
    expect(parsed.detailedExpenses.costs.MD[catalogItem.id]).toBe(150);
  });

  it('should sync custom categories array from storage adapter into planner detailed expenses', () => {
    const categories = [
      {
        id: 'cat_home_housewares',
        name: 'Home - Housewares',
        plannedMonthlyDefault: 120,
        isCustom: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'cat_living_gardening',
        name: 'Living - Gardening',
        plannedMonthlyDefault: 50,
        isCustom: true,
        createdAt: new Date().toISOString(),
      },
    ];

    syncCustomCategoriesToPlanner(categories);

    const updatedRaw = mockStorage.getItem('retirement_planner_inputs');
    const parsed = JSON.parse(updatedRaw!);

    expect(parsed.detailedExpenses.catalog.categories).toContain('Home');
    expect(parsed.detailedExpenses.catalog.items.some((i: { name: string }) => i.name === 'Housewares')).toBe(true);
    expect(parsed.detailedExpenses.catalog.items.some((i: { name: string }) => i.name === 'Gardening')).toBe(true);
  });

  it('should include standard healthcare OOP and Premiums line items in getPlannerExpenseCatalog', () => {
    const catalog = getPlannerExpenseCatalog('MD');
    expect(catalog.some(i => i.id === 'healthcare-oop')).toBe(true);
    expect(catalog.some(i => i.id === 'healthcare-premiums')).toBe(true);
  });

  it('should delete removed line items from storage adapter during cloud catalog sync', async () => {
    const mockCategories = [
      { id: 'item_keep', name: 'Living - Food', plannedMonthlyDefault: 500, isCustom: false },
      { id: 'item_deleted', name: 'Living - Obsolete', plannedMonthlyDefault: 100, isCustom: false },
      { id: '__household_profiles__', name: 'PROFILES::{}', plannedMonthlyDefault: 0, isCustom: false },
      { id: 'healthcare-oop', name: 'Healthcare - OOP', plannedMonthlyDefault: 200, isCustom: false },
    ];
    const deletedIds: string[] = [];
    const mockAdapter = {
      getCategories: vi.fn().mockResolvedValue(mockCategories),
      saveCategory: vi.fn().mockResolvedValue(undefined),
      deleteCategory: vi.fn().mockImplementation((id: string) => {
        deletedIds.push(id);
        return Promise.resolve();
      }),
    };

    const detailedExpenses = {
      ...DEFAULT_DETAILED_EXPENSES_STATE,
      catalog: {
        categories: ['Living'],
        items: [
          { id: 'item_keep', name: 'Food', category: 'Living', defaultFrequency: 12 },
        ],
      },
    };

    await syncPlannerCatalogToCloudStorage(detailedExpenses, mockAdapter as unknown as StorageAdapter);

    expect(deletedIds).toContain('item_deleted');
    expect(deletedIds).not.toContain('item_keep');
    expect(deletedIds).not.toContain('__household_profiles__');
    expect(deletedIds).not.toContain('healthcare-oop');
  });
});
