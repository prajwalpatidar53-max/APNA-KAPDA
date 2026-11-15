import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { Order } from '../../types';
import {
  type AdminSenderConfig,
  type ShippingLayout,
  deduplicateOrders,
  formatFullAddressLines,
  formatOrderTimestamp,
  formatPdfCurrency,
  getLabelPaymentInfo,
  normalizeIndianPhone,
  validateSenderConfig,
} from './shippingUtils';

export interface PdfFontBundle {
  regularBase64: string;
  boldBase64: string;
}

export interface GeneratedPdfResult {
  doc: jsPDF;
  blob: Blob;
  arrayBuffer: ArrayBuffer;
  filename: string;
  pageCount: number;
  orderCount: number;
}

const PDF_FONT_FAMILY = 'Inter';

function registerPdfFonts(doc: jsPDF, fonts?: PdfFontBundle): string {
  if (fonts?.regularBase64 && fonts?.boldBase64) {
    try {
      doc.addFileToVFS('Inter-Regular.ttf', fonts.regularBase64);
      doc.addFont('Inter-Regular.ttf', PDF_FONT_FAMILY, 'normal');
      doc.addFileToVFS('Inter-Bold.ttf', fonts.boldBase64);
      doc.addFont('Inter-Bold.ttf', PDF_FONT_FAMILY, 'bold');
      doc.setFont(PDF_FONT_FAMILY, 'normal');
      return PDF_FONT_FAMILY;
    } catch (err) {
      console.warn('[APNA KAPDA PDF] Unable to register custom TTF font:', err);
    }
  }
  doc.setFont('helvetica', 'normal');
  return 'helvetica';
}

function safeFileStamp(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}${m}${d}-${hh}${mm}`;
}

export function triggerPdfDownload(blob: Blob, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 1500);
}

export async function generateBulkOrderSheetPdf(
  inputOrders: Order[],
  options: { fonts?: PdfFontBundle; generatedAt?: Date } = {}
): Promise<GeneratedPdfResult> {
  const orders = deduplicateOrders(inputOrders);
  if (orders.length === 0) {
    throw new Error('Select at least one valid order to generate the Bulk Order PDF.');
  }

  const generatedAt = options.generatedAt ?? new Date();
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const fontName = registerPdfFonts(doc, options.fonts);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 12;
  const contentWidth = pageWidth - marginX * 2; // 186mm
  const maxContentY = pageHeight - 17; // leaves clear bottom footer margin

  const totalBatchValue = orders.reduce(
    (sum, o) => sum + Math.round(Number(o.total_inr || 0)),
    0
  );

  const drawMainHeader = (): number => {
    doc.setFont(fontName, 'bold');
    doc.setFontSize(16);
    doc.setTextColor(33, 31, 27);
    doc.text('APNA KAPDA', marginX, 16);

    doc.setFont(fontName, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(154, 103, 70);
    doc.text('BULK ORDER SHEET  •  FULFILLMENT MANIFEST', marginX, 21.5);

    doc.setFont(fontName, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(95, 89, 79);
    doc.text(`Generated: ${formatOrderTimestamp(generatedAt.toISOString())}`, pageWidth - marginX, 14.5, {
      align: 'right',
    });
    doc.setFont(fontName, 'bold');
    doc.setTextColor(33, 31, 27);
    doc.text(
      `Orders: ${orders.length}   •   Batch Value: ${formatPdfCurrency(totalBatchValue)}`,
      pageWidth - marginX,
      20,
      { align: 'right' }
    );

    doc.setDrawColor(214, 194, 168);
    doc.setLineWidth(0.5);
    doc.line(marginX, 25, pageWidth - marginX, 25);
    return 30;
  };

  const drawContinuationHeader = (): number => {
    doc.setFont(fontName, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(33, 31, 27);
    doc.text('APNA KAPDA  •  BULK ORDER SHEET', marginX, 13);

    doc.setFont(fontName, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(129, 123, 112);
    doc.text(formatOrderTimestamp(generatedAt.toISOString()), pageWidth - marginX, 13, {
      align: 'right',
    });

    doc.setDrawColor(229, 223, 211);
    doc.setLineWidth(0.3);
    doc.line(marginX, 16, pageWidth - marginX, 16);
    return 21;
  };

  const drawItemsTableHeader = (yPos: number): number => {
    doc.setFillColor(237, 231, 220);
    doc.setDrawColor(214, 194, 168);
    doc.setLineWidth(0.25);
    doc.rect(marginX, yPos, contentWidth, 6.5, 'FD');

    doc.setFont(fontName, 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(33, 31, 27);
    doc.text('PRODUCT', marginX + 2.5, yPos + 4.3);
    doc.text('SIZE', marginX + 94, yPos + 4.3);
    doc.text('QTY', marginX + 124, yPos + 4.3, { align: 'right' });
    doc.text('UNIT PRICE', marginX + 154, yPos + 4.3, { align: 'right' });
    doc.text('LINE TOTAL', pageWidth - marginX - 2.5, yPos + 4.3, {
      align: 'right',
    });
    return yPos + 6.5;
  };

  let cursorY = drawMainHeader();

  for (let idx = 0; idx < orders.length; idx++) {
    const order = orders[idx];
    const items = order.order_items ?? [];
    const { streetLines, cityStatePin } = formatFullAddressLines(order.shipping_address);

    // Prepare wrapped lines for Customer & Address block
    const leftColWidth = 84;
    const rightColWidth = 90;
    const leftColX = marginX + 3;
    const rightColX = marginX + 93;

    doc.setFontSize(8.5);
    doc.setFont(fontName, 'bold');
    const nameLines = doc.splitTextToSize(
      order.customer_name || 'N/A',
      leftColWidth
    ) as string[];
    doc.setFont(fontName, 'normal');
    doc.setFontSize(8);
    const phoneDisplay =
      normalizeIndianPhone(order.customer_phone) ||
      order.customer_phone ||
      'N/A';
    const phoneLines = doc.splitTextToSize(
      `Phone: ${phoneDisplay}`,
      leftColWidth
    ) as string[];
    const emailLines = order.customer_email
      ? (doc.splitTextToSize(`Email: ${order.customer_email}`, leftColWidth) as string[])
      : [];
    const notesLines = order.notes?.trim()
      ? (doc.splitTextToSize(`Note: ${order.notes.trim()}`, leftColWidth) as string[])
      : [];

    const addressRawLines = [...streetLines, cityStatePin].filter(Boolean);
    const wrappedAddressLines: string[] = [];
    for (const rawLine of addressRawLines) {
      const split = doc.splitTextToSize(rawLine, rightColWidth) as string[];
      wrappedAddressLines.push(...split);
    }
    if (wrappedAddressLines.length === 0) {
      wrappedAddressLines.push('Address missing');
    }

    const lineH = 3.9;
    const leftBlockH =
      5.5 +
      nameLines.length * 4.2 +
      phoneLines.length * lineH +
      emailLines.length * lineH +
      (notesLines.length > 0 ? 1.5 + notesLines.length * lineH : 0) +
      3;
    const rightBlockH = 5.5 + wrappedAddressLines.length * lineH + 3;
    const infoBoxHeight = Math.max(leftBlockH, rightBlockH, 22);

    const headerBannerHeight = 8.5;
    // Estimate minimum height needed to keep order header + info box + table header + first row together
    const minOrderStartHeight = headerBannerHeight + infoBoxHeight + 16;

    if (cursorY + minOrderStartHeight > maxContentY) {
      doc.addPage();
      cursorY = drawContinuationHeader();
    }

    // Order Card Header Strip
    doc.setFillColor(36, 35, 31);
    doc.rect(marginX, cursorY, contentWidth, headerBannerHeight, 'F');

    doc.setFont(fontName, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 253, 248);
    doc.text(
      `#${idx + 1}   ${order.order_number}   •   ${formatOrderTimestamp(order.created_at)}`,
      marginX + 3,
      cursorY + 5.7
    );

    const paymentMethodLabel = order.payment_method === 'cod' ? 'COD' : 'ONLINE';
    const paymentStatusLabel = order.payment_status.replace('_', ' ').toUpperCase();
    const orderStatusLabel = order.order_status.toUpperCase();

    doc.setFont(fontName, 'bold');
    doc.setFontSize(7.5);
    doc.text(
      `${orderStatusLabel}   |   ${paymentMethodLabel} (${paymentStatusLabel})`,
      pageWidth - marginX - 3,
      cursorY + 5.6,
      { align: 'right' }
    );

    cursorY += headerBannerHeight;

    // Customer & Delivery Info Box
    doc.setFillColor(255, 253, 248);
    doc.setDrawColor(214, 194, 168);
    doc.setLineWidth(0.25);
    doc.rect(marginX, cursorY, contentWidth, infoBoxHeight, 'FD');

    // Vertical divider between Customer and Delivery Address
    doc.setDrawColor(229, 223, 211);
    doc.line(marginX + 90, cursorY, marginX + 90, cursorY + infoBoxHeight);

    let yLeft = cursorY + 4.5;
    doc.setFont(fontName, 'bold');
    doc.setFontSize(7);
    doc.setTextColor(154, 103, 70);
    doc.text('CUSTOMER DETAILS', leftColX, yLeft);
    yLeft += 4;

    doc.setFont(fontName, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(33, 31, 27);
    doc.text(nameLines, leftColX, yLeft);
    yLeft += nameLines.length * 4.2;

    doc.setFont(fontName, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(70, 65, 58);
    doc.text(phoneLines, leftColX, yLeft);
    yLeft += phoneLines.length * lineH;

    if (emailLines.length > 0) {
      doc.text(emailLines, leftColX, yLeft);
      yLeft += emailLines.length * lineH;
    }

    if (notesLines.length > 0) {
      yLeft += 1;
      doc.setTextColor(154, 103, 70);
      doc.text(notesLines, leftColX, yLeft);
    }

    let yRight = cursorY + 4.5;
    doc.setFont(fontName, 'bold');
    doc.setFontSize(7);
    doc.setTextColor(154, 103, 70);
    doc.text('COMPLETE DELIVERY ADDRESS', rightColX, yRight);
    yRight += 4;

    doc.setFont(fontName, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(33, 31, 27);
    doc.text(wrappedAddressLines, rightColX, yRight);

    cursorY += infoBoxHeight;

    // Items Table Header
    cursorY = drawItemsTableHeader(cursorY);

    // Item Rows
    for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
      const item = items[itemIdx];
      doc.setFont(fontName, 'normal');
      doc.setFontSize(8);
      const productNameLines = doc.splitTextToSize(
        item.product_name || 'Product',
        86
      ) as string[];
      const rowHeight = Math.max(6.5, productNameLines.length * 3.9 + 2.6);

      if (cursorY + rowHeight > maxContentY) {
        doc.addPage();
        cursorY = drawContinuationHeader();

        doc.setFillColor(245, 242, 235);
        doc.setDrawColor(214, 194, 168);
        doc.rect(marginX, cursorY, contentWidth, 6.5, 'FD');
        doc.setFont(fontName, 'bold');
        doc.setFontSize(8);
        doc.setTextColor(33, 31, 27);
        doc.text(
          `${order.order_number} (Items continued)  —  ${order.customer_name}`,
          marginX + 3,
          cursorY + 4.4
        );
        cursorY += 6.5;
        cursorY = drawItemsTableHeader(cursorY);
      }

      if (itemIdx % 2 === 1) {
        doc.setFillColor(250, 248, 243);
        doc.rect(marginX, cursorY, contentWidth, rowHeight, 'F');
      }
      doc.setDrawColor(229, 223, 211);
      doc.setLineWidth(0.2);
      doc.rect(marginX, cursorY, contentWidth, rowHeight, 'D');

      const textBaselineY = cursorY + 4.3;
      doc.setFont(fontName, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(33, 31, 27);
      doc.text(productNameLines, marginX + 2.5, textBaselineY);

      doc.setFont(fontName, 'bold');
      doc.text(item.selected_size || '-', marginX + 94, textBaselineY);

      doc.setFont(fontName, 'normal');
      doc.text(String(item.quantity), marginX + 124, textBaselineY, {
        align: 'right',
      });
      doc.text(
        formatPdfCurrency(item.unit_price_inr),
        marginX + 154,
        textBaselineY,
        { align: 'right' }
      );

      doc.setFont(fontName, 'bold');
      doc.text(
        formatPdfCurrency(item.unit_price_inr * item.quantity),
        pageWidth - marginX - 2.5,
        textBaselineY,
        { align: 'right' }
      );

      cursorY += rowHeight;
    }

    // Order Totals Footer Box
    const totalsBoxHeight = 14.5;
    if (cursorY + totalsBoxHeight > maxContentY) {
      doc.addPage();
      cursorY = drawContinuationHeader();
    }

    doc.setFillColor(245, 242, 235);
    doc.setDrawColor(214, 194, 168);
    doc.setLineWidth(0.25);
    doc.rect(marginX, cursorY, contentWidth, totalsBoxHeight, 'FD');

    const totalItemQty = items.reduce((s, it) => s + Number(it.quantity || 0), 0);
    doc.setFont(fontName, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(95, 89, 79);
    doc.text(
      `Total Units: ${totalItemQty}   •   Method: ${paymentMethodLabel}   •   Payment: ${paymentStatusLabel}`,
      marginX + 3,
      cursorY + 5.5
    );
    doc.text(
      `Order Status: ${orderStatusLabel}`,
      marginX + 3,
      cursorY + 10.5
    );

    // Subtotal / Shipping / Final Amount on Right
    doc.setFont(fontName, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(70, 65, 58);
    const shippingText =
      Number(order.shipping_inr || 0) === 0
        ? 'Complimentary (₹0)'
        : formatPdfCurrency(order.shipping_inr);
    doc.text(
      `Subtotal: ${formatPdfCurrency(order.subtotal_inr)}   |   Shipping: ${shippingText}`,
      pageWidth - marginX - 3,
      cursorY + 5.2,
      { align: 'right' }
    );

    doc.setFont(fontName, 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(33, 31, 27);
    doc.text(
      `Final Order Amount: ${formatPdfCurrency(order.total_inr)}`,
      pageWidth - marginX - 3,
      cursorY + 11.2,
      { align: 'right' }
    );

    cursorY += totalsBoxHeight + 6.5;
  }

  // Page X of Y Footer across all pages
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(229, 223, 211);
    doc.setLineWidth(0.25);
    doc.line(marginX, pageHeight - 13, pageWidth - marginX, pageHeight - 13);

    doc.setFont(fontName, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(129, 123, 112);
    doc.text(
      'APNA KAPDA — Internal Fulfillment & Dispatch Sheet',
      marginX,
      pageHeight - 8
    );
    doc.setFont(fontName, 'bold');
    doc.text(`Page ${p} of ${pageCount}`, pageWidth - marginX, pageHeight - 8, {
      align: 'right',
    });
  }

  const arrayBuffer = doc.output('arraybuffer');
  const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
  const filename = `APNA-KAPDA-Bulk-Orders-${safeFileStamp(generatedAt)}.pdf`;

  return {
    doc,
    blob,
    arrayBuffer,
    filename,
    pageCount,
    orderCount: orders.length,
  };
}

interface LabelCardGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

async function generateOrderQrDataUrl(orderNumber: string): Promise<string> {
  // QR encodes ONLY the authoritative order reference (no fake tracking/courier metadata)
  return QRCode.toDataURL(orderNumber, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 220,
    color: {
      dark: '#151412',
      light: '#ffffff',
    },
  });
}

function drawShippingLabelCard(
  doc: jsPDF,
  fontName: string,
  order: Order,
  sender: AdminSenderConfig,
  qrDataUrl: string,
  box: LabelCardGeometry
): void {
  const { x, y, w, h } = box;
  const pad = 4;
  const innerW = w - pad * 2;
  const { streetLines, cityStatePin } = formatFullAddressLines(order.shipping_address);
  const paymentInfo = getLabelPaymentInfo(order);
  const items = order.order_items ?? [];
  const totalPieces = items.reduce((s, i) => s + Number(i.quantity || 0), 0);
  const recipientPhone =
    normalizeIndianPhone(order.customer_phone) || order.customer_phone || 'N/A';
  const senderPhone = normalizeIndianPhone(sender.phone) || sender.phone;

  // Label outer border
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(33, 31, 27);
  doc.setLineWidth(0.45);
  doc.rect(x, y, w, h, 'FD');

  // 1. Brand & Order Header Band
  const headerH = 14.5;
  doc.setFillColor(245, 242, 235);
  doc.rect(x, y, w, headerH, 'F');
  doc.setDrawColor(33, 31, 27);
  doc.setLineWidth(0.3);
  doc.line(x, y + headerH, x + w, y + headerH);

  doc.setFont(fontName, 'bold');
  doc.setFontSize(12);
  doc.setTextColor(33, 31, 27);
  doc.text('APNA KAPDA', x + pad, y + 6.2);

  doc.setFont(fontName, 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(129, 123, 112);
  doc.text('DISPATCH SHIPPING LABEL', x + pad, y + 10.6);

  doc.setFont(fontName, 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(33, 31, 27);
  doc.text(order.order_number, x + w - pad, y + 6.2, { align: 'right' });

  doc.setFont(fontName, 'normal');
  doc.setFontSize(7);
  doc.setTextColor(95, 89, 79);
  doc.text(
    `Items: ${totalPieces} pcs  •  ${formatOrderTimestamp(order.created_at).split(',')[0]}`,
    x + w - pad,
    y + 10.8,
    { align: 'right' }
  );

  // 2. Payment Mode & COD Amount Band
  let curY = y + headerH;
  const payBandH = 13.5;

  if (paymentInfo.mode === 'COD') {
    doc.setFillColor(33, 31, 27);
    doc.rect(x, curY, w, payBandH, 'F');
    doc.setTextColor(255, 253, 248);
    doc.setFont(fontName, 'bold');
    doc.setFontSize(11);
    doc.text('COD', x + pad, curY + 6.5);
    doc.setFont(fontName, 'normal');
    doc.setFontSize(6.5);
    doc.text('CASH ON DELIVERY', x + pad, curY + 10.8);

    doc.setFont(fontName, 'bold');
    doc.setFontSize(10.5);
    doc.text(
      `COLLECT: ${formatPdfCurrency(paymentInfo.codCollectAmountInr ?? 0)}`,
      x + w - pad,
      curY + 8.3,
      { align: 'right' }
    );
  } else {
    doc.setFillColor(237, 231, 220);
    doc.rect(x, curY, w, payBandH, 'F');
    doc.setDrawColor(33, 31, 27);
    doc.line(x, curY + payBandH, x + w, curY + payBandH);
    doc.setTextColor(33, 31, 27);
    doc.setFont(fontName, 'bold');
    doc.setFontSize(11);
    doc.text('PREPAID', x + pad, curY + 6.5);
    doc.setFont(fontName, 'normal');
    doc.setFontSize(6.5);
    doc.text(paymentInfo.subLabel, x + pad, curY + 10.8);

    doc.setFont(fontName, 'bold');
    doc.setFontSize(9);
    doc.text(
      `VALUE: ${formatPdfCurrency(order.total_inr)}`,
      x + w - pad,
      curY + 8.1,
      { align: 'right' }
    );
  }

  curY += payBandH + 4;

  // Calculate fixed bottom section heights so recipient address wraps safely without colliding
  const senderAddressLinesRaw = [
    [sender.addressLine1, sender.addressLine2].filter(Boolean).join(', '),
    `${sender.city}, ${sender.state} - ${sender.pincode}`,
  ].filter(Boolean);

  doc.setFont(fontName, 'normal');
  doc.setFontSize(6.8);
  const senderWrapped: string[] = [];
  for (const line of senderAddressLinesRaw) {
    senderWrapped.push(...(doc.splitTextToSize(line, innerW) as string[]));
  }
  const senderBlockH = 9.5 + senderWrapped.length * 3.1 + 2.5;

  const qrSize = 22;
  const qrRowH = qrSize + 7; // QR + order_number caption + divider buffer
  const recipientBottomLimit = y + h - senderBlockH - qrRowH - 2;

  // 3. Deliver To (Recipient)
  doc.setFont(fontName, 'bold');
  doc.setFontSize(6.8);
  doc.setTextColor(154, 103, 70);
  doc.text('DELIVER TO:', x + pad, curY);
  curY += 4.3;

  doc.setFont(fontName, 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(33, 31, 27);
  const custNameLines = doc.splitTextToSize(
    order.customer_name || 'Customer',
    innerW
  ) as string[];
  doc.text(custNameLines, x + pad, curY);
  curY += custNameLines.length * 4.5;

  doc.setFont(fontName, 'bold');
  doc.setFontSize(8.5);
  doc.text(`Ph: ${recipientPhone}`, x + pad, curY);
  curY += 4.4;

  doc.setFont(fontName, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(45, 42, 37);
  const streetWrapped: string[] = [];
  for (const sLine of streetLines) {
    streetWrapped.push(...(doc.splitTextToSize(sLine, innerW) as string[]));
  }
  const cityPinWrapped = doc.splitTextToSize(cityStatePin, innerW) as string[];

  const addrLineStep = 3.7;
  for (const line of streetWrapped) {
    if (curY + addrLineStep > recipientBottomLimit - 5.5) break;
    doc.text(line, x + pad, curY);
    curY += addrLineStep;
  }

  curY += 0.6;
  doc.setFont(fontName, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(33, 31, 27);
  for (const line of cityPinWrapped) {
    if (curY + 3.9 > recipientBottomLimit) break;
    doc.text(line, x + pad, curY);
    curY += 4;
  }

  // 4. QR Code & Parcel Summary Section (anchored above Sender block)
  const qrSectionTop = y + h - senderBlockH - qrRowH;
  doc.setDrawColor(214, 194, 168);
  doc.setLineWidth(0.25);
  doc.line(x + pad, qrSectionTop, x + w - pad, qrSectionTop);

  const qrX = x + w - pad - qrSize;
  const qrY = qrSectionTop + 2.2;
  doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

  doc.setFont(fontName, 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(33, 31, 27);
  doc.text(order.order_number, qrX + qrSize / 2, qrY + qrSize + 3.1, {
    align: 'center',
  });

  const leftSummaryW = innerW - qrSize - 4;
  let sumY = qrSectionTop + 6;
  doc.setFont(fontName, 'bold');
  doc.setFontSize(7);
  doc.setTextColor(154, 103, 70);
  doc.text('ORDER REFERENCE', x + pad, sumY);
  sumY += 4;

  doc.setFont(fontName, 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(33, 31, 27);
  doc.text(order.order_number, x + pad, sumY);
  sumY += 4.3;

  doc.setFont(fontName, 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(70, 65, 58);
  const itemSummaryText = items
    .map((it) => `${it.product_name} (${it.selected_size}×${it.quantity})`)
    .join(', ');
  const wrappedSummary = (
    doc.splitTextToSize(itemSummaryText || `${totalPieces} item(s)`, leftSummaryW) as string[]
  ).slice(0, 3);
  doc.text(wrappedSummary, x + pad, sumY);

  // 5. Sender / Return Address Footer
  const senderTop = y + h - senderBlockH;
  doc.setFillColor(250, 248, 243);
  doc.rect(x + 0.25, senderTop, w - 0.5, senderBlockH - 0.25, 'F');
  doc.setDrawColor(214, 194, 168);
  doc.line(x, senderTop, x + w, senderTop);

  let sY = senderTop + 3.8;
  doc.setFont(fontName, 'bold');
  doc.setFontSize(6.3);
  doc.setTextColor(154, 103, 70);
  doc.text('FROM / RETURN ADDRESS:', x + pad, sY);
  sY += 3.5;

  doc.setFont(fontName, 'bold');
  doc.setFontSize(7.4);
  doc.setTextColor(33, 31, 27);
  doc.text(
    `${sender.senderName}  •  Ph: ${senderPhone}`,
    x + pad,
    sY
  );
  sY += 3.4;

  doc.setFont(fontName, 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(70, 65, 58);
  doc.text(senderWrapped, x + pad, sY);
}

export async function generateShippingLabelsPdf(
  inputOrders: Order[],
  senderConfig: AdminSenderConfig,
  layout: ShippingLayout,
  options: { fonts?: PdfFontBundle; generatedAt?: Date } = {}
): Promise<GeneratedPdfResult> {
  const orders = deduplicateOrders(inputOrders);
  if (orders.length === 0) {
    throw new Error('Select at least one valid order to generate Shipping Labels.');
  }

  const senderCheck = validateSenderConfig(senderConfig);
  if (!senderCheck.valid) {
    throw new Error(
      `Sender dispatch details are incomplete: ${senderCheck.issues.join('; ')}.`
    );
  }

  const generatedAt = options.generatedAt ?? new Date();

  const qrUrls = await Promise.all(
    orders.map((order) => generateOrderQrDataUrl(order.order_number))
  );

  const isThermal4x6 = layout === '4x6';
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: isThermal4x6 ? [101.6, 152.4] : 'a4',
    compress: true,
  });

  const fontName = registerPdfFonts(doc, options.fonts);

  if (isThermal4x6) {
    const pageW = doc.internal.pageSize.getWidth(); // 101.6mm (4 in)
    const pageH = doc.internal.pageSize.getHeight(); // 152.4mm (6 in)
    const margin = 4.5;

    for (let idx = 0; idx < orders.length; idx++) {
      if (idx > 0) doc.addPage([101.6, 152.4], 'portrait');
      drawShippingLabelCard(doc, fontName, orders[idx], senderConfig, qrUrls[idx], {
        x: margin,
        y: margin,
        w: pageW - margin * 2,
        h: pageH - margin * 2,
      });
    }
  } else {
    // A4 Grid: 2 columns x 2 rows = 4 labels per A4 page
    const pageW = doc.internal.pageSize.getWidth(); // 210mm
    const pageH = doc.internal.pageSize.getHeight(); // 297mm
    const marginX = 10;
    const marginY = 12;
    const gapX = 6;
    const gapY = 8;
    const cardW = (pageW - marginX * 2 - gapX) / 2; // 92mm
    const cardH = (pageH - marginY * 2 - gapY - 6) / 2; // ~130.5mm

    for (let idx = 0; idx < orders.length; idx++) {
      const slot = idx % 4;
      if (idx > 0 && slot === 0) {
        doc.addPage('a4', 'portrait');
      }

      const col = slot % 2;
      const row = Math.floor(slot / 2);
      const x = marginX + col * (cardW + gapX);
      const y = marginY + row * (cardH + gapY);

      drawShippingLabelCard(doc, fontName, orders[idx], senderConfig, qrUrls[idx], {
        x,
        y,
        w: cardW,
        h: cardH,
      });
    }

    // Cut guides & page numbers on A4 label sheets
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setDrawColor(180, 174, 164);
      doc.setLineWidth(0.2);
      doc.setLineDashPattern([1.5, 1.5], 0);
      const centerX = marginX + cardW + gapX / 2;
      const centerY = marginY + cardH + gapY / 2;
      doc.line(centerX, marginY, centerX, marginY + cardH * 2 + gapY);
      doc.line(marginX, centerY, pageW - marginX, centerY);
      doc.setLineDashPattern([], 0);

      doc.setFont(fontName, 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(129, 123, 112);
      doc.text(
        'APNA KAPDA — Shipping Labels (A4 Sheet • 4 Labels/Page)',
        marginX,
        pageH - 7
      );
      doc.setFont(fontName, 'bold');
      doc.text(`Page ${p} of ${totalPages}`, pageW - marginX, pageH - 7, {
        align: 'right',
      });
    }
  }

  const arrayBuffer = doc.output('arraybuffer');
  const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
  const layoutSuffix = isThermal4x6 ? '4x6' : 'A4';
  const filename = `APNA-KAPDA-Shipping-Labels-${layoutSuffix}-${safeFileStamp(generatedAt)}.pdf`;

  return {
    doc,
    blob,
    arrayBuffer,
    filename,
    pageCount: doc.getNumberOfPages(),
    orderCount: orders.length,
  };
}
