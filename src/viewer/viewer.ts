/** @fileoverview This script runs in the webview context of the PDF viewer.
 * It receives configuration via a data attribute.
 */

declare function acquireVsCodeApi(): any;

const vscode = acquireVsCodeApi();

// Read configuration from data attribute
const configElement = document.getElementById('viewer-config');
const config = JSON.parse(configElement?.dataset.config || '{}');

const container = document.getElementById('pdf-container')!;
const loading = document.getElementById('loading')!;
const zoomLevelDisplay = document.getElementById('zoom-level')!;
const zoomControls = document.getElementById('zoom-controls')!;

console.log('Webview loaded');
console.log('PDF URL:', config.pdfUrl);

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

interface TexteditLink {
	element: HTMLAnchorElement;
	pageNum: number;
	line: number;
	charStart: number;
	charEnd: number;
}

/** Stored annotation (link) data (zoom-independent) */
interface StoredAnnotation {
	rect: number[];
	url: string;
}

interface StoredPage {
	page: any; // PDF.js page object
	annotations: StoredAnnotation[];
}

// Store all links with their positions for forward sync
const linksByPosition = new Map<string, TexteditLink[]>();

// Store loaded pages and annotations (populated by loadPdf, used by renderPages)
let storedPages: StoredPage[] = [];

let pdfjsLib;

function updateZoomDisplay() {
	// Show percentage relative to actual size (not raw PDF scale)
	const percentOfActual = Math.round((currentScale / ACTUAL_SIZE_SCALE) * 100);
	zoomLevelDisplay.textContent = percentOfActual + '%';

	// Grey out the percentage when in fit modes
	const isInFitMode = currentZoomMode === ZoomMode.FitWidth || currentZoomMode === ZoomMode.FitPage;
	zoomLevelDisplay.classList.toggle('fit-mode', isInFitMode);

	// Update active state on buttons (using appearance attribute for vscode-button)
	const fitWidthBtn = document.getElementById('zoom-fit-width')!;
	const fitPageBtn = document.getElementById('zoom-fit-page')!;

	fitWidthBtn.setAttribute('appearance', currentZoomMode === ZoomMode.FitWidth ? 'primary' : 'secondary');
	fitPageBtn.setAttribute('appearance', currentZoomMode === ZoomMode.FitPage ? 'primary' : 'secondary');
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

/**
 * Loads the PDF document and extracts annotations.
 * Called on initial load and when the PDF file changes.
 */
async function loadPdf() {
	try {
		pdfjsLib = await import(config.pdfjsUri);

		// Configure PDF.js worker
		pdfjsLib.GlobalWorkerOptions.workerSrc = config.pdfjsWorkerUri;

		const loadingTask = pdfjsLib.getDocument(config.pdfUrl);
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
						url: linkUrl
					});
				}
			}

			storedPages.push({ page, annotations: storedAnnotations });
		}

		loading.style.display = 'none';
		zoomControls.style.display = 'flex';

		// Now render the pages
		await renderPages();
	} catch (error: any) {
		if (error instanceof RenderCancelledError) {
			return; // Silently ignore cancellation
		}
		console.error('Error loading PDF:', error);
		loading.textContent = 'Error loading PDF: ' + error.message;
		loading.innerHTML += '<br><br>Check the DevTools Console (Help > Toggle Developer Tools) for details.';
		vscode.postMessage({
			type: 'error',
			message: error.message + ' - ' + error.stack
		});
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
	linksByPosition.clear();

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
			const { rect, url: linkUrl } = annotation;
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
			link.dataset.url = linkUrl;
			link.dataset.pageNum = (pageNum + 1).toString();

			link.addEventListener('click', (e) => {
				e.preventDefault();
				vscode.postMessage({
					type: 'click',
					uri: linkUrl
				});
			});

			link.addEventListener('pointerenter', () => {
				vscode.postMessage({
					type: 'hover',
					uri: linkUrl
				});
			});

			link.addEventListener('pointerleave', () => {
				vscode.postMessage({
					type: 'unhover'
				});
			});

			linkLayer.appendChild(link);

			// Parse and store link position for forward sync
			if (linkUrl.startsWith('textedit://')) {
				try {
					const parsed = parseTexteditUri(linkUrl);
					if (parsed) {
						const key = parsed.line + ':' + parsed.charStart;
						if (!linksByPosition.has(key)) {
							linksByPosition.set(key, []);
						}
						linksByPosition.get(key)!.push({
							element: link,
							pageNum: pageNum + 1,
							...parsed
						});
					}
				} catch (e) {
					// Ignore parsing errors
				}
			}
		}

		pageDiv.appendChild(linkLayer);
		container.appendChild(pageDiv);
	}
}

function parseTexteditUri(uri: string) {
	// Parse textedit:// URI format: textedit:///path/to/file.ly:line:char:char
	const match = uri.match(/^textedit:\/\/(.+):(\d+):(\d+):(\d+)$/);
	if (!match) {
		return null;
	}

	const [, , lineStr, charStartStr, charEndStr] = match;
	const [line, charStart, charEnd] = [lineStr, charStartStr, charEndStr].map(str => parseInt(str, 10));
	return { line, charStart, charEnd };
}

function highlightPosition(line: number, char: number) {
	// Remove existing highlights
	document.querySelectorAll('.highlight').forEach(el => el.remove());

	// Find links that match or are close to the position
	const key = line + ':' + char;
	let links = linksByPosition.get(key);

	// If no exact match, find the closest link on the same line
	if (!links || links.length === 0) {
		const allLinks = [];
		for (const [k, v] of linksByPosition.entries()) {
			const [l, c] = k.split(':').map(Number);
			if (l === line) {
				allLinks.push(...v.map(link => ({ ...link, char: c })));
			}
		}

		if (allLinks.length > 0) {
			// Find closest by character position
			allLinks.sort((a, b) => Math.abs(a.char - char) - Math.abs(b.char - char));
			links = [allLinks[0]];
		}
	}

	if (links && links.length > 0) {
		links.forEach(linkInfo => {
			const link = linkInfo.element;
			const highlight = document.createElement('div');
			highlight.className = 'highlight';
			highlight.style.left = link.style.left;
			highlight.style.top = link.style.top;
			highlight.style.width = link.style.width;
			highlight.style.height = link.style.height;

			link.parentElement?.appendChild(highlight);

			// Fade out after 2 seconds
			setTimeout(() => {
				highlight.style.opacity = '0';
				setTimeout(() => highlight.remove(), 300);
			}, 2000);
		});
	}
}

function highlightRange(startLine: number, startChar: number, endLine: number, endChar: number) {
	// Remove existing highlights
	document.querySelectorAll('.highlight').forEach(el => el.remove());

	// If it's a single position (no actual range selected), use the simpler single-position logic
	if (startLine === endLine && startChar === endChar) {
		highlightPosition(startLine, startChar);
		return;
	}

	// Find all links whose targets fall within the selected range
	const matchingLinks = [];
	for (const [key, links] of linksByPosition.entries()) {
		const [linkLine, linkChar] = key.split(':').map(Number);

		// Check if this link position is within the selection range
		const isInRange = (linkLine > startLine || (linkLine === startLine && linkChar >= startChar)) &&
			(linkLine < endLine || (linkLine === endLine && linkChar <= endChar));

		if (isInRange) {
			matchingLinks.push(...links);
		}
	}

	// Highlight all matching links
	if (matchingLinks.length > 0) {
		matchingLinks.forEach(linkInfo => {
			const link = linkInfo.element;
			const highlight = document.createElement('div');
			highlight.className = 'highlight';
			highlight.style.left = link.style.left;
			highlight.style.top = link.style.top;
			highlight.style.width = link.style.width;
			highlight.style.height = link.style.height;

			link.parentElement?.appendChild(highlight);

		});
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
let lastPinchDistance = 0;
container.addEventListener('gesturestart', (e: any) => {
	e.preventDefault();
	lastPinchDistance = 0;
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

/** The messages sent from the VSC side of the extension in pdfViewer.ts */
type VsCodeMessage =
	| { type: 'click'; uri: string }
	| { type: 'hover'; uri: string }
	| { type: 'unhover' }
	| { type: 'sync'; startLine: number; startChar: number; endLine: number; endChar: number }
	| { type: 'reload' };

// Listen for sync messages from VS Code
window.addEventListener('message', (event: MessageEvent<VsCodeMessage>) => {
	const message = event.data;
	switch (message.type) {
		case 'sync':
			if (message.startLine !== undefined && message.startChar !== undefined &&
				message.endLine !== undefined && message.endChar !== undefined) {
				highlightRange(message.startLine, message.startChar, message.endLine, message.endChar);
			}
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
			linksByPosition.clear();
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

	// Notify extension that PDF is ready
	vscode.postMessage({ type: 'ready' });
}).catch((error) => {
	if (!(error instanceof RenderCancelledError)) {
		throw error;
	}
});
