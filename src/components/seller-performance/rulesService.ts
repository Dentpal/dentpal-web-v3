/**
 * Persistence for the seller-performance scoring rules.
 * Stored at: Seller/<adminUid>/sellerScoringRules/current
 * Only admins write here; the path is per-admin to consolidate visibility.
 */
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { DEFAULT_WEIGHTS, type PillarKey } from './scoring';

const RULES_DOC = 'current';

const path = (adminUid: string) => doc(db, 'Seller', adminUid, 'sellerScoringRules', RULES_DOC);

export async function loadScoringRules(adminUid: string): Promise<Record<PillarKey, number>> {
  const snap = await getDoc(path(adminUid));
  if (!snap.exists()) return { ...DEFAULT_WEIGHTS };
  const data = snap.data() as { weights?: Partial<Record<PillarKey, number>> };
  return { ...DEFAULT_WEIGHTS, ...(data.weights || {}) };
}

export async function saveScoringRules(
  adminUid: string,
  weights: Record<PillarKey, number>,
): Promise<void> {
  await setDoc(
    path(adminUid),
    { weights, updatedAt: serverTimestamp(), updatedBy: adminUid },
    { merge: true },
  );
}
