import { asyncHandler } from "../../utils/asyncHandler.js";
import { createLogger } from "../../utils/logger.js";
import { sendCreated, sendSuccess } from "../../utils/response.js";
import { productImportService } from "./productImport.service.js";

const log = createLogger("product-csv");

export const previewProductImport = asyncHandler(async (req, res) => {
  sendCreated(res, await productImportService.preview(req.body, req.user));
});

export const getProductImport = asyncHandler(async (req, res) => {
  sendSuccess(res, await productImportService.get(req.params.id, req.user));
});

export const confirmProductImport = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await productImportService.confirm(
      req.params.id,
      req.idempotencyKey,
      req.user,
      req,
    ),
  );
});

function writeWithBackpressure(res, chunk) {
  if (res.write(chunk)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off("drain", onDrain);
      res.off("close", onClose);
      res.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error("CSV export connection closed."));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    res.once("drain", onDrain);
    res.once("close", onClose);
    res.once("error", onError);
  });
}

export const exportProductsCsv = asyncHandler(async (req, res) => {
  const prepared = await productImportService.prepareExport(req.user, req);
  try {
    res.status(200);
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="products-export.csv"',
      "Cache-Control": "private, no-store",
    });
    for await (const chunk of productImportService.exportChunks(prepared)) {
      await writeWithBackpressure(res, chunk);
    }
    res.end();
  } catch (error) {
    if (!res.headersSent) throw error;
    log.error(
      {
        err: error,
        requestId: req.id,
        userId: req.user?.id,
      },
      "product CSV export failed after response headers",
    );
    res.destroy(error);
  } finally {
    await prepared.cursor.close().catch((error) => {
      log.warn(
        { err: error, requestId: req.id },
        "failed to close product export cursor",
      );
    });
    await prepared.session.endSession().catch((error) => {
      log.warn(
        { err: error, requestId: req.id },
        "failed to close product export snapshot",
      );
    });
  }
});
