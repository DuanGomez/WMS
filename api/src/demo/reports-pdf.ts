/**
 * PDFKit para la demo del navegador, en un archivo aparte (wms-demo-pdf.js): solo se descarga cuando se
 * genera el primer PDF. build-pages.mjs redirige aquí el import('pdfkit') de reports/builder.ts.
 */
import PDFDocument, { registerStdFonts } from 'pdfkit';
import Helvetica from 'pdfkit/standard-fonts/Helvetica';
import HelveticaBold from 'pdfkit/standard-fonts/HelveticaBold';

registerStdFonts(Helvetica, HelveticaBold);

export default PDFDocument;
