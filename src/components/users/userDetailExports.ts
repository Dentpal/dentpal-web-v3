import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { UserOrder, StoreBreakdown } from './useUserOrders';
import { fmtDateTime, formatCurrency } from './formatters';

/* ── PDF Export ─────────────────────────────────────────── */

export function exportUserOrdersPdf(
  userName: string,
  orders: UserOrder[],
  summary: { totalOrders: number; totalSpent: number; totalItems: number },
  storeBreakdown: StoreBreakdown[]
) {
  const doc = new jsPDF({ orientation: 'landscape' });
  const now = new Date().toLocaleString('en-US');

  // Title
  doc.setFontSize(16);
  doc.text(`User Order Report`, 14, 15);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`User: ${userName}`, 14, 22);
  doc.text(`Generated: ${now}`, 14, 27);

  // Summary
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text(`Total Orders: ${summary.totalOrders}    |    Total Spent: ${formatCurrency(summary.totalSpent)}    |    Items Purchased: ${summary.totalItems}`, 14, 35);

  // Order History Table
  const orderRows = orders.map(o => [
    o.id.slice(0, 10),
    o.sellerName || '—',
    o.itemsBrief || '—',
    formatCurrency(o.total),
    fmtDateTime(o.createdAt),
  ]);

  autoTable(doc, {
    startY: 40,
    head: [['Order ID', 'Store', 'Items', 'Total', 'Date']],
    body: orderRows,
    headStyles: { fillColor: [13, 148, 136], fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [245, 245, 245] },
  });

  // Store Breakdown Table
  const lastY = (doc as any).lastAutoTable?.finalY ?? 120;
  if (storeBreakdown.length > 0) {
    doc.setFontSize(12);
    doc.text('Store Breakdown', 14, lastY + 10);

    const total = storeBreakdown.reduce((s, b) => s + b.amount, 0);
    const storeRows = storeBreakdown.map(b => [
      b.storeName,
      String(b.orderCount),
      formatCurrency(b.amount),
      total > 0 ? `${((b.amount / total) * 100).toFixed(1)}%` : '0%',
    ]);

    autoTable(doc, {
      startY: lastY + 14,
      head: [['Store', 'Orders', 'Total Spent', '% of Total']],
      body: storeRows,
      headStyles: { fillColor: [79, 70, 229], fontSize: 9 },
      bodyStyles: { fontSize: 8 },
    });
  }

  const safeName = userName.replace(/[^a-zA-Z0-9]/g, '_');
  doc.save(`user_orders_${safeName}_${Date.now()}.pdf`);
}

/* ── Excel Export ───────────────────────────────────────── */

export async function exportUserOrdersExcel(
  userName: string,
  orders: UserOrder[],
  storeBreakdown: StoreBreakdown[],
  summary: { totalOrders: number; totalSpent: number; totalItems: number }
) {
  const wb = new ExcelJS.Workbook();

  // Sheet 1: Order History
  const ws1 = wb.addWorksheet('Order History');
  ws1.addRow(['User Order Report']);
  ws1.addRow([`User: ${userName}`]);
  ws1.addRow([`Total Orders: ${summary.totalOrders}`, `Total Spent: ${formatCurrency(summary.totalSpent)}`, `Items Purchased: ${summary.totalItems}`]);
  ws1.addRow([]);

  const headerRow = ws1.addRow(['Order ID', 'Store', 'Items', 'Total (PHP)', 'Date']);
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D9488' } };
  });

  orders.forEach(o => {
    ws1.addRow([o.id, o.sellerName || '—', o.itemsBrief || '—', o.total, fmtDateTime(o.createdAt)]);
  });

  // Auto-width
  ws1.columns.forEach(col => {
    let max = 12;
    col.eachCell?.({ includeEmpty: false }, cell => {
      const len = String(cell.value || '').length;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 40);
  });

  // Sheet 2: Store Breakdown
  if (storeBreakdown.length > 0) {
    const ws2 = wb.addWorksheet('Store Breakdown');
    const total = storeBreakdown.reduce((s, b) => s + b.amount, 0);
    const storeHeader = ws2.addRow(['Store', 'Orders', 'Total Spent (PHP)', '% of Total']);
    storeHeader.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    });
    storeBreakdown.forEach(b => {
      ws2.addRow([b.storeName, b.orderCount, b.amount, total > 0 ? `${((b.amount / total) * 100).toFixed(1)}%` : '0%']);
    });
    ws2.columns.forEach(col => {
      let max = 12;
      col.eachCell?.({ includeEmpty: false }, cell => {
        const len = String(cell.value || '').length;
        if (len > max) max = len;
      });
      col.width = Math.min(max + 2, 40);
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const safeName = userName.replace(/[^a-zA-Z0-9]/g, '_');
  saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `user_orders_${safeName}_${Date.now()}.xlsx`);
}
