import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

/**
 * Vision-based extractor for Indian GST tax invoices. Staff snap a photo of a
 * supplier's printed bill on /purchases/bills/new; this turns the image into
 * structured JSON we can pre-fill the form with. The buyer on every invoice
 * is "PARAS RAKHI" / "JAI PARAS" — we extract the SUPPLIER side of the
 * header plus line items and totals.
 *
 * Implementation note: we send a JSON-schema constraint via output_config.format
 * (Anthropic's structured outputs feature) so the model returns valid JSON, then
 * validate the response against an equivalent Zod schema for type-safe access in
 * the rest of the app. We can't use the SDK's `zodOutputFormat` helper because
 * it targets a newer Zod major than this project ships.
 */
const BillLineSchema = z.object({
  description: z.string(),
  hsn_code: z.string().nullable(),
  qty: z.number(),
  uom: z.string().nullable(),
  rate: z.number(),
  gst_pct: z.number().nullable(),
  discount_pct: z.number().nullable(),
  line_total: z.number().nullable(),
});

const BillSchema = z.object({
  supplier: z.object({
    name: z.string().nullable(),
    gstin: z.string().nullable(),
    state_name: z.string().nullable(),
    state_code: z.string().nullable(),
    address: z.string().nullable(),
  }),
  invoice_number: z.string().nullable(),
  invoice_date: z.string().nullable(),
  lines: z.array(BillLineSchema),
  totals: z.object({
    subtotal: z.number().nullable(),
    cgst: z.number().nullable(),
    sgst: z.number().nullable(),
    igst: z.number().nullable(),
    round_off: z.number().nullable(),
    grand_total: z.number().nullable(),
  }),
});

export type ExtractedBill = z.infer<typeof BillSchema>;

// JSON Schema mirror of BillSchema. Anthropic structured outputs require
// additionalProperties:false on every object and every property in `required`.
// Nullable fields use the union form ["type", "null"].
const BILL_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['supplier', 'invoice_number', 'invoice_date', 'lines', 'totals'],
  properties: {
    supplier: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'gstin', 'state_name', 'state_code', 'address'],
      properties: {
        name: { type: ['string', 'null'] },
        gstin: { type: ['string', 'null'] },
        state_name: { type: ['string', 'null'] },
        state_code: { type: ['string', 'null'] },
        address: { type: ['string', 'null'] },
      },
    },
    invoice_number: { type: ['string', 'null'] },
    invoice_date: { type: ['string', 'null'] },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'description',
          'hsn_code',
          'qty',
          'uom',
          'rate',
          'gst_pct',
          'discount_pct',
          'line_total',
        ],
        properties: {
          description: { type: 'string' },
          hsn_code: { type: ['string', 'null'] },
          qty: { type: 'number' },
          uom: { type: ['string', 'null'] },
          rate: { type: 'number' },
          gst_pct: { type: ['number', 'null'] },
          discount_pct: { type: ['number', 'null'] },
          line_total: { type: ['number', 'null'] },
        },
      },
    },
    totals: {
      type: 'object',
      additionalProperties: false,
      required: ['subtotal', 'cgst', 'sgst', 'igst', 'round_off', 'grand_total'],
      properties: {
        subtotal: { type: ['number', 'null'] },
        cgst: { type: ['number', 'null'] },
        sgst: { type: ['number', 'null'] },
        igst: { type: ['number', 'null'] },
        round_off: { type: ['number', 'null'] },
        grand_total: { type: ['number', 'null'] },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You extract data from Indian GST tax invoices for the buyer's bookkeeping. The buyer is always "PARAS RAKHI" / "JAI PARAS"; you are extracting the SUPPLIER side of the header.

Rules:
- Dates: return as YYYY-MM-DD ("2-Jun-26" -> "2026-06-02", "15/03/2025" -> "2025-03-15").
- Numbers: plain JS numbers, no currency symbol, no commas ("₹2,977.00" -> 2977.00).
- GSTIN: the 15-character alphanumeric supplier code (e.g. "27ALYPM8357P1ZT"). Pull from the SUPPLIER block, not the buyer's.
- state_code: 2-digit code (e.g. "27" for Maharashtra). state_name: full name (e.g. "Maharashtra").
- Inter-state invoice (IGST line shown): cgst = 0, sgst = 0, igst = printed amount.
- Intra-state invoice (CGST + SGST lines shown): cgst and sgst as printed, igst = 0.
- gst_pct on each line: the combined GST rate as a whole number (5, 12, 18, 28). For IGST-only invoices this is the IGST rate.
- line_total: per-line amount BEFORE GST, i.e. (qty x rate) less any discount.
- round_off: usually 0 or a small value like 0.25 / -0.30.
- If a field is not visible or doesn't apply, use null. Do NOT invent zeros.
- description: join multi-line item text with a single space; preserve everything (size code, packing, etc.).`;

/**
 * Returns the parsed bill object. Throws on missing API key or parser failure
 * — the server action handles error mapping for the UI.
 */
export async function extractBillFromImage(
  base64Image: string,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp',
): Promise<ExtractedBill> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }
  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    output_config: {
      format: {
        type: 'json_schema',
        schema: BILL_JSON_SCHEMA,
      },
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64Image },
          },
          {
            type: 'text',
            text: 'Extract every field from this tax invoice. Be precise — the numbers feed straight into our accounting.',
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Vision API returned no text content');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(textBlock.text);
  } catch {
    throw new Error('Vision API returned non-JSON content');
  }
  return BillSchema.parse(raw);
}
