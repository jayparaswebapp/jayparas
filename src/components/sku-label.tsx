import { QrCode } from './qr-code';
import { DEFAULT_LABEL_GRID, LABEL_FONT } from '@/lib/skus/label-grid';
import { labelItemName, labelRate, labelUnit, type SkuLabelInput } from '@/lib/skus/label';

/**
 * One physical label cell, 25 × 15 mm. Used identically on the SKU detail
 * page (single label preview), the single-print page (one row = 2 copies),
 * and the bulk sheet (rows of 2-up labels).
 *
 * Layout: design name spans the full label width on top; below that, rate
 * and unit stack on the left and a square QR sits on the right. Font sizes
 * locked in `LABEL_FONT`. Borders are off by default for print (the sticker
 * cell on the roll is the boundary); we render a light border on-screen so
 * the preview is visible against a white background.
 */
export function SkuLabel({
  sku,
  showBorder = false,
}: {
  sku: SkuLabelInput;
  showBorder?: boolean;
}) {
  const name = labelItemName(sku);
  const rate = labelRate(sku.price);
  const unit = labelUnit(sku.pack_size);
  return (
    <div
      className="sku-label"
      style={{
        width: DEFAULT_LABEL_GRID.labelWidth,
        height: DEFAULT_LABEL_GRID.labelHeight,
        display: 'flex',
        flexDirection: 'column',
        // Right padding of 3.5 mm shifts the QR ~2 mm leftward from where
        // it sat at 1.5 mm, giving more visible space between the QR and
        // the sticker's right edge. Combined with the 9 mm QR (down from
        // 10 mm) this also leaves the QR ~1 mm clear of the sticker's
        // bottom edge — protects against the bottom row of modules being
        // trimmed by sub-pixel rendering at the sticker boundary.
        padding: '0.5mm 3.5mm 0.5mm 0.5mm',
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
