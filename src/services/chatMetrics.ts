import { database } from '@/lib/firebase';
import { ref, get } from 'firebase/database';

// A buyer↔seller conversation reduced to what the Service-pillar metrics need.
export interface ChatThread {
  id: string;
  buyerId: string;
  buyerName?: string;
  productName?: string;
  // Ascending by timestamp (ms).
  messages: { senderId: string; timestamp: number }[];
}

// One-shot read of a seller's chat threads (+ their messages) from the Realtime
// Database `chatRooms` tree. Not realtime — this powers an admin analytics view,
// so a snapshot per open is enough and bounds read volume.
export async function getSellerChatThreads(sellerId: string): Promise<ChatThread[]> {
  const snap = await get(ref(database, 'chatRooms'));
  if (!snap.exists()) return [];
  const rooms = snap.val() as Record<string, any>;

  const threads: ChatThread[] = [];
  for (const [id, room] of Object.entries(rooms)) {
    if (!room) continue;
    const isParticipant =
      room.user1Id === sellerId || room.user2Id === sellerId || room.sellerId === sellerId;
    if (!isParticipant) continue;

    // Buyer = the participant that isn't the seller.
    const buyerId = room.user1Id === sellerId ? room.user2Id : room.user1Id;
    const buyerName = room.user1Id === sellerId ? room.user2Name : room.user1Name;

    const msgsObj = (room.messages || {}) as Record<string, any>;
    const messages = Object.values(msgsObj)
      .map((m: any) => ({ senderId: String(m?.senderId ?? ''), timestamp: Number(m?.timestamp ?? 0) }))
      .filter((m) => m.senderId && m.timestamp > 0)
      .sort((a, b) => a.timestamp - b.timestamp);

    threads.push({
      id,
      buyerId: String(buyerId ?? ''),
      buyerName: buyerName ? String(buyerName) : undefined,
      productName: room.productName ? String(room.productName) : undefined,
      messages,
    });
  }
  return threads;
}
