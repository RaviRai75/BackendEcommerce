import { Category, CategoryStatus } from "../../src/modules/categories/category.model.js";

const CATEGORIES = [
  {
    name: "Pure Silk Sarees",
    slug: "sarees",
    description: "Authentic handwoven Karnataka Mysore silks, Kanjeevaram wedding silks, and traditional Ilkal sarees woven with pure zari.",
    seo: {
      title: "Pure Silk Sarees | Sanchandana Ethnic Wear",
      description: "Discover handcrafted Mysore silks, bridal Kanjeevarams, and heritage handloom sarees with certified silk mark.",
    },
    sortOrder: 1,
    status: CategoryStatus.PUBLISHED,
    publishedAt: new Date("2026-01-01"),
    isDemoData: true,
    customization: {
      existingProductEnabled: true,
      ownDesignEnabled: true,
      optionGroups: [
        {
          key: "blouse-neckline",
          label: "Blouse Neckline Style",
          choices: [
            { key: "sweetheart", label: "Sweetheart Neck" },
            { key: "deep-u", label: "Deep U-Back with Dori" },
            { key: "boat-neck", label: "Classic Boat Neck" },
            { key: "high-collar", label: "Royal High Collar" },
          ],
        },
        {
          key: "sleeve-cut",
          label: "Sleeve Length",
          choices: [
            { key: "elbow-length", label: "Elbow Length with Zari Border" },
            { key: "short-puff", label: "Traditional Puff Sleeves" },
            { key: "sleeveless", label: "Contemporary Sleeveless" },
          ],
        },
      ],
      ageGroups: [{ key: "adult", label: "Adult" }],
      sizes: [{ key: "free-size", label: "Free Size" }],
      measurementFields: [
        { key: "bust", label: "Bust (inches)", unit: "IN", min: 28, max: 54, required: true },
        { key: "waist", label: "Waist (inches)", unit: "IN", min: 22, max: 50, required: true },
        { key: "blouse-length", label: "Blouse Length (inches)", unit: "IN", min: 12, max: 20, required: true },
      ],
      referenceImageLimit: 3,
    },
  },
  {
    name: "Designer Lehengas",
    slug: "lehengas",
    description: "Grand bridal lehengas, festive silk ensembles, and intricately embroidered velvet and raw silk creations.",
    seo: {
      title: "Bridal & Festive Lehengas | Sanchandana",
      description: "Exquisite bridal lehengas with artisanal zardozi, kundan, and thread embroidery for your most special occasions.",
    },
    sortOrder: 2,
    status: CategoryStatus.PUBLISHED,
    publishedAt: new Date("2026-01-01"),
    isDemoData: true,
    customization: {
      existingProductEnabled: true,
      ownDesignEnabled: true,
      optionGroups: [
        {
          key: "latkan-style",
          label: "Waist Latkan / Tassels",
          choices: [
            { key: "heavy-zardozi", label: "Heavy Zardozi Crafted Latkans" },
            { key: "minimal-pearl", label: "Delicate Pearl Tassels" },
          ],
        },
      ],
      ageGroups: [{ key: "adult", label: "Adult" }],
      sizes: [
        { key: "size-s", label: "Small (S)" },
        { key: "size-m", label: "Medium (M)" },
        { key: "size-l", label: "Large (L)" },
        { key: "custom", label: "Custom Stitched" },
      ],
      measurementFields: [
        { key: "lehenga-waist", label: "Waist / Navel (inches)", unit: "IN", min: 24, max: 52, required: true },
        { key: "lehenga-length", label: "Skirt Length (inches)", unit: "IN", min: 36, max: 48, required: true },
        { key: "choli-bust", label: "Choli Bust (inches)", unit: "IN", min: 28, max: 52, required: true },
      ],
      referenceImageLimit: 3,
    },
  },
  {
    name: "Salwar & Suits",
    slug: "salwar-suits",
    description: "Floor-sweeping Anarkalis, straight cut chanderi suits, and festive sharara and palazzo sets.",
    seo: {
      title: "Festive Salwar Suits & Anarkalis | Sanchandana",
      description: "Shop elegant silk and chanderi salwar suits, Anarkali sets, and festive party-wear ensembles.",
    },
    sortOrder: 3,
    status: CategoryStatus.PUBLISHED,
    publishedAt: new Date("2026-01-01"),
    isDemoData: true,
    customization: {
      existingProductEnabled: false,
      ownDesignEnabled: false,
      optionGroups: [],
      ageGroups: [],
      sizes: [],
      measurementFields: [],
      referenceImageLimit: 0,
    },
  },
  {
    name: "Kurtis & Tunics",
    slug: "kurtis",
    description: "Everyday luxury kurtis crafted from breathable handloom cotton, tussar silk, and festive modal satin.",
    seo: {
      title: "Handcrafted Kurtis & Tunics | Sanchandana",
      description: "Comfortable and stylish ethnic kurtis for office, casual festive gatherings, and daily elegance.",
    },
    sortOrder: 4,
    status: CategoryStatus.PUBLISHED,
    publishedAt: new Date("2026-01-01"),
    isDemoData: true,
    customization: {
      existingProductEnabled: false,
      ownDesignEnabled: false,
      optionGroups: [],
      ageGroups: [],
      sizes: [],
      measurementFields: [],
      referenceImageLimit: 0,
    },
  },
  {
    name: "Dupattas & Stoles",
    slug: "dupattas",
    description: "Banarasi silk dupattas, handloom kalamkari stoles, and rich zari-bordered royal drapes.",
    seo: {
      title: "Pure Silk Dupattas & Stoles | Sanchandana",
      description: "Elevate any suit with statement handwoven Banarasi and Mysore silk dupattas.",
    },
    sortOrder: 5,
    status: CategoryStatus.PUBLISHED,
    publishedAt: new Date("2026-01-01"),
    isDemoData: true,
    customization: {
      existingProductEnabled: false,
      ownDesignEnabled: false,
      optionGroups: [],
      ageGroups: [],
      sizes: [],
      measurementFields: [],
      referenceImageLimit: 0,
    },
  },
  {
    name: "Jewellery & Accessories",
    slug: "jewellery",
    description: "Traditional South Indian temple jewellery, antique kemp necklaces, jhumkas, and waist belts (vaddanam).",
    seo: {
      title: "Heritage Temple Jewellery & Jhumkas | Sanchandana",
      description: "Classic 22k gold plated temple jewellery, bridal haar, and kemp stone earrings handcrafted by artisans.",
    },
    sortOrder: 6,
    status: CategoryStatus.PUBLISHED,
    publishedAt: new Date("2026-01-01"),
    isDemoData: true,
    customization: {
      existingProductEnabled: false,
      ownDesignEnabled: false,
      optionGroups: [],
      ageGroups: [],
      sizes: [],
      measurementFields: [],
      referenceImageLimit: 0,
    },
  },
];

export const categoriesSeeder = {
  name: "categories",
  kind: "demo",
  description: "Core ethnic fashion categories with customization definitions",

  async run() {
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const item of CATEGORIES) {
      const existing = await Category.findOne({ slug: item.slug });
      if (!existing) {
        await Category.create(item);
        created++;
      } else {
        const differs =
          existing.name !== item.name ||
          existing.status !== item.status ||
          existing.sortOrder !== item.sortOrder;

        if (differs) {
          Object.assign(existing, item);
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
    const result = await Category.deleteMany({ isDemoData: true });
    return { removed: result.deletedCount };
  },
};
