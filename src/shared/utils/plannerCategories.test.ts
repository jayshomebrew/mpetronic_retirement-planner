import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  savePlannerExpenseLineItem,
  syncCustomCategoriesToPlanner,
  getPlannerExpenseCatalog,
  getPlannerCategories,
  syncPlannerCatalogToCloudStorage,
  mergeWithCustomCategories,
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

  it('should not purge an item the live plan has when a stale plan lacks it, and keeps the custom flag', async () => {
    const liveItem = { id: 'item_new', name: 'Hobbies', category: 'Leisure', defaultFrequency: 12 };
    const livePlan = {
      ...DEFAULT_DETAILED_EXPENSES_STATE,
      catalog: { categories: ['Leisure'], items: [liveItem] },
    };
    mockStorage.setItem('retirement_planner_inputs', JSON.stringify({ detailedExpenses: livePlan }));

    const stalePlan = {
      ...DEFAULT_DETAILED_EXPENSES_STATE,
      catalog: { categories: ['Leisure'], items: [{ id: 'item_old', name: 'Golf', category: 'Leisure', defaultFrequency: 12 }] },
    };
    const deletedIds: string[] = [];
    const mockAdapter = {
      getCategories: vi.fn().mockResolvedValue([
        { id: 'item_new', name: 'Leisure - Hobbies', plannedMonthlyDefault: 0, isCustom: false },
        { id: 'item_old', name: 'Leisure - Golf', plannedMonthlyDefault: 0, isCustom: true },
      ]),
      saveCategory: vi.fn().mockResolvedValue(undefined),
      deleteCategory: vi.fn().mockImplementation((id: string) => {
        deletedIds.push(id);
        return Promise.resolve();
      }),
    };

    await syncPlannerCatalogToCloudStorage(stalePlan, mockAdapter as unknown as StorageAdapter);

    expect(deletedIds).not.toContain('item_new');
    const golfSave = mockAdapter.saveCategory.mock.calls.find(([c]) => c.id === 'item_old');
    expect(golfSave?.[0].isCustom).toBe(true);
  });

  it('should exclude state-inapplicable items and deleted categories from getPlannerExpenseCatalog', () => {
    const detailedExpenses = {
      ...DEFAULT_DETAILED_EXPENSES_STATE,
      catalog: {
        categories: ['Home', 'Living'],
        items: [
          { id: 'md_mortgage', name: 'MD Mortgage', category: 'Home', defaultFrequency: 12, applicableStates: ['MD'] },
          { id: 'fl_condo', name: 'FL Condo Fee', category: 'Housing', defaultFrequency: 12, applicableStates: ['FL'] },
        ],
      },
      costs: {
        MD: { md_mortgage: 2000 },
        FL: { fl_condo: 800 },
      },
    };
    mockStorage.setItem('retirement_planner_inputs', JSON.stringify({ detailedExpenses, jurisdiction: { currentState: 'MD' } }));

    const itemsMD = getPlannerExpenseCatalog('MD');
    expect(itemsMD.some(i => i.id === 'md_mortgage')).toBe(true);
    // fl_condo is for FL, so must not appear when querying MD
    expect(itemsMD.some(i => i.id === 'fl_condo')).toBe(false);
    // Housing is not in catalog.categories, so must not appear
    expect(itemsMD.some(i => i.groupCategory === 'Housing')).toBe(false);
  });

  it('should strictly prevent mergeWithCustomCategories from leaking obsolete or non-custom categories', () => {
    const plannerItems = [
      { id: 'md_mortgage', groupCategory: 'Home', name: 'Mortgage', displayName: 'Home - Mortgage', plannedMonthlyDefault: 2000, isCustom: false },
    ];
    const storageCats = [
      // Standard item excluded for other state (isCustom: false) - MUST NOT BE MERGED
      { id: 'fl_tax', name: 'Housing - FL Tax', plannedMonthlyDefault: 400, isCustom: false, createdAt: '' },
      // Custom category with invalid group not in allowedCategories - MUST NOT BE MERGED
      { id: 'item_custom_old', name: 'Housing - Old Item', plannedMonthlyDefault: 50, isCustom: true, createdAt: '' },
      // Valid custom category with group Home - SHOULD BE MERGED
      { id: 'item_custom_new', name: 'Home - Pool Maintenance', plannedMonthlyDefault: 100, isCustom: true, createdAt: '' },
    ];

    const merged = mergeWithCustomCategories(plannerItems, storageCats, ['Home', 'Living']);
    expect(merged.some(i => i.id === 'md_mortgage')).toBe(true);
    expect(merged.some(i => i.id === 'fl_tax')).toBe(false);
    expect(merged.some(i => i.id === 'item_custom_old')).toBe(false);
    expect(merged.some(i => i.id === 'item_custom_new')).toBe(true);
    expect(merged.some(i => i.groupCategory === 'Housing')).toBe(false);
  });

  it('should return exactly whatever categories are defined in detailedExpenses', () => {
    const detailedExpenses = {
      ...DEFAULT_DETAILED_EXPENSES_STATE,
      catalog: {
        categories: ['My Place Stuff', 'Vehicles', 'Living'],
        items: [],
      },
    };
    mockStorage.setItem('retirement_planner_inputs', JSON.stringify({ detailedExpenses }));

    const categories = getPlannerCategories();
    expect(categories).toEqual(['My Place Stuff', 'Vehicles', 'Living']);
  });

  it('should only return line items belonging to defined categories and valid for the active state', () => {
    const detailedExpenses = {
      ...DEFAULT_DETAILED_EXPENSES_STATE,
      catalog: {
        categories: ['My Place Stuff', 'Living'],
        items: [
          { id: 'item_valid_1', name: 'Apartment Rent', category: 'My Place Stuff', defaultFrequency: 12, applicableStates: ['ALL'] },
          { id: 'item_valid_md', name: 'MD Condo Dues', category: 'My Place Stuff', defaultFrequency: 12, applicableStates: ['MD'] },
          { id: 'item_other_state', name: 'FL Pool Fee', category: 'My Place Stuff', defaultFrequency: 12, applicableStates: ['FL'] },
          { id: 'item_deleted_category', name: 'Old Boat Fuel', category: 'Boating', defaultFrequency: 12, applicableStates: ['ALL'] },
        ],
      },
      costs: {
        MD: { item_valid_1: 1500, item_valid_md: 300 },
        FL: { item_other_state: 200 },
      },
    };
    mockStorage.setItem('retirement_planner_inputs', JSON.stringify({ detailedExpenses, jurisdiction: { currentState: 'MD' } }));

    const catalog = getPlannerExpenseCatalog('MD');
    // Active state items in defined categories should be present
    expect(catalog.some(i => i.id === 'item_valid_1')).toBe(true);
    expect(catalog.some(i => i.id === 'item_valid_md')).toBe(true);

    // Other-state item must not be present
    expect(catalog.some(i => i.id === 'item_other_state')).toBe(false);

    // Item belonging to undefined/deleted category 'Boating' must not be present
    expect(catalog.some(i => i.id === 'item_deleted_category')).toBe(false);
  });
});
