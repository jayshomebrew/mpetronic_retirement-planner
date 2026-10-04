import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Check,
  Plus,
  Trash2,
  Edit2,
  Info,
  Layers,
  Settings,
  Copy,
  AlertCircle,
  FolderPlus,
  ArrowRightLeft,
  Search,
  MapPin,
  Globe,
  Filter,
  CheckSquare,
  Square,
  HeartPulse,
  Lock,
  ExternalLink,
  Calendar,
} from 'lucide-react';
import {
  DetailedExpensesState,
  ExpenseCatalog,
  ExpenseItemDefinition,
  HealthcareConfig,
  normalizeDetailedExpenses
} from '../types';
import { BASE_MEDICARE_PART_B, BASE_MEDICARE_PART_D } from '../engine/taxRates2026';
import { getStorageAdapter } from '../shared/storage';
import { syncCustomCategoriesToPlanner } from '../shared/utils/plannerCategories';

interface DetailedExpensesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentState?: string;
  targetState?: string;
  detailedExpenses: DetailedExpensesState | undefined;
  onSave: (expenses: DetailedExpensesState) => void;
  simStartYear?: number;
  relocationYear?: number | null;
  youHealthcare?: HealthcareConfig;
  wifeHealthcare?: HealthcareConfig;
  isSingleFiler?: boolean;
  onNavigateToHealthcare?: () => void;
}

export const DetailedExpensesDialog: React.FC<DetailedExpensesDialogProps> = ({
  isOpen,
  onClose,
  currentState = 'MD',
  targetState = 'FL',
  detailedExpenses,
  onSave,
  simStartYear = 2026,
  relocationYear = null,
  youHealthcare,
  wifeHealthcare,
  isSingleFiler = false,
  onNavigateToHealthcare,
}) => {
  const [activeTab, setActiveTab] = useState<'expenses' | 'catalog'>('expenses');

  // Internal normalized state
  const [catalog, setCatalog] = useState<ExpenseCatalog>(() => {
    const norm = normalizeDetailedExpenses(detailedExpenses);
    return norm.catalog;
  });

  const [statesList, setStatesList] = useState<string[]>(() => {
    const norm = normalizeDetailedExpenses(detailedExpenses);
    const initial = norm.states && norm.states.length > 0 ? [...norm.states] : [currentState || 'MD', targetState || 'FL'];
    const set = new Set<string>(initial);
    if (currentState) set.add(currentState);
    if (targetState) set.add(targetState);
    return Array.from(set);
  });

  const [activeState, setActiveState] = useState<string>(() => currentState || 'MD');

  const [costs, setCosts] = useState<{ [stateCode: string]: Record<string, number> }>(() => {
    const norm = normalizeDetailedExpenses(detailedExpenses);
    return norm.costs;
  });

  const [frequencies, setFrequencies] = useState<Record<string, number>>(() => {
    const norm = normalizeDetailedExpenses(detailedExpenses);
    return norm.frequencies;
  });

  // Re-sync when dialog opens or props change
  useEffect(() => {
    if (isOpen) {
      const adapter = getStorageAdapter();
      adapter.getCategories().then((cats) => {
        if (cats && cats.length > 0) {
          syncCustomCategoriesToPlanner(cats);
        }
      }).catch(console.warn);

      const norm = normalizeDetailedExpenses(detailedExpenses);
      setCatalog(norm.catalog);
      const sList = norm.states && norm.states.length > 0 ? [...norm.states] : [currentState || 'MD', targetState || 'FL'];
      const set = new Set<string>(sList);
      if (currentState) set.add(currentState);
      if (targetState) set.add(targetState);
      const finalStates = Array.from(set);
      setStatesList(finalStates);
      setActiveState(currentState || finalStates[0] || 'MD');
      setCosts(norm.costs);
      setFrequencies(norm.frequencies);
      setActiveTab('expenses');
    }
  }, [isOpen, detailedExpenses, currentState, targetState]);

  // Search and Category filters within dialog
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('ALL');
  const [showAllStatesItems, setShowAllStatesItems] = useState(false);

  // Item Add/Edit modal state
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ExpenseItemDefinition | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemCategory, setItemCategory] = useState('Housing');
  const [itemDescription, setItemDescription] = useState('');
  const [itemFrequency, setItemFrequency] = useState<number>(12);
  const [itemDueMonths, setItemDueMonths] = useState<number[]>([]);
  const [itemIsOneTime, setItemIsOneTime] = useState<boolean>(false);
  const [itemTargetYear, setItemTargetYear] = useState<number | string>(simStartYear);
  const [itemScopeMode, setItemScopeMode] = useState<'ALL' | 'SPECIFIC'>('ALL');
  const [itemSelectedStates, setItemSelectedStates] = useState<string[]>([currentState || 'MD']);
  const [itemBaseCost, setItemBaseCost] = useState<number>(0);
  const [itemCostsByState, setItemCostsByState] = useState<Record<string, number>>({});
  const [itemError, setItemError] = useState<string | null>(null);

  // Category Add/Rename state
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategoryName, setEditingCategoryName] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState<string | null>(null);

  // Category Delete / Reassign modal state
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<string | null>(null);
  const [reassignCategoryTarget, setReassignCategoryTarget] = useState<string>('');

  // Add State Modal state
  const [addStateModalOpen, setAddStateModalOpen] = useState(false);
  const [newStateCode, setNewStateCode] = useState('');
  const [addStateError, setAddStateError] = useState<string | null>(null);

  // Copy State Costs Modal state
  const [copyCostsModalOpen, setCopyCostsModalOpen] = useState(false);
  const [copySourceState, setCopySourceState] = useState(currentState || 'MD');
  const [copyTargetState, setCopyTargetState] = useState(targetState || 'FL');

  // Helper currency formatter
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(val || 0);
  };

  // Duplicate name checker
  const isDuplicateItemName = (name: string, excludeId?: string): boolean => {
    const trimmed = name.trim().toLowerCase();
    return catalog.items.some(
      (item) => item.name.trim().toLowerCase() === trimmed && item.id !== excludeId
    );
  };

  // Cost and frequency handlers
  const handleCostChange = (stateCode: string, itemId: string, value: number) => {
    const cleanVal = Math.max(0, value);
    setCosts((prev) => {
      const stateObj = { ...(prev[stateCode] || {}), [itemId]: cleanVal };
      return {
        ...prev,
        [stateCode]: stateObj
      };
    });
  };

  const handleFrequencyChange = (itemId: string, freq: number) => {
    setFrequencies((prev) => ({
      ...prev,
      [itemId]: Math.max(1, freq)
    }));
  };

  // Copy state costs
  const handleExecuteCopyStateCosts = () => {
    if (!copySourceState || !copyTargetState || copySourceState === copyTargetState) return;
    const sourceCosts = costs[copySourceState] || {};
    setCosts((prev) => ({
      ...prev,
      [copyTargetState]: { ...sourceCosts }
    }));
    setCopyCostsModalOpen(false);
  };

  // Add New State to Roster
  const handleAddState = () => {
    const trimmed = newStateCode.trim().toUpperCase();
    if (!trimmed || trimmed.length !== 2) {
      setAddStateError('Please enter a valid 2-letter state code (e.g. NC, TX, PA).');
      return;
    }
    if (statesList.includes(trimmed)) {
      setAddStateError(`State ${trimmed} is already configured.`);
      return;
    }

    const nextStates = [...statesList, trimmed];
    setStatesList(nextStates);
    setCosts((prev) => ({
      ...prev,
      [trimmed]: { ...(prev[trimmed] || {}) }
    }));
    setActiveState(trimmed);
    setNewStateCode('');
    setAddStateModalOpen(false);
    setAddStateError(null);
  };

  // Item Add/Edit open
  const handleOpenItemModal = (item?: ExpenseItemDefinition, defaultCat?: string, defaultYear?: number) => {
    setItemError(null);
    if (item) {
      setEditingItem(item);
      setItemName(item.name);
      const cat = item.isOneTime
        ? (item.category === 'One-Time Setup Costs' || item.category === 'One-Time Expense' || !item.category ? 'One-Time Expenses' : item.category)
        : (item.category || catalog.categories[0] || 'Living');
      setItemCategory(cat);
      setItemDescription(item.description || '');
      const isOneTime = !!item.isOneTime || cat === 'One-Time Expenses' || cat === 'One-Time Expense' || cat === 'One-Time Setup Costs';
      setItemIsOneTime(isOneTime);
      setItemFrequency(frequencies[item.id] ?? item.defaultFrequency ?? (isOneTime ? 1 : 12));
      setItemDueMonths(item.dueMonths ? [...item.dueMonths] : []);
      setItemTargetYear(item.targetYear ?? simStartYear);
      
      const appStates = item.applicableStates || ['ALL'];
      if (appStates.includes('ALL')) {
        setItemScopeMode('ALL');
        setItemSelectedStates(statesList.length > 0 ? [...statesList] : [activeState]);
      } else {
        setItemScopeMode('SPECIFIC');
        setItemSelectedStates([...appStates]);
      }

      const activeCost = costs[activeState]?.[item.id] ?? costs['ALL']?.[item.id] ?? costs['MD']?.[item.id] ?? 0;
      setItemBaseCost(activeCost);

      const stateMap: Record<string, number> = {};
      statesList.forEach((st) => {
        stateMap[st] = costs[st]?.[item.id] ?? costs['ALL']?.[item.id] ?? activeCost;
      });
      setItemCostsByState(stateMap);
    } else {
      setEditingItem(null);
      setItemName('');
      const cat = defaultCat || catalog.categories[0] || 'Living';
      const normalizedCat = (cat === 'One-Time Expense' || cat === 'One-Time Setup Costs') ? 'One-Time Expenses' : cat;
      setItemCategory(normalizedCat);
      setItemDescription('');
      const isOneTime = normalizedCat === 'One-Time Expenses' || !!defaultYear;
      setItemFrequency(isOneTime ? 1 : 12);
      setItemDueMonths([]);
      setItemIsOneTime(isOneTime);
      setItemTargetYear(defaultYear ?? simStartYear);
      setItemScopeMode('ALL');
      setItemSelectedStates(statesList.length > 0 ? [...statesList] : [activeState]);
      setItemBaseCost(0);
      const stateMap: Record<string, number> = {};
      statesList.forEach((st) => {
        stateMap[st] = 0;
      });
      setItemCostsByState(stateMap);
    }
    setItemModalOpen(true);
  };

  // Save Item
  const handleSaveItem = () => {
    const trimmedName = itemName.trim();
    if (!trimmedName) {
      setItemError('Item name is required.');
      return;
    }

    if (isDuplicateItemName(trimmedName, editingItem?.id)) {
      setItemError(`An expense item named "${trimmedName}" already exists.`);
      return;
    }

    const finalCategory = (itemCategory === 'One-Time Setup Costs' || itemCategory === 'One-Time Expense')
      ? 'One-Time Expenses'
      : itemCategory;

    const finalApplicableStates = itemScopeMode === 'ALL' 
      ? ['ALL'] 
      : (itemSelectedStates.length > 0 ? itemSelectedStates : [activeState]);

    const itemId = editingItem ? editingItem.id : `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    if (editingItem) {
      // Edit existing
      setCatalog((prev) => ({
        ...prev,
        items: prev.items.map((it) =>
          it.id === editingItem.id
            ? {
                ...it,
                name: trimmedName,
                category: finalCategory,
                description: itemDescription.trim() || undefined,
                defaultFrequency: itemFrequency,
                dueMonths: (itemFrequency < 12 || itemIsOneTime) && itemDueMonths.length > 0 ? itemDueMonths : undefined,
                isOneTime: itemIsOneTime,
                targetYear: itemIsOneTime ? (Number(itemTargetYear) || simStartYear) : undefined,
                applicableStates: finalApplicableStates
              }
            : it
        )
      }));
      setFrequencies((prev) => ({
        ...prev,
        [editingItem.id]: itemFrequency
      }));
    } else {
      // Create new
      const newItem: ExpenseItemDefinition = {
        id: itemId,
        name: trimmedName,
        category: finalCategory,
        description: itemDescription.trim() || undefined,
        defaultFrequency: itemFrequency,
        dueMonths: (itemFrequency < 12 || itemIsOneTime) && itemDueMonths.length > 0 ? itemDueMonths : undefined,
        isOneTime: itemIsOneTime,
        targetYear: itemIsOneTime ? (Number(itemTargetYear) || simStartYear) : undefined,
        applicableStates: finalApplicableStates
      };

      setCatalog((prev) => ({
        ...prev,
        items: [...prev.items, newItem]
      }));

      setFrequencies((prev) => ({
        ...prev,
        [itemId]: itemFrequency
      }));
    }

    // Save individual state costs
    setCosts((prev) => {
      const updated = { ...prev };
      statesList.forEach((st) => {
        const applies = finalApplicableStates.includes('ALL') || finalApplicableStates.includes(st);
        const specifiedCost = itemCostsByState[st];
        const stateCost = applies
          ? (specifiedCost !== undefined && specifiedCost > 0 ? specifiedCost : (itemBaseCost || 0))
          : 0;
        updated[st] = { ...(updated[st] || {}), [itemId]: stateCost };
      });
      return updated;
    });

    setItemModalOpen(false);
  };

  // Delete Item
  const handleDeleteItem = (itemId: string) => {
    setCatalog((prev) => ({
      ...prev,
      items: prev.items.filter((i) => i.id !== itemId)
    }));

    setCosts((prev) => {
      const updated = { ...prev };
      for (const st of Object.keys(updated)) {
        const copy = { ...updated[st] };
        delete copy[itemId];
        updated[st] = copy;
      }
      return updated;
    });

    setFrequencies((prev) => {
      const copy = { ...prev };
      delete copy[itemId];
      return copy;
    });
  };

  // Category Add/Rename
  const handleOpenCategoryModal = (catName?: string) => {
    setCategoryError(null);
    if (catName) {
      setEditingCategoryName(catName);
      setNewCategoryName(catName);
    } else {
      setEditingCategoryName(null);
      setNewCategoryName('');
    }
    setCategoryModalOpen(true);
  };

  const handleSaveCategory = () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) {
      setCategoryError('Category name cannot be empty.');
      return;
    }

    if (
      catalog.categories.some(
        (c) => c.toLowerCase() === trimmed.toLowerCase() && c !== editingCategoryName
      )
    ) {
      setCategoryError(`Category "${trimmed}" already exists.`);
      return;
    }

    if (editingCategoryName) {
      // Rename category
      setCatalog((prev) => ({
        categories: prev.categories.map((c) => (c === editingCategoryName ? trimmed : c)),
        items: prev.items.map((i) => (i.category === editingCategoryName ? { ...i, category: trimmed } : i))
      }));
    } else {
      // Add new category
      setCatalog((prev) => ({
        ...prev,
        categories: [...prev.categories, trimmed]
      }));
    }

    setCategoryModalOpen(false);
  };

  // Category Delete prompt
  const handlePromptDeleteCategory = (catName: string) => {
    const itemsInCat = catalog.items.filter((i) => i.category === catName);
    if (itemsInCat.length === 0) {
      setCatalog((prev) => ({
        ...prev,
        categories: prev.categories.filter((c) => c !== catName)
      }));
      return;
    }

    const otherCategories = catalog.categories.filter((c) => c !== catName);
    setReassignCategoryTarget(otherCategories[0] || 'Living');
    setDeleteCategoryTarget(catName);
  };

  const handleConfirmCategoryDeletion = (action: 'reassign' | 'delete-all') => {
    if (!deleteCategoryTarget) return;

    if (action === 'reassign' && reassignCategoryTarget) {
      setCatalog((prev) => ({
        categories: prev.categories.filter((c) => c !== deleteCategoryTarget),
        items: prev.items.map((i) =>
          i.category === deleteCategoryTarget ? { ...i, category: reassignCategoryTarget } : i
        )
      }));
    } else {
      const itemIdsToRemove = new Set(
        catalog.items.filter((i) => i.category === deleteCategoryTarget).map((i) => i.id)
      );

      setCatalog((prev) => ({
        categories: prev.categories.filter((c) => c !== deleteCategoryTarget),
        items: prev.items.filter((i) => i.category !== deleteCategoryTarget)
      }));

      setCosts((prev) => {
        const updated = { ...prev };
        for (const st of Object.keys(updated)) {
          const copy = { ...updated[st] };
          itemIdsToRemove.forEach((id) => delete copy[id]);
          updated[st] = copy;
        }
        return updated;
      });

      setFrequencies((prev) => {
        const copy = { ...prev };
        itemIdsToRemove.forEach((id) => delete copy[id]);
        return copy;
      });
    }

    setDeleteCategoryTarget(null);
  };

  // Save changes and close dialog
  const handleSaveAll = () => {
    const updatedState: DetailedExpensesState = {
      catalog,
      states: statesList,
      costs,
      frequencies,
      MD: costs.MD || costs['MD'] || {},
      FL: costs.FL || costs['FL'] || {}
    };
    onSave(updatedState);
    onClose();
  };

  // Items filtering
  const recurringItems = useMemo(() => catalog.items.filter((i) => !i.isOneTime), [catalog.items]);
  const oneTimeItems = useMemo(() => catalog.items.filter((i) => i.isOneTime), [catalog.items]);

  // Active state filtered recurring items
  const visibleRecurringItems = useMemo(() => {
    return recurringItems.filter((item) => {
      // Text search
      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        const matches = item.name.toLowerCase().includes(q) || item.category.toLowerCase().includes(q);
        if (!matches) return false;
      }
      // Category filter
      if (selectedCategoryFilter !== 'ALL' && item.category !== selectedCategoryFilter) {
        return false;
      }
      // State applicability filter (unless user toggles show all)
      if (!showAllStatesItems) {
        const applies = !item.applicableStates || 
          item.applicableStates.includes('ALL') || 
          item.applicableStates.includes(activeState);
        if (!applies) return false;
      }
      return true;
    });
  }, [recurringItems, searchFilter, selectedCategoryFilter, showAllStatesItems, activeState]);

  // Active state filtered one-time items
  const visibleOneTimeItems = useMemo(() => {
    return oneTimeItems.filter((item) => {
      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        const matches = item.name.toLowerCase().includes(q) || item.category.toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (!showAllStatesItems) {
        const applies = !item.applicableStates || 
          item.applicableStates.includes('ALL') || 
          item.applicableStates.includes(activeState);
        if (!applies) return false;
      }
      return true;
    });
  }, [oneTimeItems, searchFilter, showAllStatesItems, activeState]);

  // Category options for item modal: show all categories defined in the Expense Categories Manager
  const categoryOptions = useMemo(() => {
    const cats = [...catalog.categories];
    if (!cats.includes('One-Time Expenses')) {
      cats.push('One-Time Expenses');
    }
    if (itemCategory && !cats.includes(itemCategory)) {
      cats.push(itemCategory);
    }
    return cats;
  }, [catalog.categories, itemCategory]);

  const oneTimeItemsByYear = useMemo(() => {
    const groups: { [year: number]: ExpenseItemDefinition[] } = {};
    for (const item of visibleOneTimeItems) {
      const yr = item.targetYear ?? simStartYear;
      if (!groups[yr]) {
        groups[yr] = [];
      }
      groups[yr].push(item);
    }
    return Object.keys(groups)
      .map(Number)
      .sort((a, b) => a - b)
      .map((year) => ({
        year,
        items: groups[year]
      }));
  }, [visibleOneTimeItems, simStartYear]);

  // Active state totals calculation
  const activeStateTotals = useMemo(() => {
    const costMap = costs[activeState] || {};
    let recurringAnnual = 0;
    for (const item of recurringItems) {
      const applies = !item.applicableStates || item.applicableStates.includes('ALL') || item.applicableStates.includes(activeState);
      if (!applies) continue;
      const cost = costMap[item.id] ?? 0;
      const freq = frequencies[item.id] ?? item.defaultFrequency ?? 12;
      recurringAnnual += cost * freq;
    }
    let oneTime = 0;
    for (const item of oneTimeItems) {
      const applies = !item.applicableStates || item.applicableStates.includes('ALL') || item.applicableStates.includes(activeState);
      if (!applies) continue;
      oneTime += costMap[item.id] ?? 0;
    }
    return {
      recurringAnnual,
      recurringMonthly: recurringAnnual / 12,
      oneTime
    };
  }, [costs, activeState, recurringItems, oneTimeItems, frequencies]);

  // Synchronized healthcare values for active state
  const activeHealthcareSummary = useMemo(() => {
    if (!youHealthcare && !wifeHealthcare) return null;

    const youStateHc = youHealthcare ? ((youHealthcare as unknown as Record<string, unknown>)[activeState] as HealthcareConfig['MD'] | undefined || (activeState === 'MD' ? youHealthcare.MD : youHealthcare.FL)) : undefined;
    const wifeStateHc = wifeHealthcare ? ((wifeHealthcare as unknown as Record<string, unknown>)[activeState] as HealthcareConfig['MD'] | undefined || (activeState === 'MD' ? wifeHealthcare.MD : wifeHealthcare.FL)) : undefined;

    // Pre-65 monthly & annual
    const youPre65Monthly = (youStateHc?.pre65MedicalPremium ?? 0) + (youStateHc?.pre65DentalPremium ?? 0) + (youStateHc?.pre65VisionPremium ?? 0);
    const wifePre65Monthly = (!isSingleFiler && wifeStateHc) ? ((wifeStateHc?.pre65MedicalPremium ?? 0) + (wifeStateHc?.pre65DentalPremium ?? 0) + (wifeStateHc?.pre65VisionPremium ?? 0)) : 0;
    const totalPre65Monthly = youPre65Monthly + wifePre65Monthly;
    const totalPre65Annual = totalPre65Monthly * 12;

    // Pre-65 OOP
    const youPre65OOP = (youStateHc?.pre65MedicalOOP ?? 0) + (youStateHc?.pre65DentalOOP ?? 0) + (youStateHc?.pre65VisionOOP ?? 0);
    const wifePre65OOP = (!isSingleFiler && wifeStateHc) ? ((wifeStateHc?.pre65MedicalOOP ?? 0) + (wifeStateHc?.pre65DentalOOP ?? 0) + (wifeStateHc?.pre65VisionOOP ?? 0)) : 0;
    const totalPre65OOP = youPre65OOP + wifePre65OOP;

    // Medicare Monthly & Annual
    const youB = (youHealthcare?.medicarePartBPremium !== null && youHealthcare?.medicarePartBPremium !== undefined) ? youHealthcare.medicarePartBPremium : BASE_MEDICARE_PART_B;
    const youD = (youStateHc?.medicarePartDPremium !== null && youStateHc?.medicarePartDPremium !== undefined) ? youStateHc.medicarePartDPremium : BASE_MEDICARE_PART_D;
    const youMedMonthly = (youHealthcare ? (youB + youD) : 0) + (youStateHc?.supplementPremium ?? 0) + (youStateHc?.post65DentalPremium ?? 0) + (youStateHc?.post65VisionPremium ?? 0);

    const wifeB = (wifeHealthcare?.medicarePartBPremium !== null && wifeHealthcare?.medicarePartBPremium !== undefined) ? wifeHealthcare.medicarePartBPremium : BASE_MEDICARE_PART_B;
    const wifeD = (wifeStateHc?.medicarePartDPremium !== null && wifeStateHc?.medicarePartDPremium !== undefined) ? wifeStateHc.medicarePartDPremium : BASE_MEDICARE_PART_D;
    const wifeMedMonthly = (!isSingleFiler && wifeHealthcare) ? ((wifeB + wifeD) + (wifeStateHc?.supplementPremium ?? 0) + (wifeStateHc?.post65DentalPremium ?? 0) + (wifeStateHc?.post65VisionPremium ?? 0)) : 0;

    const totalMedicareMonthly = youMedMonthly + wifeMedMonthly;
    const totalMedicareAnnual = totalMedicareMonthly * 12;

    // Medicare OOP
    const youMedOOP = (youStateHc?.medicarePartDDeductibleCopays ?? 0) + (youStateHc?.supplementOOP ?? 0) + (youStateHc?.post65HearingCare ?? 0) + (youStateHc?.post65DentalOOP ?? 0) + (youStateHc?.post65VisionOOP ?? 0);
    const wifeMedOOP = (!isSingleFiler && wifeStateHc) ? ((wifeStateHc?.medicarePartDDeductibleCopays ?? 0) + (wifeStateHc?.supplementOOP ?? 0) + (wifeStateHc?.post65HearingCare ?? 0) + (wifeStateHc?.post65DentalOOP ?? 0) + (wifeStateHc?.post65VisionOOP ?? 0)) : 0;
    const totalMedicareOOP = youMedOOP + wifeMedOOP;

    const items = [
      {
        id: 'hc-pre65-premiums',
        name: 'Pre-65 Health Insurance Premiums',
        subtitle: isSingleFiler
          ? `Primary: ${formatCurrency(youPre65Monthly)}/mo (Medical, Dental & Vision)`
          : `Primary: ${formatCurrency(youPre65Monthly)}/mo | Spouse: ${formatCurrency(wifePre65Monthly)}/mo`,
        description: `Pre-65 individual private health insurance coverage (Medical, Dental, Vision) for state of ${activeState}.`,
        frequencyLabel: '12 / yr',
        cost: totalPre65Monthly,
        costLabel: `${formatCurrency(totalPre65Monthly)}/mo`,
        annualized: totalPre65Annual,
      },
      {
        id: 'hc-medicare-premiums',
        name: 'Medicare & Medigap Premiums',
        subtitle: isSingleFiler
          ? `Base Part B (${formatCurrency(youB)}/mo) + Part D (${formatCurrency(youD)}/mo) + Medigap Supplement & Extras`
          : `Primary: ${formatCurrency(youMedMonthly)}/mo | Spouse: ${formatCurrency(wifeMedMonthly)}/mo (Parts B & D, Medigap & Extras)`,
        description: `Post-65 Medicare coverage for ${activeState} including Parts B & D, supplemental Medigap (e.g. Plan G/N), dental and vision.`,
        frequencyLabel: '12 / yr',
        cost: totalMedicareMonthly,
        costLabel: `${formatCurrency(totalMedicareMonthly)}/mo`,
        annualized: totalMedicareAnnual,
      },
      {
        id: 'hc-pre65-oop',
        name: 'Pre-65 Out-of-Pocket Maximum Allowance',
        subtitle: isSingleFiler
          ? `Annual max deductible & copays: ${formatCurrency(youPre65OOP)}`
          : `Primary: ${formatCurrency(youPre65OOP)}/yr | Spouse: ${formatCurrency(wifePre65OOP)}/yr`,
        description: `Modeled annual out-of-pocket maximums and deductibles for pre-65 health plans in ${activeState}.`,
        frequencyLabel: '1 / yr',
        cost: totalPre65OOP,
        costLabel: `${formatCurrency(totalPre65OOP)}/yr`,
        annualized: totalPre65OOP,
      },
      {
        id: 'hc-medicare-oop',
        name: 'Medicare Out-of-Pocket Annual Allowance',
        subtitle: isSingleFiler
          ? `Part D copays, Medigap deductible, hearing & dental OOP: ${formatCurrency(youMedOOP)}`
          : `Primary: ${formatCurrency(youMedOOP)}/yr | Spouse: ${formatCurrency(wifeMedOOP)}/yr`,
        description: `Modeled annual healthcare out-of-pocket maximums (Part D Rx, Part B deductible, hearing, dental, vision) in ${activeState}.`,
        frequencyLabel: '1 / yr',
        cost: totalMedicareOOP,
        costLabel: `${formatCurrency(totalMedicareOOP)}/yr`,
        annualized: totalMedicareOOP,
      },
    ];

    return {
      items,
      totalPre65Monthly,
      totalPre65Annual,
      totalPre65OOP,
      totalMedicareMonthly,
      totalMedicareAnnual,
      totalMedicareOOP,
    };
  }, [youHealthcare, wifeHealthcare, isSingleFiler, activeState]);

  const showHealthcareCategory = useMemo(() => {
    if (!activeHealthcareSummary) return false;
    if (selectedCategoryFilter === 'ALL' || selectedCategoryFilter === 'Healthcare' || selectedCategoryFilter === 'Healthcare & Medicare') {
      if (!searchFilter.trim()) return true;
      const q = searchFilter.toLowerCase();
      return 'healthcare'.includes(q) || 'medicare'.includes(q) || 'insurance'.includes(q) || 'premium'.includes(q) || 'oop'.includes(q) || 'dental'.includes(q) || 'vision'.includes(q);
    }
    return false;
  }, [activeHealthcareSummary, selectedCategoryFilter, searchFilter]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md transition-all duration-300">
      <div className="w-full max-w-5xl bg-slate-900/95 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden glass-panel backdrop-blur-xl transition-all duration-300 transform scale-100 flex flex-col max-h-[92vh]">
        
        {/* Header with Tabs */}
        <div className="p-5 border-b border-slate-800 flex flex-col md:flex-row justify-between md:items-center gap-4 bg-slate-900/80">
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-black text-slate-100 tracking-tight flex items-center gap-2">
                Detailed Living Expenses <Settings className="w-4 h-4 text-emerald-400" />
              </h3>
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                {catalog.items.length} Configured Items
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Organize itemized household expenses, frequencies, and state-specific budgets without clutter.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Top Level Tab Switcher */}
            <div className="flex bg-slate-950/70 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setActiveTab('expenses')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'expenses'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                Expenses & Budgets
              </button>
              <button
                onClick={() => setActiveTab('catalog')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'catalog'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Categories & States
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-100 bg-slate-800/40 hover:bg-slate-800 border border-slate-700/30 rounded-lg transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">

          {/* TAB 1: STATE EXPENSES VIEW */}
          {activeTab === 'expenses' && (
            <div className="space-y-5">
              
              {/* State Selector & Action Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-slate-950/70 rounded-xl border border-slate-800/90 text-xs">
                
                {/* State Pills */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-emerald-400" /> Active State:
                  </span>
                  
                  {statesList.map((st) => {
                    const isSelected = st === activeState;
                    const isCurrent = st === currentState;
                    const isReloc = st === targetState;
                    return (
                      <button
                        key={st}
                        onClick={() => setActiveState(st)}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                          isSelected
                            ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20 font-black'
                            : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
                        }`}
                      >
                        <span>{st}</span>
                        {isCurrent && (
                          <span className={`text-[9px] px-1 py-0.2 rounded font-normal ${isSelected ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
                            Current
                          </span>
                        )}
                        {isReloc && !isCurrent && (
                          <span className={`text-[9px] px-1 py-0.2 rounded font-normal ${isSelected ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
                            Reloc
                          </span>
                        )}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => setAddStateModalOpen(true)}
                    className="px-2 py-1 text-[11px] font-semibold text-slate-400 hover:text-emerald-300 bg-slate-900/60 hover:bg-slate-800 border border-dashed border-slate-700/60 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                    title="Add another state to your plan"
                  >
                    <Plus className="w-3 h-3" />
                    Add State
                  </button>
                </div>

                {/* Toolbar Actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => {
                      setCopySourceState(activeState);
                      const other = statesList.find(s => s !== activeState) || statesList[0];
                      setCopyTargetState(other);
                      setCopyCostsModalOpen(true);
                    }}
                    className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700/80 border border-slate-700/60 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
                    title="Copy budget numbers to another state"
                  >
                    <Copy className="w-3 h-3" />
                    Copy Costs...
                  </button>
                </div>
              </div>

              {/* Filters Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-xs">
                <div className="flex items-center gap-2 flex-1 max-w-sm">
                  <div className="relative w-full">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      placeholder="Search expense line items..."
                      className="w-full pl-8 pr-3 py-1.5 bg-slate-950/60 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <Filter className="w-3.5 h-3.5 text-slate-500" />
                    <select
                      value={selectedCategoryFilter}
                      onChange={(e) => setSelectedCategoryFilter(e.target.value)}
                      className="bg-slate-950/60 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/50 cursor-pointer"
                    >
                      <option value="ALL">All Categories</option>
                      {activeHealthcareSummary && (
                        <option value="Healthcare">Healthcare & Medicare (Synchronized)</option>
                      )}
                      {catalog.categories.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>

                  <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showAllStatesItems}
                      onChange={(e) => setShowAllStatesItems(e.target.checked)}
                      className="rounded bg-slate-950 border-slate-700 text-emerald-500 focus:ring-0 focus:ring-offset-0"
                    />
                    <span>Show items from other states</span>
                  </label>
                </div>
              </div>

              {/* Recurring Categories Groups */}
              {catalog.categories.length === 0 ? (
                <div className="p-8 text-center bg-slate-950/40 rounded-xl border border-slate-800/80 space-y-3 my-4">
                  <div className="w-12 h-12 rounded-full bg-slate-800/80 text-emerald-400 flex items-center justify-center mx-auto border border-slate-700/50">
                    <FolderPlus className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-200">No Expense Categories Configured</h4>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Configure your expense categories and states in the Categories & States tab before adding expense line items.
                  </p>
                  <button
                    onClick={() => setActiveTab('catalog')}
                    className="px-4 py-2 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-all inline-flex items-center gap-1.5 cursor-pointer shadow-sm shadow-emerald-500/20 mt-2"
                  >
                    <Layers className="w-4 h-4" />
                    Open Categories & States
                  </button>
                </div>
              ) : (
                catalog.categories.map((catName) => {
                  if (selectedCategoryFilter !== 'ALL' && selectedCategoryFilter !== catName) return null;
                  const catItems = visibleRecurringItems.filter((i) => i.category === catName);
                  if (catItems.length === 0) return null;

                  const catSubtotal = catItems.reduce((sum, item) => {
                    const cost = costs[activeState]?.[item.id] ?? 0;
                    const freq = frequencies[item.id] ?? item.defaultFrequency ?? 12;
                    return sum + cost * freq;
                  }, 0);

                  return (
                    <div key={catName} className="space-y-2 bg-slate-950/40 p-4 rounded-xl border border-slate-800/60">
                      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                            {catName}
                          </h4>
                          <span className="text-[10px] text-slate-500 font-mono">
                            ({catItems.length} {catItems.length === 1 ? 'item' : 'items'})
                          </span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-xs font-mono font-semibold text-slate-300">
                            Subtotal ({activeState}): <span className="text-emerald-400 font-bold">{formatCurrency(catSubtotal)}/yr</span>
                          </span>
                          <button
                            onClick={() => handleOpenItemModal(undefined, catName)}
                            className="text-[10px] font-semibold text-slate-400 hover:text-emerald-300 flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                            Add Expense
                          </button>
                        </div>
                      </div>

                      <div className="min-w-full overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-slate-800/50 text-[10px] text-slate-500 font-bold uppercase">
                              <th className="py-2 pr-4 w-5/12">Expense Name</th>
                                <th className="py-2 px-2 text-center w-28">State Scope</th>
                              <th className="py-2 px-2 text-center w-28">Freq / Year</th>
                              <th className="py-2 px-2 text-right w-36">Budget Cost</th>
                              <th className="py-2 px-2 text-right w-36">Annualized</th>
                              <th className="py-2 pl-2 text-right w-16"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/20 text-xs">
                            {catItems.map((item) => {
                              const freq = frequencies[item.id] ?? item.defaultFrequency ?? 12;
                              const currentCost = costs[activeState]?.[item.id] ?? 0;
                              const annualized = currentCost * freq;
                              const appStates = item.applicableStates || ['ALL'];
                              const isUniversal = appStates.includes('ALL');
                              const appliesToActive = isUniversal || appStates.includes(activeState);
                              const hasDifferingStateCosts = statesList.length > 1 && (() => {
                                const applicableList = isUniversal ? statesList : statesList.filter((s) => appStates.includes(s));
                                if (applicableList.length <= 1) return false;
                                const firstCost = costs[applicableList[0]]?.[item.id] ?? 0;
                                return applicableList.some((s) => (costs[s]?.[item.id] ?? 0) !== firstCost);
                              })();

                              return (
                                <tr key={item.id} className={`hover:bg-slate-900/50 transition-colors group ${!appliesToActive ? 'opacity-50' : ''}`}>
                                  <td className="py-2 pr-4">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-slate-200 font-medium">{item.name}</span>
                                      {item.dueMonths && item.dueMonths.length > 0 && (
                                        <span className="text-[9px] font-semibold text-cyan-300 bg-cyan-950/70 px-1.5 py-0.5 rounded border border-cyan-500/30 flex items-center gap-0.5" title="Scheduled due month(s)">
                                          <Calendar className="w-2.5 h-2.5" />
                                          {item.dueMonths.map(m => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]).join(', ')}
                                        </span>
                                      )}
                                      {hasDifferingStateCosts && (
                                        <span className="text-[9px] font-semibold text-amber-400/90 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20" title="Cost varies across states">
                                          State Rates
                                        </span>
                                      )}
                                      {item.description && (
                                        <div className="relative group/tip cursor-help">
                                          <Info className="w-3.5 h-3.5 text-slate-500 hover:text-slate-300 transition-colors" />
                                          <div className="absolute left-0 bottom-full mb-1 hidden group-hover/tip:block bg-slate-800 text-slate-200 text-[11px] p-2 rounded-lg shadow-lg max-w-xs z-30 border border-slate-700 pointer-events-none">
                                            {item.description}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </td>

                                  {/* State Scope Badge */}
                                  <td className="py-2 px-2 text-center">
                                    {isUniversal ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                                        <Globe className="w-2.5 h-2.5" /> All States
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30">
                                        <MapPin className="w-2.5 h-2.5" /> {appStates.join(', ')}
                                      </span>
                                    )}
                                  </td>

                                  {/* Frequency */}
                                  <td className="py-2 px-2 text-center">
                                    <div className="flex items-center justify-center gap-1 text-[11px] text-slate-300 font-mono">
                                      <input
                                        type="number"
                                        min="1"
                                        max="365"
                                        value={freq}
                                        onChange={(e) => handleFrequencyChange(item.id, Number(e.target.value) || 1)}
                                        className="w-12 bg-slate-900 border border-slate-700/60 rounded px-1.5 py-0.5 text-center text-xs text-slate-200 focus:outline-none focus:border-emerald-500/50"
                                      />
                                      <span className="text-slate-500 text-[10px]">x/yr</span>
                                    </div>
                                  </td>

                                  {/* Cost Input for Active State */}
                                  <td className="py-2 px-2 text-right font-mono">
                                    <div className="relative inline-block w-28">
                                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                                      <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={currentCost || ''}
                                        placeholder="0"
                                        onChange={(e) => handleCostChange(activeState, item.id, Number(e.target.value) || 0)}
                                        className="w-full pl-5 pr-2 py-1 bg-slate-900/90 border border-slate-700/60 rounded text-right text-xs text-slate-100 font-mono font-medium focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30"
                                      />
                                    </div>
                                  </td>

                                  {/* Annualized Total */}
                                  <td className="py-2 px-2 text-right font-mono font-bold text-slate-300">
                                    {formatCurrency(annualized)}
                                  </td>

                                  {/* Actions */}
                                  <td className="py-2 pl-2 text-right">
                                    <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                                      <button
                                        onClick={() => handleOpenItemModal(item)}
                                        className="p-1 text-slate-400 hover:text-emerald-300 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                                        title="Edit Item Details"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteItem(item.id)}
                                        className="p-1 text-slate-500 hover:text-red-400 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                                        title="Delete Item"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })
              )}

              {/* One-Time Outlays Section */}
              <div className="space-y-3 bg-slate-950/40 p-4 rounded-xl border border-slate-800/60 mt-6">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                      One-Time Expenses
                    </h4>
                    <span className="text-[10px] text-slate-500 font-mono">
                      ({visibleOneTimeItems.length} {visibleOneTimeItems.length === 1 ? 'item' : 'items'})
                    </span>
                  </div>
                  <button
                    onClick={() => handleOpenItemModal(undefined, 'One-Time Expenses', relocationYear ?? simStartYear)}
                    className="text-[10px] font-semibold text-slate-400 hover:text-amber-300 flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    Add Expense
                  </button>
                </div>

                {visibleOneTimeItems.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-2">
                    No one-time expenses configured for {activeState}. (e.g. moving costs, initial furnishings, golf cart purchase).
                  </p>
                ) : (
                  oneTimeItemsByYear.map(({ year, items }) => {
                    const yearTotal = items.reduce((sum, it) => sum + (costs[activeState]?.[it.id] ?? 0), 0);
                    return (
                      <div key={year} className="space-y-2 bg-slate-900/40 p-3 rounded-lg border border-slate-800/50">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-300 pb-1 border-b border-slate-800/40">
                          <span>Target Year: <span className="text-amber-300 font-mono">{year}</span></span>
                          <span className="font-mono text-slate-400">Total ({activeState}): <span className="text-amber-400 font-bold">{formatCurrency(yearTotal)}</span></span>
                        </div>

                        <div className="min-w-full overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="text-[10px] text-slate-500 font-bold uppercase">
                                <th className="py-1 pr-4 w-6/12">Expense Name</th>
                                <th className="py-1 px-2 text-center w-28">State Scope</th>
                                <th className="py-1 px-2 text-right w-36">Budget Cost</th>
                                <th className="py-1 pl-2 text-right w-16"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/20 text-xs">
                              {items.map((item) => {
                                const currentCost = costs[activeState]?.[item.id] ?? 0;
                                const appStates = item.applicableStates || ['ALL'];
                                const isUniversal = appStates.includes('ALL');
                                const hasDifferingStateCosts = statesList.length > 1 && (() => {
                                  const applicableList = isUniversal ? statesList : statesList.filter((s) => appStates.includes(s));
                                  if (applicableList.length <= 1) return false;
                                  const firstCost = costs[applicableList[0]]?.[item.id] ?? 0;
                                  return applicableList.some((s) => (costs[s]?.[item.id] ?? 0) !== firstCost);
                                })();

                                return (
                                  <tr key={item.id} className="hover:bg-slate-900/50 transition-colors group">
                                    <td className="py-1.5 pr-4">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="text-slate-200 font-medium">{item.name}</span>
                                        {hasDifferingStateCosts && (
                                          <span className="text-[9px] font-semibold text-amber-400/90 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20" title="Cost varies across states">
                                            State Rates
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="py-1.5 px-2 text-center">
                                      {isUniversal ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                                          <Globe className="w-2.5 h-2.5" /> All States
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30">
                                          <MapPin className="w-2.5 h-2.5" /> {appStates.join(', ')}
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono">
                                      <div className="relative inline-block w-28">
                                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                                        <input
                                          type="number"
                                          min="0"
                                          step="1"
                                          value={currentCost || ''}
                                          placeholder="0"
                                          onChange={(e) => handleCostChange(activeState, item.id, Number(e.target.value) || 0)}
                                          className="w-full pl-5 pr-2 py-1 bg-slate-900/90 border border-slate-700/60 rounded text-right text-xs text-slate-100 font-mono font-medium focus:outline-none focus:border-amber-500/50"
                                        />
                                      </div>
                                    </td>
                                    <td className="py-1.5 pl-2 text-right">
                                      <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                                        <button
                                          onClick={() => handleOpenItemModal(item)}
                                          className="p-1 text-slate-400 hover:text-amber-300 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                                          title="Edit Expense"
                                        >
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteItem(item.id)}
                                          className="p-1 text-slate-500 hover:text-red-400 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                                          title="Delete Expense"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Synchronized Healthcare & Medicare Category */}
                {showHealthcareCategory && activeHealthcareSummary && (
                  <div className="space-y-2 bg-gradient-to-br from-emerald-950/20 via-slate-950/50 to-slate-950/40 p-4 rounded-xl border border-emerald-500/30 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-slate-800 gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="p-1 rounded-md bg-emerald-500/20 text-emerald-400">
                          <HeartPulse className="w-3.5 h-3.5" />
                        </div>
                        <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                          Healthcare & Medicare
                        </h4>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                          <Lock className="w-2.5 h-2.5" /> Synchronized
                        </span>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs font-mono font-semibold text-slate-300">
                          Subtotal ({activeState}):{' '}
                          <span className="text-emerald-400 font-bold">
                            {formatCurrency(activeHealthcareSummary.totalPre65Annual > 0 ? activeHealthcareSummary.totalPre65Annual : activeHealthcareSummary.totalMedicareAnnual)}/yr
                          </span>
                        </span>
                        {onNavigateToHealthcare && (
                          <button
                            onClick={onNavigateToHealthcare}
                            className="text-[10px] font-bold text-emerald-300 hover:text-emerald-200 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/30 px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                            title="Jump to Healthcare & Medicare configuration worksheet"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Edit Healthcare Parameters
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="min-w-full overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-800/50 text-[10px] text-slate-500 font-bold uppercase">
                            <th className="py-2 pr-4 w-5/12">Healthcare Obligation</th>
                            <th className="py-2 px-2 text-center w-28">State Scope</th>
                            <th className="py-2 px-2 text-center w-28">Freq / Year</th>
                            <th className="py-2 px-2 text-right w-36">Modeled Rate</th>
                            <th className="py-2 px-2 text-right w-36">Annualized</th>
                            <th className="py-2 pl-2 text-right w-16"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/20 text-xs">
                          {activeHealthcareSummary.items.map((item) => (
                            <tr key={item.id} className="hover:bg-slate-900/50 transition-colors group">
                              <td className="py-2 pr-4">
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-slate-200 font-medium">{item.name}</span>
                                    <span className="text-[9px] font-semibold text-emerald-400/90 bg-emerald-400/10 px-1.5 py-0.5 rounded border border-emerald-400/20">
                                      Worksheet Sync
                                    </span>
                                    {item.description && (
                                      <div className="relative group/tip cursor-help">
                                        <Info className="w-3.5 h-3.5 text-slate-500 hover:text-slate-300 transition-colors" />
                                        <div className="absolute left-0 bottom-full mb-1 hidden group-hover/tip:block bg-slate-800 text-slate-200 text-[11px] p-2 rounded-lg shadow-lg max-w-xs z-30 border border-slate-700 pointer-events-none">
                                          {item.description}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                                    {item.subtitle}
                                  </span>
                                </div>
                              </td>

                              <td className="py-2 px-2 text-center">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30">
                                  <MapPin className="w-2.5 h-2.5" /> {activeState}
                                </span>
                              </td>

                              <td className="py-2 px-2 text-center font-mono text-slate-300 text-xs">
                                {item.frequencyLabel}
                              </td>

                              <td className="py-2 px-2 text-right font-mono text-xs">
                                <div className="inline-flex items-center justify-end gap-1 px-2.5 py-1 bg-slate-900/80 border border-slate-800 rounded text-slate-300">
                                  <Lock className="w-2.5 h-2.5 text-slate-500" />
                                  <span>{item.costLabel}</span>
                                </div>
                              </td>

                              <td className="py-2 px-2 text-right font-mono font-bold text-emerald-400 text-xs">
                                {formatCurrency(item.annualized)}
                              </td>

                              <td className="py-2 pl-2 text-right">
                                <div className="relative group/lock cursor-help inline-flex items-center justify-end">
                                  <Lock className="w-3.5 h-3.5 text-slate-500 hover:text-emerald-400 transition-colors" />
                                  <div className="absolute right-0 bottom-full mb-1 hidden group-hover/lock:block bg-slate-800 text-slate-200 text-[10px] p-1.5 rounded-md shadow-lg whitespace-nowrap z-30 border border-slate-700 pointer-events-none">
                                    Synced from Healthcare & Medicare
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* TAB 2: CATALOG, CATEGORIES & STATES MANAGER */}
          {activeTab === 'catalog' && (
            <div className="space-y-6">
              
              {/* State Roster Manager */}
              <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-800/60 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-emerald-400" />
                    <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      Configured Plan States
                    </h4>
                  </div>
                  <button
                    onClick={() => setAddStateModalOpen(true)}
                    className="px-2.5 py-1 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add State
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                  {statesList.map((st) => (
                    <div key={st} className="flex items-center justify-between p-3 bg-slate-900 rounded-lg border border-slate-800">
                      <div>
                        <span className="font-black font-mono text-sm text-emerald-400">{st}</span>
                        <span className="block text-[10px] text-slate-500">
                          {st === currentState ? 'Current Residence' : st === targetState ? 'Relocation State' : 'Alternative State'}
                        </span>
                      </div>
                      {st !== currentState && st !== targetState && (
                        <button
                          onClick={() => {
                            if (window.confirm(`Remove state ${st} from plan?`)) {
                              setStatesList(prev => prev.filter(s => s !== st));
                              if (activeState === st) setActiveState(currentState || 'MD');
                            }
                          }}
                          className="p-1 text-slate-500 hover:text-red-400 rounded transition-colors cursor-pointer"
                          title="Remove State"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Categories Manager */}
              <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-800/60 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <FolderPlus className="w-4 h-4 text-emerald-400" />
                    <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      Expense Categories Manager
                    </h4>
                  </div>
                  <button
                    onClick={() => handleOpenCategoryModal()}
                    className="px-2.5 py-1 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Category
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                  {catalog.categories.map((cat) => {
                    const count = catalog.items.filter((i) => i.category === cat).length;
                    return (
                      <div key={cat} className="flex items-center justify-between p-3 bg-slate-900 rounded-lg border border-slate-800">
                        <div>
                          <span className="font-bold text-xs text-slate-200">{cat}</span>
                          <span className="block text-[10px] text-slate-500">{count} items mapped</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setActiveTab('expenses');
                              handleOpenItemModal(undefined, cat);
                            }}
                            className="p-1 text-slate-400 hover:text-emerald-300 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                            title={`Add Expense to ${cat}`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleOpenCategoryModal(cat)}
                            className="p-1 text-slate-400 hover:text-emerald-300 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                            title="Rename Category"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handlePromptDeleteCategory(cat)}
                            className="p-1 text-slate-500 hover:text-red-400 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                            title="Delete Category"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          )}

        </div>

        {/* Footer Summary & Actions */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 md:gap-6 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Viewing State:</span>
              <span className="font-bold text-emerald-400 font-mono px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30">
                {activeState}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Lifestyle Living:</span>{' '}
              <span className="font-bold font-mono text-slate-200">
                {formatCurrency(activeStateTotals.recurringMonthly)}/mo
              </span>{' '}
              <span className="font-bold font-mono text-emerald-400">
                ({formatCurrency(activeStateTotals.recurringAnnual)}/yr)
              </span>
            </div>
            {activeHealthcareSummary && (
              <div title="Synchronized from Healthcare & Medicare worksheet for active state">
                <span className="text-slate-400">Healthcare ({activeState}):</span>{' '}
                <span className="font-bold font-mono text-cyan-400">
                  +{formatCurrency(activeHealthcareSummary.totalPre65Annual > 0 ? activeHealthcareSummary.totalPre65Annual : activeHealthcareSummary.totalMedicareAnnual)}/yr
                </span>
              </div>
            )}
            <div>
              <span className="text-slate-400">Total Planned Budget:</span>{' '}
              <span className="font-bold font-mono text-emerald-300">
                {formatCurrency(activeStateTotals.recurringAnnual + (activeHealthcareSummary ? (activeHealthcareSummary.totalPre65Annual > 0 ? activeHealthcareSummary.totalPre65Annual : activeHealthcareSummary.totalMedicareAnnual) : 0))}/yr
              </span>
            </div>
            {activeStateTotals.oneTime > 0 && (
              <div>
                <span className="text-slate-400">One-Time Expenses:</span>{' '}
                <span className="font-bold font-mono text-amber-400">
                  {formatCurrency(activeStateTotals.oneTime)}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveAll}
              className="px-5 py-2 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-500/20"
            >
              <Check className="w-4 h-4" />
              Save Expenses
            </button>
          </div>
        </div>

      </div>

      {/* MODAL 1: ADD / EDIT ITEM */}
      {itemModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                {editingItem ? <Edit2 className="w-4 h-4 text-emerald-400" /> : <Plus className="w-4 h-4 text-emerald-400" />}
                {editingItem ? 'Edit Line Item' : 'Add New Line Item'}
              </h4>
              <button onClick={() => setItemModalOpen(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            {itemError && (
              <div className="p-2.5 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{itemError}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Item Name *</label>
                <input
                  type="text"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  placeholder="e.g. Termite Bond, Auto Gas, Streaming Services"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Category</label>
                  <select
                    value={itemCategory}
                    onChange={(e) => {
                      const newCat = e.target.value;
                      setItemCategory(newCat);
                      if (newCat === 'One-Time Expenses' || newCat === 'One-Time Setup Costs' || newCat === 'One-Time Expense') {
                        setItemIsOneTime(true);
                        setItemFrequency(1);
                      } else if (itemCategory === 'One-Time Expenses' || itemCategory === 'One-Time Setup Costs' || itemCategory === 'One-Time Expense') {
                        setItemIsOneTime(false);
                        setItemFrequency(12);
                      }
                    }}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 text-xs focus:outline-none focus:border-emerald-500/50"
                  >
                    {categoryOptions.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Frequency</label>
                  <select
                    value={itemFrequency}
                    onChange={(e) => setItemFrequency(Number(e.target.value))}
                    disabled={itemIsOneTime}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 text-xs focus:outline-none focus:border-emerald-500/50 disabled:opacity-40"
                  >
                    <option value={12}>Monthly (12x/yr)</option>
                    <option value={4}>Quarterly (4x/yr)</option>
                    <option value={2}>Semi-Annual (2x/yr)</option>
                    <option value={1}>Annual (1x/yr)</option>
                    <option value={26}>Bi-Weekly (26x/yr)</option>
                    <option value={52}>Weekly (52x/yr)</option>
                  </select>
                </div>
              </div>

              {/* Scheduled Due Months Selector for Non-Monthly Expenses */}
              {(itemFrequency < 12 || itemIsOneTime) && (
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="block text-slate-300 font-semibold text-xs flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                        Scheduled Due Month(s) <span className="text-slate-500 font-normal text-[10px]">(Optional)</span>
                      </label>
                      <span className="text-[11px] text-slate-400">
                        Specify which month(s) this expense is paid to level cash flow budget benchmarks (e.g. Sep &amp; Dec for taxes, Aug for insurance).
                      </span>
                    </div>
                    {itemDueMonths.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setItemDueMonths([])}
                        className="text-[10px] text-slate-400 hover:text-slate-200 underline cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5 pt-1">
                    {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((mName, idx) => {
                      const mNum = idx + 1;
                      const isSelected = itemDueMonths.includes(mNum);
                      return (
                        <button
                          key={mNum}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setItemDueMonths((prev) => prev.filter((m) => m !== mNum));
                            } else {
                              setItemDueMonths((prev) => [...prev, mNum].sort((a, b) => a - b));
                            }
                          }}
                          className={`py-1 text-center text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow font-black'
                              : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-850'
                          }`}
                        >
                          {mName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* State Scope Selector */}
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-2">
                <label className="block text-slate-300 font-semibold">State Applicability</label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-200">
                    <input
                      type="radio"
                      name="scopeMode"
                      checked={itemScopeMode === 'ALL'}
                      onChange={() => setItemScopeMode('ALL')}
                      className="text-emerald-500 focus:ring-0"
                    />
                    <span>All States (Universal)</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-200">
                    <input
                      type="radio"
                      name="scopeMode"
                      checked={itemScopeMode === 'SPECIFIC'}
                      onChange={() => setItemScopeMode('SPECIFIC')}
                      className="text-emerald-500 focus:ring-0"
                    />
                    <span>Specific State(s) Only</span>
                  </label>
                </div>

                {itemScopeMode === 'SPECIFIC' && (
                  <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-slate-400">Select States:</span>
                    {statesList.map((st) => {
                      const isChecked = itemSelectedStates.includes(st);
                      return (
                        <button
                          key={st}
                          type="button"
                          onClick={() => {
                            if (isChecked) {
                              if (itemSelectedStates.length > 1) {
                                setItemSelectedStates(prev => prev.filter(s => s !== st));
                              }
                            } else {
                              setItemSelectedStates(prev => [...prev, st]);
                            }
                          }}
                          className={`px-2 py-1 rounded text-xs font-bold border transition-all cursor-pointer flex items-center gap-1 ${
                            isChecked
                              ? 'bg-blue-500/20 text-blue-300 border-blue-500/50'
                              : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                          }`}
                        >
                          {isChecked ? <CheckSquare className="w-3 h-3 text-blue-400" /> : <Square className="w-3 h-3" />}
                          {st}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Per-State Cost Configuration */}
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-slate-300 font-semibold">
                    Base / Default Cost ($ / occurrence)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const updated: Record<string, number> = {};
                      statesList.forEach((st) => {
                        updated[st] = itemBaseCost;
                      });
                      setItemCostsByState(updated);
                    }}
                    className="text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 rounded cursor-pointer transition-colors"
                  >
                    Apply to All States
                  </button>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-mono">$</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={itemBaseCost || ''}
                    placeholder="0"
                    onChange={(e) => {
                      const val = e.target.value === '' ? 0 : Number(e.target.value);
                      setItemBaseCost(val);
                      setItemCostsByState((prev) => {
                        const updated: Record<string, number> = {};
                        statesList.forEach((st) => {
                          const prevCost = prev[st];
                          if (prevCost !== undefined && prevCost !== itemBaseCost && prevCost > 0) {
                            updated[st] = prevCost;
                          } else {
                            updated[st] = val;
                          }
                        });
                        return updated;
                      });
                    }}
                    className="w-full pl-7 pr-3 py-2 bg-slate-900 border border-slate-700/60 rounded-lg text-slate-100 font-mono text-xs focus:outline-none focus:border-emerald-500/50"
                  />
                </div>

                {/* State-specific cost overrides */}
                <div className="pt-2 border-t border-slate-800/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-400">
                      Per-State Rates {itemScopeMode === 'ALL' ? '(Universal Item)' : '(Selected States)'}:
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {(itemScopeMode === 'ALL' ? statesList : statesList.filter((s) => itemSelectedStates.includes(s))).map((st) => (
                      <div key={st} className="p-2 bg-slate-900/80 rounded border border-slate-800 flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                          <span>{st}</span>
                          {st === activeState && <span className="text-[9px] text-emerald-400 lowercase font-mono">(active)</span>}
                        </span>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-[11px] font-mono">$</span>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={itemCostsByState[st] !== undefined && itemCostsByState[st] > 0 ? itemCostsByState[st] : (itemBaseCost || '')}
                            placeholder={String(itemBaseCost || 0)}
                            onChange={(e) => {
                              const val = e.target.value === '' ? 0 : Number(e.target.value);
                              setItemCostsByState((prev) => ({
                                ...prev,
                                [st]: val
                              }));
                            }}
                            className="w-full pl-5 pr-2 py-1 bg-slate-950 border border-slate-700/60 rounded text-right text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500/50"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Expense Type & Target Year */}
              <div className="grid grid-cols-2 gap-3 items-center">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Expense Type</label>
                  <label className="flex items-center gap-2 py-2 cursor-pointer text-slate-300">
                    <input
                      type="checkbox"
                      checked={itemIsOneTime}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setItemIsOneTime(checked);
                        if (checked && itemCategory !== 'One-Time Expenses') {
                          setItemCategory('One-Time Expenses');
                          setItemFrequency(1);
                        } else if (!checked && (itemCategory === 'One-Time Expenses' || itemCategory === 'One-Time Setup Costs' || itemCategory === 'One-Time Expense')) {
                          setItemCategory(catalog.categories[0] || 'Housing');
                          setItemFrequency(12);
                        }
                      }}
                      className="rounded bg-slate-950 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
                    />
                    <span>One-Time Expenses</span>
                  </label>
                </div>

                {itemIsOneTime && (
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Target Year</label>
                    <input
                      type="number"
                      min={simStartYear}
                      max={2080}
                      value={itemTargetYear}
                      onChange={(e) => setItemTargetYear(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 font-mono text-xs focus:outline-none focus:border-amber-500/50"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Description / Notes (Optional)</label>
                <input
                  type="text"
                  value={itemDescription}
                  onChange={(e) => setItemDescription(e.target.value)}
                  placeholder="e.g. HOA fee covers lawn maintenance and trash"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-emerald-500/50"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => setItemModalOpen(false)}
                className="px-3.5 py-1.5 text-xs text-slate-300 hover:text-slate-100 bg-slate-800 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveItem}
                className="px-4 py-1.5 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg shadow-sm"
              >
                Save Item
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD STATE */}
      {addStateModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-400" /> Add State to Plan
              </h4>
              <button onClick={() => setAddStateModalOpen(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            {addStateError && (
              <div className="p-2.5 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                {addStateError}
              </div>
            )}

            <div>
              <label className="block text-xs text-slate-300 font-semibold mb-1">State Code (2 Letters)</label>
              <input
                type="text"
                maxLength={2}
                value={newStateCode}
                onChange={(e) => setNewStateCode(e.target.value.toUpperCase())}
                placeholder="e.g. NC, TX, PA, SC"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 font-mono font-bold text-center text-sm uppercase focus:outline-none focus:border-emerald-500/50"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setAddStateModalOpen(false)}
                className="px-3.5 py-1.5 text-xs text-slate-300 hover:text-slate-100 bg-slate-800 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleAddState}
                className="px-4 py-1.5 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg shadow-sm"
              >
                Add State
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: COPY STATE COSTS */}
      {copyCostsModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Copy className="w-4 h-4 text-emerald-400" /> Copy State Costs
              </h4>
              <button onClick={() => setCopyCostsModalOpen(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Quickly clone all line item dollar figures from one state into another.
            </p>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Source State</label>
                <select
                  value={copySourceState}
                  onChange={(e) => setCopySourceState(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 text-xs focus:outline-none focus:border-emerald-500/50"
                >
                  {statesList.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Target State</label>
                <select
                  value={copyTargetState}
                  onChange={(e) => setCopyTargetState(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 text-xs focus:outline-none focus:border-emerald-500/50"
                >
                  {statesList.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setCopyCostsModalOpen(false)}
                className="px-3.5 py-1.5 text-xs text-slate-300 hover:text-slate-100 bg-slate-800 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteCopyStateCosts}
                className="px-4 py-1.5 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg shadow-sm"
              >
                Copy {copySourceState} → {copyTargetState}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: CATEGORY ADD / EDIT */}
      {categoryModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-emerald-400" />
                {editingCategoryName ? 'Rename Category' : 'Add New Category'}
              </h4>
              <button onClick={() => setCategoryModalOpen(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            {categoryError && (
              <div className="p-2.5 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                {categoryError}
              </div>
            )}

            <div>
              <label className="block text-xs text-slate-300 font-semibold mb-1">Category Name *</label>
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="e.g. Travel & Leisure, Technology"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500/50"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setCategoryModalOpen(false)}
                className="px-3.5 py-1.5 text-xs text-slate-300 hover:text-slate-100 bg-slate-800 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCategory}
                className="px-4 py-1.5 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg shadow-sm"
              >
                Save Category
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: CATEGORY DELETE SAFE REASSIGNMENT */}
      {deleteCategoryTarget && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h4 className="text-sm font-bold text-red-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400" /> Delete Category "{deleteCategoryTarget}"
              </h4>
              <button onClick={() => setDeleteCategoryTarget(null)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              This category contains active expense items. Would you like to reassign them to another category or delete all items?
            </p>

            <div>
              <label className="block text-xs text-slate-300 font-semibold mb-1">Reassign items to:</label>
              <select
                value={reassignCategoryTarget}
                onChange={(e) => setReassignCategoryTarget(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 text-xs focus:outline-none focus:border-emerald-500/50"
              >
                {catalog.categories
                  .filter((c) => c !== deleteCategoryTarget)
                  .map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
              </select>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-slate-800 text-xs">
              <button
                onClick={() => handleConfirmCategoryDeletion('delete-all')}
                className="px-3 py-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
              >
                Delete All Items
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDeleteCategoryTarget(null)}
                  className="px-3 py-1.5 text-slate-300 hover:text-slate-100 bg-slate-800 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleConfirmCategoryDeletion('reassign')}
                  className="px-4 py-1.5 font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg shadow-sm"
                >
                  Reassign & Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>,
    document.body
  );
};
