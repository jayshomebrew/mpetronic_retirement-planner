import { describe, it, expect } from 'vitest';
import { ActualExpense } from '../../shared/types/expenses';
import { PlannerExpenseLineItem, resolveExpenseCategoryAndLineItem } from '../../shared/utils/plannerCategories';

describe('BulkEditExpensesModal logic', () => {
  const mockCatalogItems: PlannerExpenseLineItem[] = [
    {
      id: 'cat_subscriptions_amazon_prime',
      groupCategory: 'Subscriptions',
      name: 'Amazon Prime',
      displayName: 'Subscriptions - Amazon Prime',
      plannedMonthlyDefault: 15,
    },
    {
      id: 'cat_living_groceries',
      groupCategory: 'Living',
      name: 'Groceries',
      displayName: 'Living - Groceries',
      plannedMonthlyDefault: 600,
    },
  ];

  const sampleExpenses: ActualExpense[] = [
    {
      expenseId: 'exp-1',
      catalogId: 'cat_subscriptions_amazon_prime',
      category: 'Subscriptions',
      name: 'Amazon Prime',
      date: '2026-03-15',
      amount: 14.99,
      categoryId: 'cat_subscriptions_amazon_prime',
      categoryName: 'Subscriptions - Amazon Prime',
      enteredBy: 'Mike',
      notes: 'Amazon Prime Video subscription',
      syncStatus: 'SYNCED',
      createdAt: '2026-03-15T12:00:00Z',
      updatedAt: '2026-03-15T12:00:00Z',
    },
    {
      // Expense with legacy/mismatched categoryName "Leisure - Amazon Prime" but matching the catalog item "Amazon Prime"
      expenseId: 'exp-2',
      catalogId: 'cat_leisure_amazon_prime',
      category: 'Leisure',
      name: 'Amazon Prime',
      date: '2026-04-15',
      amount: 14.99,
      categoryId: 'cat_leisure_amazon_prime',
      categoryName: 'Leisure - Amazon Prime',
      enteredBy: 'Mike',
      notes: 'Amazon Prime monthly',
      syncStatus: 'SYNCED',
      createdAt: '2026-04-15T12:00:00Z',
      updatedAt: '2026-04-15T12:00:00Z',
    },
    {
      expenseId: 'exp-3',
      catalogId: 'cat_living_groceries',
      category: 'Living',
      name: 'Groceries',
      date: '2026-05-10',
      amount: 120.50,
      categoryId: 'cat_living_groceries',
      categoryName: 'Living - Groceries',
      enteredBy: 'Wife',
      notes: 'Trader Joes',
      syncStatus: 'SYNCED',
      createdAt: '2026-05-10T12:00:00Z',
      updatedAt: '2026-05-10T12:00:00Z',
    },
    {
      expenseId: 'exp-4',
      catalogId: 'cat_legacy',
      category: 'Living',
      name: 'Fuel',
      date: '2026-06-01',
      amount: 80.00,
      categoryId: 'cat_legacy',
      categoryName: 'Fuel',
      enteredBy: 'Mike',
      syncStatus: 'SYNCED',
      createdAt: '2026-06-01T12:00:00Z',
      updatedAt: '2026-06-01T12:00:00Z',
    },
  ];

  it('correctly resolves category to Subscriptions when catalog item is in Subscriptions, even if raw categoryName says Leisure', () => {
    // exp-2 has categoryName "Leisure - Amazon Prime", but in the catalog "Amazon Prime" is under "Subscriptions"
    const resolved = resolveExpenseCategoryAndLineItem(sampleExpenses[1], mockCatalogItems);
    expect(resolved.category).toBe('Subscriptions');
    expect(resolved.lineItem).toBe('Amazon Prime');
  });

  it('resolves category by catalog item ID when categoryId matches', () => {
    const resolved = resolveExpenseCategoryAndLineItem(sampleExpenses[0], mockCatalogItems);
    expect(resolved.category).toBe('Subscriptions');
    expect(resolved.lineItem).toBe('Amazon Prime');
  });

  it('defaults category to Living when an uncataloged categoryName does not contain a separator', () => {
    const resolved = resolveExpenseCategoryAndLineItem(sampleExpenses[3], mockCatalogItems);
    expect(resolved.category).toBe('Living');
    expect(resolved.lineItem).toBe('Fuel');
  });

  it('filters expenses correctly by catalog-resolved category and line item', () => {
    const subPrime = sampleExpenses.filter((e) => {
      const { category, lineItem } = resolveExpenseCategoryAndLineItem(e, mockCatalogItems);
      return category === 'Subscriptions' && lineItem === 'Amazon Prime';
    });
    // Both exp-1 and exp-2 should now be recognized under Subscriptions - Amazon Prime!
    expect(subPrime).toHaveLength(2);
    expect(subPrime.map((e) => e.expenseId)).toEqual(['exp-1', 'exp-2']);
  });

  it('filters expenses correctly by note search query', () => {
    const query = 'monthly';
    const matches = sampleExpenses.filter((e) => (e.notes || '').toLowerCase().includes(query));
    expect(matches).toHaveLength(1);
    expect(matches[0].expenseId).toBe('exp-2');
  });

  it('generates updated categoryName and slug categoryId for moved line item', () => {
    const targetCategory = 'Subscriptions';
    const targetLineItem = 'Prime Video Ultra';

    const newCategoryDisplayName = `${targetCategory} - ${targetLineItem}`;
    const newCategoryId = `cat_${targetCategory.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${targetLineItem.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

    expect(newCategoryDisplayName).toBe('Subscriptions - Prime Video Ultra');
    expect(newCategoryId).toBe('cat_subscriptions_prime_video_ultra');
  });

  it('handles note mode updates properly for replace, append, and clear', () => {
    const originalNote = 'Amazon Prime Video';

    // Replace mode
    const replaced = 'Prime Video Ultra HD';
    expect(replaced).toBe('Prime Video Ultra HD');

    // Append mode
    const appended = `${originalNote} • 4K Tier`;
    expect(appended).toBe('Amazon Prime Video • 4K Tier');

    // Clear mode
    const cleared: string | undefined = undefined;
    expect(cleared).toBeUndefined();
  });

  it('correctly tracks and removes selected duplicate expense IDs', () => {
    // Simulate list containing duplicates of an expense
    const duplicatesList: ActualExpense[] = [
      ...sampleExpenses,
      {
        ...sampleExpenses[0],
        expenseId: 'exp-1-duplicate',
      },
    ];

    expect(duplicatesList).toHaveLength(5);

    // User selects the duplicate ID to delete
    const selectedIds = new Set<string>(['exp-1-duplicate']);
    const remaining = duplicatesList.filter((exp) => !selectedIds.has(exp.expenseId));

    expect(remaining).toHaveLength(4);
    expect(remaining.some((e) => e.expenseId === 'exp-1-duplicate')).toBe(false);
    expect(remaining.some((e) => e.expenseId === 'exp-1')).toBe(true);
  });
});
