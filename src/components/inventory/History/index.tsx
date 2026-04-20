import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAllLogsHistory } from './useAllLogsHistory';

type DateRange = { start: Date | null; end: Date | null };
import DateRangePicker from '@/components/ui/DateRangePicker';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from '@/components/ui/sheet';

const ITEMS_PER_PAGE = 15;

const History: React.FC = () => {
	const navigate = useNavigate();
	const { logs, loading } = useAllLogsHistory();
	const [search, setSearch] = useState('');
	const [dateRange, setDateRange] = useState<DateRange>({ start: null, end: null });
	const [selectedLog, setSelectedLog] = useState<any | null>(null);
	const [sheetOpen, setSheetOpen] = useState(false);
	const [page, setPage] = useState(1);

	// Reset to page 1 when filters change
	React.useEffect(() => { setPage(1); }, [search, dateRange]);

	// Filter logs by search, date, and adjustment !== 0 (but allow batch adjustments)
	const filteredLogs = logs.filter(row => {
		// Allow batch adjustments even if adjustment is 0
		if (!row.isBatch && row.adjustment === 0) return false;
		
			const matchesSearch =
				!search ||
				row.productName?.toLowerCase().includes(search.toLowerCase()) ||
				row.variationName?.toLowerCase().includes(search.toLowerCase()) ||
				row.reason?.toLowerCase().includes(search.toLowerCase()) ||
				row.modifiedByName?.toLowerCase().includes(search.toLowerCase());
			// Use timestampRaw for reliable date filtering
			let logDate: Date | null = null;
			if (row.timestampRaw) {
				if (typeof row.timestampRaw === 'number') {
					logDate = new Date(row.timestampRaw);
				} else if (typeof row.timestampRaw === 'string') {
					logDate = new Date(row.timestampRaw);
				}
			}
			const inDateRange =
				(!dateRange.start && !dateRange.end) ||
				(logDate && dateRange.start && dateRange.end &&
					logDate >= dateRange.start && logDate <= dateRange.end);
			return matchesSearch && inDateRange;
		});

	const totalPages = Math.max(1, Math.ceil(filteredLogs.length / ITEMS_PER_PAGE));
	const safePage = Math.min(page, totalPages);
	const paginatedLogs = filteredLogs.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

	// Helper to format timestamp without milliseconds
	function formatTimestamp(ts: string | number): string {
		if (!ts) return '';
		const d = new Date(ts);
		if (isNaN(d.getTime())) return String(ts);
		return d.toLocaleString(undefined, {
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: true,
		});
	}

	return (
		<div className="max-w-7xl mx-auto py-8 px-4">
			<div className="flex gap-4 mb-6 items-center">
				<input
					type="text"
					placeholder="Search..."
					value={search}
					onChange={e => setSearch(e.target.value)}
					className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-blue-200"
				/>
				
				<DateRangePicker value={dateRange} onChange={setDateRange} label="Select date range" />
				
				<button
					onClick={() => navigate('/?tab=stock-adjustment')}
					className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors whitespace-nowrap"
				>
					Stock Adjustment
				</button>
			</div>
			<div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
				<table className="w-full text-base">
					<thead className="bg-gray-50 border-b border-gray-200">
						<tr>
							<th className="px-5 py-3 text-left font-bold text-gray-700">Date</th>
							<th className="px-5 py-3 text-left font-bold text-gray-700">Restock</th>
							<th className="px-5 py-3 text-left font-bold text-gray-700">Adjustment By</th>
							<th className="px-5 py-3 text-left font-bold text-gray-700">Items</th>
							<th className="px-5 py-3 text-left font-bold text-gray-700">Action</th>
						</tr>
					</thead>
					<tbody>
						{loading ? (
							<tr><td colSpan={5} className="text-center py-8">Loading...</td></tr>
						) : filteredLogs.length === 0 ? (
							<tr><td colSpan={5} className="text-center py-8">No history found.</td></tr>
						) : (
							paginatedLogs.map((row, idx) => {
								const isBatchRow = row.isBatch;
								const displayAdjustment = isBatchRow ? `${row.totalItemsAdjusted} items` : (row.adjustment > 0 ? `+${row.adjustment}` : row.adjustment);
								
								return (
									<tr
										key={idx}
										className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer group"
										onClick={() => { setSelectedLog(row); setSheetOpen(true); }}
										style={{
											background: isBatchRow ? '#f0f9ff' : 'transparent'
										}}
									>
										<td className="px-5 py-3">{formatTimestamp(row.timestampRaw)}</td>
										<td className="px-5 py-3">
											{isBatchRow ? (
												<span style={{ 
													background: '#dbeafe', 
													color: '#1e40af', 
													padding: '4px 10px', 
													borderRadius: 6, 
													fontSize: 13,
													fontWeight: 600,
													display: 'inline-flex',
													alignItems: 'center',
													gap: 6
												}}>
												{displayAdjustment}
												</span>
											) : (
												displayAdjustment
											)}
										</td>
										<td className="px-5 py-3">{row.modifiedByName}</td>
										<td className="px-5 py-3">
											{isBatchRow ? (
												<span style={{ fontWeight: 600, color: '#1e40af' }}>
													{row.productName}
												</span>
											) : (
												<span>
													{row.productName}{row.variationName ? ` (${row.variationName})` : ''}
												</span>
											)}
										</td>
										<td className="px-5 py-3">{row.action}</td>
									</tr>
								);
							})
						)}
					</tbody>
				</table>
			</div>

		{/* Pagination */}
		{totalPages > 1 && (
			<div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 rounded-b-xl">
				<span className="text-xs text-gray-500">
					Page {safePage} of {totalPages} ({filteredLogs.length} record{filteredLogs.length !== 1 ? 's' : ''})
				</span>
				<div className="flex gap-1">
					<button
						onClick={() => setPage(p => Math.max(1, p - 1))}
						disabled={safePage === 1}
						className="px-3 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
					>
						Previous
					</button>
					<button
						onClick={() => setPage(p => Math.min(totalPages, p + 1))}
						disabled={safePage === totalPages}
						className="px-3 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
					>
						Next
					</button>
				</div>
			</div>
		)}

			{/* Side panel for log details */}
			<Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
				<SheetContent side="right" style={{ minWidth: 450, maxWidth: 550, padding: 0, background: 'linear-gradient(to bottom, #f8fafc 0%, #f1f5f9 100%)' }}>
					<SheetHeader style={{ 
						padding: '28px 28px 24px 28px', 
						borderBottom: '2px solid #e2e8f0', 
						background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)',
						boxShadow: '0 4px 12px rgba(37, 99, 235, 0.15)'
					}}>
						<SheetTitle style={{ 
							fontSize: 24, 
							fontWeight: 700, 
							color: '#fff', 
						letterSpacing: 0.3
					}}>
							Inventory Log Details
						</SheetTitle>
					</SheetHeader>
					{selectedLog && (
						<div style={{ padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto', maxHeight: 'calc(100vh - 180px)' }}>
							{/* Batch ID Badge - Only show if it's a batch */}
							{selectedLog.isBatch && selectedLog.batchId && (
								<div style={{ 
									background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
									borderRadius: 12, 
								padding: '20px 24px',
								boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
								border: '2px solid #60a5fa'
							}}>
								<div style={{ marginBottom: 12 }}>
									<span style={{ fontSize: 20, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: 1 }}>Batch Adjustment</span>
									</div>
									<div style={{ 
										fontSize: 14, 
										fontWeight: 600, 
										color: '#fff',
									fontFamily: 'monospace'
								}}>
									{selectedLog.batchId}
								</div>
								<div style={{ 
									fontSize: 13, 
									color: '#dbeafe',
										marginTop: 4
									}}>
										{selectedLog.totalItemsAdjusted} product variations adjusted
									</div>
								</div>
							)}

							{/* Timestamp Card */}
							<div style={{ 
								background: '#fff', 
								borderRadius: 12, 
								padding: '16px 20px',
								boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
								border: '1px solid #e2e8f0'
							}}>
							<div style={{ marginBottom: 8 }}>
								<span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.8 }}>Timestamp</span>
							</div>
							<div style={{ fontSize: 16, color: '#1e293b', fontWeight: 500 }}>
									{formatTimestamp(selectedLog.timestampRaw)}
								</div>
							</div>

							{/* Action & Type Card */}
							<div style={{ 
								background: selectedLog.action === 'Loss/Damage' ? '#fef2f2' : 
											selectedLog.action === 'Receive Items' ? '#f0fdf4' : '#f0f9ff',
								borderRadius: 12, 
								padding: '16px 20px',
								boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
								border: `2px solid ${selectedLog.action === 'Loss/Damage' ? '#fecaca' : 
														selectedLog.action === 'Receive Items' ? '#bbf7d0' : '#bfdbfe'}`
							}}>
							<div style={{ marginBottom: 8 }}>
									<span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.8 }}>Action Type</span>
								</div>
								<div style={{ 
									fontSize: 18, 
									fontWeight: 700, 

									color: selectedLog.action === 'Loss/Damage' ? '#dc2626' : 
										   selectedLog.action === 'Receive Items' ? '#16a34a' : '#2563eb'
								}}>
									{selectedLog.action}
								</div>
							</div>

							{/* Products in Batch - Only show if it's a batch */}
							{selectedLog.isBatch && selectedLog.batchItems && selectedLog.batchItems.length > 0 && (
								<div style={{ 
									background: '#fff', 
									borderRadius: 12, 
									padding: '20px',
									boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
									border: '1px solid #e2e8f0'
								}}>
									<div style={{ 
										fontSize: 14, 
										fontWeight: 700, 
										color: '#475569', 
										marginBottom: 16,
										paddingBottom: 12,
										borderBottom: '2px solid #e2e8f0',
										textTransform: 'uppercase',
										letterSpacing: 1
									}}>
										Products in This Batch ({selectedLog.batchItems.length})
									</div>
									
									<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
										{selectedLog.batchItems.map((item: any, idx: number) => (
											<div key={idx} style={{ 
												background: '#f9fafb',
												borderRadius: 8,
												padding: '12px 16px',
												border: '1px solid #e5e7eb'
											}}>
												<div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
													{item.imageUrl && (
														<img 
															src={item.imageUrl} 
															alt={item.productName}
															style={{ 
																width: 40, 
																height: 40, 
																borderRadius: 6, 
																objectFit: 'cover',
																border: '2px solid #e5e7eb'
															}} 
														/>
													)}
													<div style={{ flex: 1 }}>
														<div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b' }}>
															{item.productName}
														</div>
														<div style={{ fontSize: 13, color: '#64748b' }}>
															{item.variationName}
														</div>
													</div>
												</div>
												<div style={{ 
													display: 'flex', 
													justifyContent: 'space-between',
													paddingLeft: 52,
													fontSize: 13
												}}>
													<span style={{ color: '#64748b' }}>
														Stock: {item.stockBefore} → <span style={{ fontWeight: 600, color: '#16a34a' }}>{item.stockAfter}</span>
													</span>
													<span style={{ 
														fontWeight: 600,
														color: item.adjustmentQty > 0 ? '#16a34a' : '#dc2626'
													}}>
														{item.adjustmentQty > 0 ? `+${item.adjustmentQty}` : item.adjustmentQty}
													</span>
												</div>
											</div>
										))}
									</div>
								</div>
							)}

							{/* Product Information Section - Only for individual adjustments */}
							{!selectedLog.isBatch && (
								<div style={{ 
									background: '#fff', 
									borderRadius: 12, 
									padding: '20px',
									boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
									border: '1px solid #e2e8f0'
								}}>
									<div style={{ 
										fontSize: 14, 
										fontWeight: 700, 
										color: '#475569', 
										marginBottom: 16,
										paddingBottom: 12,
										borderBottom: '2px solid #e2e8f0',
										textTransform: 'uppercase',
										letterSpacing: 1
									}}>
										Product Information
									</div>
									
									<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
										<div>
											<div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
												Product Name
											</div>
											<div style={{ fontSize: 16, color: '#1e293b', fontWeight: 600 }}>
												{selectedLog.productName}
											</div>
										</div>
										
										<div>
											<div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
												Variant
											</div>
											<div style={{ fontSize: 15, color: '#475569', fontWeight: 500 }}>
												{selectedLog.variationName || 'N/A'}
											</div>
										</div>

										<div>
											<div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
												Modified By
											</div>
										<div style={{ fontSize: 15, color: '#1e293b', fontWeight: 500 }}>
											{selectedLog.modifiedByName}
											</div>
										</div>
									</div>
								</div>
							)}

							{/* Modified By - Show for batch adjustments */}
							{selectedLog.isBatch && (
								<div style={{ 
									background: '#fff', 
									borderRadius: 12, 
									padding: '16px 20px',
									boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
									border: '1px solid #e2e8f0'
								}}>
								<div style={{ marginBottom: 8 }}>
									<span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.8 }}>Modified By</span>
								</div>
								<div style={{ fontSize: 16, color: '#1e293b', fontWeight: 500 }}>
										{selectedLog.modifiedByName}
									</div>
								</div>
							)}

							{/* Stock Changes Section - Only for individual adjustments */}
							{!selectedLog.isBatch && (
								<div style={{ 
									background: 'linear-gradient(135deg, #fafafa 0%, #f4f4f5 100%)', 
									borderRadius: 12, 
									padding: '20px',
									boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
									border: '1px solid #e2e8f0'
								}}>
									<div style={{ 
										fontSize: 14, 
										fontWeight: 700, 
										color: '#475569', 
										marginBottom: 16,
										paddingBottom: 12,
										borderBottom: '2px solid #d1d5db',
										textTransform: 'uppercase',
										letterSpacing: 1
									}}>
										Stock Changes
									</div>

									<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
										{/* Stock Before */}
										<div style={{ 
											flex: 1,
											background: '#fff',
											borderRadius: 10,
											padding: '16px',
											border: '2px solid #e2e8f0',
											textAlign: 'center'
										}}>
											<div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>
												Before
											</div>
											<div style={{ fontSize: 28, fontWeight: 700, color: '#475569' }}>
												{selectedLog.beforeStock}
											</div>
										</div>

										{/* Arrow & Adjustment */}
										<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
											<div style={{ 
												fontSize: 24, 
												fontWeight: 700,
												color: selectedLog.adjustment > 0 ? '#16a34a' : '#dc2626',
												background: selectedLog.adjustment > 0 ? '#dcfce7' : '#fee2e2',
												borderRadius: 8,
											padding: '8px 16px',
											border: `2px solid ${selectedLog.adjustment > 0 ? '#86efac' : '#fca5a5'}`
										}}>
											{selectedLog.adjustment > 0 ? `+${selectedLog.adjustment}` : selectedLog.adjustment}
											</div>
										</div>

										{/* Stock After */}
										<div style={{ 
											flex: 1,
											background: '#fff',
											borderRadius: 10,
											padding: '16px',
											border: '2px solid #e2e8f0',
											textAlign: 'center'
										}}>
											<div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>
												After
											</div>
											<div style={{ fontSize: 28, fontWeight: 700, color: '#16a34a' }}>
												{selectedLog.afterStock}
											</div>
										</div>
									</div>
								</div>
							)}

							{/* Reason Section */}
							<div style={{ 
								background: '#fff', 
								borderRadius: 12, 
								padding: '16px 20px',
								boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
								border: '1px solid #e2e8f0'
							}}>
							<div style={{ marginBottom: 8 }}>
								<span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.8 }}>Reason</span>
							</div>
							<div style={{ fontSize: 15, color: '#334155', lineHeight: 1.6 }}>
									{selectedLog.reason || 'No reason provided'}
								</div>
							</div>

						</div>
					)}
					<div style={{ 
						padding: '20px 24px', 
						borderTop: '2px solid #e2e8f0',
						background: '#fff',
						position: 'sticky',
						bottom: 0
					}}>
						<SheetClose asChild>
							<button style={{ 
								width: '100%',
								padding: '14px 0', 
								borderRadius: 10, 
								background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)', 
								color: '#fff', 
								fontWeight: 600, 
								fontSize: 16, 
								boxShadow: '0 4px 12px rgba(22, 163, 74, 0.3)', 
								border: 'none', 
								cursor: 'pointer',
								transition: 'all 0.2s',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								gap: 8
							}}
							onMouseEnter={(e) => {
								e.currentTarget.style.transform = 'translateY(-2px)';
								e.currentTarget.style.boxShadow = '0 6px 16px rgba(22, 163, 74, 0.4)';
							}}
							onMouseLeave={(e) => {
								e.currentTarget.style.transform = 'translateY(0)';
								e.currentTarget.style.boxShadow = '0 4px 12px rgba(22, 163, 74, 0.3)';
							}}
							>
								Close
							</button>
						</SheetClose>
					</div>
				</SheetContent>
			</Sheet>
		</div>
	);
};

export default History;