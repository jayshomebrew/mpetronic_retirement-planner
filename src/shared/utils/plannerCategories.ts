import { ExpenseCategory, StorageAdapter, ActualExpense } from '../types/expenses';
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
  Home: '#f59e0b', // amber
  Transportation: '#3b82f6', // blue
  Insurance: '#06b6d4', // cyan
  Healthcare: '#ef4444', // red
  Leisure: '#ec4899', // pink
  Charities: '#14b8a6', // teal
  Other: '#8b5cf6', // purple
};

export function getPlannerCategories(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem('retirement_planner_inputs');
    if (raw) {
      const parsed = JSON.parse(raw);
      const detailed = normalizeDetailedExpenses(parsed.detailedExpenses);
      if (detailed && detailed.catalog && Array.isArray(detailed.catalog.categories)) {
        return detailed.catalog.categories;
      }
    }
  } catch (err) {
    console.error('Failed to read planner categories from localStorage:', err);
  }
  return [];
}

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
        const currentYear = new Date().getFullYear();
        const relocYear = parsed.jurisdiction?.relocationYear;
        const currentResState = activeState ||
          (relocYear !== null && relocYear !== undefined && currentYear >= Number(relocYear)
            ? (parsed.jurisdiction?.targetState || parsed.jurisdiction?.currentState || 'MD')
            : (parsed.jurisdiction?.currentState || 'MD'));

        if (detailed && detailed.catalog && Array.isArray(detailed.catalog.items) && detailed.catalog.items.length > 0) {
          const allowedCategoriesSet = new Set(
            (detailed.catalog.categories || []).map(c => c.trim().toLowerCase())
          );

          // Strictly filter to items whose category is defined in detailedExpenses.catalog.categories
          const filteredCatalogItems: ExpenseItemDefinition[] = [];
          let modified = false;

          for (const item of detailed.catalog.items) {
            const itemCatLower = (item.category || '').trim().toLowerCase();

            // If an item's category is not in the defined categories list, it is not a valid defined expense
            if (allowedCategoriesSet.size > 0 && !allowedCategoriesSet.has(itemCatLower)) {
              modified = true;
              continue;
            }

            filteredCatalogItems.push(item);
          }

          if (modified) {
            detailed.catalog.items = filteredCatalogItems;
            parsed.detailedExpenses = detailed;
            try {
              window.localStorage.setItem('retirement_planner_inputs', JSON.stringify(parsed));
            } catch {
              // ignore
            }
          }

          const stateCosts = detailed.costs?.[currentResState] || {};
          const allCosts = detailed.costs?.['ALL'] || {};
          const costsMD = detailed.costs?.MD || detailed.MD || {};
          const costsFL = detailed.costs?.FL || detailed.FL || {};
          const frequencies = detailed.frequencies || {};

          for (const item of filteredCatalogItems) {
            // Strictly check state applicability: ONLY items valid for the active state are included
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

  // Ensure standard Healthcare items are available in catalog
  if (!seenIds.has('healthcare-oop')) {
    lineItems.push({
      id: 'healthcare-oop',
      groupCategory: 'Healthcare',
      name: 'Healthcare Out-of-Pocket Co-pays & Deductibles',
      displayName: 'Healthcare - Out-of-Pocket Co-pays & Deductibles',
      plannedMonthlyDefault: 500,
      color: GROUP_COLORS['Healthcare'] || '#ef4444',
      icon: 'Tag',
      isCustom: false,
    });
    seenIds.add('healthcare-oop');
  }
  if (!seenIds.has('healthcare-premiums')) {
    lineItems.push({
      id: 'healthcare-premiums',
      groupCategory: 'Healthcare',
      name: 'Healthcare Insurance Premiums',
      displayName: 'Healthcare - Insurance Premiums',
      plannedMonthlyDefault: 0,
      color: GROUP_COLORS['Healthcare'] || '#ef4444',
      icon: 'Tag',
      isCustom: false,
    });
    seenIds.add('healthcare-premiums');
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
    const hasCategory = norm.catalog.categories.includes(group);
    if (!hasCategory) {
      norm.catalog.categories.push(group);
    }

    // Check if item exists in catalog.items
    let existing = norm.catalog.items.find(
      i => (item.id && i.id === item.id) || (i.name.trim().toLowerCase() === name.toLowerCase() && i.category.trim().toLowerCase() === group.toLowerCase())
    );

    const itemId = existing?.id || item.id || `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const monthlyCost = Number(item.plannedMonthlyDefault) || 0;

    if (existing && hasCategory) {
      // Already present in catalog, return without dispatching redundant storage events
      return {
        id: existing.id,
        groupCategory: existing.category,
        name: existing.name,
        displayName: `${existing.category} - ${existing.name}`,
        plannedMonthlyDefault: norm.costs?.MD?.[existing.id] ?? norm.costs?.ALL?.[existing.id] ?? monthlyCost,
        color: GROUP_COLORS[existing.category] || '#6366f1',
        icon: 'Tag',
        isCustom: false,
      };
    }

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

    // Set frequencies and costs without overwriting existing non-zero values
    norm.frequencies = norm.frequencies || {};
    if (norm.frequencies[itemId] === undefined) {
      norm.frequencies[itemId] = 12;
    }
    norm.costs = norm.costs || {};
    norm.costs.ALL = norm.costs.ALL || {};
    norm.costs.MD = norm.costs.MD || {};
    norm.costs.FL = norm.costs.FL || {};
    if (norm.costs.ALL[itemId] === undefined) norm.costs.ALL[itemId] = monthlyCost;
    if (norm.costs.MD[itemId] === undefined) norm.costs.MD[itemId] = monthlyCost;
    if (norm.costs.FL[itemId] === undefined) norm.costs.FL[itemId] = monthlyCost;
    norm.MD = norm.costs.MD;
    norm.FL = norm.costs.FL;

    parsed.detailedExpenses = norm;
    window.localStorage.setItem('retirement_planner_inputs', JSON.stringify(parsed));

    // Dispatch custom and storage event for live UI reactivity across tabs
    if (typeof Event !== 'undefined') {
      window.dispatchEvent(new Event('storage'));
    }
    if (typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('retirement_planner_inputs_updated', { detail: parsed }));
    } else if (typeof Event !== 'undefined') {
      window.dispatchEvent(new Event('retirement_planner_inputs_updated'));
    }

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

/**
 * Atomically registers a batch of line items into the planner catalog in a single memory pass
 * with a single localStorage write and no redundant reactive event spam during bulk imports.
 */
export function batchRegisterPlannerExpenseLineItems(
  items: Array<{ name: string; groupCategory: string; plannedMonthlyDefault?: number }>
): Map<string, PlannerExpenseLineItem> {
  const resultMap = new Map<string, PlannerExpenseLineItem>();
  if (typeof window === 'undefined' || items.length === 0) return resultMap;

  try {
    const raw = window.localStorage.getItem('retirement_planner_inputs');
    const parsed = raw ? JSON.parse(raw) : {};
    const norm = normalizeDetailedExpenses(parsed.detailedExpenses);
    let hasModifications = false;

    norm.frequencies = norm.frequencies || {};
    norm.costs = norm.costs || {};
    norm.costs.ALL = norm.costs.ALL || {};
    norm.costs.MD = norm.costs.MD || {};
    norm.costs.FL = norm.costs.FL || {};

    for (const item of items) {
      const group = (item.groupCategory || 'Living').trim();
      const name = item.name.trim();
      if (!name) continue;

      const mapKey = `${group.toLowerCase()}:::${name.toLowerCase()}`;

      // Check group category
      if (!norm.catalog.categories.includes(group)) {
        norm.catalog.categories.push(group);
        hasModifications = true;
      }

      // Check item
      let existing = norm.catalog.items.find(
        i => i.name.trim().toLowerCase() === name.toLowerCase() && i.category.trim().toLowerCase() === group.toLowerCase()
      );

      const itemId = existing?.id || `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const monthlyCost = Number(item.plannedMonthlyDefault) || 0;

      if (!existing) {
        const newItem: ExpenseItemDefinition = {
          id: itemId,
          name,
          category: group,
          defaultFrequency: 12,
          isOneTime: false,
          targetYear: null,
          applicableStates: ['ALL'],
        };
        norm.catalog.items.push(newItem);
        existing = newItem;
        hasModifications = true;
      }

      if (norm.frequencies[itemId] === undefined) {
        norm.frequencies[itemId] = 12;
        hasModifications = true;
      }
      if (norm.costs.ALL[itemId] === undefined) {
        norm.costs.ALL[itemId] = monthlyCost;
        hasModifications = true;
      }
      if (norm.costs.MD[itemId] === undefined) {
        norm.costs.MD[itemId] = monthlyCost;
        hasModifications = true;
      }
      if (norm.costs.FL[itemId] === undefined) {
        norm.costs.FL[itemId] = monthlyCost;
        hasModifications = true;
      }

      const displayName = `${group} - ${name}`;
      resultMap.set(mapKey, {
        id: itemId,
        groupCategory: group,
        name,
        displayName,
        plannedMonthlyDefault: norm.costs.MD[itemId] ?? norm.costs.ALL[itemId] ?? monthlyCost,
        color: GROUP_COLORS[group] || '#6366f1',
        icon: 'Tag',
        isCustom: false,
      });
    }

    if (hasModifications) {
      norm.MD = norm.costs.MD;
      norm.FL = norm.costs.FL;
      parsed.detailedExpenses = norm;
      window.localStorage.setItem('retirement_planner_inputs', JSON.stringify(parsed));
    }
  } catch (err) {
    console.error('Failed to batch register line items to planner inputs:', err);
  }

  return resultMap;
}

export function syncCustomCategoriesToPlanner(customCategories: ExpenseCategory[]): void {
  if (typeof window === 'undefined' || !customCategories || customCategories.length === 0) return;

  for (const cat of customCategories) {
    if (cat.id === '__household_profiles__') continue;
    if (cat.id === 'healthcare-oop' || cat.id === 'healthcare-premiums' || cat.id === 'healthcare-irmaa') continue;

    // Strict guard: ONLY sync items that are explicitly flagged as custom user-created categories
    if (!cat.isCustom) continue;

    const parts = cat.name.includes(' - ') ? cat.name.split(' - ') : ['Living', cat.name];
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
  customCategories: ExpenseCategory[],
  allowedCategories?: string[]
): PlannerExpenseLineItem[] {
  const result = [...plannerItems];
  const seenIds = new Set(plannerItems.map(p => p.id));
  const seenDisplayNames = new Set(plannerItems.map(p => p.displayName.toLowerCase()));
  const seenNames = new Set(plannerItems.map(p => p.name.toLowerCase()));

  const allowedSet = allowedCategories && allowedCategories.length > 0
    ? new Set(allowedCategories.map(c => c.trim().toLowerCase()))
    : null;

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

    // ONLY merge items that are genuinely custom categories created by the user in Expenser!
    // Standard catalog items that are NOT in plannerItems were excluded (e.g. for other states)
    // and must NOT be leaked back in!
    if (!cat.isCustom) {
      continue;
    }

    const parts = cat.name.includes(' - ') ? cat.name.split(' - ') : ['Living', cat.name];
    const groupCategory = parts[0].trim();
    const name = parts[1] ? parts[1].trim() : cat.name.trim();
    const displayName = cat.name.includes(' - ') ? cat.name : `${groupCategory} - ${name}`;

    const groupLower = groupCategory.toLowerCase();

    if (seenDisplayNames.has(displayName.toLowerCase()) || seenNames.has(name.toLowerCase())) {
      continue;
    }

    // If allowedCategories is provided, ensure groupCategory is valid in Detailed Expenses
    if (allowedSet && !allowedSet.has(groupLower)) {
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
      isCustom: true,
    });
    seenIds.add(cat.id);
    seenDisplayNames.add(displayName.toLowerCase());
  }

  return result;
}

function getLivePlannerItemIds(): Set<string> {
  const ids = new Set<string>();
  if (typeof window === 'undefined') return ids;
  try {
    const raw = window.localStorage.getItem('retirement_planner_inputs');
    if (raw) {
      const live = normalizeDetailedExpenses(JSON.parse(raw).detailedExpenses);
      live.catalog.items.forEach(i => ids.add(i.id));
    }
  } catch {
    // ignore
  }
  return ids;
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

  // Derive active residency state if not explicitly passed
  let effectiveState = activeState;
  if (!effectiveState && typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem('retirement_planner_inputs');
      if (raw) {
        const parsed = JSON.parse(raw);
        const currentYear = new Date().getFullYear();
        const relocYear = parsed.jurisdiction?.relocationYear;
        if (relocYear !== null && relocYear !== undefined && currentYear >= Number(relocYear)) {
          effectiveState = parsed.jurisdiction?.targetState || parsed.jurisdiction?.currentState || 'MD';
        } else {
          effectiveState = parsed.jurisdiction?.currentState || 'MD';
        }
      }
    } catch {
      // fallback
    }
  }
  const state = effectiveState || 'MD';

  const stateCosts = norm.costs?.[state] || {};
  const allCosts = norm.costs?.['ALL'] || {};
  const costsMD = norm.costs?.MD || norm.MD || {};
  const costsFL = norm.costs?.FL || norm.FL || {};
  const frequencies = norm.frequencies || {};

  const allowedCategoriesSet = new Set((norm.catalog.categories || []).map(c => c.trim().toLowerCase()));
  const validActiveItemIds = new Set<string>();

  // Keep the custom flag the item already has in storage; downgrading it would make a
  // user-created item look like an obsolete planner item to any other device's cleanup.
  let existingCustomIds = new Set<string>();
  try {
    existingCustomIds = new Set((await adapter.getCategories()).filter(c => c.isCustom).map(c => c.id));
  } catch {
    // treat as none custom
  }

  for (const item of norm.catalog.items) {
    // Check state applicability so only items valid for current residency are active
    const applies = !item.applicableStates || 
      item.applicableStates.includes('ALL') || 
      item.applicableStates.includes(state);
    
    if (!applies) continue;

    // Check that item's category is actually in catalog.categories
    const itemCatLower = (item.category || '').trim().toLowerCase();
    if (allowedCategoriesSet.size > 0 && !allowedCategoriesSet.has(itemCatLower)) continue;

    validActiveItemIds.add(item.id);

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
        isCustom: existingCustomIds.has(item.id),
      });
    } catch (err) {
      console.warn(`Failed to sync category ${item.name} to cloud:`, err);
    }
  }

  // Remove any obsolete, state-inapplicable, or purged categories from storage
  try {
    const existingStorageCats = await adapter.getCategories();
    // The plan passed in may be stale if another sync ran meanwhile, so never delete an item
    // that the live plan in localStorage still contains.
    const liveItemIds = getLivePlannerItemIds();
    for (const cat of existingStorageCats) {
      if (cat.id === '__household_profiles__') continue;
      if (cat.id === 'healthcare-oop' || cat.id === 'healthcare-premiums' || cat.id === 'healthcare-irmaa') continue;

      const parts = cat.name.includes(' - ') ? cat.name.split(' - ') : ['', cat.name];
      const group = parts[0].trim();
      const groupLower = group.toLowerCase();

      const isGroupValid = group ? allowedCategoriesSet.has(groupLower) : false;

      // Keep if it is an active valid line item for the current state,
      // or if it is a custom item whose group category still exists in detailedExpenses
      const shouldKeep = validActiveItemIds.has(cat.id) || liveItemIds.has(cat.id) || (Boolean(cat.isCustom) && isGroupValid);

      if (!shouldKeep && adapter.deleteCategory) {
        await adapter.deleteCategory(cat.id);
      }
    }
  } catch (err) {
    console.warn('Failed to clean up deleted categories in storage:', err);
  }
}

/**
 * Resolves the Category and Line Item of an ActualExpense by prioritizing the planner catalog.
 * If the expense maps to an item in the planner catalog (by ID or line item name), the catalog's
 * current category is returned, ensuring alignment with the budget variance worksheet.
 */
export function resolveExpenseCategoryAndLineItem(
  exp: ActualExpense,
  catalogItems: PlannerExpenseLineItem[] = []
): { category: string; lineItem: string } {
  const targetId = exp.catalogId || exp.categoryId;
  // 1. Try matching by catalog item ID
  if (targetId && catalogItems.length > 0) {
    const byId = catalogItems.find(
      (c) => c.id === targetId || c.id.toLowerCase() === targetId.toLowerCase()
    );
    if (byId) {
      return {
        category: byId.groupCategory,
        lineItem: byId.name,
      };
    }
  }

  // 2. Direct first-class attributes on exp
  if (exp.category && exp.name) {
    if (catalogItems.length > 0) {
      const byName = catalogItems.find(
        (c) => c.name.toLowerCase() === exp.name.toLowerCase()
      );
      if (byName) {
        return {
          category: byName.groupCategory,
          lineItem: byName.name,
        };
      }
    }
    return {
      category: exp.category,
      lineItem: exp.name,
    };
  }

  // Extract raw category and line item candidate from categoryName
  let rawCategory = exp.category || 'Living';
  let rawLineItem = exp.name || (exp.categoryName ? exp.categoryName.trim() : 'General');
  if (exp.categoryName && exp.categoryName.includes(' - ')) {
    const parts = exp.categoryName.split(' - ');
    rawCategory = parts[0].trim();
    rawLineItem = parts.slice(1).join(' - ').trim();
  }

  // 3. Try matching catalog item by line item name
  if (catalogItems.length > 0 && rawLineItem) {
    const byName = catalogItems.find(
      (c) => c.name.toLowerCase() === rawLineItem.toLowerCase()
    );
    if (byName) {
      return {
        category: byName.groupCategory,
        lineItem: byName.name,
      };
    }
  }

  // 3. Fallback to raw parsed values
  return {
    category: rawCategory,
    lineItem: rawLineItem,
  };
}

