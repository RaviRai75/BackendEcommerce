import {
  Product,
  ProductStatus,
  ProductVariantStatus,
} from "../../src/modules/products/product.model.js";
import { Category } from "../../src/modules/categories/category.model.js";
import { Collection } from "../../src/modules/collections/collection.model.js";
import { SizeGuide } from "../../src/modules/sizeGuides/sizeGuide.model.js";
import { MediaPurpose } from "../../src/modules/media/mediaAsset.model.js";
import { CustomizationMode } from "../../src/modules/customization/customizationConfig.js";
import { SizeGuideMode } from "../../src/modules/sizeGuides/sizeGuide.model.js";
import { ensureMediaAsset } from "./mediaHelper.js";

const PRODUCTS_DATA = [
  {
    name: "Kanjeevaram Pure Silk Bridal Saree (Crimson Red & Gold Zari)",
    slug: "kanjeevaram-pure-silk-bridal-saree-crimson-red",
    categorySlug: "sarees",
    collectionSlugs: ["bridal-trousseau-edit", "festive-splendour-2026"],
    basePricePaise: 1899900,
    compareAtPricePaise: 2499900,
    fabric: "pure mulberry silk",
    occasions: ["bridal", "wedding", "festive"],
    careInstructions: "Strictly dry clean only. Wrap in unbleached muslin cloth and store in a cool, dry cedar wardrobe. Refold every three months.",
    madeIn: "Karnataka, India",
    tags: ["kanjeevaram", "bridal", "pure silk", "gold zari"],
    shortDescription: "An opulent crimson red pure Kanjeevaram silk saree adorned with intricate pure zari floral jaal and a majestic temple border.",
    description: "Handcrafted across 28 days by master weavers, this crimson red Kanjeevaram saree represents the pinnacle of South Indian bridal artistry. Woven from 100% certified pure mulberry silk with tested gold-dipped silver zari, it features traditional peacock and chakra motifs cascading across the rich pallu.",
    isNewArrival: false,
    isBestseller: true,
    exchangeEligible: true,
    merchandisingRank: 100,
    seo: {
      title: "Crimson Red Kanjeevaram Bridal Silk Saree | Sanchandana",
      description: "Pure Kanjeevaram bridal silk saree in crimson red and gold zari. Certified Silk Mark with matching unstitched blouse piece.",
    },
    images: [
      {
        url: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-kanjeevaram-red-primary",
        altText: "Crimson Red Kanjeevaram Pure Silk Bridal Saree Front View",
      },
      {
        url: "https://images.unsplash.com/photo-1607083206869-4c7672e72a8a?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-kanjeevaram-red-detail",
        altText: "Gold Zari Floral Pallu Detail - Kanjeevaram Silk",
      },
    ],
    variants: [
      {
        sku: "SAN-KANJ-RED-FS",
        size: "FREE-SIZE",
        colour: "crimson red",
        stock: 12,
        lowStockThreshold: 3,
        status: ProductVariantStatus.ACTIVE,
      },
    ],
  },
  {
    name: "Royal Mysore Crepe Silk Saree (Peacock Blue & Antique Gold)",
    slug: "royal-mysore-crepe-silk-saree-peacock-blue",
    categorySlug: "sarees",
    collectionSlugs: ["mysore-heritage-royal-silk", "festive-splendour-2026"],
    basePricePaise: 1249900,
    compareAtPricePaise: 1599900,
    fabric: "pure mysore crepe silk",
    occasions: ["festive", "traditional", "wedding"],
    careInstructions: "Dry clean only. Iron on low heat on the reverse side with a protective press cloth.",
    madeIn: "Karnataka, India",
    tags: ["mysore silk", "crepe silk", "karnataka heritage", "gold zari"],
    shortDescription: "A regal peacock blue Mysore crepe silk saree with certified pure gold zari borders and a lightweight buttery drape.",
    description: "Celebrated for its signature fluid drape and non-creasing sheen, this Mysore crepe silk saree is crafted using pure grade-A Karnataka silk. The rich peacock blue body is framed by a minimalist antique gold zari border, ideal for festive celebrations and heritage ceremonies.",
    isNewArrival: true,
    isBestseller: true,
    exchangeEligible: true,
    merchandisingRank: 95,
    seo: {
      title: "Royal Mysore Crepe Silk Saree - Peacock Blue | Sanchandana",
      description: "Authentic Karnataka Mysore crepe silk saree with tested gold zari and certified Silk Mark authenticity.",
    },
    images: [
      {
        url: "https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-mysore-blue-primary",
        altText: "Royal Mysore Crepe Silk Saree in Peacock Blue with Antique Gold Border",
      },
      {
        url: "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-mysore-blue-detail",
        altText: "Close-up Antique Gold Zari Weave on Mysore Crepe Silk",
      },
    ],
    variants: [
      {
        sku: "SAN-MYSORE-BLU-FS",
        size: "FREE-SIZE",
        colour: "peacock blue",
        stock: 18,
        lowStockThreshold: 4,
        status: ProductVariantStatus.ACTIVE,
      },
    ],
  },
  {
    name: "Handcrafted Ilkal Saree with Kasuti Embroidery (Ruby Maroon)",
    slug: "handcrafted-ilkal-saree-kasuti-embroidery-maroon",
    categorySlug: "sarees",
    collectionSlugs: ["everyday-handlooms", "mysore-heritage-royal-silk"],
    basePricePaise: 649900,
    compareAtPricePaise: 849900,
    fabric: "ilkal cotton silk",
    occasions: ["cultural", "festive", "casual"],
    careInstructions: "Gentle hand wash in cold water with mild silk detergent or dry clean.",
    madeIn: "Karnataka, India",
    tags: ["ilkal", "kasuti", "handloom", "north karnataka"],
    shortDescription: "Traditional North Karnataka Ilkal handloom saree featuring red tope teni pallu and intricate hand Kasuti threadwork.",
    description: "An iconic symbol of Bagalkote's weaving culture, this authentic Ilkal saree blends breathable cotton warp with rich silk weft. The contrasting red tope teni pallu is adorned with geometric temple chariot and bird Kasuti embroidery, carrying centuries of folk tradition.",
    isNewArrival: true,
    isBestseller: false,
    exchangeEligible: true,
    merchandisingRank: 85,
    seo: {
      title: "Handcrafted Ilkal Saree with Kasuti Work | Sanchandana",
      description: "Pure handloom Ilkal saree with traditional tope teni pallu and fine hand Kasuti embroidery.",
    },
    images: [
      {
        url: "https://images.unsplash.com/photo-1609357605129-26f69add5d6e?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-ilkal-maroon-primary",
        altText: "Handcrafted Ruby Maroon Ilkal Handloom Saree",
      },
      {
        url: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-ilkal-maroon-detail",
        altText: "Traditional Tope Teni Pallu and Kasuti Motifs",
      },
    ],
    variants: [
      {
        sku: "SAN-ILKAL-MAR-FS",
        size: "FREE-SIZE",
        colour: "ruby maroon",
        stock: 15,
        lowStockThreshold: 3,
        status: ProductVariantStatus.ACTIVE,
      },
    ],
  },
  {
    name: "Banarasi Brocade Silk Saree (Emerald Green & Gold)",
    slug: "banarasi-brocade-silk-saree-emerald-green",
    categorySlug: "sarees",
    collectionSlugs: ["festive-splendour-2026", "bridal-trousseau-edit"],
    basePricePaise: 1499900,
    compareAtPricePaise: 1999900,
    fabric: "banarasi katan silk",
    occasions: ["wedding", "reception", "festive"],
    careInstructions: "Professional dry clean only. Protect zari from direct perfume sprays and moisture.",
    madeIn: "Karnataka, India",
    tags: ["banarasi", "brocade", "emerald", "gold zari"],
    shortDescription: "Majestic emerald green Katan silk saree woven with full body gold brocade kadhwa floral motifs.",
    description: "Immerse yourself in royal splendour with this emerald green Banarasi silk saree. The lustrous Katan silk base is covered in meticulous kadhwa zari weaves that take weeks of loom dedication, creating an heirloom piece that will be cherished across generations.",
    isNewArrival: false,
    isBestseller: true,
    exchangeEligible: true,
    merchandisingRank: 90,
    seo: {
      title: "Emerald Green Banarasi Silk Brocade Saree | Sanchandana",
      description: "Heavy Banarasi katan silk saree in royal emerald green with exquisite gold kadhwa zari weave.",
    },
    images: [
      {
        url: "https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-banarasi-green-primary",
        altText: "Emerald Green Banarasi Brocade Pure Silk Saree",
      },
      {
        url: "https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-banarasi-green-detail",
        altText: "Detailed View of Gold Kadhwa Zari on Emerald Silk",
      },
    ],
    variants: [
      {
        sku: "SAN-BAN-GRN-FS",
        size: "FREE-SIZE",
        colour: "emerald green",
        stock: 10,
        lowStockThreshold: 2,
        status: ProductVariantStatus.ACTIVE,
      },
    ],
  },
  {
    name: "Regal Velvet Embroidered Bridal Lehenga (Deep Wine)",
    slug: "regal-velvet-embroidered-bridal-lehenga-wine",
    categorySlug: "lehengas",
    collectionSlugs: ["bridal-trousseau-edit"],
    basePricePaise: 3499900,
    compareAtPricePaise: 4299900,
    fabric: "micro velvet and raw silk",
    occasions: ["bridal", "wedding reception", "sangeet"],
    careInstructions: "Specialist dry clean only. Steam iron vertically on reverse.",
    madeIn: "Karnataka, India",
    tags: ["bridal lehenga", "velvet", "zardozi", "wine"],
    shortDescription: "A showstopping bridal lehenga in deep wine micro velvet adorned with intricate zardozi, sequins, and kundan hand-embroidery.",
    description: "Crafted for the modern bride seeking royal grandeur, this deep wine velvet lehenga features 16 flared kalis richly hand-embroidered with antique gold zardozi and kundan work. Accompanied by a sweetheart neckline choli and a double sheer dupatta set.",
    isNewArrival: true,
    isBestseller: true,
    exchangeEligible: true,
    merchandisingRank: 98,
    seo: {
      title: "Deep Wine Velvet Bridal Lehenga | Sanchandana",
      description: "Regal bridal lehenga in rich velvet with authentic zardozi embroidery and double dupatta.",
    },
    images: [
      {
        url: "https://images.unsplash.com/photo-1594552072238-b8a33785b261?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-lehenga-wine-primary",
        altText: "Regal Deep Wine Velvet Bridal Lehenga Ensemble",
      },
      {
        url: "https://images.unsplash.com/photo-1594552072238-b8a33785b261?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-lehenga-wine-detail",
        altText: "Exquisite Zardozi and Kundan Embroidery on Velvet Lehenga",
      },
    ],
    variants: [
      {
        sku: "SAN-LEH-WINE-S",
        size: "S",
        colour: "deep wine",
        stock: 5,
        lowStockThreshold: 2,
        status: ProductVariantStatus.ACTIVE,
      },
      {
        sku: "SAN-LEH-WINE-M",
        size: "M",
        colour: "deep wine",
        stock: 8,
        lowStockThreshold: 2,
        status: ProductVariantStatus.ACTIVE,
      },
      {
        sku: "SAN-LEH-WINE-L",
        size: "L",
        colour: "deep wine",
        stock: 6,
        lowStockThreshold: 2,
        status: ProductVariantStatus.ACTIVE,
      },
    ],
  },
  {
    name: "Pastel Mirror Work Silk Lehenga (Dusty Rose Pink)",
    slug: "pastel-mirror-work-silk-lehenga-dusty-rose",
    categorySlug: "lehengas",
    collectionSlugs: ["festive-splendour-2026"],
    basePricePaise: 2199900,
    compareAtPricePaise: 2799900,
    fabric: "pure organza silk",
    occasions: ["sangeet", "mehendi", "festive"],
    careInstructions: "Dry clean only. Keep away from rough surfaces to prevent mirror snagging.",
    madeIn: "Karnataka, India",
    tags: ["pastel lehenga", "mirror work", "organza", "sangeet"],
    shortDescription: "A dreamy dusty rose organza lehenga embellished with real mirror work, pearl tassels, and fine resham threads.",
    description: "Designed for joyous sangeet nights and festive celebrations, this dusty rose lehenga features lightweight pure organza panels shimmering with real glass mirror work. Pair with silver temple jewellery for an unforgettable presence.",
    isNewArrival: true,
    isBestseller: false,
    exchangeEligible: true,
    merchandisingRank: 88,
    seo: {
      title: "Dusty Rose Pastel Mirror Work Lehenga | Sanchandana",
      description: "Pure organza silk festive lehenga with glistening mirror work and lightweight flared skirt.",
    },
    images: [
      {
        url: "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-lehenga-rose-primary",
        altText: "Pastel Mirror Work Silk Lehenga in Dusty Rose",
      },
      {
        url: "https://images.unsplash.com/photo-1594552072238-b8a33785b261?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-lehenga-rose-detail",
        altText: "Detailed Real Mirror Work on Flared Organza Skirt",
      },
    ],
    variants: [
      {
        sku: "SAN-LEH-ROSE-S",
        size: "S",
        colour: "dusty rose",
        stock: 7,
        lowStockThreshold: 2,
        status: ProductVariantStatus.ACTIVE,
      },
      {
        sku: "SAN-LEH-ROSE-M",
        size: "M",
        colour: "dusty rose",
        stock: 9,
        lowStockThreshold: 2,
        status: ProductVariantStatus.ACTIVE,
      },
      {
        sku: "SAN-LEH-ROSE-L",
        size: "L",
        colour: "dusty rose",
        stock: 5,
        lowStockThreshold: 2,
        status: ProductVariantStatus.ACTIVE,
      },
    ],
  },
  {
    name: "Floor-Length Silk Anarkali Suit (Royal Navy Blue)",
    slug: "floor-length-silk-anarkali-suit-navy-blue",
    categorySlug: "salwar-suits",
    collectionSlugs: ["festive-splendour-2026"],
    basePricePaise: 899900,
    compareAtPricePaise: 1199900,
    fabric: "chanderi silk with santoon lining",
    occasions: ["festive", "party", "engagement"],
    careInstructions: "Dry clean only. Store on a padded hanger.",
    madeIn: "Karnataka, India",
    tags: ["anarkali", "silk suit", "navy blue", "festive"],
    shortDescription: "A floor-length royal navy blue Anarkali gown in fine chanderi silk with golden pita zari embroidery on the yoke and cuffs.",
    description: "Flowing with dramatic flare and regal elegance, this navy blue floor-length Anarkali suit is woven in lightweight chanderi silk. The yoke features dense pita zari embroidery, paired with a matching churidar and a sheer organza dupatta.",
    isNewArrival: false,
    isBestseller: true,
    exchangeEligible: true,
    merchandisingRank: 84,
    seo: {
      title: "Royal Navy Blue Silk Anarkali Suit | Sanchandana",
      description: "Floor-sweeping chanderi silk Anarkali suit set with heavy pita zari yoke and organza dupatta.",
    },
    images: [
      {
        url: "https://images.unsplash.com/photo-1594552072238-b8a33785b261?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-anarkali-navy-primary",
        altText: "Royal Navy Blue Floor-Length Silk Anarkali Suit",
      },
      {
        url: "https://images.unsplash.com/photo-1607083206869-4c7672e72a8a?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-anarkali-navy-detail",
        altText: "Gold Pita Zari Hand Embroidery on Anarkali Yoke",
      },
    ],
    variants: [
      {
        sku: "SAN-ANARK-NAV-S",
        size: "S",
        colour: "navy blue",
        stock: 10,
        lowStockThreshold: 2,
        status: ProductVariantStatus.ACTIVE,
      },
      {
        sku: "SAN-ANARK-NAV-M",
        size: "M",
        colour: "navy blue",
        stock: 14,
        lowStockThreshold: 3,
        status: ProductVariantStatus.ACTIVE,
      },
      {
        sku: "SAN-ANARK-NAV-L",
        size: "L",
        colour: "navy blue",
        stock: 12,
        lowStockThreshold: 3,
        status: ProductVariantStatus.ACTIVE,
      },
      {
        sku: "SAN-ANARK-NAV-XL",
        size: "XL",
        colour: "navy blue",
        stock: 8,
        lowStockThreshold: 2,
        status: ProductVariantStatus.ACTIVE,
      },
    ],
  },
  {
    name: "Chanderi Silk Embroidered Salwar Kurta Set (Mustard Yellow)",
    slug: "chanderi-silk-embroidered-salwar-kurta-set-mustard",
    categorySlug: "salwar-suits",
    collectionSlugs: ["festive-splendour-2026", "everyday-handlooms"],
    basePricePaise: 549900,
    compareAtPricePaise: 699900,
    fabric: "handloom chanderi silk",
    occasions: ["haldi", "festive", "puja"],
    careInstructions: "Dry clean recommended. Mild hand wash with cold water.",
    madeIn: "Karnataka, India",
    tags: ["chanderi", "salwar suit", "haldi", "mustard"],
    shortDescription: "A celebratory mustard yellow handloom chanderi silk straight kurta set with scalloped palazzo pants and zari dupatta.",
    description: "Radiate warmth at pre-wedding celebrations and festive pujas in this mustard yellow Chanderi silk suit set. Enhanced with fine pearl edging, gota patti work along the neckline, and paired with comfortably tailored scalloped palazzos.",
    isNewArrival: true,
    isBestseller: false,
    exchangeEligible: true,
    merchandisingRank: 80,
    seo: {
      title: "Mustard Yellow Chanderi Silk Kurta Set | Sanchandana",
      description: "Festive haldi and puja special chanderi silk straight kurta set with palazzo pants.",
    },
    images: [
      {
        url: "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-suit-mustard-primary",
        altText: "Mustard Yellow Chanderi Silk Salwar Kurta Set",
      },
      {
        url: "https://images.unsplash.com/photo-1609357605129-26f69add5d6e?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-suit-mustard-detail",
        altText: "Neckline Gota Patti Work and Scalloped Hem Detail",
      },
    ],
    variants: [
      {
        sku: "SAN-SUIT-MUS-S",
        size: "S",
        colour: "mustard yellow",
        stock: 12,
        lowStockThreshold: 3,
        status: ProductVariantStatus.ACTIVE,
      },
      {
        sku: "SAN-SUIT-MUS-M",
        size: "M",
        colour: "mustard yellow",
        stock: 16,
        lowStockThreshold: 3,
        status: ProductVariantStatus.ACTIVE,
      },
      {
        sku: "SAN-SUIT-MUS-L",
        size: "L",
        colour: "mustard yellow",
        stock: 10,
        lowStockThreshold: 2,
        status: ProductVariantStatus.ACTIVE,
      },
    ],
  },
  {
    name: "Handwoven Tussar Silk Kurti (Burnt Orange & Gold)",
    slug: "handwoven-tussar-silk-kurti-burnt-orange",
    categorySlug: "kurtis",
    collectionSlugs: ["everyday-handlooms"],
    basePricePaise: 329900,
    compareAtPricePaise: 429900,
    fabric: "tussar silk",
    occasions: ["office chic", "casual festive", "gatherings"],
    careInstructions: "Gentle dry clean or hand wash with mild shampoo in cold water. Line dry in shade.",
    madeIn: "Karnataka, India",
    tags: ["tussar silk", "kurti", "handwoven", "burnt orange"],
    shortDescription: "A versatile burnt orange tussar silk straight-cut kurti with subtle kantha stitching and wooden button accents.",
    description: "The rich, textured feel of raw tussar silk gives this burnt orange kurti an air of effortless luxury. Styled with a notched mandarin collar and three-quarter sleeves, it pairs seamlessly with silk trousers or handloom skirts.",
    isNewArrival: true,
    isBestseller: true,
    exchangeEligible: true,
    merchandisingRank: 82,
    seo: {
      title: "Handwoven Burnt Orange Tussar Silk Kurti | Sanchandana",
      description: "Premium pure tussar silk ethnic kurti for workwear and casual celebrations.",
    },
    images: [
      {
        url: "https://images.unsplash.com/photo-1609357605129-26f69add5d6e?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-kurti-orange-primary",
        altText: "Handwoven Tussar Silk Kurti in Burnt Orange",
      },
      {
        url: "https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-kurti-orange-detail",
        altText: "Textured Tussar Weave with Subtle Kantha Stitch Detail",
      },
    ],
    variants: [
      {
        sku: "SAN-KURTI-ORG-S",
        size: "S",
        colour: "burnt orange",
        stock: 15,
        lowStockThreshold: 3,
        status: ProductVariantStatus.ACTIVE,
      },
      {
        sku: "SAN-KURTI-ORG-M",
        size: "M",
        colour: "burnt orange",
        stock: 20,
        lowStockThreshold: 4,
        status: ProductVariantStatus.ACTIVE,
      },
      {
        sku: "SAN-KURTI-ORG-L",
        size: "L",
        colour: "burnt orange",
        stock: 18,
        lowStockThreshold: 3,
        status: ProductVariantStatus.ACTIVE,
      },
      {
        sku: "SAN-KURTI-ORG-XL",
        size: "XL",
        colour: "burnt orange",
        stock: 10,
        lowStockThreshold: 2,
        status: ProductVariantStatus.ACTIVE,
      },
    ],
  },
  {
    name: "Pure Silk Zari Border Festive Dupatta (Magenta Pink)",
    slug: "pure-silk-zari-border-festive-dupatta-magenta",
    categorySlug: "dupattas",
    collectionSlugs: ["festive-splendour-2026"],
    basePricePaise: 299900,
    compareAtPricePaise: 399900,
    fabric: "pure silk",
    occasions: ["festive", "traditional", "wedding"],
    careInstructions: "Dry clean only. Roll carefully around cardboard roll to prevent crease marks on gold zari.",
    madeIn: "Karnataka, India",
    tags: ["dupatta", "pure silk", "magenta", "zari"],
    shortDescription: "A statement 2.5-meter pure silk dupatta in vibrant magenta with 4-inch wide gold zari borders and temple buttis.",
    description: "Transform any simple kurti or suit into celebratory festive attire with this magenta pure silk dupatta. Featuring dense gold zari butta motifs and hand-knotted silk tassels along both ends.",
    isNewArrival: false,
    isBestseller: false,
    exchangeEligible: true,
    merchandisingRank: 75,
    seo: {
      title: "Magenta Pure Silk Festive Dupatta | Sanchandana",
      description: "Pure handloom silk dupatta in rich magenta pink with wide gold zari borders.",
    },
    images: [
      {
        url: "https://images.unsplash.com/photo-1607083206869-4c7672e72a8a?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-dupatta-magenta-primary",
        altText: "Magenta Pink Pure Silk Dupatta with Gold Zari Border",
      },
      {
        url: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-dupatta-magenta-detail",
        altText: "Hand-Knotted Tassels and Pure Gold Zari Weave",
      },
    ],
    variants: [
      {
        sku: "SAN-DUP-MAG-FS",
        size: "FREE-SIZE",
        colour: "magenta pink",
        stock: 25,
        lowStockThreshold: 5,
        status: ProductVariantStatus.ACTIVE,
      },
    ],
  },
  {
    name: "22K Gold-Plated Temple Heritage Choker Necklace Set",
    slug: "22k-gold-plated-temple-heritage-choker-necklace-set",
    categorySlug: "jewellery",
    collectionSlugs: ["bridal-trousseau-edit"],
    basePricePaise: 799900,
    compareAtPricePaise: 999900,
    fabric: "copper alloy with 22k gold matte plating",
    occasions: ["bridal", "wedding", "festive"],
    careInstructions: "Wipe with a soft cotton cloth after every use. Keep away from water, perfumes, and hairsprays.",
    madeIn: "Karnataka, India",
    tags: ["temple jewellery", "choker", "necklace set", "antique gold"],
    shortDescription: "Handcrafted South Indian temple choker necklace set featuring Goddess Lakshmi motifs and matching jhumkas.",
    description: "An authentic tribute to traditional Dravidian temple sculpture, this 22k gold-plated choker set is adorned with ruby-red kemp stones and delicate freshwater pearl cluster hangings. The matching earrings complete a breathtaking bridal look.",
    isNewArrival: true,
    isBestseller: true,
    exchangeEligible: true,
    merchandisingRank: 89,
    seo: {
      title: "22K Gold Plated Temple Choker Set | Sanchandana",
      description: "Authentic temple choker necklace set with ruby kemp stones and matching traditional jhumkas.",
    },
    images: [
      {
        url: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-jewel-choker-primary",
        altText: "22K Gold Plated Temple Heritage Choker Necklace Set",
      },
      {
        url: "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-jewel-choker-detail",
        altText: "Intricate Lakshmi Motif and Ruby Kemp Stone Setting",
      },
    ],
    variants: [
      {
        sku: "SAN-JEW-CHOKER-GLD",
        size: "FREE-SIZE",
        colour: "antique gold",
        stock: 14,
        lowStockThreshold: 3,
        status: ProductVariantStatus.ACTIVE,
      },
    ],
  },
  {
    name: "Antique Kundan & Kemp Stone Jhumkas (Ruby & Pearl)",
    slug: "antique-kundan-kemp-stone-jhumkas-ruby-pearl",
    categorySlug: "jewellery",
    collectionSlugs: ["festive-splendour-2026", "bridal-trousseau-edit"],
    basePricePaise: 249900,
    compareAtPricePaise: 329900,
    fabric: "brass alloy with ruby kemp stones and freshwater pearls",
    occasions: ["traditional", "festive", "puja", "gifting"],
    careInstructions: "Store separately in an airtight zip pouch or velvet box.",
    madeIn: "Karnataka, India",
    tags: ["jhumkas", "kemp stones", "earrings", "temple jewellery"],
    shortDescription: "Graceful dome jhumkas featuring authentic kemp ruby stones, filigree craftsmanship, and tiny pearl drops.",
    description: "Classic South Indian elegance in a timeless silhouette. These bell-shaped jhumkas feature a peacock stud top and a swinging dome adorned with floral ruby kemp stones and dangling micro pearls.",
    isNewArrival: false,
    isBestseller: true,
    exchangeEligible: true,
    merchandisingRank: 86,
    seo: {
      title: "Antique Kundan & Kemp Stone Jhumkas | Sanchandana",
      description: "Handcrafted traditional temple jhumkas with ruby red kemp stones and pearl drops.",
    },
    images: [
      {
        url: "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-jewel-jhumka-primary",
        altText: "Antique Kundan and Kemp Stone Jhumkas with Pearl Drops",
      },
      {
        url: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=1000&auto=format&fit=crop&q=80",
        tag: "prod-jewel-jhumka-detail",
        altText: "Filigree Bell Dome and Fine Hand-set Kemp Stones",
      },
    ],
    variants: [
      {
        sku: "SAN-JEW-JHUMKA-RUB",
        size: "FREE-SIZE",
        colour: "ruby red",
        stock: 30,
        lowStockThreshold: 5,
        status: ProductVariantStatus.ACTIVE,
      },
    ],
  },
];

export const productsSeeder = {
  name: "products",
  kind: "demo",
  description: "Complete catalogue of pure silk sarees, lehengas, suits, kurtis, and temple jewellery",

  async run() {
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    const categories = await Category.find().lean();
    const categoryMap = new Map(categories.map((c) => [c.slug, c._id]));

    const collections = await Collection.find().lean();
    const collectionMap = new Map(collections.map((c) => [c.slug, c._id]));

    for (const item of PRODUCTS_DATA) {
      const categoryId = categoryMap.get(item.categorySlug);
      if (!categoryId) {
        console.warn(`Category "${item.categorySlug}" not found. Skipping product "${item.name}".`);
        continue;
      }

      const collectionIds = (item.collectionSlugs || [])
        .map((slug) => collectionMap.get(slug))
        .filter(Boolean);

      // Upload/ensure media assets
      const mediaList = [];
      for (let i = 0; i < item.images.length; i++) {
        const img = item.images[i];
        const media = await ensureMediaAsset({
          sourceUrl: img.url,
          purpose: MediaPurpose.PRODUCT,
          altText: img.altText,
          tag: img.tag,
        });

        mediaList.push({
          assetId: media.assetId,
          type: media.type,
          url: media.url,
          publicId: media.publicId,
          altText: img.altText,
          position: i,
        });
      }

      const productDoc = {
        name: item.name,
        slug: item.slug,
        shortDescription: item.shortDescription,
        description: item.description,
        category: categoryId,
        collections: collectionIds,
        basePricePaise: item.basePricePaise,
        compareAtPricePaise: item.compareAtPricePaise,
        fabric: item.fabric,
        occasions: item.occasions,
        careInstructions: item.careInstructions,
        madeIn: item.madeIn,
        tags: item.tags,
        seo: item.seo,
        variants: item.variants,
        media: mediaList,
        isNewArrival: item.isNewArrival,
        isBestseller: item.isBestseller,
        exchangeEligible: item.exchangeEligible,
        merchandisingRank: item.merchandisingRank,
        customizationMode: CustomizationMode.INHERIT,
        sizeGuideMode: SizeGuideMode.INHERIT,
        status: ProductStatus.PUBLISHED,
        publishedAt: new Date("2026-01-01"),
        isDemoData: true,
      };

      const existing = await Product.findOne({ slug: item.slug });
      if (!existing) {
        await Product.create(productDoc);
        created++;
      } else {
        const differs =
          existing.name !== item.name ||
          existing.basePricePaise !== item.basePricePaise ||
          existing.media.length !== mediaList.length;

        if (differs) {
          Object.assign(existing, productDoc);
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
    const result = await Product.deleteMany({ isDemoData: true });
    return { removed: result.deletedCount };
  },
};
