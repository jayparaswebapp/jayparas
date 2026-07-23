import { QrCode } from './qr-code';
import { DEFAULT_LABEL_GRID, LABEL_FONT } from '@/lib/skus/label-grid';
import { labelItemName, labelRate, labelUnit, type SkuLabelInput } from '@/lib/skus/label';
import { code128Svg, code128SvgNumeric } from '@/lib/skus/code128';

export type LabelCodeType = 'qr' | 'code128';

/**
 * One physical label cell, 25 × 15 mm. Same fixed size used everywhere —
 * SKU detail preview, single-print page, bulk sheet, wherever a sticker is
 * rendered.
 *
 * Two content variants are selectable per print job:
 *
 *  - **QR mode (default)**: the historic layout — design name at top, rate
 *    and unit stacked on the left, a 9 mm QR code on the right. Best for
 *    flat surfaces (rakhi cards, box tops) and 2D-imager scanners.
 *
 *  - **Code128 mode**: design name (secondary), a large per-piece / per-pack
 *    RATE dominates the middle, and a horizontal Code128 barcode spans the
 *    bottom with the human-readable SKU code beneath. Best for wrapped
 *    tubes / curved surfaces and cheap 1D-laser USB scanners, which cannot
 *    read QR at all.
 *
 * Font sizes locked in `LABEL_FONT`. Borders off by default for print (the
 * sticker cell on the roll IS the boundary); a light border renders on
 * screen so the preview is visible against a white background.
 */
export function SkuLabel({
  sku,
  showBorder = false,
  codeType = 'qr',
}: {
  sku: SkuLabelInput;
  showBorder?: boolean;
  codeType?: LabelCodeType;
}) {
  if (codeType === 'code128') {
    return <Code128LabelBody sku={sku} showBorder={showBorder} />;
  }
  return <QrLabelBody sku={sku} showBorder={showBorder} />;
}

function QrLabelBody({ sku, showBorder }: { sku: SkuLabelInput; showBorder: boolean }) {
  const name = labelItemName(sku);
  const rate = labelRate(sku.price);
  const unit = labelUnit(sku.pack_size, sku.rate_unit);
  return (
    <div
      className="sku-label"
      style={{
        width: DEFAULT_LABEL_GRID.labelWidth,
        height: DEFAULT_LABEL_GRID.labelHeight,
        display: 'flex',
        flexDirection: 'column',
        // Padding: 1 mm top / 3.5 mm right / 0.5 mm bottom / 0.5 mm left.
        // The 1 mm top is for tolerance against the TSC printer's upward
        // drift on each row — without it, a 1-2 mm upward shift puts the
        // design name off the top edge of the sticker. The 3.5 mm right
        // gives the QR clear gutter from the sticker's right edge. Bottom
        // stays at 0.5 mm because the QR is top-aligned within the bottom
        // row (alignSelf below), so its bottom edge sits ~1 mm above the
        // sticker's bottom regardless of this value.
        padding: '1mm 3.5mm 0.5mm 0.5mm',
        boxSizing: 'border-box',
        background: 'white',
        color: '#000',
        ...(showBorder ? { border: '0.2mm solid #000' } : {}),
      }}
    >
      <div
        style={{
          fontSize: `${LABEL_FONT.name.sizePt}pt`,
          fontWeight: LABEL_FONT.name.weight,
          lineHeight: 1.05,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          width: '100%',
        }}
      >
        {name}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flex: 1,
          minHeight: 0,
          marginTop: '0.5mm',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            flex: 1,
            minWidth: 0,
            paddingRight: '0.5mm',
            gap: '0.3mm',
          }}
        >
          <div
            style={{
              fontSize: `${LABEL_FONT.rate.sizePt}pt`,
              fontWeight: LABEL_FONT.rate.weight,
              lineHeight: 1.05,
            }}
          >
            {rate}
          </div>
          <div
            style={{
              fontSize: `${LABEL_FONT.unit.sizePt}pt`,
              fontWeight: LABEL_FONT.unit.weight,
              lineHeight: 1.05,
            }}
          >
            {unit}
          </div>
        </div>
        <div
          style={{
            width: LABEL_FONT.qrSize,
            height: LABEL_FONT.qrSize,
            flexShrink: 0,
            // Top-align JUST the QR (the rate+unit column stays centered
            // via the row's alignItems: 'center'). Lifting the QR to the
            // top of the bottom row puts its bottom edge ~1.6 mm above
            // the sticker's bottom edge instead of ~1 mm — enough buffer
            // that sub-pixel print rendering and minor printer drift
            // don't trim the bottom row of QR modules.
            alignSelf: 'flex-start',
          }}
        >
          <QrCode value={sku.sku_code} size={LABEL_FONT.qrSize} margin={2} />
        </div>
      </div>
    </div>
  );
}

/**
 * Code128 variant. Same 25 × 15 mm sticker; different vertical stack:
 *
 *   [ Design name  — small, secondary                    ]
 *   [ ₹RATE/- ── large, dominant ── 1 Doz  — small qualifier ]
 *   [ ▊▍▊▊▍▊▍▍▊▊▍▍▊▍▊▊▊ ── Code128 barcode ── height 3.5 mm ]
 *   [ SKU-CODE — 5 pt monospace, human-readable            ]
 *
 * The rate is the biggest thing on the sticker so staff and customers
 * clock the price first. The barcode + human-readable code together take
 * the bottom third — enough for a scanner AND for manual keying if a
 * scan ever fails.
 */
function Code128LabelBody({ sku, showBorder }: { sku: SkuLabelInput; showBorder: boolean }) {
  const name = labelItemName(sku);
  const rate = labelRate(sku.price);
  const unit = labelUnit(sku.pack_size, sku.rate_unit);
  const shortCode = sku.short_code;
  const useShort =
    typeof shortCode === 'number' && Number.isInteger(shortCode) && shortCode > 0 && shortCode <= 9999;

  // Set C at a FIXED 0.25 mm per module (= exactly 2 dots on a 203 dpi
  // thermal head, and the ISO/GS1 minimum). 4 digits => 77 modules incl.
  // quiet zones => 19.25 mm, which fits the 22.8 mm box with margin to
  // spare. Fixing the width rather than stretching to 100% is the whole
  // point: a non-integer dots-per-module ratio is what made the old
  // barcode unreadable on 1D laser guns.
  const barcodeSvg = useShort
    ? code128SvgNumeric(String(shortCode).padStart(4, '0'), { quietModules: 10 })
    : code128Svg(sku.sku_code, { quietModules: 8 });
  const barcodeWidth = useShort ? '19.25mm' : '100%';
  return (
    <div
      className="sku-label"
      style={{
        width: DEFAULT_LABEL_GRID.labelWidth,
        height: DEFAULT_LABEL_GRID.labelHeight,
        display: 'flex',
        flexDirection: 'column',
        // Slightly tighter padding than QR mode — we need to fit four
        // vertical elements (name, rate row, barcode, code text) inside
        // 15 mm, and the barcode wants ~3.5 mm on its own.
        padding: '1mm 1.2mm 0.5mm 1mm',
        boxSizing: 'border-box',
        background: 'white',
        color: '#000',
        ...(showBorder ? { border: '0.2mm solid #000' } : {}),
      }}
    >
      <div
        style={{
          fontSize: '6.5pt',
          fontWeight: 600,
          lineHeight: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          width: '100%',
          color: '#333',
        }}
      >
        {name}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '1.2mm',
          marginTop: '0.3mm',
          marginBottom: '0.4mm',
        }}
      >
        <div
          style={{
            fontSize: '14pt',
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: '-0.02em',
          }}
        >
          {rate}
        </div>
        <div
          style={{
            fontSize: '6pt',
            fontWeight: 500,
            lineHeight: 1,
            color: '#444',
            letterSpacing: '0.02em',
          }}
        >
          {unit}
        </div>
      </div>
      <div
        style={{
          width: barcodeWidth,
          marginLeft: 'auto',
          marginRight: 'auto',
          height: '3.5mm',
          // Give the SVG a tiny vertical margin above the human-readable
          // code so bars don't crowd the text.
          marginTop: 'auto',
        }}
        // The SVG is trusted content (encoded server-side from the SKU
        // code, which is validated by our own RPCs). Setting innerHTML
        // avoids the React <object>/<img> route which pixel-snaps in
        // Chromium and can blur bar edges.
        dangerouslySetInnerHTML={{ __html: barcodeSvg }}
      />
      <div
        style={{
          fontFamily:
            'ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, monospace',
          fontSize: '5pt',
          letterSpacing: '0.05em',
          textAlign: 'center',
          marginTop: '0.2mm',
          lineHeight: 1,
        }}
      >
        {sku.sku_code}
      </div>
    </div>
  );
}
