import { v2 as cloudinary } from "cloudinary";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudinaryProvider } from "../../../src/services/media/cloudinary.adapter.js";

afterEach(() => vi.restoreAllMocks());

describe("Cloudinary upload preset contract", () => {
  it("accepts only a signed preset with the exact provider byte and format policy", async () => {
    const lookup = vi.spyOn(cloudinary.api, "upload_preset").mockResolvedValue({
      unsigned: false,
      settings: {
        max_file_size: 5 * 1024 * 1024,
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
      },
    });

    await expect(
      cloudinaryProvider.assertUploadPreset("safe-image-preset", {
        maxBytes: 5 * 1024 * 1024,
        formats: ["jpg", "jpeg", "png", "webp"],
      }),
    ).resolves.toBeUndefined();
    expect(lookup).toHaveBeenCalledWith("safe-image-preset");
  });

  it.each([
    [
      "an unsigned preset",
      {
        unsigned: true,
        settings: {
          max_file_size: 5 * 1024 * 1024,
          allowed_formats: ["jpg", "jpeg", "png", "webp"],
        },
      },
    ],
    [
      "a larger provider byte ceiling",
      {
        unsigned: false,
        settings: {
          max_file_size: 6 * 1024 * 1024,
          allowed_formats: ["jpg", "jpeg", "png", "webp"],
        },
      },
    ],
    [
      "a broader provider format allow-list",
      {
        unsigned: false,
        settings: {
          max_file_size: 5 * 1024 * 1024,
          allowed_formats: ["jpg", "jpeg", "png", "webp", "svg"],
        },
      },
    ],
  ])("rejects %s", async (_description, preset) => {
    vi.spyOn(cloudinary.api, "upload_preset").mockResolvedValue(preset);

    await expect(
      cloudinaryProvider.assertUploadPreset(`unsafe-${Math.random()}`, {
        maxBytes: 5 * 1024 * 1024,
        formats: ["jpg", "jpeg", "png", "webp"],
      }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
