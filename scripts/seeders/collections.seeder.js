import {
  Collection,
  CollectionStatus,
} from "../../src/modules/collections/collection.model.js";
import { MediaPurpose } from "../../src/modules/media/mediaAsset.model.js";
import { ensureMediaAsset } from "./mediaHelper.js";

const COLLECTIONS = [
  {
    name: "Mysore Heritage Royal Silk",
    slug: "mysore-heritage-royal-silk",
    description: "Centuries of royal Karnataka weaving tradition preserved in liquid-gold Mysore crepe silks, embossed pallus, and authentic kasuti work.",
    featured: true,
    sortOrder: 1,
    status: CollectionStatus.PUBLISHED,
    publishedAt: new Date("2026-01-01"),
    isDemoData: true,
    sourceImage: "https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=1000&auto=format&fit=crop&q=80",
    tag: "coll-mysore-heritage",
    altText: "Mysore Heritage Royal Silk Saree Collection",
    seo: {
      title: "Mysore Heritage Royal Silk Collection | Sanchandana",
      description: "Explore pure Mysore crepe silk sarees with certified zari and traditional heritage motifs.",
    },
  },
  {
    name: "Festive Splendour 2026",
    slug: "festive-splendour-2026",
    description: "Vibrant jewel tones, intricate zari borders, and timeless celebratory wear crafted for festivals and family gatherings.",
    featured: true,
    sortOrder: 2,
    status: CollectionStatus.PUBLISHED,
    publishedAt: new Date("2026-01-01"),
    isDemoData: true,
    sourceImage: "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=1000&auto=format&fit=crop&q=80",
    tag: "coll-festive-splendour",
    altText: "Festive Splendour Ethnic Wear Collection",
    seo: {
      title: "Festive Splendour 2026 Collection | Sanchandana",
      description: "Celebrate the festive season in vibrant silk sarees, anarkalis, and lehengas.",
    },
  },
  {
    name: "Bridal Trousseau Edit",
    slug: "bridal-trousseau-edit",
    description: "Heirloom bridal Kanjeevarams, hand-embroidered velvet lehengas, and antique temple jewellery curated for the modern Indian bride.",
    featured: true,
    sortOrder: 3,
    status: CollectionStatus.PUBLISHED,
    publishedAt: new Date("2026-01-01"),
    isDemoData: true,
    sourceImage: "https://images.unsplash.com/photo-1594552072238-b8a33785b261?w=1000&auto=format&fit=crop&q=80",
    tag: "coll-bridal-trousseau",
    altText: "Bridal Trousseau Edit - Silk Sarees & Lehengas",
    seo: {
      title: "Bridal Trousseau Edit | Sanchandana",
      description: "Curated wedding silks, grand bridal lehengas, and heirloom trousseau pieces.",
    },
  },
  {
    name: "Everyday Handlooms",
    slug: "everyday-handlooms",
    description: "Breezy handspun cottons, natural dyed tussar silks, and lightweight casual kurtis for graceful everyday elegance.",
    featured: false,
    sortOrder: 4,
    status: CollectionStatus.PUBLISHED,
    publishedAt: new Date("2026-01-01"),
    isDemoData: true,
    sourceImage: "https://images.unsplash.com/photo-1609357605129-26f69add5d6e?w=1000&auto=format&fit=crop&q=80",
    tag: "coll-everyday-handlooms",
    altText: "Handloom Cotton and Silk Daily Wear",
    seo: {
      title: "Everyday Handlooms Collection | Sanchandana",
      description: "Handcrafted pure cotton and tussar silk clothing made for all-day comfort.",
    },
  },
];

export const collectionsSeeder = {
  name: "collections",
  kind: "demo",
  description: "Curated editorial collections with high-resolution imagery",

  async run() {
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const item of COLLECTIONS) {
      const media = await ensureMediaAsset({
        sourceUrl: item.sourceImage,
        purpose: MediaPurpose.COLLECTION,
        altText: item.altText,
        tag: item.tag,
      });

      const docData = {
        name: item.name,
        slug: item.slug,
        description: item.description,
        featured: item.featured,
        sortOrder: item.sortOrder,
        status: item.status,
        publishedAt: item.publishedAt,
        isDemoData: item.isDemoData,
        seo: item.seo,
        editorialMedia: media,
      };

      const existing = await Collection.findOne({ slug: item.slug });
      if (!existing) {
        await Collection.create(docData);
        created++;
      } else {
        const differs =
          existing.name !== item.name ||
          existing.featured !== item.featured ||
          existing.sortOrder !== item.sortOrder ||
          !existing.editorialMedia?.url;

        if (differs) {
          Object.assign(existing, docData);
          await existing.save();
          updated++;
        } else {
          unchanged++;
        }
      }
    }

    return { created, updated, unchanged };
  },

  async purge() {
    const result = await Collection.deleteMany({ isDemoData: true });
    return { removed: result.deletedCount };
  },
};
