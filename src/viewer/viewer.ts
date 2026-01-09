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

console.log('Webview loaded');
console.log('PDF URL:', config.pdfUrl);

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

async function renderPdf() {
	try {
		console.log('Importing PDF.js from:', config.pdfjsUri);
		pdfjsLib = await import(config.pdfjsUri);
		console.log('PDF.js imported successfully');

		// Configure PDF.js worker
		pdfjsLib.GlobalWorkerOptions.workerSrc = config.pdfjsWorkerUri;
		console.log('Worker configured');

		console.log('Loading PDF document...');
		const loadingTask = pdfjsLib.getDocument(config.pdfUrl);
		const pdf = await loadingTask.promise;
		console.log('PDF loaded, pages:', pdf.numPages);

		loading.style.display = 'none';

		// Render each page
		for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
			const page = await pdf.getPage(pageNum);

			// Calculate scale for comfortable viewing
			const viewport = page.getViewport({ scale: 1.5 });

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
			console.log('Page', pageNum, 'annotations:', annotations.length);
			if (annotations.length > 0) {
				console.log('First few annotations:', annotations.slice(0, 3));
			}
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

					// Convert PDF coordinates to viewport coordinates
					const x = transform[0] * rect[0] + transform[4];
					const y = transform[3] * rect[3] + transform[5];
					const width = (rect[2] - rect[0]) * transform[0];
					const height = (rect[3] - rect[1]) * transform[3];

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
		// Highlight all matching links and scroll to the first one
		const firstLink = links[0];
		const firstElement = firstLink.element;

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

		// Scroll to the first highlighted element
		const pageDiv = firstElement.closest('.pdf-page');
		if (pageDiv) {
			pageDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	}
}

// State persistence
function saveState() {
	const state = {
		scrollTop: container.scrollTop,
		scrollLeft: container.scrollLeft
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
	}
}

// Save state on scroll
container.addEventListener('scroll', () => {
	saveState();
});

// Listen for sync messages from VS Code
window.addEventListener('message', event => {
	const message = event.data;
	switch (message.type) {
		case 'sync':
			highlightPosition(message.line, message.char);
			break;
	}
});

renderPdf().then(() => {
	// Restore scroll position
	restoreState();

	// Notify extension that PDF is ready
	vscode.postMessage({ type: 'ready' });
});
