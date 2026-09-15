(async function () {
      'use strict';

      const qs = (() => {
        try { return new URLSearchParams(window.location.search); }
        catch (err) { console.error('URL params error', err); return new Map(); }
      })();

      const STORAGE_KEY = 'chemdisk.yt.v1';
      const fromUrl = (qs.get('id') || '').trim();
      const loadStoredId = () => {
        try { return sessionStorage.getItem(STORAGE_KEY) || ''; }
        catch { return ''; }
      };
      if (fromUrl) {
        try { sessionStorage.setItem(STORAGE_KEY, fromUrl); } catch {}
        try { history.replaceState({}, document.title, location.pathname + location.hash); } catch {}
      }
      const videoIdRaw = fromUrl || loadStoredId();

      const authState = await window.ChemAuth.ready;
      if (!authState?.authenticated || !authState.session?.ok) return;

      const extractVideoId = (input) => {
        const value = String(input || '').trim();
        if (/^[0-9A-Za-z_-]{11}$/.test(value)) return value;
        try {
          const url = new URL(value);
          const host = url.hostname.toLowerCase().replace(/^www\./, '');
          let candidate = '';
          if (host === 'youtu.be') candidate = url.pathname.split('/').filter(Boolean)[0] || '';
          if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
            candidate = url.searchParams.get('v') || '';
            if (!candidate) {
              const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([0-9A-Za-z_-]{11})(?:\/|$)/i);
              candidate = match ? match[1] : '';
            }
          }
          return /^[0-9A-Za-z_-]{11}$/.test(candidate) ? candidate : '';
        } catch { return ''; }
      };

      const videoId = extractVideoId(videoIdRaw);
      const progressApi = window.ChemProgress;
      const progressMaterialId = progressApi
        ? progressApi.materialId('video', videoId || videoIdRaw, qs.get('material') || '')
        : '';

      const shell = document.getElementById('playerShell');
      const controls = document.getElementById('controls');
      const overlayGuard = document.getElementById('overlayGuard');
      const playBtn = document.getElementById('playBtn');
      const restartBtn = document.getElementById('restartBtn');
      const muteBtn = document.getElementById('muteBtn');
      const fullscreenBtn = document.getElementById('fullscreenBtn');
      const progress = document.getElementById('progress');
      const volume = document.getElementById('volume');
      const timeCurrent = document.getElementById('timeCurrent');
      const timeTotal = document.getElementById('timeTotal');
      const messageBox = document.getElementById('message');

      let player = null;
      let rafId = 0;
      let apiReady = false;
      let playerReady = false;
      let seeking = false;
      let hideControlsTimer = 0;
      let desiredMuted = false;
      let muteSyncTimer = 0;
      let muteCommandVersion = 0;
      let lastAudibleVolume = 80;
      let lastWatchSample = null;
      let currentWatchRange = null;
      let watchedRanges = [];
      let lastProgressSync = 0;
      const CONTROLS_HIDE_DELAY = 3200;
      const PROGRESS_SYNC_INTERVAL = 15000;

      const trackedRanges = () => [
        ...watchedRanges,
        ...(currentWatchRange ? [currentWatchRange] : [])
      ];

      const syncTrackedProgress = (immediate = false) => {
        if (!progressApi || !progressMaterialId || !playerReady) return;
        const duration = Number(player.getDuration()) || 0;
        const position = Number(player.getCurrentTime()) || 0;
        progressApi.update({
          materialId: progressMaterialId,
          materialType: 'video',
          action: 'video',
          lastPosition: { seconds: position, duration },
          details: {
            playbackStarted: true,
            duration,
            lastPlaybackPosition: position,
            watchedRanges: trackedRanges()
          }
        }, { immediate, debounceMs: 2500 });
        lastProgressSync = Date.now();
      };

      const collectWatchSample = (current) => {
        if (!Number.isFinite(current) || current < 0) return;
        if (lastWatchSample != null) {
          const delta = current - lastWatchSample;
          if (delta > 0 && delta <= 2.5) {
            if (!currentWatchRange) currentWatchRange = [lastWatchSample, current];
            else if (lastWatchSample <= currentWatchRange[1] + .5) currentWatchRange[1] = current;
            else {
              watchedRanges.push(currentWatchRange);
              currentWatchRange = [lastWatchSample, current];
            }
          } else if (currentWatchRange) {
            watchedRanges.push(currentWatchRange);
            currentWatchRange = null;
          }
        }
        lastWatchSample = current;
        if (watchedRanges.length > 300) watchedRanges = watchedRanges.slice(-300);
        if (Date.now() - lastProgressSync >= PROGRESS_SYNC_INTERVAL) syncTrackedProgress(false);
      };

      const resetControlsHideTimer = (keepVisible = false) => {
        shell.classList.remove('dimmed');
        if (hideControlsTimer) {
          clearTimeout(hideControlsTimer);
          hideControlsTimer = 0;
        }
        if (keepVisible || !playerReady) return;
        hideControlsTimer = window.setTimeout(() => {
          hideControlsTimer = 0;
          if (!playerReady || seeking) return;
          shell.classList.add('dimmed');
        }, CONTROLS_HIDE_DELAY);
      };

      const showError = (text) => {
        messageBox.textContent = text;
        messageBox.style.display = 'block';
        controls.classList.add('hidden');
      };

      if (!videoId) {
        showError('Podaj poprawny parametr "id" w adresie URL, np. ?id=CH50zuS8DD0');
        return;
      }

      const loadScript = (src) => new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });

      const readyCallbacks = [];
      const ensureApiReady = () => {
        if (apiReady && window.YT && typeof window.YT.Player === 'function') {
          return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
          readyCallbacks.push({ resolve, reject });
        });
      };

      const onApiReady = () => {
        apiReady = true;
        readyCallbacks.splice(0).forEach(({ resolve }) => resolve());
      };

      const onApiError = () => {
        readyCallbacks.splice(0).forEach(({ reject }) => reject(new Error('YouTube API unavailable')));
      };

      window.onYouTubeIframeAPIReady = () => {
        onApiReady();
      };

      loadScript('https://www.youtube.com/iframe_api').catch(() => {
        onApiError();
        showError('Nie udało się załadować API YouTube. Spróbuj ponownie później.');
      });

      const formatTime = (seconds) => {
        if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
        const total = Math.floor(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0) {
          return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
        }
        return [m, s].map((v) => String(v).padStart(2, '0')).join(':');
      };

      const updatePlayButton = (isPlaying) => {
        playBtn.dataset.playing = String(Boolean(isPlaying));
        playBtn.setAttribute('aria-label', isPlaying ? 'Wstrzymaj' : 'Odtwórz');
        playBtn.querySelector('.btn-label').textContent = isPlaying ? 'Pauza' : 'Odtwórz';
      };

      const updateMuteButton = (muted) => {
        const next = Boolean(muted);
        muteBtn.dataset.muted = String(next);
        muteBtn.setAttribute('aria-pressed', String(next));
        muteBtn.setAttribute('aria-label', next ? 'Włącz dźwięk' : 'Wycisz');
        muteBtn.querySelector('.btn-label').textContent = next ? 'Wyciszony' : 'Dźwięk';
      };

      const updateFullscreenButton = (active) => {
        const next = Boolean(active);
        fullscreenBtn.dataset.fullscreen = String(next);
        fullscreenBtn.setAttribute('aria-label', next ? 'Wyłącz pełny ekran' : 'Włącz pełny ekran');
        fullscreenBtn.querySelector('.btn-label').textContent = next ? 'Wyjdź' : 'Pełny ekran';
      };

      const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;

      const updateRangeFill = (input, percentage) => {
        const safe = Math.max(0, Math.min(100, Number(percentage) || 0));
        input.style.setProperty('--range-progress', `${safe}%`);
      };

      const verifyMuteState = (version, attempt = 0) => {
        if (!playerReady || version !== muteCommandVersion) return;
        const actualMuted = Boolean(player.isMuted());
        if (actualMuted === desiredMuted) {
          updateMuteButton(desiredMuted);
          return;
        }
        if (desiredMuted) player.mute();
        else player.unMute();
        if (attempt < 2) {
          muteSyncTimer = window.setTimeout(() => verifyMuteState(version, attempt + 1), 120);
        }
      };

      const requestMuteState = (muted) => {
        if (!playerReady) return;
        desiredMuted = Boolean(muted);
        if (!desiredMuted && volume.valueAsNumber <= 0) {
          const restored = Math.max(1, lastAudibleVolume || 80);
          volume.value = String(restored);
          player.setVolume(restored);
          updateRangeFill(volume, restored);
        }
        if (desiredMuted) player.mute();
        else player.unMute();
        updateMuteButton(desiredMuted);
        window.clearTimeout(muteSyncTimer);
        muteCommandVersion += 1;
        const version = muteCommandVersion;
        muteSyncTimer = window.setTimeout(() => verifyMuteState(version), 140);
      };

      const updateProgress = () => {
        if (!player || !playerReady || seeking) return;
        const duration = player.getDuration();
        const current = player.getCurrentTime();
        if (player.getPlayerState() === YT.PlayerState.PLAYING) collectWatchSample(current);
        const ratio = duration ? (current / duration) : 0;
        progress.value = Math.max(0, Math.min(1000, Math.round(ratio * 1000)));
        updateRangeFill(progress, ratio * 100);
        timeCurrent.textContent = formatTime(current);
        timeTotal.textContent = formatTime(duration);
      };

      const syncProgress = () => {
        updateProgress();
        rafId = requestAnimationFrame(syncProgress);
      };

      const startSync = () => {
        cancelAnimationFrame(rafId);
        syncProgress();
      };

      const stopSync = () => {
        cancelAnimationFrame(rafId);
      };

      const createPlayer = () => {
        if (!window.YT || typeof window.YT.Player !== 'function') {
          showError('API YouTube jest niedostępne w tej przeglądarce.');
          return;
        }
        player = new YT.Player('playerFrame', {
          videoId,
          height: '100%',
          width: '100%',
          playerVars: {
            controls: 0,
            disablekb: 1,
            rel: 0,
            fs: 0,
            playsinline: 1,
            iv_load_policy: 3,
            cc_load_policy: 0,
            color: 'white',
            origin: window.location.origin
          },
          events: {
            onReady: (event) => {
              playerReady = true;
              const initialVolume = volume.valueAsNumber;
              player.setVolume(initialVolume);
              desiredMuted = Boolean(player.isMuted()) || initialVolume <= 0;
              lastAudibleVolume = initialVolume > 0 ? initialVolume : 80;
              updateRangeFill(volume, initialVolume);
              timeTotal.textContent = formatTime(player.getDuration());
              timeCurrent.textContent = formatTime(player.getCurrentTime());
              controls.classList.remove('hidden');
              updatePlayButton(false);
              updateMuteButton(desiredMuted);
              updateProgress();
              resetControlsHideTimer();
              progressApi?.load().then(() => {
                const saved = progressApi.record(progressMaterialId);
                const savedPosition = Number(saved?.details?.lastPlaybackPosition);
                if (Number.isFinite(savedPosition) && savedPosition > 0 && savedPosition < player.getDuration() - 2) {
                  player.seekTo(savedPosition, true);
                  updateProgress();
                }
              }).catch(() => {});
            },
            onStateChange: (event) => {
              if (event.data === YT.PlayerState.PLAYING) {
                lastWatchSample = Number(player.getCurrentTime()) || 0;
                updatePlayButton(true);
                startSync();
                resetControlsHideTimer();
              } else if (event.data === YT.PlayerState.PAUSED) {
                updatePlayButton(false);
                stopSync();
                updateProgress();
                syncTrackedProgress(true);
                resetControlsHideTimer();
              } else if (event.data === YT.PlayerState.ENDED) {
                updatePlayButton(false);
                stopSync();
                progress.value = 1000;
                timeCurrent.textContent = formatTime(player.getDuration());
                syncTrackedProgress(true);
                resetControlsHideTimer();
              }
            },
            onError: () => showError('Nie można odtworzyć tego filmu. Sprawdź ID i ustawienia osadzania w YouTube.'),
            onAutoplayBlocked: () => resetControlsHideTimer()
          }
        });
      };

      ensureApiReady().then(createPlayer).catch(() => {
        showError('Nie udało się zainicjować playera YouTube.');
      });

      playBtn.addEventListener('click', () => {
        if (!playerReady) return;
        resetControlsHideTimer();
        const state = player.getPlayerState();
        if (state === YT.PlayerState.PLAYING) {
          player.pauseVideo();
        } else {
          player.playVideo();
        }
      });

      restartBtn.addEventListener('click', () => {
        if (!playerReady) return;
        resetControlsHideTimer();
        player.seekTo(0, true);
        player.playVideo();
      });

      muteBtn.addEventListener('click', () => {
        if (!playerReady) return;
        resetControlsHideTimer();
        requestMuteState(!desiredMuted);
      });

      fullscreenBtn.addEventListener('click', async () => {
        try {
          resetControlsHideTimer();
          if (fullscreenElement()) {
            const exit = document.exitFullscreen || document.webkitExitFullscreen;
            if (typeof exit === 'function') await exit.call(document);
          } else {
            const enter = shell.requestFullscreen || shell.webkitRequestFullscreen;
            if (typeof enter !== 'function') return;
            await enter.call(shell);
          }
        } catch (err) {
          console.warn('Fullscreen toggle failed', err);
        }
      });

      const syncFullscreenButton = () => updateFullscreenButton(Boolean(fullscreenElement()));
      document.addEventListener('fullscreenchange', syncFullscreenButton);
      document.addEventListener('webkitfullscreenchange', syncFullscreenButton);

      progress.addEventListener('input', () => {
        if (!playerReady) return;
        resetControlsHideTimer(true);
        seeking = true;
        const duration = player.getDuration();
        const fraction = progress.valueAsNumber / 1000;
        timeCurrent.textContent = formatTime(duration * fraction);
        updateRangeFill(progress, fraction * 100);
      });

      progress.addEventListener('change', () => {
        if (!playerReady) return;
        const duration = player.getDuration();
        const fraction = progress.valueAsNumber / 1000;
        player.seekTo(duration * fraction, true);
        if (currentWatchRange) watchedRanges.push(currentWatchRange);
        currentWatchRange = null;
        lastWatchSample = duration * fraction;
        seeking = false;
        startSync();
        resetControlsHideTimer();
      });

      volume.addEventListener('input', () => {
        if (!playerReady) return;
        resetControlsHideTimer();
        const value = volume.valueAsNumber;
        player.setVolume(value);
        updateRangeFill(volume, value);
        if (value > 0) lastAudibleVolume = value;
        requestMuteState(value <= 0);
      });

      overlayGuard.addEventListener('click', () => {
        if (!playerReady) return;
        const state = player.getPlayerState();
        if (state === YT.PlayerState.PLAYING) {
          player.pauseVideo();
        } else {
          player.playVideo();
        }
        resetControlsHideTimer();
      });

      const userActivityEvents = ['mousemove', 'mousedown', 'touchstart', 'keydown'];
      userActivityEvents.forEach((evt) => {
        shell.addEventListener(evt, () => {
          resetControlsHideTimer();
        }, { passive: true });
      });

      const blockEvents = ['contextmenu', 'dragstart'];
      blockEvents.forEach((type) => {
        document.addEventListener(type, (event) => {
          event.preventDefault();
          event.stopPropagation();
        }, { capture: true });
      });

      document.addEventListener('keydown', (event) => {
        const key = event.key.toLowerCase();
        const combo = event.ctrlKey || event.metaKey;
        if (combo && ['s', 'p', 'u'].includes(key)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }, { capture: true });

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopSync();
        else if (playerReady && player.getPlayerState() === YT.PlayerState.PLAYING) startSync();
      });

      window.addEventListener('pagehide', () => {
        syncTrackedProgress(true);
        window.clearTimeout(muteSyncTimer);
        window.clearTimeout(hideControlsTimer);
        cancelAnimationFrame(rafId);
      }, { once: true });
    })();
