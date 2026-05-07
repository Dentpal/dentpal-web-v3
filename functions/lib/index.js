"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.testCreateJRSShipping = exports.verifyUserEmail = exports.setUserAccountStatus = exports.deleteUserAccount = exports.listPaymongoTransactions = exports.getPaymongoTransaction = exports.getWalletTransactions = exports.checkWithdrawalStatus = exports.processWithdrawal = exports.getSellerReturnRequests = exports.processReturnRequest = exports.cancelJRSShipping = exports.createJRSShipping = exports.processSellerPayoutAdjustments = exports.getSellerPayoutAdjustments = void 0;
const https_1 = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
const params_1 = require("firebase-functions/params");
__exportStar(require("./testJRSShipping"), exports);
const axios_1 = require("axios");
// Initialize Firebase Admin
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)();
const auth = (0, auth_1.getAuth)();
// Define parameters for JRS API
const JRS_API_KEY = (0, params_1.defineSecret)("JRS_API_KEY");
const JRS_SHIPPING_API_URL = (0, params_1.defineSecret)("JRS_SHIPPING_API_URL");
const JRS_CANCEL_URL = (0, params_1.defineSecret)("JRS_CANCEL_URL");
// Define parameters for PayMongo API
const PAYMONGO_SECRET_KEY = (0, params_1.defineSecret)("PAYMONGO_SECRET_KEY");
const PAYMONGO_WALLET_ID = (0, params_1.defineSecret)("PAYMONGO_WALLET_ID");
const PAYMONGO_API_URL = (0, params_1.defineSecret)("PAYMONGO_API_URL");
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
const fetchCallerProfile = async (decodedToken) => {
    const snap = await db.collection("web_users").doc(decodedToken.uid).get();
    const data = (snap.exists ? snap.data() : null) || {};
    return {
        uid: decodedToken.uid,
        email: decodedToken.email || data.email,
        role: data.role,
        isSubAccount: data.isSubAccount === true,
        parentId: typeof data.parentId === "string" ? data.parentId : null,
    };
};
/**
 * Returns the seller UIDs the caller is authorized to act as.
 * Sub-accounts inherit their parent's seller identity.
 */
const getEffectiveSellerUids = (caller) => {
    if (caller.isSubAccount && caller.parentId) {
        return [caller.parentId];
    }
    return [caller.uid];
};
const isAdminCaller = (decodedToken, caller) => {
    var _a;
    return (decodedToken.role === "admin" ||
        ((_a = decodedToken.customClaims) === null || _a === void 0 ? void 0 : _a.role) === "admin" ||
        caller.role === "admin");
};
/**
 * Determines whether the caller is authorized as a seller on the given order.
 *
 * Accepts both the array shape (`sellerIds: string[]`) and the legacy
 * singular shape (`sellerId: string`). For each entry, attempts a direct
 * UID match against the caller's effective seller UIDs first, then falls
 * back to resolving the entry as a `Seller/{id}` document and matching its
 * `userId` / `email` fields (handles cases where `sellerIds` stores Seller
 * doc IDs rather than user UIDs).
 */
const isSellerOnOrder = async (orderData, caller) => {
    const rawIds = orderData === null || orderData === void 0 ? void 0 : orderData.sellerIds;
    const sellerIds = Array.isArray(rawIds)
        ? rawIds.map((v) => String(v))
        : (orderData === null || orderData === void 0 ? void 0 : orderData.sellerId)
            ? [String(orderData.sellerId)]
            : [];
    if (sellerIds.length === 0)
        return false;
    const effectiveUids = getEffectiveSellerUids(caller);
    if (sellerIds.some((id) => effectiveUids.includes(id)))
        return true;
    const sellerDocs = await Promise.all(sellerIds.map((id) => db.collection("Seller").doc(id).get()));
    for (const doc of sellerDocs) {
        if (!doc.exists)
            continue;
        const d = doc.data() || {};
        if (typeof d.userId === "string" && effectiveUids.includes(d.userId))
            return true;
        if (caller.email && d.email === caller.email)
            return true;
    }
    return false;
};
/**
 * True when the caller owns the seller record (directly or as a sub-account
 * of the seller's owning user). Used by single-seller endpoints that don't
 * pivot through an order.
 */
const isOwnerOfSeller = (sellerData, caller) => {
    if (!sellerData)
        return false;
    const effectiveUids = getEffectiveSellerUids(caller);
    if (typeof sellerData.userId === "string" && effectiveUids.includes(sellerData.userId))
        return true;
    if (caller.email && sellerData.email === caller.email)
        return true;
    return false;
};
const calculateShipmentItems = (orderItems) => {
    // Order items are stored with dimensions as top-level fields
    // (length/width/height/weight in cm/cm/cm/grams) by the checkout flow.
    // Legacy orders may nest them under `item.dimensions` with weight in kg.
    const items = [];
    for (const item of orderItems) {
        const quantity = typeof item.quantity === "number" && item.quantity > 0 ? item.quantity : 1;
        // Prefer top-level dimensions (current shape)
        let length = typeof item.length === "number" ? item.length : -1;
        let width = typeof item.width === "number" ? item.width : -1;
        let height = typeof item.height === "number" ? item.height : -1;
        let unitWeightGrams = typeof item.weight === "number" ? item.weight : -1;
        // Fallback to nested `dimensions` object (legacy shape, weight in kg)
        if ((length < 0 || width < 0 || height < 0 || unitWeightGrams < 0) && item.dimensions) {
            if (length < 0 && typeof item.dimensions.length === "number")
                length = item.dimensions.length;
            if (width < 0 && typeof item.dimensions.width === "number")
                width = item.dimensions.width;
            if (height < 0 && typeof item.dimensions.height === "number")
                height = item.dimensions.height;
            if (unitWeightGrams < 0 && typeof item.dimensions.weight === "number") {
                unitWeightGrams = item.dimensions.weight * 1000;
            }
        }
        if (length < 0 || width < 0 || height < 0 || unitWeightGrams < 0) {
            logger.warn("Order item missing dimensions, applying -1 for determineProductName auto-selection", {
                itemId: item.productId || item.id || "unknown",
                itemName: item.productName || item.name || "unknown",
            });
        }
        const unitDeclaredValue = item.price || 100;
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
    var _a, _b, _c, _d, _e, _f;
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
        const caller = await fetchCallerProfile(decodedToken);
        // If no sellerId provided, find seller record for authenticated user.
        // Sub-accounts resolve to their parent seller's record.
        if (!targetSellerId) {
            const effectiveUids = getEffectiveSellerUids(caller);
            let foundId = null;
            for (const uid of effectiveUids) {
                const sellerQuery = await db.collection('Seller')
                    .where('userId', '==', uid)
                    .limit(1)
                    .get();
                if (!sellerQuery.empty) {
                    foundId = sellerQuery.docs[0].id;
                    break;
                }
            }
            if (!foundId) {
                res.status(404).json({
                    error: "Seller not found",
                    message: "No seller record found for authenticated user"
                });
                return;
            }
            targetSellerId = foundId;
        }
        // Verify authorization - user must be the seller owner (or sub-account) or admin
        const sellerDoc = await db.collection('Seller').doc(targetSellerId).get();
        if (!sellerDoc.exists) {
            res.status(404).json({ error: "Seller not found" });
            return;
        }
        const sellerData = sellerDoc.data();
        const isSellerOwner = isOwnerOfSeller(sellerData, caller);
        const isAdmin = isAdminCaller(decodedToken, caller);
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
                lastUpdated: ((_c = (_b = (_a = sellerSummary.lastUpdated) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) === null || _c === void 0 ? void 0 : _c.toISOString()) || sellerSummary.lastUpdated,
                lastProcessed: ((_f = (_e = (_d = sellerSummary.lastProcessed) === null || _d === void 0 ? void 0 : _d.toDate) === null || _e === void 0 ? void 0 : _e.call(_d)) === null || _f === void 0 ? void 0 : _f.toISOString()) || sellerSummary.lastProcessed,
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
    try {
        // Verify authentication
        let decodedToken;
        try {
            decodedToken = await verifyAuthToken(req.headers.authorization);
            // Only allow admin users to process payouts
            const caller = await fetchCallerProfile(decodedToken);
            const isAdmin = isAdminCaller(decodedToken, caller);
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
    cors: [
        /^http:\/\/localhost(:\d+)?$/,
        "https://dentpal-161e5.web.app",
        "https://dentpal-site.web.app",
    ],
    region: "asia-southeast1",
    secrets: [JRS_API_KEY, JRS_SHIPPING_API_URL],
}, async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24, _25, _26, _27, _28, _29, _30, _31, _32, _33, _34, _35, _36, _37, _38, _39, _40, _41, _42, _43;
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
        // Authorization: order owner, an involved seller (or sub-account of one),
        // or an admin. Sub-accounts inherit their parent seller's authorization.
        const caller = await fetchCallerProfile(decodedToken);
        const isOrderOwner = orderData.userId === decodedToken.uid;
        const isAdmin = isAdminCaller(decodedToken, caller);
        const isSeller = await isSellerOnOrder(orderData, caller);
        if (!isOrderOwner && !isAdmin && !isSeller) {
            logger.warn("Unauthorized shipping request", {
                orderId: payload.orderId,
                authenticatedUser: decodedToken.uid,
                callerRole: caller.role,
                callerIsSubAccount: caller.isSubAccount,
                callerParentId: caller.parentId,
                orderOwner: orderData.userId,
                sellerIds: orderData.sellerIds,
                legacySellerId: orderData.sellerId,
            });
            res.status(403).json({
                error: "Access denied",
                message: "You are not authorized to create shipping for this order"
            });
            return;
        }
        // Prevent duplicate shipping requests
        if ((_b = (_a = orderData.shippingInfo) === null || _a === void 0 ? void 0 : _a.jrs) === null || _b === void 0 ? void 0 : _b.trackingId) {
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
            email: ((_c = payload.recipientInfo) === null || _c === void 0 ? void 0 : _c.email) || (userData === null || userData === void 0 ? void 0 : userData.email) || ((_d = orderData.shippingInfo) === null || _d === void 0 ? void 0 : _d.email) || "customer@dentpal.ph",
            firstName: ((_e = payload.recipientInfo) === null || _e === void 0 ? void 0 : _e.firstName) || (userData === null || userData === void 0 ? void 0 : userData.firstName) ||
                ((_f = orderData.shippingInfo) === null || _f === void 0 ? void 0 : _f.fullName) || "Customer",
            lastName: ((_g = payload.recipientInfo) === null || _g === void 0 ? void 0 : _g.lastName) || (userData === null || userData === void 0 ? void 0 : userData.lastName) || "N/A",
            middleName: ((_h = payload.recipientInfo) === null || _h === void 0 ? void 0 : _h.middleName) || (userData === null || userData === void 0 ? void 0 : userData.middleName) || "",
            country: ((_j = payload.recipientInfo) === null || _j === void 0 ? void 0 : _j.country) || recipientAddress.country,
            province: ((_k = payload.recipientInfo) === null || _k === void 0 ? void 0 : _k.province) || recipientAddress.state,
            municipality: ((_l = payload.recipientInfo) === null || _l === void 0 ? void 0 : _l.municipality) || recipientAddress.city,
            district: ((_m = payload.recipientInfo) === null || _m === void 0 ? void 0 : _m.district) || recipientAddress.district,
            addressLine1: ((_o = payload.recipientInfo) === null || _o === void 0 ? void 0 : _o.addressLine1) || recipientAddress.addressLine1,
            phone: ((_p = payload.recipientInfo) === null || _p === void 0 ? void 0 : _p.phone) || ((_q = orderData.shippingInfo) === null || _q === void 0 ? void 0 : _q.phoneNumber) || (userData === null || userData === void 0 ? void 0 : userData.contactNumber),
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
        if ((_s = (_r = sellerData === null || sellerData === void 0 ? void 0 : sellerData.vendor) === null || _r === void 0 ? void 0 : _r.company) === null || _s === void 0 ? void 0 : _s.address) {
            const sellerAddr = sellerData.vendor.company.address;
            shipperAddress = {
                country: "Philippines",
                province: sellerAddr.province || defaultShipperAddress.province,
                municipality: sellerAddr.city || defaultShipperAddress.municipality,
                district: sellerAddr.line2 || defaultShipperAddress.district,
                addressLine1: sellerAddr.line1 || defaultShipperAddress.addressLine1,
                phone: ((_t = sellerData.vendor.contacts) === null || _t === void 0 ? void 0 : _t.phone) || defaultShipperAddress.phone,
            };
        }
        const shipperInfo = {
            email: ((_u = payload.shipperInfo) === null || _u === void 0 ? void 0 : _u.email) || (sellerData === null || sellerData === void 0 ? void 0 : sellerData.email) || "support@dentpal.ph",
            firstName: ((_v = payload.shipperInfo) === null || _v === void 0 ? void 0 : _v.firstName) || ((_w = sellerData === null || sellerData === void 0 ? void 0 : sellerData.name) === null || _w === void 0 ? void 0 : _w.split(' ')[0]) || ((_y = (_x = sellerData === null || sellerData === void 0 ? void 0 : sellerData.vendor) === null || _x === void 0 ? void 0 : _x.company) === null || _y === void 0 ? void 0 : _y.storeName) || "DentPal",
            lastName: ((_z = payload.shipperInfo) === null || _z === void 0 ? void 0 : _z.lastName) || ((_0 = sellerData === null || sellerData === void 0 ? void 0 : sellerData.name) === null || _0 === void 0 ? void 0 : _0.split(' ').slice(1).join(' ')) || "Support",
            middleName: ((_1 = payload.shipperInfo) === null || _1 === void 0 ? void 0 : _1.middleName) || "",
            country: ((_2 = payload.shipperInfo) === null || _2 === void 0 ? void 0 : _2.country) || shipperAddress.country,
            province: ((_3 = payload.shipperInfo) === null || _3 === void 0 ? void 0 : _3.province) || shipperAddress.province,
            municipality: ((_4 = payload.shipperInfo) === null || _4 === void 0 ? void 0 : _4.municipality) || shipperAddress.municipality,
            district: ((_5 = payload.shipperInfo) === null || _5 === void 0 ? void 0 : _5.district) || shipperAddress.district,
            addressLine1: ((_6 = payload.shipperInfo) === null || _6 === void 0 ? void 0 : _6.addressLine1) || shipperAddress.addressLine1,
            phone: ((_7 = payload.shipperInfo) === null || _7 === void 0 ? void 0 : _7.phone) || shipperAddress.phone,
        };
        // Calculate shipment items from order
        const shipmentItems = payload.shipmentItems || calculateShipmentItems(orderData.items || []);
        // Generate shipment description
        const shipmentDescription = payload.shipmentDescription || generateShipmentDescription(orderData.items || []);
        // COD amount - use order total if cash on delivery
        // Check multiple possible locations for COD payment method
        const isCODOrder = ((_8 = orderData.paymentInfo) === null || _8 === void 0 ? void 0 : _8.method) === 'cod' ||
            ((_9 = orderData.paymongo) === null || _9 === void 0 ? void 0 : _9.paymentMethod) === 'cash_on_delivery' ||
            ((_10 = orderData.metadata) === null || _10 === void 0 ? void 0 : _10.paymentMethod) === 'cash_on_delivery';
        // Check if order has fragile items
        const hasFragileItems = ((_11 = orderData.metadata) === null || _11 === void 0 ? void 0 : _11.hasFragileItems) === true ||
            ((_12 = orderData.items) === null || _12 === void 0 ? void 0 : _12.some((item) => item.isFragile === true));
        // Build remarks with FRAGILE prefix if needed
        let remarks = payload.remarks || ((_13 = orderData.shippingInfo) === null || _13 === void 0 ? void 0 : _13.notes) || "";
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
        //
        // Express / insurance / valuation / packagingSize are taken from the order
        // document so the actual shipment matches what was calculated and charged
        // at checkout time. See createCheckoutSession.ts for the write path.
        //
        // For multi-seller orders, the shipment is created per seller (sellerIds[0]),
        // so prefer that seller's per-breakdown values and fall back to the
        // order-level defaults.
        const shipperSellerId = (_14 = orderData.sellerIds) === null || _14 === void 0 ? void 0 : _14[0];
        const sellerBreakdown = Array.isArray(orderData.sellerFeeBreakdowns)
            ? orderData.sellerFeeBreakdowns.find((b) => b.sellerId === shipperSellerId)
            : undefined;
        const sellerCodTotal = typeof (sellerBreakdown === null || sellerBreakdown === void 0 ? void 0 : sellerBreakdown.totalChargedToBuyer) === 'number'
            ? sellerBreakdown.totalChargedToBuyer
            : undefined;
        const orderCodTotal = typeof ((_15 = orderData.summary) === null || _15 === void 0 ? void 0 : _15.total) === 'number'
            ? orderData.summary.total
            : 0;
        // COD amount should reflect what the buyer pays (exclude seller-paid shipping).
        const codAmount = Math.max(0, typeof payload.codAmountToCollect === 'number'
            ? payload.codAmountToCollect
            : (isCODOrder ? (sellerCodTotal !== null && sellerCodTotal !== void 0 ? sellerCodTotal : orderCodTotal) : 0));
        const orderExpress = typeof ((_16 = orderData.summary) === null || _16 === void 0 ? void 0 : _16.isExpressDelivery) === 'boolean'
            ? orderData.summary.isExpressDelivery
            : typeof ((_17 = orderData.shippingInfo) === null || _17 === void 0 ? void 0 : _17.isExpress) === 'boolean'
                ? orderData.shippingInfo.isExpress
                : true;
        // Insurance & valuation are product-driven: only enabled when the seller
        // has at least one item with product.insuranceAndEvaluation === true.
        const orderInsuranceAndValuation = (sellerBreakdown === null || sellerBreakdown === void 0 ? void 0 : sellerBreakdown.hasInsuranceAndEvaluation) === true;
        // Packaging was already determined at checkout. Prefer the stored value;
        // if missing, omit productName so the JRS API auto-selects.
        const storedPackagingName = (sellerBreakdown === null || sellerBreakdown === void 0 ? void 0 : sellerBreakdown.packagingSize) ||
            ((_18 = orderData.shippingInfo) === null || _18 === void 0 ? void 0 : _18.packagingSize) ||
            ((_19 = orderData.summary) === null || _19 === void 0 ? void 0 : _19.packagingSize) ||
            undefined;
        const resolvedProductName = storedPackagingName;
        logger.info(`📦 JRS shipment for order ${payload.orderId}`, {
            sellerId: shipperSellerId,
            packaging: resolvedProductName !== null && resolvedProductName !== void 0 ? resolvedProductName : "auto (API determines)",
            packagingSource: storedPackagingName ? "order" : "api-auto",
            express: orderExpress,
            insuranceAndValuation: orderInsuranceAndValuation,
            itemCount: shipmentItems.length,
        });
        const jrsRequest = {
            requestType: "shipfromecom",
            apiShippingRequest: {
                express: orderExpress,
                insurance: orderInsuranceAndValuation,
                valuation: orderInsuranceAndValuation,
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
            paymentMethod: ((_20 = orderData.paymongo) === null || _20 === void 0 ? void 0 : _20.paymentMethod) || ((_21 = orderData.paymentInfo) === null || _21 === void 0 ? void 0 : _21.method) || 'unknown',
        });
        // Make API call to JRS
        let response;
        let responseData;
        try {
            response = await axios_1.default.post(JRS_SHIPPING_API_URL.value(), jrsRequest, {
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
                status: (_22 = axiosError.response) === null || _22 === void 0 ? void 0 : _22.status,
                statusText: (_23 = axiosError.response) === null || _23 === void 0 ? void 0 : _23.statusText,
                orderId: payload.orderId,
                shippingReferenceNo,
                errorCode: ((_25 = (_24 = axiosError.response) === null || _24 === void 0 ? void 0 : _24.data) === null || _25 === void 0 ? void 0 : _25.ErrorCode) || axiosError.code,
                errorMessage: ((_27 = (_26 = axiosError.response) === null || _26 === void 0 ? void 0 : _26.data) === null || _27 === void 0 ? void 0 : _27.ErrorMessage) || "Network error",
            });
            res.status(400).json({
                error: "JRS API request failed",
                details: ((_28 = axiosError.response) === null || _28 === void 0 ? void 0 : _28.data) || axiosError.message,
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
            trackingId: (_29 = responseData.ShippingRequestEntityDto) === null || _29 === void 0 ? void 0 : _29.TrackingId,
            totalShippingAmount: (_30 = responseData.ShippingRequestEntityDto) === null || _30 === void 0 ? void 0 : _30.TotalShippingAmount,
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
                        trackingId: (_31 = responseData.ShippingRequestEntityDto) === null || _31 === void 0 ? void 0 : _31.TrackingId,
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
                        trackingId: (_32 = responseData.ShippingRequestEntityDto) === null || _32 === void 0 ? void 0 : _32.TrackingId,
                        requestedAt: new Date(),
                        totalShippingAmount: (_33 = responseData.ShippingRequestEntityDto) === null || _33 === void 0 ? void 0 : _33.TotalShippingAmount,
                        pickupSchedule: jrsRequest.apiShippingRequest.requestedPickupSchedule,
                        // Include COD information
                        cashOnDelivery: {
                            isCOD: isCODOrder,
                            codAmount: codAmount,
                            paymentMethod: ((_34 = orderData.paymongo) === null || _34 === void 0 ? void 0 : _34.paymentMethod) || ((_35 = orderData.paymentInfo) === null || _35 === void 0 ? void 0 : _35.method) || 'unknown',
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
                trackingId: (_36 = responseData.ShippingRequestEntityDto) === null || _36 === void 0 ? void 0 : _36.TrackingId,
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
                trackingId: (_37 = responseData.ShippingRequestEntityDto) === null || _37 === void 0 ? void 0 : _37.TrackingId,
                firestoreError: firestoreError instanceof Error ? firestoreError.message : 'Unknown error'
            });
            return;
        }
        // Return success response with shipping charge details
        res.status(200).json({
            success: true,
            shippingReferenceNo,
            trackingId: (_38 = responseData.ShippingRequestEntityDto) === null || _38 === void 0 ? void 0 : _38.TrackingId,
            totalShippingAmount: (_39 = responseData.ShippingRequestEntityDto) === null || _39 === void 0 ? void 0 : _39.TotalShippingAmount,
            shippingCharges: {
                sellerCharge: sellerShippingCharge,
                buyerCharge: buyerShippingCharge,
                totalCharge: totalShippingCost,
                sellerChargeApplied: sellerShippingCharge > 0,
            },
            cashOnDelivery: {
                isCOD: isCODOrder,
                codAmount: codAmount,
                paymentMethod: ((_40 = orderData.paymongo) === null || _40 === void 0 ? void 0 : _40.paymentMethod) || ((_41 = orderData.paymentInfo) === null || _41 === void 0 ? void 0 : _41.method) || 'unknown',
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
                items: ((_42 = orderData.items) === null || _42 === void 0 ? void 0 : _42.length) || 0,
            },
        });
    }
    catch (error) {
        logger.error("Error in createJRSShipping", {
            error: error instanceof Error ? error.message : "Unknown error",
            orderId: (_43 = req.body) === null || _43 === void 0 ? void 0 : _43.orderId,
            stack: error instanceof Error ? error.stack : undefined,
        });
        res.status(500).json({
            error: "Internal server error",
            message: error instanceof Error ? error.message : "Unknown error",
        });
    }
});
exports.cancelJRSShipping = (0, https_1.onRequest)({
    cors: [
        /^http:\/\/localhost(:\d+)?$/,
        "https://dentpal-161e5.web.app",
        "https://dentpal-site.web.app",
    ],
    region: "asia-southeast1",
    secrets: [JRS_CANCEL_URL, JRS_API_KEY],
}, async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        if (req.method !== "POST") {
            res.status(405).json({ error: "Method not allowed" });
            return;
        }
        let decodedToken;
        try {
            decodedToken = await verifyAuthToken(req.headers.authorization);
        }
        catch (authError) {
            res.status(401).json({
                error: "Authentication required",
                message: authError instanceof Error ? authError.message : "Invalid authentication",
            });
            return;
        }
        const payload = req.body;
        if (!payload.orderId) {
            res.status(400).json({ error: "Missing orderId" });
            return;
        }
        const orderResult = await fetchOrderData(payload.orderId);
        if (!orderResult || !orderResult.data) {
            res.status(404).json({ error: "Order not found" });
            return;
        }
        const orderData = orderResult.data;
        // Authorization: order owner, involved seller (or sub-account), or admin.
        const caller = await fetchCallerProfile(decodedToken);
        const isOrderOwner = orderData.userId === decodedToken.uid;
        const isAdmin = isAdminCaller(decodedToken, caller);
        const isSeller = await isSellerOnOrder(orderData, caller);
        if (!isOrderOwner && !isAdmin && !isSeller) {
            logger.warn("Unauthorized cancel shipping request", {
                orderId: payload.orderId,
                authenticatedUser: decodedToken.uid,
            });
            res.status(403).json({
                error: "Access denied",
                message: "You are not authorized to cancel shipping for this order",
            });
            return;
        }
        const jrsInfo = (_a = orderData.shippingInfo) === null || _a === void 0 ? void 0 : _a.jrs;
        const jrsResponse = jrsInfo === null || jrsInfo === void 0 ? void 0 : jrsInfo.response;
        const shippingRequestId = ((_b = jrsResponse === null || jrsResponse === void 0 ? void 0 : jrsResponse.ShippingRequestEntityDto) === null || _b === void 0 ? void 0 : _b.Id) ||
            ((_c = jrsResponse === null || jrsResponse === void 0 ? void 0 : jrsResponse.ShippingRequestEntityDto) === null || _c === void 0 ? void 0 : _c.id) ||
            (jrsResponse === null || jrsResponse === void 0 ? void 0 : jrsResponse.Id) ||
            (jrsInfo === null || jrsInfo === void 0 ? void 0 : jrsInfo.shippingRequestId);
        if (!shippingRequestId) {
            logger.warn("Cannot cancel shipping: missing JRS shipping request id", {
                orderId: payload.orderId,
                hasJrsInfo: !!jrsInfo,
            });
            res.status(400).json({
                error: "No active JRS shipping request found for this order",
            });
            return;
        }
        if (jrsInfo === null || jrsInfo === void 0 ? void 0 : jrsInfo.cancelledAt) {
            res.status(409).json({
                error: "Shipping already cancelled",
                cancelledAt: jrsInfo.cancelledAt,
            });
            return;
        }
        const cancellationDetails = payload.cancellationDetails || "Cancelled by seller";
        const canceledByUserEmail = payload.canceledByUserEmail || decodedToken.email || caller.email || "admin@dentpal.ph";
        const cancelRequestBody = {
            requestType: "cancelTransaction",
            shippingRequest: {
                id: shippingRequestId,
                cancellationDetails,
                canceledByUserEmail,
            },
        };
        logger.info("Sending JRS cancel shipping request", {
            orderId: payload.orderId,
            shippingRequestId,
            cancellationDetails,
        });
        let cancelResponseData;
        try {
            const response = await axios_1.default.post(JRS_CANCEL_URL.value(), cancelRequestBody, {
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache",
                    "Ocp-Apim-Subscription-Key": JRS_API_KEY.value(),
                },
            });
            cancelResponseData = response.data;
        }
        catch (axiosError) {
            logger.error("JRS cancel API error", {
                orderId: payload.orderId,
                shippingRequestId,
                status: (_d = axiosError.response) === null || _d === void 0 ? void 0 : _d.status,
                details: (_e = axiosError.response) === null || _e === void 0 ? void 0 : _e.data,
            });
            res.status(400).json({
                error: "JRS cancel request failed",
                details: ((_f = axiosError.response) === null || _f === void 0 ? void 0 : _f.data) || axiosError.message,
            });
            return;
        }
        if (cancelResponseData && cancelResponseData.Success === false) {
            logger.error("JRS cancel API business logic error", {
                orderId: payload.orderId,
                shippingRequestId,
                details: cancelResponseData,
            });
            res.status(400).json({
                error: "JRS cancel request failed",
                details: cancelResponseData,
            });
            return;
        }
        // Roll back fulfillment stage and persist cancellation under shippingInfo.
        const orderRef = db.collection(orderResult.collection).doc(payload.orderId);
        const cancelledAt = new Date();
        const newHistoryEntry = {
            status: "to-arrangement",
            note: `JRS shipping cancelled (${cancellationDetails}). Order moved back to arrangement.`,
            timestamp: cancelledAt,
        };
        await orderRef.update({
            "shippingInfo.jrs.cancelledAt": cancelledAt,
            "shippingInfo.jrs.cancellationDetails": cancellationDetails,
            "shippingInfo.jrs.canceledByUserEmail": canceledByUserEmail,
            "shippingInfo.jrs.cancelResponse": cancelResponseData !== null && cancelResponseData !== void 0 ? cancelResponseData : null,
            fulfillmentStage: "to-arrangement",
            statusHistory: firestore_1.FieldValue.arrayUnion(newHistoryEntry),
            updatedAt: cancelledAt,
        });
        logger.info("JRS shipping cancelled and order rolled back", {
            orderId: payload.orderId,
            shippingRequestId,
        });
        res.status(200).json({
            success: true,
            orderId: payload.orderId,
            shippingRequestId,
            cancellationDetails,
            canceledByUserEmail,
            jrsResponse: cancelResponseData,
        });
    }
    catch (error) {
        logger.error("Error in cancelJRSShipping", {
            error: error instanceof Error ? error.message : "Unknown error",
            orderId: (_g = req.body) === null || _g === void 0 ? void 0 : _g.orderId,
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
    secrets: [JRS_API_KEY, JRS_SHIPPING_API_URL],
}, async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2;
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
        // Authorization: only sellers involved in the order (including their
        // sub-accounts) or admins can process returns.
        const caller = await fetchCallerProfile(decodedToken);
        const isAdmin = isAdminCaller(decodedToken, caller);
        const isSeller = await isSellerOnOrder(orderData, caller);
        if (!isAdmin && !isSeller) {
            logger.warn("Unauthorized return request processing", {
                returnRequestId: payload.returnRequestId,
                authenticatedUser: decodedToken.uid,
                callerRole: caller.role,
                callerIsSubAccount: caller.isSubAccount,
                callerParentId: caller.parentId,
                sellerIds: orderData.sellerIds,
                legacySellerId: orderData.sellerId,
            });
            res.status(403).json({
                error: "Access denied",
                message: "Only sellers or admins can process return requests"
            });
            return;
        }
        // Fetch seller data for the order (used downstream for shipping addresses,
        // contact info, etc.). Prefer the seller matching the caller's effective
        // UID so the seller's own contact details are used; fall back to the
        // first seller on the order otherwise.
        let sellerData = null;
        const orderSellerIds = Array.isArray(orderData.sellerIds)
            ? orderData.sellerIds.map((v) => String(v))
            : orderData.sellerId
                ? [String(orderData.sellerId)]
                : [];
        const effectiveUids = getEffectiveSellerUids(caller);
        const preferredSellerId = orderSellerIds.find((id) => effectiveUids.includes(id));
        if (preferredSellerId) {
            sellerData = await fetchSellerData(preferredSellerId);
        }
        if (!sellerData && orderSellerIds.length > 0) {
            sellerData = await fetchSellerData(orderSellerIds[0]);
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
            email: ((_a = orderData.shippingInfo) === null || _a === void 0 ? void 0 : _a.email) || "customer@dentpal.ph",
            firstName: ((_c = (_b = orderData.shippingInfo) === null || _b === void 0 ? void 0 : _b.fullName) === null || _c === void 0 ? void 0 : _c.split(' ')[0]) || "Customer",
            lastName: ((_e = (_d = orderData.shippingInfo) === null || _d === void 0 ? void 0 : _d.fullName) === null || _e === void 0 ? void 0 : _e.split(' ').slice(1).join(' ')) || "N/A",
            middleName: "",
            country: buyerAddress.country,
            province: buyerAddress.state,
            municipality: buyerAddress.city,
            district: buyerAddress.district,
            addressLine1: buyerAddress.addressLine1,
            phone: ((_f = orderData.shippingInfo) === null || _f === void 0 ? void 0 : _f.phoneNumber) || "+639000000000",
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
        if ((_h = (_g = sellerData === null || sellerData === void 0 ? void 0 : sellerData.vendor) === null || _g === void 0 ? void 0 : _g.company) === null || _h === void 0 ? void 0 : _h.address) {
            const sellerAddr = sellerData.vendor.company.address;
            sellerAddress = {
                country: "Philippines",
                province: sellerAddr.province || defaultSellerAddress.province,
                municipality: sellerAddr.city || defaultSellerAddress.municipality,
                district: sellerAddr.line2 || defaultSellerAddress.district,
                addressLine1: sellerAddr.line1 || defaultSellerAddress.addressLine1,
                phone: ((_j = sellerData.vendor.contacts) === null || _j === void 0 ? void 0 : _j.phone) || defaultSellerAddress.phone,
            };
        }
        const recipientInfo = {
            email: (sellerData === null || sellerData === void 0 ? void 0 : sellerData.email) || "support@dentpal.ph",
            firstName: ((_k = sellerData === null || sellerData === void 0 ? void 0 : sellerData.name) === null || _k === void 0 ? void 0 : _k.split(' ')[0]) || ((_m = (_l = sellerData === null || sellerData === void 0 ? void 0 : sellerData.vendor) === null || _l === void 0 ? void 0 : _l.company) === null || _m === void 0 ? void 0 : _m.storeName) || "DentPal",
            lastName: ((_o = sellerData === null || sellerData === void 0 ? void 0 : sellerData.name) === null || _o === void 0 ? void 0 : _o.split(' ').slice(1).join(' ')) || "Support",
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
            ? (_p = orderData.items) === null || _p === void 0 ? void 0 : _p.filter((item) => returnRequestData.itemsToReturn.includes(item.productId))
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
            jrsResponse = await axios_1.default.post(JRS_SHIPPING_API_URL.value(), jrsReturnRequest, {
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
                response: (_q = axiosError.response) === null || _q === void 0 ? void 0 : _q.data,
                status: (_r = axiosError.response) === null || _r === void 0 ? void 0 : _r.status,
            });
            // Update return request with failure
            await returnRequestRef.update({
                status: 'shipping_failed',
                shippingError: ((_t = (_s = axiosError.response) === null || _s === void 0 ? void 0 : _s.data) === null || _t === void 0 ? void 0 : _t.ErrorMessage) || axiosError.message,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
            res.status(502).json({
                error: "JRS shipping request failed",
                message: ((_v = (_u = axiosError.response) === null || _u === void 0 ? void 0 : _u.data) === null || _v === void 0 ? void 0 : _v.ErrorMessage) || axiosError.message,
                jrsError: (_w = axiosError.response) === null || _w === void 0 ? void 0 : _w.data,
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
        const returnTrackingId = (_x = jrsResponseData.ShippingRequestEntityDto) === null || _x === void 0 ? void 0 : _x.TrackingId;
        logger.info("JRS return shipping created successfully", {
            orderId: payload.orderId,
            returnShippingReferenceNo,
            returnTrackingId,
            totalShippingAmount: (_y = jrsResponseData.ShippingRequestEntityDto) === null || _y === void 0 ? void 0 : _y.TotalShippingAmount,
        });
        // Update return request with shipping info
        await returnRequestRef.update({
            status: 'approved',
            approvedAt: firestore_1.FieldValue.serverTimestamp(),
            approvedBy: decodedToken.uid,
            returnShipping: {
                referenceNo: returnShippingReferenceNo,
                trackingId: returnTrackingId,
                totalShippingAmount: (_z = jrsResponseData.ShippingRequestEntityDto) === null || _z === void 0 ? void 0 : _z.TotalShippingAmount,
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
                totalShippingAmount: (_0 = jrsResponseData.ShippingRequestEntityDto) === null || _0 === void 0 ? void 0 : _0.TotalShippingAmount,
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
            returnRequestId: (_1 = req.body) === null || _1 === void 0 ? void 0 : _1.returnRequestId,
            orderId: (_2 = req.body) === null || _2 === void 0 ? void 0 : _2.orderId,
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
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
        const caller = await fetchCallerProfile(decodedToken);
        // If no sellerId provided, find seller record for authenticated user.
        // Sub-accounts resolve to their parent seller's record.
        if (!targetSellerId) {
            const effectiveUids = getEffectiveSellerUids(caller);
            let foundDoc = null;
            for (const uid of effectiveUids) {
                const byUid = await db.collection('Seller')
                    .where('userId', '==', uid)
                    .limit(1)
                    .get();
                if (!byUid.empty) {
                    foundDoc = byUid.docs[0];
                    break;
                }
            }
            if (!foundDoc && caller.email) {
                const byEmail = await db.collection('Seller')
                    .where('email', '==', caller.email)
                    .limit(1)
                    .get();
                if (!byEmail.empty) {
                    foundDoc = byEmail.docs[0];
                }
            }
            if (!foundDoc) {
                res.status(404).json({
                    error: "Seller not found",
                    message: "No seller account found for this user"
                });
                return;
            }
            targetSellerId = foundDoc.id;
        }
        // Verify authorization
        const sellerDoc = await db.collection('Seller').doc(targetSellerId).get();
        if (!sellerDoc.exists) {
            res.status(404).json({ error: "Seller not found" });
            return;
        }
        const sellerData = sellerDoc.data();
        const isSellerOwner = isOwnerOfSeller(sellerData, caller);
        const isAdmin = isAdminCaller(decodedToken, caller);
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
                    requestedAt: ((_c = (_b = (_a = data.requestedAt) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) === null || _c === void 0 ? void 0 : _c.toISOString()) || data.requestedAt,
                    approvedAt: ((_f = (_e = (_d = data.approvedAt) === null || _d === void 0 ? void 0 : _d.toDate) === null || _e === void 0 ? void 0 : _e.call(_d)) === null || _f === void 0 ? void 0 : _f.toISOString()) || data.approvedAt,
                    rejectedAt: ((_j = (_h = (_g = data.rejectedAt) === null || _g === void 0 ? void 0 : _g.toDate) === null || _h === void 0 ? void 0 : _h.call(_g)) === null || _j === void 0 ? void 0 : _j.toISOString()) || data.rejectedAt,
                    deliveryDate: ((_m = (_l = (_k = data.deliveryDate) === null || _k === void 0 ? void 0 : _k.toDate) === null || _l === void 0 ? void 0 : _l.call(_k)) === null || _m === void 0 ? void 0 : _m.toISOString()) || data.deliveryDate,
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
    secrets: [PAYMONGO_SECRET_KEY, PAYMONGO_WALLET_ID, PAYMONGO_API_URL],
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
    secrets: [PAYMONGO_SECRET_KEY, PAYMONGO_WALLET_ID, PAYMONGO_API_URL],
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
    secrets: [PAYMONGO_SECRET_KEY, PAYMONGO_WALLET_ID, PAYMONGO_API_URL],
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
    secrets: [PAYMONGO_SECRET_KEY, PAYMONGO_WALLET_ID, PAYMONGO_API_URL],
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
    secrets: [PAYMONGO_SECRET_KEY, PAYMONGO_WALLET_ID, PAYMONGO_API_URL],
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
// Manually Verify User Email
// ============================================
/**
 * Manually verify a user's email address in Firebase Authentication
 * Admin-only access required
 * This is used when an admin needs to manually verify a user's email
 */
exports.verifyUserEmail = (0, https_1.onRequest)({
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
            await verifyAdminAccess(decodedToken.uid, "manually verify user email");
        }
        catch (adminError) {
            if (adminError instanceof AdminAccessError) {
                res.status(403).json({ error: adminError.message });
                return;
            }
            throw adminError;
        }
        const { uid } = req.body;
        if (!uid || typeof uid !== "string") {
            res.status(400).json({ error: "Invalid user ID provided" });
            return;
        }
        // Get the user to check their current email verification status
        const userRecord = await auth.getUser(uid);
        if (userRecord.emailVerified) {
            res.status(400).json({
                error: "User's email is already verified",
                emailVerified: true
            });
            return;
        }
        // Update the user's emailVerified status in Firebase Authentication
        await auth.updateUser(uid, { emailVerified: true });
        // Also update the emailVerified field in Firestore User collection
        const userRef = db.collection("User").doc(uid);
        await userRef.update({
            emailVerified: true,
            emailVerifiedAt: firestore_1.FieldValue.serverTimestamp(),
            emailVerifiedBy: decodedToken.uid,
        });
        logger.info("User email manually verified successfully", {
            targetUid: uid,
            verifiedBy: decodedToken.uid,
            email: userRecord.email,
        });
        res.status(200).json({
            success: true,
            message: "User email verified successfully",
            uid,
            email: userRecord.email,
            emailVerified: true,
        });
    }
    catch (error) {
        logger.error("Error verifying user email", {
            error: error.message,
            code: error.code,
        });
        let statusCode = 500;
        let errorMessage = error.message || "Failed to verify user email";
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