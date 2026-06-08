import { QrCode } from './qr-code';
import { DEFAULT_LABEL_GRID, LABEL_FONT } from '@/lib/skus/label-grid';
import { labelItemName, labelRate, labelUnit, type SkuLabelInput } from '@/lib/skus/label';

/**
 * One physical label cell, sized from DEFAULT_LABEL_GRID. Used identically
 * on the SKU detail page (single label preview), the single-print path
 * (one sticker fed), and the bulk sheet (one sticker per @page).
 *
 * Layout: three text rows on the left (item name / rate / unit) and a
 * square QR on the right. Font sizes locked in `LABEL_FONT`. Borders are
 * off by default for print (the sticker cell on the roll is the boundary);
 * we render a light border on-screen so the preview is visible against a
 * white background.
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
        alignItems: 'stretch',
        justifyContent: 'space-between',
        padding: '1mm',
        boxSizing: 'border-box',
        background: 'white',
        color: '#000',
        ...(showBorder ? { border: '0.2mm solid #000' } : {}),
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          flex: 1,
          minWidth: 0,
          paddingRight: '0.5mm',
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
          }}
        >
          {name}
        </div>
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
          alignSelf: 'center',
          flexShrink: 0,
        }}
      >
        <QrCode value={sku.sku_code} size={LABEL_FONT.qrSize} margin={0} />
      </div>
    </div>
  );
}
