import { SizeGuide } from "../../src/modules/sizeGuides/sizeGuide.model.js";

const SIZE_GUIDES = [
  {
    slug: "kurti-suit-size-chart",
    snapshot: {
      title: "Women's Ethnic Kurti & Suit Size Chart",
      summary: "Standard garment measurements in inches for kurtis, suits, and anarkalis.",
      notes: "Measurements reflect actual garment dimensions. For a relaxed fit, choose one size larger than your body measurements.",
      showOnStandalone: true,
      columns: [
        { key: "bust", label: "Bust (in)" },
        { key: "waist", label: "Waist (in)" },
        { key: "hip", label: "Hip (in)" },
        { key: "length", label: "Kurti Length (in)" },
      ],
      rows: [
        { sizeKey: "xs", label: "XS (34)", cells: ["34", "30", "38", "44"] },
        { sizeKey: "s", label: "Small (36)", cells: ["36", "32", "40", "44"] },
        { sizeKey: "m", label: "Medium (38)", cells: ["38", "34", "42", "45"] },
        { sizeKey: "l", label: "Large (40)", cells: ["40", "36", "44", "45"] },
        { sizeKey: "xl", label: "XL (42)", cells: ["42", "38", "46", "46"] },
        { sizeKey: "xxl", label: "XXL (44)", cells: ["44", "40", "48", "46"] },
      ],
    },
  },
  {
    slug: "saree-blouse-size-chart",
    snapshot: {
      title: "Saree Blouse Tailoring Guide",
      summary: "Standard stitched blouse measurements for pure silk and festive sarees.",
      notes: "All blouses include 2-inch side seam margins for easy alteration at home.",
      showOnStandalone: true,
      columns: [
        { key: "bust", label: "Bust (in)" },
        { key: "underbust", label: "Under Bust (in)" },
        { key: "blouse-length", label: "Blouse Length (in)" },
        { key: "armhole", label: "Armhole (in)" },
      ],
      rows: [
        { sizeKey: "size-32", label: "Size 32", cells: ["32", "27", "14", "15"] },
        { sizeKey: "size-34", label: "Size 34", cells: ["34", "29", "14.5", "15.5"] },
        { sizeKey: "size-36", label: "Size 36", cells: ["36", "31", "15", "16"] },
        { sizeKey: "size-38", label: "Size 38", cells: ["38", "33", "15.5", "16.5"] },
        { sizeKey: "size-40", label: "Size 40", cells: ["40", "35", "16", "17"] },
        { sizeKey: "size-42", label: "Size 42", cells: ["42", "37", "16.5", "17.5"] },
      ],
    },
  },
];

export const sizeGuidesSeeder = {
  name: "sizeGuides",
  kind: "demo",
  description: "Standard ethnic garment size charts and blouse tailoring guides",

  async run() {
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const item of SIZE_GUIDES) {
      const docData = {
        slug: item.slug,
        draft: item.snapshot,
        published: item.snapshot,
        draftRevision: 1,
        publishedRevision: 1,
        draftUpdatedAt: new Date(),
        publishedAt: new Date(),
      };

      const existing = await SizeGuide.findOne({ slug: item.slug });
      if (!existing) {
        await SizeGuide.create(docData);
        created++;
      } else {
        Object.assign(existing, docData);
        await existing.save();
        updated++;
      }
    }

    return { created, updated, unchanged };
  },

  async purge() {
    return { removed: 0 };
  },
};
