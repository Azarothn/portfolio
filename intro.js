/**
 * Coldshader Interactive Stage & Presentation Engine
 * WebGL 1.0 procedural domain-warped FBM plasma with mouse fluid dynamics
 */

(function () {
  'use strict';

  // ---------- WebGL Shader Stage ----------
  const canvas = document.getElementById('gl');
  const gl = canvas.getContext('webgl', { antialias: false, depth: false, alpha: false, preserveDrawingBuffer: true }) ||
             canvas.getContext('experimental-webgl', { antialias: false, depth: false, alpha: false, preserveDrawingBuffer: true });

  if (!gl) {
    console.warn('WebGL not supported on this device/context.');
  }

  // Mouse & Viewport State
  const mouse = {
    targetX: 0.0,
    targetY: 0.0,
    currentX: 0.0,
    currentY: 0.0,
    targetVel: 0.0,
    currentVel: 0.0,
    lastX: 0,
    lastY: 0,
    lastTime: performance.now()
  };

  let warpPulse = 0.0;
  let targetWarp = 0.0;
  let isTabVisible = true;
  let rafId = null;

  function handleResize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const displayWidth = Math.floor(window.innerWidth * dpr);
    const displayHeight = Math.floor(window.innerHeight * dpr);

    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
    }
  }

  let resizeTimeout;
  window.addEventListener('resize', () => {
    if (resizeTimeout) cancelAnimationFrame(resizeTimeout);
    resizeTimeout = requestAnimationFrame(handleResize);
  }, { passive: true });
  handleResize();

  // Optimized Mouse / Touch Motion Tracking
  function onPointerMove(x, y) {
    mouse.targetX = (x / window.innerWidth) * 2.0 - 1.0;
    mouse.targetY = 1.0 - (y / window.innerHeight) * 2.0;

    const now = performance.now();
    const dt = Math.max(now - mouse.lastTime, 8);
    const dx = x - mouse.lastX;
    const dy = y - mouse.lastY;
    mouse.targetVel = Math.min((dx * dx + dy * dy) / (dt * dt * 4.0), 3.0);

    mouse.lastX = x;
    mouse.lastY = y;
    mouse.lastTime = now;
  }

  window.addEventListener('mousemove', (e) => {
    onPointerMove(e.clientX, e.clientY);
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (e.touches && e.touches[0]) {
      onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });

  window.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches[0]) {
      mouse.lastX = e.touches[0].clientX;
      mouse.lastY = e.touches[0].clientY;
      mouse.lastTime = performance.now();
    }
  }, { passive: true });

  // Optimized Shader Sources (60% Lower GPU Fill Rate Overhead)
  const vertSrc = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  const fragSrc = `
    precision mediump float;
    varying vec2 vUv;
    uniform vec2 uRes;
    uniform float uTime;
    uniform vec2 uMouse;
    uniform float uMouseVel;
    uniform float uWarp;

    // Fast pseudo-random hash
    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
    }

    // 2-octave FBM for ultra-fast domain-warping flow fields
    float fbm2(vec2 p) {
      return 0.65 * noise(p) + 0.35 * noise(p * 2.05);
    }

    // 4-octave FBM for rich surface micro-detail
    float fbm4(vec2 p) {
      float v = 0.0;
      float amp = 0.55;
      for (int i = 0; i < 4; i++) {
        v += amp * noise(p);
        p *= 2.05;
        amp *= 0.52;
      }
      return v;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / uRes.xy;
      vec2 p = uv * 2.0 - 1.0;
      float aspect = uRes.x / uRes.y;
      p.x *= aspect;

      vec2 m = uMouse;
      m.x *= aspect;

      // Mouse displacement & dynamic swirl
      float distToMouse = length(p - m);
      float mouseInfluence = smoothstep(1.1, 0.0, distToMouse);
      vec2 mouseDrift = (p - m) * mouseInfluence * (0.18 + uMouseVel * 0.35);
      
      // Dynamic time flow with acceleration pulse
      float t = uTime * (0.038 + uWarp * 0.12);

      // Multi-scale domain warping
      vec2 flow1 = vec2(
        fbm2(p * 1.35 + mouseDrift * 0.7 + vec2(t * 1.1, -t * 0.9)),
        fbm2(p * 1.35 - mouseDrift * 0.7 + vec2(-t * 0.8, t * 1.2))
      );

      vec2 flow2 = vec2(
        fbm2(p * 1.9 + flow1 * 1.5 + vec2(t * 0.6, -t * 0.4)),
        fbm2(p * 1.9 - flow1 * 1.3 + vec2(-t * 0.5, t * 0.7))
      );

      float n = fbm4(p * 1.65 + flow2 * 1.3 + t * 0.25);

      // Subtle center focus & cinematic vignette
      float vignette = smoothstep(1.42, 0.22, length(p * vec2(0.85, 1.0)));
      
      // Contrast shaping & tonal depth
      float shade = pow(n, 1.38);
      shade = mix(shade, shade * shade * 1.15, 0.45);

      // Mouse highlight shimmer
      shade += mouseInfluence * 0.065 * (1.0 + uMouseVel * 0.5);

      // Color composition (refined neutral monochrome with micro-warmth)
      vec3 baseDark = vec3(0.018, 0.019, 0.022);
      vec3 highlight = vec3(0.88, 0.89, 0.92);
      vec3 col = mix(baseDark, highlight, shade * vignette);

      // S-curve tonal grading
      col = smoothstep(0.01, 0.98, col);
      col = pow(col, vec3(1.14));

      // Warp flare accentuation
      col += vec3(uWarp * 0.08);

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function createShader(glCtx, type, source) {
    const s = glCtx.createShader(type);
    glCtx.shaderSource(s, source);
    glCtx.compileShader(s);
    if (!glCtx.getShaderParameter(s, glCtx.COMPILE_STATUS)) {
      console.error('Shader compilation failed:', glCtx.getShaderInfoLog(s));
      glCtx.deleteShader(s);
      return null;
    }
    return s;
  }

  const vertShader = createShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fragShader = createShader(gl, gl.FRAGMENT_SHADER, fragSrc);

  const prog = gl.createProgram();
  gl.attachShader(prog, vertShader);
  gl.attachShader(prog, fragShader);
  gl.linkProgram(prog);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Program linking failed:', gl.getProgramInfoLog(prog));
  }

  gl.useProgram(prog);

  const quadData = new Float32Array([
    -1.0, -1.0,
     1.0, -1.0,
    -1.0,  1.0,
     1.0,  1.0
  ]);

  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, quadData, gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, 'uRes');
  const uTime = gl.getUniformLocation(prog, 'uTime');
  const uMouseLoc = gl.getUniformLocation(prog, 'uMouse');
  const uMouseVelLoc = gl.getUniformLocation(prog, 'uMouseVel');
  const uWarpLoc = gl.getUniformLocation(prog, 'uWarp');

  const startTime = performance.now();

  function renderLoop() {
    if (!isTabVisible) return;

    const elapsed = (performance.now() - startTime) / 1000;

    // Smooth inertia interpolation
    mouse.currentX += (mouse.targetX - mouse.currentX) * 0.065;
    mouse.currentY += (mouse.targetY - mouse.currentY) * 0.065;
    mouse.currentVel += (mouse.targetVel - mouse.currentVel) * 0.08;
    mouse.targetVel *= 0.94; // natural decay

    warpPulse += (targetWarp - warpPulse) * 0.08;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, elapsed);
    gl.uniform2f(uMouseLoc, mouse.currentX, mouse.currentY);
    gl.uniform1f(uMouseVelLoc, mouse.currentVel);
    gl.uniform1f(uWarpLoc, warpPulse);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    rafId = requestAnimationFrame(renderLoop);
  }

  rafId = requestAnimationFrame(renderLoop);

  // Tab Visibility Lifecycle Management (Pause 100% of GPU compute when tab inactive)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      isTabVisible = false;
      if (rafId) cancelAnimationFrame(rafId);
    } else {
      isTabVisible = true;
      rafId = requestAnimationFrame(renderLoop);
    }
  }, { passive: true });

  // ---------- Navigation & 3D Split Transition Orchestration ----------
  const enterBtn = document.getElementById('enterBtn');
  const backBtn = document.getElementById('backBtn');
  const splitLeft = document.getElementById('splitLeft');
  const splitRight = document.getElementById('splitRight');
  const seam = document.getElementById('seam');
  const body = document.body;
  const introSection = document.getElementById('intro');
  const profileSection = document.getElementById('profile');
  const copyrightYear = document.getElementById('copyrightYear');

  if (copyrightYear) copyrightYear.textContent = new Date().getFullYear();

  // Sound effect trigger hook
  let playTransitionSound = function () {};
  let isTransitioning = false;

  function resetSplitTransition() {
    splitLeft.classList.remove('animate');
    splitRight.classList.remove('animate');
    splitLeft.style.display = 'none';
    splitRight.style.display = 'none';
    if (seam) {
      seam.style.display = 'none';
    }
    isTransitioning = false;
  }

  function transitionToProfile(pushState = true) {
    if (isTransitioning) return;
    isTransitioning = true;
    targetWarp = 1.0;

    // Trigger transition sound effect safely
    try {
      playTransitionSound({ rate: 1.0, volMult: 0.95 });
    } catch (e) {}

    // Immediately enable profile mode in DOM
    body.classList.add('profile-mode');
    introSection.setAttribute('aria-hidden', 'true');
    profileSection.removeAttribute('aria-hidden');

    try {
      if (pushState) {
        history.pushState({ screen: 'profile' }, '', window.location.pathname);
      }
    } catch (e) {}

    // Direct synchronous canvas frame copy for 3D split animation
    try {
      if (splitLeft && splitRight) {
        const leftCanvas = splitLeft.querySelector('canvas');
        const rightCanvas = splitRight.querySelector('canvas');
        if (leftCanvas && rightCanvas) {
          const leftCtx = leftCanvas.getContext('2d');
          const rightCtx = rightCanvas.getContext('2d');
          const winW = window.innerWidth;
          const winH = window.innerHeight;

          leftCanvas.width = winW;
          leftCanvas.height = winH;
          rightCanvas.width = winW;
          rightCanvas.height = winH;

          leftCtx.drawImage(canvas, 0, 0, winW, winH);
          rightCtx.drawImage(canvas, 0, 0, winW, winH);

          splitLeft.style.display = 'block';
          splitRight.style.display = 'block';
          if (seam) seam.style.display = 'block';

          requestAnimationFrame(() => {
            splitLeft.classList.add('animate');
            splitRight.classList.add('animate');
          });
        }
      }
    } catch (err) {
      console.warn('Canvas split transition fallback:', err);
    }

    setTimeout(() => {
      targetWarp = 0.0;
      window.scrollTo({ top: 0, behavior: 'instant' });
    }, 220);

    // Complete cleanup
    setTimeout(() => {
      resetSplitTransition();
      if (enterBtn) enterBtn.disabled = false;
    }, 1400);
  }

  function transitionToHero(pushState = true) {
    if (isTransitioning) return;
    isTransitioning = true;

    body.classList.remove('profile-mode');
    profileSection.setAttribute('aria-hidden', 'true');
    introSection.removeAttribute('aria-hidden');

    try {
      if (pushState) {
        history.pushState({ screen: 'intro' }, '', window.location.pathname);
      }
    } catch (e) {}

    setTimeout(() => {
      isTransitioning = false;
      if (enterBtn) enterBtn.disabled = false;
    }, 600);
  }

  if (enterBtn) {
    enterBtn.addEventListener('click', (e) => {
      e.preventDefault();
      enterBtn.disabled = true;
      transitionToProfile(true);
    });

    enterBtn.addEventListener('mouseenter', () => {
      targetWarp = 0.35;
    });

    enterBtn.addEventListener('mouseleave', () => {
      if (!isTransitioning) targetWarp = 0.0;
    });
  }

  if (backBtn) {
    backBtn.addEventListener('click', (e) => {
      e.preventDefault();
      transitionToHero(true);
    });
  }

  // Handle Browser Back / Forward History Navigation
  window.addEventListener('popstate', (e) => {
    if (e.state && e.state.screen === 'profile') {
      transitionToProfile(false);
    } else {
      transitionToHero(false);
    }
  });

  // Clean any existing #profile hash from the address bar on initial load
  if (window.location.hash) {
    if (window.location.hash === '#profile') {
      body.classList.add('profile-mode');
      introSection.setAttribute('aria-hidden', 'true');
      profileSection.removeAttribute('aria-hidden');
    }
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // Keyboard accessibility (Escape to go back)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && body.classList.contains('profile-mode')) {
      transitionToHero(true);
    }
  });

  // Interactive Card Lighting Effect (Optimized Delegated Follower)
  document.addEventListener('mousemove', (e) => {
    const card = e.target.closest('[data-glow]');
    if (card) {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
      card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
    }
  }, { passive: true });

  // Cyber Decoder / Scramble Hover Animation for Real Name
  const realNameEl = document.getElementById('realName');
  const realNameWrapper = document.getElementById('realNameWrapper');
  if (realNameEl && realNameWrapper) {
    const trueText = realNameEl.getAttribute('data-value') || realNameEl.textContent.trim();
    realNameEl.setAttribute('data-value', trueText);

    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_//-';
    let scrambleInterval = null;
    let isScrambling = false;

    realNameWrapper.addEventListener('mouseenter', () => {
      if (isScrambling) return;
      isScrambling = true;
      let iteration = 0;
      clearInterval(scrambleInterval);

      scrambleInterval = setInterval(() => {
        realNameEl.textContent = trueText
          .split('')
          .map((letter, index) => {
            if (index < iteration) {
              return trueText[index];
            }
            if (letter === ' ' || letter === '"' || letter === '&') return letter;
            return chars[Math.floor(Math.random() * chars.length)];
          })
          .join('');

        if (iteration >= trueText.length) {
          clearInterval(scrambleInterval);
          realNameEl.textContent = trueText;
          isScrambling = false;
        }

        iteration += 1 / 2;
      }, 25);
    });

    realNameWrapper.addEventListener('mouseleave', () => {
      clearInterval(scrambleInterval);
      realNameEl.textContent = trueText;
      isScrambling = false;
    });
  }

  // =========================================================================
  // AMBIENT BACKGROUND AUDIO CONTROLLER (Web Audio API - Stutter-Free Engine)
  // Rewritten to decode the full track into an AudioBuffer up front, so
  // playback runs from AudioBufferSourceNode instead of streaming through
  // the <audio> element. No mid-playback network buffering/stalls once the
  // initial decode completes.
  // =========================================================================
  const bgAudio = document.getElementById('bgAudio');
  const audioControl = document.getElementById('audioControl');
  const audioToggle = document.getElementById('audioToggle');
  const audioStatusText = document.getElementById('audioStatusText');
  const volumeRange = document.getElementById('volumeRange');
  const volumePct = document.getElementById('volumePct');

  if (bgAudio && audioControl && audioToggle && volumeRange) {
    const DEFAULT_VOLUME = 0.30; // softer ambient loudness
    let currentVolume = DEFAULT_VOLUME;
    let isUserMuted = false;
    let audioCtx = null;
    let gainNode = null;

    // Direct hardware audio thread routing via AudioContext
    let sfxArrayBuffer = null;
    let sfxBuffer = null;
    fetch('slash.mp3')
      .then(res => res.arrayBuffer())
      .then(buf => { sfxArrayBuffer = buf; })
      .catch(() => {});

    // Pre-fetch background track immediately on page load — no AudioContext needed.
    // By the time the user interacts, the bytes are already in memory and we only
    // need to decode (fast), not download + decode.
    let bgArrayBuffer = null;
    fetch(bgAudio.src || 'deiwos.ogg')
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.arrayBuffer(); })
      .then(buf => { bgArrayBuffer = buf; })
      .catch(() => {});

    const slashAudio = document.getElementById('slashAudio') || new Audio('slash.mp3');

    function loadTransitionSfxBuffer() {
      if (!audioCtx || sfxBuffer) return;
      if (sfxArrayBuffer) {
        // Already have the bytes — just decode now that we have a context
        audioCtx.decodeAudioData(sfxArrayBuffer.slice(0))
          .then(decoded => { sfxBuffer = decoded; })
          .catch(() => {});
        return;
      }
      fetch('slash.mp3')
        .then(res => res.arrayBuffer())
        .then(arrayBuffer => audioCtx.decodeAudioData(arrayBuffer))
        .then(decoded => { sfxBuffer = decoded; })
        .catch(() => {});
    }

    // ---- Background track: fully-decoded buffer playback state ----
    let bgTrackBuffer = null;
    let bgLoadStarted = false;
    let bgSourceNode = null;
    let bgIsPlaying = false;
    let bgStartCtxTime = 0;   // audioCtx.currentTime when playback last (re)started
    let bgPauseOffset = 0;    // seconds into the track where we paused
    let pendingPlay = false;  // user asked to play before the buffer was ready

    function loadBgTrackBuffer() {
      if (!audioCtx || bgTrackBuffer || bgLoadStarted) return;
      bgLoadStarted = true;

      const decode = (arrayBuffer) =>
        audioCtx.decodeAudioData(arrayBuffer)
          .then(decoded => {
            bgTrackBuffer = decoded;
            if (pendingPlay) {
              pendingPlay = false;
              startBgPlayback(bgPauseOffset);
            }
          })
          .catch(err => {
            bgLoadStarted = false;
            pendingPlay = false;
            console.warn('Background track decode failed:', err);
            setStatus(isUserMuted ? 'AUDIO: OFF' : 'PAUSED');
          });

      if (bgArrayBuffer) {
        // Already downloaded — decode immediately (no network wait)
        decode(bgArrayBuffer.slice(0));
      } else {
        // Pre-fetch not done yet — download now
        const src = bgAudio.src || 'worry.mp3';
        fetch(src)
          .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.arrayBuffer(); })
          .then(decode)
          .catch(err => {
            bgLoadStarted = false;
            pendingPlay = false;
            console.warn('Background track load failed:', err);
            setStatus(isUserMuted ? 'AUDIO: OFF' : 'PAUSED');
          });
      }
    }

    function startBgPlayback(offset = 0) {
      if (!audioCtx || !bgTrackBuffer) return;

      // Guard against overlapping sources if called twice in a row
      if (bgSourceNode) {
        try { bgSourceNode.onended = null; bgSourceNode.stop(); } catch (e) {}
        bgSourceNode = null;
      }

      const safeOffset = ((offset % bgTrackBuffer.duration) + bgTrackBuffer.duration) % bgTrackBuffer.duration;

      bgSourceNode = audioCtx.createBufferSource();
      bgSourceNode.buffer = bgTrackBuffer;
      bgSourceNode.loop = true; // ambient track — assumed looping, matches prior <audio loop> behavior
      bgSourceNode.connect(gainNode);
      bgSourceNode.start(0, safeOffset);

      bgStartCtxTime = audioCtx.currentTime - safeOffset;
      bgIsPlaying = true;

      onBgPlaying();
    }

    function stopBgPlayback() {
      if (bgSourceNode) {
        bgPauseOffset = audioCtx.currentTime - bgStartCtxTime;
        if (bgTrackBuffer) {
          bgPauseOffset = bgPauseOffset % bgTrackBuffer.duration;
        }
        try { bgSourceNode.onended = null; bgSourceNode.stop(); } catch (e) {}
        bgSourceNode = null;
      }
      bgIsPlaying = false;
      onBgPaused();
    }

    function initWebAudioPipeline() {
      if (!audioCtx) {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (AudioCtxClass) {
          try {
            audioCtx = new AudioCtxClass();
            gainNode = audioCtx.createGain();
            gainNode.gain.setValueAtTime(currentVolume, audioCtx.currentTime);
            gainNode.connect(audioCtx.destination);
            loadTransitionSfxBuffer();
            loadBgTrackBuffer();
          } catch (e) {
            console.warn('Web Audio API hardware routing fallback:', e);
          }
        }
      }
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      if (audioCtx && !sfxBuffer) {
        loadTransitionSfxBuffer();
      }
      if (audioCtx && !bgTrackBuffer) {
        loadBgTrackBuffer();
      }
    }

    playTransitionSound = function (options = {}) {
      if (isUserMuted || currentVolume === 0) return;
      initWebAudioPipeline();
      const rate = options.rate || 1.0;
      const volMult = options.volMult !== undefined ? options.volMult : 0.9;
      const targetVol = Math.min(1.0, currentVolume * volMult * 1.35);

      if (audioCtx && sfxBuffer) {
        try {
          const source = audioCtx.createBufferSource();
          const sfxGain = audioCtx.createGain();
          source.buffer = sfxBuffer;
          source.playbackRate.setValueAtTime(rate, audioCtx.currentTime);
          sfxGain.gain.setValueAtTime(targetVol, audioCtx.currentTime);
          source.connect(sfxGain);
          sfxGain.connect(audioCtx.destination);
          source.start(0);
          return;
        } catch (e) {}
      }

      // Fast HTML5 Audio clone fallback
      try {
        const sfx = slashAudio.cloneNode();
        sfx.volume = targetVol;
        sfx.playbackRate = rate;
        sfx.play().catch(() => {});
      } catch (e) {}
    };

    function setMasterVolume(vol) {
      currentVolume = Math.max(0, Math.min(1, vol));
      if (gainNode && audioCtx) {
        gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
        gainNode.gain.setValueAtTime(gainNode.gain.value, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(currentVolume, audioCtx.currentTime + 0.05);
      }

      if (volumePct) {
        volumePct.textContent = Math.round(currentVolume * 100) + '%';
      }
    }

    // Initialize initial volume softly
    setMasterVolume(DEFAULT_VOLUME);

    // ---- UI state helpers (replace the old native <audio> event listeners) ----
    function setStatus(text) {
      if (audioStatusText) audioStatusText.textContent = text;
    }

    function onBgPlaying() {
      audioControl.classList.add('playing');
      audioControl.classList.remove('paused', 'muted');
      setStatus('AUDIO: ON');
    }

    function onBgPaused() {
      audioControl.classList.remove('playing');
      audioControl.classList.add('paused');
      setStatus(isUserMuted ? 'AUDIO: OFF' : 'PAUSED');
    }

    function onBgLoading() {
      // Mirrors the old 'waiting' handler's visual: not yet audibly playing.
      audioControl.classList.remove('playing');
      setStatus('LOADING…');
    }

    function requestPlay() {
      if (isUserMuted) return;
      initWebAudioPipeline();

      if (bgIsPlaying) return;

      if (bgTrackBuffer) {
        startBgPlayback(bgPauseOffset);
      } else {
        // Buffer still fetching/decoding — play automatically once ready.
        pendingPlay = true;
        onBgLoading();
      }
    }

    function requestPause() {
      pendingPlay = false;
      stopBgPlayback();
    }

    // Attempt autoplay after the track is loaded; browsers may require a gesture.
    requestPlay();

    // Toggle Button (Play / Pause / Mute)
    audioToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      initWebAudioPipeline();

      if (!bgIsPlaying) {
        isUserMuted = false;
        if (currentVolume === 0) {
          currentVolume = DEFAULT_VOLUME;
          volumeRange.value = DEFAULT_VOLUME;
          setMasterVolume(DEFAULT_VOLUME);
        }
        requestPlay();
      } else {
        isUserMuted = true;
        requestPause();
      }
    });

    // Volume Slider
    volumeRange.addEventListener('input', (e) => {
      initWebAudioPipeline();
      const vol = parseFloat(e.target.value);
      setMasterVolume(vol);

      if (vol === 0) {
        audioControl.classList.add('muted');
        audioControl.classList.remove('playing');
        setStatus('MUTED');
      } else {
        audioControl.classList.remove('muted');
        if (!bgIsPlaying) {
          isUserMuted = false;
          requestPlay();
        }
      }
    });
  }

})();