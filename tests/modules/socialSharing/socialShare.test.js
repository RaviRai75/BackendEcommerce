import { describe, expect, it } from "vitest";
import { renderProductShareHtml } from "../../../src/modules/socialSharing/socialShare.service.js";

describe("product social-share HTML", () => {
  it("escapes product-authored text and media metadata in every HTML context", () => {
    const html = renderProductShareHtml({
      slug: "safe-product",
      name: '<script>alert("name")</script>',
      description: '\"><img src=x onerror="alert(1)">',
      pricePaise: 149900,
      primaryMedia: {
        type: "IMAGE",
        altText: '<svg onload="alert(2)">',
        delivery: {
          optimizedUrl: 'https://res.cloudinary.com/demo/image/upload/item.jpg?label=\"><script>',
        },
      },
    });

    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<svg onload");
    expect(html).toContain("&lt;script&gt;alert(&quot;name&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;svg onload=&quot;alert(2)&quot;&gt;");
  });
});
