import React, { useState, useEffect } from 'react';
import ImageSelect from './ImageSelect';
import VariationAdjustmentRow from './VariationAdjustmentRow';

interface StockAdjustmentModalProps {
  open: boolean;
  onClose: () => void;
  reason: string;
  setReason: (val: string) => void;
  notes: string;
  setNotes: (val: string) => void;
  currentProduct: any | null;
  variations: any[];
  onConfirmProduct: (selectedVariationData: {[variationId: string]: {selected: boolean; adjustmentValue: number}}) => void;
  modalError: string;
  setModalError: (error: string) => void;
}

const StockAdjustmentModal: React.FC<StockAdjustmentModalProps> = ({
  open,
  onClose,
  reason,
  setReason,
  notes,
  setNotes,
  currentProduct,
  variations,
  onConfirmProduct,
  modalError,
  setModalError,
}) => {
  const [localVariationAdjustments, setLocalVariationAdjustments] = useState<{[id: string]: number}>({});
  const [localSelectedVariations, setLocalSelectedVariations] = useState<{[id: string]: boolean}>({});

  // Reset local state when product changes
  useEffect(() => {
    if (currentProduct) {
      setLocalVariationAdjustments({});
      setLocalSelectedVariations({});
      setModalError('');
    }
  }, [currentProduct?.id]);

  if (!open) return null;

  let type: 'add' | 'count' | 'remove' = 'add';
  if (reason === 'Inventory Count') type = 'count';
  if (reason === 'Loss/Damage') type = 'remove';

  const handleAddProduct = () => {
    const hasSelected = Object.values(localSelectedVariations).some(v => v);
    if (!hasSelected) {
      setModalError('Please select at least one variation');
      return;
    }

    // Validate adjustments
    const hasValidAdjustments = Object.entries(localSelectedVariations).some(([varId, selected]) => {
      if (!selected) return false;
      const adjustment = localVariationAdjustments[varId] || 0;
      if (reason === 'Receive Items' || reason === 'Loss/Damage') {
        return adjustment > 0;
      }
      return true; // Inventory Count can be 0
    });

    if (!hasValidAdjustments) {
      setModalError('Please enter valid adjustment values for selected variations');
      return;
    }

    // Prepare data
    const selectedData: {[variationId: string]: {selected: boolean; adjustmentValue: number}} = {};
    Object.keys(localSelectedVariations).forEach(varId => {
      selectedData[varId] = {
        selected: localSelectedVariations[varId] || false,
        adjustmentValue: localVariationAdjustments[varId] || 0
      };
    });

    onConfirmProduct(selectedData);
    
    // Reset local state
    setLocalVariationAdjustments({});
    setLocalSelectedVariations({});
  };

  const isProductSelection = currentProduct !== null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      background: 'rgba(0,0,0,0.3)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{ 
        background: '#fff', 
        borderRadius: 12, 
        padding: 32, 
        minWidth: 500, 
        maxWidth: 700,
        maxHeight: '80vh',
        overflow: 'auto',
        boxShadow: '0 2px 16px #0002', 
        position: 'relative' 
      }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 18, color: '#111827' }}>
          {currentProduct ? `Select Variations: ${currentProduct.product || currentProduct.name}` : 'Product Selection'}
        </h2>

        {/* Show current reason */}
        {currentProduct && (
          <div style={{ 
            background: '#f0fdf4', 
            border: '1px solid #3bb764', 
            borderRadius: 8, 
            padding: 12, 
            marginBottom: 18 
          }}>
            <div style={{ fontSize: 13, color: '#166534', marginBottom: 4 }}>
              <strong>Adjustment Reason:</strong> {reason}
            </div>
            <div style={{ fontSize: 12, color: '#16803d' }}>
              Select variations below and enter adjustment values
            </div>
          </div>
        )}

        {/* Product Variation Selection */}
        {isProductSelection && variations.length > 0 && (
          <>
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontWeight: 600 }}>Current Reason: {reason}</label>
              <p style={{ fontSize: 13, color: '#666', marginTop: 4 }}>Select variations and enter adjustment values below</p>
            </div>
            
            <div style={{ marginBottom: 18, maxHeight: 400, overflow: 'auto' }}>
              {variations.map(variation => (
                <div key={variation.id} style={{ 
                  marginBottom: 16, 
                  padding: 16, 
                  border: localSelectedVariations[variation.id] ? '2px solid #3bb764' : '1px solid #e5e7eb',
                  borderRadius: 8,
                  background: localSelectedVariations[variation.id] ? '#f0fdf4' : '#fff'
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                    <input
                      type="checkbox"
                      checked={localSelectedVariations[variation.id] || false}
                      onChange={e => {
                        setLocalSelectedVariations(prev => ({
                          ...prev,
                          [variation.id]: e.target.checked
                        }));
                      }}
                      style={{ marginTop: 20, cursor: 'pointer', width: 18, height: 18 }}
                    />
                    {(variation.imageURL || variation.imageUrl) ? (
                      <img
                        src={variation.imageURL || variation.imageUrl}
                        alt={variation.name || variation.id}
                        style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', background: '#f3f4f6' }}
                      />
                    ) : (
                      <div style={{ width: 56, height: 56, borderRadius: 8, background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 28 }}>
                        <span role="img" aria-label="variation">📦</span>
                      </div>
                    )}
                    <div style={{ flex: 1 }}>
                      <VariationAdjustmentRow
                        variation={variation}
                        value={localVariationAdjustments[variation.id] || 0}
                        type={type}
                        onChange={val => setLocalVariationAdjustments(prev => ({ ...prev, [variation.id]: val }))}
                        disabled={!localSelectedVariations[variation.id]}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
          <button 
            onClick={onClose} 
            style={{ 
              padding: '10px 24px', 
              borderRadius: 6, 
              background: '#eee', 
              border: 'none',
              fontWeight: 500,
              cursor: 'pointer',
              fontSize: 15
            }}
          >
            {isProductSelection ? 'Cancel' : 'Close'}
          </button>
          {isProductSelection ? (
            <button
              style={{ 
                padding: '10px 24px', 
                borderRadius: 6, 
                background: '#3bb764', 
                color: '#fff', 
                fontWeight: 500, 
                boxShadow: '0 2px 8px 0 #3bb76422', 
                border: 'none', 
                fontSize: 15, 
                cursor: 'pointer',
                transition: 'background 0.2s' 
              }}
              onClick={handleAddProduct}
            >
              Add to Batch
            </button>
          ) : null}
        </div>

        {modalError && (
          <div style={{ color: '#dc2626', marginTop: 16, fontSize: 14, fontWeight: 500, textAlign: 'center', background: '#fee', padding: 12, borderRadius: 6 }}>
            {modalError}
          </div>
        )}
      </div>
    </div>
  );
};

export default StockAdjustmentModal;
