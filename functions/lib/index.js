"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testCreateJRSShipping = exports.setUserAccountStatus = exports.deleteUserAccount = exports.listPaymongoTransactions = exports.getPaymongoTransaction = exports.getWalletTransactions = exports.checkWithdrawalStatus = exports.processWithdrawal = exports.getSellerReturnRequests = exports.processReturnRequest = exports.createJRSShipping = exports.processSellerPayoutAdjustments = exports.getSellerPayoutAdjustments = void 0;
const https_1 = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
const params_1 = require("firebase-functions/params");
const axios_1 = require("axios");
// Initialize Firebase Admin
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)();
const auth = (0, auth_1.getAuth)();
// Define parameters for JRS API
const JRS_API_KEY = (0, params_1.defineString)("JRS_API_KEY");
const JRS_API_URL = (0, params_1.defineString)("JRS_API_URL", { default: "https://jrs-express.azure-api.net/qa-online-shipping-ship/ShippingRequestFunction" });
// Define parameters for PayMongo API
const PAYMONGO_SECRET_KEY = (0, params_1.defineSecret)("PAYMONGO_SECRET_KEY");
const PAYMONGO_WALLET_ID = (0, params_1.defineString)("PAYMONGO_WALLET_ID");
const PAYMONGO_API_URL = (0, params_1.defineString)("PAYMONGO_API_URL", { default: "https://api.paymongo.com/v1" });
const verifyAuthToken = async (authorizationHeader) => {
    if (!authorizationHeader) {
        throw new Error("Missing Authorization header");
    }
    const token = authorizationHeader.startsWith("Bearer ")
        ? authorizationHeader.substring(7)
        : authorizationHeader;
    if (!token) {
        throw new Error("Invalid Authorization header format");
    }
    try {
        const decodedToken = await auth.verifyIdToken(token);
        return decodedToken;
    }
    catch (error) {
        logger.error("Token verification failed", { error });
        throw new Error("Invalid or expired authentication token");
    }
};
/**
 * Custom error class for admin access verification failures
 */
class AdminAccessError extends Error {
    constructor(message) {
        super(message);
        this.name = "AdminAccessError";
    }
}
/**
 * Verify that the authenticated user has admin role
 * @param adminUid - The UID of the authenticated user (from decodedToken.uid)
 * @param actionDescription - Description of the action being attempted (for logging)
 * @throws AdminAccessError if user is not an admin
 */
const verifyAdminAccess = async (adminUid, actionDescription) => {
    var _a, _b;
    const adminDoc = await db.collection("Seller").doc(adminUid).get();
    if (!adminDoc.exists || ((_a = adminDoc.data()) === null || _a === void 0 ? void 0 : _a.role) !== "admin") {
        logger.warn(`Non-admin user attempted to ${actionDescription}`, {
            adminUid,
            role: ((_b = adminDoc.data()) === null || _b === void 0 ? void 0 : _b.role) || "unknown",
        });
        throw new AdminAccessError("Unauthorized. Admin access required.");
    }
};
/**
 * Determine the JRS product name (packaging type) based on shipment weight and dimensions.
 *
 * Rules are checked in order from smallest to largest package.
 * Weight thresholds are MAXIMUM capacities (the item must weigh at or below the limit).
 * Dimension checks are orientation-independent (item can be rotated to fit).
 * If no rule matches, returns undefined so the JRS API determines the product automatically.
 *
 * All dimensions are in centimeters, all weights are in grams.
 */
function determineProductName(shipmentItems) {
    if (!shipmentItems || shipmentItems.length === 0) {
        return undefined;
    }
    // Validate that every item has positive dimensions and weight.
    // If any item is missing data we cannot reliably choose a package,
    // so return undefined and let the JRS API auto-select.
    for (const item of shipmentItems) {
        if (item.width == null || item.width <= 0 ||
            item.length == null || item.length <= 0 ||
            item.height == null || item.height <= 0 ||
            item.weight == null || item.weight <= 0) {
            logger.info("📦 Skipping manual packaging — item has missing/invalid dimensions", {
                width: item.width,
                length: item.length,
                height: item.height,
                weight: item.weight,
                itemCount: shipmentItems.length,
            });
            return undefined;
        }
    }
    const totalWeight = shipmentItems.reduce((sum, item) => sum + item.weight, 0);
    // Get the aggregate dimensions across all items
    // For each item, sort its 2D footprint (width × length) so the larger is always "long" and smaller is "short"
    // This makes the check orientation-independent
    // Footprint (maxShort/maxLong) = largest single-item footprint (items share the same base)
    // Height (totalHeight) = sum of all item heights (items stack on top of each other)
    let maxShort = 0;
    let maxLong = 0;
    let totalHeight = 0;
    for (const item of shipmentItems) {
        const short = Math.min(item.width, item.length);
        const long = Math.max(item.width, item.length);
        maxShort = Math.max(maxShort, short);
        maxLong = Math.max(maxLong, long);
        totalHeight += item.height;
    }
    logger.info("📐 determineProductName input:", {
        totalWeight, maxShort, maxLong, totalHeight,
        itemCount: shipmentItems.length,
    });
    // Named constants for thickness limits (cm) per JRS docs
    const EXPRESS_LETTER_MAX_THICK = 0.5; // 0.5 cm
    const ONE_POUNDER_MAX_THICK = 2.0; // 2.0 cm
    const THREE_POUNDER_MAX_THICK = 3.0; // 3.0 cm
    const FIVE_POUNDER_MAX_THICK = 5.0; // 5.0 cm
    // Helper: check if items fit in a 2D envelope/pouch (orientation-independent)
    const fitsIn2D = (pkgDim1, pkgDim2, pkgMaxThickness) => {
        const pkgShort = Math.min(pkgDim1, pkgDim2);
        const pkgLong = Math.max(pkgDim1, pkgDim2);
        return maxShort <= pkgShort && maxLong <= pkgLong && totalHeight <= pkgMaxThickness;
    };
    // Helper: check if items fit in a 3D box (orientation-independent)
    const fitsIn3D = (pkgDim1, pkgDim2, pkgDim3) => {
        const pkgDims = [pkgDim1, pkgDim2, pkgDim3].sort((a, b) => a - b);
        const itemDims = [maxShort, maxLong, totalHeight].sort((a, b) => a - b);
        return itemDims[0] <= pkgDims[0] && itemDims[1] <= pkgDims[1] && itemDims[2] <= pkgDims[2];
    };
    // Rule 1: Express Letter (max 100g, fits 24.13 × 16.00 × 0.5 cm)
    if (totalWeight <= 100 && fitsIn2D(24.13, 16.00, EXPRESS_LETTER_MAX_THICK)) {
        logger.info("📦 Matched: Express Letter");
        return "Express Letter";
    }
    // Rule 2: 1 Pounder (max 500g, fits 38.10 × 27.94 × 2.0 cm)
    if (totalWeight <= 500 && fitsIn2D(38.10, 27.94, ONE_POUNDER_MAX_THICK)) {
        logger.info("📦 Matched: 1 Pounder");
        return "1 Pounder";
    }
    // Rule 3: 3 Pounder (max 1500g, fits 45.72 × 35.56 × 3.0 cm)
    if (totalWeight <= 1500 && fitsIn2D(45.72, 35.56, THREE_POUNDER_MAX_THICK)) {
        logger.info("📦 Matched: 3 Pounder");
        return "3 Pounder";
    }
    // Rule 4: Bulilit Box — checked BEFORE 5 Pounder (specialized small box)
    // (max 2500g, fits 20.32 × 29.21 × 10.16 cm)
    if (totalWeight <= 2500 && fitsIn3D(20.32, 29.21, 10.16)) {
        logger.info("📦 Matched: Bulilit Box");
        return "Bulilit Box";
    }
    // Rule 5: 5 Pounder (max 2500g, fits 50.80 × 35.56 × 5.0 cm)
    if (totalWeight <= 2500 && fitsIn2D(50.80, 35.56, FIVE_POUNDER_MAX_THICK)) {
        logger.info("📦 Matched: 5 Pounder");
        return "5 Pounder";
    }
    // No rule matched — let the JRS API determine automatically
    logger.info("📦 No manual rule matched — API will determine productName automatically", {
        totalWeight, maxShort, maxLong, totalHeight,
    });
    return undefined;
}
// Helper functions
const fetchOrderData = async (orderId) => {
    const collections = ["Order", "orders"];
    for (const collectionName of collections) {
        const orderDoc = await db.collection(collectionName).doc(orderId).get();
        if (orderDoc.exists) {
            return { data: orderDoc.data(), collection: collectionName };
        }
    }
    return null;
};
const fetchUserData = async (userId) => {
    const userDoc = await db.collection("web_users").doc(userId).get();
    if (userDoc.exists) {
        return userDoc.data();
    }
    return null;
};
const fetchSellerData = async (sellerId) => {
    const sellerDoc = await db.collection("Seller").doc(sellerId).get();
    if (sellerDoc.exists) {
        return sellerDoc.data();
    }
    return null;
};
const calculateShipmentItems = (orderItems) => {
    // No defaultDimensions: missing values are set to -1 (invalid) to trigger determineProductName's guard
    const items = [];
    for (const item of orderItems) {
        const quantity = typeof item.quantity === "number" && item.quantity > 0 ? item.quantity : 1;
        let length = -1;
        let width = -1;
        let height = -1;
        let unitWeightGrams = -1;
        const unitDeclaredValue = item.price || 100;
        if (item.dimensions) {
            length = typeof item.dimensions.length === "number" ? item.dimensions.length : -1;
            width = typeof item.dimensions.width === "number" ? item.dimensions.width : -1;
            height = typeof item.dimensions.height === "number" ? item.dimensions.height : -1;
            unitWeightGrams = typeof item.dimensions.weight === "number" ? item.dimensions.weight * 1000 : -1;
        }
        else {
            // Log warning if dimensions are missing
            logger.warn("Order item missing dimensions, applying -1 for determineProductName auto-selection", {
                orderId: item.orderId || "unknown",
                itemId: item.productId || item.id || "unknown",
                itemName: item.name || item.productName || "unknown",
            });
            // All fields remain -1
        }
        // Expand each order line into per-unit ShipmentItem entries so that
        // determineProductName correctly sums totalHeight (stacked items) and
        // totalWeight across all physical units.
        for (let i = 0; i < quantity; i++) {
            items.push({
                length,
                width,
                height,
                weight: unitWeightGrams,
                declaredValue: unitDeclaredValue,
            });
        }
    }
    return items;
};
const generateShipmentDescription = (items) => {
    const productNames = items.map(item => item.name || item.productName || "Dental Supply").join(", ");
    return `Dental Supplies: ${productNames}`.substring(0, 100); // Limit length
};
// Function to create seller payout adjustment for shipping charges
const createSellerPayoutAdjustment = async (params) => {
    try {
        const adjustmentData = {
            orderId: params.orderId,
            sellerId: params.sellerId,
            type: 'shipping_charge',
            amount: -params.shippingCharge,
            description: `Shipping charge deduction for order ${params.orderId}`,
            shippingReference: params.shippingReferenceNo,
            trackingId: params.trackingId || null,
            status: 'pending_deduction',
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            metadata: {
                originalShippingCharge: params.shippingCharge,
                appliedAt: new Date().toISOString(),
                reason: 'seller_portion_shipping_fee',
            }
        };
        // Create adjustment record in SellerPayoutAdjustments collection
        const adjustmentRef = await db.collection('SellerPayoutAdjustments').add(adjustmentData);
        logger.info("Created seller payout adjustment", {
            adjustmentId: adjustmentRef.id,
            orderId: params.orderId,
            sellerId: params.sellerId,
            shippingCharge: params.shippingCharge,
            trackingId: params.trackingId,
        });
        // Update seller's total adjustments
        const sellerRef = db.collection('Seller').doc(params.sellerId);
        await sellerRef.update({
            payoutAdjustments: {
                totalShippingCharges: firestore_1.FieldValue.increment(params.shippingCharge),
                pendingDeductions: firestore_1.FieldValue.increment(params.shippingCharge),
                lastUpdated: firestore_1.FieldValue.serverTimestamp(),
            }
        });
        return adjustmentRef.id;
    }
    catch (error) {
        logger.error("Failed to create seller payout adjustment", {
            orderId: params.orderId,
            sellerId: params.sellerId,
            shippingCharge: params.shippingCharge,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
    }
};
const parseAddress = (shippingInfo) => {
    // Extract district/barangay from addressLine1 if it contains "Brgy." or "Barangay"
    let district = "N/A";
    let addressLine1 = shippingInfo.addressLine1 || "";
    const brggyMatch = addressLine1.match(/(?:Brgy\.?\s+|Barangay\s+)([^,]+)/i);
    if (brggyMatch) {
        district = brggyMatch[1].trim();
        // Remove the barangay part from address line
        addressLine1 = addressLine1.replace(/,?\s*(?:Brgy\.?\s+|Barangay\s+)[^,]+/i, '').trim();
    }
    return {
        addressLine1: addressLine1 || shippingInfo.addressLine1 || "N/A",
        district: district,
        city: shippingInfo.city || "N/A",
        state: shippingInfo.state || shippingInfo.province || "Metro Manila",
        country: shippingInfo.country || "Philippines",
        postalCode: shippingInfo.postalCode || "",
    };
};
// Function to process seller payout adjustments (can be called manually or on schedule)
// Function to get seller payout adjustments (for sellers to view their charges)
exports.getSellerPayoutAdjustments = (0, https_1.onRequest)({
    cors: true,
    region: "asia-southeast1",
}, async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        // Verify authentication
        let decodedToken;
        try {
            decodedToken = await verifyAuthToken(req.headers.authorization);
        }
        catch (authError) {
            res.status(401).json({
                error: "Authentication required",
                message: authError instanceof Error ? authError.message : "Invalid authentication"
            });
            return;
        }
        const { sellerId } = req.query;
        let targetSellerId = sellerId;
        // If no sellerId provided, try to find seller record for authenticated user
        if (!targetSellerId) {
            const sellerQuery = await db.collection('Seller')
                .where('userId', '==', decodedToken.uid)
                .limit(1)
                .get();
            if (sellerQuery.empty) {
                res.status(404).json({
                    error: "Seller not found",
                    message: "No seller record found for authenticated user"
                });
                return;
            }
            targetSellerId = sellerQuery.docs[0].id;
        }
        // Verify authorization - user must be the seller owner or admin
        const sellerDoc = await db.collection('Seller').doc(targetSellerId).get();
        if (!sellerDoc.exists) {
            res.status(404).json({ error: "Seller not found" });
            return;
        }
        const sellerData = sellerDoc.data();
        const isSellerOwner = (sellerData === null || sellerData === void 0 ? void 0 : sellerData.userId) === decodedToken.uid || (sellerData === null || sellerData === void 0 ? void 0 : sellerData.email) === decodedToken.email;
        const isAdmin = decodedToken.role === 'admin' || ((_a = decodedToken.customClaims) === null || _a === void 0 ? void 0 : _a.role) === 'admin';
        if (!isSellerOwner && !isAdmin) {
            res.status(403).json({
                error: "Access denied",
                message: "You can only view your own payout adjustments"
            });
            return;
        }
        // Get payout adjustments for seller
        const adjustmentsQuery = await db.collection('SellerPayoutAdjustments')
            .where('sellerId', '==', targetSellerId)
            .where('type', '==', 'shipping_charge')
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();
        const adjustments = adjustmentsQuery.docs.map(doc => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j;
            return ({
                id: doc.id,
                ...doc.data(),
                createdAt: ((_c = (_b = (_a = doc.data().createdAt) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) === null || _c === void 0 ? void 0 : _c.toISOString()) || doc.data().createdAt,
                updatedAt: ((_f = (_e = (_d = doc.data().updatedAt) === null || _d === void 0 ? void 0 : _d.toDate) === null || _e === void 0 ? void 0 : _e.call(_d)) === null || _f === void 0 ? void 0 : _f.toISOString()) || doc.data().updatedAt,
                processedAt: ((_j = (_h = (_g = doc.data().processedAt) === null || _g === void 0 ? void 0 : _g.toDate) === null || _h === void 0 ? void 0 : _h.call(_g)) === null || _j === void 0 ? void 0 : _j.toISOString()) || doc.data().processedAt,
            });
        });
        // Get seller summary
        const sellerSummary = (sellerData === null || sellerData === void 0 ? void 0 : sellerData.payoutAdjustments) || {};
        res.status(200).json({
            success: true,
            sellerId: targetSellerId,
            adjustments,
            summary: {
                totalShippingCharges: sellerSummary.totalShippingCharges || 0,
                pendingDeductions: sellerSummary.pendingDeductions || 0,
                processedDeductions: sellerSummary.processedDeductions || 0,
                lastUpdated: ((_d = (_c = (_b = sellerSummary.lastUpdated) === null || _b === void 0 ? void 0 : _b.toDate) === null || _c === void 0 ? void 0 : _c.call(_b)) === null || _d === void 0 ? void 0 : _d.toISOString()) || sellerSummary.lastUpdated,
                lastProcessed: ((_g = (_f = (_e = sellerSummary.lastProcessed) === null || _e === void 0 ? void 0 : _e.toDate) === null || _f === void 0 ? void 0 : _f.call(_e)) === null || _g === void 0 ? void 0 : _g.toISOString()) || sellerSummary.lastProcessed,
            },
            count: adjustments.length,
        });
    }
    catch (error) {
        logger.error("Error in getSellerPayoutAdjustments", {
            error: error instanceof Error ? error.message : "Unknown error",
        });
        res.status(500).json({
            error: "Internal server error",
            message: error instanceof Error ? error.message : "Unknown error",
        });
    }
});
exports.processSellerPayoutAdjustments = (0, https_1.onRequest)({
    cors: true,
    region: "asia-southeast1",
}, async (req, res) => {
    var _a;
    try {
        // Verify authentication
        let decodedToken;
        try {
            decodedToken = await verifyAuthToken(req.headers.authorization);
            // Only allow admin users to process payouts
            const isAdmin = decodedToken.role === 'admin' ||
                ((_a = decodedToken.customClaims) === null || _a === void 0 ? void 0 : _a.role) === 'admin';
            if (!isAdmin) {
                res.status(403).json({
                    error: "Access denied",
                    message: "Only administrators can process seller payout adjustments"
                });
                return;
            }
        }
        catch (authError) {
            res.status(401).json({
                error: "Authentication required",
                message: authError instanceof Error ? authError.message : "Invalid authentication"
            });
            return;
        }
        // Query pending shipping charge adjustments
        const pendingAdjustments = await db.collection('SellerPayoutAdjustments')
            .where('type', '==', 'shipping_charge')
            .where('status', '==', 'pending_deduction')
            .get();
        const processed = [];
        const errors = [];
        for (const doc of pendingAdjustments.docs) {
            try {
                await db.runTransaction(async (transaction) => {
                    var _a;
                    const adjustmentSnap = await transaction.get(doc.ref);
                    if (!adjustmentSnap.exists) {
                        throw new Error("Adjustment document does not exist");
                    }
                    const adjustment = adjustmentSnap.data();
                    if (!adjustment) {
                        throw new Error("Adjustment data is undefined");
                    }
                    // Prevent double-processing
                    if (adjustment.status === 'processed') {
                        logger.warn("Adjustment already processed, skipping", {
                            adjustmentId: doc.id,
                            sellerId: adjustment.sellerId,
                            orderId: adjustment.orderId,
                        });
                        return;
                    }
                    // Compute delta as positive magnitude for decrementing pendingDeductions
                    const originalShipping = (_a = adjustment.metadata) === null || _a === void 0 ? void 0 : _a.originalShippingCharge;
                    const delta = typeof originalShipping === 'number'
                        ? originalShipping
                        : Math.abs(adjustment.amount);
                    // Update adjustment status
                    transaction.update(doc.ref, {
                        status: 'processed',
                        processedAt: firestore_1.FieldValue.serverTimestamp(),
                        processedBy: decodedToken.uid,
                    });
                    // Update seller's payout adjustments
                    const sellerRef = db.collection('Seller').doc(adjustment.sellerId);
                    transaction.update(sellerRef, {
                        'payoutAdjustments.pendingDeductions': firestore_1.FieldValue.increment(-delta),
                        'payoutAdjustments.processedDeductions': firestore_1.FieldValue.increment(delta),
                        'payoutAdjustments.lastProcessed': firestore_1.FieldValue.serverTimestamp(),
                    });
                });
                processed.push({
                    adjustmentId: doc.id,
                    orderId: doc.data().orderId,
                    sellerId: doc.data().sellerId,
                    amount: doc.data().amount,
                });
                logger.info("Processed seller payout adjustment (transaction)", {
                    adjustmentId: doc.id,
                    sellerId: doc.data().sellerId,
                    orderId: doc.data().orderId,
                    amount: doc.data().amount,
                });
            }
            catch (error) {
                logger.error("Failed to process adjustment (transaction)", {
                    adjustmentId: doc.id,
                    sellerId: doc.data().sellerId,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
                errors.push({
                    adjustmentId: doc.id,
                    sellerId: doc.data().sellerId,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        }
        res.status(200).json({
            success: true,
            message: `Processed ${processed.length} shipping charge adjustments`,
            processed,
            errors,
            summary: {
                totalProcessed: processed.length,
                totalErrors: errors.length,
                totalAmount: processed.reduce((sum, item) => sum + Math.abs(item.amount), 0),
            },
        });
    }
    catch (error) {
        logger.error("Error in processSellerPayoutAdjustments", {
            error: error instanceof Error ? error.message : "Unknown error",
        });
        res.status(500).json({
            error: "Internal server error",
            message: error instanceof Error ? error.message : "Unknown error",
        });
    }
});
exports.createJRSShipping = (0, https_1.onRequest)({
    cors: true,
    region: "asia-southeast1",
}, async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24, _25, _26, _27, _28, _29, _30, _31, _32, _33, _34, _35, _36, _37, _38, _39;
    // Add explicit CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '86400');
    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    try {
        // Check for POST method
        if (req.method !== "POST") {
            res.status(405).json({ error: "Method not allowed" });
            return;
        }
        // Verify authentication token
        let decodedToken;
        try {
            decodedToken = await verifyAuthToken(req.headers.authorization);
            logger.info("Authenticated shipping request", {
                uid: decodedToken.uid,
                email: decodedToken.email
            });
        }
        catch (authError) {
            logger.warn("Unauthenticated shipping request attempt", {
                ip: req.ip,
                userAgent: req.headers["user-agent"]
            });
            res.status(401).json({
                error: "Authentication required",
                message: authError instanceof Error ? authError.message : "Invalid authentication"
            });
            return;
        }
        const payload = req.body;
        // Validate required orderId
        if (!payload.orderId) {
            res.status(400).json({ error: "Missing orderId" });
            return;
        }
        logger.info("Processing JRS shipping request", {
            orderId: payload.orderId,
            authenticatedUser: decodedToken.uid
        });
        // Fetch order data from Firestore
        const orderResult = await fetchOrderData(payload.orderId);
        if (!orderResult) {
            res.status(404).json({ error: "Order not found" });
            return;
        }
        const orderData = orderResult.data;
        if (!orderData) {
            res.status(404).json({ error: "Order data not found" });
            return;
        }
        // Authorization check - ensure user can access this order
        // Allow if user is the order owner, a seller involved, or an admin
        const isOrderOwner = orderData.userId === decodedToken.uid;
        const isAdmin = decodedToken.role === 'admin' ||
            ((_a = decodedToken.customClaims) === null || _a === void 0 ? void 0 : _a.role) === 'admin';
        let isSeller = false;
        if (orderData.sellerIds && Array.isArray(orderData.sellerIds)) {
            // First check if the user's UID is directly in the sellerIds array
            // (Some orders store user UIDs directly in sellerIds)
            if (orderData.sellerIds.includes(decodedToken.uid)) {
                isSeller = true;
            }
            else {
                // Fallback: Check if sellerIds contains Seller document IDs
                // and verify the authenticated user owns one of those seller records
                const sellerPromises = orderData.sellerIds.map((sellerId) => db.collection("Seller").doc(sellerId).get());
                const sellerDocs = await Promise.all(sellerPromises);
                isSeller = sellerDocs.some(doc => { var _a, _b; return doc.exists && (((_a = doc.data()) === null || _a === void 0 ? void 0 : _a.userId) === decodedToken.uid || ((_b = doc.data()) === null || _b === void 0 ? void 0 : _b.email) === decodedToken.email); });
            }
        }
        if (!isOrderOwner && !isAdmin && !isSeller) {
            logger.warn("Unauthorized shipping request", {
                orderId: payload.orderId,
                authenticatedUser: decodedToken.uid,
                orderOwner: orderData.userId,
                sellerIds: orderData.sellerIds
            });
            res.status(403).json({
                error: "Access denied",
                message: "You are not authorized to create shipping for this order"
            });
            return;
        }
        // Prevent duplicate shipping requests
        if ((_c = (_b = orderData.shippingInfo) === null || _b === void 0 ? void 0 : _b.jrs) === null || _c === void 0 ? void 0 : _c.trackingId) {
            logger.warn("Duplicate shipping request attempted", {
                orderId: payload.orderId,
                existingTrackingId: orderData.shippingInfo.jrs.trackingId,
                authenticatedUser: decodedToken.uid
            });
            res.status(409).json({
                error: "Order already shipped",
                message: `This order has already been shipped with tracking ID: ${orderData.shippingInfo.jrs.trackingId}`,
                existingTrackingId: orderData.shippingInfo.jrs.trackingId
            });
            return;
        }
        // Validate order status - only allow shipping for confirmed/paid orders
        const allowedStatuses = ['confirmed', 'paid', 'processing', 'ready_to_ship', 'to_ship'];
        const orderStatus = String(orderData.status || '').toLowerCase().trim();
        const isValidStatus = orderStatus && allowedStatuses.some(status => status.toLowerCase() === orderStatus);
        if (!isValidStatus) {
            logger.warn("Invalid order status for shipping", {
                orderId: payload.orderId,
                currentStatus: orderData.status,
                currentStatusType: typeof orderData.status,
                normalizedStatus: orderStatus,
                allowedStatuses: allowedStatuses
            });
            res.status(400).json({
                error: "Invalid order status",
                message: `Cannot create shipping for order with status: "${orderData.status}" (normalized: "${orderStatus}"). Allowed statuses: ${allowedStatuses.join(', ')}`,
                currentStatus: orderData.status,
                currentStatusType: typeof orderData.status,
                normalizedStatus: orderStatus,
                allowedStatuses: allowedStatuses
            });
            return;
        }
        // Fetch user (recipient) data
        let userData = null;
        if (orderData.userId) {
            userData = await fetchUserData(orderData.userId);
        }
        // Fetch seller (shipper) data - use first seller from sellerIds
        let sellerData = null;
        if (orderData.sellerIds && orderData.sellerIds.length > 0) {
            sellerData = await fetchSellerData(orderData.sellerIds[0]);
        }
        // Generate shipping reference number
        const shippingReferenceNo = `DPAL-${payload.orderId}`;
        // Parse recipient address
        const recipientAddress = parseAddress(orderData.shippingInfo || {});
        // Prepare recipient info (buyer/user)
        const recipientInfo = {
            email: ((_d = payload.recipientInfo) === null || _d === void 0 ? void 0 : _d.email) || (userData === null || userData === void 0 ? void 0 : userData.email) || ((_e = orderData.shippingInfo) === null || _e === void 0 ? void 0 : _e.email) || "customer@dentpal.ph",
            firstName: ((_f = payload.recipientInfo) === null || _f === void 0 ? void 0 : _f.firstName) || (userData === null || userData === void 0 ? void 0 : userData.firstName) ||
                ((_g = orderData.shippingInfo) === null || _g === void 0 ? void 0 : _g.fullName) || "Customer",
            lastName: ((_h = payload.recipientInfo) === null || _h === void 0 ? void 0 : _h.lastName) || (userData === null || userData === void 0 ? void 0 : userData.lastName) || "N/A",
            middleName: ((_j = payload.recipientInfo) === null || _j === void 0 ? void 0 : _j.middleName) || (userData === null || userData === void 0 ? void 0 : userData.middleName) || "",
            country: ((_k = payload.recipientInfo) === null || _k === void 0 ? void 0 : _k.country) || recipientAddress.country,
            province: ((_l = payload.recipientInfo) === null || _l === void 0 ? void 0 : _l.province) || recipientAddress.state,
            municipality: ((_m = payload.recipientInfo) === null || _m === void 0 ? void 0 : _m.municipality) || recipientAddress.city,
            district: ((_o = payload.recipientInfo) === null || _o === void 0 ? void 0 : _o.district) || recipientAddress.district,
            addressLine1: ((_p = payload.recipientInfo) === null || _p === void 0 ? void 0 : _p.addressLine1) || recipientAddress.addressLine1,
            phone: ((_q = payload.recipientInfo) === null || _q === void 0 ? void 0 : _q.phone) || ((_r = orderData.shippingInfo) === null || _r === void 0 ? void 0 : _r.phoneNumber) || (userData === null || userData === void 0 ? void 0 : userData.contactNumber),
        };
        // Prepare shipper info (seller)
        const defaultShipperAddress = {
            country: "Philippines",
            province: "Metro Manila",
            municipality: "Quezon City",
            district: "Barangay Kamuning",
            addressLine1: "123 DentPal Street",
            phone: "+639123456789",
        };
        let shipperAddress = defaultShipperAddress;
        if ((_t = (_s = sellerData === null || sellerData === void 0 ? void 0 : sellerData.vendor) === null || _s === void 0 ? void 0 : _s.company) === null || _t === void 0 ? void 0 : _t.address) {
            const sellerAddr = sellerData.vendor.company.address;
            shipperAddress = {
                country: "Philippines",
                province: sellerAddr.province || defaultShipperAddress.province,
                municipality: sellerAddr.city || defaultShipperAddress.municipality,
                district: sellerAddr.line2 || defaultShipperAddress.district,
                addressLine1: sellerAddr.line1 || defaultShipperAddress.addressLine1,
                phone: ((_u = sellerData.vendor.contacts) === null || _u === void 0 ? void 0 : _u.phone) || defaultShipperAddress.phone,
            };
        }
        const shipperInfo = {
            email: ((_v = payload.shipperInfo) === null || _v === void 0 ? void 0 : _v.email) || (sellerData === null || sellerData === void 0 ? void 0 : sellerData.email) || "support@dentpal.ph",
            firstName: ((_w = payload.shipperInfo) === null || _w === void 0 ? void 0 : _w.firstName) || ((_x = sellerData === null || sellerData === void 0 ? void 0 : sellerData.name) === null || _x === void 0 ? void 0 : _x.split(' ')[0]) || ((_z = (_y = sellerData === null || sellerData === void 0 ? void 0 : sellerData.vendor) === null || _y === void 0 ? void 0 : _y.company) === null || _z === void 0 ? void 0 : _z.storeName) || "DentPal",
            lastName: ((_0 = payload.shipperInfo) === null || _0 === void 0 ? void 0 : _0.lastName) || ((_1 = sellerData === null || sellerData === void 0 ? void 0 : sellerData.name) === null || _1 === void 0 ? void 0 : _1.split(' ').slice(1).join(' ')) || "Support",
            middleName: ((_2 = payload.shipperInfo) === null || _2 === void 0 ? void 0 : _2.middleName) || "",
            country: ((_3 = payload.shipperInfo) === null || _3 === void 0 ? void 0 : _3.country) || shipperAddress.country,
            province: ((_4 = payload.shipperInfo) === null || _4 === void 0 ? void 0 : _4.province) || shipperAddress.province,
            municipality: ((_5 = payload.shipperInfo) === null || _5 === void 0 ? void 0 : _5.municipality) || shipperAddress.municipality,
            district: ((_6 = payload.shipperInfo) === null || _6 === void 0 ? void 0 : _6.district) || shipperAddress.district,
            addressLine1: ((_7 = payload.shipperInfo) === null || _7 === void 0 ? void 0 : _7.addressLine1) || shipperAddress.addressLine1,
            phone: ((_8 = payload.shipperInfo) === null || _8 === void 0 ? void 0 : _8.phone) || shipperAddress.phone,
        };
        // Calculate shipment items from order
        const shipmentItems = payload.shipmentItems || calculateShipmentItems(orderData.items || []);
        // Generate shipment description
        const shipmentDescription = payload.shipmentDescription || generateShipmentDescription(orderData.items || []);
        // COD amount - use order total if cash on delivery
        // Check multiple possible locations for COD payment method
        const isCODOrder = ((_9 = orderData.paymentInfo) === null || _9 === void 0 ? void 0 : _9.method) === 'cod' ||
            ((_10 = orderData.paymongo) === null || _10 === void 0 ? void 0 : _10.paymentMethod) === 'cash_on_delivery' ||
            ((_11 = orderData.metadata) === null || _11 === void 0 ? void 0 : _11.paymentMethod) === 'cash_on_delivery';
        const codAmount = payload.codAmountToCollect ||
            (isCODOrder ? ((_12 = orderData.summary) === null || _12 === void 0 ? void 0 : _12.total) || 0 : 0);
        // Check if order has fragile items
        const hasFragileItems = ((_13 = orderData.metadata) === null || _13 === void 0 ? void 0 : _13.hasFragileItems) === true ||
            ((_14 = orderData.items) === null || _14 === void 0 ? void 0 : _14.some((item) => item.isFragile === true));
        // Build remarks with FRAGILE prefix if needed
        let remarks = payload.remarks || ((_15 = orderData.shippingInfo) === null || _15 === void 0 ? void 0 : _15.notes) || "";
        if (hasFragileItems && !remarks.toUpperCase().startsWith("FRAGILE")) {
            remarks = remarks ? `FRAGILE - ${remarks}` : "FRAGILE - Handle with care";
        }
        // Build special instruction with fragile warning if needed
        let specialInstruction = payload.specialInstruction || "";
        if (hasFragileItems && !specialInstruction.toUpperCase().includes("FRAGILE")) {
            specialInstruction = specialInstruction
                ? `FRAGILE ITEMS - Handle with care. ${specialInstruction}`
                : "FRAGILE ITEMS - Handle with care";
        }
        // Prepare JRS API request
        // Determine the best JRS packaging type based on item dimensions and weight
        const resolvedProductName = determineProductName(shipmentItems);
        logger.info(`📦 JRS packaging for order ${payload.orderId}: ${resolvedProductName !== null && resolvedProductName !== void 0 ? resolvedProductName : "auto (API determines)"}`, {
            itemCount: shipmentItems.length,
        });
        const jrsRequest = {
            requestType: "shipfromecom",
            apiShippingRequest: {
                express: true,
                insurance: true,
                valuation: true,
                ...(resolvedProductName ? { productName: resolvedProductName } : {}),
                createdByUserEmail: payload.createdByUserEmail || (sellerData === null || sellerData === void 0 ? void 0 : sellerData.email) || "admin@dentpal.ph",
                shipmentItems: shipmentItems,
                recipientEmail: recipientInfo.email,
                recipientFirstName: recipientInfo.firstName,
                recipientLastName: recipientInfo.lastName,
                recipientMiddleName: recipientInfo.middleName,
                recipientCountry: recipientInfo.country,
                recipientProvince: recipientInfo.province,
                recipientMunicipality: recipientInfo.municipality,
                recipientDistrict: recipientInfo.district,
                recipientAddressLine1: recipientInfo.addressLine1,
                recipientPhone: recipientInfo.phone,
                shipperEmail: shipperInfo.email,
                shipperFirstName: shipperInfo.firstName,
                shipperLastName: shipperInfo.lastName,
                shipperMiddleName: shipperInfo.middleName,
                shipperCountry: shipperInfo.country,
                shipperProvince: shipperInfo.province,
                shipperMunicipality: shipperInfo.municipality,
                shipperDistrict: shipperInfo.district,
                shipperAddressLine1: shipperInfo.addressLine1,
                shipperPhone: shipperInfo.phone,
                requestedPickupSchedule: payload.requestedPickupSchedule || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                shipmentDescription: shipmentDescription,
                remarks: remarks,
                specialInstruction: specialInstruction,
                codAmountToCollect: codAmount,
                shippingReferenceNo: shippingReferenceNo,
            },
        };
        logger.info("Making JRS API request", {
            orderId: payload.orderId,
            shippingReferenceNo,
            itemCount: shipmentItems.length,
            isCODOrder: isCODOrder,
            codAmount: codAmount,
            hasPickupSchedule: !!payload.requestedPickupSchedule,
            hasFragileItems: hasFragileItems,
            remarks: remarks,
            paymentMethod: ((_16 = orderData.paymongo) === null || _16 === void 0 ? void 0 : _16.paymentMethod) || ((_17 = orderData.paymentInfo) === null || _17 === void 0 ? void 0 : _17.method) || 'unknown',
        });
        // Make API call to JRS
        let response;
        let responseData;
        try {
            response = await axios_1.default.post(JRS_API_URL.value(), jrsRequest, {
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache",
                    "Ocp-Apim-Subscription-Key": JRS_API_KEY.value(),
                },
            });
            responseData = response.data;
        }
        catch (axiosError) {
            logger.error("JRS API error", {
                status: (_18 = axiosError.response) === null || _18 === void 0 ? void 0 : _18.status,
                statusText: (_19 = axiosError.response) === null || _19 === void 0 ? void 0 : _19.statusText,
                orderId: payload.orderId,
                shippingReferenceNo,
                errorCode: ((_21 = (_20 = axiosError.response) === null || _20 === void 0 ? void 0 : _20.data) === null || _21 === void 0 ? void 0 : _21.ErrorCode) || axiosError.code,
                errorMessage: ((_23 = (_22 = axiosError.response) === null || _22 === void 0 ? void 0 : _22.data) === null || _23 === void 0 ? void 0 : _23.ErrorMessage) || "Network error",
            });
            res.status(400).json({
                error: "JRS API request failed",
                details: ((_24 = axiosError.response) === null || _24 === void 0 ? void 0 : _24.data) || axiosError.message,
                shippingReferenceNo,
            });
            return;
        }
        // Axios throws errors for non-2xx status codes, so if we reach here, the request was successful
        // But we can still check for JRS-specific error indicators in the response
        if (!responseData.Success && responseData.Success !== undefined) {
            logger.error("JRS API business logic error", {
                orderId: payload.orderId,
                shippingReferenceNo,
                success: responseData.Success,
                errorMessage: responseData.ErrorMessage,
                errorCode: responseData.ErrorCode,
            });
            res.status(400).json({
                error: "JRS API request failed",
                details: responseData,
                shippingReferenceNo,
            });
            return;
        }
        // Extract and validate shipping charge allocation from order summary
        const orderSummary = orderData.summary || {};
        const sellerShippingCharge = Math.max(0, orderSummary.sellerShippingCharge || 0);
        const buyerShippingCharge = Math.max(0, orderSummary.buyerShippingCharge || 0);
        const totalShippingCost = Math.max(0, orderSummary.shippingCost || 0);
        // Validate shipping charge allocation
        const calculatedTotal = sellerShippingCharge + buyerShippingCharge;
        if (totalShippingCost > 0 && Math.abs(calculatedTotal - totalShippingCost) > 0.01) {
            logger.warn("Shipping charge allocation mismatch", {
                orderId: payload.orderId,
                totalShippingCost,
                sellerShippingCharge,
                buyerShippingCharge,
                calculatedTotal,
                difference: Math.abs(calculatedTotal - totalShippingCost),
            });
        }
        logger.info("JRS API success with shipping charges", {
            orderId: payload.orderId,
            shippingReferenceNo,
            trackingId: (_25 = responseData.ShippingRequestEntityDto) === null || _25 === void 0 ? void 0 : _25.TrackingId,
            totalShippingAmount: (_26 = responseData.ShippingRequestEntityDto) === null || _26 === void 0 ? void 0 : _26.TotalShippingAmount,
            sellerShippingCharge,
            buyerShippingCharge,
            totalShippingCost,
            isCODOrder: isCODOrder,
            codAmount: codAmount,
        });
        // Update order in Firestore with JRS response and handle seller shipping charges
        try {
            const orderRef = db.collection(orderResult.collection).doc(payload.orderId);
            // Create seller payout adjustment if seller has shipping charges
            let payoutAdjustmentId = null;
            if (sellerShippingCharge > 0 && orderData.sellerIds && orderData.sellerIds.length > 0) {
                try {
                    payoutAdjustmentId = await createSellerPayoutAdjustment({
                        orderId: payload.orderId,
                        sellerId: orderData.sellerIds[0],
                        shippingCharge: sellerShippingCharge,
                        shippingReferenceNo,
                        trackingId: (_27 = responseData.ShippingRequestEntityDto) === null || _27 === void 0 ? void 0 : _27.TrackingId,
                    });
                    logger.info("Successfully created seller payout adjustment", {
                        orderId: payload.orderId,
                        sellerId: orderData.sellerIds[0],
                        adjustmentId: payoutAdjustmentId,
                        shippingCharge: sellerShippingCharge,
                    });
                }
                catch (adjustmentError) {
                    logger.error("Failed to create seller payout adjustment, but continuing with shipping", {
                        orderId: payload.orderId,
                        sellerId: orderData.sellerIds[0],
                        shippingCharge: sellerShippingCharge,
                        error: adjustmentError instanceof Error ? adjustmentError.message : 'Unknown error',
                    });
                    // Don't fail the entire shipping process if payout adjustment fails
                }
            }
            // Build comprehensive shipping note
            let shippingNote = `Order shipped via JRS Express.`;
            if (isCODOrder && codAmount > 0) {
                shippingNote += `. COD Amount: ₱${codAmount.toFixed(2)}`;
            }
            const newHistoryEntry = {
                status: "to-hand-over",
                note: shippingNote,
                timestamp: new Date(),
            };
            const updateData = {
                shippingInfo: {
                    ...(orderData.shippingInfo || {}),
                    jrs: {
                        response: responseData,
                        shippingReferenceNo: shippingReferenceNo,
                        trackingId: (_28 = responseData.ShippingRequestEntityDto) === null || _28 === void 0 ? void 0 : _28.TrackingId,
                        requestedAt: new Date(),
                        totalShippingAmount: (_29 = responseData.ShippingRequestEntityDto) === null || _29 === void 0 ? void 0 : _29.TotalShippingAmount,
                        pickupSchedule: jrsRequest.apiShippingRequest.requestedPickupSchedule,
                        // Include COD information
                        cashOnDelivery: {
                            isCOD: isCODOrder,
                            codAmount: codAmount,
                            paymentMethod: ((_30 = orderData.paymongo) === null || _30 === void 0 ? void 0 : _30.paymentMethod) || ((_31 = orderData.paymentInfo) === null || _31 === void 0 ? void 0 : _31.method) || 'unknown',
                        },
                        // Include shipping charge allocation info
                        shippingCharges: {
                            sellerCharge: sellerShippingCharge,
                            buyerCharge: buyerShippingCharge,
                            totalCharge: totalShippingCost,
                            chargeApplied: sellerShippingCharge > 0,
                            chargeAppliedAt: sellerShippingCharge > 0 ? new Date() : null,
                            payoutAdjustmentId: payoutAdjustmentId,
                        }
                    }
                },
                fulfillmentStage: "to-hand-over",
                statusHistory: firestore_1.FieldValue.arrayUnion(newHistoryEntry),
                updatedAt: new Date(),
            };
            logger.info("Attempting to update order in Firestore", {
                orderId: payload.orderId,
                collection: orderResult.collection,
                updateData: JSON.stringify(updateData, null, 2)
            });
            await orderRef.update(updateData);
            logger.info("Order updated successfully in Firestore", {
                orderId: payload.orderId,
                collection: orderResult.collection,
                trackingId: (_32 = responseData.ShippingRequestEntityDto) === null || _32 === void 0 ? void 0 : _32.TrackingId,
            });
        }
        catch (firestoreError) {
            logger.error("Failed to update order in Firestore", {
                orderId: payload.orderId,
                collection: orderResult.collection,
                error: firestoreError,
                errorMessage: firestoreError instanceof Error ? firestoreError.message : 'Unknown error',
                errorStack: firestoreError instanceof Error ? firestoreError.stack : undefined
            });
            // Fail the request if Firestore update fails
            res.status(500).json({
                error: "Order shipping succeeded but failed to update order status",
                message: "JRS shipping request was successful, but we couldn't update the order in our database. Please contact support.",
                shippingReferenceNo,
                trackingId: (_33 = responseData.ShippingRequestEntityDto) === null || _33 === void 0 ? void 0 : _33.TrackingId,
                firestoreError: firestoreError instanceof Error ? firestoreError.message : 'Unknown error'
            });
            return;
        }
        // Return success response with shipping charge details
        res.status(200).json({
            success: true,
            shippingReferenceNo,
            trackingId: (_34 = responseData.ShippingRequestEntityDto) === null || _34 === void 0 ? void 0 : _34.TrackingId,
            totalShippingAmount: (_35 = responseData.ShippingRequestEntityDto) === null || _35 === void 0 ? void 0 : _35.TotalShippingAmount,
            shippingCharges: {
                sellerCharge: sellerShippingCharge,
                buyerCharge: buyerShippingCharge,
                totalCharge: totalShippingCost,
                sellerChargeApplied: sellerShippingCharge > 0,
            },
            cashOnDelivery: {
                isCOD: isCODOrder,
                codAmount: codAmount,
                paymentMethod: ((_36 = orderData.paymongo) === null || _36 === void 0 ? void 0 : _36.paymentMethod) || ((_37 = orderData.paymentInfo) === null || _37 === void 0 ? void 0 : _37.method) || 'unknown',
            },
            jrsResponse: responseData,
            message: isCODOrder
                ? `Shipping request created successfully. COD amount of ₱${codAmount.toFixed(2)} will be collected from recipient upon delivery.${sellerShippingCharge > 0 ? ` Seller shipping charge of ₱${sellerShippingCharge.toFixed(2)} will be deducted from payout.` : ''}`
                : sellerShippingCharge > 0
                    ? `Shipping request created successfully. Seller shipping charge of ₱${sellerShippingCharge.toFixed(2)} will be deducted from payout.`
                    : "Shipping request created successfully",
            orderData: {
                orderId: payload.orderId,
                recipient: `${recipientInfo.firstName} ${recipientInfo.lastName}`,
                shipper: `${shipperInfo.firstName} ${shipperInfo.lastName}`,
                items: ((_38 = orderData.items) === null || _38 === void 0 ? void 0 : _38.length) || 0,
            },
        });
    }
    catch (error) {
        logger.error("Error in createJRSShipping", {
            error: error instanceof Error ? error.message : "Unknown error",
            orderId: (_39 = req.body) === null || _39 === void 0 ? void 0 : _39.orderId,
            stack: error instanceof Error ? error.stack : undefined,
        });
        res.status(500).json({
            error: "Internal server error",
            message: error instanceof Error ? error.message : "Unknown error",
        });
    }
});
/**
 * Process a return request - approve or reject
 * If approved, creates a reverse JRS shipping (buyer → seller)
 * Only sellers/admins can process return requests
 */
exports.processReturnRequest = (0, https_1.onRequest)({
    cors: true,
    region: "asia-southeast1",
}, async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6;
    // Add explicit CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '86400');
    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    try {
        // Check for POST method
        if (req.method !== "POST") {
            res.status(405).json({ error: "Method not allowed" });
            return;
        }
        // Verify authentication token
        let decodedToken;
        try {
            decodedToken = await verifyAuthToken(req.headers.authorization);
            logger.info("Authenticated return request processing", {
                uid: decodedToken.uid,
                email: decodedToken.email
            });
        }
        catch (authError) {
            logger.warn("Unauthenticated return request attempt", {
                ip: req.ip,
                userAgent: req.headers["user-agent"]
            });
            res.status(401).json({
                error: "Authentication required",
                message: authError instanceof Error ? authError.message : "Invalid authentication"
            });
            return;
        }
        const payload = req.body;
        // Validate required fields
        if (!payload.returnRequestId || !payload.orderId || !payload.action) {
            res.status(400).json({
                error: "Missing required fields",
                message: "returnRequestId, orderId, and action are required"
            });
            return;
        }
        if (!['approve', 'reject'].includes(payload.action)) {
            res.status(400).json({
                error: "Invalid action",
                message: "action must be 'approve' or 'reject'"
            });
            return;
        }
        logger.info("Processing return request", {
            returnRequestId: payload.returnRequestId,
            orderId: payload.orderId,
            action: payload.action,
            authenticatedUser: decodedToken.uid
        });
        // Fetch the return request
        const returnRequestRef = db.collection("ReturnRequest").doc(payload.returnRequestId);
        const returnRequestDoc = await returnRequestRef.get();
        if (!returnRequestDoc.exists) {
            res.status(404).json({ error: "Return request not found" });
            return;
        }
        const returnRequestData = returnRequestDoc.data();
        // Verify the return request matches the order
        if (returnRequestData.orderId !== payload.orderId) {
            res.status(400).json({
                error: "Order mismatch",
                message: "The return request does not match the specified order"
            });
            return;
        }
        // Check if return request is in a valid state
        if (returnRequestData.status !== 'pending') {
            res.status(400).json({
                error: "Invalid return request status",
                message: `Return request has already been ${returnRequestData.status}`
            });
            return;
        }
        // Fetch the order
        const orderResult = await fetchOrderData(payload.orderId);
        if (!orderResult) {
            res.status(404).json({ error: "Order not found" });
            return;
        }
        const orderData = orderResult.data;
        if (!orderData) {
            res.status(404).json({ error: "Order data not found" });
            return;
        }
        // Authorization check - only sellers involved in the order or admins can process returns
        const isAdmin = decodedToken.role === 'admin' ||
            ((_a = decodedToken.customClaims) === null || _a === void 0 ? void 0 : _a.role) === 'admin';
        let isSeller = false;
        let sellerData = null;
        if (orderData.sellerIds && Array.isArray(orderData.sellerIds)) {
            if (orderData.sellerIds.includes(decodedToken.uid)) {
                isSeller = true;
                sellerData = await fetchSellerData(decodedToken.uid);
            }
            else {
                const sellerPromises = orderData.sellerIds.map((sellerId) => db.collection("Seller").doc(sellerId).get());
                const sellerDocs = await Promise.all(sellerPromises);
                for (const doc of sellerDocs) {
                    if (doc.exists && (((_b = doc.data()) === null || _b === void 0 ? void 0 : _b.userId) === decodedToken.uid || ((_c = doc.data()) === null || _c === void 0 ? void 0 : _c.email) === decodedToken.email)) {
                        isSeller = true;
                        sellerData = doc.data();
                        break;
                    }
                }
            }
        }
        if (!isAdmin && !isSeller) {
            logger.warn("Unauthorized return request processing", {
                returnRequestId: payload.returnRequestId,
                authenticatedUser: decodedToken.uid,
                sellerIds: orderData.sellerIds
            });
            res.status(403).json({
                error: "Access denied",
                message: "Only sellers or admins can process return requests"
            });
            return;
        }
        // If no seller data found yet, try to fetch the first seller
        if (!sellerData && ((_d = orderData.sellerIds) === null || _d === void 0 ? void 0 : _d.length) > 0) {
            sellerData = await fetchSellerData(orderData.sellerIds[0]);
        }
        const orderRef = db.collection(orderResult.collection).doc(payload.orderId);
        const now = new Date();
        // Handle REJECTION
        if (payload.action === 'reject') {
            if (!payload.rejectionReason) {
                res.status(400).json({
                    error: "Rejection reason required",
                    message: "Please provide a reason for rejecting the return request"
                });
                return;
            }
            // Update return request to rejected
            await returnRequestRef.update({
                status: 'rejected',
                rejectedAt: firestore_1.FieldValue.serverTimestamp(),
                rejectedBy: decodedToken.uid,
                rejectionReason: payload.rejectionReason,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
            // Update order status back to delivered (or return_rejected)
            const statusUpdate = {
                status: 'return_rejected',
                timestamp: firestore_1.FieldValue.serverTimestamp(),
                note: `Return request rejected: ${payload.rejectionReason}`,
                updatedBy: decodedToken.uid
            };
            await orderRef.update({
                status: 'return_rejected',
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
                statusHistory: firestore_1.FieldValue.arrayUnion(statusUpdate),
            });
            logger.info("Return request rejected", {
                returnRequestId: payload.returnRequestId,
                orderId: payload.orderId,
                rejectionReason: payload.rejectionReason,
                rejectedBy: decodedToken.uid
            });
            res.status(200).json({
                success: true,
                action: 'rejected',
                message: "Return request has been rejected",
                returnRequestId: payload.returnRequestId,
                orderId: payload.orderId,
            });
            return;
        }
        // Handle APPROVAL - Create reverse JRS shipping
        logger.info("Approving return request and creating reverse shipping", {
            returnRequestId: payload.returnRequestId,
            orderId: payload.orderId
        });
        // Generate return shipping reference number
        const returnShippingReferenceNo = `DPAL-RTN-${payload.orderId.substring(0, 8)}`;
        // Parse buyer address (shipper for return)
        const buyerAddress = parseAddress(orderData.shippingInfo || {});
        // Prepare shipper info (buyer - the one returning the item)
        const shipperInfo = {
            email: ((_e = orderData.shippingInfo) === null || _e === void 0 ? void 0 : _e.email) || "customer@dentpal.ph",
            firstName: ((_g = (_f = orderData.shippingInfo) === null || _f === void 0 ? void 0 : _f.fullName) === null || _g === void 0 ? void 0 : _g.split(' ')[0]) || "Customer",
            lastName: ((_j = (_h = orderData.shippingInfo) === null || _h === void 0 ? void 0 : _h.fullName) === null || _j === void 0 ? void 0 : _j.split(' ').slice(1).join(' ')) || "N/A",
            middleName: "",
            country: buyerAddress.country,
            province: buyerAddress.state,
            municipality: buyerAddress.city,
            district: buyerAddress.district,
            addressLine1: buyerAddress.addressLine1,
            phone: ((_k = orderData.shippingInfo) === null || _k === void 0 ? void 0 : _k.phoneNumber) || "+639000000000",
        };
        // Prepare recipient info (seller - receiving the returned item)
        const defaultSellerAddress = {
            country: "Philippines",
            province: "Metro Manila",
            municipality: "Quezon City",
            district: "Barangay Kamuning",
            addressLine1: "123 DentPal Street",
            phone: "+639123456789",
        };
        let sellerAddress = defaultSellerAddress;
        if ((_m = (_l = sellerData === null || sellerData === void 0 ? void 0 : sellerData.vendor) === null || _l === void 0 ? void 0 : _l.company) === null || _m === void 0 ? void 0 : _m.address) {
            const sellerAddr = sellerData.vendor.company.address;
            sellerAddress = {
                country: "Philippines",
                province: sellerAddr.province || defaultSellerAddress.province,
                municipality: sellerAddr.city || defaultSellerAddress.municipality,
                district: sellerAddr.line2 || defaultSellerAddress.district,
                addressLine1: sellerAddr.line1 || defaultSellerAddress.addressLine1,
                phone: ((_o = sellerData.vendor.contacts) === null || _o === void 0 ? void 0 : _o.phone) || defaultSellerAddress.phone,
            };
        }
        const recipientInfo = {
            email: (sellerData === null || sellerData === void 0 ? void 0 : sellerData.email) || "support@dentpal.ph",
            firstName: ((_p = sellerData === null || sellerData === void 0 ? void 0 : sellerData.name) === null || _p === void 0 ? void 0 : _p.split(' ')[0]) || ((_r = (_q = sellerData === null || sellerData === void 0 ? void 0 : sellerData.vendor) === null || _q === void 0 ? void 0 : _q.company) === null || _r === void 0 ? void 0 : _r.storeName) || "DentPal",
            lastName: ((_s = sellerData === null || sellerData === void 0 ? void 0 : sellerData.name) === null || _s === void 0 ? void 0 : _s.split(' ').slice(1).join(' ')) || "Support",
            middleName: "",
            country: sellerAddress.country,
            province: sellerAddress.province,
            municipality: sellerAddress.municipality,
            district: sellerAddress.district,
            addressLine1: sellerAddress.addressLine1,
            phone: sellerAddress.phone,
        };
        // Calculate shipment items for return
        const returnItems = returnRequestData.itemsToReturn
            ? (_t = orderData.items) === null || _t === void 0 ? void 0 : _t.filter((item) => returnRequestData.itemsToReturn.includes(item.productId))
            : orderData.items;
        const shipmentItems = calculateShipmentItems(returnItems || []);
        // Generate return shipment description
        const shipmentDescription = `RETURN: ${generateShipmentDescription(returnItems || [])}`.substring(0, 100);
        // Pickup schedule - default to next day if not provided
        const pickupSchedule = payload.requestedPickupSchedule ||
            new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        // Prepare JRS API request for REVERSE shipping (buyer → seller)
        const jrsReturnRequest = {
            requestType: "shipfromecom",
            apiShippingRequest: {
                express: true,
                insurance: true,
                valuation: true,
                createdByUserEmail: (sellerData === null || sellerData === void 0 ? void 0 : sellerData.email) || decodedToken.email || "admin@dentpal.ph",
                shipmentItems: shipmentItems,
                // REVERSED: Buyer is now the shipper
                shipperEmail: shipperInfo.email,
                shipperFirstName: shipperInfo.firstName,
                shipperLastName: shipperInfo.lastName,
                shipperMiddleName: shipperInfo.middleName,
                shipperCountry: shipperInfo.country,
                shipperProvince: shipperInfo.province,
                shipperMunicipality: shipperInfo.municipality,
                shipperDistrict: shipperInfo.district,
                shipperAddressLine1: shipperInfo.addressLine1,
                shipperPhone: shipperInfo.phone,
                // REVERSED: Seller is now the recipient
                recipientEmail: recipientInfo.email,
                recipientFirstName: recipientInfo.firstName,
                recipientLastName: recipientInfo.lastName,
                recipientMiddleName: recipientInfo.middleName,
                recipientCountry: recipientInfo.country,
                recipientProvince: recipientInfo.province,
                recipientMunicipality: recipientInfo.municipality,
                recipientDistrict: recipientInfo.district,
                recipientAddressLine1: recipientInfo.addressLine1,
                recipientPhone: recipientInfo.phone,
                requestedPickupSchedule: pickupSchedule,
                shipmentDescription: shipmentDescription,
                remarks: payload.remarks || `RETURN SHIPMENT - Order #${payload.orderId} - Reason: ${returnRequestData.reason}`,
                specialInstruction: "RETURN ITEM - Please handle with care",
                codAmountToCollect: 0,
                shippingReferenceNo: returnShippingReferenceNo,
            },
        };
        logger.info("Making JRS API request for return shipping", {
            orderId: payload.orderId,
            returnShippingReferenceNo,
            itemCount: shipmentItems.length,
            pickupSchedule,
            shipper: `${shipperInfo.firstName} ${shipperInfo.lastName}`,
            recipient: `${recipientInfo.firstName} ${recipientInfo.lastName}`,
        });
        // Make API call to JRS
        let jrsResponse;
        let jrsResponseData;
        try {
            jrsResponse = await axios_1.default.post(JRS_API_URL.value(), jrsReturnRequest, {
                headers: {
                    "Content-Type": "application/json",
                    "Ocp-Apim-Subscription-Key": JRS_API_KEY.value(),
                },
                timeout: 30000,
            });
            jrsResponseData = jrsResponse.data;
        }
        catch (axiosError) {
            logger.error("JRS API request failed for return", {
                orderId: payload.orderId,
                error: axiosError.message,
                response: (_u = axiosError.response) === null || _u === void 0 ? void 0 : _u.data,
                status: (_v = axiosError.response) === null || _v === void 0 ? void 0 : _v.status,
            });
            // Update return request with failure
            await returnRequestRef.update({
                status: 'shipping_failed',
                shippingError: ((_x = (_w = axiosError.response) === null || _w === void 0 ? void 0 : _w.data) === null || _x === void 0 ? void 0 : _x.ErrorMessage) || axiosError.message,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
            res.status(502).json({
                error: "JRS shipping request failed",
                message: ((_z = (_y = axiosError.response) === null || _y === void 0 ? void 0 : _y.data) === null || _z === void 0 ? void 0 : _z.ErrorMessage) || axiosError.message,
                jrsError: (_0 = axiosError.response) === null || _0 === void 0 ? void 0 : _0.data,
            });
            return;
        }
        // Check JRS response for success
        if (!jrsResponseData.Success && jrsResponseData.Success !== undefined) {
            logger.error("JRS API returned error for return shipping", {
                orderId: payload.orderId,
                jrsError: jrsResponseData.ErrorMessage,
                jrsResponse: jrsResponseData,
            });
            await returnRequestRef.update({
                status: 'shipping_failed',
                shippingError: jrsResponseData.ErrorMessage,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
            res.status(400).json({
                error: "JRS shipping request failed",
                message: jrsResponseData.ErrorMessage || "Unknown JRS error",
                jrsResponse: jrsResponseData,
            });
            return;
        }
        const returnTrackingId = (_1 = jrsResponseData.ShippingRequestEntityDto) === null || _1 === void 0 ? void 0 : _1.TrackingId;
        logger.info("JRS return shipping created successfully", {
            orderId: payload.orderId,
            returnShippingReferenceNo,
            returnTrackingId,
            totalShippingAmount: (_2 = jrsResponseData.ShippingRequestEntityDto) === null || _2 === void 0 ? void 0 : _2.TotalShippingAmount,
        });
        // Update return request with shipping info
        await returnRequestRef.update({
            status: 'approved',
            approvedAt: firestore_1.FieldValue.serverTimestamp(),
            approvedBy: decodedToken.uid,
            returnShipping: {
                referenceNo: returnShippingReferenceNo,
                trackingId: returnTrackingId,
                totalShippingAmount: (_3 = jrsResponseData.ShippingRequestEntityDto) === null || _3 === void 0 ? void 0 : _3.TotalShippingAmount,
                pickupSchedule: pickupSchedule,
                jrsResponse: jrsResponseData,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
            },
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        // Update order status to return_approved
        const statusUpdate = {
            status: 'return_approved',
            timestamp: firestore_1.FieldValue.serverTimestamp(),
            note: `Return approved. Pickup scheduled. Tracking: ${returnTrackingId}`,
            updatedBy: decodedToken.uid
        };
        await orderRef.update({
            status: 'return_approved',
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            statusHistory: firestore_1.FieldValue.arrayUnion(statusUpdate),
            returnShippingInfo: {
                referenceNo: returnShippingReferenceNo,
                trackingId: returnTrackingId,
                pickupSchedule: pickupSchedule,
                createdAt: now.toISOString(),
            },
        });
        res.status(200).json({
            success: true,
            action: 'approved',
            message: "Return request approved and pickup scheduled",
            returnRequestId: payload.returnRequestId,
            orderId: payload.orderId,
            returnShipping: {
                referenceNo: returnShippingReferenceNo,
                trackingId: returnTrackingId,
                totalShippingAmount: (_4 = jrsResponseData.ShippingRequestEntityDto) === null || _4 === void 0 ? void 0 : _4.TotalShippingAmount,
                pickupSchedule: pickupSchedule,
                pickup: {
                    from: `${shipperInfo.firstName} ${shipperInfo.lastName}`,
                    address: `${shipperInfo.addressLine1}, ${shipperInfo.district}, ${shipperInfo.municipality}, ${shipperInfo.province}`,
                },
                deliverTo: {
                    to: `${recipientInfo.firstName} ${recipientInfo.lastName}`,
                    address: `${recipientInfo.addressLine1}, ${recipientInfo.district}, ${recipientInfo.municipality}, ${recipientInfo.province}`,
                },
            },
            jrsResponse: jrsResponseData,
        });
    }
    catch (error) {
        logger.error("Error in processReturnRequest", {
            error: error instanceof Error ? error.message : "Unknown error",
            returnRequestId: (_5 = req.body) === null || _5 === void 0 ? void 0 : _5.returnRequestId,
            orderId: (_6 = req.body) === null || _6 === void 0 ? void 0 : _6.orderId,
            stack: error instanceof Error ? error.stack : undefined,
        });
        res.status(500).json({
            error: "Internal server error",
            message: error instanceof Error ? error.message : "Unknown error",
        });
    }
});
/**
 * Get return requests for a seller
 * Allows sellers to view pending return requests for their orders
 */
exports.getSellerReturnRequests = (0, https_1.onRequest)({
    cors: true,
    region: "asia-southeast1",
}, async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    try {
        // Verify authentication
        let decodedToken;
        try {
            decodedToken = await verifyAuthToken(req.headers.authorization);
        }
        catch (authError) {
            res.status(401).json({
                error: "Authentication required",
                message: authError instanceof Error ? authError.message : "Invalid authentication"
            });
            return;
        }
        const { sellerId, status } = req.query;
        let targetSellerId = sellerId;
        // If no sellerId provided, try to find seller record for authenticated user
        if (!targetSellerId) {
            const sellerQuery = await db.collection('Seller')
                .where('userId', '==', decodedToken.uid)
                .limit(1)
                .get();
            if (sellerQuery.empty) {
                // Try by email
                const sellerByEmail = await db.collection('Seller')
                    .where('email', '==', decodedToken.email)
                    .limit(1)
                    .get();
                if (sellerByEmail.empty) {
                    res.status(404).json({
                        error: "Seller not found",
                        message: "No seller account found for this user"
                    });
                    return;
                }
                targetSellerId = sellerByEmail.docs[0].id;
            }
            else {
                targetSellerId = sellerQuery.docs[0].id;
            }
        }
        // Verify authorization
        const sellerDoc = await db.collection('Seller').doc(targetSellerId).get();
        if (!sellerDoc.exists) {
            res.status(404).json({ error: "Seller not found" });
            return;
        }
        const sellerData = sellerDoc.data();
        const isSellerOwner = (sellerData === null || sellerData === void 0 ? void 0 : sellerData.userId) === decodedToken.uid || (sellerData === null || sellerData === void 0 ? void 0 : sellerData.email) === decodedToken.email;
        const isAdmin = decodedToken.role === 'admin' || ((_a = decodedToken.customClaims) === null || _a === void 0 ? void 0 : _a.role) === 'admin';
        if (!isSellerOwner && !isAdmin) {
            res.status(403).json({
                error: "Access denied",
                message: "You are not authorized to view these return requests"
            });
            return;
        }
        // Get orders for this seller
        const ordersQuery = await db.collection('Order')
            .where('sellerIds', 'array-contains', targetSellerId)
            .get();
        const orderIds = ordersQuery.docs.map(doc => doc.id);
        if (orderIds.length === 0) {
            res.status(200).json({
                success: true,
                sellerId: targetSellerId,
                returnRequests: [],
                count: 0,
            });
            return;
        }
        // Get return requests for these orders
        // Note: Firestore 'in' queries are limited to 30 values
        const returnRequests = [];
        const chunks = [];
        for (let i = 0; i < orderIds.length; i += 30) {
            chunks.push(orderIds.slice(i, i + 30));
        }
        for (const chunk of chunks) {
            let query = db.collection('ReturnRequest')
                .where('orderId', 'in', chunk);
            if (status) {
                query = query.where('status', '==', status);
            }
            const snapshot = await query.get();
            for (const doc of snapshot.docs) {
                const data = doc.data();
                returnRequests.push({
                    id: doc.id,
                    ...data,
                    requestedAt: ((_d = (_c = (_b = data.requestedAt) === null || _b === void 0 ? void 0 : _b.toDate) === null || _c === void 0 ? void 0 : _c.call(_b)) === null || _d === void 0 ? void 0 : _d.toISOString()) || data.requestedAt,
                    approvedAt: ((_g = (_f = (_e = data.approvedAt) === null || _e === void 0 ? void 0 : _e.toDate) === null || _f === void 0 ? void 0 : _f.call(_e)) === null || _g === void 0 ? void 0 : _g.toISOString()) || data.approvedAt,
                    rejectedAt: ((_k = (_j = (_h = data.rejectedAt) === null || _h === void 0 ? void 0 : _h.toDate) === null || _j === void 0 ? void 0 : _j.call(_h)) === null || _k === void 0 ? void 0 : _k.toISOString()) || data.rejectedAt,
                    deliveryDate: ((_o = (_m = (_l = data.deliveryDate) === null || _l === void 0 ? void 0 : _l.toDate) === null || _m === void 0 ? void 0 : _m.call(_l)) === null || _o === void 0 ? void 0 : _o.toISOString()) || data.deliveryDate,
                });
            }
        }
        // Sort by requestedAt descending
        returnRequests.sort((a, b) => {
            const dateA = new Date(a.requestedAt || 0);
            const dateB = new Date(b.requestedAt || 0);
            return dateB.getTime() - dateA.getTime();
        });
        res.status(200).json({
            success: true,
            sellerId: targetSellerId,
            returnRequests,
            count: returnRequests.length,
        });
    }
    catch (error) {
        logger.error("Error in getSellerReturnRequests", {
            error: error instanceof Error ? error.message : "Unknown error",
        });
        res.status(500).json({
            error: "Internal server error",
            message: error instanceof Error ? error.message : "Unknown error",
        });
    }
});
/**
 * Process a withdrawal by creating a PayMongo wallet transaction
 * Called by admin when approving a withdrawal request
 */
exports.processWithdrawal = (0, https_1.onRequest)({
    cors: true,
    region: "asia-southeast1",
    secrets: [PAYMONGO_SECRET_KEY],
}, async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
    // Only allow POST
    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    try {
        // Verify authentication
        const decodedToken = await verifyAuthToken(req.headers.authorization);
        const adminUid = decodedToken.uid;
        // Verify admin role
        await verifyAdminAccess(adminUid, "process withdrawal");
        const { withdrawalId } = req.body;
        if (!withdrawalId) {
            res.status(400).json({ error: "Missing withdrawalId" });
            return;
        }
        // Get the withdrawal request from Firestore
        const withdrawalRef = db.collection("Withdrawal").doc(withdrawalId);
        const withdrawalDoc = await withdrawalRef.get();
        if (!withdrawalDoc.exists) {
            res.status(404).json({ error: "Withdrawal request not found" });
            return;
        }
        const withdrawalData = withdrawalDoc.data();
        // Check if withdrawal is in a valid state for processing
        if (withdrawalData.status !== "approved") {
            res.status(400).json({
                error: "Invalid withdrawal status",
                message: `Withdrawal must be approved before processing. Current status: ${withdrawalData.status}`
            });
            return;
        }
        // Update status to processing
        await withdrawalRef.update({
            status: "processing",
            processedBy: adminUid,
            processedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        // Prepare PayMongo request
        const walletId = PAYMONGO_WALLET_ID.value();
        const apiUrl = PAYMONGO_API_URL.value();
        const secretKey = PAYMONGO_SECRET_KEY.value();
        // Amount in PayMongo is in centavos (smallest currency unit)
        const amountInCentavos = Math.round(withdrawalData.amount * 100);
        const paymongoRequest = {
            data: {
                attributes: {
                    amount: amountInCentavos,
                    currency: "PHP",
                    description: withdrawalData.description || `Withdrawal payout - ${withdrawalData.referenceNumber}`,
                    receiver: {
                        bank_account_name: withdrawalData.receiver.bankAccountName,
                        bank_account_number: withdrawalData.receiver.bankAccountNumber,
                        bank_code: withdrawalData.receiver.bankCode,
                        bank_id: withdrawalData.receiver.bankId || undefined,
                        bank_name: withdrawalData.receiver.bankName,
                    },
                    reference_number: withdrawalData.referenceNumber,
                },
            },
        };
        logger.info("Creating PayMongo wallet transaction", {
            withdrawalId,
            amount: withdrawalData.amount,
            amountInCentavos,
            receiver: withdrawalData.receiver.bankAccountName,
            referenceNumber: withdrawalData.referenceNumber,
        });
        // Make PayMongo API request
        const paymongoResponse = await axios_1.default.post(`${apiUrl}/wallets/${walletId}/transactions`, paymongoRequest, {
            headers: {
                "Authorization": `Basic ${Buffer.from(secretKey + ":").toString("base64")}`,
                "Content-Type": "application/json",
            },
        });
        const transactionData = paymongoResponse.data.data;
        logger.info("PayMongo wallet transaction created", {
            withdrawalId,
            transactionId: transactionData.id,
            status: transactionData.attributes.status,
        });
        // Update withdrawal with PayMongo response
        await withdrawalRef.update({
            paymongoTransactionId: transactionData.id,
            paymongoTransferId: transactionData.attributes.transfer_id,
            paymongoStatus: transactionData.attributes.status,
            paymongoProvider: transactionData.attributes.provider,
            paymongoNetAmount: transactionData.attributes.net_amount / 100,
            paymongoBatchId: transactionData.attributes.batch_transaction_id,
            paymongoCreatedAt: transactionData.attributes.created_at,
            updatedAt: new Date().toISOString(),
            // If PayMongo immediately completes, update status
            ...(transactionData.attributes.status === "completed" && {
                status: "completed",
                completedAt: new Date().toISOString(),
            }),
        });
        res.status(200).json({
            success: true,
            message: "Withdrawal transaction initiated successfully",
            withdrawalId,
            transaction: {
                id: transactionData.id,
                status: transactionData.attributes.status,
                provider: transactionData.attributes.provider,
                amount: transactionData.attributes.amount / 100,
                netAmount: transactionData.attributes.net_amount / 100,
                referenceNumber: transactionData.attributes.reference_number,
            },
        });
    }
    catch (error) {
        // Handle admin access errors with 403
        if (error instanceof AdminAccessError) {
            res.status(403).json({ error: error.message });
            return;
        }
        logger.error("Error processing withdrawal", {
            error: error.message,
            response: (_a = error.response) === null || _a === void 0 ? void 0 : _a.data,
            stack: error.stack,
        });
        // If PayMongo returned an error, update the withdrawal status
        if ((_b = error.response) === null || _b === void 0 ? void 0 : _b.data) {
            const withdrawalId = (_c = req.body) === null || _c === void 0 ? void 0 : _c.withdrawalId;
            if (withdrawalId) {
                try {
                    await db.collection("Withdrawal").doc(withdrawalId).update({
                        status: "failed",
                        providerError: ((_e = (_d = error.response.data.errors) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.detail) || error.message,
                        providerErrorCode: ((_g = (_f = error.response.data.errors) === null || _f === void 0 ? void 0 : _f[0]) === null || _g === void 0 ? void 0 : _g.code) || "unknown",
                        updatedAt: new Date().toISOString(),
                    });
                }
                catch (updateError) {
                    logger.error("Failed to update withdrawal status after error", { updateError });
                }
            }
        }
        res.status(((_h = error.response) === null || _h === void 0 ? void 0 : _h.status) || 500).json({
            error: "Failed to process withdrawal",
            message: ((_m = (_l = (_k = (_j = error.response) === null || _j === void 0 ? void 0 : _j.data) === null || _k === void 0 ? void 0 : _k.errors) === null || _l === void 0 ? void 0 : _l[0]) === null || _m === void 0 ? void 0 : _m.detail) || error.message,
            code: (_r = (_q = (_p = (_o = error.response) === null || _o === void 0 ? void 0 : _o.data) === null || _p === void 0 ? void 0 : _p.errors) === null || _q === void 0 ? void 0 : _q[0]) === null || _r === void 0 ? void 0 : _r.code,
        });
    }
});
/**
 * Check the status of a withdrawal transaction from PayMongo
 */
exports.checkWithdrawalStatus = (0, https_1.onRequest)({
    cors: true,
    region: "asia-southeast1",
    secrets: [PAYMONGO_SECRET_KEY],
}, async (req, res) => {
    var _a, _b, _c, _d, _e, _f;
    // Allow GET or POST
    if (req.method !== "GET" && req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    try {
        // Verify authentication
        const decodedToken = await verifyAuthToken(req.headers.authorization);
        const adminUid = decodedToken.uid;
        // Verify admin role
        await verifyAdminAccess(adminUid, "check withdrawal status");
        const withdrawalId = req.method === "GET" ? req.query.withdrawalId : req.body.withdrawalId;
        if (!withdrawalId) {
            res.status(400).json({ error: "Missing withdrawalId" });
            return;
        }
        // Get the withdrawal request from Firestore
        const withdrawalRef = db.collection("Withdrawal").doc(withdrawalId);
        const withdrawalDoc = await withdrawalRef.get();
        if (!withdrawalDoc.exists) {
            res.status(404).json({ error: "Withdrawal request not found" });
            return;
        }
        const withdrawalData = withdrawalDoc.data();
        if (!withdrawalData.paymongoTransactionId) {
            res.status(400).json({
                error: "No PayMongo transaction found",
                message: "This withdrawal has not been processed yet"
            });
            return;
        }
        // Fetch transaction status from PayMongo
        const walletId = PAYMONGO_WALLET_ID.value();
        const apiUrl = PAYMONGO_API_URL.value();
        const secretKey = PAYMONGO_SECRET_KEY.value();
        const paymongoResponse = await axios_1.default.get(`${apiUrl}/wallets/${walletId}/transactions/${withdrawalData.paymongoTransactionId}`, {
            headers: {
                "Authorization": `Basic ${Buffer.from(secretKey + ":").toString("base64")}`,
            },
        });
        const transactionData = paymongoResponse.data.data;
        logger.info("PayMongo transaction status retrieved", {
            withdrawalId,
            transactionId: transactionData.id,
            status: transactionData.attributes.status,
        });
        // Update withdrawal status if changed
        const updateData = {
            paymongoStatus: transactionData.attributes.status,
            updatedAt: new Date().toISOString(),
        };
        if (transactionData.attributes.status === "completed" && withdrawalData.status !== "completed") {
            updateData.status = "completed";
            updateData.completedAt = new Date().toISOString();
        }
        else if (transactionData.attributes.status === "failed" && withdrawalData.status !== "failed") {
            updateData.status = "failed";
            updateData.providerError = transactionData.attributes.provider_error;
            updateData.providerErrorCode = transactionData.attributes.provider_error_code;
        }
        await withdrawalRef.update(updateData);
        res.status(200).json({
            success: true,
            withdrawalId,
            withdrawalStatus: updateData.status || withdrawalData.status,
            transaction: {
                id: transactionData.id,
                status: transactionData.attributes.status,
                provider: transactionData.attributes.provider,
                providerError: transactionData.attributes.provider_error,
                amount: transactionData.attributes.amount / 100,
                netAmount: transactionData.attributes.net_amount / 100,
                referenceNumber: transactionData.attributes.reference_number,
                createdAt: transactionData.attributes.created_at,
                updatedAt: transactionData.attributes.updated_at,
            },
        });
    }
    catch (error) {
        // Handle admin access errors with 403
        if (error instanceof AdminAccessError) {
            res.status(403).json({ error: error.message });
            return;
        }
        logger.error("Error checking withdrawal status", {
            error: error.message,
            response: (_a = error.response) === null || _a === void 0 ? void 0 : _a.data,
        });
        res.status(((_b = error.response) === null || _b === void 0 ? void 0 : _b.status) || 500).json({
            error: "Failed to check withdrawal status",
            message: ((_f = (_e = (_d = (_c = error.response) === null || _c === void 0 ? void 0 : _c.data) === null || _d === void 0 ? void 0 : _d.errors) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.detail) || error.message,
        });
    }
});
/**
 * Get all wallet transactions from PayMongo (admin only)
 */
exports.getWalletTransactions = (0, https_1.onRequest)({
    cors: true,
    region: "asia-southeast1",
    secrets: [PAYMONGO_SECRET_KEY],
}, async (req, res) => {
    var _a, _b, _c, _d, _e, _f;
    if (req.method !== "GET") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    try {
        // Verify authentication
        const decodedToken = await verifyAuthToken(req.headers.authorization);
        const adminUid = decodedToken.uid;
        // Verify admin role
        await verifyAdminAccess(adminUid, "get wallet transactions");
        const limit = parseInt(req.query.limit) || 10;
        const startingAfter = req.query.starting_after;
        const walletId = PAYMONGO_WALLET_ID.value();
        const apiUrl = PAYMONGO_API_URL.value();
        const secretKey = PAYMONGO_SECRET_KEY.value();
        let url = `${apiUrl}/wallets/${walletId}/transactions?limit=${limit}`;
        if (startingAfter) {
            url += `&starting_after=${startingAfter}`;
        }
        const paymongoResponse = await axios_1.default.get(url, {
            headers: {
                "Authorization": `Basic ${Buffer.from(secretKey + ":").toString("base64")}`,
            },
        });
        res.status(200).json({
            success: true,
            data: paymongoResponse.data.data,
            hasMore: paymongoResponse.data.has_more,
        });
    }
    catch (error) {
        // Handle admin access errors with 403
        if (error instanceof AdminAccessError) {
            res.status(403).json({ error: error.message });
            return;
        }
        logger.error("Error fetching wallet transactions", {
            error: error.message,
            response: (_a = error.response) === null || _a === void 0 ? void 0 : _a.data,
        });
        res.status(((_b = error.response) === null || _b === void 0 ? void 0 : _b.status) || 500).json({
            error: "Failed to fetch wallet transactions",
            message: ((_f = (_e = (_d = (_c = error.response) === null || _c === void 0 ? void 0 : _c.data) === null || _d === void 0 ? void 0 : _d.errors) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.detail) || error.message,
        });
    }
});
/**
 * Get a specific wallet transaction from PayMongo
 * Proxies the read operation securely without exposing the secret key to the frontend
 * Admin-only access required
 */
exports.getPaymongoTransaction = (0, https_1.onRequest)({
    cors: true,
    region: "asia-southeast1",
    secrets: [PAYMONGO_SECRET_KEY],
}, async (req, res) => {
    var _a, _b, _c, _d, _e, _f;
    if (req.method !== "GET") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    try {
        // Verify authentication
        const decodedToken = await verifyAuthToken(req.headers.authorization);
        const adminUid = decodedToken.uid;
        // Verify admin role
        await verifyAdminAccess(adminUid, "access PayMongo transaction");
        const transactionId = req.query.transactionId;
        if (!transactionId) {
            res.status(400).json({ error: "Missing transactionId parameter" });
            return;
        }
        const walletId = PAYMONGO_WALLET_ID.value();
        const apiUrl = PAYMONGO_API_URL.value();
        const secretKey = PAYMONGO_SECRET_KEY.value();
        const response = await axios_1.default.get(`${apiUrl}/wallets/${walletId}/transactions/${transactionId}`, {
            headers: {
                "Authorization": `Basic ${Buffer.from(secretKey + ":").toString("base64")}`,
                "Accept": "application/json",
            },
        });
        res.status(200).json({ success: true, data: response.data });
    }
    catch (error) {
        // Handle admin access errors with 403
        if (error instanceof AdminAccessError) {
            res.status(403).json({ error: error.message });
            return;
        }
        logger.error("Error retrieving PayMongo transaction", {
            error: error.message,
            response: (_a = error.response) === null || _a === void 0 ? void 0 : _a.data,
        });
        const errorMessage = ((_e = (_d = (_c = (_b = error.response) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.errors) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.detail) ||
            error.message ||
            "Failed to retrieve transaction";
        res.status(((_f = error.response) === null || _f === void 0 ? void 0 : _f.status) || 500).json({
            success: false,
            error: errorMessage
        });
    }
});
/**
 * List wallet transactions from PayMongo
 * Proxies the read operation securely without exposing the secret key to the frontend
 * Admin-only access required
 */
exports.listPaymongoTransactions = (0, https_1.onRequest)({
    cors: true,
    region: "asia-southeast1",
    secrets: [PAYMONGO_SECRET_KEY],
}, async (req, res) => {
    var _a, _b, _c, _d, _e, _f;
    if (req.method !== "GET") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    try {
        // Verify authentication
        const decodedToken = await verifyAuthToken(req.headers.authorization);
        const adminUid = decodedToken.uid;
        // Verify admin role
        await verifyAdminAccess(adminUid, "list PayMongo transactions");
        const limit = parseInt(req.query.limit) || 10;
        const walletId = PAYMONGO_WALLET_ID.value();
        const apiUrl = PAYMONGO_API_URL.value();
        const secretKey = PAYMONGO_SECRET_KEY.value();
        const response = await axios_1.default.get(`${apiUrl}/wallets/${walletId}/transactions?limit=${limit}`, {
            headers: {
                "Authorization": `Basic ${Buffer.from(secretKey + ":").toString("base64")}`,
                "Accept": "application/json",
            },
        });
        res.status(200).json({ success: true, data: response.data.data || [] });
    }
    catch (error) {
        // Handle admin access errors with 403
        if (error instanceof AdminAccessError) {
            res.status(403).json({ error: error.message });
            return;
        }
        logger.error("Error listing PayMongo transactions", {
            error: error.message,
            response: (_a = error.response) === null || _a === void 0 ? void 0 : _a.data,
        });
        const errorMessage = ((_e = (_d = (_c = (_b = error.response) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.errors) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.detail) ||
            error.message ||
            "Failed to list transactions";
        res.status(((_f = error.response) === null || _f === void 0 ? void 0 : _f.status) || 500).json({
            success: false,
            error: errorMessage
        });
    }
});
/**
 * Delete a user from Firebase Authentication
 * Admin-only access required OR seller deleting their own sub-account
 * This is called after deleting Firestore data to ensure complete user removal
 */
exports.deleteUserAccount = (0, https_1.onRequest)({
    cors: true,
    region: "asia-southeast1",
}, async (req, res) => {
    var _a;
    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    try {
        // Verify authentication
        let decodedToken;
        let requestorUid;
        try {
            decodedToken = await verifyAuthToken(req.headers.authorization);
            requestorUid = decodedToken.uid;
        }
        catch (authError) {
            res.status(401).json({
                error: "Authentication failed. Invalid or missing token."
            });
            return;
        }
        const { uid } = req.body;
        if (!uid || typeof uid !== "string") {
            res.status(400).json({ error: "Invalid user ID provided" });
            return;
        }
        // Prevent user from deleting themselves
        if (uid === requestorUid) {
            res.status(400).json({ error: "Cannot delete your own account" });
            return;
        }
        // Get the requestor's role
        const requestorDoc = await db.collection("Seller").doc(requestorUid).get();
        const requestorRole = requestorDoc.exists ? (_a = requestorDoc.data()) === null || _a === void 0 ? void 0 : _a.role : null;
        // Check if requestor is admin OR if they're a seller deleting their own sub-account
        let hasPermission = false;
        if (requestorRole === "admin") {
            // Admin can delete any user
            hasPermission = true;
        }
        else if (requestorRole === "seller") {
            // Seller can only delete their sub-accounts
            // Check if the user to be deleted is a sub-account of the requestor
            const userToDeleteDoc = await db.collection("Seller").doc(uid).get();
            if (userToDeleteDoc.exists) {
                const userData = userToDeleteDoc.data();
                if ((userData === null || userData === void 0 ? void 0 : userData.isSubAccount) && (userData === null || userData === void 0 ? void 0 : userData.parentId) === requestorUid) {
                    hasPermission = true;
                }
            }
        }
        if (!hasPermission) {
            logger.warn("Unauthorized deletion attempt", {
                requestorUid,
                requestorRole,
                targetUid: uid,
            });
            res.status(403).json({
                error: "Unauthorized. You can only delete your own sub-accounts."
            });
            return;
        }
        // Delete the user from Firebase Authentication
        await auth.deleteUser(uid);
        logger.info("User account deleted successfully", {
            deletedUid: uid,
            deletedBy: requestorUid,
            deletedByRole: requestorRole,
        });
        res.status(200).json({
            success: true,
            message: "User account deleted successfully"
        });
    }
    catch (error) {
        // Handle admin access errors with 403
        if (error instanceof AdminAccessError) {
            res.status(403).json({ error: error.message });
            return;
        }
        logger.error("Error deleting user account", {
            error: error.message,
            code: error.code,
        });
        const errorMessage = error.code === "auth/user-not-found"
            ? "User not found in authentication system"
            : error.message || "Failed to delete user account";
        res.status(error.code === "auth/user-not-found" ? 404 : 500).json({
            success: false,
            error: errorMessage
        });
    }
});
// ============================================
// User Account Status Management (Enable/Disable)
// ============================================
/**
 * Enable or disable a user account in Firebase Authentication
 * Admin-only access required
 * This is called when toggling user status between 'active' and 'inactive'
 */
exports.setUserAccountStatus = (0, https_1.onRequest)({
    cors: true,
    region: "asia-southeast1",
}, async (req, res) => {
    // Add explicit CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '86400');
    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    try {
        // Verify authentication
        let decodedToken;
        try {
            decodedToken = await verifyAuthToken(req.headers.authorization);
        }
        catch (authError) {
            res.status(401).json({
                error: "Authentication failed. Invalid or missing token."
            });
            return;
        }
        // Verify admin access
        try {
            await verifyAdminAccess(decodedToken.uid, "toggle user account status");
        }
        catch (adminError) {
            if (adminError instanceof AdminAccessError) {
                res.status(403).json({ error: adminError.message });
                return;
            }
            throw adminError;
        }
        const { uid, disabled } = req.body;
        if (!uid || typeof uid !== "string") {
            res.status(400).json({ error: "Invalid user ID provided" });
            return;
        }
        if (typeof disabled !== "boolean") {
            res.status(400).json({ error: "Invalid 'disabled' value. Must be a boolean." });
            return;
        }
        // Prevent admin from disabling themselves
        if (uid === decodedToken.uid && disabled) {
            res.status(400).json({ error: "Cannot disable your own account" });
            return;
        }
        // Update the user's disabled status in Firebase Authentication
        await auth.updateUser(uid, { disabled });
        logger.info("User account status updated successfully", {
            targetUid: uid,
            disabled,
            updatedBy: decodedToken.uid,
            action: disabled ? "disabled" : "enabled",
        });
        res.status(200).json({
            success: true,
            message: `User account ${disabled ? 'disabled' : 'enabled'} successfully`,
            uid,
            disabled,
        });
    }
    catch (error) {
        logger.error("Error updating user account status", {
            error: error.message,
            code: error.code,
        });
        let statusCode = 500;
        let errorMessage = error.message || "Failed to update user account status";
        if (error.code === "auth/user-not-found") {
            statusCode = 404;
            errorMessage = "User not found in authentication system";
        }
        else if (error.code === "auth/invalid-uid") {
            statusCode = 400;
            errorMessage = "Invalid user ID format";
        }
        res.status(statusCode).json({
            success: false,
            error: errorMessage
        });
    }
});
// ============================================
// Test JRS Shipping Function (QA API)
// ============================================
var testJRSShipping_1 = require("./testJRSShipping");
Object.defineProperty(exports, "testCreateJRSShipping", { enumerable: true, get: function () { return testJRSShipping_1.testCreateJRSShipping; } });
//# sourceMappingURL=index.js.map