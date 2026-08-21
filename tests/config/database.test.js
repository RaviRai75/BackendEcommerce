/**
 * Database layer: connection lifecycle, shared schema conventions and the
 * transaction-capability probe the order flow depends on.
 */
import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  isDatabaseConnected,
  supportsTransactions,
  syncIndexes,
} from '../../src/config/database.js';
import {
  createSchema,
  formatPaise,
  paise,
  paiseToRupees,
  registerModel,
  rupeesToPaise,
  shortText,
} from '../../src/utils/schema.js';
import { useTestDatabase } from '../helpers/database.js';

useTestDatabase();

/** A throwaway model that exercises every convention `createSchema` applies. */
const widgetSchema = createSchema(
  {
    name: shortText({ required: true, max: 40 }),
    pricePaise: paise({ required: true }),
    passwordHash: { type: String },
    internalNote: { type: String },
  },
  { privateFields: ['passwordHash', 'internalNote'] },
);
const Widget = registerModel('TestWidget', widgetSchema);

describe('connection lifecycle', () => {
  it('reports a live connection once connected', () => {
    expect(isDatabaseConnected()).toBe(true);
    expect(mongoose.connection.readyState).toBe(1);
  });

  it('uses the configured database name', () => {
    expect(mongoose.connection.name).toBe('sanchandana_test');
  });

  it('supports transactions, which order creation depends on', async () => {
    await expect(supportsTransactions()).resolves.toBe(true);
  });

  it('builds the indexes declared by registered models', async () => {
    const results = await syncIndexes();

    expect(results.length).toBeGreaterThan(0);
    // Every collection has at least the implicit _id index.
    for (const result of results) expect(result.indexes).toBeGreaterThanOrEqual(1);
  });
});

describe('schema conventions', () => {
  it('adds created and updated timestamps automatically', async () => {
    const widget = await Widget.create({ name: 'Ivory dupatta', pricePaise: 149900 });

    expect(widget.createdAt).toBeInstanceOf(Date);
    expect(widget.updatedAt).toBeInstanceOf(Date);
  });

  it('exposes id and removes _id and __v from JSON output', async () => {
    const widget = await Widget.create({ name: 'Wine saree', pricePaise: 249900 });

    const json = widget.toJSON();

    expect(json.id).toBe(widget._id.toString());
    expect(json).not.toHaveProperty('_id');
    expect(json).not.toHaveProperty('__v');
  });

  it('strips fields declared private, so they cannot leak through a controller', async () => {
    const widget = await Widget.create({
      name: 'Green cotton kurta',
      pricePaise: 99900,
      passwordHash: 'argon2id$should-never-be-serialised',
      internalNote: 'internal margin note',
    });

    const serialised = JSON.stringify(widget);

    expect(serialised).not.toContain('should-never-be-serialised');
    expect(serialised).not.toContain('internal margin note');
    expect(widget.toJSON()).not.toHaveProperty('passwordHash');
  });

  it('rejects a path the schema does not declare, blocking mass assignment', async () => {
    await expect(
      Widget.create({ name: 'Maroon lehenga', pricePaise: 599900, isAdmin: true }),
    ).rejects.toThrow(/isAdmin/);
  });

  it('rejects a fractional money value', async () => {
    await expect(
      Widget.create({ name: 'Beige blouse', pricePaise: 499.5 }),
    ).rejects.toThrow(/whole number of paise/);
  });

  it('rejects a negative money value', async () => {
    await expect(Widget.create({ name: 'Gold border', pricePaise: -1 })).rejects.toThrow(
      /cannot be negative/,
    );
  });
});

describe('money helpers', () => {
  it('converts rupees to integer paise without floating point drift', () => {
    expect(rupeesToPaise(1499)).toBe(149900);
    expect(rupeesToPaise(1499.5)).toBe(149950);
    // 0.1 + 0.2 territory: the classic float failure must not appear here.
    expect(rupeesToPaise(19.99)).toBe(1999);
    expect(rupeesToPaise('2499.99')).toBe(249999);
  });

  it('round-trips a rupee amount', () => {
    expect(paiseToRupees(rupeesToPaise(1234.56))).toBeCloseTo(1234.56, 2);
  });

  it('formats whole rupees in the Indian numbering system without decimals', () => {
    // Intl uses a narrow no-break space in some locales; compare on digits.
    expect(formatPaise(149900).replace(/\s/g, '')).toBe('₹1,499');
    expect(formatPaise(1249900).replace(/\s/g, '')).toBe('₹12,499');
  });

  it('keeps paise when the amount is not a whole rupee', () => {
    expect(formatPaise(149950).replace(/\s/g, '')).toBe('₹1,499.50');
  });
});
