import {
  SiteSettings,
  SETTINGS_SINGLETON_KEY,
  AnnouncementTone,
} from "../../src/modules/settings/settings.model.js";
import {
  OrderPlacementSettings,
  ORDER_PLACEMENT_SETTINGS_KEY,
} from "../../src/modules/orders/orderPlacementSettings.model.js";
import {
  ExchangePolicy,
  EXCHANGE_POLICY_KEY,
  ExchangeReason,
} from "../../src/modules/exchanges/exchangePolicy.model.js";
import { MediaPurpose } from "../../src/modules/media/mediaAsset.model.js";
import { ensureMediaAsset } from "./mediaHelper.js";

const HERO_IMAGE_URL =
  "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=1600&auto=format&fit=crop&q=80";

export const settingsSeeder = {
  name: "settings",
  kind: "demo",
  description: "Site settings, home hero banner, delivery policies and exchange window",

  async run() {
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    // 1. SiteSettings with home hero
    const heroMedia = await ensureMediaAsset({
      sourceUrl: HERO_IMAGE_URL,
      purpose: MediaPurpose.HOME_HERO,
      altText: "Sanchandana Royal Silk & Festive Ethnic Fashion",
      tag: "home-hero-banner",
    });

    const settingsDoc = {
      key: SETTINGS_SINGLETON_KEY,
      announcement: {
        authored: true,
        enabled: true,
        message:
          "Festive Season Exclusive: Flat 15% off on Pure Silk Sarees | Free Express Shipping across Karnataka",
        linkUrl: "/shop?category=sarees",
        tone: AnnouncementTone.WINE,
      },
      referralProgram: {
        enabled: true,
        friendDiscountPaise: 50000,
        referrerRewardPaise: 50000,
        minimumPurchasePaise: 199900,
      },
      loyaltyProgram: {
        enabled: true,
        earningPoints: 10,
        earningSpendPaise: 10000,
        redemptionPoints: 100,
        redemptionValuePaise: 10000,
        expiryDays: 365,
      },
      homeHeroMedia: heroMedia,
    };

    const existingSettings = await SiteSettings.findOne({
      key: SETTINGS_SINGLETON_KEY,
    });
    if (!existingSettings) {
      await SiteSettings.create(settingsDoc);
      created++;
    } else {
      Object.assign(existingSettings, settingsDoc);
      await existingSettings.save();
      updated++;
    }

    // 2. OrderPlacementSettings
    const existingPlacement = await OrderPlacementSettings.findOne({
      key: ORDER_PLACEMENT_SETTINGS_KEY,
    });
    const placementData = {
      key: ORDER_PLACEMENT_SETTINGS_KEY,
      enabled: true,
      version: 1,
      allowedState: "Karnataka",
      flatDeliveryPaise: 9900,
      freeDeliveryThresholdPaise: 199900,
      pincodeChargeOverrides: [],
      cod: { enabled: true, surchargePaise: 5000 },
      prepaid: { enabled: true, surchargePaise: 0 },
    };

    if (!existingPlacement) {
      await OrderPlacementSettings.create(placementData);
      created++;
    } else {
      Object.assign(existingPlacement, placementData);
      await existingPlacement.save();
      updated++;
    }

    // 3. ExchangePolicy
    const existingExchange = await ExchangePolicy.findOne({
      key: EXCHANGE_POLICY_KEY,
    });
    const exchangeData = {
      key: EXCHANGE_POLICY_KEY,
      enabled: true,
      version: 1,
      windowDays: 7,
      reasons: [
        { code: ExchangeReason.SIZE_ISSUE, label: "Size does not fit properly", minPhotos: 1 },
        { code: ExchangeReason.WRONG_PRODUCT_RECEIVED, label: "Wrong product received", minPhotos: 2 },
        { code: ExchangeReason.DAMAGED_PRODUCT, label: "Product arrived damaged or defective", minPhotos: 2 },
        { code: ExchangeReason.OTHER, label: "Other quality or fabric concern", minPhotos: 1 },
      ],
    };

    if (!existingExchange) {
      await ExchangePolicy.create(exchangeData);
      created++;
    } else {
      Object.assign(existingExchange, exchangeData);
      await existingExchange.save();
      updated++;
    }

    return { created, updated, unchanged };
  },

  async purge() {
    return { removed: 0 };
  },
};
