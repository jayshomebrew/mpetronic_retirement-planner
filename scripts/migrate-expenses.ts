import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';

interface ExpenseItem {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  entityType?: string;
  expenseId: string;
  date: string;
  amount: number;
  enteredBy?: string;
  notes?: string | null;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  catalogId?: string;
  category?: string;
  name?: string;
  categoryId?: string;
  categoryName?: string;
}

interface CategoryDefinition {
  categoryId?: string;
  name?: string;
  plannedMonthlyDefault?: number;
  color?: string;
  icon?: string;
  isCustom?: boolean;
}

const REGION = process.env.AWS_REGION || 'us-east-1';
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'RetirementPlanner-Data';

const rawClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

export async function runMigration(dryRun: boolean = false) {
  console.log(`Starting expense schema migration (dryRun=${dryRun})...`);
  console.log(`Table: ${TABLE_NAME} in region ${REGION}`);

  // 1. Fetch all category/catalog definitions from DynamoDB
  console.log('Fetching catalog definitions from DynamoDB...');
  const catScan = await docClient.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'entityType = :c',
      ExpressionAttributeValues: { ':c': 'CATEGORY' },
    })
  );

  const categories: CategoryDefinition[] = (catScan.Items || []) as CategoryDefinition[];
  console.log(`Found ${categories.length} category/catalog records.`);

  // Map by categoryId (e.g. 'amazonPrime' -> 'Subscriptions')
  // and map by name (e.g. 'Amazon Prime' -> 'Subscriptions')
  const catalogById = new Map<string, { category: string; name: string; id: string }>();
  const catalogByName = new Map<string, { category: string; name: string; id: string }>();

  for (const cat of categories) {
    if (!cat.categoryId || !cat.name) continue;
    let categoryGroup = 'Uncategorized';
    let lineItem = cat.name;
    if (cat.name.includes(' - ')) {
      const parts = cat.name.split(' - ');
      categoryGroup = parts[0].trim();
      lineItem = parts.slice(1).join(' - ').trim();
    }
    const def = { category: categoryGroup, name: lineItem, id: cat.categoryId };
    catalogById.set(cat.categoryId.toLowerCase(), def);
    catalogByName.set(lineItem.toLowerCase(), def);
  }

  // 2. Scan all expense records
  console.log('Fetching expense records from DynamoDB...');
  let lastEvaluatedKey: Record<string, unknown> | undefined = undefined;
  const allExpenses: ExpenseItem[] = [];

  do {
    const expScan = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'entityType = :e',
        ExpressionAttributeValues: { ':e': 'EXPENSE' },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );
    if (expScan.Items) {
      allExpenses.push(...(expScan.Items as ExpenseItem[]));
    }
    lastEvaluatedKey = expScan.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`Found ${allExpenses.length} total expense records.`);

  let alreadyMigratedCount = 0;
  const itemsToMigrate: ExpenseItem[] = [];

  for (const exp of allExpenses) {
    // Idempotency check:
    // If it has catalogId, category, and name, and lacks legacy categoryName, it is already migrated
    const isMigrated = Boolean(
      exp.catalogId &&
      exp.category &&
      exp.name &&
      exp.categoryName === undefined &&
      exp.categoryId === undefined
    );

    if (isMigrated) {
      alreadyMigratedCount++;
      continue;
    }

    // Determine target category and name
    let targetCategory = exp.category;
    let targetName = exp.name;

    if (!targetCategory || !targetName) {
      if (exp.categoryName && exp.categoryName.includes(' - ')) {
        const parts = exp.categoryName.split(' - ');
        targetCategory = parts[0].trim();
        targetName = parts.slice(1).join(' - ').trim();
      } else if (exp.categoryName) {
        targetCategory = 'Uncategorized';
        targetName = exp.categoryName.trim();
      }
    }

    // Determine canonical catalogId
    let canonicalCatalogId = exp.catalogId;
    if (!canonicalCatalogId && exp.categoryId) {
      canonicalCatalogId = exp.categoryId;
    }

    // Reconcile with catalog
    if (targetName) {
      const match = catalogByName.get(targetName.toLowerCase());
      if (match) {
        canonicalCatalogId = match.id;
        targetCategory = match.category; // Ensure category matches catalog
        targetName = match.name;
      }
    } else if (canonicalCatalogId) {
      const match = catalogById.get(canonicalCatalogId.toLowerCase());
      if (match) {
        targetCategory = match.category;
        targetName = match.name;
      }
    }

    targetCategory = targetCategory || 'Uncategorized';
    targetName = targetName || 'Expense';
    canonicalCatalogId =
      canonicalCatalogId ||
      `cat_${targetCategory.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${targetName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

    const dateStr = exp.date || (exp.SK ? exp.SK.split('#').slice(1, 3).join('-') : '2026-01-01');
    const [year, month] = dateStr.split('-');
    const sk = exp.SK || `EXPENSE#${year}#${month}#${exp.expenseId}`;
    const householdId = exp.PK.replace('HOUSEHOLD#', '');

    const migratedItem: ExpenseItem = {
      PK: exp.PK,
      SK: sk,
      GSI1PK: exp.GSI1PK || `HOUSEHOLD#${householdId}#EXPENSES`,
      GSI1SK: exp.GSI1SK || dateStr,
      entityType: 'EXPENSE',
      expenseId: exp.expenseId,
      date: dateStr,
      amount: Number(exp.amount) || 0,
      catalogId: canonicalCatalogId,
      category: targetCategory,
      name: targetName,
      enteredBy: exp.enteredBy || 'Primary',
      notes: exp.notes !== undefined ? exp.notes : null,
      tags: exp.tags,
      createdAt: exp.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Explicitly omit legacy fields:
      // categoryId: undefined,
      // categoryName: undefined,
    };

    itemsToMigrate.push(migratedItem);
  }

  console.log(`\n--- Pre-Migration Summary ---`);
  console.log(`Total expenses scanned: ${allExpenses.length}`);
  console.log(`Already migrated (skipped): ${alreadyMigratedCount}`);
  console.log(`Need migration: ${itemsToMigrate.length}`);

  if (itemsToMigrate.length === 0) {
    console.log('All expenses are already migrated! Nothing to do.');
    return;
  }

  // Display sample migration preview
  console.log('\nSample items being migrated:');
  for (const sample of itemsToMigrate.slice(0, 5)) {
    console.log(
      `  [${sample.expenseId}] ${sample.date} | Category: "${sample.category}" | Expense Name: "${sample.name}" | catalogId: "${sample.catalogId}"`
    );
  }

  if (dryRun) {
    console.log('\nDRY-RUN active: No writes performed to DynamoDB.');
    return;
  }

  console.log(`\nWriting ${itemsToMigrate.length} items to DynamoDB in batches of 25...`);
  const BATCH_SIZE = 25;
  let writtenCount = 0;

  for (let i = 0; i < itemsToMigrate.length; i += BATCH_SIZE) {
    const chunk = itemsToMigrate.slice(i, i + BATCH_SIZE);
    const putRequests = chunk.map(item => ({
      PutRequest: {
        Item: item,
      },
    }));

    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: putRequests,
        },
      })
    );

    writtenCount += chunk.length;
    process.stdout.write(`\rProgress: ${writtenCount} / ${itemsToMigrate.length} items written`);
  }

  console.log(`\n\nMigration successfully completed!`);
  console.log(`Summary: Total: ${allExpenses.length} | Migrated: ${writtenCount} | Skipped: ${alreadyMigratedCount} | Errors: 0\n`);
}

// Execution entry point
const isDryRun = process.argv.includes('--dry-run');
runMigration(isDryRun).catch(err => {
  console.error('\nMigration failed with error:', err);
  process.exit(1);
});
