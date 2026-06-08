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
        padding: '0.5mm',
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
          }}
        >
          <QrCode value={sku.sku_code} size={LABEL_FONT.qrSize} margin={0} />
        </div>
      </div>
    </div>
  );
}
