# Batch Stock Adjustment Feature

## Overview
The stock adjustment feature has been upgraded to support **batch adjustments**, allowing users to adjust multiple products/variations in a single transaction for better tracking and auditing.

## What Changed

### Previous Behavior
- Users adjusted stock one product at a time
- Each adjustment was independent
- No easy way to track related adjustments

### New Behavior
- Users can add **multiple products** to a single batch adjustment
- All adjustments share the same:
  - Adjustment reason (Receive Items, Inventory Count, Loss/Damage)
  - Notes/description
  - Timestamp
  - Batch ID for tracking
- Better audit trail with batch tracking

## Key Features

### 1. Batch Management
- **Add Multiple Products**: Search and add multiple products to a single adjustment batch
- **Visual Batch Summary**: See all products in the current batch before submitting
- **Edit Products**: Modify product selections before final submission
- **Remove Products**: Remove products from batch if needed

### 2. Product Selection
- **Multiple Variations**: Select multiple variations per product
- **Checkbox Interface**: Intuitive checkbox selection for variations
- **Visual Feedback**: Selected variations are highlighted in green
- **Real-time Validation**: Validates adjustment values before adding to batch

### 3. Tracking & Audit
- **Unique Batch ID**: Each batch gets a unique ID (format: `BATCH-{timestamp}-{random}`)
- **Centralized Batch Record**: Stored in `StockAdjustmentBatches` collection
- **Individual Product Logs**: Each product maintains its own log with batch reference
- **Complete Audit Trail**: Track who, what, when, and why for each adjustment

## Data Structure

### StockAdjustmentBatches Collection
```typescript
{
  batchId: string;              // Unique batch identifier
  reason: string;               // Adjustment reason
  notes: string;                // Adjustment notes
  userId: string;               // User who made adjustment
  userName: string;             // User's display name
  sellerId: string;             // Seller ID
  totalItemsAdjusted: number;   // Count of variations adjusted
  items: [                      // Array of adjusted items
    {
      productId: string;
      productName: string;
      variationId: string;
      variationName: string;
      stockBefore: number;
      stockAfter: number;
      adjustmentQty: number;
      imageUrl: string;
    }
  ];
  createdAt: Timestamp;
  timestamp: number;
}
```

### Product Logs (Individual)
Each product's `Logs` subcollection gets entries with:
- `batchId`: Links to the batch adjustment
- All standard log fields (before/after stock, reason, etc.)
- `detail`: Includes batch ID reference

## User Workflow

### Step 1: Set Adjustment Parameters
1. Open the Stock Adjustment page
2. Modal opens showing batch settings:
   - Select adjustment reason
   - Enter notes (required)
3. Modal stays open for product selection

### Step 2: Add Products to Batch
1. Search for products using the search bar
2. Click "Add to Batch" on desired products
3. For each product:
   - Check variations to adjust
   - Enter adjustment values
   - Click "Add to Batch"
4. Product appears in the batch summary card
5. Repeat for additional products

### Step 3: Review and Submit
1. Review batch summary showing:
   - Total products added
   - Total variations to adjust
2. Edit or remove products if needed
3. Click "Submit Batch Adjustment"
4. All adjustments processed in a single transaction
5. Success confirmation shows totals

## Benefits

### For Users
- **Efficiency**: Adjust multiple products at once
- **Context**: Group related adjustments together
- **Clarity**: Clear overview before committing changes

### For Tracking
- **Better Audit**: Single batch ID for related adjustments
- **Easier Reports**: Query adjustments by batch ID
- **Accountability**: Clear record of who made batch adjustments
- **Historical Analysis**: Understand adjustment patterns

### For Operations
- **Data Integrity**: Atomic batch operations
- **Consistency**: All adjustments use same reason/notes
- **Traceability**: Complete audit trail for compliance

## Technical Implementation

### Files Modified
1. **`src/types/inventory.ts`**
   - Added `StockAdjustmentItem` interface
   - Updated `StockAdjustment` to support batch structure

2. **`src/services/stockAdjustment.ts`**
   - Added `generateBatchId()` function
   - Added `batchAdjustMultipleProducts()` for batch operations
   - Creates centralized batch record

3. **`src/services/logAdjustment.ts`**
   - Added `logBatchStockAdjustment()` function
   - Logs individual products with batch reference

4. **`src/components/inventory/StockAdjustment/index.tsx`**
   - Complete refactor for batch functionality
   - State management for multiple products
   - Batch summary UI
   - Product management (add/remove/edit)

5. **`src/components/inventory/StockAdjustment/StockAdjustmentModal.tsx`**
   - Dual-mode modal (settings/product selection)
   - Checkbox-based variation selection
   - Visual feedback for selections

## Firebase Structure

```
Firestore
├── StockAdjustmentBatches (new collection)
│   └── {batchDocId}
│       ├── batchId
│       ├── reason
│       ├── notes
│       ├── items[]
│       └── ...metadata
│
└── Product
    └── {productId}
        ├── Variation
        │   └── {variationId}
        │       └── stock (updated)
        └── Logs
            └── {logId}
                ├── batchId (links to batch)
                └── ...log details
```

## Future Enhancements

### Potential Improvements
1. **Batch History View**: Dedicated page to view all batch adjustments
2. **Batch Filters**: Filter by batch ID, date range, reason
3. **Batch Reversal**: Ability to reverse entire batch adjustment
4. **Export Batch**: Export batch details to CSV/Excel
5. **Batch Templates**: Save common adjustment patterns
6. **Approval Workflow**: Require approval for large batches

### Reporting Ideas
1. Batch adjustment frequency reports
2. Most common adjustment reasons
3. User adjustment patterns
4. Time-series batch analysis

## Testing Checklist

- [x] Can open stock adjustment modal
- [x] Can set adjustment reason and notes
- [x] Can search for products
- [x] Can add product to batch
- [x] Can select multiple variations with checkboxes
- [x] Can enter adjustment values
- [x] Can remove product from batch
- [x] Can edit product already in batch
- [x] Validation prevents negative stock
- [x] Validation requires notes
- [x] Batch submission creates records
- [x] Individual logs reference batch ID
- [x] Stock updates correctly across all variations
- [x] Success message shows correct totals

## Support

For questions or issues with batch stock adjustments, please contact the development team.

**Last Updated**: February 2, 2026
