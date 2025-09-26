/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI } from '@google/genai';

// Fix: Define and use AIStudio interface for window.aistudio to resolve type conflict.
// Define the aistudio property on the window object for TypeScript
declare global {
  interface AIStudio {
    openSelectKey: () => Promise<void>;
  }
  interface Window {
    aistudio?: AIStudio;
  }
}

interface VideoConfig {
  aspectRatio: string;
  durationSeconds: number;
  resolution: string;
}

interface GenerateVideosParams {
  model: string;
  prompt: string;
  config: {
    aspectRatio: string;
    durationSeconds: number;
    resolution: string;
    numberOfVideos: number;
  };
  image?: {
    imageBytes: string;
    mimeType: string;
  };
}

async function openApiKeyDialog() {
  if (window.aistudio?.openSelectKey) {
    await window.aistudio.openSelectKey();
  } else {
    // This provides a fallback for environments where the dialog isn't available
    showStatusError(
      'API key selection is not available. Please configure the API_KEY environment variable.',
    );
  }
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      // Return only the Base64 part of the data URL
      resolve(url.split(',')[1]);
    };
    reader.readAsDataURL(blob);
  });
}

const statusEl = document.querySelector('#status') as HTMLDivElement;

async function generateContent(
  prompt: string,
  imageBytes: string,
  apiKey: string,
  config: VideoConfig,
) {
  const ai = new GoogleGenAI({ apiKey });

  const params: GenerateVideosParams = {
    model: 'veo-2.0-generate-001',
    prompt,
    config: {
      aspectRatio: config.aspectRatio,
      durationSeconds: config.durationSeconds,
      resolution: config.resolution,
      numberOfVideos: 1,
    },
  };

  if (imageBytes) {
    params.image = {
      imageBytes,
      mimeType: 'image/png', // Assuming PNG, adjust if supporting others
    };
  }

  let operation = await ai.models.generateVideos(params);

  statusEl.innerText = 'Generating...';

  let pollCount = 0;
  const maxPolls = 20;
  while (!operation.done && pollCount < maxPolls) {
    pollCount++;
    console.log('Waiting for completion');
    await delay(10000); // Poll every 10 seconds
    try {
      operation = await ai.operations.getVideosOperation({ operation });
    } catch (e) {
      console.error('Error polling for operation status:', e);
      throw new Error(
        'Failed to get video generation status. Please try again.',
      );
    }
  }

  if (!operation.done) {
    throw new Error(
      'Video generation timed out. Please try again with a simpler prompt.',
    );
  }

  const videos = operation.response?.generatedVideos;
  if (videos === undefined || videos.length === 0) {
    throw new Error(
      'No videos were generated. The prompt may have been blocked.',
    );
  }

  statusEl.innerText = 'Downloading video...';

  for (const v of videos) {
    const url = decodeURIComponent(v.video.uri);
    // Append API key for access
    const res = await fetch(`${url}&key=${apiKey}`);
    if (!res.ok) {
        throw new Error(`Failed to fetch video file: ${res.statusText}`);
    }
    const blob = await res.blob();
    const objectURL = URL.createObjectURL(blob);
    video.src = objectURL;
    downloadButton.href = objectURL;
    videoContainer.style.display = 'block';
    console.log('Video is ready for playback and download.');
  }
}

// --- DOM Element Selection ---
const upload = document.querySelector('#file-input') as HTMLInputElement;
const promptEl = document.querySelector('#prompt-input') as HTMLTextAreaElement;
const generateButton = document.querySelector(
  '#generate-button',
) as HTMLButtonElement;
const video = document.querySelector('#video') as HTMLVideoElement;
const videoContainer = document.querySelector('#video-container') as HTMLDivElement;
const downloadButton = document.querySelector('#download-button') as HTMLAnchorElement;
const fileNameEl = document.querySelector('#file-name') as HTMLSpanElement;
const imgPreview = document.querySelector('#img-preview') as HTMLImageElement;
const aspectRatioSelect = document.querySelector(
  '#aspect-ratio-select',
) as HTMLSelectElement;
const durationSlider = document.querySelector(
  '#duration-slider',
) as HTMLInputElement;
const durationValueEl = document.querySelector(
  '#duration-value',
) as HTMLSpanElement;
const resolutionSelect = document.querySelector(
  '#resolution-select',
) as HTMLSelectElement;

// --- State Variables ---
let base64data = '';
let prompt = '';

// --- Event Listeners ---
upload.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) {
    fileNameEl.textContent = file.name;
    base64data = await blobToBase64(file);
    imgPreview.src = `data:image/png;base64,${base64data}`;
    imgPreview.style.display = 'block';
  } else {
    fileNameEl.textContent = 'No file chosen';
    base64data = '';
    imgPreview.style.display = 'none';
  }
});

promptEl.addEventListener('input', () => {
  prompt = promptEl.value;
});

durationSlider.addEventListener('input', () => {
  durationValueEl.textContent = durationSlider.value;
});

generateButton.addEventListener('click', () => {
  if (!prompt.trim()) {
    showStatusError('Please enter a prompt to generate a video.');
    return;
  }
  generate();
});

// --- Functions ---
function showStatusError(message: string) {
  statusEl.innerHTML = `<span class="text-red-400">${message}</span>`;
}

function setControlsDisabled(disabled: boolean) {
  generateButton.disabled = disabled;
  upload.disabled = disabled;
  promptEl.disabled = disabled;
  aspectRatioSelect.disabled = disabled;
  durationSlider.disabled = disabled;
  resolutionSelect.disabled = disabled;
}

async function generate() {
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    showStatusError('API key is not configured. Please add your API key.');
    await openApiKeyDialog();
    return;
  }

  const videoConfig: VideoConfig = {
    aspectRatio: aspectRatioSelect.value,
    durationSeconds: parseInt(durationSlider.value, 10),
    resolution: resolutionSelect.value,
  };

  statusEl.innerText = 'Initializing video generation...';
  videoContainer.style.display = 'none';
  setControlsDisabled(true);

  try {
    await generateContent(prompt, base64data, apiKey, videoConfig);
    statusEl.innerText = 'Video generated successfully.';
  } catch (e) {
    console.error('Video generation failed:', e);
    let userFriendlyMessage = 'An unexpected error occurred during video generation.';
    let shouldOpenDialog = false;

    if (e instanceof Error) {
        const errorMessage = e.message.toLowerCase();

        if (
            errorMessage.includes('api key not valid') ||
            errorMessage.includes('api_key_invalid') ||
            errorMessage.includes('permission denied') ||
            errorMessage.includes('requested entity was not found')
        ) {
            userFriendlyMessage = 'Your API key appears to be invalid or lacks permissions. Please verify your key and try again.';
            shouldOpenDialog = true;
        } else if (
            errorMessage.includes('prompt may have been blocked') ||
            errorMessage.includes('no videos were generated')
        ) {
            userFriendlyMessage = 'The video could not be generated, likely because the prompt was blocked for safety reasons. Please try a different prompt.';
        } else if (
            errorMessage.includes('quota') ||
            errorMessage.includes('rate limit')
        ) {
            userFriendlyMessage = 'You have exceeded your request limit for the API. Please wait a while and try again.';
        } else if (errorMessage.includes('video generation timed out')) {
            userFriendlyMessage = 'Video generation timed out. Please try again, perhaps with a simpler prompt or shorter duration.';
        } else if (errorMessage.includes('failed to fetch')) {
            userFriendlyMessage = 'A network error occurred while downloading the video. Please check your internet connection and try again.';
        } else if (
            errorMessage.includes('internal error') ||
            errorMessage.includes('model error')
        ) {
            userFriendlyMessage = 'The model encountered an internal error. Please try again in a few moments.';
        } else if (errorMessage.includes('invalid argument')) {
            userFriendlyMessage = 'An invalid parameter was sent to the model. Please check the video settings and try again.';
        } else {
            userFriendlyMessage = `An error occurred: ${e.message}`;
        }
    }
    
    showStatusError(userFriendlyMessage);

    if (shouldOpenDialog) {
      await openApiKeyDialog();
    }
  } finally {
    setControlsDisabled(false);
  }
}