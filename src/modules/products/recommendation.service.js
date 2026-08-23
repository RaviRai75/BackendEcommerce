import { AppError } from "../../utils/AppError.js";
import {
  Product,
  ProductStatus,
  ProductVariantStatus,
} from "./product.model.js";
import { productRecommendationBoundary } from "./product.service.js";

const RELATED_CANDIDATE_LIMIT = 200;
const { publicRelationConstraint, publicSummary } =
  productRecommendationBoundary;

function recommendationScoreExpression(source) {
  const sourceColours = [
    ...new Set((source.variants ?? []).map((variant) => variant.colour)),
  ];
  const priceDifference = {
    $abs: { $subtract: ["$basePricePaise", source.basePricePaise] },
  };
  const priceScore = {
    $cond: [
      { $lte: [priceDifference, source.basePricePaise * 0.1] },
      20,
      {
        $cond: [
          { $lte: [priceDifference, source.basePricePaise * 0.25] },
          12,
          {
            $cond: [
              { $lte: [priceDifference, source.basePricePaise * 0.5] },
              6,
              0,
            ],
          },
        ],
      },
    ],
  };

  return {
    $add: [
      { $cond: [{ $eq: ["$category", source.category] }, 100, 0] },
      {
        $multiply: [
          { $size: { $setIntersection: ["$collections", source.collections] } },
          35,
        ],
      },
      {
        $multiply: [
          {
            $size: {
              $setIntersection: [
                {
                  $map: {
                    input: {
                      $filter: {
                        input: "$variants",
                        as: "candidate",
                        cond: {
                          $ne: [
                            "$candidate.status",
                            ProductVariantStatus.RETIRED,
                          ],
                        },
                      },
                    },
                    as: "variant",
                    in: "$$variant.colour",
                  },
                },
                sourceColours,
              ],
            },
          },
          20,
        ],
      },
      {
        $multiply: [
          { $size: { $setIntersection: ["$occasions", source.occasions] } },
          15,
        ],
      },
      source.fabric
        ? { $cond: [{ $eq: ["$fabric", source.fabric] }, 25, 0] }
        : 0,
      priceScore,
      { $cond: ["$isBestseller", 10, 0] },
      { $cond: ["$isNewArrival", 5, 0] },
      {
        $divide: [
          { $min: [{ $ifNull: ["$merchandisingRank", 0] }, 1_000_000] },
          200_000,
        ],
      },
    ],
  };
}

function relationStrength(candidate, sourceCategory, sourceCollections) {
  const sameCategory = candidate.category.toString() === sourceCategory;
  const sharedCollections = (candidate.collections ?? []).reduce(
    (count, collectionId) =>
      count + (sourceCollections.has(collectionId.toString()) ? 1 : 0),
    0,
  );
  return (sameCategory ? 100 : 0) + sharedCollections * 35;
}

function mergeRelatedPools(source, pools) {
  const sourceCategory = source.category.toString();
  const sourceCollections = new Set(
    (source.collections ?? []).map((collectionId) => collectionId.toString()),
  );
  const candidatesById = new Map();

  for (const pool of pools) {
    for (const candidate of pool) {
      candidatesById.set(candidate._id.toString(), candidate);
    }
  }

  return [...candidatesById.values()].sort((left, right) => {
    const relationDifference =
      relationStrength(right, sourceCategory, sourceCollections) -
      relationStrength(left, sourceCategory, sourceCollections);
    if (relationDifference) return relationDifference;

    const merchandisingDifference =
      (right.merchandisingRank ?? 0) - (left.merchandisingRank ?? 0);
    if (merchandisingDifference) return merchandisingDifference;

    const createdDifference =
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    if (createdDifference) return createdDifference;

    return left._id.toString().localeCompare(right._id.toString());
  });
}

function relatedCandidateConstraint(
  source,
  publicConstraint,
  additionalExcludedIds = [],
) {
  return {
    _id: { $nin: [source._id, ...additionalExcludedIds] },
    status: ProductStatus.PUBLISHED,
    ...publicConstraint,
  };
}

async function shortlistRelatedCandidates(source, publicConstraint) {
  const projection = "_id category collections merchandisingRank createdAt";
  const baseConstraint = relatedCandidateConstraint(source, publicConstraint);
  const deterministicNewest = { createdAt: -1, _id: -1 };

  const categoryPoolQuery = Product.find({
    ...baseConstraint,
    category: source.category,
  })
    .select(projection)
    .sort(deterministicNewest)
    .limit(RELATED_CANDIDATE_LIMIT)
    .lean();
  const collectionPoolQuery = source.collections?.length
    ? Product.find({
        ...baseConstraint,
        $and: [{ collections: { $in: source.collections } }],
      })
        .select(projection)
        .sort(deterministicNewest)
        .limit(RELATED_CANDIDATE_LIMIT)
        .lean()
    : Promise.resolve([]);

  const relationPools = await Promise.all([
    categoryPoolQuery,
    collectionPoolQuery,
  ]);
  const shortlisted = mergeRelatedPools(source, relationPools).slice(
    0,
    RELATED_CANDIDATE_LIMIT,
  );

  if (shortlisted.length < RELATED_CANDIDATE_LIMIT) {
    const selectedIds = shortlisted.map((candidate) => candidate._id);
    const fallback = await Product.find(
      relatedCandidateConstraint(source, publicConstraint, selectedIds),
    )
      .select("_id")
      .sort({ merchandisingRank: -1, createdAt: -1, _id: -1 })
      .limit(RELATED_CANDIDATE_LIMIT - shortlisted.length)
      .lean();
    shortlisted.push(...fallback);
  }

  return shortlisted.map((candidate) => candidate._id);
}

async function listRelated(slug, limit = 4) {
  const publicConstraint = await publicRelationConstraint();
  const source = await Product.findOne({
    slug,
    status: ProductStatus.PUBLISHED,
    ...publicConstraint,
  }).lean();
  if (!source) throw AppError.notFound("Product");

  const shortlistedIds = await shortlistRelatedCandidates(
    source,
    publicConstraint,
  );
  const rankedIds = (
    await Product.aggregate([
      {
        $match: {
          _id: { $in: shortlistedIds },
          status: ProductStatus.PUBLISHED,
          ...publicConstraint,
        },
      },
      {
        $set: {
          _recommendationScore: recommendationScoreExpression(source),
          _priceDifference: {
            $abs: {
              $subtract: ["$basePricePaise", source.basePricePaise],
            },
          },
        },
      },
      {
        $sort: {
          _recommendationScore: -1,
          _priceDifference: 1,
          merchandisingRank: -1,
          createdAt: -1,
          _id: 1,
        },
      },
      { $limit: Math.min(limit, RELATED_CANDIDATE_LIMIT) },
      { $project: { _id: 1 } },
    ])
  ).map((candidate) => candidate._id.toString());

  const candidates = await Product.find({
    _id: { $in: rankedIds },
    status: ProductStatus.PUBLISHED,
    ...publicConstraint,
  })
    .populate("category", "name slug customization sizeGuide __v")
    .lean();
  const candidatesById = new Map(
    candidates.map((candidate) => [candidate._id.toString(), candidate]),
  );

  return rankedIds
    .map((id) => candidatesById.get(id))
    .filter(Boolean)
    .map(publicSummary);
}

export const recommendationService = Object.freeze({ listRelated });
