// Each recording owns its recorder, chunks and stream until the final stop event.
export function createRecording(stream, Recorder = MediaRecorder) {
  let recorder;
  try {
    recorder = new Recorder(stream);
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
    recorder.start(1000);
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
