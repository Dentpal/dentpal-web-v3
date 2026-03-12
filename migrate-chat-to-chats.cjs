const admin = require('firebase-admin');
const fs = require('fs');

// Function to initialize Firebase with different auth methods
async function initializeFirebase() {
  try {
    // Method 1: Try using service account if available
    if (fs.existsSync('./serviceAccountKey.json')) {
      const serviceAccount = require('./serviceAccountKey.json');
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: 'dentpal-161e5'
      });
      console.log('✅ Initialized with service account key');
      return true;
    }
    
    // Method 2: Try using application default credentials with explicit project
    admin.initializeApp({
      projectId: 'dentpal-161e5'
    });
    
    // Test the connection
    const db = admin.firestore();
    await db.collection('_test').limit(1).get();
    console.log('✅ Initialized with default credentials');
    return true;
    
  } catch (error) {
    console.log('❌ Firebase initialization failed:', error.message);
    return false;
  }
}

async function migrateChatToChats() {
  // Initialize Firebase first
  const initialized = await initializeFirebase();
  if (!initialized) {
    console.error('Failed to initialize Firebase. Exiting.');
    process.exit(1);
  }
  
  const db = admin.firestore();
  console.log('Starting migration of chat -> chats permission...');
  
  try {
    // 1. Update all Seller documents
    const sellersSnapshot = await db.collection('Seller').get();
    console.log(`Found ${sellersSnapshot.size} seller documents`);
    
    for (const doc of sellersSnapshot.docs) {
      const data = doc.data();
      if (data.permissions && typeof data.permissions.chat !== 'undefined') {
        const chatValue = data.permissions.chat;
        console.log(`Migrating Seller/${doc.id}: chat=${chatValue} -> chats=${chatValue}`);
        await doc.ref.update({
          'permissions.chats': chatValue,
          'permissions.chat': admin.firestore.FieldValue.delete()
        });
      }
      
      // Also update members subcollection
      const membersSnapshot = await doc.ref.collection('members').get();
      if (membersSnapshot.size > 0) {
        console.log(`  Found ${membersSnapshot.size} members under Seller/${doc.id}`);
        for (const memberDoc of membersSnapshot.docs) {
          const memberData = memberDoc.data();
          if (memberData.permissions && typeof memberData.permissions.chat !== 'undefined') {
            const chatValue = memberData.permissions.chat;
            console.log(`  Migrating member ${memberDoc.id}: chat=${chatValue} -> chats=${chatValue}`);
            await memberDoc.ref.update({
              'permissions.chats': chatValue,
              'permissions.chat': admin.firestore.FieldValue.delete()
            });
          }
        }
      }
    }
    
    // 2. Update legacy web_users collection if it exists
    try {
      const webUsersSnapshot = await db.collection('web_users').get();
      console.log(`Found ${webUsersSnapshot.size} web_users documents`);
      
      for (const doc of webUsersSnapshot.docs) {
        const data = doc.data();
        if (data.permissions && typeof data.permissions.chat !== 'undefined') {
          const chatValue = data.permissions.chat;
          console.log(`Migrating web_users/${doc.id}: chat=${chatValue} -> chats=${chatValue}`);
          await doc.ref.update({
            'permissions.chats': chatValue,
            'permissions.chat': admin.firestore.FieldValue.delete()
          });
        }
      }
    } catch (e) {
      console.log('No web_users collection or error accessing it:', e.message);
    }
    
    console.log('\n✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    process.exit(0);
  }
}

migrateChatToChats();
