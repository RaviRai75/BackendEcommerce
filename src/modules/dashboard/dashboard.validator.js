import { z } from "zod";
import { strictObject } from "../../validators/common.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const KOLKATA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function dateParts(value) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function dateOrdinal(value) {
  const { year, month, day } = dateParts(value);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}

function isCalendarDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const { year, month, day } = dateParts(value);
  const date = new Date(dateOrdinal(value));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function dateKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function todayInKolkata() {
  return dateKey(Date.now() + KOLKATA_OFFSET_MS);
}

function addDays(value, amount) {
  return dateKey(dateOrdinal(value) + amount * DAY_MS);
}

const calendarDateSchema = z
  .string()
  .regex(DATE_PATTERN, "Use the YYYY-MM-DD date format.")
  .refine(isCalendarDate, "Provide a valid calendar date.");

export const dashboardQuerySchema = strictObject({
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
  top: z.coerce.number().int().min(1).max(20).default(10),
})
  .superRefine((value, context) => {
    const today = todayInKolkata();
    const to = value.to ?? today;
    const from = value.from ?? addDays(to, -29);

    if (to > today) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "The end date cannot be in the future.",
      });
    }

    if (from > to) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["from"],
        message: "The start date must be on or before the end date.",
      });
      return;
    }

    const inclusiveDays = (dateOrdinal(to) - dateOrdinal(from)) / DAY_MS + 1;
    if (inclusiveDays > 366) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["from"],
        message: "The reporting period cannot exceed 366 days.",
      });
    }
  })
  .transform((value) => {
    const to = value.to ?? todayInKolkata();
    return {
      from: value.from ?? addDays(to, -29),
      to,
      top: value.top,
    };
  });
