import axios from 'axios';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createPixelArtWithNovita(originalImageUrl) {
  const apiKey = process.env.NOVITA_API_KEY;

  if (!apiKey) {
    throw new Error('Missing NOVITA_API_KEY');
  }

  const start = await axios.post(
    'https://api.novita.ai/v3/async/flux-2-pro',
    {
      images: [originalImageUrl],
      prompt:
        'Transform this image into clean 8-bit pixel art NFT style. Keep the main subject recognizable. Vibrant colors, square avatar, pixelated, sharp edges.',
      size: '1024*1024'
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    }
  );

  const taskId = start.data?.task_id;

  if (!taskId) {
    throw new Error(`Novita did not return task_id: ${JSON.stringify(start.data)}`);
  }

  for (let i = 0; i < 40; i++) {
    await sleep(3000);

    const result = await axios.get(
      'https://api.novita.ai/v3/async/task-result',
      {
        params: { task_id: taskId },
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      }
    );

    const images =
      result.data?.images ||
      result.data?.result?.images ||
      result.data?.task?.images;

    const imageUrl =
      images?.[0]?.image_url ||
      images?.[0]?.url ||
      images?.[0];

    if (imageUrl) {
      return imageUrl;
    }

    const status =
      result.data?.status ||
      result.data?.task?.status;

    if (status === 'FAILED' || status === 'failed') {
      throw new Error(`Novita failed: ${JSON.stringify(result.data)}`);
    }
  }

  throw new Error('Novita image generation timed out.');
}
