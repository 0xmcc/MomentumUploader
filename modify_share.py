import re

with open('src/lib/share-contract.ts', 'r') as f:
    content = f.read()

# 1. Update CSS
css_old = """    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: var(--background);
      color: var(--foreground);
      line-height: 1.65;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    main {
      max-width: 680px;
      margin: 0 auto;
      padding: 3rem 1.25rem 5rem;
    }
    article {
      padding: 0;
      min-height: 80vh;
    }
    h1 {
      margin: 0 0 0.5rem;
      font-size: clamp(1.75rem, 5vw, 2.5rem);
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.2;
    }
    h2 { 
      margin-top: 2rem; 
      margin-bottom: 1rem; 
      font-size: 1.25rem; 
      font-weight: 600;
    }"""

css_new = """    body {
      margin: 0;
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--background);
      color: var(--foreground);
      line-height: 1.6;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    main {
      max-width: 640px;
      margin: 0 auto;
      padding: 4rem 1.5rem 6rem;
    }
    article {
      padding: 0;
      min-height: 80vh;
    }
    h1 {
      margin: 0 0 0.75rem;
      font-size: clamp(2rem, 6vw, 2.75rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.15;
    }
    h2 { 
      margin-top: 2.5rem; 
      margin-bottom: 1.25rem; 
      font-size: 1.35rem; 
      font-weight: 700;
      letter-spacing: -0.01em;
    }"""

content = content.replace(css_old, css_new)

# Update transcript segment CSS
css_old2 = """    .transcript-segment {
      display: flex;
      gap: .65rem;
      align-items: baseline;
      padding: .6rem 0;
      border-radius: 4px;
      transition: background .15s;
    }
    .transcript-segment.active {
      background: color-mix(in srgb, var(--accent) 10%, transparent);
    }
    .ts-btn {
      flex-shrink: 0;
      font-family: ui-monospace, monospace;
      font-size: .72rem;
      color: var(--accent);
      background: transparent;
      border: 1px solid color-mix(in srgb, var(--border) 55%, var(--accent) 45%);
      border-radius: 4px;
      padding: 1px 6px;
      cursor: pointer;
      white-space: nowrap;
      line-height: 1.5;
    }
    .ts-btn:hover {
      background: color-mix(in srgb, var(--foreground) 6%, transparent);
    }
    .seg-text { flex: 1; }"""

css_new2 = """    .transcript-segment {
      display: flex;
      gap: 1rem;
      align-items: flex-start;
      padding: .75rem 0.5rem;
      border-radius: 8px;
      transition: background .15s;
    }
    .transcript-segment.active {
      background: color-mix(in srgb, var(--accent) 10%, transparent);
    }
    .ts-btn {
      flex-shrink: 0;
      font-family: ui-monospace, monospace;
      font-size: .75rem;
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
      border-radius: 6px;
      padding: 4px 8px;
      cursor: pointer;
      white-space: nowrap;
      line-height: 1.5;
      transition: all 0.2s ease;
    }
    .ts-btn:hover {
      background: color-mix(in srgb, var(--accent) 15%, transparent);
      border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    }
    .seg-text { flex: 1; line-height: 1.6; font-size: 1.05rem; }"""
content = content.replace(css_old2, css_new2)

# Update Footer CSS
css_old3 = """    .app-cta-footer {
      margin: 5rem auto 2rem;
      padding: 2rem;
      max-width: 680px;
      border-radius: 16px;
      background: linear-gradient(135deg, color-mix(in srgb, var(--surface) 80%, transparent), color-mix(in srgb, var(--background) 50%, transparent));
      border: 1px solid color-mix(in srgb, var(--border) 60%, var(--accent) 20%);
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 1.5rem;
      box-shadow: 0 12px 32px var(--theme-glow);
    }
    @media (min-width: 600px) {
      .app-cta-footer {
        flex-direction: row;
        text-align: left;
        justify-content: space-between;
        padding: 2.5rem 3rem;
      }
    }
    .cta-content h3 {
      margin: 0 0 0.5rem;
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--foreground);
    }
    .cta-content p {
      margin: 0;
      font-size: 0.95rem;
      line-height: 1.5;
      color: color-mix(in srgb, var(--foreground) 75%, transparent);
    }
    .primary-cta-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.85rem 1.75rem;
      border-radius: 999px;
      background: var(--accent);
      color: #fff;
      font-weight: 600;
      font-size: 1rem;
      text-decoration: none;
      transition: background 0.2s, transform 0.1s;
      white-space: nowrap;
      box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 40%, transparent);
    }
    .primary-cta-btn:hover {
      background: var(--accent-hover);
      transform: translateY(-1px);
      box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 50%, transparent);
    }
    .primary-cta-btn:active {
      transform: translateY(1px);
    }"""

css_new3 = """    .app-cta-footer {
      margin: 4rem auto 2rem;
      padding: 2.5rem;
      max-width: 640px;
      border-radius: 20px;
      background: var(--surface);
      border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 1.5rem;
      box-shadow: 0 8px 24px color-mix(in srgb, black 10%, transparent);
    }
    @media (min-width: 600px) {
      .app-cta-footer {
        flex-direction: row;
        text-align: left;
        justify-content: space-between;
        padding: 3rem;
      }
    }
    .cta-content h3 {
      margin: 0 0 0.25rem;
      font-size: 1.35rem;
      font-weight: 700;
      color: var(--foreground);
    }
    .cta-content p {
      margin: 0;
      font-size: 1rem;
      line-height: 1.5;
      color: color-mix(in srgb, var(--foreground) 70%, transparent);
    }
    .primary-cta-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 1rem 2rem;
      border-radius: 12px;
      background: var(--foreground);
      color: var(--background);
      font-weight: 600;
      font-size: 1.05rem;
      text-decoration: none;
      transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
      white-space: nowrap;
    }
    .primary-cta-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px color-mix(in srgb, var(--foreground) 25%, transparent);
      opacity: 0.95;
    }
    .primary-cta-btn:active {
      transform: translateY(0);
    }"""
content = content.replace(css_old3, css_new3)

# Remove export and search styles
css_old4 = """    .export-transcript-btn, .copy-transcript-btn {
      border: 1px solid color-mix(in srgb, var(--border) 55%, var(--accent) 45%);
      background: transparent;
      color: var(--foreground);
      border-radius: 999px;
      padding: .35rem .72rem;
      font-size: .78rem;
      font-weight: 600;
      cursor: pointer;
    }
    .export-transcript-btn:hover {
      background: color-mix(in srgb, var(--foreground) 6%, transparent);
      border-color: color-mix(in srgb, var(--border) 35%, var(--accent) 65%);
    }
    .export-transcript-btn:focus-visible, .copy-transcript-btn:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--accent) 70%, white 30%);
      outline-offset: 2px;
    }
    .copy-transcript-btn {
      background: transparent;
    }
    .copy-transcript-btn:hover {
      background: color-mix(in srgb, var(--foreground) 6%, transparent);
    }"""

css_new4 = """    .copy-transcript-btn {
      border: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
      background: color-mix(in srgb, var(--surface) 50%, transparent);
      color: var(--foreground);
      border-radius: 999px;
      padding: .4rem .85rem;
      font-size: .8rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .copy-transcript-btn:hover {
      background: color-mix(in srgb, var(--foreground) 8%, transparent);
      border-color: color-mix(in srgb, var(--border) 80%, transparent);
    }
    .copy-transcript-btn:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--accent) 70%, white 30%);
      outline-offset: 2px;
    }"""
content = content.replace(css_old4, css_new4)


# Remove Search CSS
content = re.sub(r'\.transcript-search-row \{[\s\S]*?mark\.search-hit-active \{[\s\S]*?\}', '', content)


# HTML replacement
html_old = """      <div class="transcript-sticky-container">
        ${payload.mediaUrl ? `<audio class="share-audio" controls preload="metadata" src="${escapedAudioUrl}"></audio>` : ""}
        <section aria-labelledby="transcript-heading">
          <div class="transcript-header">
            <h2 id="transcript-heading">Transcript</h2>
            <div class="transcript-header-actions">
              <button type="button" id="copy-transcript-btn" class="copy-transcript-btn">Copy</button>
              <button type="button" id="export-transcript-btn" class="export-transcript-btn">Export</button>
            </div>
          </div>
          <div class="transcript-search-row">
            <input type="text" id="transcript-search" class="transcript-search-input" placeholder="Search transcript…" aria-label="Search transcript" autocomplete="off" />
            <span id="search-match-count" class="search-match-count" aria-live="polite" aria-atomic="true"></span>
            <button id="search-prev" class="search-nav-btn" aria-label="Previous match" disabled>↑</button>
            <button id="search-next" class="search-nav-btn" aria-label="Next match" disabled>↓</button>
          </div>
        </section>
      </div>"""

html_new = """      <div class="transcript-sticky-container">
        ${payload.mediaUrl ? `<audio class="share-audio" controls preload="metadata" src="${escapedAudioUrl}"></audio>` : ""}
        <section aria-labelledby="transcript-heading">
          <div class="transcript-header">
            <h2 id="transcript-heading">Transcript</h2>
            <div class="transcript-header-actions">
              <button type="button" id="copy-transcript-btn" class="copy-transcript-btn">Copy</button>
            </div>
          </div>
        </section>
      </div>"""
content = content.replace(html_old, html_new)


# Footer HTML replacement
footer_old = """  <footer class="app-cta-footer" aria-label="MomentumUploader app call to action">
    <div class="cta-content">
      <h3>Accurate memory & summaries</h3>
      <p>Join MomentumUploader to record, transcribe, and remember everything.</p>
    </div>
    <a href="/sign-up" class="primary-cta-btn">Create account</a>
  </footer>"""

footer_new = """  <footer class="app-cta-footer" aria-label="MomentumUploader app call to action">
    <div class="cta-content">
      <h3>MomentumUploader</h3>
      <p>Record, transcribe, and remember everything.</p>
    </div>
    <a href="/sign-up" class="primary-cta-btn">Create your free account</a>
  </footer>"""
content = content.replace(footer_old, footer_new)

# JS replacement for Export
js_export_old = """      const exportButton = document.getElementById("export-transcript-btn");"""
content = content.replace(js_export_old, "")

js_export_old2 = """      if (exportButton) {
        exportButton.addEventListener("click", () => {
          const transcriptContent = getTranscriptContent();
          if (!transcriptContent) return;
          const transcript = transcriptContent.textContent || "";
          const fileName =
            shareBoot && typeof shareBoot.transcriptFileName === "string"
              ? shareBoot.transcriptFileName
              : "shared-transcript.txt";
          const blob = new Blob([transcript], { type: "text/plain;charset=utf-8" });
          const downloadUrl = URL.createObjectURL(blob);
          const downloadLink = document.createElement("a");
          downloadLink.href = downloadUrl;
          downloadLink.download = fileName;
          document.body.appendChild(downloadLink);
          downloadLink.click();
          downloadLink.remove();
          URL.revokeObjectURL(downloadUrl);
        });
      }"""
content = content.replace(js_export_old2, "")

# Remove Search JS
search_js = re.search(r'\(\(\) => \{\n      const searchInput = document\.getElementById\("transcript-search"\);[\s\S]*?\}\)\(\);\n', content)
if search_js:
    content = content.replace(search_js.group(0), "")

with open('src/lib/share-contract.ts', 'w') as f:
    f.write(content)

