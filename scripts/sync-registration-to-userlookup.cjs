/**
 * Sync RegistrationNo from User collection to UserLookup collection
 * 
 * This script reads the RegistrationNo field from each user document
 * and adds it to the corresponding userlookup document.
 * 
 * Usage:
 *   # Dry run (see what would be updated without making changes):
 *   DRY_RUN=1 node scripts/sync-registration-to-userlookup.cjs
 * 
 *   # Actually perform the sync:
 *   node scripts/sync-registration-to-userlookup.cjs
 * 
 *   # With explicit service account:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
 *   node scripts/sync-registration-to-userlookup.cjs
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

function initAdmin() {
  if (admin.apps.length) return;
  
  try {
    // Check for service account in project root
    const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');
    
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const sa = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);
      admin.initializeApp({ credential: admin.credential.cert(sa) });
      console.log('[init] ✅ Initialized with service account from GOOGLE_APPLICATION_CREDENTIALS');
    } else if (fs.existsSync(serviceAccountPath)) {
      const sa = require(serviceAccountPath);
      admin.initializeApp({ credential: admin.credential.cert(sa) });
      console.log('[init] ✅ Initialized with serviceAccountKey.json');
    } else {
      // Use Application Default Credentials
      admin.initializeApp({ projectId: 'dentpal-161e5' });
      console.log('[init] ✅ Initialized with Application Default Credentials');
    }
  } catch (e) {
    console.error('[init] ❌ Failed to initialize Firebase Admin:', e.message);
    process.exit(1);
  }
}

async function syncRegistrationNumbers() {
  initAdmin();
  const db = admin.firestore();
  const dryRun = !!process.env.DRY_RUN;

  console.log('\n========================================');
  console.log('  Sync RegistrationNo to UserLookup');
  console.log('========================================');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN (no changes will be made)' : '⚡ LIVE (changes will be applied)'}`);
  console.log('');

  // Fetch all users from the 'User' collection
  console.log('[sync] 📥 Fetching all users from "User" collection...');
  const usersSnap = await db.collection('User').get();
  console.log(`[sync] Found ${usersSnap.size} users\n`);

  let updated = 0;
  let skipped = 0;
  let noRegistration = 0;
  let errors = 0;

  for (const userDoc of usersSnap.docs) {
    const userId = userDoc.id;
    const userData = userDoc.data();
    const registrationNo = userData.RegistrationNo;

    // Skip users without RegistrationNo
    if (!registrationNo) {
      console.log(`[sync] ⏭️  User ${userId}: No RegistrationNo found, skipping`);
      noRegistration++;
      continue;
    }

    try {
      // Check if UserLookup document exists
      const lookupRef = db.collection('UserLookup').doc(userId);
      const lookupSnap = await lookupRef.get();

      if (!lookupSnap.exists) {
        console.log(`[sync] ⚠️  User ${userId}: No UserLookup document found, skipping`);
        skipped++;
        continue;
      }

      const lookupData = lookupSnap.data();
      
      // Check if RegistrationNo already exists and matches
      if (lookupData.RegistrationNo === registrationNo) {
        console.log(`[sync] ✓  User ${userId}: RegistrationNo already synced (${registrationNo})`);
        skipped++;
        continue;
      }

      // Update the UserLookup document
      if (dryRun) {
        console.log(`[sync] 🔍 User ${userId}: Would add RegistrationNo "${registrationNo}" to UserLookup`);
      } else {
        await lookupRef.update({
          RegistrationNo: registrationNo,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`[sync] ✅ User ${userId}: Added RegistrationNo "${registrationNo}" to UserLookup`);
      }
      updated++;

    } catch (error) {
      console.error(`[sync] ❌ User ${userId}: Error - ${error.message}`);
      errors++;
    }
  }

  // Summary
  console.log('\n========================================');
  console.log('  Summary');
  console.log('========================================');
  console.log(`Total users processed: ${usersSnap.size}`);
  console.log(`${dryRun ? 'Would update' : 'Updated'}: ${updated}`);
  console.log(`Skipped (already synced or no lookup): ${skipped}`);
  console.log(`No RegistrationNo: ${noRegistration}`);
  console.log(`Errors: ${errors}`);
  
  if (dryRun && updated > 0) {
    console.log('\n💡 Run without DRY_RUN to apply changes:');
    console.log('   node scripts/sync-registration-to-userlookup.cjs');
  }
}

// Run the sync
syncRegistrationNumbers()
  .then(() => {
    console.log('\n[sync] ✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n[sync] ❌ Script failed:', error);
    process.exit(1);
  });
