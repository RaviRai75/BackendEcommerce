#!/usr/bin/env node
/**
 * Creates every index declared by the models without dropping other indexes.
 *
 * `autoIndex` is disabled in production (see src/config/database.js), because
 * implicitly building indexes on boot can stall a deploy and mask a mistake.
 * Instead this runs as an explicit deployment step:
 *
 *   npm run db:indexes
 *
 * Safe to re-run — MongoDB ignores an equivalent index that already exists,
 * while manually managed and rolling-migration indexes are preserved.
 */
import {
  connectDatabase,
  disconnectDatabase,
  ensureDeclaredIndexes,
} from "../src/config/database.js";
import { env } from "../src/config/env.js";
import { assertMediaAssetMigrationReady } from "../src/services/media/mediaMigration.js";

// Importing a model registers it with Mongoose, which is what
// `ensureDeclaredIndexes` iterates over. Every model must be imported here.
import "../src/modules/users/user.model.js";
import "../src/modules/auth/session.model.js";
import "../src/modules/auth/passwordResetToken.model.js";
import "../src/modules/shipping/pincode.model.js";
import "../src/modules/shipping/shipment.model.js";
import "../src/modules/categories/category.model.js";
import "../src/modules/collections/collection.model.js";
import "../src/modules/products/product.model.js";
import "../src/modules/products/adminInventoryTransaction.model.js";
import "../src/modules/products/productImport.model.js";
import "../src/modules/wishlist/wishlist.model.js";
import "../src/modules/recentlyViewed/recentlyViewed.model.js";
import "../src/modules/cart/cart.model.js";
import "../src/modules/cart/abandonedCartEvent.model.js";
import "../src/modules/addresses/address.model.js";
import "../src/modules/coupons/coupon.model.js";
import "../src/modules/orders/order.model.js";
import "../src/modules/orders/orderInvoicePolicy.model.js";
import "../src/modules/orders/orderInvoiceSequence.model.js";
import "../src/modules/orders/orderInvoice.model.js";
import "../src/modules/orders/customerCommerceState.model.js";
import "../src/modules/orders/inventoryTransaction.model.js";
import "../src/modules/orders/couponRedemption.model.js";
import "../src/modules/orders/couponCustomerUsage.model.js";
import "../src/modules/orders/orderPlacementSettings.model.js";
import "../src/modules/exchanges/exchange.model.js";
import "../src/modules/exchanges/exchangeInventoryTransaction.model.js";
import "../src/modules/exchanges/exchangePolicy.model.js";
import "../src/modules/reviews/review.model.js";
import "../src/modules/payments/payment.model.js";
import "../src/modules/payments/paymentEvent.model.js";
import "../src/modules/media/mediaAsset.model.js";
import "../src/modules/settings/settings.model.js";
import "../src/modules/referrals/referral.model.js";
import "../src/modules/content/contentPage.model.js";
import "../src/modules/content/contentPageRevision.model.js";
import "../src/modules/content/businessProfile.model.js";
import "../src/modules/system/seedRun.model.js";
import "../src/modules/system/auditLog.model.js";
import "../src/modules/notifications/notification.model.js";
import "../src/modules/notifications/emailDelivery.model.js";
import "../src/modules/notifications/variantLowStockState.model.js";
import "../src/modules/support/supportTicket.model.js";
import "../src/modules/support/supportMessage.model.js";
import "../src/modules/support/supportQuickReply.model.js";
import "../src/modules/customization/customSequence.model.js";
import "../src/modules/customization/measurementProfile.model.js";
import "../src/modules/customization/customRequest.model.js";
import "../src/modules/customization/customRequestMessage.model.js";
import "../src/modules/customization/customRequestQuote.model.js";
import "../src/modules/customization/customOrder.model.js";
import "../src/modules/sizeGuides/sizeGuide.model.js";

async function main() {
  console.log(`  Connecting to database "${env.MONGODB_DB_NAME}" …`);
  await connectDatabase();
  await assertMediaAssetMigrationReady();

  const results = await ensureDeclaredIndexes();

  console.log("");
  for (const { model, indexes } of results.sort((a, b) =>
    a.model.localeCompare(b.model),
  )) {
    console.log(`    ${model.padEnd(24)}${indexes} index(es)`);
  }
  console.log("");
  console.log("  Indexes are up to date.");
}

main()
  .then(async () => {
    await disconnectDatabase();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("  Index sync failed:", error.message);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });
