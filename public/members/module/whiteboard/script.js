(async () => {
        const authState = await window.ChemAuth.ready;
        if (!authState?.authenticated || !authState.session?.ok) return;
        const frame = document.getElementById('whiteboard-frame');
        if (frame) frame.src = frame.dataset.src || '';
      })();
