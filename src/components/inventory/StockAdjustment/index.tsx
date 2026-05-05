
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import useProductSearch from '@/hooks/useProductSearch';
import useProductVariations from '@/hooks/useProductVariations';
import { batchAdjustMultipleProducts, generateBatchId, BatchAdjustmentItem } from '@/services/stockAdjustment';
import { logBatchStockAdjustment } from '../../../services/logAdjustment';
import { ArrowLeft, CheckCircle } from 'lucide-react';

// Interface for adjustment items in the table
interface AdjustmentItem {
  id: string;
  productId: string;
  variationId: string;
  name: string;
  variationName: string;
  currentStock: number;
  addStock: number;
  imageUrl?: string;
}

const StockAdjustment: React.FC = () => {
	const navigate = useNavigate();
	const { uid, role, isSeller, isSubAccount, parentId } = useAuth();
  const effectiveSellerId = isSeller ? (isSubAccount ? (parentId || uid) : uid) : null;
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('Receive items');
  const [notes, setNotes] = useState('');
  const [adjustmentItems, setAdjustmentItems] = useState<AdjustmentItem[]>([]);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  
  // Variation selection modal state
  const [showVariationModal, setShowVariationModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [selectedVariations, setSelectedVariations] = useState<Set<string>>(new Set());
  
  // Pre-generated batch ID and adjustment number
  const [batchId] = useState(() => generateBatchId());
  const [adjustmentDate] = useState(() => new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }));
  
  // Handle Escape key to close success dialog
  useEffect(() => {
    if (!showSuccessDialog) return;
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowSuccessDialog(false);
      }
    };
    
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showSuccessDialog]);
  
  // Generate adjustment number from batch ID
  const adjustmentNo = useMemo(() => {
    const timestamp = batchId.split('-')[1];
    const shortId = batchId.split('-')[2];
    return `ADJ-${timestamp}-${shortId}`;
  }, [batchId]);
  
  // State for managing products
  const [currentProduct, setCurrentProduct] = useState<any | null>(null);

  const { results, loading, error, searchProducts } = useProductSearch(effectiveSellerId);
  const { variations, fetchVariations } = useProductVariations();

  // Auto-search as user types (with debounce)
  useEffect(() => {
    if (search.trim()) {
      const timeoutId = setTimeout(() => {
        searchProducts(search);
      }, 300); // 300ms debounce delay
      
      return () => clearTimeout(timeoutId);
    }
  }, [search, searchProducts]);

  const handleSearch = (e: React.FormEvent) => {
	e.preventDefault();
	searchProducts(search);
  };

  // Add product to adjustment items
  const handleAddProductToBatch = async (product: any) => {
    await fetchVariations(product.id);
    setSelectedProduct(product);
    setShowVariationModal(true);
    setSelectedVariations(new Set());
    setSearch(''); // Clear search after selecting
  };

  // Confirm variation selection and add to table
  const handleConfirmVariations = () => {
    if (!selectedProduct || selectedVariations.size === 0) {
      alert('Please select at least one variation');
      return;
    }

    const productVariations = variations || [];
    const newItems: AdjustmentItem[] = productVariations
      .filter((variation: any) => selectedVariations.has(variation.id))
      .map((variation: any) => ({
        id: `${selectedProduct.id}-${variation.id}`,
        productId: selectedProduct.id,
        variationId: variation.id,
        name: selectedProduct.product || selectedProduct.name,
        variationName: variation.name || 'Default',
        currentStock: variation.stock || 0,
        addStock: 0,
        imageUrl: variation.imageUrl || selectedProduct.imageUrl || selectedProduct.imageURL
      }));
    
    setAdjustmentItems([...adjustmentItems, ...newItems]);
    setShowVariationModal(false);
    setSelectedProduct(null);
    setSelectedVariations(new Set());
  };

  // Toggle variation selection
  const toggleVariationSelection = (variationId: string) => {
    const newSet = new Set(selectedVariations);
    if (newSet.has(variationId)) {
      newSet.delete(variationId);
    } else {
      newSet.add(variationId);
    }
    setSelectedVariations(newSet);
  };

  // Update add stock value for an item
  const handleUpdateAddStock = (itemId: string, value: number) => {
    setAdjustmentItems(items => 
      items.map(item => 
        item.id === itemId ? { ...item, addStock: value } : item
      )
    );
  };

  // Remove item from adjustment
  const handleRemoveItem = (itemId: string) => {
    setAdjustmentItems(items => items.filter(item => item.id !== itemId));
  };

  // Submit entire batch adjustment
  const handleSubmitBatchAdjustment = async () => {
    if (!notes.trim()) {
      alert('Notes are required.');
      return;
    }

    if (adjustmentItems.length === 0) {
      alert('Please add at least one item to adjust.');
      return;
    }

    // Prepare all items for batch adjustment
    const allItems: BatchAdjustmentItem[] = adjustmentItems.map(item => {
      const currentStock = item.currentStock;
      let newStock = currentStock;
      const inputValue = item.addStock || 0;
      
      if (reason === 'Receive items') {
        newStock = currentStock + inputValue;
      } else if (reason === 'Inventory Count') {
        newStock = inputValue;
      } else if (reason === 'Loss/Damage') {
        newStock = currentStock - inputValue;
      }
      
      if (newStock < 0) {
        throw new Error(`Adjustment for ${item.name} - ${item.variationName} would create negative stock.`);
      }
      
      return {
        productId: item.productId,
        productName: item.name,
        variationId: item.variationId,
        variationName: item.variationName,
        beforeStock: currentStock,
        newStock: newStock,
        imageUrl: item.imageUrl
      };
    });

    if (allItems.length === 0) {
      alert('No valid adjustments to submit.');
      return;
    }

    try {
      // Use effectiveSellerId so all adjustments are logged under the main seller account
      const sellerId = effectiveSellerId || uid || '';
      const userName = uid || ''; // You can extend this with actual username
      
      // Perform batch adjustment
      await batchAdjustMultipleProducts(allItems, {
        batchId,
        reason,
        notes,
        userId: uid || '',
        userName,
        sellerId
      });

      // Log the batch adjustment
      await logBatchStockAdjustment({
        batchId,
        items: allItems,
        reason,
        notes,
        userId: uid || '',
        userName,
        sellerId
      });

      // Reset state
      setNotes('');
      setAdjustmentItems([]);
      setSearch('');
      
      // Show success dialog
      const itemText = allItems.length === 1 ? allItems[0].productName : `${allItems.length} items`;
      setSuccessMessage(`Successfully adjusted ${itemText}!`);
      setShowSuccessDialog(true);
    } catch (err: any) {
      alert('Failed to submit batch adjustment: ' + (err?.message || 'Unknown error'));
    }
  };

  return (
	<div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px' }}>
      <style>{`
        input[type="number"].no-spinner::-webkit-inner-spin-button,
        input[type="number"].no-spinner::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type="number"].no-spinner {
          -moz-appearance: textfield;
          appearance: textfield;
        }
      `}</style>

      {/* Header with Back Button */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          onClick={() => navigate('/?tab=inventory')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            background: '#fff',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            color: '#374151',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#f9fafb';
            e.currentTarget.style.borderColor = '#9ca3af';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#fff';
            e.currentTarget.style.borderColor = '#d1d5db';
          }}
        >
          <ArrowLeft size={18} />
          Back to Inventory
        </button>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 }}>
          Stock Adjustment
        </h1>
      </div>

      {/* Single Column Layout */}
      <div style={{ 
        background: '#fff', 
        borderRadius: 12, 
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)', 
        padding: 32,
        marginBottom: 24
      }}>
        
        {/* Reason */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 14, color: '#374151', fontWeight: 600, display: 'block', marginBottom: 8 }}>
            Reason
          </label>
          <select 
            value={reason} 
            onChange={e => setReason(e.target.value)} 
            style={{ 
              width: '100%', 
              padding: '12px 16px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              fontSize: 15,
              background: '#fff',
              cursor: 'pointer',
              color: '#374151'
            }}
          >
            <option>Receive items</option>
            <option>Inventory Count</option>
            <option>Loss/Damage</option>
          </select>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 32 }}>
          <label style={{ fontSize: 14, color: '#374151', fontWeight: 600, display: 'block', marginBottom: 8 }}>
            Notes <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <textarea
            value={notes}
            onChange={e => {
              let val = e.target.value;
              if (val.length > 500) val = val.slice(0, 500);
              setNotes(val);
            }}
            style={{ 
              width: '100%', 
              padding: '12px 16px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              fontSize: 15,
              fontFamily: 'inherit',
              resize: 'vertical',
              minHeight: 100,
              color: '#374151'
            }}
            rows={4}
            maxLength={500}
            placeholder="Enter adjustment notes..."
          />
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4, textAlign: 'right' }}>
            {notes.length} / 500
          </div>
        </div>

        {/* Items Section */}
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: '#374151' }}>
            Items
          </h3>
          
          {/* Table Headers */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: reason === 'Inventory Count' ? '3fr 1fr 1fr auto' : '3fr 1fr 1fr 1fr auto',
            gap: 16,
            padding: '12px 16px',
            background: '#f9fafb',
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 13,
            fontWeight: 600,
            color: '#6b7280'
          }}>
            <div>Item</div>
            {reason === 'Inventory Count' ? (
              <>
                <div style={{ textAlign: 'center' }}>Expected stock</div>
                <div style={{ textAlign: 'center' }}>Counted stock</div>
                <div style={{ width: 40 }}></div>
              </>
            ) : reason === 'Loss/Damage' ? (
              <>
                <div style={{ textAlign: 'center' }}>In stock</div>
                <div style={{ textAlign: 'center' }}>Remove stock</div>
                <div style={{ textAlign: 'center' }}>Stock after</div>
                <div style={{ width: 40 }}></div>
              </>
            ) : (
              <>
                <div style={{ textAlign: 'center' }}>In stock</div>
                <div style={{ textAlign: 'center' }}>Add stock</div>
                <div style={{ textAlign: 'center' }}>Stock after</div>
                <div style={{ width: 40 }}></div>
              </>
            )}
          </div>

          {/* Search Item Input */}
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Search item"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                fontSize: 15,
                outline: 'none',
                transition: 'border 0.2s',
                color: '#374151'
              }}
              onFocus={(e) => e.target.style.borderColor = '#3bb764'}
              onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
            />
            
            {/* Dropdown for search results */}
            {search.trim() && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                marginTop: 4,
                maxHeight: 300,
                overflowY: 'auto',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                zIndex: 100
              }}>
                {results.length === 0 ? (
                  <div style={{ padding: '16px', textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
                    {loading ? 'Searching...' : 'No product found'}
                  </div>
                ) : results.map((row) => (
                  <div
                    key={row.id}
                    onClick={() => handleAddProductToBatch(row)}
                    style={{
                      padding: '12px 16px',
                      cursor: 'pointer',
                      borderBottom: '1px solid #f3f4f6',
                      transition: 'background 0.15s',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f9fafb'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#fff'}
                  >
                    {row.imageUrl || row.imageURL ? (
                      <img
                        src={row.imageUrl || row.imageURL}
                        alt={row.product}
                        style={{ 
                          width: 40, 
                          height: 40, 
                          borderRadius: 6, 
                          objectFit: 'cover',
                          border: '1px solid #e5e7eb'
                        }}
                      />
                    ) : (
                      <div style={{ 
                        width: 40, 
                        height: 40, 
                        borderRadius: 6, 
                        background: '#f3f4f6', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        fontSize: 20 
                      }}>
                        📦
                      </div>
                    )}
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
                        {row.product}
                        {row.status === 'inactive' && (
                          <span style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: '#6b7280',
                            background: '#f3f4f6',
                            border: '1px solid #e5e7eb',
                            borderRadius: 4,
                            padding: '2px 6px',
                            textTransform: 'uppercase',
                            letterSpacing: 0.4
                          }}>
                            Inactive
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        Stock: {row.stock || 0}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Adjustment Items Table Rows */}
          {adjustmentItems.length > 0 && (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {adjustmentItems.map((item) => {
                const stockAfter = reason === 'Receive items' 
                  ? item.currentStock + (item.addStock || 0)
                  : reason === 'Inventory Count'
                  ? (item.addStock || 0)
                  : item.currentStock - (item.addStock || 0);

                return (
                  <div 
                    key={item.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: reason === 'Inventory Count' ? '3fr 1fr 1fr auto' : '3fr 1fr 1fr 1fr auto',
                      gap: 16,
                      padding: '12px 16px',
                      background: '#f9fafb',
                      borderRadius: 8,
                      alignItems: 'center',
                      border: '1px solid #e5e7eb'
                    }}
                  >
                    {/* Item */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {item.imageUrl && (
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 6,
                            objectFit: 'cover',
                            border: '1px solid #e5e7eb'
                          }}
                        />
                      )}
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>
                          {item.name}
                        </div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>
                          {item.variationName}
                        </div>
                      </div>
                    </div>

                    {reason === 'Inventory Count' ? (
                      <>
                        {/* Expected stock */}
                        <div style={{ textAlign: 'center', fontSize: 14, color: '#374151', fontWeight: 500 }}>
                          {item.currentStock}
                        </div>

                        {/* Counted stock */}
                        <div style={{ textAlign: 'center' }}>
                          <input
                            type="number"
                            className="no-spinner"
                            value={item.addStock}
                            onChange={(e) => handleUpdateAddStock(item.id, Number(e.target.value))}
                            style={{
                              width: '100%',
                              padding: '8px',
                              borderRadius: 6,
                              border: '1px solid #d1d5db',
                              textAlign: 'center',
                              fontSize: 14
                            }}
                            min="0"
                          />
                        </div>
                      </>
                    ) : reason === 'Loss/Damage' ? (
                      <>
                        {/* In stock */}
                        <div style={{ textAlign: 'center', fontSize: 14, color: '#374151', fontWeight: 500 }}>
                          {item.currentStock}
                        </div>

                        {/* Remove stock */}
                        <div style={{ textAlign: 'center' }}>
                          <input
                            type="number"
                            className="no-spinner"
                            value={item.addStock}
                            onChange={(e) => handleUpdateAddStock(item.id, Number(e.target.value))}
                            style={{
                              width: '100%',
                              padding: '8px',
                              borderRadius: 6,
                              border: '1px solid #d1d5db',
                              textAlign: 'center',
                              fontSize: 14
                            }}
                            min="0"
                          />
                        </div>

                        {/* Stock after */}
                        <div style={{ textAlign: 'center', fontSize: 14, color: '#374151', fontWeight: 600 }}>
                          {stockAfter}
                        </div>
                      </>
                    ) : (
                      <>
                        {/* In stock */}
                        <div style={{ textAlign: 'center', fontSize: 14, color: '#374151', fontWeight: 500 }}>
                          {item.currentStock}
                        </div>

                        {/* Add stock */}
                        <div style={{ textAlign: 'center' }}>
                          <input
                            type="number"
                            className="no-spinner"
                            value={item.addStock}
                            onChange={(e) => handleUpdateAddStock(item.id, Number(e.target.value))}
                            style={{
                              width: '100%',
                              padding: '8px',
                              borderRadius: 6,
                              border: '1px solid #d1d5db',
                              textAlign: 'center',
                              fontSize: 14
                            }}
                            min="0"
                          />
                        </div>

                        {/* Stock after */}
                        <div style={{ textAlign: 'center', fontSize: 14, color: '#374151', fontWeight: 600 }}>
                          {stockAfter}
                        </div>
                      </>
                    )}

                    {/* Remove button */}
                    <button
                      onClick={() => handleRemoveItem(item.id)}
                      style={{
                        background: '#ef4444',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        padding: '6px 12px',
                        fontSize: 12,
                        cursor: 'pointer',
                        fontWeight: 500
                      }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 12, marginTop: 32, justifyContent: 'flex-end' }}>
          <button
            onClick={() => {
              setNotes('');
              setAdjustmentItems([]);
              setSearch('');
            }}
            style={{
              background: '#fff',
              color: '#6b7280',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              padding: '12px 24px',
              fontWeight: 600,
              fontSize: 15,
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            CANCEL
          </button>
          <button
            onClick={handleSubmitBatchAdjustment}
            disabled={!notes.trim() || adjustmentItems.length === 0}
            style={{
              background: (notes.trim() && adjustmentItems.length > 0) ? '#3bb764' : '#9ca3af',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '12px 32px',
              fontWeight: 600,
              fontSize: 15,
              cursor: (notes.trim() && adjustmentItems.length > 0) ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s'
            }}
          >
            ADJUST
          </button>
        </div>
      </div>

      {/* Variation Selection Modal */}
      {showVariationModal && selectedProduct && (
        <>
          {/* Backdrop */}
          <div 
            onClick={() => setShowVariationModal(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              zIndex: 1000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {/* Modal */}
            <div 
              onClick={(e) => e.stopPropagation()}
              style={{
                background: '#fff',
                borderRadius: 12,
                padding: 32,
                maxWidth: 600,
                width: '90%',
                maxHeight: '80vh',
                overflowY: 'auto',
                boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
              }}
            >
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: '#111827' }}>
                Select Variations
              </h2>
              <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 24 }}>
                Choose which variations of "{selectedProduct.product || selectedProduct.name}" to add
              </p>

              {/* Variations List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                {variations && variations.length > 0 ? (
                  variations.map((variation: any) => (
                    <div
                      key={variation.id}
                      onClick={() => toggleVariationSelection(variation.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: 16,
                        border: selectedVariations.has(variation.id) ? '2px solid #3bb764' : '1px solid #e5e7eb',
                        borderRadius: 8,
                        cursor: 'pointer',
                        background: selectedVariations.has(variation.id) ? '#f0fdf4' : '#fff',
                        transition: 'all 0.2s'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedVariations.has(variation.id)}
                        onChange={() => {}}
                        style={{ width: 18, height: 18, cursor: 'pointer' }}
                      />
                      {variation.imageUrl && (
                        <img
                          src={variation.imageUrl}
                          alt={variation.name}
                          style={{
                            width: 48,
                            height: 48,
                            borderRadius: 6,
                            objectFit: 'cover',
                            border: '1px solid #e5e7eb'
                          }}
                        />
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 15, color: '#111827' }}>
                          {variation.name || 'Default'}
                        </div>
                        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
                          Stock: {variation.stock || 0}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ textAlign: 'center', padding: 32, color: '#9ca3af' }}>
                    No variations found
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  onClick={() => setShowVariationModal(false)}
                  style={{
                    flex: 1,
                    background: '#fff',
                    color: '#6b7280',
                    border: '1px solid #d1d5db',
                    borderRadius: 8,
                    padding: '12px 24px',
                    fontWeight: 600,
                    fontSize: 15,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmVariations}
                  disabled={selectedVariations.size === 0}
                  style={{
                    flex: 1,
                    background: selectedVariations.size > 0 ? '#3bb764' : '#9ca3af',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '12px 24px',
                    fontWeight: 600,
                    fontSize: 15,
                    cursor: selectedVariations.size > 0 ? 'pointer' : 'not-allowed'
                  }}
                >
                  Add Selected ({selectedVariations.size})
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Success Dialog */}
      {showSuccessDialog && (
        <div 
          role="dialog"
          aria-modal="true"
          aria-labelledby="success-dialog-title"
          onClick={() => setShowSuccessDialog(false)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'white',
              borderRadius: 12,
              padding: 32,
              maxWidth: 400,
              textAlign: 'center',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
            }}
          >
            <div style={{
              width: 64,
              height: 64,
              backgroundColor: '#10b981',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px'
            }}>
              <CheckCircle style={{ width: 40, height: 40, color: 'white' }} />
            </div>
            <h3 
              id="success-dialog-title"
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: '#1f2937',
                marginBottom: 8
              }}
            >
              Success!
            </h3>
            <p style={{
              fontSize: 14,
              color: '#6b7280',
              marginBottom: 24
            }}>
              {successMessage}
            </p>
            <button
              onClick={() => setShowSuccessDialog(false)}
              style={{
                padding: '10px 24px',
                backgroundColor: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#059669'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = '#10b981'}
            >
              OK
            </button>
          </div>
        </div>
      )}
	</div>
	);
};

export default StockAdjustment;