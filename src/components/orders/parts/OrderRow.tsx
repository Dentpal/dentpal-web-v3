import React from 'react';
import { Order } from '@/types/order';
import { ChevronDown, ChevronUp, Printer, FileText, Download, Eye, Loader2, Package } from 'lucide-react';
import QRCode from 'qrcode';
import dentpalLogo from '@/assets/dentpal_logo.png';

interface OrderRowProps {
  order: Order;
  onDetails?: () => void; 
  onClick?: () => void;   
  isToShip?: boolean;    
  onMoveToArrangement?: (order: Order) => void; 
  onMoveToHandOver?: (order: Order) => void; 
  onConfirmHandover?: (order: Order) => void;
  onMoveToPack?: (order: Order) => void; // Move back from arrangement to pack
  onMoveToShipping?: (order: Order) => void; // Move from hand-over to shipping
  isShippingLoading?: boolean; // Loading state for shipping requests
  // Checkbox selection support
  isSelectable?: boolean; // Whether this order can be selected with checkbox
  isSelected?: boolean; // Whether this order is currently selected
  onToggleSelect?: (order: Order) => void; // Callback when checkbox is toggled
}

const buildInvoiceHTML = async (order: Order) => {
  const currency = order.currency || 'PHP';
  const total = order.total != null ? order.total : '';
  const hasItems = Array.isArray(order.items) && order.items.length > 0;
  
  // Format status for display
  const formattedStatus = order.status
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  
  // Load and convert logo to base64
  let logoDataUrl = '';
  try {
    // Use imported asset path (bundler resolves this correctly)
    const response = await fetch(dentpalLogo);
    const blob = await response.blob();
    logoDataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.error('Failed to load logo:', err);
  }
  
  // Generate QR code for tracking ID
  const trackingId = order.shippingInfo?.jrs?.trackingId || 'N/A';
  let qrCodeDataUrl = '';
  try {
    qrCodeDataUrl = await QRCode.toDataURL(trackingId, {
      width: 120,
      margin: 1,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });
  } catch (err) {
    console.error('Failed to generate QR code:', err);
  }
  const itemsMarkup = hasItems
    ? `<table style="width:100%; border-collapse:collapse; margin-top:8px;">
         <thead>
           <tr>
             <th align="left" style="border-bottom:1px solid #e2e8f0; padding:8px 0; font-size:12px; color:#64748b;">Item</th>
             <th align="right" style="border-bottom:1px solid #e2e8f0; padding:8px 0; font-size:12px; color:#64748b;">Qty</th>
             <th align="right" style="border-bottom:1px solid #e2e8f0; padding:8px 0; font-size:12px; color:#64748b;">Price</th>
           </tr>
         </thead>
         <tbody>
           ${order.items!.map(it => `<tr>
             <td style="padding:10px 0; border-bottom:1px solid #f1f5f9;">${it.name}</td>
             <td align="right" style="padding:10px 0; border-bottom:1px solid #f1f5f9;">${it.quantity}</td>
             <td align="right" style="padding:10px 0; border-bottom:1px solid #f1f5f9;">${it.price != null ? currency + ' ' + it.price : ''}</td>
           </tr>`).join('')}
         </tbody>
       </table>`
    : `<div class="items">${order.itemsBrief || `${order.orderCount} item(s)`}</div>`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Invoice ${order.id}</title>
  <style>
    :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --brand:#0d9488; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"; color: var(--ink); }
    .sheet { max-width: 800px; margin: 24px auto; padding: 32px; border: 1px solid var(--line); border-radius: 16px; }
    .header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding-bottom:16px; border-bottom:1px solid var(--line); }
    .brand { display:flex; align-items:center; gap:12px; }
    .brand-badge { width:48px; height:48px; object-fit:contain; }
    .title { font-size:20px; font-weight:700; }
    .meta { text-align:right; font-size:12px; color: var(--muted); }
    .section { padding:16px 0; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .grid-three { display:grid; grid-template-columns:1fr 1fr auto; gap:16px; align-items:start; }
    .label { font-size:12px; color: var(--muted); }
    .value { font-size:14px; font-weight:600; }
    .row { display:flex; align-items:center; justify-content:space-between; gap:12px; }
    .badge { display:inline-flex; align-items:center; gap:6px; padding:4px 8px; font-size:11px; border-radius:999px; border:1px solid var(--line); color:#0f172a; }
    .items { background:#f8fafc; border:1px solid var(--line); border-radius:12px; padding:12px; }
    .total { font-size:18px; font-weight:700; }
    .footer { margin-top:24px; padding-top:16px; border-top:1px solid var(--line); font-size:12px; color: var(--muted); }
    @media print { body { background:white; } .sheet { border:none; box-shadow:none; margin:0; border-radius:0; } .actions { display:none !important; } @page { size: A4; margin: 16mm; } }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div class="brand">
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="DentPal Logo" class="brand-badge" />` : '<div style="width:48px; height:48px; border-radius:10px; background:linear-gradient(135deg,#0ea5e9,#0d9488);"></div>'}
        <div class="title">Waybill</div>
      </div>
      <div class="meta">
        <div><strong>Order #</strong> ${order.id}</div>
        <div>${order.timestamp}</div>
      </div>
    </div>

    <div class="section grid-three">
      <div>
        <div class="label">Buyer</div>
        <div class="value">${order.customer.name || ''}</div>
        <div class="label" style="margin-top:8px">Contact</div>
        <div class="value">${order.customer.contact || ''}</div>
      </div>
      <div>
        <div class="label">Status</div>
        <div class="badge">${formattedStatus}</div>
        <div class="label" style="margin-top:8px">Tracking ID</div>
        <div class="value" style="margin-top:4px;">${trackingId}</div>
      </div>
<div style="display:flex; flex-direction:column; align-items:flex-start; justify-content:flex-start;">
        <div class="label" style="text-align:center; margin-bottom:8px;">QR Code</div>
        ${qrCodeDataUrl ? `<img src="${qrCodeDataUrl}" alt="QR Code" style="width:100px; height:100px; border:1px solid var(--line); border-radius:8px; padding:4px; background:white;" />` : '<div style="width:100px; height:100px; border:1px dashed var(--line); border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:10px; color:var(--muted);">No QR</div>'}
      </div>
    </div>

    <div class="section">
      <div class="label">Items</div>
      ${itemsMarkup}
    </div>

    <div class="section" style="display:grid; grid-template-columns:1fr 1fr; gap:16px; align-items:end;">
      <div>
        <div class="label">Package</div>
        <div style="font-size:13px; color:#6b7280; margin-top:4px;">
          ${order.package?.size || '—'}
        </div>
        <div class="label" style="margin-top:12px;">Shipping Fee</div>
        <div style="font-size:13px; color:#6b7280; margin-top:4px;">
          ${typeof order.summary?.shippingCost === 'number' ? `${order.currency || 'PHP'} ${order.summary.shippingCost}` : '—'}
        </div>
      </div>
      <div style="text-align:right;">
        <div class="label">Total Amount</div>
        <div class="total">${currency} ${total}</div>
      </div>
    </div>

    <div class="footer">
      Thanks for your purchase. This is a system-generated waybill. For concerns, contact support.
    </div>
    <div class="actions" style="margin-top:16px">
      <button onclick="window.print()" style="padding:10px 14px; border:1px solid var(--line); border-radius:10px; background:white; cursor:pointer">Print</button>
    </div>
  </div>
</body>
</html>`;
};

const printInvoice = async (order: Order) => {
  const html = await buildInvoiceHTML(order);
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 200);
};

const exportCSV = (order: Order) => {
  const rows: string[][] = [];
  rows.push(['Order ID','Date','Buyer','Contact','Status','Currency']);
  rows.push([order.id, order.timestamp, order.customer.name, order.customer.contact, order.status, order.currency || 'PHP']);
  rows.push([]);
  rows.push(['Items']);
  rows.push(['Name','Quantity','Price']);
  if (Array.isArray(order.items) && order.items.length > 0) {
    order.items.forEach(it => rows.push([it.name, String(it.quantity), it.price != null ? String(it.price) : '']));
  } else {
    rows.push([order.itemsBrief || `${order.orderCount} item(s)`, '', '']);
  }
  rows.push([]);
  rows.push(['Package', '', order.package?.size]);
  rows.push(['Shipping Fee', '', typeof order.summary?.shippingCost === 'number' ? String(order.summary.shippingCost) : '—']);
  rows.push(['Total', '', String(order.total ?? '')]);

  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `order-${order.id}-${order.timestamp}.csv`; a.click();
  URL.revokeObjectURL(url);
};

const exportPDF = (order: Order) => {
  printInvoice(order);
};

const moveToArrangement = (order: Order, onMove?: (order: Order) => void) => {
  if (onMove) {
    onMove(order);
  } else {
    console.log(`Moving order ${order.id} to arrangement`);
    alert(`Order ${order.id} moved to Arrangement stage`);
  }
};

// Helper function to format status: replace underscores with spaces and capitalize each word
const formatStatus = (status: string): string => {
  return status
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

const OrderRow: React.FC<OrderRowProps> = ({ 
  order, 
  onDetails, 
  onClick, 
  isToShip = false, 
  onMoveToArrangement, 
  onMoveToHandOver, 
  onConfirmHandover, 
  onMoveToPack, 
  onMoveToShipping, 
  isShippingLoading = false,
  isSelectable = false,
  isSelected = false,
  onToggleSelect
}) => {
  const [open, setOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [itemsOpen, setItemsOpen] = React.useState(false);

  const hasMultiItems = Array.isArray(order.items) && order.items.length >= 2;

  const handleDetails = () => {
    if (onDetails) return onDetails();
    if (onClick) return onClick();
    setOpen(true);
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleSelect) {
      onToggleSelect(order);
    }
  };

  const handleMoveToArrangement = () => {
    // Safety check: prevent moving to-hand-over orders back to arrangement
    if (order.fulfillmentStage === 'to-hand-over') {
      console.warn('Cannot move to-hand-over order back to arrangement');
      return;
    }
    if (onMoveToArrangement) {
      onMoveToArrangement(order);
    } else {
      moveToArrangement(order);
    }
  };

  React.useEffect(() => {
    if (!menuOpen && !itemsOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const withinActions = target.closest?.('[data-actions-menu]');
      const withinItems = target.closest?.('[data-items-menu]');
      if (!withinActions) setMenuOpen(false);
      if (!withinItems) setItemsOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [menuOpen, itemsOpen]);

    return (
    <div 
      className="w-full bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
      onClick={handleDetails}
    >
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        {isSelectable && (
          <div className="flex items-center" onClick={handleCheckboxClick}>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => {}}
              className="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
            />
          </div>
        )}
        <div className="flex-1 flex items-center gap-6">
          {/* Date and time on separate lines */}
          <div className="w-32">
            <div className="text-sm font-medium text-gray-700">{order.timestamp?.split(' ')[0]}</div>
            <div className="text-xs text-gray-500">{order.timestamp?.split(' ').slice(1).join(' ')}</div>
          </div>
          {/* Product thumbnail */}
          {order.imageUrl ? (
            <img src={order.imageUrl} alt="Product" className="w-12 h-12 rounded-md object-cover border border-gray-200" />
          ) : (
            <div className="w-12 h-12 rounded-md bg-gray-100 border border-gray-200 flex items-center justify-center text-[10px] text-gray-400">No Image</div>
          )}
          {/* Order ID and items */}
          <div className="flex-1 min-w-[200px]" data-items-menu>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-gray-900">Order #{order.id}</p>
              {Array.isArray(order.items) && order.items.length >= 1 && (
                <button
                  type="button"
                  className="text-[11px] px-2 py-0.5 border border-gray-200 rounded-md hover:bg-gray-50 text-gray-700 flex items-center gap-1"
                  onClick={(e) => { e.stopPropagation(); setItemsOpen(v => !v); }}
                  title="Show items"
                >
                  {itemsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                </button>
              )}
              {(order.summary?.packagingSize || order.shippingInfo?.packagingSize) && (
                <span
                  className="text-[11px] px-2 py-0.5 border border-teal-200 rounded-md bg-teal-50 text-teal-700 flex items-center gap-1"
                  title="Packaging size"
                >
                  <Package className="w-3 h-3" />
                  {order.summary?.packagingSize || order.shippingInfo?.packagingSize}
                </span>
              )}
            </div>
            {/* Expanded items inline with animation */}
            {itemsOpen && Array.isArray(order.items) && order.items.length >= 1 && (
              <div className="mt-2 space-y-2 animate-in slide-in-from-top-2 duration-300">
                {order.items!.map((it, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-2 bg-gray-50 rounded-md">
                    {/* Changed from it.imageUrl to it.image assuming the field name */}
                    {(it as any).image ? (
                      <img src={(it as any).image} alt={(it as any).name} className="w-8 h-8 rounded-md object-cover border border-gray-200" />
                    ) : (
                      <div className="w-8 h-8 rounded-md bg-gray-100 border border-gray-200 flex items-center justify-center text-[8px] text-gray-400">No Image</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-900 truncate">{(it as any).name}</div>
                      {((it as any).sku || (it as any).productId) && (
                        <div className="text-[10px] text-gray-500 truncate">{(it as any).sku || (it as any).productId}</div>
                      )}
                    </div>
                    <div className="text-sm text-gray-700">x{(it as any).quantity}</div>
                    <div className="text-sm text-gray-900">{typeof (it as any).price !== 'undefined' ? `${order.currency || 'PHP'} ${(it as any).price}` : ''}</div>
                  </div>
                ))}
              </div>
            )}
            {order.total != null && (
              <p className="text-xs text-gray-500 mt-1">Total: {order.currency || 'PHP'} {order.total}</p>
            )}
          </div>
          {/* Status */}
          <div className="text-xs font-medium px-2 py-1 rounded bg-gray-100 text-gray-700">{formatStatus(order.status)}</div>
        </div>
        {/* Conditional rendering based on isToShip and fulfillmentStage */}
        {isToShip ? (
          order.fulfillmentStage === 'to-arrangement' ? (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="text-xs px-3 py-1 border border-teal-600 text-teal-700 rounded-md font-medium hover:bg-teal-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                onClick={() => onMoveToShipping?.(order)}
                disabled={isShippingLoading}
              >
                {isShippingLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                {isShippingLoading ? 'Create JRS Shipping →' : 'Create JRS Shipping →'}
              </button>
            </div>
          ) : order.fulfillmentStage === 'to-hand-over' ? (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="text-xs px-3 py-1 border border-orange-600 text-orange-700 rounded-md font-medium hover:bg-orange-50"
                onClick={() => onMoveToHandOver?.(order)}
              >
                Complete Handover →
              </button>
            </div>
          ) : (
            // Default (to-pack): No buttons shown - bulk action will be used instead
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {/* Buttons removed - will be replaced by bulk "Print Pack List" action */}
            </div>
          )
        ) : (
          // For other tabs, only show Actions dropdown (no Details button)
          <div className="relative" data-actions-menu onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="text-xs px-3 py-1 border border-gray-200 rounded-md hover:bg-gray-50 shadow-sm flex items-center gap-1"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}
              title="Invoice and export options"
            >
              Actions <ChevronDown className="w-3 h-3" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-10">
                <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2" onClick={() => { setMenuOpen(false); printInvoice(order); }}>
                  <Printer className="w-4 h-4" /> Print invoice
                </button>
                <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2" onClick={() => { setMenuOpen(false); exportCSV(order); }}>
                  <Download className="w-4 h-4" /> Export CSV
                </button>
                <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2" onClick={() => { setMenuOpen(false); exportPDF(order); }}>
                  <FileText className="w-4 h-4" /> Export PDF
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Details Modal (fallback if no external handler provided) */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-[92vw] max-w-2xl bg-white rounded-xl shadow-lg border border-gray-200 p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Order #{order.id}</h3>
                <div className="text-sm text-gray-500 mt-1">{order.timestamp}</div>
                <div className="text-sm text-gray-700 mt-3"><span className="font-medium">Buyer:</span> {order.customer?.name || '—'}</div>
                <div className="text-sm text-gray-500">{order.customer?.contact || '—'}</div>
              </div>
              <div className="flex flex-col items-end gap-2">
                {/* Keep a compact status chip visible in the header, but remove status list inside the body */}
                <div className="text-xs font-medium px-3 py-1 rounded bg-teal-50 text-teal-700">{formatStatus(order.status)}</div>
                <button className="text-xs px-3 py-1 rounded border border-gray-200 hover:bg-gray-50" onClick={() => setOpen(false)}>Close</button>
              </div>
            </div>

            {/* Items table */}
            <div className="border rounded-lg overflow-hidden">
              <div className="grid grid-cols-12 gap-2 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">
                <div className="col-span-1 flex items-center"> </div>
                <div className="col-span-6">Product</div>
                <div className="col-span-2 text-center">Qty</div>
                <div className="col-span-3 text-right">Price</div>
              </div>

              <div className="divide-y">
                {Array.isArray(order.items) && order.items.length > 0 ? (
                  order.items.map((it, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center px-3 py-3">
                      <div className="col-span-1 flex items-center">
                        <input type="checkbox" className="h-4 w-4 text-teal-600 border-gray-300 rounded" />
                      </div>

                      <div className="col-span-6 flex items-start gap-3 min-w-0">
                        {/* Thumbnail */}
                        {(it as any).image || (it as any).imageUrl ? (
                          <img src={(it as any).image || (it as any).imageUrl} alt={(it as any).name} className="w-10 h-10 rounded-md object-cover border border-gray-200 flex-shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded-md bg-gray-100 border border-gray-200 flex items-center justify-center text-[10px] text-gray-400">No Image</div>
                        )}

                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">{(it as any).name || 'Unnamed product'}</div>
                          <div className="text-[11px] text-gray-500 truncate mt-0.5">{(it as any).sku ? `SKU: ${(it as any).sku}` : (it as any).variation ? `Variant: ${(it as any).variation}` : (it as any).productId ? `Product: ${(it as any).productId}` : ''}</div>
                        </div>
                      </div>

                      <div className="col-span-2 text-center text-sm text-gray-700">{(it as any).quantity}</div>

                      <div className="col-span-3 text-right text-sm text-gray-900">{typeof (it as any).price !== 'undefined' ? `${order.currency || 'PHP'} ${(it as any).price}` : ''}</div>
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-4 text-sm text-gray-600">{order.itemsBrief || `${order.orderCount} item(s)`}</div>
                )}
              </div>
            </div>

            {/* Summary: Price Breakdown with Package and Shipping Fee */}
            <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="text-sm text-gray-600">
                <div className="font-medium">Package</div>
                <div className="text-sm text-gray-500 mt-1">
                  {/* Show ProductName from JRS response if available */}
                  {order.package?.size || '—'}
                </div>
                <div className="font-medium mt-3">Shipping Fee</div>
                <div className="text-sm text-gray-500 mt-1">
                  {typeof order.summary?.shippingCost === 'number' ? `${order.currency || 'PHP'} ${order.summary.shippingCost}` : '—'}
                </div>
              </div>

              <div className="text-right">
                <div className="text-xs text-gray-500">Total Amount</div>
                <div className="text-lg font-semibold">{order.currency || 'PHP'} {order.total != null ? order.total : ''}</div>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-3">
              <button className="text-sm px-3 py-2 rounded border border-gray-200 hover:bg-gray-50" onClick={() => setOpen(false)}>Close</button>
              {isToShip ? (
                order.fulfillmentStage === 'to-arrangement' ? (
                  <>
                    <button 
                      className="text-sm px-3 py-2 rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2" 
                      onClick={() => { onMoveToShipping?.(order); setOpen(false); }}
                      disabled={isShippingLoading}
                    >
                      {isShippingLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                      {isShippingLoading ? 'Creating JRS...' : 'Create JRS Shipping →'}
                    </button>
                  </>
                ) : order.fulfillmentStage === 'to-hand-over' ? (
                  <>
                    <button className="text-sm px-3 py-2 rounded bg-orange-600 text-white hover:bg-orange-700" onClick={() => { onMoveToHandOver?.(order); setOpen(false); }}>Complete Handover →</button>
                  </>
                ) : (
                  <button className="text-sm px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700" onClick={() => { onMoveToArrangement?.(order); setOpen(false); }}>To Arrangement →</button>
                )
              ) : (
                <button className="text-sm px-3 py-2 rounded bg-teal-600 text-white hover:bg-teal-700" onClick={() => { printInvoice(order); setOpen(false); }}>Print Invoice</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderRow;