import re

with open('src/lib/share-contract.ts', 'r') as f:
    content = f.read()

start_html_idx = content.find('<!doctype html>')
end_html_idx = content.find('</html>`;\n}', start_html_idx) + 9

if start_html_idx == -1 or end_html_idx == -1:
    print("Could not find HTML")
    exit(1)

original_html = content[start_html_idx:end_html_idx]

# Extract comments-root
comments_match = re.search(r'(<section id="comments-root">.*?</section>\n      </section>)', original_html, re.DOTALL)
if not comments_match:
    print("Could not find comments-root")
    exit(1)
comments_html = comments_match.group(1)

# Extract scripts (except the momentum-share-agent-handoff in head which we can just recreate)
scripts_match = re.search(r'(<script id="share-boot".*?</script>\n</body>\n</html>)', original_html, re.DOTALL)
if not scripts_match:
    print("Could not find scripts")
    exit(1)
scripts_html = scripts_match.group(1)

new_html = r'''<!doctype html>
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
      color-scheme: dark;
      --background: ${DEFAULT_THEME.vars.background};
      --foreground: ${DEFAULT_THEME.vars.foreground};
      --accent: ${DEFAULT_THEME.vars.accent};
      --accent-hover: ${DEFAULT_THEME.vars.accentHover};
      --surface: ${DEFAULT_THEME.vars.surface};
      --border: ${DEFAULT_THEME.vars.border};
      --theme-glow: ${DEFAULT_THEME.vars.glow};
      --theme-glass-bg: ${DEFAULT_THEME.vars.glassBg};
      --theme-neo-blur: ${DEFAULT_THEME.vars.neoBlur};
      --font-sans: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, monospace;
    }
    
    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: var(--font-sans);
      background: #121212;
      color: rgba(255, 255, 255, 0.9);
      line-height: 1.6;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      display: flex;
      flex-direction: column;
    }

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
    }

    .app-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.5rem 2rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
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
      margin: 0;
      line-height: 1.2;
    }

    .header-meta {
      font-size: 0.75rem;
      color: rgba(255, 255, 255, 0.35);
      font-family: var(--font-mono);
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
      color: #f97316;
      border-color: rgba(249, 115, 22, 0.3);
      background: rgba(249, 115, 22, 0.1);
    }

    .content-area {
      flex: 1;
      padding: 2.5rem 2rem;
      display: flex;
      flex-direction: column;
    }

    .content-max-width {
      margin: 0 auto;
      width: 100%;
      max-width: 60rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .transcript-card {
      border-radius: 1rem;
      border: 1px solid rgba(255, 255, 255, 0.05);
      background: rgba(255, 255, 255, 0.02);
      overflow: hidden;
    }

    .transcript {
      padding: 1.5rem 1.25rem;
      font-size: 1.125rem;
      line-height: 1.75;
      color: rgba(255, 255, 255, 0.8);
    }

    .transcript-block {
      margin-bottom: 1.25rem;
    }
    
    .transcript-segment {
      display: flex;
      gap: 1rem;
      align-items: flex-start;
      border-radius: 0.5rem;
      padding: 0.75rem;
      transition: background 0.15s;
    }
    .transcript-segment:hover {
      background: rgba(255, 255, 255, 0.03);
    }
    .transcript-segment.active {
      background: rgba(249, 115, 22, 0.1);
    }

    .ts-btn {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: rgba(255, 255, 255, 0.35);
      background: transparent;
      border: none;
      padding-top: 0.25rem;
      width: 3.5rem;
      text-align: left;
      cursor: pointer;
    }
    .ts-btn:hover { color: #f97316; }

    .seg-text { flex: 1; }

    .app-cta-footer {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
      padding: 2rem;
      border-radius: 1rem;
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      margin-top: 2rem;
    }

    .cta-content h3 {
      margin: 0 0 0.25rem;
      font-size: 1.125rem;
      font-weight: 600;
    }
    .cta-content p {
      margin: 0;
      font-size: 0.875rem;
      color: rgba(255, 255, 255, 0.5);
    }
    .primary-cta-btn {
      padding: 0.75rem 1.5rem;
      border-radius: 0.75rem;
      background: white;
      color: black;
      font-weight: 600;
      font-size: 0.875rem;
      text-decoration: none;
      transition: all 0.2s;
    }
    .primary-cta-btn:hover {
      transform: translateY(-2px);
      opacity: 0.95;
    }

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
    .progress-wrapper { display: flex; flex-direction: column; gap: 0.5rem; }
    .progress-bar-bg {
      width: 100%; height: 0.375rem; background: rgba(255, 255, 255, 0.05); border-radius: 9999px; cursor: pointer; position: relative;
    }
    .progress-bar-fill {
      position: absolute; left: 0; top: 0; height: 100%; background: #f97316; box-shadow: 0 0 12px #f97316; transition: width 0.1s linear;
    }
    .time-display {
      display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 0.6875rem; color: rgba(255, 255, 255, 0.2);
    }
    .play-controls { display: flex; justify-content: center; }
    .play-btn {
      position: relative; width: 4rem; height: 4rem; border-radius: 9999px; cursor: pointer; border: none; background: transparent; padding: 0; transition: transform 0.3s;
    }
    .play-btn:hover { transform: scale(1.05); }
    .play-bg-base {
      position: absolute; inset: 0; border-radius: 9999px; background: #121212; border: 1px solid rgba(255, 255, 255, 0.05); box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    }
    .play-icon-container {
      position: absolute; inset: 22%; border-radius: 9999px; display: flex; align-items: center; justify-content: center; background: rgba(255, 255, 255, 0.1); color: white; transition: all 0.3s;
    }
    .play-btn:hover .play-icon-container { background: white; color: black; }
    #native-audio { display: none; }
    
    /* Legacy discussion styles preserved */
    .disc-section { margin-top: 3rem; padding-top: 2rem; border-top: 1px solid rgba(255,255,255,0.1); }
    .disc-heading { margin: 0 0 1rem; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.5; }
    .disc-loading, .disc-empty { margin: 0; color: rgba(255,255,255,0.5); }
    .disc-msg { padding: 1rem 0; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .disc-meta { display: flex; align-items: center; gap: 0.6rem; font-size: 0.85rem; margin-bottom: 0.45rem; }
    .disc-author-row { display: inline-flex; align-items: center; gap: 0.45rem; }
    .disc-avatar { width: 1.85rem; height: 1.85rem; border-radius: 999px; object-fit: cover; }
    .disc-avatar-fallback { display: inline-flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.1); font-weight: 700; color: white; }
    .disc-author { font-weight: 600; color: white; }
    .disc-time { color: #f97316; }
    .disc-content { margin: 0; white-space: pre-wrap; color: white; }
    .disc-form { margin-top: 1.25rem; }
    .disc-form textarea { width: 100%; min-height: 5.5rem; background: transparent; border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 0.8rem; color: white; font: inherit; }
    .disc-form textarea:focus { outline: none; border-color: #f97316; }
    .disc-form-row { margin-top: 0.75rem; display: flex; justify-content: space-between; align-items: center; }
    .disc-form button, .ts-link { border: 1px solid rgba(255,255,255,0.2); background: transparent; color: white; border-radius: 999px; padding: 0.35rem 0.75rem; cursor: pointer; }
    .disc-form button:hover, .ts-link:hover { background: rgba(255,255,255,0.1); }
    .disc-error { color: #fca5a5; font-size: 0.78rem; }
    #openclaw-widget { display: none !important; }
    
    .oc-widget { display: flex; flex-direction: column; gap: 0.55rem; }
    .oc-claimed-actions { display: flex; flex-wrap: wrap; gap: 0.6rem; }
    .oc-label, .oc-hint, .oc-status { margin: 0; font-size: 0.9rem; color: rgba(255,255,255,0.6); }
    .oc-status { display: inline-flex; align-items: center; gap: 0.45rem; font-weight: 600; }
    #openclaw-widget button { width: fit-content; border: 1px solid rgba(255,255,255,0.2); background: transparent; color: white; border-radius: 999px; padding: 0.35rem 0.75rem; font-size: 0.78rem; cursor: pointer; }
    #openclaw-widget button:hover { background: rgba(255,255,255,0.1); }
    .oc-preview { display: none; gap: 0.75rem; padding: 1rem; border-radius: 18px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); }
    .oc-preview-title { margin: 0; font-size: 0.82rem; font-weight: 700; color: white; }
    .oc-preview-text { margin: 0; padding: 0.85rem 0.95rem; border-radius: 14px; border: 1px solid rgba(255,255,255,0.1); background: #000; color: #f97316; white-space: pre-wrap; word-break: break-word; font-family: monospace; font-size: 0.82rem; }
    .oc-preview-steps { margin: 0; padding-left: 1.35rem; display: grid; gap: 0.38rem; color: rgba(255,255,255,0.6); font-size: 0.86rem; }
    .oc-preview-steps li::marker { color: #f97316; font-weight: 700; }
    #oc-reg-section { margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; gap: 0.45rem; }
    .oc-reg-hint { font-size: 0.75rem; color: rgba(255,255,255,0.5); margin: 0; }
    .oc-reg-token-block { font-family: monospace; font-size: 0.78rem; background: rgba(255,255,255,0.1); padding: 0.4rem 0.6rem; border-radius: 4px; word-break: break-all; color: white; }
    .oc-reg-warn { font-size: 0.72rem; color: rgba(255,255,255,0.5); }
    #oc-ask-dialog { display: none; margin-top: 0.35rem; gap: 0.6rem; }
    #oc-ask-input { width: 100%; min-height: 4.2rem; resize: vertical; box-sizing: border-box; background: transparent; border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 0.8rem; color: white; font: inherit; }
    #oc-ask-input:focus { outline: none; border-color: #f97316; }
    #disc-signin, #disc-owner-only { margin-top: 1rem; color: rgba(255,255,255,0.5); }
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
            ${transcriptContentHtml}
          </div>

          ''' + comments_html + r'''

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
          <div class="play-bg-base"></div>
          <div class="play-icon-container" id="play-icon-container">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: translateX(1px);"><polygon points="6 3 20 12 6 21 6 3"/></svg>
          </div>
        </button>
      </div>
    </div>
  </div>
  ` : ""}

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

          const nowMs = audio.currentTime * 1000;
          document.querySelectorAll('.transcript-segment').forEach(seg => {
            const start = Number(seg.getAttribute('data-start'));
            const end = Number(seg.getAttribute('data-end'));
            if (nowMs >= start && nowMs < end) {
              seg.classList.add('active');
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
      }
    })();
  </script>
''' + scripts_html

new_content = content[:start_html_idx] + new_html + content[end_html_idx:]

with open('src/lib/share-contract.ts', 'w') as f:
    f.write(new_content)
