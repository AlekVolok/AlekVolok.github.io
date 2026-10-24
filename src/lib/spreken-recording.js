// Permission prompts can stay pending forever. Release a stream if it arrives
// after the caller has already timed out, so retrying never leaks the microphone.
export function requestMicrophone(getUserMedia, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error('De microfoon reageert niet. Sta microfoontoegang toe in de browser en probeer opnieuw.'));
    }, timeoutMs);
    Promise.resolve().then(() => getUserMedia({ audio: true })).then((stream) => {
      if (settled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(stream);
    }, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

// Each recording owns its recorder, chunks and stream until the final stop event.
export function createRecording(stream, Recorder = MediaRecorder) {
  let recorder;
  try {
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']
      .find((type) => Recorder.isTypeSupported?.(type));
    recorder = mimeType ? new Recorder(stream, { mimeType }) : new Recorder(stream);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  const chunks = [];
  let failure = null;
  const done = new Promise((resolve) => {
    recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data); };
    recorder.onerror = () => { failure = new Error('De opname is mislukt. Neem je antwoord opnieuw op.'); };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'audio/webm' });
      resolve({ blob: failure || !blob.size ? null : blob,
        error: failure || (!blob.size ? new Error('Geen audio opgeslagen. Neem je antwoord opnieuw op.') : null) });
    };
  });
  try {
    recorder.start();
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  return {
    done,
    stop() {
      if (recorder.state !== 'inactive') recorder.stop();
      return done;
    },
  };
}
