const admin = require('firebase-admin');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Function to get Firebase access token
async function getFirebaseToken() {
    try {
        // Try to use Firebase CLI to get token
        const { stdout } = await execAsync('firebase login:ci --no-localhost 2>/dev/null || echo "no-token"');
        return stdout.trim();
    } catch (error) {
        return null;
    }
}

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

async function fetchDocumentWithSubcollections(collection, documentId) {
    try {
        console.log(`📄 Fetching ${collection}/${documentId}`);
        
        const db = admin.firestore();
        const docRef = db.collection(collection).doc(documentId);
        const docSnap = await docRef.get();
        
        if (!docSnap.exists) {
            console.log(`❌ Document ${collection}/${documentId} does not exist`);
            return null;
        }
        
        const result = {
            id: docSnap.id,
            data: docSnap.data(),
            subcollections: {}
        };
        
        // Get all subcollections
        const collections = await docRef.listCollections();
        console.log(`  └─ Found ${collections.length} subcollections: ${collections.map(c => c.id).join(', ')}`);
        
        for (const subcol of collections) {
            console.log(`    📁 Fetching subcollection: ${subcol.id}`);
            const subcollectionDocs = await subcol.get();
            result.subcollections[subcol.id] = [];
            
            subcollectionDocs.forEach(subdoc => {
                result.subcollections[subcol.id].push({
                    id: subdoc.id,
                    data: subdoc.data()
                });
            });
            
            console.log(`    └─ Found ${subcollectionDocs.size} documents in ${subcol.id}`);
        }
        
        console.log(`✅ Successfully fetched ${collection}/${documentId}`);
        return result;
        
    } catch (error) {
        console.error(`❌ Error fetching ${collection}/${documentId}:`, error.message);
        return null;
    }
}

async function main() {
    console.log('🔥 Firestore Data Fetcher');
    console.log('Project ID: dentpal-161e5');
    
    const timestamp = new Date().toISOString();
    const outputFile = `firestore-data-node-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    
    console.log(`Output file: ${outputFile}`);
    console.log('');
    
    // Initialize Firebase
    const initialized = await initializeFirebase();
    if (!initialized) {
        console.log('');
        console.log('❌ Failed to initialize Firebase. Please try one of these options:');
        console.log('');
        console.log('1. Download service account key:');
        console.log('   - Go to Firebase Console > Project Settings > Service Accounts');
        console.log('   - Generate new private key and save as serviceAccountKey.json');
        console.log('');
        console.log('2. Use gcloud authentication:');
        console.log('   gcloud auth application-default login');
        console.log('');
        console.log('3. Use Firebase CLI authentication:');
        console.log('   export GOOGLE_APPLICATION_CREDENTIALS=""');
        console.log('   firebase use dentpal-161e5');
        
        return;
    }
    
    try {
        const results = {
            timestamp,
            project_id: 'dentpal-161e5',
            data: {}
        };
        
        // Fetch documents
        const documents = [
            { collection: 'UserLookup', id: '1ruvuCzlBMT2vxbFXcvomcmUYwp2', key: 'userlookup' },
        ];
        
        for (const doc of documents) {
            results.data[doc.key] = await fetchDocumentWithSubcollections(doc.collection, doc.id);
        }
        
        // Write to file
        const jsonString = JSON.stringify(results, null, 2);
        fs.writeFileSync(outputFile, jsonString);
        
        console.log('');
        console.log('✅ Data fetch completed!');
        console.log(`📁 Output saved to: ${outputFile}`);
        
        const stats = fs.statSync(outputFile);
        console.log(`📊 File size: ${(stats.size / 1024).toFixed(2)} KB`);
        
        console.log('');
        console.log('📋 Summary:');
        console.log('• Order: QRIZxyy31vtQbsGOH7Gk');
        console.log('• Seller: fNEIry9W7lRWizOmb2ZC0tZoOGu2');
        console.log('• User: cixRRzmjf3d68C8mYRldrxAYJHU2');
        
        console.log('');
        console.log('💡 To view the data:');
        console.log(`  cat ${outputFile} | jq .`);
        console.log(`  or`);
        console.log(`  open ${outputFile}`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main();
