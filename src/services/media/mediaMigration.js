import { Product } from "../../modules/products/product.model.js";

/**
 * Fails deployment before indexes/application rollout when Task 7 metadata-only
 * media still exists. Those records must be inspected at the provider, inserted
 * as READY MediaAsset documents, and backfilled with assetId before Task 9 can
 * provide reference-safe deletion.
 */
export async function assertMediaAssetMigrationReady() {
  const legacyProducts = await Product.collection.countDocuments({
    media: {
      $elemMatch: {
        $or: [{ assetId: { $exists: false } }, { assetId: null }],
      },
    },
  });
  if (legacyProducts > 0) {
    throw new Error(
      `Task 9 media migration required: ${legacyProducts} product(s) contain media without assetId. Backfill verified MediaAsset records before deployment.`,
    );
  }
  return { legacyProducts: 0 };
}
