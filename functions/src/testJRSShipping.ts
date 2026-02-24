import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {defineSecret} from "firebase-functions/params";
import axios from "axios";

// ============================================
// Test JRS Shipping API Configuration
// ============================================
const JRS_TEST_API_KEY = defineSecret("JRS_TEST_API_KEY");
const JRS_TEST_API_URL = "https://jrs-express.azure-api.net/qa-online-shipping-ship/ShippingRequestFunction";

// ============================================
// Types
// ============================================
interface ShipmentItem {
  length: number;
  width: number;
  height: number;
  weight: number;
  declaredValue: number;
}

interface JRSShippingRequest {
  requestType: "shipfromecom";
  apiShippingRequest: {
    express: boolean;
    insurance: boolean;
    valuation: boolean;
    productName?: string;
    createdByUserEmail: string;
    shipmentItems: ShipmentItem[];
    recipientEmail: string;
    recipientFirstName: string;
    recipientLastName: string;
    recipientMiddleName?: string;
    recipientCountry: string;
    recipientProvince: string;
    recipientMunicipality: string;
    recipientDistrict: string;
    recipientAddressLine1: string;
    recipientPhone: string;
    shipperEmail: string;
    shipperFirstName: string;
    shipperLastName: string;
    shipperMiddleName?: string;
    shipperCountry: string;
    shipperProvince: string;
    shipperMunicipality: string;
    shipperDistrict: string;
    shipperAddressLine1: string;
    shipperPhone: string;
    requestedPickupSchedule: string;
    shipmentDescription: string;
    remarks?: string;
    specialInstruction?: string;
    codAmountToCollect: number;
    shippingReferenceNo: string;
  };
}

interface TestOrder {
  label: string;
  expectedPackaging: string;
  shipmentItems: ShipmentItem[];
  description: string;
}

// ============================================
// determineProductName - 1:1 copy from index.ts
// ============================================
function determineProductName(shipmentItems: ShipmentItem[]): string | undefined {
  if (!shipmentItems || shipmentItems.length === 0) {
    return undefined;
  }

  const totalWeight = shipmentItems.reduce((sum, item) => sum + item.weight, 0);

  let maxShort = 0;
  let maxLong = 0;
  let totalHeight = 0;

  for (const item of shipmentItems) {
    const dim1 = item.width || 0;
    const dim2 = item.length || 0;
    const short = Math.min(dim1, dim2);
    const long = Math.max(dim1, dim2);
    const h = item.height || 0;

    maxShort = Math.max(maxShort, short);
    maxLong = Math.max(maxLong, long);
    totalHeight += h;
  }

  logger.info("determineProductName input:", {
    totalWeight, maxShort, maxLong, totalHeight,
    itemCount: shipmentItems.length,
  });

  const fitsIn2D = (pkgDim1: number, pkgDim2: number): boolean => {
    const pkgShort = Math.min(pkgDim1, pkgDim2);
    const pkgLong = Math.max(pkgDim1, pkgDim2);
    return maxShort <= pkgShort && maxLong <= pkgLong;
  };

  const fitsIn3D = (pkgDim1: number, pkgDim2: number, pkgDim3: number): boolean => {
    const pkgDims = [pkgDim1, pkgDim2, pkgDim3].sort((a, b) => a - b);
    const itemDims = [maxShort, maxLong, totalHeight].sort((a, b) => a - b);
    return itemDims[0] <= pkgDims[0] && itemDims[1] <= pkgDims[1] && itemDims[2] <= pkgDims[2];
  };

  if (totalWeight <= 100 && fitsIn2D(24.13, 16.00)) {
    logger.info("Matched: Express Letter");
    return "Express Letter";
  }

  if (totalWeight <= 500 && fitsIn2D(38.10, 27.94)) {
    logger.info("Matched: 1 Pounder");
    return "1 Pounder";
  }

  if (totalWeight <= 1500 && fitsIn2D(45.72, 35.56)) {
    logger.info("Matched: 3 Pounder");
    return "3 Pounder";
  }

  if (totalWeight <= 2500 && fitsIn3D(20.32, 29.21, 10.16)) {
    logger.info("Matched: Bulilit Box");
    return "Bulilit Box";
  }

  if (totalWeight <= 2500 && fitsIn2D(50.80, 35.56)) {
    logger.info("Matched: 5 Pounder");
    return "5 Pounder";
  }

  logger.info("No manual rule matched, API will determine productName automatically", {
    totalWeight, maxShort, maxLong, totalHeight,
  });
  return undefined;
}

// ============================================
// 6 hardcoded test orders, one per packaging
// ============================================
const TEST_ORDERS: TestOrder[] = [
  {
    label: "Express Letter",
    expectedPackaging: "Express Letter",
    description: "Dental floss sample (tiny, light)",
    shipmentItems: [{
      length: 20,
      width: 10,
      height: 1,
      weight: 50,
      declaredValue: 150,
    }],
  },
  {
    label: "1 Pounder",
    expectedPackaging: "1 Pounder",
    description: "Orthodontic brackets kit",
    shipmentItems: [{
      length: 30,
      width: 25,
      height: 5,
      weight: 400,
      declaredValue: 850,
    }],
  },
  {
    label: "3 Pounder",
    expectedPackaging: "3 Pounder",
    description: "Dental impression material set",
    shipmentItems: [{
      length: 40,
      width: 30,
      height: 8,
      weight: 1200,
      declaredValue: 1500,
    }],
  },
  {
    label: "Bulilit Box",
    expectedPackaging: "Bulilit Box",
    description: "Composite resin kit (compact, heavy box)",
    shipmentItems: [{
      length: 25,
      width: 18,
      height: 9,
      weight: 2000,
      declaredValue: 3200,
    }],
  },
  {
    label: "5 Pounder",
    expectedPackaging: "5 Pounder",
    description: "Dental instrument tray set",
    shipmentItems: [{
      length: 48,
      width: 33,
      height: 12,
      weight: 2300,
      declaredValue: 4500,
    }],
  },
  {
    label: "Custom (auto)",
    expectedPackaging: "auto",
    description: "Large dental chair headrest (oversized)",
    shipmentItems: [{
      length: 60,
      width: 45,
      height: 25,
      weight: 5000,
      declaredValue: 8000,
    }],
  },
];

// ============================================
// Shared test address info
// ============================================
const TEST_RECIPIENT = {
  email: "test-recipient@dentpal.ph",
  firstName: "Test",
  lastName: "Buyer",
  middleName: "",
  country: "Philippines",
  province: "Metro Manila",
  municipality: "Quezon City",
  district: "Diliman",
  addressLine1: "123 Test Street, Brgy. UP Campus",
  phone: "+639171234567",
};

const TEST_SHIPPER = {
  email: "test-seller@dentpal.ph",
  firstName: "DentPal",
  lastName: "Seller",
  middleName: "",
  country: "Philippines",
  province: "Metro Manila",
  municipality: "Makati City",
  district: "Poblacion",
  addressLine1: "456 Dental Ave, Brgy. San Lorenzo",
  phone: "+639189876543",
};

// ============================================
// Build a JRS request for a single test order
// ============================================
function buildJRSRequest(testOrder: TestOrder, index: number): JRSShippingRequest {
  const resolvedProductName = determineProductName(testOrder.shipmentItems);
  const timestamp = Date.now();
  const refNo = `TEST-BULK-${index + 1}-${testOrder.label.replace(/\s+/g, "-").toUpperCase()}-${timestamp}`;

  return {
    requestType: "shipfromecom",
    apiShippingRequest: {
      express: true,
      insurance: true,
      valuation: true,
      ...(resolvedProductName ? {productName: resolvedProductName} : {}),
      createdByUserEmail: TEST_SHIPPER.email,
      shipmentItems: testOrder.shipmentItems,
      recipientEmail: TEST_RECIPIENT.email,
      recipientFirstName: TEST_RECIPIENT.firstName,
      recipientLastName: TEST_RECIPIENT.lastName,
      recipientMiddleName: TEST_RECIPIENT.middleName,
      recipientCountry: TEST_RECIPIENT.country,
      recipientProvince: TEST_RECIPIENT.province,
      recipientMunicipality: TEST_RECIPIENT.municipality,
      recipientDistrict: TEST_RECIPIENT.district,
      recipientAddressLine1: TEST_RECIPIENT.addressLine1,
      recipientPhone: TEST_RECIPIENT.phone,
      shipperEmail: TEST_SHIPPER.email,
      shipperFirstName: TEST_SHIPPER.firstName,
      shipperLastName: TEST_SHIPPER.lastName,
      shipperMiddleName: TEST_SHIPPER.middleName,
      shipperCountry: TEST_SHIPPER.country,
      shipperProvince: TEST_SHIPPER.province,
      shipperMunicipality: TEST_SHIPPER.municipality,
      shipperDistrict: TEST_SHIPPER.district,
      shipperAddressLine1: TEST_SHIPPER.addressLine1,
      shipperPhone: TEST_SHIPPER.phone,
      requestedPickupSchedule: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      shipmentDescription: `TEST: ${testOrder.description}`,
      remarks: `Bulk API test - ${testOrder.label}`,
      specialInstruction: "",
      codAmountToCollect: 0,
      shippingReferenceNo: refNo,
    },
  };
}

// ============================================
// Main function: fires 6 JRS requests in parallel
// ============================================

/**
 * Bulk JRS API test. Sends 6 shipping requests (one per packaging type) in a single curl call.
 *
 * Usage:
 *   curl -X POST https://asia-southeast1-dentpal-161e5.cloudfunctions.net/testCreateJRSShipping \
 *     -H "Content-Type: application/json" \
 *     -d '{}'
 *
 * No body payload needed. All 6 test orders are hardcoded.
 * Returns results for each packaging type showing success/failure and JRS response.
 */
export const testCreateJRSShipping = onRequest({
  cors: true,
  region: "asia-southeast1",
  timeoutSeconds: 120,
  secrets: [JRS_TEST_API_KEY],
}, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  try {
    if (req.method !== "POST") {
      res.status(405).json({error: "Method not allowed"});
      return;
    }

    // No auth required — this is a test-only function
    logger.info("[TEST-BULK] Starting bulk JRS API test with 6 packaging types", {
      apiUrl: JRS_TEST_API_URL,
      apiKeySet: !!JRS_TEST_API_KEY.value(),
    });

    // Build all 6 JRS requests
    const testRequests = TEST_ORDERS.map((order, index) => {
      const jrsRequest = buildJRSRequest(order, index);
      logger.info(`[TEST-BULK] Order ${index + 1}/${TEST_ORDERS.length}: ${order.label}`, {
        expectedPackaging: order.expectedPackaging,
        resolvedProductName: jrsRequest.apiShippingRequest.productName ?? "auto (not set)",
        weight: order.shipmentItems[0].weight,
        dimensions: `${order.shipmentItems[0].length}x${order.shipmentItems[0].width}x${order.shipmentItems[0].height}`,
        refNo: jrsRequest.apiShippingRequest.shippingReferenceNo,
      });
      return {order, jrsRequest};
    });

    // Fire all 6 requests in parallel
    const results = await Promise.allSettled(
      testRequests.map(async ({order, jrsRequest}, index) => {
        const startTime = Date.now();

        try {
          logger.info(`[TEST-BULK] Sending request ${index + 1}: ${order.label}`, {
            productName: jrsRequest.apiShippingRequest.productName ?? "auto",
            refNo: jrsRequest.apiShippingRequest.shippingReferenceNo,
            shipmentItems: jrsRequest.apiShippingRequest.shipmentItems,
          });

          const response = await axios.post(JRS_TEST_API_URL, jrsRequest, {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-cache",
              "Ocp-Apim-Subscription-Key": JRS_TEST_API_KEY.value(),
            },
            timeout: 60000,
          });

          const elapsed = Date.now() - startTime;
          const data = response.data;

          // Check for JRS business-logic error
          if (!data.Success && data.Success !== undefined) {
            logger.error(`[TEST-BULK] ${order.label} JRS business error`, {
              errorMessage: data.ErrorMessage,
              errorCode: data.ErrorCode,
              elapsed,
            });
            return {
              order: index + 1,
              label: order.label,
              expectedPackaging: order.expectedPackaging,
              resolvedProductName: jrsRequest.apiShippingRequest.productName ?? "auto",
              status: "JRS_ERROR",
              elapsed: `${elapsed}ms`,
              error: data.ErrorMessage || "Unknown JRS error",
              jrsResponse: data,
              requestSent: {
                productName: jrsRequest.apiShippingRequest.productName ?? "auto",
                shipmentItems: jrsRequest.apiShippingRequest.shipmentItems,
                shippingReferenceNo: jrsRequest.apiShippingRequest.shippingReferenceNo,
              },
            };
          }

          logger.info(`[TEST-BULK] ${order.label} SUCCESS`, {
            trackingId: data.ShippingRequestEntityDto?.TrackingId,
            totalShippingAmount: data.ShippingRequestEntityDto?.TotalShippingAmount,
            elapsed,
          });

          return {
            order: index + 1,
            label: order.label,
            expectedPackaging: order.expectedPackaging,
            resolvedProductName: jrsRequest.apiShippingRequest.productName ?? "auto",
            status: "SUCCESS",
            elapsed: `${elapsed}ms`,
            trackingId: data.ShippingRequestEntityDto?.TrackingId ?? null,
            totalShippingAmount: data.ShippingRequestEntityDto?.TotalShippingAmount ?? null,
            jrsResponse: data,
            requestSent: {
              productName: jrsRequest.apiShippingRequest.productName ?? "auto",
              shipmentItems: jrsRequest.apiShippingRequest.shipmentItems,
              shippingReferenceNo: jrsRequest.apiShippingRequest.shippingReferenceNo,
            },
          };
        } catch (axiosError: any) {
          const elapsed = Date.now() - startTime;
          logger.error(`[TEST-BULK] ${order.label} API error`, {
            status: axiosError.response?.status,
            errorMessage: axiosError.response?.data?.ErrorMessage || axiosError.message,
            responseData: axiosError.response?.data,
            elapsed,
          });

          return {
            order: index + 1,
            label: order.label,
            expectedPackaging: order.expectedPackaging,
            resolvedProductName: jrsRequest.apiShippingRequest.productName ?? "auto",
            status: "API_ERROR",
            elapsed: `${elapsed}ms`,
            httpStatus: axiosError.response?.status ?? null,
            error: axiosError.response?.data?.ErrorMessage || axiosError.message,
            details: axiosError.response?.data ?? null,
            requestSent: {
              productName: jrsRequest.apiShippingRequest.productName ?? "auto",
              shipmentItems: jrsRequest.apiShippingRequest.shipmentItems,
              shippingReferenceNo: jrsRequest.apiShippingRequest.shippingReferenceNo,
            },
          };
        }
      })
    );

    // Compile final results
    const finalResults = results.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      return {
        order: index + 1,
        label: TEST_ORDERS[index].label,
        expectedPackaging: TEST_ORDERS[index].expectedPackaging,
        status: "UNEXPECTED_ERROR",
        error: result.reason?.message || "Unknown error",
      };
    });

    // Summary counts
    const successCount = finalResults.filter((r) => r.status === "SUCCESS").length;
    const errorCount = finalResults.length - successCount;

    logger.info(`[TEST-BULK] Complete: ${successCount}/${finalResults.length} succeeded, ${errorCount} failed`);

    res.status(200).json({
      testMode: true,
      note: "Bulk JRS API test with 6 packaging types. NO Firestore writes.",
      summary: {
        total: finalResults.length,
        success: successCount,
        failed: errorCount,
      },
      results: finalResults,
    });
  } catch (error) {
    logger.error("[TEST-BULK] Unexpected error", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
      testMode: true,
    });
  }
});
