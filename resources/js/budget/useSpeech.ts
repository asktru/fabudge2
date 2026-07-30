import { ref } from 'vue';

interface SpeechRecognitionLike {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
    onend: (() => void) | null;
    onerror: (() => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
}

function recognitionConstructor(): (new () => SpeechRecognitionLike) | null {
    const scope = window as unknown as {
        SpeechRecognition?: new () => SpeechRecognitionLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };

    return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/**
 * Thin wrapper over the browser SpeechRecognition API. `supported` is false
 * where the API doesn't exist; callers hide the mic button then.
 */
export function useSpeech(onFinal: (transcript: string) => void) {
    const supported = recognitionConstructor() !== null;
    const listening = ref(false);
    const interim = ref('');

    let recognition: SpeechRecognitionLike | null = null;

    function start() {
        const Constructor = recognitionConstructor();

        if (!Constructor || listening.value) {
            return;
        }

        recognition = new Constructor();
        recognition.lang = navigator.language || 'en-US';
        recognition.interimResults = true;
        recognition.continuous = false;

        let finalTranscript = '';

        recognition.onresult = (event) => {
            let interimText = '';

            for (let index = 0; index < event.results.length; index += 1) {
                const result = event.results[index];

                if (result.isFinal) {
                    finalTranscript += result[0].transcript;
                } else {
                    interimText += result[0].transcript;
                }
            }

            interim.value = finalTranscript + interimText;
        };

        recognition.onend = () => {
            listening.value = false;
            interim.value = '';

            if (finalTranscript.trim()) {
                onFinal(finalTranscript.trim());
            }
        };

        recognition.onerror = () => {
            listening.value = false;
            interim.value = '';
        };

        listening.value = true;
        interim.value = '';
        recognition.start();
    }

    function stop() {
        recognition?.stop();
    }

    return { supported, listening, interim, start, stop };
}
