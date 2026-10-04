import { createHash } from "node:crypto";
import {
  BusinessProfile,
  BUSINESS_PROFILE_KEY,
} from "../../src/modules/content/businessProfile.model.js";
import {
  ContentPage,
  ContentPageKey,
} from "../../src/modules/content/contentPage.model.js";
import { ContentPageRevision } from "../../src/modules/content/contentPageRevision.model.js";

function plainSnapshot(snapshot) {
  if (!snapshot) return null;
  return typeof snapshot.toObject === "function"
    ? snapshot.toObject({ depopulate: true })
    : snapshot;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function snapshotHash(snapshot) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(plainSnapshot(snapshot))))
    .digest("hex");
}

const PROFILE_DATA = {
  displayName: "Sanchandana Silk & Ethnic Elegance",
  legalName: "Sanchandana Silks Retail Private Limited",
  supportEmail: "support@sanchandana.com",
  supportPhone: "9876543210",
  whatsappNumber: "+919876543210",
  instagramUrl: "https://www.instagram.com/sanchandana_silks",
  postalAddress: {
    addressLine1: "108 Commercial Street, Near Shivaji Nagar",
    addressLine2: "1st Floor, Heritage Silk Arcade",
    city: "Bengaluru",
    district: "Bengaluru Urban",
    state: "Karnataka",
    pincode: "560001",
  },
  supportHours: "Monday to Saturday: 10:00 AM – 7:30 PM IST",
};

const PAGES = [
  {
    key: ContentPageKey.ABOUT,
    slug: "about",
    title: "About Sanchandana",
    summary: "Heritage weaving tradition, certified purity, and contemporary ethnic sophistication from Karnataka.",
    sections: [
      {
        heading: "Our Weaving Heritage",
        paragraphs: [
          "Founded with a devotion to preserving South Indian loom craftsmanship, Sanchandana bridges centuries of artisanal heritage with contemporary ethnic elegance. Every saree, lehenga, and ensemble in our collection is curated with reverence for the master weavers of Karnataka, Tamil Nadu, and beyond.",
        ],
        bullets: [
          "Authentic Silk Mark certified pure Mysore silks and Kanjeevarams",
          "Direct partnerships with master weaver clusters in Bagalkote, Ilkal, and Kanchipuram",
          "Ethical craftsmanship supporting traditional artisan families",
        ],
      },
    ],
  },
  {
    key: ContentPageKey.CONTACT,
    slug: "contact",
    title: "Contact Us",
    summary: "We are here to assist you with inquiries, custom tailoring consultations, and orders.",
    sections: [
      {
        heading: "Get In Touch",
        paragraphs: [
          "Whether you need assistance choosing the perfect bridal ensemble, tracking your delivery, or inquiring about custom embroidery, our customer care team is available to assist you.",
        ],
        bullets: [
          "Email: support@sanchandana.com",
          "Phone: +91 98765 43210 (Mon–Sat, 10 AM – 7:30 PM IST)",
          "Boutique Address: 108 Commercial Street, Bengaluru, Karnataka 560001",
        ],
      },
    ],
  },
  {
    key: ContentPageKey.FAQ,
    slug: "faq",
    title: "Frequently Asked Questions",
    summary: "Quick answers about ordering, shipping, customization, and care.",
    sections: [
      {
        heading: "Orders & Shipping",
        paragraphs: [
          "We offer express shipping across all Karnataka districts and insured doorstep delivery across India.",
        ],
        bullets: [
          "Free standard shipping on all prepaid orders above Rs 1,999",
          "Orders are dispatched within 24 to 48 business hours with live tracking",
          "Cash on Delivery is available across all serviceable pincodes",
        ],
      },
      {
        heading: "Pure Silk Authenticity",
        paragraphs: [
          "All our Mysore crepe silks and Kanjeevaram wedding sarees come with genuine Silk Mark certification verifying 100% pure natural silk and tested zari.",
        ],
        bullets: [],
      },
    ],
  },
  {
    key: ContentPageKey.HELP_CENTER,
    slug: "help",
    title: "Help Center",
    summary: "Everything you need to know about our services, orders, and customer support.",
    sections: [
      {
        heading: "Customer Assistance",
        paragraphs: [
          "Browse our self-service tools to track your order, submit an exchange request, or connect directly with our style concierge.",
        ],
        bullets: [
          "Track existing orders directly from your account page",
          "7-day easy exchange window for sizing and fit adjustments",
          "Dedicated bridal consultation via WhatsApp or phone",
        ],
      },
    ],
  },
  {
    key: ContentPageKey.CUSTOMIZATION_POLICY,
    slug: "customization-policy",
    title: "Customization & Tailoring Policy",
    summary: "Guidelines and terms for custom-stitched blouses, lehenga tailoring, and bespoke creations.",
    sections: [
      {
        heading: "Bespoke & Tailored Ensembles",
        paragraphs: [
          "We take pride in delivering impeccably tailored garments that fit your exact measurements. Our master tailors accommodate neckline styles, sleeve lengths, and waist fits.",
        ],
        bullets: [
          "Customization requires 5 to 7 additional business days before dispatch",
          "All stitched garments include 2-inch interior seam allowances for future adjustments",
          "Customized items are tailored exclusively for you and are eligible for fit alterations",
        ],
      },
    ],
  },
  {
    key: ContentPageKey.PRIVACY,
    slug: "privacy",
    title: "Privacy Policy",
    summary: "How Sanchandana protects your personal information and respects your privacy.",
    sections: [
      {
        heading: "Information Collection & Use",
        paragraphs: [
          "We collect only the personal information essential to process your orders, arrange delivery, and provide customer support. We never sell or rent your data to third parties.",
        ],
        bullets: [
          "Secure SSL 256-bit encryption for all checkout and account data",
          "PCI-DSS compliant payment processing through verified gateways",
          "Right to access or request deletion of your account at any time",
        ],
      },
    ],
  },
  {
    key: ContentPageKey.TERMS,
    slug: "terms",
    title: "Terms of Service",
    summary: "Terms and conditions governing the use of Sanchandana's website and services.",
    sections: [
      {
        heading: "Store Terms",
        paragraphs: [
          "By accessing and placing orders on Sanchandana, you agree to these terms. All prices are listed in Indian Rupees (INR) and are authoritative as computed at checkout.",
        ],
        bullets: [
          "All intellectual property, photographs, and designs are owned by Sanchandana",
          "Product colours may vary slightly due to digital screen calibration and photography lighting",
          "All disputes are subject to the jurisdiction of the courts of Bengaluru, Karnataka",
        ],
      },
    ],
  },
];

export const contentSeeder = {
  name: "content",
  kind: "demo",
  description: "Business profile, published content pages, and publication evidence revisions",

  async run() {
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    // 1. Business Profile
    const existingProfile = await BusinessProfile.findOne({
      key: BUSINESS_PROFILE_KEY,
    });
    const profileDoc = {
      key: BUSINESS_PROFILE_KEY,
      draft: PROFILE_DATA,
      published: PROFILE_DATA,
      draftRevision: 1,
      publishedRevision: 1,
      draftUpdatedAt: new Date("2026-01-01"),
      publishedAt: new Date("2026-01-01"),
    };

    if (!existingProfile) {
      await BusinessProfile.create(profileDoc);
      created++;
    } else {
      Object.assign(existingProfile, profileDoc);
      await existingProfile.save();
      updated++;
    }

    // 2. Content Pages & Revisions
    for (const page of PAGES) {
      const pageSnapshot = {
        title: page.title,
        summary: page.summary,
        sections: page.sections,
      };

      const publishedSnapshot = plainSnapshot(pageSnapshot);
      const hash = snapshotHash(publishedSnapshot);
      const publishedAt = new Date("2026-01-01");

      const doc = {
        key: page.key,
        slug: page.slug,
        draft: pageSnapshot,
        published: pageSnapshot,
        draftRevision: 1,
        publishedRevision: 1,
        draftUpdatedAt: publishedAt,
        publishedAt,
      };

      const existingPage = await ContentPage.findOne({ key: page.key });
      if (!existingPage) {
        await ContentPage.create(doc);
        created++;
      } else {
        Object.assign(existingPage, doc);
        await existingPage.save();
        updated++;
      }

      // Ensure historical policy revision evidence
      const existingRevision = await ContentPageRevision.findOne({
        key: page.key,
        revision: 1,
      });

      if (!existingRevision) {
        await ContentPageRevision.create({
          key: page.key,
          revision: 1,
          hash,
          snapshot: publishedSnapshot,
          publishedAt,
        });
      }
    }

    return { created, updated, unchanged };
  },

  async purge() {
    return { removed: 0 };
  },
};
