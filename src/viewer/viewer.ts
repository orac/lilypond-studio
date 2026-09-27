/** @fileoverview This script runs in the webview context of the PDF viewer.
 * It receives configuration via a data attribute.
 */

import { parseTexteditUri, sourceFileKey, type TexteditTarget } from '../shared/texteditUri';
import type { HostMessage, SourceRange, ViewerMessage } from '../shared/viewerMessages';

declare function acquireVsCodeApi(): any;

const vscodeApi = acquireVsCodeApi();

const vscode = {
	postMessage: (message: ViewerMessage) => vscodeApi.postMessage(message),
	getState: () => vscodeApi.getState(),
	setState: (state: unknown) => vscodeApi.setState(state),
};

/** Reports a failure to the extension host, which logs it and offers it to the user.
 *
 * Registered before anything else runs so that a fault in this script's own setup — a missing asset, a CSP violation — still reaches the log rather than dying in a DevTools console nobody opens.
 */
function reportError(message: string, error?: unknown) {
	const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : error !== undefined ? String(error) : '';
	vscode.postMessage({ type: 'error', message: detail ? `${message}: ${detail}` : message });
}

window.addEventListener('error', (event: ErrorEvent) => {
	reportError(`Uncaught error at ${event.filename}:${event.lineno}`, event.error ?? event.message);
});

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
	reportError('Unhandled promise rejection', event.reason);
});

/** Sends a line to the extension's log channel, where a user can copy it into a bug report. */
function log(message: string) {
	vscode.postMessage({ type: 'log', message });
}

// Read configuration from data attribute
const configElement = document.getElementById('viewer-config');
const config = JSON.parse(configElement?.dataset.config || '{}');

const container = document.getElementById('pdf-container')!;
const loading = document.getElementById('loading')!;
const zoomLevelDisplay = document.getElementById('zoom-level')!;
const zoomControls = document.getElementById('zoom-controls')!;

log(`Webview loaded, PDF URL: ${config.pdfUrl}`);

// Zoom state
enum ZoomMode {
	Custom = 'custom',
	FitWidth = 'fit-width',
	FitPage = 'fit-page',
}

// PDF uses 72 points per inch, CSS uses 96 pixels per inch
// This scale factor converts PDF points to CSS pixels for actual size display
const ACTUAL_SIZE_SCALE = 96 / 72; // ≈ 1.333

let currentZoomMode: ZoomMode = ZoomMode.FitPage;
let currentScale = ACTUAL_SIZE_SCALE; // Default scale (will be calculated based on zoom mode)
let pdfDocument: any = null;
let currentRenderId = 0; // Used to cancel stale renders

/** Zoom anchor point - persists during rapid zoom operations */
interface ZoomAnchor {
	clientX: number;      // Cursor position in client coordinates
	clientY: number;
	pageIndex: number;    // Which page the cursor was over
	pageOffsetX: number;  // Cursor position relative to page element
	pageOffsetY: number;
	baseScale: number;    // Scale when anchor was captured
}
let zoomAnchor: ZoomAnchor | null = null;

/** Custom error for render cancellation */
class RenderCancelledError extends Error {
	constructor() {
		super('Render cancelled');
		this.name = 'RenderCancelledError';
	}
}

/** A rendered point-and-click link. */
interface TexteditLink extends TexteditTarget {
	element: HTMLAnchorElement;
}

/** Stored annotation (link) data (zoom-independent) */
interface StoredAnnotation {
	rect: number[];
	url: string;
	/** Where the link points, if it is a point-and-click link. */
	target: TexteditTarget | undefined;
}

interface StoredPage {
	page: any; // PDF.js page object
	annotations: StoredAnnotation[];
}

/** The rendered point-and-click links, keyed by the {@link sourceFileKey} of the file they point into. */
const linksBySource = new Map<string, TexteditLink[]>();

// Store loaded pages and annotations (populated by loadPdf, used by renderPages)
let storedPages: StoredPage[] = [];

let pdfjsLib: any;

function updateZoomDisplay() {
	// Show percentage relative to actual size (not raw PDF scale)
	const percentOfActual = Math.round((currentScale / ACTUAL_SIZE_SCALE) * 100);
	zoomLevelDisplay.textContent = percentOfActual + '%';

	// Grey out the percentage when in fit modes
	const isInFitMode = currentZoomMode === ZoomMode.FitWidth || currentZoomMode === ZoomMode.FitPage;
	zoomLevelDisplay.classList.toggle('fit-mode', isInFitMode);

	const fitWidthBtn = document.getElementById('zoom-fit-width')!;
	const fitPageBtn = document.getElementById('zoom-fit-page')!;

	fitWidthBtn.toggleAttribute('secondary', currentZoomMode !== ZoomMode.FitWidth);
	fitPageBtn.toggleAttribute('secondary', currentZoomMode !== ZoomMode.FitPage);
}

function calculateFitWidthScale(pageWidth: number): number {
	const containerWidth = container.clientWidth - 40; // Account for padding
	return containerWidth / pageWidth;
}

function calculateFitPageScale(pageWidth: number, pageHeight: number): number {
	const containerWidth = container.clientWidth - 40;
	const containerHeight = container.clientHeight - 40;
	const widthScale = containerWidth / pageWidth;
	const heightScale = containerHeight / pageHeight;
	return Math.min(widthScale, heightScale);
}

/** The pdf.js worker, created once and shared by every document this webview loads. */
let pdfWorkerPromise: Promise<any> | undefined;

/** Starts the pdf.js worker ourselves, bypassing pdf.js's own worker loading.
 *
 * Left to itself, pdf.js compares the worker's URL against `window.location` to decide whether it is same-origin. In a webview it always concludes that it is not — the document is `vscode-webview://…` while its resources come from `https://file+.vscode-resource.vscode-cdn.net` — so it wraps the worker in a blob that does `await import(<resource url>)`. That is a cross-origin module fetch from an opaque origin, the resource server refuses it, and the worker dies before it starts. pdf.js recovers by running the worker's code on the main thread, so pages still render, but they render on the UI thread and the failure surfaces as an alarming uncaught TypeError.
 *
 * Fetching the bundle and starting the `Worker` from a blob of its source avoids the cross-origin fetch, and handing pdf.js the live worker as a `port` skips its origin check altogether rather than trying to satisfy it. The worker bundle has no static imports, so nothing depends on where it is loaded from.
 */
async function startPdfWorker(): Promise<any> {
	const response = await fetch(config.pdfjsWorkerUri);
	if (!response.ok) {
		throw new Error(`Fetching the pdf.js worker returned ${response.status} ${response.statusText}`);
	}
	const blobUrl = URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
	return new pdfjsLib.PDFWorker({ port: new Worker(blobUrl, { type: 'module' }) });
}

/**
 * Loads the PDF document and extracts annotations.
 * Called on initial load and when the PDF file changes.
 */
async function loadPdf() {
	try {
		pdfjsLib = await import(config.pdfjsUri);

		// If starting the worker fails, leave pdf.js to its own devices: it falls back to rendering on the main thread, which is slow but correct.
		pdfWorkerPromise ??= startPdfWorker().catch(error => {
			log(`Could not start the pdf.js worker (${error}); falling back to main-thread rendering.`);
			pdfjsLib.GlobalWorkerOptions.workerSrc = config.pdfjsWorkerUri;
			return undefined;
		});

		const loadingTask = pdfjsLib.getDocument({ url: config.pdfUrl, worker: await pdfWorkerPromise });
		const pdf = await loadingTask.promise;

		pdfDocument = pdf;
		storedPages = [];

		// Load all pages and their annotations
		for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
			const page = await pdf.getPage(pageNum);
			const annotations = await page.getAnnotations();

			// Extract only the link annotations we care about
			const storedAnnotations: StoredAnnotation[] = [];
			for (const annotation of annotations) {
				const linkUrl = annotation.url || annotation.unsafeUrl;
				if (annotation.subtype === 'Link' && linkUrl) {
					storedAnnotations.push({
						rect: annotation.rect,
						url: linkUrl,
						target: parseTexteditUri(linkUrl),
					});
				}
			}

			storedPages.push({ page, annotations: storedAnnotations });
		}

		loading.style.display = 'none';
		zoomControls.style.display = 'flex';

		// Now render the pages
		await renderPages();

		const sourceFiles = new Set(storedPages.flatMap(page => page.annotations.flatMap(annotation => annotation.target ? [annotation.target.filePath] : [])));
		vscode.postMessage({ type: 'ready', sourceFiles: [...sourceFiles] });
	} catch (error: any) {
		if (error instanceof RenderCancelledError) {
			return; // Silently ignore cancellation
		}
		loading.textContent = 'Error loading PDF: ' + error.message;
		loading.innerHTML += '<br><br>See the LilyPond Studio output channel (View &gt; Output) for details.';
		reportError('Error loading PDF', error);
	}
}

/**
 * Renders all pages at the current scale.
 * Called after loadPdf and on zoom/resize changes.
 */
async function renderPages() {
	if (storedPages.length === 0) {
		return;
	}

	// Increment render ID to cancel any in-progress renders
	const renderId = ++currentRenderId;

	// Clear container and link map
	container.innerHTML = '';
	linksBySource.clear();

	// Get base viewport from first page to calculate scales
	const baseViewport = storedPages[0].page.getViewport({ scale: 1.0 });

	// Calculate scale based on zoom mode
	let scale = currentScale;
	if (currentZoomMode === ZoomMode.FitWidth) {
		scale = calculateFitWidthScale(baseViewport.width);
		currentScale = scale;
	} else if (currentZoomMode === ZoomMode.FitPage) {
		scale = calculateFitPageScale(baseViewport.width, baseViewport.height);
		currentScale = scale;
	}

	updateZoomDisplay();

	// Get device pixel ratio for high-DPI rendering
	const dpr = window.devicePixelRatio || 1;

	// Render each page
	for (let pageNum = 0; pageNum < storedPages.length; pageNum++) {
		if (renderId !== currentRenderId) {
			throw new RenderCancelledError();
		}

		const { page, annotations } = storedPages[pageNum];

		// Calculate scale for comfortable viewing
		const viewport = page.getViewport({ scale: scale });
		// Create a scaled viewport for high-DPI rendering
		const scaledViewport = page.getViewport({ scale: scale * dpr });

		// Create page container
		const pageDiv = document.createElement('div');
		pageDiv.className = 'pdf-page';

		// Create canvas for rendering
		const canvas = document.createElement('canvas');
		const context = canvas.getContext('2d');
		// Set canvas bitmap size to scaled dimensions for sharp rendering
		canvas.width = scaledViewport.width;
		canvas.height = scaledViewport.height;
		// Set CSS size to logical dimensions
		canvas.style.width = viewport.width + 'px';
		canvas.style.height = viewport.height + 'px';

		// Render PDF page at scaled resolution
		await page.render({
			canvasContext: context,
			viewport: scaledViewport
		}).promise;
		if (renderId !== currentRenderId) {
			throw new RenderCancelledError();
		}

		pageDiv.appendChild(canvas);

		// Create link layer from stored annotations
		const linkLayer = document.createElement('div');
		linkLayer.className = 'page-links';
		linkLayer.style.width = viewport.width + 'px';
		linkLayer.style.height = viewport.height + 'px';

		for (const annotation of annotations) {
			const { rect, url: linkUrl, target } = annotation;
			const transform = viewport.transform;

			// Convert PDF coordinates to viewport coordinates. Add a little extra height because the bboxes are quite tight.
			const x = transform[0] * rect[0] + transform[4];
			const y = transform[3] * rect[3] + transform[5] - 1;
			const width = (rect[2] - rect[0]) * transform[0];
			const height = (rect[1] - rect[3]) * transform[3] + 1;

			const link = document.createElement('a');
			link.style.left = x + 'px';
			link.style.top = y + 'px';
			link.style.width = width + 'px';
			link.style.height = height + 'px';
			link.href = '#';
			link.title = linkUrl;
			linkLayer.appendChild(link);

			if (!target) {
				continue;
			}

			link.addEventListener('click', (e) => {
				e.preventDefault();
				vscode.postMessage({ type: 'click', target });
			});
			link.addEventListener('pointerenter', () => {
				vscode.postMessage({ type: 'hover', target });
			});
			link.addEventListener('pointerleave', () => {
				vscode.postMessage({ type: 'unhover' });
			});

			const key = sourceFileKey(target.filePath);
			let links = linksBySource.get(key);
			if (!links) {
				links = [];
				linksBySource.set(key, links);
			}
			links.push({ element: link, ...target });
		}

		pageDiv.appendChild(linkLayer);
		container.appendChild(pageDiv);
	}
}

/** The links nearest a cursor position: those starting closest to it on the same line. */
function linksNearestPosition(links: TexteditLink[], line: number, char: number): TexteditLink[] {
	const onLine = links.filter(link => link.line === line);
	const distance = (link: TexteditLink) => Math.abs(link.charStart - char);
	const nearest = Math.min(...onLine.map(distance));
	return onLine.filter(link => distance(link) === nearest);
}

/** The links starting within a selected range, inclusive at both ends. */
function linksInRange(links: TexteditLink[], range: SourceRange): TexteditLink[] {
	const afterStart = (link: TexteditLink) => link.line > range.startLine || (link.line === range.startLine && link.charStart >= range.startChar);
	const beforeEnd = (link: TexteditLink) => link.line < range.endLine || (link.line === range.endLine && link.charStart <= range.endChar);
	return links.filter(link => afterStart(link) && beforeEnd(link));
}

/** Highlights the notation for a cursor or selection in a source file, replacing any previous highlight.
 *
 * A bare cursor highlights the nearest link on its line, briefly; a selection highlights every link in it until the selection changes. A file this PDF has no links into clears the highlight.
 */
function highlightRange(range: SourceRange) {
	document.querySelectorAll('.highlight').forEach(el => el.remove());

	const links = linksBySource.get(sourceFileKey(range.filePath)) ?? [];
	const isCursor = range.startLine === range.endLine && range.startChar === range.endChar;
	const matching = isCursor ? linksNearestPosition(links, range.startLine, range.startChar) : linksInRange(links, range);

	for (const { element: link } of matching) {
		const highlight = document.createElement('div');
		highlight.className = 'highlight';
		highlight.style.left = link.style.left;
		highlight.style.top = link.style.top;
		highlight.style.width = link.style.width;
		highlight.style.height = link.style.height;
		link.parentElement?.appendChild(highlight);

		if (isCursor) {
			setTimeout(() => {
				highlight.style.opacity = '0';
				setTimeout(() => highlight.remove(), 300);
			}, 2000);
		}
	}
}

// Zoom functions
function setZoom(scale: number, mode: ZoomMode) {
	currentScale = scale;
	currentZoomMode = mode;
	zoomAnchor = null; // Clear any wheel zoom anchor
	reRenderPdf();
}

function zoomIn() {
	const newScale = Math.min(currentScale * 1.2, 5.0 * ACTUAL_SIZE_SCALE);
	setZoom(newScale, ZoomMode.Custom);
}

function zoomOut() {
	const newScale = Math.max(currentScale / 1.2, 0.1 * ACTUAL_SIZE_SCALE);
	setZoom(newScale, ZoomMode.Custom);
}

function setZoomFitWidth() {
	if (!pdfDocument) {
		return;
	}
	currentZoomMode = ZoomMode.FitWidth;
	reRenderPdf();
}

function setZoomFitPage() {
	if (!pdfDocument) {
		return;
	}
	currentZoomMode = ZoomMode.FitPage;
	reRenderPdf();
}

function setZoom100() {
	setZoom(ACTUAL_SIZE_SCALE, ZoomMode.Custom);
}

/** Redraws the loaded PDF into the canvas to reflect updated zoom settings */
function reRenderPdf() {
	// Save state first to preserve the new zoom settings
	saveState();
	// Re-render with new scale (no need to reload PDF)
	renderPages().then(() => {
		// Restore only scroll position (zoom settings were already saved above)
		restoreState();
	}).catch((error) => {
		if (!(error instanceof RenderCancelledError)) {
			throw error;
		}
	});
}

// State persistence
function saveState() {
	const state = {
		scrollTop: container.scrollTop,
		scrollLeft: container.scrollLeft,
		scale: currentScale,
		zoomMode: currentZoomMode
	};
	vscode.setState(state);
}

function restoreState() {
	const state = vscode.getState();
	if (state) {
		if (state.scrollTop !== undefined) {
			container.scrollTop = state.scrollTop;
		}
		if (state.scrollLeft !== undefined) {
			container.scrollLeft = state.scrollLeft;
		}
		if (state.scale !== undefined) {
			currentScale = state.scale;
		}
		if (state.zoomMode !== undefined) {
			currentZoomMode = state.zoomMode;
		}
	}
}

// Save state on scroll
let scrollListenerEnabled = true;
container.addEventListener('scroll', () => {
	if (scrollListenerEnabled) {
		saveState();
	}
});

// Zoom button event listeners
document.getElementById('zoom-in')!.addEventListener('click', zoomIn);
document.getElementById('zoom-out')!.addEventListener('click', zoomOut);
document.getElementById('zoom-fit-width')!.addEventListener('click', setZoomFitWidth);
document.getElementById('zoom-fit-page')!.addEventListener('click', setZoomFitPage);
document.getElementById('zoom-100')!.addEventListener('click', setZoom100);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
	// Ctrl/Cmd + Plus/Equals for zoom in
	if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
		e.preventDefault();
		zoomIn();
	}
	// Ctrl/Cmd + Minus for zoom out
	else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
		e.preventDefault();
		zoomOut();
	}
});

// Mouse wheel zoom with Ctrl/Cmd - zooms centered on pointer position
container.addEventListener('wheel', (e) => {
	if (e.ctrlKey || e.metaKey) {
		e.preventDefault();

		const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
		const newScale = Math.min(Math.max(currentScale * factor, 0.1 * ACTUAL_SIZE_SCALE), 5.0 * ACTUAL_SIZE_SCALE);

		if (newScale === currentScale) {
			return;
		}

		// If no anchor exists (first zoom in sequence), capture it now
		// If anchor exists (rapid zoom), keep the original anchor point
		if (!zoomAnchor) {
			// Find which page the cursor is over and calculate offset within that page
			const pageElements = container.querySelectorAll('.pdf-page');
			let pageIndex = 0;
			let pageOffsetX = 0;
			let pageOffsetY = 0;

			for (let i = 0; i < pageElements.length; i++) {
				const pageRect = pageElements[i].getBoundingClientRect();
				if (e.clientY <= pageRect.bottom) {
					pageIndex = i;
					pageOffsetX = e.clientX - pageRect.left;
					pageOffsetY = e.clientY - pageRect.top;
					break;
				}
				// If past last page, use the last page
				if (i === pageElements.length - 1) {
					pageIndex = i;
					pageOffsetX = e.clientX - pageRect.left;
					pageOffsetY = e.clientY - pageRect.top;
				}
			}

			zoomAnchor = {
				clientX: e.clientX,
				clientY: e.clientY,
				pageIndex,
				pageOffsetX,
				pageOffsetY,
				baseScale: currentScale
			};
		}

		currentScale = newScale;
		currentZoomMode = ZoomMode.Custom;
		saveState();

		renderPages().then(() => {
			if (zoomAnchor) {
				// Calculate scale factor from original anchor to current scale
				const scaleFactor = currentScale / zoomAnchor.baseScale;

				// Find the same page after re-render
				const pageElements = container.querySelectorAll('.pdf-page');
				const page = pageElements[zoomAnchor.pageIndex];
				if (page) {
					const pageRect = page.getBoundingClientRect();

					// Where is the anchor point now (scaled position within page)
					const newPageOffsetX = zoomAnchor.pageOffsetX * scaleFactor;
					const newPageOffsetY = zoomAnchor.pageOffsetY * scaleFactor;

					// Current screen position of that point
					const currentScreenX = pageRect.left + newPageOffsetX;
					const currentScreenY = pageRect.top + newPageOffsetY;

					// Adjust scroll to put that point back under the cursor
					container.scrollLeft += currentScreenX - zoomAnchor.clientX;
					container.scrollTop += currentScreenY - zoomAnchor.clientY;
					saveState();
				}

				// Clear anchor after successful render
				zoomAnchor = null;
			}
		}).catch((error) => {
			if (!(error instanceof RenderCancelledError)) {
				throw error;
			}
			// Don't clear anchor on cancellation - next render will use it
		});
	}
}, { passive: false });

// Pinch-to-zoom support for touchpads
container.addEventListener('gesturestart', (e: any) => {
	e.preventDefault();
});

container.addEventListener('gesturechange', (e: any) => {
	e.preventDefault();
	if (e.scale > 1) {
		zoomIn();
	} else if (e.scale < 1) {
		zoomOut();
	}
});

container.addEventListener('gestureend', (e: any) => {
	e.preventDefault();
});

// Window resize handler for fit modes
let resizeTimeout: number | undefined;
window.addEventListener('resize', () => {
	// Only react to resize in fit modes
	if (currentZoomMode === ZoomMode.FitWidth || currentZoomMode === ZoomMode.FitPage) {
		// Debounce resize events to avoid too many re-renders
		if (resizeTimeout) {
			clearTimeout(resizeTimeout);
		}
		resizeTimeout = window.setTimeout(() => {
			reRenderPdf();
		}, 200);
	}
});

// Listen for sync messages from VS Code
window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
	const message = event.data;
	switch (message.type) {
		case 'sync':
			highlightRange(message.range);
			break;
		case 'reload':
			// Disable scroll listener to prevent saving incorrect scroll positions during reload
			scrollListenerEnabled = false;
			// Save current state before clearing
			saveState();
			// Clear the container and reload the PDF
			container.innerHTML = '';
			loading.style.display = 'block';
			loading.textContent = 'Loading PDF...';
			linksBySource.clear();
			storedPages = [];
			// Restore zoom state variables before rendering so loadPdf uses correct settings
			const state = vscode.getState();
			if (state) {
				if (state.scale !== undefined) {
					currentScale = state.scale;
				}
				if (state.zoomMode !== undefined) {
					currentZoomMode = state.zoomMode;
				}
			}
			// Load PDF, then restore scroll position
			loadPdf().then(() => {
				setTimeout(() => {
					restoreState();
					// Re-enable scroll listener after restoration is complete
					scrollListenerEnabled = true;
				}, 0);
			}).catch((error) => {
				if (!(error instanceof RenderCancelledError)) {
					throw error;
				}
				// Re-enable scroll listener even if cancelled
				scrollListenerEnabled = true;
			});
			break;
	}
});

loadPdf().then(() => {
	// Restore scroll position
	restoreState();

	// Update button states after a brief delay to ensure custom elements are initialized
	setTimeout(() => {
		updateZoomDisplay();
	}, 0);
}).catch((error) => {
	if (!(error instanceof RenderCancelledError)) {
		throw error;
	}
});
