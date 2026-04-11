import re

with open('src/lib/share-contract.ts', 'r') as f:
    content = f.read()

# We want to replace buildSharedArtifactHtml and the inline CSS/JS.
# It's better to just replace the whole return statement of buildSharedArtifactHtml.

start_str = '  return `<!doctype html>'
end_str = '</html>`;\n}'

start_idx = content.find(start_str)
end_idx = content.find(end_str) + len(end_str)

if start_idx == -1 or end_idx == -1:
    print("Could not find buildSharedArtifactHtml template")
    exit(1)

new_html = r'''  return `<!doctype html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapedTitle} | Shared ${escapedArtifactType}</title>
  <meta name="description" content="Shared ${escapedArtifactType} from MomentumUploader" />
  <link rel="canonical" href="${escapedCanonicalUrl}" />
  <link rel="alternate" type="text/markdown" href="${encodedMarkdown}" />
  <link rel="alternate" type="application/json" href="${encodedJson}" />
  <meta name="momentum:share-agent-handoff" content="available" />
  <script id="momentum-share-agent-handoff" type="application/json">${serializedAgentHandoffPayload}</script>
  <style>
    /* Import Geist font */
    @font-face {
      font-family: 'Geist';
      src: url('https://cdn.jsdelivr.net/npm/geist@1.0.3/dist/fonts/geist-sans/Geist-Regular.woff2') format('woff2');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Geist';
      src: url('https://cdn.jsdelivr.net/npm/geist@1.0.3/dist/fonts/geist-sans/Geist-SemiBold.woff2') format('woff2');
      font-weight: 600;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Geist Mono';
      src: url('https://cdn.jsdelivr.net/npm/geist@1.0.3/dist/fonts/geist-mono/GeistMono-Regular.woff2') format('woff2');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }

    :root {
      --background: #121212;
      --foreground: #fff;
      --accent: #f97316;
      --accent-hover: #ea6c0a;
      --surface: #1a1a1a;
      --border: rgba(255, 255, 255, 0.05);
      --font-sans: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, monospace;
    }
    
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: var(--font-sans);
      background: var(--background);
      color: rgba(255, 255, 255, 0.9);
      line-height: 1.6;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      display: flex;
      flex-direction: column;
    }

    /* Layout to match app */
    .app-layout {
      display: flex;
      height: 100vh;
      width: 100%;
      background: #0A0A0A;
      overflow: hidden;
    }

    .main-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      position: relative;
      background: #121212;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.1) transparent;
    }

    /* Header */
    .app-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.5rem 2rem;
      border-bottom: 1px solid var(--border);
      background: rgba(18, 18, 18, 0.5);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .header-title-row {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .header-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.9);
      margin: 0;
      line-height: 1.2;
    }

    .header-meta {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.75rem;
      color: rgba(255, 255, 255, 0.35);
      font-family: var(--font-mono);
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .copy-btn {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.75rem;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.55);
      padding: 0.375rem 0.75rem;
      border-radius: 9999px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .copy-btn:hover {
      color: var(--accent);
      border-color: rgba(249, 115, 22, 0.3);
      background: rgba(249, 115, 22, 0.1);
    }

    /* Content Area */
    .content-area {
      flex: 1;
      padding: 2.5rem 2rem;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    .content-max-width {
      margin: 0 auto;
      width: 100%;
      max-width: 80rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    /* Transcript Card */
    .transcript-card {
      border-radius: 1rem;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.02);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .transcript-scroll {
      padding: 1.5rem 1.25rem;
      font-size: 1.125rem;
      line-height: 1.75;
      color: rgba(255, 255, 255, 0.8);
      overflow-y: auto;
    }

    .transcript-block {
      margin-bottom: 1.25rem;
    }
    
    .transcript-block:last-child {
      margin-bottom: 0;
    }

    .transcript-segment {
      display: flex;
      gap: 1rem;
      align-items: flex-start;
      border-radius: 0.5rem;
      padding: 0.75rem 0.75rem;
      transition: background 0.15s;
    }

    .transcript-segment:hover {
      background: rgba(255, 255, 255, 0.03);
    }

    .transcript-segment.active {
      background: rgba(249, 115, 22, 0.1);
    }

    .ts-pill {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: rgba(255, 255, 255, 0.35);
      text-transform: uppercase;
      letter-spacing: 0.025em;
      padding-top: 0.25rem;
      flex-shrink: 0;
      width: 3.5rem;
      cursor: pointer;
    }
    
    .ts-pill:hover {
      color: var(--accent);
    }

    .seg-text {
      flex: 1;
    }

    /* Custom Audio Player Footer */
    .audio-footer {
      background: #161616;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding: 1.25rem 2rem;
      box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
      z-index: 10;
      margin-top: auto;
    }

    .audio-container {
      max-width: 48rem;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .progress-wrapper {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .progress-bar-bg {
      width: 100%;
      height: 0.375rem;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 9999px;
      cursor: pointer;
      position: relative;
      overflow: hidden;
    }

    .progress-bar-fill {
      position: absolute;
      left: 0;
      top: 0;
      height: 100%;
      background: var(--accent);
      box-shadow: 0 0 12px var(--accent);
      transition: width 0.1s linear;
    }

    .time-display {
      display: flex;
      justify-content: space-between;
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      color: rgba(255, 255, 255, 0.2);
      text-transform: uppercase;
    }

    .play-controls {
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .play-btn {
      position: relative;
      width: 4rem;
      height: 4rem;
      border-radius: 9999px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      border: none;
      background: transparent;
      padding: 0;
      transition: transform 0.3s;
    }

    .play-btn:hover {
      transform: scale(1.05);
    }
    
    .play-btn:active {
      transform: scale(0.95);
    }

    .play-bg-blur {
      position: absolute;
      inset: 0;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.05);
      filter: blur(12px);
      transition: opacity 0.5s;
    }

    .play-btn:hover .play-bg-blur {
      background: rgba(255, 255, 255, 0.1);
    }

    .play-bg-base {
      position: absolute;
      inset: 0;
      border-radius: 9999px;
      background: #121212;
      border: 1px solid rgba(255, 255, 255, 0.05);
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    }

    .play-ring-1 {
      position: absolute;
      inset: 0.25rem;
      border-radius: 9999px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      background: rgba(255, 255, 255, 0.02);
    }

    .play-ring-2 {
      position: absolute;
      inset: 0.625rem;
      border-radius: 9999px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.05);
      transition: all 0.3s;
    }

    .play-icon-container {
      position: absolute;
      inset: 22%;
      border-radius: 9999px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.1);
      color: white;
      transition: all 0.3s;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    }

    .play-btn:hover .play-icon-container {
      background: white;
      color: black;
    }

    /* Hidden native audio */
    #native-audio {
      display: none;
    }

    /* Signup CTA Footer */
    .app-cta-footer {
      background: var(--surface);
      border: 1px solid var(--border);
      padding: 2rem;
      border-radius: 1rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 1.25rem;
      margin-top: 2rem;
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
      margin: 0 0 0.25rem;
      font-size: 1.125rem;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.9);
    }

    .cta-content p {
      margin: 0;
      font-size: 0.875rem;
      color: rgba(255, 255, 255, 0.5);
    }

    .primary-cta-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.75rem 1.5rem;
      border-radius: 0.75rem;
      background: white;
      color: black;
      font-weight: 600;
      font-size: 0.875rem;
      text-decoration: none;
      transition: all 0.2s;
      white-space: nowrap;
    }

    .primary-cta-btn:hover {
      transform: translateY(-2px);
      opacity: 0.95;
    }
  </style>
</head>
<body>
  <div class="app-layout">
    <div class="main-content" id="main-scroll">
      <header class="app-header">
        <div class="header-title-row">
          <h2 class="header-title">${escapedTitle}</h2>
          <div class="header-meta">
            <span>${payload.createdAt ? new Date(payload.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''}</span>
          </div>
        </div>
        <div class="header-actions">
          <button type="button" id="copy-transcript-btn" class="copy-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span class="copy-text">Copy link</span>
          </button>
        </div>
      </header>

      <div class="content-area">
        <div class="content-max-width">
          <div class="transcript-card">
            <div class="transcript-scroll" id="transcript-content">
              ${payload.transcriptSegments?.length ? 
                payload.transcriptSegments.map(seg => `
                  <div class="transcript-segment" id="t-${seg.startMs}" data-start="${seg.startMs}" data-end="${seg.endMs}">
                    <div class="ts-pill" data-seek="${seg.startMs}">${formatMs(seg.startMs)}</div>
                    <div class="seg-text">${escapeHtml(seg.text)}</div>
                  </div>
                `).join("")
                : 
                escapeHtml(payload.transcript || "(no transcript)")
                  .split(/\\n\\s*\\n/)
                  .map(p => p.trim())
                  .filter(p => p.length > 0)
                  .map(p => \`<div class="transcript-block">\${p}</div>\`)
                  .join("\\n")
              }
            </div>
          </div>

          <footer class="app-cta-footer">
            <div class="cta-content">
              <h3>MomentumUploader</h3>
              <p>Record, transcribe, and remember everything.</p>
            </div>
            <a href="/sign-up" class="primary-cta-btn">Create free account</a>
          </footer>
        </div>
      </div>
    </div>
  </div>

  ${payload.mediaUrl ? `
  <audio id="native-audio" src="${escapedAudioUrl}" preload="metadata"></audio>
  <div class="audio-footer">
    <div class="audio-container">
      <div class="progress-wrapper">
        <div class="progress-bar-bg" id="progress-container">
          <div class="progress-bar-fill" id="progress-fill" style="width: 0%"></div>
        </div>
        <div class="time-display">
          <span id="time-current">0:00</span>
          <span id="time-duration">--:--</span>
        </div>
      </div>
      <div class="play-controls">
        <button id="play-btn" class="play-btn">
          <div class="play-bg-blur"></div>
          <div class="play-bg-base"></div>
          <div class="play-ring-1"></div>
          <div class="play-ring-2"></div>
          <div class="play-icon-container" id="play-icon-container">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: translateX(1px);"><polygon points="6 3 20 12 6 21 6 3"/></svg>
          </div>
        </button>
      </div>
    </div>
  </div>
  ` : ""}

  <script id="share-boot" type="application/json">${serializedBootPayload}</script>
  <script>
    (() => {
      const copyBtn = document.getElementById('copy-transcript-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(window.location.href);
          const span = copyBtn.querySelector('.copy-text');
          const original = span.textContent;
          span.textContent = 'Copied!';
          setTimeout(() => span.textContent = original, 2000);
        });
      }

      // Audio Player Logic
      const audio = document.getElementById('native-audio');
      if (audio) {
        const playBtn = document.getElementById('play-btn');
        const playIconContainer = document.getElementById('play-icon-container');
        const timeCurrent = document.getElementById('time-current');
        const timeDuration = document.getElementById('time-duration');
        const progressContainer = document.getElementById('progress-container');
        const progressFill = document.getElementById('progress-fill');
        
        const playIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: translateX(1px);"><polygon points="6 3 20 12 6 21 6 3"/></svg>';
        const pauseIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="4" width="4" height="16"/><rect x="6" y="4" width="4" height="16"/></svg>';

        function formatTime(sec) {
          if (isNaN(sec)) return '--:--';
          const m = Math.floor(sec / 60);
          const s = Math.floor(sec % 60);
          return m + ':' + (s < 10 ? '0' : '') + s;
        }

        audio.addEventListener('loadedmetadata', () => {
          timeDuration.textContent = formatTime(audio.duration);
        });

        audio.addEventListener('timeupdate', () => {
          timeCurrent.textContent = formatTime(audio.currentTime);
          const percent = (audio.currentTime / audio.duration) * 100 || 0;
          progressFill.style.width = percent + '%';

          // Highlight transcript segment
          const nowMs = audio.currentTime * 1000;
          document.querySelectorAll('.transcript-segment').forEach(seg => {
            const start = Number(seg.getAttribute('data-start'));
            const end = Number(seg.getAttribute('data-end'));
            if (nowMs >= start && nowMs < end) {
              seg.classList.add('active');
              // Optional auto-scroll: seg.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
              seg.classList.remove('active');
            }
          });
        });

        playBtn.addEventListener('click', () => {
          if (audio.paused) {
            audio.play();
          } else {
            audio.pause();
          }
        });

        audio.addEventListener('play', () => {
          playIconContainer.innerHTML = pauseIcon;
        });

        audio.addEventListener('pause', () => {
          playIconContainer.innerHTML = playIcon;
        });

        progressContainer.addEventListener('click', (e) => {
          const rect = progressContainer.getBoundingClientRect();
          const pos = (e.clientX - rect.left) / rect.width;
          audio.currentTime = pos * audio.duration;
        });

        // Click timestamps to seek
        document.querySelectorAll('.ts-pill').forEach(btn => {
          btn.addEventListener('click', () => {
            const ms = Number(btn.getAttribute('data-seek'));
            audio.currentTime = ms / 1000;
            audio.play();
          });
        });
      }
    })();
  </script>
</body>
</html>`;
}
'''

content = content[:start_idx] + new_html + content[end_idx:]

with open('src/lib/share-contract.ts', 'w') as f:
    f.write(content)
