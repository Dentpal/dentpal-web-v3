import { useState, useEffect, useMemo, useRef } from 'react';
import { database, auth, db, storage } from '@/lib/firebase';
import { ref, onValue, off, push, set, update, get } from 'firebase/database';
import { doc, getDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { MessageSquare, Send, Search, X, User, Loader2, Image as ImageIcon, ZoomIn } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '@/hooks/use-auth';

interface ChatMessage {
  id: string;
  senderId: string;
  receiverId: string;
  message: string;
  timestamp: number;
  senderName?: string;
  senderAvatar?: string;
  isRead: boolean;
  productId?: string;
  productName?: string;
  productImage?: string;
  imageUrl?: string;
  messageType?: string;
}

interface ChatRoom {
  id: string;
  user1Id: string;
  user2Id: string;
  user1Name: string;
  user2Name: string;
  user1Avatar?: string;
  user2Avatar?: string;
  user1ShopName?: string;
  user2ShopName?: string;
  lastMessage?: ChatMessage;
  lastActivity: number;
  unreadCount: number;
  productId?: string;
  productName?: string;
  productImage?: string;
  sellerId?: string;
  deletedFor?: string[];
}

interface ChatsTabProps {
  isSeller?: boolean;
  currentUserId?: string;
}

const ChatsTab = ({ isSeller = false, currentUserId }: ChatsTabProps) => {
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const [selectedChatRoom, setSelectedChatRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [chatFilter, setChatFilter] = useState<'all' | 'inquiries' | 'orders'>('all');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentUserAvatar, setCurrentUserAvatar] = useState<string | undefined>(undefined);

  const userId = currentUserId || auth.currentUser?.uid;
  const { isSubAccount, parentId } = useAuth();
  
  // For sub-accounts, also check parent's chats
  const effectiveUserIds = useMemo(() => {
    const ids = [userId];
    if (isSubAccount && parentId) {
      ids.push(parentId);
    }
    return ids.filter(Boolean) as string[];
  }, [userId, isSubAccount, parentId]);

  // Load current user's avatar
  useEffect(() => {
    const loadCurrentUserAvatar = async () => {
      if (!userId) return;

      try {
        // First try to get from User collection
        const userDoc = await getDoc(doc(db, 'User', userId));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          if (userData.photoURL) {
            setCurrentUserAvatar(userData.photoURL);
            return;
          }
        }

        // If user is a seller, check Seller collection
        const sellerDoc = await getDoc(doc(db, 'Seller', userId));
        if (sellerDoc.exists()) {
          const sellerData = sellerDoc.data();
          if (sellerData.photoURL) {
            setCurrentUserAvatar(sellerData.photoURL);
          }
        }
      } catch (error) {
        console.error('Error loading user avatar:', error);
      }
    };

    loadCurrentUserAvatar();
  }, [userId]);

  // Load chat rooms
  useEffect(() => {
    if (!userId || effectiveUserIds.length === 0) {
      setLoading(false);
      return;
    }

    const chatRoomsRef = ref(database, 'chatRooms');
    
    const handleChatRoomsUpdate = (snapshot: any) => {
      const rooms: ChatRoom[] = [];
      
      if (snapshot.exists()) {
        const data = snapshot.val();
        Object.keys(data).forEach((key) => {
          const roomData = data[key];
          
          // Check if current user (or their parent if sub-account) is part of this chat
          const isUserInChat = effectiveUserIds.some(id => 
            roomData.user1Id === id || roomData.user2Id === id
          );
          
          if (isUserInChat) {
            // Check if chat is deleted for this user
            const deletedFor = roomData.deletedFor || [];
            // For sub-accounts, check if deleted for either the sub-account or parent
            const isDeletedForUser = effectiveUserIds.some(id => deletedFor.includes(id));
            
            if (!isDeletedForUser) {
              const room: ChatRoom = {
                id: key,
                user1Id: roomData.user1Id || '',
                user2Id: roomData.user2Id || '',
                user1Name: roomData.user1Name || 'User',
                user2Name: roomData.user2Name || 'User',
                user1Avatar: roomData.user1Avatar,
                user2Avatar: roomData.user2Avatar,
                user1ShopName: roomData.user1ShopName,
                user2ShopName: roomData.user2ShopName,
                lastActivity: roomData.lastActivity || Date.now(),
                unreadCount: 0, // We'll calculate this
                productId: roomData.productId,
                productName: roomData.productName,
                productImage: roomData.productImage,
                sellerId: roomData.sellerId,
                deletedFor: deletedFor,
              };

              // Parse last message
              if (roomData.lastMessage) {
                room.lastMessage = {
                  id: roomData.lastMessage.id || '',
                  senderId: roomData.lastMessage.senderId || '',
                  receiverId: roomData.lastMessage.receiverId || '',
                  message: roomData.lastMessage.message || '',
                  timestamp: roomData.lastMessage.timestamp || Date.now(),
                  senderName: roomData.lastMessage.senderName,
                  senderAvatar: roomData.lastMessage.senderAvatar,
                  isRead: roomData.lastMessage.isRead || false,
                  productId: roomData.lastMessage.productId,
                  productName: roomData.lastMessage.productName,
                  productImage: roomData.lastMessage.productImage,
                  imageUrl: roomData.lastMessage.imageUrl,
                  messageType: roomData.lastMessage.messageType || 'text',
                };
              }

              rooms.push(room);
            }
          }
        });
      }

      // Sort by last activity
      rooms.sort((a, b) => b.lastActivity - a.lastActivity);
      
      setChatRooms(rooms);
      setLoading(false);
    };

    onValue(chatRoomsRef, handleChatRoomsUpdate);

    return () => {
      off(chatRoomsRef, 'value', handleChatRoomsUpdate);
    };
  }, [userId, effectiveUserIds]);

  // Load messages for selected chat room
  useEffect(() => {
    if (!selectedChatRoom || !userId) {
      setMessages([]);
      return;
    }

    const messagesRef = ref(database, `chatRooms/${selectedChatRoom.id}/messages`);
    
    const handleMessagesUpdate = (snapshot: any) => {
      const msgs: ChatMessage[] = [];
      
      if (snapshot.exists()) {
        const data = snapshot.val();
        Object.keys(data).forEach((key) => {
          const msgData = data[key];
          msgs.push({
            id: key,
            senderId: msgData.senderId || '',
            receiverId: msgData.receiverId || '',
            message: msgData.message || '',
            timestamp: msgData.timestamp || Date.now(),
            senderName: msgData.senderName,
            senderAvatar: msgData.senderAvatar,
            isRead: msgData.isRead || false,
            productId: msgData.productId,
            productName: msgData.productName,
            productImage: msgData.productImage,
            imageUrl: msgData.imageUrl,
            messageType: msgData.messageType || 'text',
          });
        });
      }

      // Sort by timestamp
      msgs.sort((a, b) => a.timestamp - b.timestamp);
      setMessages(msgs);

      // Mark messages as read
      if (msgs.length > 0) {
        markMessagesAsRead(selectedChatRoom.id);
      }
    };

    onValue(messagesRef, handleMessagesUpdate);

    return () => {
      off(messagesRef, 'value', handleMessagesUpdate);
    };
  }, [selectedChatRoom, userId]);

  // Mark messages as read
  const markMessagesAsRead = async (chatRoomId: string) => {
    if (!userId) return;

    try {
      // First, update any unread messages in the messages collection
      const messagesRef = ref(database, `chatRooms/${chatRoomId}/messages`);
      const snapshot = await get(messagesRef);

      if (snapshot.exists()) {
        const data = snapshot.val();
        const updates: Record<string, any> = {};

        Object.keys(data).forEach((key) => {
          const msg = data[key];
          if (msg.receiverId === userId && !msg.isRead) {
            updates[`${key}/isRead`] = true;
          }
        });

        if (Object.keys(updates).length > 0) {
          console.log('[DEBUG] Marking messages as read:', { chatRoomId, updateCount: Object.keys(updates).length });
          await update(messagesRef, updates);
        }
      }

      // Always check and update the lastMessage.isRead in the chat room if needed
      const chatRoomRef = ref(database, `chatRooms/${chatRoomId}`);
      const chatRoomSnapshot = await get(chatRoomRef);
      
      if (chatRoomSnapshot.exists()) {
        const chatRoomData = chatRoomSnapshot.val();
        console.log('[DEBUG] Chat room data:', {
          hasLastMessage: !!chatRoomData.lastMessage,
          lastMessageReceiverId: chatRoomData.lastMessage?.receiverId,
          currentUserId: userId,
          lastMessageIsRead: chatRoomData.lastMessage?.isRead
        });
        
        // Update lastMessage.isRead if it's unread and for the current user
        if (chatRoomData.lastMessage && 
            chatRoomData.lastMessage.receiverId === userId && 
            !chatRoomData.lastMessage.isRead) {
          console.log('[DEBUG] Updating lastMessage.isRead to true');
          await update(chatRoomRef, {
            'lastMessage/isRead': true
          });
          console.log('[DEBUG] Successfully updated lastMessage.isRead');
        } else {
          console.log('[DEBUG] lastMessage already read or not for current user');
        }
      }
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  };

  // Upload and send image
  const uploadAndSendImage = async (file: File) => {
    if (!selectedChatRoom || !userId || uploadingImage) return;

    setUploadingImage(true);
    setUploadProgress(0);

    try {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        throw new Error('Please select an image file');
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Image size must be less than 5MB');
      }

      // Create storage reference
      const timestamp = Date.now();
      const fileName = `${timestamp}_${file.name}`;
      const imageStorageRef = storageRef(storage, `chat_images/${selectedChatRoom.id}/${fileName}`);

      // Upload image with progress tracking
      const uploadTask = uploadBytesResumable(imageStorageRef, file);

      uploadTask.on('state_changed', 
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(progress);
        },
        (error) => {
          console.error('Upload error:', error);
          throw error;
        }
      );

      // Wait for upload to complete
      await uploadTask;

      // Get download URL
      const imageUrl = await getDownloadURL(imageStorageRef);

      // For sub-accounts, use parent ID as the sender
      const effectiveSenderId = (isSubAccount && parentId) ? parentId : userId;

      // Get sender data from Firestore using effective sender ID
      let senderName = 'User';
      let senderAvatar: string | undefined;

      const userDoc = await getDoc(doc(db, 'User', effectiveSenderId));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        senderName = userData.fullName || userData.displayName || 'User';
        senderAvatar = userData.photoURL;
      }

      // Check if seller and get seller data
      const sellerDoc = await getDoc(doc(db, 'Seller', effectiveSenderId));
      if (sellerDoc.exists()) {
        const sellerData = sellerDoc.data();
        if (sellerData.photoURL) {
          senderAvatar = sellerData.photoURL;
        }
      }

      const messagesRef = ref(database, `chatRooms/${selectedChatRoom.id}/messages`);
      const newMessageRef = push(messagesRef);

      // Determine other user ID - check against effective sender ID
      const otherUserId = selectedChatRoom.user1Id === effectiveSenderId 
        ? selectedChatRoom.user2Id 
        : selectedChatRoom.user1Id;

      const messageData: any = {
        senderId: effectiveSenderId,
        receiverId: otherUserId,
        message: '📷 Image',
        timestamp: Date.now(),
        senderName,
        isRead: false,
        imageUrl,
        messageType: 'image',
      };

      // Only include senderAvatar if it exists
      if (senderAvatar) {
        messageData.senderAvatar = senderAvatar;
      }

      await set(newMessageRef, messageData);

      // Update chat room's last message and activity
      const chatRoomRef = ref(database, `chatRooms/${selectedChatRoom.id}`);
      await update(chatRoomRef, {
        lastMessage: messageData,
        lastActivity: Date.now(),
      });

    } catch (error: any) {
      console.error('Error uploading image:', error);
      alert(error.message || 'Failed to upload image. Please try again.');
    } finally {
      setUploadingImage(false);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadAndSendImage(file);
    }
  };

  // Send message
  const sendMessage = async () => {
    if (!messageText.trim() || !selectedChatRoom || !userId || sending) return;

    setSending(true);

    try {
      // For sub-accounts, use parent ID as the sender
      const effectiveSenderId = (isSubAccount && parentId) ? parentId : userId;
      
      // Get sender data from Firestore using effective sender ID
      let senderName = 'User';
      let senderAvatar: string | undefined;

      const userDoc = await getDoc(doc(db, 'User', effectiveSenderId));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        senderName = userData.fullName || userData.displayName || 'User';
        senderAvatar = userData.photoURL;
      }

      // Check if seller and get seller data
      const sellerDoc = await getDoc(doc(db, 'Seller', effectiveSenderId));
      if (sellerDoc.exists()) {
        const sellerData = sellerDoc.data();
        if (sellerData.photoURL) {
          senderAvatar = sellerData.photoURL;
        }
      }

      const messagesRef = ref(database, `chatRooms/${selectedChatRoom.id}/messages`);
      const newMessageRef = push(messagesRef);

      // Determine other user ID - check against effective sender ID
      const otherUserId = selectedChatRoom.user1Id === effectiveSenderId 
        ? selectedChatRoom.user2Id 
        : selectedChatRoom.user1Id;

      const messageData: any = {
        senderId: effectiveSenderId,
        receiverId: otherUserId,
        message: messageText.trim(),
        timestamp: Date.now(),
        senderName,
        isRead: false,
      };

      // Only include senderAvatar if it exists
      if (senderAvatar) {
        messageData.senderAvatar = senderAvatar;
      }

      await set(newMessageRef, messageData);

      // Update chat room's last message and activity
      const chatRoomRef = ref(database, `chatRooms/${selectedChatRoom.id}`);
      await update(chatRoomRef, {
        lastMessage: messageData,
        lastActivity: Date.now(),
      });

      setMessageText('');
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message. Please try again.');
    } finally {
      setSending(false);
    }
  };

  // Get display name for chat room
  const getChatDisplayName = (room: ChatRoom): string => {
    if (!userId) return 'Unknown';

    // For sub-accounts, check against parent ID if available
    const effectiveId = (isSubAccount && parentId) ? parentId : userId;
    const isUser1 = room.user1Id === effectiveId;
    
    if (isSeller) {
      // For sellers, show buyer name or product name
      const otherUserName = isUser1 ? room.user2Name : room.user1Name;
      return otherUserName;
    } else {
      // For buyers, show shop name or seller name
      const shopName = isUser1 ? room.user2ShopName : room.user1ShopName;
      const otherUserName = isUser1 ? room.user2Name : room.user1Name;
      return shopName || otherUserName;
    }
  };

  // Get subtitle (product name for sellers)
  const getChatSubtitle = (room: ChatRoom): string | undefined => {
    if (isSeller && room.productName) {
      return room.productName;
    }
    return undefined;
  };

  // Filter chat rooms by type and search query
  const filteredChatRooms = useMemo(() => {
    let filtered = chatRooms;

    // Filter by chat type
    if (chatFilter === 'inquiries') {
      // Inquiries are product-related chats (have productId)
      filtered = filtered.filter((room) => room.productId && !room.id.startsWith('support_'));
    } else if (chatFilter === 'orders') {
      // Orders are support chats (start with 'support_' or have orderId in the ID)
      filtered = filtered.filter((room) => 
        room.id.startsWith('support_') || room.id.includes('_order_')
      );
    }

    // Filter by search query
    if (searchQuery.trim()) {
      filtered = filtered.filter((room) => {
        const displayName = getChatDisplayName(room).toLowerCase();
        const subtitle = getChatSubtitle(room)?.toLowerCase() || '';
        const query = searchQuery.toLowerCase();
        
        return displayName.includes(query) || subtitle.includes(query);
      });
    }

    return filtered;
  }, [chatRooms, searchQuery, userId, isSeller, chatFilter]);

  // Get other user's avatar
  const getOtherUserAvatar = (room: ChatRoom): string | undefined => {
    if (!userId) return undefined;
    // For sub-accounts, check against parent ID if available
    const effectiveId = (isSubAccount && parentId) ? parentId : userId;
    const isUser1 = room.user1Id === effectiveId;
    return isUser1 ? room.user2Avatar : room.user1Avatar;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[600px]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
          <p className="text-sm text-gray-500">Loading chats...</p>
        </div>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="flex items-center justify-center h-[600px]">
        <div className="text-center">
          <MessageSquare className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg font-medium text-gray-700">Please log in to view chats</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden h-[calc(100vh-200px)]">
      <div className="flex h-full">
        {/* Chat list sidebar */}
        <div className={`${selectedChatRoom ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 border-r border-gray-200`}>
          {/* Filter tabs */}
          <div className="p-4 border-b border-gray-200">
            <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-3">
              <button
                onClick={() => setChatFilter('all')}
                className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                  chatFilter === 'all'
                    ? 'bg-white text-teal-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setChatFilter('inquiries')}
                className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                  chatFilter === 'inquiries'
                    ? 'bg-white text-teal-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Inquiries
              </button>
              <button
                onClick={() => setChatFilter('orders')}
                className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                  chatFilter === 'orders'
                    ? 'bg-white text-teal-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Orders
              </button>
            </div>
            
            {/* Search input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chats..."
                className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                >
                  <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
                </button>
              )}
            </div>
          </div>

          {/* Chat rooms list */}
          <div className="flex-1 overflow-y-auto">
            {filteredChatRooms.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-6">
                <MessageSquare className="w-12 h-12 text-gray-300 mb-3" />
                <p className="text-sm font-medium text-gray-700">No chats yet</p>
                <p className="text-xs text-gray-500 mt-1">
                  {searchQuery ? 'No chats match your search' : 'Start a conversation with a seller or buyer'}
                </p>
              </div>
            ) : (
              filteredChatRooms.map((room) => {
                const displayName = getChatDisplayName(room);
                const subtitle = getChatSubtitle(room);
                const avatar = getOtherUserAvatar(room);
                const lastMsg = room.lastMessage;
                const isUnread = lastMsg && !lastMsg.isRead && lastMsg.receiverId === userId;
                
                // Debug logging for unread status
                if (lastMsg && selectedChatRoom?.id === room.id) {
                  console.log('[DEBUG] Chat room unread check:', {
                    roomId: room.id,
                    hasLastMessage: !!lastMsg,
                    lastMessageIsRead: lastMsg.isRead,
                    lastMessageReceiverId: lastMsg.receiverId,
                    currentUserId: userId,
                    isUnread
                  });
                }

                return (
                  <button
                    key={room.id}
                    onClick={() => setSelectedChatRoom(room)}
                    className={`w-full p-4 flex items-start gap-3 hover:bg-gray-50 transition-colors border-b border-gray-100 text-left ${
                      selectedChatRoom?.id === room.id ? 'bg-teal-50' : ''
                    }`}
                  >
                    {/* Avatar */}
                    <div className="flex-shrink-0">
                      {avatar ? (
                        <img
                          src={avatar}
                          alt={displayName}
                          className="w-12 h-12 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center">
                          <User className="w-6 h-6 text-teal-600" />
                        </div>
                      )}
                    </div>

                    {/* Chat info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className={`text-sm font-medium truncate ${isUnread ? 'text-gray-900' : 'text-gray-700'}`}>
                          {displayName}
                        </h3>
                        {lastMsg && (
                          <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                            {formatDistanceToNow(lastMsg.timestamp, { addSuffix: true })}
                          </span>
                        )}
                      </div>
                      
                      {subtitle && (
                        <p className="text-xs text-gray-500 truncate mb-1">{subtitle}</p>
                      )}
                      
                      {lastMsg && (
                        <p className={`text-xs truncate ${isUnread ? 'font-medium text-gray-900' : 'text-gray-500'}`}>
                          {lastMsg.senderId === userId && 'You: '}
                          {lastMsg.message}
                        </p>
                      )}
                    </div>

                    {isUnread && (
                      <div className="flex-shrink-0">
                        <div className="w-2 h-2 bg-teal-600 rounded-full"></div>
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Chat messages area */}
        {selectedChatRoom ? (
          <div className="flex-1 flex flex-col">
            {/* Chat header */}
            <div className="p-4 border-b border-gray-200 flex items-center gap-3">
              <button
                onClick={() => setSelectedChatRoom(null)}
                className="md:hidden mr-2"
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
              
              {getOtherUserAvatar(selectedChatRoom) ? (
                <img
                  src={getOtherUserAvatar(selectedChatRoom)}
                  alt={getChatDisplayName(selectedChatRoom)}
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center">
                  <User className="w-5 h-5 text-teal-600" />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold text-gray-900 truncate">
                  {getChatDisplayName(selectedChatRoom)}
                </h2>
                {getChatSubtitle(selectedChatRoom) && (
                  <p className="text-xs text-gray-500 truncate">
                    {getChatSubtitle(selectedChatRoom)}
                  </p>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p className="text-sm text-gray-500">No messages yet</p>
                  </div>
                </div>
              ) : (
                messages.map((msg) => {
                  // For sub-accounts, treat messages from either the sub-account or parent as "me"
                  const isMe = effectiveUserIds.includes(msg.senderId);
                  
                  return (
                    <div
                      key={msg.id}
                      className={`flex gap-2 items-end ${isMe ? 'justify-end' : 'justify-start'}`}
                    >
                      {/* Avatar for received messages (left side, bottom aligned) */}
                      {!isMe && (
                        <div className="flex-shrink-0 mb-5">
                          {msg.senderAvatar ? (
                            <img
                              src={msg.senderAvatar}
                              alt={msg.senderName || 'User'}
                              className="w-8 h-8 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center">
                              <User className="w-4 h-4 text-gray-600" />
                            </div>
                          )}
                        </div>
                      )}

                      <div className={`max-w-[70%]`}>
                        {/* Sender name for received messages */}
                        {!isMe && msg.senderName && (
                          <p className="text-xs text-gray-500 mb-1 ml-1">
                            {msg.senderName}
                          </p>
                        )}
                        
                        {msg.messageType === 'image' && msg.imageUrl ? (
                          // Image message
                          <div className="relative group">
                            <img
                              src={msg.imageUrl}
                              alt="Shared image"
                              className="rounded-lg max-w-full h-auto cursor-pointer hover:opacity-90 transition-opacity"
                              style={{ maxHeight: '250px', maxWidth: '250px' }}
                              onClick={() => setFullScreenImage(msg.imageUrl!)}
                            />
                            <button
                              onClick={() => setFullScreenImage(msg.imageUrl!)}
                              className="absolute top-2 right-2 bg-black/50 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <ZoomIn className="w-4 h-4" />
                            </button>
                            {msg.message && msg.message !== '📷 Image' && (
                              <p className={`text-sm mt-1 ${isMe ? 'text-white' : 'text-gray-900'}`}>
                                {msg.message}
                              </p>
                            )}
                          </div>
                        ) : (
                          // Text message
                          <div
                            className={`rounded-lg px-4 py-2 ${
                              isMe
                                ? 'bg-teal-600 text-white'
                                : 'bg-gray-100 text-gray-900'
                            }`}
                          >
                            <p className="text-sm whitespace-pre-wrap break-words">{msg.message}</p>
                          </div>
                        )}
                        <p className={`text-xs text-gray-500 mt-1 ${isMe ? 'text-right' : 'text-left'} ml-1`}>
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>

                      {/* Avatar for sent messages (right side, bottom aligned) */}
                      {isMe && (
                        <div className="flex-shrink-0 mb-5 order-3">
                          {currentUserAvatar ? (
                            <img
                              src={currentUserAvatar}
                              alt="You"
                              className="w-8 h-8 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-teal-600 flex items-center justify-center">
                              <User className="w-4 h-4 text-white" />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              
              {/* Uploading image preview */}
              {uploadingImage && (
                <div className="flex gap-2 items-end justify-end">
                  <div className="max-w-[70%]">
                    <div className="bg-teal-600 text-white rounded-lg px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <div className="flex-1">
                          <p className="text-sm font-medium">Uploading image...</p>
                          <div className="mt-2 bg-white/20 rounded-full h-2 overflow-hidden">
                            <div 
                              className="bg-white h-full transition-all duration-300"
                              style={{ width: `${uploadProgress}%` }}
                            />
                          </div>
                          <p className="text-xs mt-1 opacity-80">{Math.round(uploadProgress)}%</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Current user avatar (bottom aligned) */}
                  <div className="flex-shrink-0 mb-5">
                    {currentUserAvatar ? (
                      <img
                        src={currentUserAvatar}
                        alt="You"
                        className="w-8 h-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-teal-600 flex items-center justify-center">
                        <User className="w-4 h-4 text-white" />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Message input */}
            <div className="p-4 border-t border-gray-200">
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingImage || sending}
                  className="px-3 py-2 text-teal-600 hover:bg-teal-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Send image"
                >
                  <ImageIcon className="w-5 h-5" />
                </button>
                <input
                  type="text"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Type a message..."
                  disabled={sending || uploadingImage}
                  className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
                <button
                  onClick={sendMessage}
                  disabled={!messageText.trim() || sending || uploadingImage}
                  className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  <span className="hidden sm:inline">Send</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="hidden md:flex flex-1 items-center justify-center bg-gray-50">
            <div className="text-center">
              <MessageSquare className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium text-gray-700">Select a chat to start messaging</p>
              <p className="text-sm text-gray-500 mt-1">Choose a conversation from the list</p>
            </div>
          </div>
        )}
      </div>

      {/* Full-screen image viewer */}
      {fullScreenImage && (
        <div 
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setFullScreenImage(null)}
        >
          <button
            onClick={() => setFullScreenImage(null)}
            className="absolute top-4 right-4 text-white hover:text-gray-300 transition-colors"
          >
            <X className="w-8 h-8" />
          </button>
          <img
            src={fullScreenImage}
            alt="Full screen view"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};

export default ChatsTab;
