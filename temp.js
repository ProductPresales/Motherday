
    // ── STATE ──────────────────────────────────────────
    let calcData = {};
    let animFrame = null;
    let videoStartTime = null;
    let pausedAt = 0;
    let isPlaying = false;
    let isDone = false;
    const DURATION = 38000;

    const FRAME_TIMES = [0, 4000, 7000, 11000, 15000, 19000, 23000, 27000, 31000, 35000, 38000];

    // ── PHOTO & RECORDING ──────────────────────────────
    let momPhotoURL = null;
    let momPhotoImg = null; // Pre-loaded Image for canvas drawing
    let recordedChunks = [];
    let mediaRecorder = null;
    let recordedBlob = null;

    // ── AUDIO (none for now) ──
    function startMusic() { }
    function pauseMusic() { }
    function stopMusic() { }

    function handlePhotoUpload(e) {
      const file = e.target.files[0];
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = ev => {
        momPhotoURL = ev.target.result;
        document.getElementById('photoPreviewWrap').style.display = 'block';
        document.getElementById('photoPreviewImg').src = momPhotoURL;
        // Pre-load as Image for canvas drawing in Frame 7
        momPhotoImg = new Image();
        momPhotoImg.src = momPhotoURL;
      };
      reader.readAsDataURL(file);
    }

    function startRecording() {
      const canvas = document.getElementById('mainCanvas');
      if (!canvas.captureStream) return;
      // Reset share button to 'preparing' state
      const btn = document.getElementById('endShareBtn');
      if (btn) { btn.disabled = true; btn.style.opacity = '0.55'; btn.style.cursor = 'not-allowed'; }
      const lbl = document.getElementById('endShareLabel');
      if (lbl) lbl.textContent = '⏳ Preparing video...';
      try {
        recordedChunks = []; recordedBlob = null;
        const stream = canvas.captureStream(30);
        // Prefer MP4 (mobile-friendly), fall back to WebM
        const mime = [
          'video/mp4',
          'video/mp4;codecs=avc1',
          'video/webm;codecs=vp9',
          'video/webm;codecs=vp8',
          'video/webm'
        ].find(t => { try { return MediaRecorder.isTypeSupported(t); } catch (_) { return false; } }) || '';
        mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
        mediaRecorder.ondataavailable = ev => { if (ev.data.size > 0) recordedChunks.push(ev.data); };
        mediaRecorder.onstop = () => {
          const actualMime = mediaRecorder.mimeType || 'video/webm';
          recordedBlob = new Blob(recordedChunks, { type: actualMime });
          // Enable share button now that video is ready
          const b = document.getElementById('endShareBtn');
          const l = document.getElementById('endShareLabel');
          if (b) { b.disabled = false; b.style.opacity = '1'; b.style.cursor = 'pointer'; }
          if (l) l.textContent = 'Share Video on WhatsApp';
        };
        mediaRecorder.start(200);
      } catch (err) {
        console.warn('Recording unavailable:', err);
        const b = document.getElementById('endShareBtn');
        const l = document.getElementById('endShareLabel');
        if (b) { b.disabled = false; b.style.opacity = '1'; b.style.cursor = 'pointer'; }
        if (l) l.textContent = 'Share on WhatsApp';
      }
    }

    function pauseRecording() {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.pause();
      }
    }

    function resumeRecording() {
      if (mediaRecorder && mediaRecorder.state === 'paused') {
        mediaRecorder.resume();
      }
    }

    function stopRecording() {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    }

    // ── NAVIGATION ─────────────────────────────────────
    function showPage(id) {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById(id).classList.add('active');
    }

    // ── TOGGLES ────────────────────────────────────────
    function toggleSwitch(el) { el.classList.toggle('on'); updatePreview(); }
    function isOn(id) { return document.getElementById(id).classList.contains('on'); }

    // ── CALCULATIONS ───────────────────────────────────
    function calculate(name, age, yourName) {
      const totalDays = age * 365;
      // "Did you eat?" ~1.65x per day
      const askedEat   = Math.round(totalDays * 1.647);
      // Meals made with love ~1.5x per day
      const mealsLove  = Math.round(totalDays * 1.5);
      // Mornings she woke up to make your day easier (school + routine)
      const mornings   = Math.min(age, 18) * 240 + Math.max(0, age - 18) * 180;
      return { name, yourName, age, totalDays, askedEat, mealsLove, mornings };
    }

    function updatePreview() {
      const name = document.getElementById('momName').value || '—';
      const age = parseInt(document.getElementById('yourAge').value) || 0;
      const box = document.getElementById('previewBox');
      if (!age) {
        box.innerHTML = '<strong>RECEIPT PREVIEW</strong><br>─────────────────────────<br>Enter your age to see numbers...';
        return;
      }
      const d = calculate(name, age);
      box.innerHTML =
        `<strong>BILL OF LOVE · ${name.toUpperCase()}</strong><br>` +
        `─────────────────────────<br>` +
        (isOn('t-tiffin') ? `Tiffins packed.......${d.tiffins.toLocaleString('en-IN')}<br>` : '') +
        (isOn('t-khaya') ? `"Khaana khaya?".....${d.khaya.toLocaleString('en-IN')}<br>` : '') +
        (isOn('t-hungry') ? `"I'm not hungry"....${d.hungry.toLocaleString('en-IN')}<br>` : '') +
        (isOn('t-sick') ? `Sick-night hours.....${d.sickHrs.toLocaleString('en-IN')}<br>` : '') +
        (isOn('t-pray') ? `Morning prayers.....${d.prayers.toLocaleString('en-IN')}<br>` : '') +
        `─────────────────────────<br>` +
        `Total devotion hrs..${d.totalHours.toLocaleString('en-IN')}<br>` +
        `= ${d.totalYears} years of her life.`;
    }

    // ── GENERATE ───────────────────────────────────────
    function generateVideo() {
      const yourName = document.getElementById('yourName').value.trim();
      const name = document.getElementById('momName').value.trim();
      const age = parseInt(document.getElementById('yourAge').value);
      if (!yourName) { alert('Please enter your name 💗'); return; }
      if (!age || age < 1 || age > 60) { alert('Please enter a valid age.'); return; }
      if (!name) { alert("Please enter your mom's name 💗"); return; }
      if (!name) { alert("Please enter your mom's name 💗"); return; }

      calcData = calculate(name, age, yourName);

      // Update side receipt (simple summary)
      const d = calcData;
      document.getElementById('sideReceipt').innerHTML =
        `<strong>MOM UNWRAPPED · ${d.name.toUpperCase()}</strong><br>` +
        `──────────────────<br>` +
        `Days as your mom: ${d.totalDays.toLocaleString('en-IN')}<br>` +
        `"Did you eat?": ${d.askedEat.toLocaleString('en-IN')}<br>` +
        `Meals of love: ${d.mealsLove.toLocaleString('en-IN')}<br>` +
        `Mornings for you: ${d.mornings.toLocaleString('en-IN')}`;

      // Loading
      showPage('loading-page');
      document.getElementById('loadingName').textContent = `Calculating ${name}'s lifetime of love...`;
      document.getElementById('progressFill').style.width = '0%';

      let prog = 0;
      const iv = setInterval(() => {
        prog += 1.8 + Math.random() * 2.5;
        if (prog >= 100) { prog = 100; clearInterval(iv); }
        document.getElementById('progressFill').style.width = prog + '%';
      }, 55);

      setTimeout(() => {
        showPage('video-page');
        initCanvas();
        // Don't auto-play — show play button
        drawFrame(null, 0); // render first frame
        showPlayOverlay(true);
      }, 3200);
    }

    // ── CANVAS SETUP ───────────────────────────────────
    function initCanvas() {
      const canvas = document.getElementById('mainCanvas');
      // internal resolution: 9:16 at 540×960 for sharpness
      canvas.width = 540;
      canvas.height = 960;
      pausedAt = 0;
      isDone = false;
      isPlaying = false;
      updatePlayBtn();
    }

    // ── PLAYBACK ───────────────────────────────────────
    function togglePlay() {
      if (isDone) { replayVideo(); return; }
      if (isPlaying) { pauseVideo(); } else { playVideo(); }
    }

    function playVideo() {
      isPlaying = true;
      isDone = false;
      hideEndOverlay();
      showPlayOverlay(false);
      videoStartTime = performance.now() - pausedAt;
      updatePlayBtn();
      // Only start fresh recording if playing from the beginning
      if (pausedAt === 0) {
        startRecording();
      } else {
        resumeRecording();
      }
      startMusic();
      tick();
    }

    function pauseVideo() {
      isPlaying = false;
      pausedAt = performance.now() - videoStartTime;
      cancelAnimationFrame(animFrame);
      showPlayOverlay(true, false);
      updatePlayBtn();
      pauseRecording();
      pauseMusic();
    }

    function replayVideo() {
      cancelAnimationFrame(animFrame);
      pausedAt = 0;
      isDone = false;
      isPlaying = true;
      hideEndOverlay();
      showPlayOverlay(false);
      videoStartTime = performance.now();
      updatePlayBtn();
      startRecording(); // Fresh recording for replay
      startMusic();
      tick();
    }

    function tick() {
      const elapsed = performance.now() - videoStartTime;
      const t = Math.min(elapsed, DURATION);
      drawFrame(document.getElementById('mainCanvas').getContext('2d'), t);
      updateScrubber(t);
      updateDots(t);
      if (t < DURATION) {
        animFrame = requestAnimationFrame(tick);
      } else {
        isDone = true;
        isPlaying = false;
        stopRecording();
        stopMusic();
        showEndOverlay();
        updatePlayBtn();
      }
    }

    function showPlayOverlay(show, ended = false) {
      const overlay = document.getElementById('playOverlay');
      const icon = document.getElementById('overlayIcon');
      overlay.classList.toggle('visible', show);
      if (show && !ended) {
        icon.innerHTML = `<circle cx="32" cy="32" r="30" fill="rgba(0,0,0,0.5)" stroke="rgba(255,255,255,0.8)" stroke-width="1.5"/>
      <polygon points="26,20 50,32 26,44" fill="white"/>`;
      }
    }

    function showEndOverlay() {
      showPlayOverlay(false);
      const bgPhoto = document.getElementById('endBgPhoto');
      const scrim = document.getElementById('endScrim');
      const ph = document.getElementById('endPhotoPlaceholder');
      const overlay = document.getElementById('endOverlay');
      if (momPhotoURL) {
        bgPhoto.src = momPhotoURL;
        bgPhoto.style.display = 'block';
        scrim.style.display = 'block';
        ph.style.display = 'none';
        overlay.style.background = 'transparent';
      } else {
        bgPhoto.style.display = 'none';
        scrim.style.display = 'none';
        ph.style.display = 'block';
        overlay.style.background = 'linear-gradient(160deg,#4A0020 0%,#880E4F 45%,#C2185B 100%)';
      }
      document.getElementById('endMomNameText').textContent = calcData.name || 'Mom';
      overlay.classList.add('visible');
    }

    function hideEndOverlay() {
      document.getElementById('endOverlay').classList.remove('visible');
    }

    function updatePlayBtn() {
      const btn = document.getElementById('playPauseBtn');
      if (isDone) { btn.textContent = '↺ REPLAY'; }
      else if (isPlaying) { btn.textContent = '⏸ PAUSE'; }
      else { btn.textContent = '▶ PLAY'; }
    }

    // ── SCRUBBER ───────────────────────────────────────
    function updateScrubber(t) {
      const pct = (t / DURATION) * 100;
      document.getElementById('scrubberFill').style.width = pct + '%';
      document.getElementById('scrubberThumb').style.left = pct + '%';
      const sec = Math.floor(t / 1000);
      document.getElementById('timeLabel').textContent = `0:${String(sec).padStart(2, '0')}`;
    }

    function scrubClick(e) {
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      pausedAt = pct * DURATION;
      isDone = false;
      if (isPlaying) {
        videoStartTime = performance.now() - pausedAt;
      } else {
        const canvas = document.getElementById('mainCanvas');
        drawFrame(canvas.getContext('2d'), pausedAt);
        updateScrubber(pausedAt);
        updateDots(pausedAt);
      }
    }

    // ── FRAME DOTS ─────────────────────────────────────
    function updateDots(t) {
      const dots = document.querySelectorAll('.dot');
      let fi = 0;
      for (let i = 0; i < FRAME_TIMES.length - 1; i++) {
        if (t >= FRAME_TIMES[i]) fi = i;
      }
      dots.forEach((d, i) => d.classList.toggle('active', i === fi));
    }

    // ── SHARE ──────────────────────────────────────────
    function shareVideo() {
      shareWhatsApp();
    }

    async function shareWhatsApp() {
      // If blob not yet ready (recording just stopped, onstop pending), wait
      if (!recordedBlob && mediaRecorder && mediaRecorder.state === 'inactive' && recordedChunks.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1200));
      }

      if (!recordedBlob) {
        alert('Video is still being prepared. Please wait a moment and try again.');
        return;
      }

      const ext = 'mp4'; // Always use .mp4 for mobile compatibility
      const fileName = `moms_bill_${(calcData.name || 'mom').replace(/\s+/g, '_')}.${ext}`;
      // Wrap blob as video/mp4 so mobile players recognize it
      const mobileBlob = new Blob([recordedBlob], { type: 'video/mp4' });
      const file = new File([mobileBlob], fileName, { type: 'video/mp4' });

      // Try Web Share API with the video file (works on mobile Chrome, Safari etc.)
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `Mom's Bill 💗`,
            text: '💗 Happy Mother\'s Day!'
          });
          return;
        } catch (err) {
          if (err.name === 'AbortError') return; // user cancelled
          console.warn('Web Share failed, downloading instead:', err);
        }
      }

      // Fallback: download the video so user can share it manually
      downloadVideo();
    }

    function downloadVideo() {
      if (!recordedBlob) { alert('Video is still being prepared. Please wait a moment and try again.'); return; }
      const fileName = `moms_bill_${(calcData.name||'mom').replace(/\s+/g,'_')}.mp4`;
      const mobileBlob = new Blob([recordedBlob], { type: 'video/mp4' });
      const url = URL.createObjectURL(mobileBlob);
      const a = document.createElement('a'); a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      alert('Video downloaded! Open WhatsApp → attach the video from your Downloads folder.');
    }

    // ── DRAW ENGINE HELPERS ───────────────────────────
    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function clamp(v) { return Math.max(0, Math.min(1, v)); }
    function seg(t, s, e) { return clamp((t - s) / (e - s)); }
    function countUp(to, p) { return Math.floor(lerp(0, to, easeOut(p))); }
    function typewrite(ctx, text, progress, cx, cy, font, color, maxW, lineH) {
      ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'center';
      const chars = Math.floor(text.length * progress);
      const words = text.slice(0, chars).split(' ');
      let line = '', lines = [], lh = lineH || parseInt(font) * 1.45;
      for (let w of words) {
        const test = line + w + ' ';
        if (ctx.measureText(test).width > maxW && line) { lines.push(line.trim()); line = w + ' '; }
        else { line = test; }
      }
      if (line.trim()) lines.push(line.trim());
      const startY = cy - (lines.length - 1) * lh / 2;
      lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lh));
    }

    function drawReceiptBg(ctx, W, H, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      // Soft blush gradient background
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#FFF5F7');
      bg.addColorStop(1, '#FCE4EC');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(194,24,91,0.06)';
      ctx.lineWidth = 1;
      for (let y = 0; y < H; y += 20) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.restore();
    }

    function drawFrame(ctx, t) {
      if (!ctx) ctx = document.getElementById('mainCanvas').getContext('2d');
      const W = 540, H = 960, n = calcData;
      const F = [[0,4000],[4000,7000],[7000,11000],[11000,15000],[15000,19000],[19000,23000],[23000,27000],[27000,31000],[31000,35000],[35000,38000]];
      const fp    = i => seg(t, F[i][0], F[i][1]);
      const animP = i => Math.min(1, fp(i) * (F[i][1]-F[i][0]) / 1500);
      const inF   = i => t >= F[i][0] && t < F[i][1];
      ctx.clearRect(0, 0, W, H);

      function darkBg(a,b){ const g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,a); g.addColorStop(1,b); ctx.fillStyle=g; ctx.fillRect(0,0,W,H); }
      function hline(y,c){ ctx.strokeStyle=c||'rgba(248,187,208,0.2)'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(W/2-90,y); ctx.lineTo(W/2+90,y); ctx.stroke(); }

      // ══ FRAME 0: Title — Mom, Unwrapped ══════════════
      if (inF(0)) {
        darkBg('#2A0012','#6A0038');
        ctx.save(); ctx.globalAlpha=0.06; ctx.fillStyle='#F48FB1';
        for(let i=0;i<5;i++){ ctx.beginPath(); ctx.ellipse(W/2,H/2,160+i*55,65+i*25,i*.6,0,Math.PI*2); ctx.fill(); }
        ctx.restore();
        const p=fp(0); ctx.save(); ctx.textAlign='center';
        ctx.globalAlpha=easeOut(Math.min(1,p*3));
        ctx.font='500 18px "IBM Plex Mono"'; ctx.fillStyle='rgba(248,187,208,0.65)';
        ctx.fillText('M O M ,  U N W R A P P E D',W/2,H/2-85);
        ctx.globalAlpha=easeOut(Math.min(1,p*2.5));
        ctx.font='italic 72px "Playfair Display"'; ctx.fillStyle='#FFF5F7';
        ctx.fillText('Mom,',W/2,H/2);
        ctx.fillText('Unwrapped.',W/2,H/2+82);
        ctx.globalAlpha=easeOut(Math.min(1,(p-.5)*4));
        ctx.font='11px "IBM Plex Mono"'; ctx.fillStyle='rgba(248,187,208,0.45)';
        ctx.fillText('— NIAT India —',W/2,H/2+162);
        ctx.restore();
      }

      // ══ FRAME 1: Dedication ══════════════════════════
      if (inF(1)) {
        darkBg('#1E000E','#5C0030');
        const p=fp(1); ctx.save(); ctx.textAlign='center';
        ctx.globalAlpha=easeOut(Math.min(1,p*3));
        typewrite(ctx,`This is for ${n.name}.`,Math.min(1,p*2.8),W/2,H/2-110,'500 32px "Playfair Display"','#FFF5F7',W-100,50);
        if(p>0.3){
          ctx.globalAlpha=easeOut(seg(p,0.3,1));
          typewrite(ctx,'For my mother — for everything she did that was never meant to be counted.',Math.min(1,seg(p,0.3,1)*2),W/2,H/2+35,'italic 26px "Playfair Display"','rgba(248,187,208,0.85)',W-120,42);
        }
        ctx.restore();
      }

      // ══ FRAME 2: Days she's been your mother ═════════
      if (inF(2)) {
        drawReceiptBg(ctx,W,H,1);
        const p=fp(2), ap=animP(2); ctx.save(); ctx.textAlign='center';
        ctx.globalAlpha=easeOut(Math.min(1,p*3));
        ctx.font='italic 24px "Playfair Display"'; ctx.fillStyle='#880E4F';
        ctx.fillText("She's been my mother for",W/2,H/2-125);
        ctx.font='130px "Bebas Neue"'; ctx.fillStyle='#C2185B';
        ctx.fillText(countUp(n.totalDays,ap).toLocaleString('en-IN'),W/2,H/2+18);
        ctx.font='500 32px "Playfair Display"'; ctx.fillStyle='#3D1A24';
        ctx.fillText('days.',W/2,H/2+78);
        ctx.restore();
      }

      // ══ FRAME 3: "Did you eat?" ═══════════════════════
      if (inF(3)) {
        drawReceiptBg(ctx,W,H,1);
        const p=fp(3), ap=animP(3); ctx.save(); ctx.textAlign='center';
        ctx.globalAlpha=easeOut(Math.min(1,p*3));
        ctx.font='italic 22px "Playfair Display"'; ctx.fillStyle='#880E4F';
        ctx.fillText('Times she asked',W/2,H/2-148);
        ctx.font='italic 34px "Playfair Display"'; ctx.fillStyle='#3D1A24';
        ctx.fillText('"Did you eat?"',W/2,H/2-100);
        ctx.font='118px "Bebas Neue"'; ctx.fillStyle='#C2185B';
        ctx.fillText(countUp(n.askedEat,ap).toLocaleString('en-IN'),W/2,H/2+30);
        ctx.restore();
      }

      // ══ FRAME 4: Meals made with love ════════════════
      if (inF(4)) {
        drawReceiptBg(ctx,W,H,1);
        const p=fp(4), ap=animP(4); ctx.save(); ctx.textAlign='center';
        ctx.globalAlpha=easeOut(Math.min(1,p*3));
        ctx.font='italic 24px "Playfair Display"'; ctx.fillStyle='#880E4F';
        ctx.fillText('Meals she made with love',W/2,H/2-130);
        ctx.font='120px "Bebas Neue"'; ctx.fillStyle='#C2185B';
        ctx.fillText(countUp(n.mealsLove,ap).toLocaleString('en-IN'),W/2,H/2+20);
        ctx.restore();
      }

      // ══ FRAME 5: Mornings ════════════════════════════
      if (inF(5)) {
        drawReceiptBg(ctx,W,H,1);
        const p=fp(5), ap=animP(5); ctx.save(); ctx.textAlign='center';
        ctx.globalAlpha=easeOut(Math.min(1,p*3));
        typewrite(ctx,'Mornings she woke up to make my day easier',Math.min(1,ap*1.5),W/2,H/2-140,'italic 24px "Playfair Display"','#880E4F',W-100,38);
        ctx.font='120px "Bebas Neue"'; ctx.fillStyle='#C2185B';
        ctx.fillText(countUp(n.mornings,ap).toLocaleString('en-IN'),W/2,H/2+40);
        ctx.restore();
      }

      // ══ FRAME 6: Every single call ══════════════════
      if (inF(6)) {
        drawReceiptBg(ctx,W,H,1);
        const p=fp(6), ap=animP(6); ctx.save(); ctx.textAlign='center';
        ctx.globalAlpha=easeOut(Math.min(1,p*3));
        ctx.font='italic 24px "Playfair Display"'; ctx.fillStyle='#880E4F';
        ctx.fillText('Times she answered my call',W/2,H/2-100);
        ctx.font='500 36px "Playfair Display"'; ctx.fillStyle='#3D1A24';
        if(ap > 0.5) {
          ctx.globalAlpha=easeOut(Math.min(1, (ap - 0.5) * 2));
          ctx.fillText('every single one',W/2,H/2+20);
        }
        ctx.restore();
      }

      // ══ FRAME 7: Times she chose love ═══════════════
      if (inF(7)) {
        drawReceiptBg(ctx,W,H,1);
        const p=fp(7), ap=animP(7); ctx.save(); ctx.textAlign='center';
        ctx.globalAlpha=easeOut(Math.min(1,p*3));
        ctx.font='italic 24px "Playfair Display"'; ctx.fillStyle='#880E4F';
        ctx.fillText('Times she chose love',W/2,H/2-100);
        if(ap > 0.5) {
          ctx.globalAlpha=easeOut(Math.min(1, (ap - 0.5) * 2));
          ctx.font='130px "Playfair Display"'; ctx.fillStyle='rgba(136,14,79,0.8)';
          ctx.fillText('∞',W/2,H/2+60);
        }
        ctx.restore();
      }

      // ══ FRAME 8: Poem — she didn't keep count ════════
      if (inF(8)) {
        darkBg('#1E000E','#540028');
        const p=fp(8); ctx.save(); ctx.textAlign='center';
        ctx.globalAlpha=easeOut(Math.min(1,p*2.5));
        typewrite(ctx,`${n.totalDays.toLocaleString('en-IN')} days.`,Math.min(1,p*3),W/2,H/2-155,'italic 36px "Playfair Display"','#FFF5F7',W-100,52);
        if(p>0.22){ ctx.globalAlpha=easeOut(seg(p,0.22,0.7)); typewrite(ctx,'And not one of them was about her.',Math.min(1,seg(p,0.22,0.8)*2),W/2,H/2-60,'italic 28px "Playfair Display"','rgba(248,187,208,0.9)',W-120,44); }
        if(p>0.48){ ctx.globalAlpha=easeOut(seg(p,0.48,0.9)); typewrite(ctx,"She didn't keep count.",Math.min(1,seg(p,0.48,1)*2),W/2,H/2+50,'500 32px "Playfair Display"','#F8BBD0',W-120,48); }
        if(p>0.7){  ctx.globalAlpha=easeOut(seg(p,0.7,1));  typewrite(ctx,'I did.',Math.min(1,seg(p,0.7,1)*3),W/2,H/2+122,'italic 42px "Playfair Display"','#FFF5F7',W-120,56); }
        if(p>0.85){ ctx.globalAlpha=easeOut(seg(p,0.85,1)); ctx.font='italic 17px "IBM Plex Mono"'; ctx.fillStyle='rgba(248,187,208,0.55)'; ctx.fillText(`\u2014 From your ${n.yourName||'child'}`,W/2,H/2+188); }
        ctx.restore();
      }

      // ══ FRAME 9: End card — NIAT ══════════════════════
      if (inF(9)) {
        const p=fp(9); darkBg('#880E4F','#AD1457');
        if(momPhotoImg&&momPhotoImg.complete&&momPhotoImg.naturalWidth>0){
          ctx.save(); ctx.globalAlpha=easeOut(Math.min(1,p*2.5));
          const iW=momPhotoImg.naturalWidth,iH=momPhotoImg.naturalHeight,sc=Math.max(W/iW,H/iH);
          ctx.drawImage(momPhotoImg,(W-iW*sc)/2,(H-iH*sc)/2,iW*sc,iH*sc);
          const scrim=ctx.createLinearGradient(0,0,0,H);
          scrim.addColorStop(0,'rgba(40,0,20,0.3)'); scrim.addColorStop(0.5,'rgba(40,0,20,0.5)'); scrim.addColorStop(1,'rgba(40,0,20,0.92)');
          ctx.fillStyle=scrim; ctx.fillRect(0,0,W,H); ctx.restore();
        } else {
          // Dynamic background design for fallback
          ctx.save(); ctx.globalAlpha=easeOut(p)*0.35;
          const hearts = ['💗', '✨', '🌸', '💖', '✨', '🌺'];
          ctx.font = '28px serif';
          for (let i = 0; i < 15; i++) {
             // Slowly drift upwards based on time `t`
             const hx = W * ((i * 0.17 + (t * 0.00002)) % 1);
             const hy = H - ((H * 1.2) * ((i * 0.23 + (t * 0.00005)) % 1));
             ctx.fillText(hearts[i % hearts.length], hx, hy);
          }
          ctx.restore();
        }
        ctx.save(); ctx.textAlign='center'; const cy=H/2;
        ctx.globalAlpha=easeOut(Math.min(1,p*3));
        ctx.font='12px "IBM Plex Mono"'; ctx.fillStyle='rgba(248,187,208,0.6)';
        ctx.fillText('\u2014 Issued at NIAT \u2014',W/2,cy-148);
        hline(cy-130);
        typewrite(ctx,'For mothers, who carried more than we ever asked them to notice.',Math.min(1,p*2),W/2,cy-58,'italic 26px "Playfair Display"','rgba(255,245,247,0.9)',W-120,40);
        hline(cy+14);
        ctx.globalAlpha=easeOut(seg(p,0.3,1));
        ctx.font='500 22px "IBM Plex Mono"'; ctx.fillStyle='#F8BBD0';
        ctx.fillText('#MomUnwrapped',W/2,cy+58);
        ctx.font='13px "IBM Plex Mono"'; ctx.fillStyle='rgba(248,187,208,0.65)';
        ctx.fillText('niatindia.com/mom',W/2,cy+94);
        ctx.globalAlpha=easeOut(seg(p,0.5,1));
        ctx.font='68px "Bebas Neue"'; ctx.fillStyle='rgba(255,245,247,0.14)';
        ctx.fillText('NIAT',W/2,cy+172);
        ctx.font='10px "IBM Plex Mono"'; ctx.fillStyle='rgba(248,187,208,0.3)';
        ctx.fillText('\u00a9 2026 NIAT India',W/2,cy+210);
        ctx.restore();
      }
    }

    // ── INIT ───────────────────────────────────────────
    updatePreview();
  
