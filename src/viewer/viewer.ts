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
	Actual = 'actual'
}

let currentZoomMode: ZoomMode = ZoomMode.FitPage;
let currentScale = 1.5; // Default scale (will be calculated based on zoom mode)
let pdfDocument: any = null;

interface TexteditLink {
	element: HTMLAnchorElement;
	pageNum: number;
	line: number;
	charStart: number;
	charEnd: number;
}

// Store all links with their positions for forward sync
const linksByPosition = new Map<string, TexteditLink[]>();

let pdfjsLib;

function updateZoomDisplay() {
	// Always show percentage
	zoomLevelDisplay.textContent = Math.round(currentScale * 100) + '%';

	// Grey out the percentage when in fit modes
	const isInFitMode = currentZoomMode === ZoomMode.FitWidth || currentZoomMode === ZoomMode.FitPage;
	zoomLevelDisplay.classList.toggle('fit-mode', isInFitMode);

	// Update active state on buttons (using appearance attribute for vscode-button)
	const fitWidthBtn = document.getElementById('zoom-fit-width')!;
	const fitPageBtn = document.getElementById('zoom-fit-page')!;
	const zoom100Btn = document.getElementById('zoom-100')!;

	fitWidthBtn.setAttribute('appearance', currentZoomMode === ZoomMode.FitWidth ? 'primary' : 'secondary');
	fitPageBtn.setAttribute('appearance', currentZoomMode === ZoomMode.FitPage ? 'primary' : 'secondary');
	zoom100Btn.setAttribute('appearance', (currentZoomMode === ZoomMode.Actual && currentScale === 1.0) ? 'primary' : 'secondary');
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

async function renderPdf() {
	try {
		pdfjsLib = await import(config.pdfjsUri);

		// Configure PDF.js worker
		pdfjsLib.GlobalWorkerOptions.workerSrc = config.pdfjsWorkerUri;

		const loadingTask = pdfjsLib.getDocument(config.pdfUrl);
		const pdf = await loadingTask.promise;
		pdfDocument = pdf;

		loading.style.display = 'none';
		zoomControls.style.display = 'flex';

		// Get first page to calculate scales
		const firstPage = await pdf.getPage(1);
		const baseViewport = firstPage.getViewport({ scale: 1.0 });

		// Calculate initial scale based on zoom mode
		let scale = currentScale;
		if (currentZoomMode === ZoomMode.FitWidth) {
			scale = calculateFitWidthScale(baseViewport.width);
			currentScale = scale;
		} else if (currentZoomMode === ZoomMode.FitPage) {
			scale = calculateFitPageScale(baseViewport.width, baseViewport.height);
			currentScale = scale;
		}

		updateZoomDisplay();

		// Render each page
		for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
			const page = await pdf.getPage(pageNum);

			// Calculate scale for comfortable viewing
			const viewport = page.getViewport({ scale: scale });

			// Create page container
			const pageDiv = document.createElement('div');
			pageDiv.className = 'pdf-page';

			// Create canvas for rendering
			const canvas = document.createElement('canvas');
			const context = canvas.getContext('2d');
			canvas.height = viewport.height;
			canvas.width = viewport.width;

			// Render PDF page
			await page.render({
				canvasContext: context,
				viewport: viewport
			}).promise;

			pageDiv.appendChild(canvas);

			// Extract and render links
			const annotations = await page.getAnnotations();
			const linkLayer = document.createElement('div');
			linkLayer.className = 'page-links';
			linkLayer.style.width = viewport.width + 'px';
			linkLayer.style.height = viewport.height + 'px';

			for (const annotation of annotations) {
				// Check both url and unsafeUrl (PDF.js puts textedit:// in unsafeUrl for security)
				const linkUrl = annotation.url || annotation.unsafeUrl;

				if (annotation.subtype === 'Link' && linkUrl) {
					const rect = annotation.rect;
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
					link.dataset.pageNum = pageNum.toString();

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
									pageNum: pageNum,
									...parsed
								});
							}
						} catch (e) {
							// Ignore parsing errors
						}
					}
				}
			}

			pageDiv.appendChild(linkLayer);
			container.appendChild(pageDiv);
		}
	} catch (error: any) {
		console.error('Error loading PDF:', error);
		loading.textContent = 'Error loading PDF: ' + error.message;
		loading.innerHTML += '<br><br>Check the DevTools Console (Help > Toggle Developer Tools) for details.';
		vscode.postMessage({
			type: 'error',
			message: error.message + ' - ' + error.stack
		});
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

// Zoom functions
function setZoom(scale: number, mode: ZoomMode) {
	currentScale = scale;
	currentZoomMode = mode;
	reRenderPdf();
}

function zoomIn() {
	const newScale = Math.min(currentScale * 1.2, 5.0);
	setZoom(newScale, ZoomMode.Custom);
}

function zoomOut() {
	const newScale = Math.max(currentScale / 1.2, 0.1);
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
	setZoom(1.0, ZoomMode.Actual);
}

function reRenderPdf() {
	// Clear container and re-render with new scale
	container.innerHTML = '';
	linksByPosition.clear();
	renderPdf().then(() => {
		restoreState();
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
	// Ctrl/Cmd + 0 for fit width
	else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
		e.preventDefault();
		setZoomFitWidth();
	}
	// Ctrl/Cmd + 1 for fit page
	else if ((e.ctrlKey || e.metaKey) && e.key === '1') {
		e.preventDefault();
		setZoomFitPage();
	}
	// Ctrl/Cmd + 2 for 100%
	else if ((e.ctrlKey || e.metaKey) && e.key === '2') {
		e.preventDefault();
		setZoom100();
	}
});

// Mouse wheel zoom with Ctrl/Cmd
container.addEventListener('wheel', (e) => {
	if (e.ctrlKey || e.metaKey) {
		e.preventDefault();
		if (e.deltaY < 0) {
			zoomIn();
		} else if (e.deltaY > 0) {
			zoomOut();
		}
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

// Listen for sync messages from VS Code
window.addEventListener('message', event => {
	const message = event.data;
	switch (message.type) {
		case 'sync':
			highlightPosition(message.line, message.char);
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
			// Restore zoom state variables before rendering so renderPdf uses correct settings
			const state = vscode.getState();
			if (state) {
				if (state.scale !== undefined) {
					currentScale = state.scale;
				}
				if (state.zoomMode !== undefined) {
					currentZoomMode = state.zoomMode;
				}
			}
			// Render PDF, then restore scroll position
			renderPdf().then(() => {
				setTimeout(() => {
					restoreState();
					// Re-enable scroll listener after restoration is complete
					scrollListenerEnabled = true;
				}, 0);
			});
			break;
	}
});

renderPdf().then(() => {
	// Restore scroll position
	restoreState();

	// Update button states after a brief delay to ensure custom elements are initialized
	setTimeout(() => {
		updateZoomDisplay();
	}, 0);

	// Notify extension that PDF is ready
	vscode.postMessage({ type: 'ready' });
});
