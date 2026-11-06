export {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
GlobalWorkerOptions.workerSrc='/assets/pdf-worker.mjs';
