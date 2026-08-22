import { createSchema, registerModel, shortText } from "../../utils/schema.js";
import { ContentPageKey, editorialSnapshotSchema } from "./contentPage.model.js";

const schema = createSchema(
  {
    key: { type: String, required: true, enum: Object.values(ContentPageKey), immutable: true },
    revision: { type: Number, required: true, min: 1, immutable: true },
    hash: shortText({ required: true, max: 64, immutable: true }),
    snapshot: { type: editorialSnapshotSchema, required: true, immutable: true },
    publishedAt: { type: Date, required: true, immutable: true },
  },
  { collection: "contentPageRevisions" },
);
schema.index({ key: 1, revision: 1 }, { unique: true });
schema.index({ key: 1, hash: 1 });
function immutable() { throw new Error("Content publication revisions are immutable."); }
for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"]) schema.pre(operation, immutable);
schema.pre("save", function preventExisting() { if (!this.isNew) immutable(); });
export const ContentPageRevision = registerModel("ContentPageRevision", schema);
