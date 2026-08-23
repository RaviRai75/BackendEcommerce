export function privateNoStore(_req, res, next) {
  res.set("Cache-Control", "private, no-store");
  next();
}
