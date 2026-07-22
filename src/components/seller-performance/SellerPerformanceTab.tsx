import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  ChevronRight,
  Settings as SettingsIcon,
  ArrowLeft,
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  Info,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import SellersService, { type SellerProfile, type BannedBuyerRecord } from '@/services/sellers';
import OrdersService from '@/services/orders';
import ProductService from '@/services/product';
import { InventoryService } from '@/services/inventory';
import { getSellerChatThreads, type ChatThread } from '@/services/chatMetrics';
import type { Order } from '@/types/order';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { loadScoringRules, saveScoringRules } from './rulesService';
import {
  metricAvailable,
  type LiveMetricResult,
  type LiveMetricRow,
} from './fulfillmentSignals';
import {
  type ProductRow,
  type AdjustmentRow,
} from './productSignals';
import { buildLiveSignals, loadSellerSources } from './liveSignals';
import {
  DEFAULT_WEIGHTS,
  PILLAR_META,
  METRICS_BY_PILLAR,
  STATUS_STYLE,
  TIER_STYLE,
  formatMetric,
  liveCompositeScore,
  mockHistory,
  previousSignals,
  statusFor,
  thresholdExplain,
  tierFor,
  type MetricDef,
  type PillarKey,
  type PillarSignals,
  type Period,
} from './scoring';

// Metrics with no data source yet — shown as "Not tracked yet" and excluded
// from scoring until the backing systems exist (reviews, voucher flagging,
// sub-account incident log).
const NOT_TRACKED_KEYS = new Set<string>([
  'avgRating',
  'lowStarRate',
  'reviewResponseRate',
  'voucherAbuseFlags',
  'subAccountIncidents',
]);

// Short explanation shown in the detail dialog for each not-tracked metric.
const NOT_TRACKED_REASON: Record<string, string> = {
  avgRating: 'Requires a buyer reviews/ratings system (none exists yet).',
  lowStarRate: 'Requires a buyer reviews/ratings system (none exists yet).',
  reviewResponseRate: 'Requires a buyer reviews/ratings system (none exists yet).',
  voucherAbuseFlags: 'Requires platform voucher policy-violation flagging (not implemented).',
  subAccountIncidents: 'Requires a sub-account incident/audit log (not implemented).',
};

type View = 'overview' | 'detail' | 'settings';

const pillarKeys = Object.keys(PILLAR_META) as PillarKey[];

const PERIODS: { value: Period; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

const SellerPerformanceTab = () => {
  const { uid, isAdmin } = useAuth();
  const { toast } = useToast();
  const [sellers, setSellers] = useState<SellerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<View>('overview');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [period, setPeriod] = useState<Period>('30d');
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesSaving, setRulesSaving] = useState(false);
  // Real per-seller signals for the overview list (keyed by seller id).
  const [liveBySeller, setLiveBySeller] = useState<
    Record<string, { availability: Record<string, boolean>; signals: PillarSignals }>
  >({});

  useEffect(() => {
    if (!uid || !isAdmin) {
      setRulesLoading(false);
      return;
    }
    (async () => {
      try {
        const loaded = await loadScoringRules(uid);
        setWeights(loaded);
      } catch (e) {
        console.error('[seller-performance] failed to load scoring rules', e);
      } finally {
        setRulesLoading(false);
      }
    })();
  }, [uid, isAdmin]);

  const persistWeights = async (next: Record<PillarKey, number>) => {
    setWeights(next);
    if (!uid || !isAdmin) return;
    try {
      setRulesSaving(true);
      await saveScoringRules(uid, next);
      toast({ title: 'Scoring rules saved' });
    } catch (e: any) {
      console.error('[seller-performance] failed to save scoring rules', e);
      toast({ title: 'Failed to save scoring rules', description: e?.message, variant: 'destructive' });
    } finally {
      setRulesSaving(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const list = await SellersService.list();
        setSellers(list.filter((s) => (s.role ?? 'seller') === 'seller'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Load real data for every seller once per (sellers, period). Each seller's
  // result lands in `liveBySeller` as it resolves, so rows fill in progressively.
  useEffect(() => {
    if (sellers.length === 0) return;
    let cancelled = false;
    setLiveBySeller({});
    (async () => {
      await Promise.all(
        sellers.map(async (s) => {
          try {
            const sources = await loadSellerSources(s.id);
            if (cancelled) return;
            const { availability, signals } = buildLiveSignals(sources, period, s.id);
            setLiveBySeller((prev) => ({ ...prev, [s.id]: { availability, signals } }));
          } catch (e) {
            console.error('[seller-performance] failed to load live signals', s.id, e);
          }
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [sellers, period]);

  const rows = useMemo<Row[]>(() => {
    const term = search.trim().toLowerCase();
    return sellers
      .filter((s) =>
        !term ||
        (s.name || '').toLowerCase().includes(term) ||
        (s.email || '').toLowerCase().includes(term),
      )
      .map((s): Row => {
        const live = liveBySeller[s.id];
        if (!live) {
          return { seller: s, total: null, pillars: null, tier: null, loading: true };
        }
        const { total, pillars } = liveCompositeScore(live.signals, live.availability, weights);
        return { seller: s, total, pillars, tier: tierFor(total), loading: false };
      })
      .sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
  }, [sellers, search, weights, liveBySeller]);

  const selected = useMemo(
    () => rows.find((r) => r.seller.id === selectedId) || null,
    [rows, selectedId],
  );

  if (view === 'settings') {
    return (
      <SettingsView
        weights={weights}
        setWeights={persistWeights}
        loading={rulesLoading}
        saving={rulesSaving}
        onBack={() => setView('overview')}
      />
    );
  }

  if (view === 'detail' && selected) {
    return (
      <DetailView
        row={selected}
        period={period}
        setPeriod={setPeriod}
        onBack={() => setView('overview')}
        weights={weights}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sellers by name or email…"
              className="pl-9"
            />
          </div>
          <PeriodSelector value={period} onChange={setPeriod} />
          <Button variant="outline" onClick={() => setView('settings')}>
            <SettingsIcon className="w-4 h-4 mr-2" /> Scoring Rules
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500" /> Seller Performance
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Composite score (0–100) across 5 pillars. Click a seller to drill in.
            </p>
          </div>
          <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
            {rows.length} sellers
          </Badge>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Seller</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tier</th>
                {pillarKeys.map((k) => (
                  <th key={k} className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    {PILLAR_META[k].label}
                  </th>
                ))}
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading && (
                <tr>
                  <td colSpan={4 + pillarKeys.length} className="px-6 py-10 text-center text-gray-500">
                    Loading sellers…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={4 + pillarKeys.length} className="px-6 py-10 text-center text-gray-500">
                    No sellers match your search.
                  </td>
                </tr>
              )}
              {rows.map(({ seller, total, pillars, tier, loading: rowLoading }) => (
                <tr
                  key={seller.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => {
                    setSelectedId(seller.id);
                    setView('detail');
                  }}
                >
                  <td className="px-6 py-3">
                    <div className="font-medium text-gray-900">{seller.name || seller.email || seller.id}</div>
                    {seller.email && <div className="text-xs text-gray-500">{seller.email}</div>}
                  </td>
                  <td className="px-6 py-3">
                    {rowLoading ? (
                      <span className="text-sm text-gray-400">Loading…</span>
                    ) : (
                      <>
                        <span className="text-lg font-semibold text-gray-900">{total}</span>
                        <span className="text-xs text-gray-400"> / 100</span>
                      </>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    {rowLoading || tier == null ? (
                      <span className="text-sm text-gray-400">—</span>
                    ) : (
                      <Badge className={`${TIER_STYLE[tier].cls} border text-xs`}>{TIER_STYLE[tier].label}</Badge>
                    )}
                  </td>
                  {pillarKeys.map((k) => (
                    <td key={k} className="px-3 py-3 text-sm text-gray-700">
                      {rowLoading || pillars?.[k] == null ? '—' : Math.round(pillars[k] as number)}
                    </td>
                  ))}
                  <td className="px-6 py-3 text-gray-400">
                    <ChevronRight className="w-4 h-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Detail view — Shopee/Lazada-style breakdown
// ============================================================================

interface Row {
  seller: SellerProfile;
  total: number | null;
  pillars: Record<PillarKey, number | null> | null;
  tier: ReturnType<typeof tierFor> | null;
  loading: boolean;
}

const PeriodSelector = ({ value, onChange }: { value: Period; onChange: (p: Period) => void }) => (
  <div className="inline-flex bg-gray-100 rounded-lg p-1">
    {PERIODS.map((p) => (
      <button
        key={p.value}
        onClick={() => onChange(p.value)}
        className={`px-3 py-1.5 text-sm rounded-md transition ${
          value === p.value ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-600 hover:text-gray-900'
        }`}
      >
        {p.label}
      </button>
    ))}
  </div>
);

const Sparkline = ({ points, color = '#10b981' }: { points: number[]; color?: string }) => {
  if (!points.length) return null;
  const w = 120;
  const h = 32;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / range) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

const Delta = ({ current, previous, direction }: { current: number; previous: number; direction: 'higher' | 'lower' }) => {
  const diff = current - previous;
  if (Math.abs(diff) < 0.0001) {
    return (
      <span className="inline-flex items-center text-xs text-gray-500">
        <Minus className="w-3 h-3 mr-1" /> no change
      </span>
    );
  }
  const improved = direction === 'higher' ? diff > 0 : diff < 0;
  const Icon = diff > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center text-xs ${improved ? 'text-emerald-600' : 'text-red-600'}`}>
      <Icon className="w-3 h-3 mr-1" />
      {Math.abs(diff * (current < 1 && previous < 1 ? 100 : 1)).toFixed(current < 1 && previous < 1 ? 1 : 0)}
      {current < 1 && previous < 1 ? ' pp' : ''} vs prev
    </span>
  );
};

interface ContributingEvent {
  ref: string;
  date: string;
  productName: string;
  productImage: string;
  columns: { label: string; value: string }[];
}

const SAMPLE_PRODUCTS = [
  { name: 'Dental Composite Resin Kit', image: 'https://images.unsplash.com/photo-1606811971618-4486d14f3f99?w=80&h=80&fit=crop' },
  { name: 'Ultrasonic Scaler Tips (Pk 10)', image: 'https://images.unsplash.com/photo-1609840114035-3c981b782dfe?w=80&h=80&fit=crop' },
  { name: 'Disposable Dental Mirror', image: 'https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?w=80&h=80&fit=crop' },
  { name: 'Orthodontic Bracket Set', image: 'https://images.unsplash.com/photo-1530498352533-5a1a8c1bba48?w=80&h=80&fit=crop' },
  { name: 'Endodontic File Assortment', image: 'https://images.unsplash.com/photo-1612277795421-9bc7706a4a34?w=80&h=80&fit=crop' },
  { name: 'Dental Impression Tray', image: 'https://images.unsplash.com/photo-1607613009820-a29f7bb81c04?w=80&h=80&fit=crop' },
  { name: 'Curing Light LED Wireless', image: 'https://images.unsplash.com/photo-1581595220892-b0739db3ba8c?w=80&h=80&fit=crop' },
  { name: 'Surgical Gloves Box (Size M)', image: 'https://images.unsplash.com/photo-1583912267550-f3b9dd9b3d62?w=80&h=80&fit=crop' },
];

// Mock contributing events (the underlying records that produced the metric).
// Each metric returns shape-appropriate columns so admins can see exactly
// which records counted toward the calculation. Replace with real queries
// when wiring per-metric data.
const mockContributingEvents = (
  sellerId: string,
  def: MetricDef,
  period: Period,
): { headers: string[]; rows: ContributingEvent[] } => {
  const seed = sellerId + '|' + def.key + '|' + period + '|events';
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const r = (n: number) => {
    const x = Math.sin(h + n) * 10000;
    return x - Math.floor(x);
  };
  const pickupStatuses = ['to_pack', 'to_arrange', 'to_handover', 'pickup'];
  const cancelReasons = ['out_of_stock', 'no_stock', 'seller_refusal'];
  const dateStr = (i: number) => {
    const days = Math.floor(r(i + 1) * (period === '7d' ? 7 : period === '30d' ? 30 : 90));
    return new Date(Date.now() - days * 86_400_000).toLocaleDateString();
  };
  const orderRef = (i: number) => `ORD-${(Math.floor(r(i + 100) * 90000) + 10000).toString()}`;
  const pickProduct = (i: number) => SAMPLE_PRODUCTS[Math.floor(r(i + 200) * SAMPLE_PRODUCTS.length)];

  const rowCount = period === '7d' ? 18 : period === '30d' ? 30 : 50;

  switch (def.key) {
    case 'shipOnTimeRate': {
      return {
        headers: ['Order', 'Product', 'Pipeline status', 'Window', 'Date'],
        rows: Array.from({ length: rowCount }).map((_, i) => {
          const onTime = r(i + 50) > 0.18;
          const status = pickupStatuses[Math.floor(r(i + 7) * pickupStatuses.length)];
          const p = pickProduct(i);
          return {
            ref: orderRef(i),
            date: dateStr(i),
            productName: p.name,
            productImage: p.image,
            columns: [
              { label: 'Order', value: orderRef(i) },
              { label: 'Pipeline status', value: status },
              { label: 'Window', value: onTime ? 'On time' : 'Late' },
              { label: 'Date', value: dateStr(i) },
            ],
          };
        }),
      };
    }
    case 'cancellationRate': {
      return {
        headers: ['Order', 'Product', 'Cancelled by', 'Reason', 'Date'],
        rows: Array.from({ length: rowCount }).map((_, i) => {
          const p = pickProduct(i);
          return {
            ref: orderRef(i),
            date: dateStr(i),
            productName: p.name,
            productImage: p.image,
            columns: [
              { label: 'Order', value: orderRef(i) },
              { label: 'Cancelled by', value: 'Seller' },
              { label: 'Reason', value: cancelReasons[Math.floor(r(i + 9) * cancelReasons.length)] },
              { label: 'Date', value: dateStr(i) },
            ],
          };
        }),
      };
    }
    case 'sameDayHandoverRate': {
      return {
        headers: ['Order', 'Product', 'Placed → Handover', 'Date'],
        rows: Array.from({ length: rowCount }).map((_, i) => {
          const sameDay = r(i + 12) > 0.3;
          const p = pickProduct(i);
          return {
            ref: orderRef(i),
            date: dateStr(i),
            productName: p.name,
            productImage: p.image,
            columns: [
              { label: 'Order', value: orderRef(i) },
              { label: 'Placed → Handover', value: sameDay ? 'Same day' : 'Next day+' },
              { label: 'Date', value: dateStr(i) },
            ],
          };
        }),
      };
    }
    default: {
      const labelByPillar: Record<string, { kind: string; ref: string }> = {
        fulfillment: { kind: 'Order', ref: 'ORD' },
        service: { kind: 'Chat thread', ref: 'CHAT' },
        product: { kind: 'SKU', ref: 'SKU' },
        satisfaction: { kind: 'Review', ref: 'REV' },
        governance: { kind: 'Incident', ref: 'INC' },
      };
      const tag = labelByPillar[def.pillar];
      return {
        headers: ['Type', 'Reference', 'Product', 'Date'],
        rows: Array.from({ length: rowCount }).map((_, i) => {
          const ref = `${tag.ref}-${(Math.floor(r(i + 100) * 90000) + 10000).toString()}`;
          const p = pickProduct(i);
          return {
            ref,
            date: dateStr(i),
            productName: p.name,
            productImage: p.image,
            columns: [
              { label: 'Type', value: tag.kind },
              { label: 'Reference', value: ref },
              { label: 'Date', value: dateStr(i) },
            ],
          };
        }),
      };
    }
  }
};

const MetricRow = ({
  def,
  current,
  previous,
  history,
  sellerId,
  period,
  liveResult,
  isLiveMetric,
}: {
  def: MetricDef;
  current: number;
  previous: number;
  history: number[];
  sellerId: string;
  period: Period;
  liveResult: LiveMetricResult | null;
  isLiveMetric: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const isNotTracked = NOT_TRACKED_KEYS.has(def.key);
  // A grounded metric's result is null only while its source is still loading;
  // once loaded the compute returns an object (possibly with denominator 0).
  const loading = isLiveMetric && liveResult == null;
  const isLive = !!liveResult && metricAvailable(liveResult);
  const isNoData = isLiveMetric && !loading && !isLive; // loaded but no data
  const isApprox = isLive && !!liveResult?.approx;
  // "—" for both not-tracked metrics and grounded metrics with no data.
  const blankValue = isNotTracked || isNoData;
  const status = statusFor(def, current);
  const style = STATUS_STYLE[status];
  const explain = thresholdExplain(def, current);
  const events = useMemo(() => {
    if (isLive && liveResult) {
      const labels = liveResult.rows[0]?.columns.map((c) => c.label) ?? ['Order', 'Status', 'Window', 'Date'];
      const headers = [labels[0] ?? 'Order', 'Product', ...labels.slice(1)];
      return { headers, rows: liveResult.rows };
    }
    if (isLiveMetric) {
      // Live metric with no data yet — show no mock rows.
      return { headers: ['Order', 'Product', 'Status', 'Window', 'Date'], rows: [] as LiveMetricRow[] };
    }
    if (isNotTracked) {
      return { headers: ['Item', 'Product', 'Detail', 'Date'], rows: [] as LiveMetricRow[] };
    }
    return mockContributingEvents(sellerId, def, period);
  }, [isLive, liveResult, isLiveMetric, isNotTracked, sellerId, def, period]);

  return (
    <>
      <tr
        className="hover:bg-gray-50 cursor-pointer border-t border-gray-100"
        onClick={() => setOpen(true)}
      >
        <td className="px-4 py-3 align-top">
          <div className="min-w-0">
            <div className="font-medium text-gray-900 flex items-center gap-2">
              <span>{def.label}</span>
              {isNotTracked ? (
                <Badge className="bg-slate-100 text-slate-600 border-slate-200 border text-[9px]">Not tracked yet</Badge>
              ) : loading ? (
                <Badge className="bg-gray-100 text-gray-600 border-gray-200 border text-[9px]">Loading…</Badge>
              ) : isLive ? (
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 border text-[9px]">{isApprox ? 'Live · approx' : 'Live'}</Badge>
              ) : (
                <Badge className="bg-gray-100 text-gray-600 border-gray-200 border text-[9px]">No data yet</Badge>
              )}
            </div>
            <div className="text-xs text-gray-500">{def.blurb}</div>
          </div>
        </td>
        <td className="px-4 py-3 align-top text-sm font-mono text-gray-900 whitespace-nowrap">
          {blankValue ? <span className="text-gray-400">—</span> : formatMetric(def, current)}
        </td>
        <td className="px-4 py-3 align-top text-xs text-gray-600 whitespace-nowrap">
          {formatMetric(def, def.target)}
        </td>
        <td className="px-4 py-3 align-top">
          {blankValue ? (
            <span className="text-xs text-gray-400">—</span>
          ) : (
            <Badge className={`${style.cls} border text-[10px]`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${style.dot} mr-1`} />
              {style.label}
            </Badge>
          )}
        </td>
        <td className="px-4 py-3 align-top whitespace-nowrap">
          {blankValue ? <span className="text-xs text-gray-400">—</span> : <Delta current={current} previous={previous} direction={def.direction} />}
        </td>
        <td className="px-4 py-3 align-top">
          {blankValue ? (
            <span className="text-xs text-gray-400">—</span>
          ) : (
            <Sparkline
              points={history}
              color={status === 'poor' ? '#ef4444' : status === 'needs-improvement' ? '#f59e0b' : '#10b981'}
            />
          )}
        </td>
      </tr>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3 pr-6">
              <div className="min-w-0">
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <span>{def.label}</span>
                  {!blankValue && (
                    <Badge className={`${style.cls} border text-[10px]`}>
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${style.dot} mr-1`} />
                      {style.label}
                    </Badge>
                  )}
                  {isNotTracked ? (
                    <Badge className="bg-slate-100 text-slate-600 border-slate-200 border text-[10px]">Not tracked yet</Badge>
                  ) : loading ? (
                    <Badge className="bg-gray-100 text-gray-600 border-gray-200 border text-[10px]">Loading…</Badge>
                  ) : isLive ? (
                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 border text-[10px]">{isApprox ? 'Live · approx' : 'Live'}</Badge>
                  ) : (
                    <Badge className="bg-gray-100 text-gray-600 border-gray-200 border text-[10px]">No data yet</Badge>
                  )}
                </DialogTitle>
                <DialogDescription className="mt-1">{def.blurb}</DialogDescription>
              </div>
              <div className="text-right shrink-0">
                <div className="text-2xl font-semibold text-gray-900">{blankValue ? '—' : formatMetric(def, current)}</div>
                <div className="text-xs text-gray-500">Target {formatMetric(def, def.target)}</div>
              </div>
            </div>
          </DialogHeader>

          {/* Status logic — horizontal chips */}
          <div className="mt-3">
            {isNotTracked ? (
              <div className="text-[11px] text-gray-500">{NOT_TRACKED_REASON[def.key] ?? 'Not tracked yet.'}</div>
            ) : isNoData ? (
              <div className="text-[11px] text-gray-500">
                No qualifying records for this seller in the selected period, so this metric has no live value yet.
              </div>
            ) : (
            <>
            <div className="flex items-center gap-2 flex-wrap">
              {explain.scale.map((row) => {
                const rowStyle = STATUS_STYLE[row.label];
                return (
                  <div
                    key={row.label}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs ${
                      row.active ? rowStyle.cls + ' font-semibold' : 'bg-white text-gray-600 border-gray-200'
                    }`}
                  >
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${rowStyle.dot}`} />
                    <span>{rowStyle.label}</span>
                    <span className="font-mono text-[11px] opacity-80">{row.rule}</span>
                  </div>
                );
              })}
            </div>
            <div className="text-[11px] text-gray-500 mt-1.5">
              Current value <span className="font-mono">{formatMetric(def, current)}</span> matches{' '}
              <span className="font-medium">{style.label}</span> ({explain.matched}).
            </div>
            </>
            )}
          </div>

          {/* Records — full-width table with product image + name */}
          <div className="mt-5 border border-gray-200 rounded-lg overflow-hidden">
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0">
                  <tr>
                    {events.headers.map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {events.rows.map((e) => {
                    // Render columns in declared order, but inject the Product cell at its header position.
                    const productHeaderIdx = events.headers.indexOf('Product');
                    const dataCells = e.columns;
                    let cellCursor = 0;
                    return (
                      <tr key={e.ref} className="border-t border-gray-100 hover:bg-gray-50">
                        {events.headers.map((h, hIdx) => {
                          if (hIdx === productHeaderIdx) {
                            return (
                              <td key={h} className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <img
                                    src={e.productImage}
                                    alt=""
                                    className="w-8 h-8 rounded object-cover border border-gray-200 bg-gray-100 shrink-0"
                                    onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                                  />
                                  <span className="text-gray-800 text-xs">{e.productName}</span>
                                </div>
                              </td>
                            );
                          }
                          const c = dataCells[cellCursor++];
                          const mono = c?.label === 'Order' || c?.label === 'Reference';
                          return (
                            <td
                              key={h}
                              className={`px-3 py-2 whitespace-nowrap ${mono ? 'font-mono text-gray-800' : 'text-gray-700'}`}
                            >
                              {c?.value}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="text-[11px] text-gray-400 mt-2">
            {isNotTracked ? (
              <>{NOT_TRACKED_REASON[def.key] ?? 'Not tracked yet.'}</>
            ) : isLive && liveResult ? (
              <>
                Live data: {liveResult.numerator} of {liveResult.denominator} qualifying records
                {' '}(period: {period}{def.key === 'shipOnTimeRate' ? ', SLA: 48h from order creation' : ''}).
                {isApprox ? ' Value is a best-effort approximation.' : ''}
              </>
            ) : loading ? (
              <>Loading data for this seller…</>
            ) : isLiveMetric ? (
              <>No qualifying records for this seller in the selected period.</>
            ) : (
              <>Sample records shown for illustration.</>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

const PillarSection = ({
  pillarKey,
  signals,
  prev,
  sellerId,
  period,
  score,
  liveByKey,
}: {
  pillarKey: PillarKey;
  signals: PillarSignals;
  prev: PillarSignals;
  sellerId: string;
  period: Period;
  score: number | null;
  liveByKey: Record<string, LiveMetricResult | null>;
}) => {
  const meta = PILLAR_META[pillarKey];
  const defs = METRICS_BY_PILLAR[pillarKey] || [];
  return (
    <div>
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h4 className="text-lg font-semibold text-gray-900">{meta.label}</h4>
          <p className="text-sm text-gray-500">{meta.blurb}</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-gray-900">{score == null ? '—' : Math.round(score)}</div>
          <div className="text-xs text-gray-500">Pillar score</div>
        </div>
      </div>
      <div className="overflow-x-auto border border-gray-200 rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Metric</th>
              <th className="px-4 py-2.5 text-left font-medium">Current</th>
              <th className="px-4 py-2.5 text-left font-medium">Target</th>
              <th className="px-4 py-2.5 text-left font-medium">Status</th>
              <th className="px-4 py-2.5 text-left font-medium">Δ vs prev</th>
              <th className="px-4 py-2.5 text-left font-medium">Trend</th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {defs.map((d) => (
              <MetricRow
                key={d.key}
                def={d}
                current={d.read(signals)}
                previous={d.read(prev)}
                history={mockHistory(sellerId, d.key, period)}
                sellerId={sellerId}
                period={period}
                liveResult={liveByKey[d.key] ?? null}
                isLiveMetric={d.key in liveByKey}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const headlineMetrics = (signals: PillarSignals, available: Record<string, boolean>) => ([
  {
    label: 'Late Shipment Rate',
    value: available.shipOnTimeRate ? `${((1 - signals.fulfillment.shipOnTimeRate) * 100).toFixed(1)}%` : '—',
    target: '≤ 5%',
    ok: 1 - signals.fulfillment.shipOnTimeRate <= 0.05,
    noData: !available.shipOnTimeRate,
  },
  {
    label: 'Cancellation Rate',
    value: available.cancellationRate ? `${(signals.fulfillment.cancellationRate * 100).toFixed(1)}%` : '—',
    target: '≤ 3%',
    ok: signals.fulfillment.cancellationRate <= 0.03,
    noData: !available.cancellationRate,
  },
  {
    label: 'Chat Response',
    value: available.chatResponseRate ? `${(signals.service.chatResponseRate * 100).toFixed(0)}%` : '—',
    target: '≥ 90%',
    ok: signals.service.chatResponseRate >= 0.9,
    noData: !available.chatResponseRate,
  },
  {
    label: 'Avg Rating',
    value: available.avgRating ? signals.satisfaction.avgRating.toFixed(2) : '—',
    target: '≥ 4.5',
    ok: signals.satisfaction.avgRating >= 4.5,
    noData: !available.avgRating,
  },
]);

const DetailView = ({
  row,
  period,
  setPeriod,
  onBack,
  weights,
}: {
  row: Row;
  period: Period;
  setPeriod: (p: Period) => void;
  onBack: () => void;
  weights: Record<PillarKey, number>;
}) => {
  const { seller } = row;
  const [activePillar, setActivePillar] = useState<PillarKey>('fulfillment');

  // ── Live data sources for this seller (null = still loading) ──────────────
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [adjustments, setAdjustments] = useState<AdjustmentRow[] | null>(null);
  const [bans, setBans] = useState<BannedBuyerRecord[] | null>(null);
  const [disputedOrderIds, setDisputedOrderIds] = useState<Set<string> | null>(null);
  const [chatThreads, setChatThreads] = useState<ChatThread[] | null>(null);

  useEffect(() => {
    setOrders(null); setProducts(null); setAdjustments(null);
    setBans(null); setDisputedOrderIds(null); setChatThreads(null);

    const unsubOrders = OrdersService.listenBySeller(seller.id, (list) => setOrders(list));
    const unsubProducts = ProductService.listenBySeller(seller.id, (rows) =>
      setProducts(rows.map((p) => ({ id: p.id, name: p.name, imageUrl: p.imageUrl, status: p.status, inStock: p.inStock, createdAt: p.createdAt }))),
    );
    const unsubAdj = InventoryService.listenAdjustmentsBySeller(seller.id, (rows) =>
      setAdjustments(rows.map((r: any) => ({
        itemId: String(r.raw?.itemId ?? r.id),
        itemName: r.itemName || r.raw?.itemName,
        at: r.raw?.at?.toMillis?.() ?? Date.now(),
        stockAfter: Number(r.stockAfter ?? 0),
      }))),
    );
    const unsubBans = SellersService.listenBannedBuyers(seller.id, (records) => setBans(records));

    OrdersService.fetchReturnRequestsForSeller([seller.id])
      .then((reqs) => setDisputedOrderIds(new Set(reqs.map((r: any) => String(r.orderId)))))
      .catch(() => setDisputedOrderIds(new Set()));
    getSellerChatThreads(seller.id)
      .then((t) => setChatThreads(t))
      .catch(() => setChatThreads([]));

    return () => {
      try { unsubOrders(); } catch {}
      try { unsubProducts(); } catch {}
      try { unsubAdj(); } catch {}
      try { unsubBans(); } catch {}
    };
  }, [seller.id]);

  // ── Compute every grounded metric from its source (real data only) ────────
  const { liveByKey, availability, signals } = useMemo(
    () =>
      buildLiveSignals(
        { orders, products, adjustments, bans, disputedOrderIds, chatThreads },
        period,
        seller.id,
      ),
    [orders, products, adjustments, bans, disputedOrderIds, chatThreads, period, seller.id],
  );

  // Composite + pillar scores over only the metrics/pillars that have data.
  const { total, pillars } = useMemo(
    () => liveCompositeScore(signals, availability, weights),
    [signals, availability, weights],
  );
  const liveTier = useMemo(() => tierFor(total), [total]);
  const prev = useMemo(() => previousSignals(seller.id, period), [seller.id, period]);
  const headlines = useMemo(() => headlineMetrics(signals, availability), [signals, availability]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Button variant="ghost" onClick={onBack} className="text-gray-600">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to overview
        </Button>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Account Health hero */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h3 className="text-2xl font-semibold text-gray-900">{seller.name || seller.email || seller.id}</h3>
            {seller.email && <p className="text-sm text-gray-500">{seller.email}</p>}
            <div className="mt-3 flex items-center gap-2">
              <Badge className={`${TIER_STYLE[liveTier].cls} border`}>{TIER_STYLE[liveTier].label} tier</Badge>
            </div>
          </div>
          <div className="text-right">
            <div className="text-5xl font-bold text-gray-900 leading-none">{total}</div>
            <div className="text-xs text-gray-500 mt-1">Composite score / 100</div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
          {headlines.map((h) => (
            <div key={h.label} className="border border-gray-200 rounded-xl p-3">
              <div className="text-xs text-gray-500">{h.label}</div>
              <div className="flex items-baseline justify-between mt-1">
                <div className="text-xl font-semibold text-gray-900">{h.value}</div>
                {h.noData ? (
                  <div className="text-[11px] text-gray-400">No data</div>
                ) : (
                  <div className={`text-[11px] ${h.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                    {h.ok ? 'On target' : 'Off target'}
                  </div>
                )}
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">Target {h.target}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Pillar tabs */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="border-b border-gray-200 overflow-x-auto">
          <div className="flex">
            {pillarKeys.map((k) => {
              const active = activePillar === k;
              return (
                <button
                  key={k}
                  onClick={() => setActivePillar(k)}
                  className={`px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition flex items-center gap-2 ${
                    active
                      ? 'border-emerald-500 text-emerald-700 bg-emerald-50/40'
                      : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <span>{PILLAR_META[k].label}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-700'}`}>
                    {pillars[k] == null ? '—' : Math.round(pillars[k] as number)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="p-6">
          <PillarSection
            key={activePillar}
            pillarKey={activePillar}
            signals={signals}
            prev={prev}
            sellerId={seller.id}
            period={period}
            score={pillars[activePillar]}
            liveByKey={liveByKey}
          />
        </div>
      </div>

      {/* Recent events placeholder */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <h4 className="font-semibold text-gray-900 flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-500" /> Recent events
        </h4>
        <p className="text-sm text-gray-500 mt-1">
          Event stream (late shipments, low-star reviews, ban actions, voucher flags) will appear here once
          aggregation jobs are wired to Firestore.
        </p>
      </div>
    </div>
  );
};

// ============================================================================
// Settings view
// ============================================================================

const SettingsView = ({
  weights,
  setWeights,
  loading,
  saving,
  onBack,
}: {
  weights: Record<PillarKey, number>;
  setWeights: (w: Record<PillarKey, number>) => void;
  loading: boolean;
  saving: boolean;
  onBack: () => void;
}) => {
  const [drafts, setDrafts] = useState<Record<PillarKey, string>>(
    () => pillarKeys.reduce((acc, k) => {
      acc[k] = Math.round(weights[k] * 100).toString();
      return acc;
    }, {} as Record<PillarKey, string>),
  );

  useEffect(() => {
    setDrafts(
      pillarKeys.reduce((acc, k) => {
        acc[k] = Math.round(weights[k] * 100).toString();
        return acc;
      }, {} as Record<PillarKey, string>),
    );
  }, [weights]);

  const commit = (k: PillarKey, raw: string) => {
    const n = Math.max(0, Math.min(100, Number(raw) || 0));
    setWeights({ ...weights, [k]: n / 100 });
  };

  const totalPct = pillarKeys.reduce((s, k) => s + (Number(drafts[k]) || 0), 0);
  const isValid = Math.abs(totalPct - 100) < 0.5;

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={onBack} className="text-gray-600">
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to overview
      </Button>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-xl font-semibold text-gray-900">Scoring Rules</h3>
            <p className="text-sm text-gray-500">
              Enter each pillar's weight as a percentage. Totals must sum to 100%.
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Saved to <span className="font-mono">Seller/&lt;your uid&gt;/sellerScoringRules/current</span>
            </p>
          </div>
          <div className="text-xs">
            {loading ? (
              <span className="text-gray-500">Loading…</span>
            ) : saving ? (
              <span className="text-blue-600">Saving…</span>
            ) : (
              <span className="text-emerald-600">Saved</span>
            )}
          </div>
        </div>
        {pillarKeys.map((k) => (
          <div key={k} className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-900">{PILLAR_META[k].label}</div>
              <div className="text-xs text-gray-500">{PILLAR_META[k].blurb}</div>
            </div>
            <div className="flex items-center">
              <Input
                type="text"
                inputMode="decimal"
                value={drafts[k]}
                onChange={(e) => {
                  const next = e.target.value.replace(/[^0-9.]/g, '');
                  // allow at most one decimal point
                  const parts = next.split('.');
                  const sanitized = parts.length > 1 ? parts[0] + '.' + parts.slice(1).join('') : next;
                  setDrafts({ ...drafts, [k]: sanitized });
                }}
                onBlur={(e) => commit(k, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                className="w-20 text-right"
              />
              <span className="ml-2 text-sm text-gray-600">%</span>
            </div>
          </div>
        ))}
        <div className={`text-sm ${isValid ? 'text-emerald-700' : 'text-amber-700'}`}>
          Total weight: {totalPct.toFixed(0)}% {!isValid && '(should be 100%)'}
        </div>
        <Button variant="outline" onClick={() => setWeights(DEFAULT_WEIGHTS)}>
          Reset to defaults
        </Button>
      </div>
    </div>
  );
};

export default SellerPerformanceTab;
