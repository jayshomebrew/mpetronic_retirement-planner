import { ExpenseCategory, StorageAdapter } from '../types/expenses';
import { normalizeDetailedExpenses, ExpenseItemDefinition, DetailedExpensesState } from '../../types';

export interface PlannerExpenseLineItem {
  id: string;
  groupCategory: string;
  name: string;
  displayName: string;
  plannedMonthlyDefault: number;
  color?: string;
  icon?: string;
  isCustom?: boolean;
}

const GROUP_COLORS: Record<string, string> = {
  Living: '#10b981', // emerald
  Housing: '#f59e0b', // amber
  Transportation: '#3b82f6', // blue
  Insurance: '#06b6d4', // cyan
  Healthcare: '#ef4444', // red
  Leisure: '#ec4899', // pink
  Charities: '#14b8a6', // teal
  Other: '#8b5cf6', // purple
};

export function getPlannerExpenseCatalog(activeState?: string): PlannerExpenseLineItem[] {
  const lineItems: PlannerExpenseLineItem[] = [];
  const seenIds = new Set<string>();

  // 1. Attempt to read detailedExpenses from planner localStorage
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem('retirement_planner_inputs');
      if (raw) {
        const parsed = JSON.parse(raw);
        const detailed = normalizeDetailedExpenses(parsed.detailedExpenses);
        const currentResState = activeState || parsed.jurisdiction?.currentState || 'MD';

        if (detailed && detailed.catalog && Array.isArray(detailed.catalog.items) && detailed.catalog.items.length > 0) {
          const stateCosts = detailed.costs?.[currentResState] || {};
          const allCosts = detailed.costs?.['ALL'] || {};
          const costsMD = detailed.costs?.MD || detailed.MD || {};
          const costsFL = detailed.costs?.FL || detailed.FL || {};
          const frequencies = detailed.frequencies || {};

          for (const item of detailed.catalog.items) {
            // Check state applicability if activeState is specified or derived
            const applies = !item.applicableStates || 
              item.applicableStates.includes('ALL') || 
              item.applicableStates.includes(currentResState);
            
            if (!applies) continue;

            const group = item.category || 'Living';
            const cost = stateCosts[item.id] ?? allCosts[item.id] ?? costsMD[item.id] ?? costsFL[item.id] ?? 0;
            const freq = frequencies[item.id] ?? item.defaultFrequency ?? 12;
            const monthlyCost = freq > 0 ? (cost * freq) / 12 : cost;

            const displayName = `${group} - ${item.name}`;
            lineItems.push({
              id: item.id,
              groupCategory: group,
              name: item.name,
              displayName,
              plannedMonthlyDefault: Math.round(monthlyCost),
              color: GROUP_COLORS[group] || '#6366f1',
              icon: 'Tag',
              isCustom: false,
            });
            seenIds.add(item.id);
          }
        }
      }
    } catch (err) {
      console.error('Failed to read planner detailed expenses from localStorage:', err);
    }
  }

  return lineItems;
}

export function savePlannerExpenseLineItem(item: {
  id?: string;
  name: string;
  groupCategory: string;
  plannedMonthlyDefault?: number;
  applicableStates?: string[];
}): PlannerExpenseLineItem | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('retirement_planner_inputs');
    const parsed = raw ? JSON.parse(raw) : {};
    const norm = normalizeDetailedExpenses(parsed.detailedExpenses);

    const group = (item.groupCategory || 'Living').trim();
    const name = item.name.trim();
    if (!name) return null;

    // Check if category group exists in catalog.categories
    if (!norm.catalog.categories.includes(group)) {
      norm.catalog.categories.push(group);
    }

    // Check if item exists in catalog.items
    let existing = norm.catalog.items.find(
      i => i.name.trim().toLowerCase() === name.toLowerCase() && i.category.trim().toLowerCase() === group.toLowerCase()
    );

    const itemId = existing?.id || item.id || `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const monthlyCost = Number(item.plannedMonthlyDefault) || 0;

    if (!existing) {
      const newItem: ExpenseItemDefinition = {
        id: itemId,
        name,
        category: group,
        defaultFrequency: 12,
        isOneTime: false,
        targetYear: null,
        applicableStates: item.applicableStates || ['ALL'],
      };
      norm.catalog.items.push(newItem);
      existing = newItem;
    } else if (item.applicableStates) {
      existing.applicableStates = item.applicableStates;
    }

    // Set frequencies and costs
    norm.frequencies[itemId] = 12;
    norm.costs = norm.costs || {};
    norm.costs.ALL = norm.costs.ALL || {};
    norm.costs.MD = norm.costs.MD || {};
    norm.costs.FL = norm.costs.FL || {};
    norm.costs.ALL[itemId] = monthlyCost;
    norm.costs.MD[itemId] = monthlyCost;
    norm.costs.FL[itemId] = monthlyCost;
    norm.MD = norm.costs.MD;
    norm.FL = norm.costs.FL;

    parsed.detailedExpenses = norm;
    window.localStorage.setItem('retirement_planner_inputs', JSON.stringify(parsed));

    // Dispatch custom and storage event for live UI reactivity across tabs
    window.dispatchEvent(new Event('storage'));
    window.dispatchEvent(new CustomEvent('retirement_planner_inputs_updated', { detail: parsed }));

    const displayName = `${group} - ${name}`;
    return {
      id: itemId,
      groupCategory: group,
      name,
      displayName,
      plannedMonthlyDefault: monthlyCost,
      color: GROUP_COLORS[group] || '#6366f1',
      icon: 'Tag',
      isCustom: false,
    };
  } catch (err) {
    console.error('Failed to save line item to planner inputs:', err);
    return null;
  }
}

export function syncCustomCategoriesToPlanner(customCategories: ExpenseCategory[]): void {
  if (typeof window === 'undefined' || !customCategories || customCategories.length === 0) return;
  for (const cat of customCategories) {
    if (!cat.isCustom) continue;
    const parts = cat.name.includes(' - ') ? cat.name.split(' - ') : ['Custom', cat.name];
    const group = parts[0].trim();
    const name = parts[1] ? parts[1].trim() : cat.name.trim();
    savePlannerExpenseLineItem({
      id: cat.id,
      name,
      groupCategory: group,
      plannedMonthlyDefault: cat.plannedMonthlyDefault || 0,
    });
  }
}

export function mergeWithCustomCategories(
  plannerItems: PlannerExpenseLineItem[],
  customCategories: ExpenseCategory[]
): PlannerExpenseLineItem[] {
  const result = [...plannerItems];
  const seenIds = new Set(plannerItems.map(p => p.id));
  const seenDisplayNames = new Set(plannerItems.map(p => p.displayName.toLowerCase()));
  const seenNames = new Set(plannerItems.map(p => p.name.toLowerCase()));

  for (const cat of customCategories) {
    // Intercept internal household profile configuration category
    if (cat.id === '__household_profiles__') {
      try {
        if (cat.name && cat.name.startsWith('PROFILES::')) {
          const raw = cat.name.replace('PROFILES::', '');
          if (typeof window !== 'undefined') {
            window.localStorage.setItem('retirement_planner_profile_names', raw);
          }
        }
      } catch {
        // ignore
      }
      continue;
    }

    if (seenIds.has(cat.id)) continue;

    const parts = cat.name.includes(' - ') ? cat.name.split(' - ') : ['Living', cat.name];
    const groupCategory = parts[0].trim();
    const name = parts[1] ? parts[1].trim() : cat.name.trim();
    const displayName = cat.name.includes(' - ') ? cat.name : `${groupCategory} - ${name}`;

    if (seenDisplayNames.has(displayName.toLowerCase()) || seenNames.has(name.toLowerCase())) {
      continue;
    }

    result.push({
      id: cat.id,
      groupCategory,
      name,
      displayName,
      plannedMonthlyDefault: cat.plannedMonthlyDefault || 0,
      color: cat.color || GROUP_COLORS[groupCategory] || '#8b5cf6',
      icon: cat.icon || 'Tag',
      isCustom: Boolean(cat.isCustom),
    });
    seenIds.add(cat.id);
    seenDisplayNames.add(displayName.toLowerCase());
  }

  return result;
}

export async function syncPlannerCatalogToCloudStorage(
  detailedExpenses: DetailedExpensesState | null | undefined,
  adapter: StorageAdapter,
  profileNames?: { primaryName: string; spouseName: string; isSingleFiler: boolean },
  activeState?: string
): Promise<void> {
  // Sync profiles if provided
  if (profileNames) {
    try {
      await adapter.saveCategory({
        id: '__household_profiles__',
        name: `PROFILES::${JSON.stringify(profileNames)}`,
        plannedMonthlyDefault: 0,
        color: '#6366f1',
        icon: 'Users',
        isCustom: false,
      });
    } catch (err) {
      console.warn('Failed to sync household profiles to cloud:', err);
    }
  }

  if (!detailedExpenses || !detailedExpenses.catalog || !Array.isArray(detailedExpenses.catalog.items)) {
    return;
  }
  const norm = normalizeDetailedExpenses(detailedExpenses);
  const state = activeState || 'MD';
  const stateCosts = norm.costs?.[state] || {};
  const allCosts = norm.costs?.['ALL'] || {};
  const costsMD = norm.costs?.MD || norm.MD || {};
  const costsFL = norm.costs?.FL || norm.FL || {};
  const frequencies = norm.frequencies || {};

  for (const item of norm.catalog.items) {
    const group = item.category || 'Living';
    const cost = stateCosts[item.id] ?? allCosts[item.id] ?? costsMD[item.id] ?? costsFL[item.id] ?? 0;
    const freq = frequencies[item.id] ?? item.defaultFrequency ?? 12;
    const monthlyCost = freq > 0 ? (cost * freq) / 12 : cost;
    const displayName = `${group} - ${item.name}`;

    try {
      await adapter.saveCategory({
        id: item.id,
        name: displayName,
        plannedMonthlyDefault: Math.round(monthlyCost),
        color: GROUP_COLORS[group] || '#6366f1',
        icon: 'Tag',
        isCustom: false,
      });
    } catch (err) {
      console.warn(`Failed to sync category ${item.name} to cloud:`, err);
    }
  }
}
