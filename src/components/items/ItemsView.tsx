/**
 * ItemsView - Combined Items view with list and inline add form
 * 
 * Shows item list by default with "Add Item" button
 * When clicked, shows the add item form inline (not as modal)
 */

import React, { useState } from 'react';
import ItemsList from './ItemsList';
import AddItem from './AddItem';
import { ArrowLeft } from 'lucide-react';

const ItemsView: React.FC = () => {
  const [showAddForm, setShowAddForm] = useState(false);

  const handleAddSuccess = () => {
    setShowAddForm(false);
  };

  if (showAddForm) {
    return (
      <div>
        {/* Back to List Button */}
        <div style={{ marginBottom: 20 }}>
          <button
            onClick={() => setShowAddForm(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 20px',
              background: '#6b7280',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#4b5563'}
            onMouseLeave={(e) => e.currentTarget.style.background = '#6b7280'}
          >
            <ArrowLeft size={18} />
            Back to Item List
          </button>
        </div>

        {/* Add Item Form */}
        <AddItem onSuccess={handleAddSuccess} />
      </div>
    );
  }

  return (
    <ItemsListWrapper onAddItem={() => setShowAddForm(true)} />
  );
};

// Wrapper to inject the Add Item button functionality
const ItemsListWrapper: React.FC<{ onAddItem: () => void }> = ({ onAddItem }) => {
  return <ItemsList onAddItemClick={onAddItem} />;
};

export default ItemsView;
