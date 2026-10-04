/**
 * API route aggregator.
 *
 * Each business module owns its own router; this file only mounts them. As
 * modules land they are added here and nowhere else, which keeps the surface of
 * the API visible in one place — including its security classification.
 *
 * Classification legend (security §7):
 *   PUBLIC — no authentication
 *   USER   — authenticated customer, own resources only
 *   ADMIN  — authenticated administrator
 */
import { Router } from "express";
import { healthRoutes } from "../modules/health/health.routes.js";
import { authRoutes } from "../modules/auth/auth.routes.js";
import { auditRoutes } from "../modules/system/audit.routes.js";
import { categoryRoutes } from "../modules/categories/category.routes.js";
import { collectionRoutes } from "../modules/collections/collection.routes.js";
import { dashboardRoutes } from "../modules/dashboard/dashboard.routes.js";
import { productRoutes } from "../modules/products/product.routes.js";
import { wishlistRoutes } from "../modules/wishlist/wishlist.routes.js";
import { recentlyViewedRoutes } from "../modules/recentlyViewed/recentlyViewed.routes.js";
import { cartRoutes } from "../modules/cart/cart.routes.js";
import { addressRoutes } from "../modules/addresses/address.routes.js";
import { mapsRoutes } from "../modules/addresses/maps.routes.js";
import { couponRoutes } from "../modules/coupons/coupon.routes.js";
import { orderRoutes } from "../modules/orders/order.routes.js";
import { exchangeRoutes } from "../modules/exchanges/exchange.routes.js";
import { reviewRoutes } from "../modules/reviews/review.routes.js";
import { paymentRoutes } from "../modules/payments/payment.routes.js";
import { shippingRoutes } from "../modules/shipping/shipping.routes.js";
import { settingsRoutes } from "../modules/settings/settings.routes.js";
import { referralRoutes } from "../modules/referrals/referral.routes.js";
import { contentRoutes } from "../modules/content/content.routes.js";
import { mediaRoutes } from "../modules/media/media.routes.js";
import { notificationRoutes } from "../modules/notifications/notification.routes.js";
import { customizationRoutes } from "../modules/customization/customization.routes.js";
import { sizeGuideRoutes } from "../modules/sizeGuides/sizeGuide.routes.js";
import { socialShareRoutes } from "../modules/socialSharing/socialShare.routes.js";
import { supportRoutes } from "../modules/support/support.routes.js";
import { seoRoutes } from "../modules/seo/seo.routes.js";
import { chatRoutes } from "../modules/chat/chat.routes.js";
import { isProduction } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const apiRouter = Router();

// PUBLIC
apiRouter.use(healthRoutes);
apiRouter.use(seoRoutes);
apiRouter.use(chatRoutes);

// PUBLIC + USER — endpoint-specific controls are declared inside the auth router.
apiRouter.use(authRoutes);

// PUBLIC + ADMIN — endpoint-specific controls are declared inside each router.
apiRouter.use(categoryRoutes);
apiRouter.use(collectionRoutes);
apiRouter.use(productRoutes);
apiRouter.use(socialShareRoutes);
apiRouter.use(shippingRoutes);
apiRouter.use(settingsRoutes);
apiRouter.use(contentRoutes);
apiRouter.use(sizeGuideRoutes);

// PUBLIC + USER — public resolve and authenticated owner-only persistence.
apiRouter.use(wishlistRoutes);
apiRouter.use(recentlyViewedRoutes);
apiRouter.use(cartRoutes);
apiRouter.use(addressRoutes);
apiRouter.use(mapsRoutes);
apiRouter.use(couponRoutes);
apiRouter.use(orderRoutes);
apiRouter.use(exchangeRoutes);
apiRouter.use(reviewRoutes);
apiRouter.use(paymentRoutes);
apiRouter.use(notificationRoutes);
apiRouter.use(supportRoutes);
apiRouter.use(customizationRoutes);
apiRouter.use(referralRoutes);

// ADMIN — dashboard analytics and signed media operations.
apiRouter.use(dashboardRoutes);
apiRouter.use(mediaRoutes);

// ADMIN
apiRouter.use(auditRoutes);

/**
 * Development-only endpoints used to verify the error contract by hand. Never
 * mounted in production.
 */
if (!isProduction) {
  apiRouter.get("/_dev/boom/unexpected", () => {
    // Simulates a genuine bug: the customer must see a generic message while
    // the log keeps the full stack.
    throw new Error("Simulated unexpected failure with an internal detail");
  });

  apiRouter.get("/_dev/boom/operational", () => {
    throw AppError.notFound("Demo product");
  });

  // Wrapped in `asyncHandler`: Express 4 does not await handlers, so without it
  // a rejected promise never reaches the error pipeline and the request hangs.
  apiRouter.get(
    "/_dev/boom/async",
    asyncHandler(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      throw new Error("Simulated rejected promise");
    }),
  );
}
