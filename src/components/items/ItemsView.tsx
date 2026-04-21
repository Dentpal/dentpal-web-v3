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
        {/* Back to List + Bulk Item on the same row */}
        <div className="flex items-center justify-between mb-5">
          <button
            onClick={() => setShowAddForm(false)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-500 text-white rounded-lg text-sm font-semibold hover:bg-gray-600 transition"
          >
            <ArrowLeft size={18} />
            Back to Item List
          </button>
          <button
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.set('tab', 'items-bulk');
              window.history.pushState({}, '', url.pathname + url.search);
              window.dispatchEvent(new Event('popstate'));
            }}
            className="px-4 py-2.5 rounded-lg bg-indigo-600 text-white font-semibold text-sm shadow hover:bg-indigo-700 transition"
          >
            Bulk Item
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
